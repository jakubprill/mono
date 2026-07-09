# `mono-cli init` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual `mono-cli config schema` command with an idempotent `mono-cli init` command that sets up a consumer repo for `mono-cli`: it creates a `mono.config.json` skeleton if missing, (re)generates `.mono/schema.json`, and ensures `.gitignore` excludes the generated schema.

**Architecture:** `mono-cli` is a distributed tool run in arbitrary consumer repos, so `.mono/schema.json` is a per-repo local artifact, not a build product of `mono-cli` itself and not committed to any repo's git history. `initCommand` (a thin `effect/unstable/cli` `Command` wrapper, mirroring `work/start.ts`'s `startCommand`/`startWork` split) resolves the repo root via `GitClient.repoRoot`, then delegates to an exported `runInit(repoRoot)` effect that performs three independent, individually-tested steps: `ensureConfigSkeleton`, schema generation (reusing the existing `toWritableSchema`), and `ensureGitignoreEntry`.

**Tech Stack:** TypeScript, Effect (`effect` v4 beta, `effect/unstable/cli` `Command`), Bun (`bun:test`, `@effect/platform-bun`), Biome.

## Global Constraints

- `init` must be safe to run repeatedly (idempotent): re-running never duplicates the `.gitignore` entry and never overwrites an existing `mono.config.json`.
- `.mono/schema.json` is never committed as part of this plan and no CI drift-check is added — per the approved design, each developer regenerates it locally.
- `mono-cli config schema` and its parent `configCommand` are removed entirely — no backward-compatibility shim.
- Tests use real temporary directories and real `@effect/platform-bun` layers (`BunFileSystem.layer`, `BunPath.layer`) — this codebase has no in-memory/mock `FileSystem` test layer anywhere (confirmed in `apps/cli/tests/config/loadConfig.test.ts`); don't introduce one.
- Business logic is exported as a plain function separate from the `Command` wrapper (mirrors `startWork`/`startCommand` in `apps/cli/src/work/start.ts`) so it's testable without going through CLI argument parsing.
- Per `CLAUDE.md`, consult `effect-solutions` (`bunx effect-solutions show <topic>`) before writing unfamiliar Effect patterns; this plan otherwise mirrors patterns already present in `apps/cli/src/config/loadConfig.ts` and `apps/cli/src/work/start.ts`.

---

### Task 1: Remove `mono-cli config schema`

**Files:**
- Delete: `apps/cli/src/config/command.ts`
- Modify: `apps/cli/src/config/schema.ts`
- Modify: `apps/cli/src/index.ts`

**Interfaces:**
- Consumes: none.
- Produces: `toWritableSchema` remains exported, unchanged, from `apps/cli/src/config/schema.ts` — Task 4 imports it.

- [ ] **Step 1: Delete the old config command file**

```bash
rm apps/cli/src/config/command.ts
```

- [ ] **Step 2: Strip `schema.ts` down to just `toWritableSchema`**

Replace the full contents of `apps/cli/src/config/schema.ts` with:

```typescript
import type { JsonSchema } from "effect";

/**
 * Converts a `Schema.toJsonSchemaDocument` result into a self-resolving JSON
 * Schema object suitable for writing to a standalone file. The document's
 * `schema` and `definitions` fields are separate; the `$ref`s inside them
 * point at `#/$defs/...`, so the definitions must be embedded under a
 * `$defs` key at the root for those refs to resolve when the file is read
 * on its own.
 */
export const toWritableSchema = (
  doc: JsonSchema.Document<"draft-2020-12">,
): Record<string, unknown> => ({
  ...doc.schema,
  $defs: doc.definitions,
});
```

- [ ] **Step 3: Remove `configCommand` from `index.ts`**

In `apps/cli/src/index.ts`, delete this import line:

```typescript
import { configCommand } from "./config/command.ts";
```

And change:

```typescript
  Command.withSubcommands([greet, jiraCommand, configCommand, workCommand]),
```

to:

```typescript
  Command.withSubcommands([greet, jiraCommand, workCommand]),
```

- [ ] **Step 4: Run the existing test suite and typecheck to confirm nothing else referenced the removed code**

Run: `cd apps/cli && bun test && bun run typecheck`
Expected: all tests pass (in particular `tests/config/schema.test.ts`, which only exercises `toWritableSchema` and is untouched), and `tsc --noEmit` reports no errors.

- [ ] **Step 5: Lint and commit**

```bash
cd apps/cli && bun run lint
git add apps/cli/src/config/schema.ts apps/cli/src/index.ts
git rm apps/cli/src/config/command.ts
git commit -m "$(cat <<'EOF'
refactor(cli): remove mono-cli config schema command

Schema generation moves to the upcoming mono-cli init command —
config schema was a manually-invoked step that was easy to forget,
and mono-cli is a distributed tool where .mono/schema.json is a
per-consumer-repo local artifact, not a build product.
EOF
)"
```

---

### Task 2: `ensureConfigSkeleton`

**Files:**
- Create: `apps/cli/src/init/configSkeleton.ts`
- Test: `apps/cli/tests/init/configSkeleton.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `ensureConfigSkeleton(repoRoot: string) => Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>` — Task 4 imports this from `./configSkeleton.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/tests/init/configSkeleton.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import { ensureConfigSkeleton } from "../../src/init/configSkeleton.ts";

const testLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-init-test-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("ensureConfigSkeleton", () => {
  test("creates mono.config.json when missing", async () => {
    await Effect.runPromise(
      ensureConfigSkeleton(repoDir).pipe(Effect.provide(testLayer)),
    );

    const configPath = join(repoDir, "mono.config.json");
    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.$schema).toBe("./.mono/schema.json");
    expect(written.work).toEqual({});
  });

  test("leaves an existing mono.config.json untouched", async () => {
    const configPath = join(repoDir, "mono.config.json");
    const original = JSON.stringify({ work: { startStatus: "In Progress" } });
    writeFileSync(configPath, original);

    await Effect.runPromise(
      ensureConfigSkeleton(repoDir).pipe(Effect.provide(testLayer)),
    );

    expect(readFileSync(configPath, "utf8")).toBe(original);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/cli && bun test tests/init/configSkeleton.test.ts`
Expected: FAIL — `Cannot find module '../../src/init/configSkeleton.ts'`

- [ ] **Step 3: Implement `ensureConfigSkeleton`**

Create `apps/cli/src/init/configSkeleton.ts`:

```typescript
import { Effect, FileSystem, Path } from "effect";

export const ensureConfigSkeleton = (repoRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const configPath = path.join(repoRoot, "mono.config.json");
    const exists = yield* fs
      .exists(configPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (exists) return;

    const skeleton = { $schema: "./.mono/schema.json", work: {} };
    yield* fs.writeFileString(
      configPath,
      `${JSON.stringify(skeleton, null, 2)}\n`,
    );
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/cli && bun test tests/init/configSkeleton.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Lint and commit**

```bash
cd apps/cli && bun run lint
git add apps/cli/src/init/configSkeleton.ts apps/cli/tests/init/configSkeleton.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add ensureConfigSkeleton for mono-cli init

Writes a minimal mono.config.json (with $schema pointing at
.mono/schema.json) only when one doesn't already exist, so init is
safe to re-run without clobbering a user's config.
EOF
)"
```

---

### Task 3: `ensureGitignoreEntry`

**Files:**
- Create: `apps/cli/src/init/gitignore.ts`
- Test: `apps/cli/tests/init/gitignore.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `ensureGitignoreEntry(repoRoot: string) => Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>` — Task 4 imports this from `./gitignore.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/tests/init/gitignore.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import { ensureGitignoreEntry } from "../../src/init/gitignore.ts";

const testLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-init-test-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("ensureGitignoreEntry", () => {
  test("creates .gitignore with the entry when missing", async () => {
    await Effect.runPromise(
      ensureGitignoreEntry(repoDir).pipe(Effect.provide(testLayer)),
    );

    const content = readFileSync(join(repoDir, ".gitignore"), "utf8");
    expect(content).toBe(".mono/schema.json\n");
  });

  test("appends the entry to an existing .gitignore", async () => {
    const gitignorePath = join(repoDir, ".gitignore");
    writeFileSync(gitignorePath, "node_modules\n");

    await Effect.runPromise(
      ensureGitignoreEntry(repoDir).pipe(Effect.provide(testLayer)),
    );

    const content = readFileSync(gitignorePath, "utf8");
    expect(content).toBe("node_modules\n.mono/schema.json\n");
  });

  test("does not duplicate an existing entry", async () => {
    const gitignorePath = join(repoDir, ".gitignore");
    writeFileSync(gitignorePath, "node_modules\n.mono/schema.json\n");

    await Effect.runPromise(
      ensureGitignoreEntry(repoDir).pipe(Effect.provide(testLayer)),
    );

    const content = readFileSync(gitignorePath, "utf8");
    expect(content).toBe("node_modules\n.mono/schema.json\n");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/cli && bun test tests/init/gitignore.test.ts`
Expected: FAIL — `Cannot find module '../../src/init/gitignore.ts'`

- [ ] **Step 3: Implement `ensureGitignoreEntry`**

Create `apps/cli/src/init/gitignore.ts`:

```typescript
import { Effect, FileSystem, Path } from "effect";

const SCHEMA_GITIGNORE_ENTRY = ".mono/schema.json";

export const ensureGitignoreEntry = (repoRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const gitignorePath = path.join(repoRoot, ".gitignore");
    const exists = yield* fs
      .exists(gitignorePath)
      .pipe(Effect.orElseSucceed(() => false));

    let content = "";
    if (exists) {
      content = yield* fs.readFileString(gitignorePath);
    }

    if (content.split("\n").includes(SCHEMA_GITIGNORE_ENTRY)) return;

    const withTrailingNewline =
      content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
    yield* fs.writeFileString(
      gitignorePath,
      `${withTrailingNewline}${SCHEMA_GITIGNORE_ENTRY}\n`,
    );
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/cli && bun test tests/init/gitignore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Lint and commit**

```bash
cd apps/cli && bun run lint
git add apps/cli/src/init/gitignore.ts apps/cli/tests/init/gitignore.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add ensureGitignoreEntry for mono-cli init

Appends a .mono/schema.json ignore entry to the repo's .gitignore
(creating the file if needed), skipping repos that already have it —
the generated schema is a local artifact, never committed.
EOF
)"
```

---

### Task 4: `initCommand`

**Files:**
- Create: `apps/cli/src/init/command.ts`
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/tests/init/command.test.ts`

**Interfaces:**
- Consumes: `ensureConfigSkeleton` (Task 2, `apps/cli/src/init/configSkeleton.ts`), `ensureGitignoreEntry` (Task 3, `apps/cli/src/init/gitignore.ts`), `toWritableSchema` (Task 1, `apps/cli/src/config/schema.ts`), `MonoConfig` (`apps/cli/src/config/Config.ts`), `GitClient` (`@mono/git`, `.repoRoot: Effect<string, GitCommandError>`, `.layer`).
- Produces: `runInit(repoRoot: string) => Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>` and `initCommand: Command<"init", ...>`, both exported from `apps/cli/src/init/command.ts`. `index.ts` registers `initCommand`.

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/tests/init/command.test.ts`. This tests the exported `runInit(repoRoot)` effect directly — mirroring how `apps/cli/tests/work/start.test.ts` tests `startWork` rather than the `Command` wrapper — so no `GitClient`/git repo is needed, just a plain directory path:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import { runInit } from "../../src/init/command.ts";

const testLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-init-test-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("runInit", () => {
  test("creates mono.config.json, .mono/schema.json, and .gitignore in a fresh repo", async () => {
    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));

    expect(existsSync(join(repoDir, "mono.config.json"))).toBe(true);
    expect(existsSync(join(repoDir, ".mono", "schema.json"))).toBe(true);

    const gitignore = readFileSync(join(repoDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".mono/schema.json");

    const schema = JSON.parse(
      readFileSync(join(repoDir, ".mono", "schema.json"), "utf8"),
    );
    expect(schema.$defs.MonoConfig).toBeDefined();
    expect(schema.$defs.WorkConfig).toBeDefined();
  });

  test("leaves an existing mono.config.json untouched but still writes the schema", async () => {
    const configPath = join(repoDir, "mono.config.json");
    const original = JSON.stringify({ work: { startStatus: "In Progress" } });
    writeFileSync(configPath, original);

    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));

    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(existsSync(join(repoDir, ".mono", "schema.json"))).toBe(true);
  });

  test("is idempotent: running twice does not duplicate the .gitignore entry", async () => {
    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));
    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));

    const gitignore = readFileSync(join(repoDir, ".gitignore"), "utf8");
    const occurrences = gitignore.split(".mono/schema.json").length - 1;
    expect(occurrences).toBe(1);
  });
});
```

Note: this deliberately doesn't unit-test `initCommand`'s "not a git repository" `catchTag` branch — no test in this codebase exercises a `Command`'s handler directly (`start.test.ts` tests `startWork`, never `startCommand`), and the `GitCommandError` catch here is the same copy-proven one-liner pattern already used untested in `work/start.ts`. It's covered instead by manual verification in Step 7.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/cli && bun test tests/init/command.test.ts`
Expected: FAIL — `Cannot find module '../../src/init/command.ts'`

- [ ] **Step 3: Implement `command.ts`**

Create `apps/cli/src/init/command.ts`:

```typescript
import { GitClient } from "@mono/git";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { MonoConfig } from "../config/Config.ts";
import { toWritableSchema } from "../config/schema.ts";
import { ensureConfigSkeleton } from "./configSkeleton.ts";
import { ensureGitignoreEntry } from "./gitignore.ts";

const writeSchema = (repoRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });
    const outputSchema = toWritableSchema(doc);

    const outDir = path.join(repoRoot, ".mono");
    yield* fs.makeDirectory(outDir, { recursive: true });

    const outPath = path.join(outDir, "schema.json");
    yield* fs.writeFileString(outPath, JSON.stringify(outputSchema, null, 2));
  });

export const runInit = (repoRoot: string) =>
  Effect.gen(function* () {
    yield* ensureConfigSkeleton(repoRoot);
    yield* writeSchema(repoRoot);
    yield* ensureGitignoreEntry(repoRoot);
    yield* Console.log(`Initialized mono-cli in ${repoRoot}`);
  });

export const initCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const git = yield* GitClient;
    const repoRoot = yield* git.repoRoot;
    yield* runInit(repoRoot);
  }).pipe(
    Effect.catchTag("GitCommandError", (e) =>
      Console.error(`Not a git repository: ${e.stderr}`).pipe(
        Effect.andThen(Effect.fail(e)),
      ),
    ),
    Effect.provide(GitClient.layer),
  ),
).pipe(
  Command.withDescription(
    "Set up mono-cli in this repo: mono.config.json, .mono/schema.json, .gitignore",
  ),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/cli && bun test tests/init/command.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Register `initCommand` in `index.ts`**

In `apps/cli/src/index.ts`, add the import in alphabetical position:

```typescript
import { initCommand } from "./init/command.ts";
```

And change:

```typescript
  Command.withSubcommands([greet, jiraCommand, workCommand]),
```

to:

```typescript
  Command.withSubcommands([greet, initCommand, jiraCommand, workCommand]),
```

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `cd apps/cli && bun test && bun run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Manual verification**

```bash
cd /tmp && rm -rf mono-init-smoke && mkdir mono-init-smoke && cd mono-init-smoke
git init -q -b main
bun run --cwd /Users/jakubprill/Projects/jakubprill/mono/apps/cli src/index.ts init
cat mono.config.json
cat .mono/schema.json
cat .gitignore
```

Expected: `Initialized mono-cli in /tmp/mono-init-smoke`, followed by a `mono.config.json` with `$schema`/`work`, a populated `.mono/schema.json`, and a `.gitignore` containing `.mono/schema.json`.

Then verify the "not a git repository" error path:

```bash
cd /tmp && rm -rf mono-init-nogit && mkdir mono-init-nogit && cd mono-init-nogit
bun run --cwd /Users/jakubprill/Projects/jakubprill/mono/apps/cli src/index.ts init
```

Expected: command fails with `Not a git repository: ...` and a non-zero exit code, and no files are created in `mono-init-nogit`.

Clean up with `rm -rf /tmp/mono-init-smoke /tmp/mono-init-nogit` afterward.

- [ ] **Step 8: Lint and commit**

```bash
cd apps/cli && bun run lint
git add apps/cli/src/init/command.ts apps/cli/tests/init/command.test.ts apps/cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): add mono-cli init command

Replaces the removed config schema command with a single idempotent
entry point that sets up a consumer repo for mono-cli: creates
mono.config.json if missing, (re)generates .mono/schema.json, and
ensures .gitignore excludes the generated schema.
EOF
)"
```
