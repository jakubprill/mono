# Work Start + Config File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mono-cli work start <KEY>` (create a branch from a configurable template and transition a Jira issue to a configured status) backed by a new two-tier `mono` config file mechanism (global `~/.config/mono/config.json` + per-project `mono.config.json`).

**Architecture:** A new `@mono/git` package wraps `git` shell operations behind an `Effect` service (mirroring `@mono/jira`'s `JiraClient`). A new `apps/cli/src/config` module defines the config shape as an `Effect.Schema.Class`, discovers and merges the global + project config files, and exposes a `mono-cli config schema` command that emits a JSON Schema for editor autocompletion. A new `apps/cli/src/work` module holds the `start` orchestration, which composes `@mono/jira`'s `JiraClient`, `@mono/git`'s `GitClient`, and the resolved config.

**Tech Stack:** Bun, TypeScript, Effect (`effect@4.0.0-beta.93`, `effect/unstable/cli`, `effect/unstable/process`), `@effect/platform-bun`, `@effect/vitest` (packages only), `bun:test` (apps/cli).

## Global Constraints

- Use `bun`/`bun test`/`bun run` throughout — never `node`, `npm`, `ts-node`, `jest`, or `vitest` CLI directly outside of `packages/*` (which already use vitest; `apps/cli` uses `bun:test`).
- New packages mirror `packages/jira`'s `package.json`/`tsconfig.json`/`vitest.config.ts` shape exactly (see Task 2).
- Domain services follow the existing `Context.Service` + `static readonly layer = Layer.effect(...)` pattern (see `packages/jira/src/JiraClient.ts`); domain errors follow the existing `Schema.TaggedErrorClass` + `override readonly [Runtime.errorReported] = false` pattern (see `packages/jira/src/errors.ts`).
- This iteration implements **only** `work start` and the config mechanism. Do not add `work commit`, `@mono/ai`, the `mono-cli mcp` server, GitLab MR support, git worktree mode, non-interactive `work start`, or an import linter — all explicitly out of scope per `docs/superpowers/specs/2026-07-04-git-workflow-design.md`.
- `lefthook` runs `bun run lint` and `bun run typecheck` (project-wide, all workspaces) as a pre-commit hook — every commit step in this plan must pass both before it succeeds.

---

## Task 1: Add `issueType` to `@mono/jira`'s `Issue` model

`work start` needs the Jira issue's type (e.g. "Bug", "Story") to resolve the `{type}` placeholder in the branch name template. The current `Issue`/`RawIssue` schema in `packages/jira/src/Issue.ts` doesn't decode it — Jira's REST response includes it as `fields.issuetype.name`.

**Files:**
- Modify: `packages/jira/src/Issue.ts`
- Modify: `packages/jira/tests/Issue.test.ts`
- Modify: `packages/jira/tests/JiraClient.test.ts`
- Modify: `apps/cli/tests/jira/issue/render.test.ts`

**Interfaces:**
- Produces: `Issue.issueType: string` — a new required field read by `apps/cli/src/work/start.ts` (Task 7) via `issue.issueType`.

- [ ] **Step 1: Update the failing tests first**

Edit `packages/jira/tests/Issue.test.ts` — add `issuetype` to both raw fixtures, assert the new field, and add `issueType` to both `new Issue({...})` constructions:

```ts
import { describe, expect, test } from "@effect/vitest";
import { Schema } from "effect";
import { Issue, RawIssue, toIssue } from "../src/Issue.ts";

const decodeRawIssue = Schema.decodeSync(RawIssue);

describe("toIssue", () => {
  test("maps a fully-populated raw issue", () => {
    const raw = decodeRawIssue({
      key: "PROJ-123",
      fields: {
        summary: "Fix login redirect loop",
        status: { name: "In Progress" },
        assignee: { displayName: "Jane Doe" },
        description: "Users are redirected to login instead of dashboard.",
        issuetype: { name: "Bug" },
      },
    });

    const issue = toIssue(raw);

    expect(issue.key).toBe("PROJ-123");
    expect(issue.summary).toBe("Fix login redirect loop");
    expect(issue.status).toBe("In Progress");
    expect(issue.assignee).toBe("Jane Doe");
    expect(issue.description).toBe(
      "Users are redirected to login instead of dashboard.",
    );
    expect(issue.issueType).toBe("Bug");
  });

  test("maps a null assignee and null description to null", () => {
    const raw = decodeRawIssue({
      key: "PROJ-124",
      fields: {
        summary: "Unassigned bug",
        status: { name: "Open" },
        assignee: null,
        description: null,
        issuetype: { name: "Story" },
      },
    });

    const issue = toIssue(raw);

    expect(issue.assignee).toBeNull();
    expect(issue.description).toBeNull();
    expect(issue.issueType).toBe("Story");
  });
});

describe("Issue.toMarkdown", () => {
  test("renders key, summary, status, assignee, and description", () => {
    const issue = new Issue({
      key: "PROJ-123",
      summary: "Fix login redirect loop",
      status: "In Progress",
      assignee: "Jane Doe",
      description: "Users are redirected to login instead of dashboard.",
      issueType: "Bug",
    });

    const markdown = issue.toMarkdown();

    expect(markdown).toContain("PROJ-123: Fix login redirect loop");
    expect(markdown).toContain("Status: In Progress");
    expect(markdown).toContain("Assignee: Jane Doe");
    expect(markdown).toContain(
      "Users are redirected to login instead of dashboard.",
    );
  });

  test("renders Unassigned and omits the description block when both are null", () => {
    const issue = new Issue({
      key: "PROJ-124",
      summary: "Unassigned bug",
      status: "Open",
      assignee: null,
      description: null,
      issueType: "Bug",
    });

    const markdown = issue.toMarkdown();

    expect(markdown).toContain("Assignee: Unassigned");
    expect(markdown).not.toContain("Description:");
  });
});
```

Edit `packages/jira/tests/JiraClient.test.ts` — add `issuetype` to the `rawIssueJson` helper (this fixture backs every `getIssue` test in the file):

```ts
const rawIssueJson = (
  overrides: {
    key?: string;
    assignee?: { displayName: string } | null;
    description?: string | null;
  } = {},
) => ({
  key: overrides.key ?? "PROJ-123",
  fields: {
    summary: "Fix login redirect loop",
    status: { name: "In Progress" },
    assignee:
      "assignee" in overrides
        ? overrides.assignee
        : { displayName: "Jane Doe" },
    description:
      "description" in overrides
        ? overrides.description
        : "Users are redirected to login.",
    issuetype: { name: "Bug" },
  },
});
```

Edit `apps/cli/tests/jira/issue/render.test.ts` — add `issueType` to the fixture and to the expected JSON object (the JSON render path encodes the whole `Issue` schema, so the new field will appear in its output):

```ts
import { describe, expect, test } from "bun:test";
import { Issue } from "@mono/jira";
import { renderIssue } from "../../../src/jira/issue/render.ts";

const issue = new Issue({
  key: "PROJ-123",
  summary: "Fix login redirect loop",
  status: "In Progress",
  assignee: "Jane Doe",
  description: "Users are redirected to login instead of dashboard.",
  issueType: "Bug",
});

describe("renderIssue", () => {
  test("markdown format includes key, status, and assignee", () => {
    const output = renderIssue(issue, "markdown");
    expect(output).toContain("PROJ-123: Fix login redirect loop");
    expect(output).toContain("Status: In Progress");
    expect(output).toContain("Assignee: Jane Doe");
  });

  test("json format produces valid, parseable JSON with core fields", () => {
    const output = renderIssue(issue, "json");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      key: "PROJ-123",
      summary: "Fix login redirect loop",
      status: "In Progress",
      assignee: "Jane Doe",
      description: "Users are redirected to login instead of dashboard.",
      issueType: "Bug",
    });
  });

  test("markdown format shows Unassigned when assignee is null", () => {
    const unassigned = new Issue({ ...issue, assignee: null });
    expect(renderIssue(unassigned, "markdown")).toContain(
      "Assignee: Unassigned",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/jira && bun run test`
Expected: FAIL — `issuetype`/`issueType` don't exist on `RawFields`/`Issue` yet (schema decode errors and/or TS excess-property errors on the `new Issue({...})` calls).

Run: `cd apps/cli && bun test tests/jira/issue/render.test.ts`
Expected: FAIL — same reason (`issueType` missing from `Issue`).

- [ ] **Step 3: Implement the `issueType` field**

Rewrite `packages/jira/src/Issue.ts`:

```ts
import { Schema } from "effect";

class RawStatus extends Schema.Class<RawStatus>("RawStatus")({
  name: Schema.String,
}) {}

class RawAssignee extends Schema.Class<RawAssignee>("RawAssignee")({
  displayName: Schema.String,
}) {}

class RawIssueType extends Schema.Class<RawIssueType>("RawIssueType")({
  name: Schema.String,
}) {}

class RawFields extends Schema.Class<RawFields>("RawFields")({
  summary: Schema.String,
  status: RawStatus,
  assignee: Schema.NullOr(RawAssignee),
  description: Schema.NullOr(Schema.String),
  issuetype: RawIssueType,
}) {}

export class RawIssue extends Schema.Class<RawIssue>("RawIssue")({
  key: Schema.String,
  fields: RawFields,
}) {}

export class Issue extends Schema.Class<Issue>("Issue")({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  assignee: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  issueType: Schema.String,
}) {
  toMarkdown(): string {
    const lines = [
      `${this.key}: ${this.summary}`,
      `Status: ${this.status}`,
      `Assignee: ${this.assignee ?? "Unassigned"}`,
    ];
    if (this.description) {
      lines.push("", "Description:", this.description);
    }
    return lines.join("\n");
  }
}

export const toIssue = (raw: RawIssue): Issue =>
  new Issue({
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status.name,
    assignee: raw.fields.assignee?.displayName ?? null,
    description: raw.fields.description,
    issueType: raw.fields.issuetype.name,
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/jira && bun run test`
Expected: PASS (all suites, including `JiraClient.test.ts` and `Transition.test.ts`)

Run: `cd apps/cli && bun test tests/jira/issue/render.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/jira/src/Issue.ts packages/jira/tests/Issue.test.ts packages/jira/tests/JiraClient.test.ts apps/cli/tests/jira/issue/render.test.ts
git commit -m "$(cat <<'EOF'
feat(jira): add issueType to Issue

work start needs the Jira issue type to resolve the {type} placeholder
in its branch name template.
EOF
)"
```

---

## Task 2: `@mono/git` package — `GitClient` service

New package providing `git` operations as an `Effect` service, mirroring `@mono/jira`'s `JiraClient`. Uses `effect/unstable/process`'s `ChildProcessSpawner`/`ChildProcess` (already available via `effect`; the concrete Bun-backed implementation comes from `@effect/platform-bun`'s `BunChildProcessSpawner`, already part of the `BunServices.layer` provided once in `apps/cli/src/index.ts`).

**Files:**
- Create: `packages/git/package.json`
- Create: `packages/git/tsconfig.json`
- Create: `packages/git/vitest.config.ts`
- Create: `packages/git/src/errors.ts`
- Create: `packages/git/src/GitClient.ts`
- Create: `packages/git/src/index.ts`
- Create: `packages/git/tests/GitClient.test.ts`
- Modify: `package.json` (root — no change needed; `workspaces: ["packages/*", "apps/*"]` already covers it)

**Interfaces:**
- Produces: `GitClient` (`Context.Service`) with `repoRoot: Effect.Effect<string, GitCommandError>`, `currentBranch: Effect.Effect<string, GitCommandError>`, `defaultRemoteBranch: Effect.Effect<string, GitCommandError>`, `createBranch: (name: string, base: string) => Effect.Effect<void, GitCommandError>`, and `GitClient.layer: Layer.Layer<GitClient, never, ChildProcessSpawner>`.
- Produces: `GitCommandError` (`{ command: string; stderr: string }`), used by Task 4 and Task 7.

- [ ] **Step 1: Scaffold the package**

Create `packages/git/package.json`:

```json
{
  "name": "@mono/git",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "lint": "biome check",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "catalog:effect"
  },
  "devDependencies": {
    "@effect/platform-bun": "catalog:effect",
    "@effect/vitest": "catalog:effect",
    "vitest": "^4.0.0"
  }
}
```

Create `packages/git/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rewriteRelativeImportExtensions": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "tests"]
}
```

Create `packages/git/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

Run: `bun install` (from repo root, to link the new workspace package)
Expected: completes without error; `node_modules/@mono/git` symlinked

- [ ] **Step 2: Write the failing tests**

Create `packages/git/tests/GitClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { BunChildProcessSpawner } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCommandError } from "../src/errors.ts";
import { GitClient } from "../src/GitClient.ts";

const testLayer = GitClient.layer.pipe(Layer.provide(BunChildProcessSpawner.layer));

let repoDir: string;
let originalCwd: string;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-git-test-"));
  await Bun.$`git init -q -b main`.cwd(repoDir).quiet();
  await Bun.$`git config user.email test@example.com`.cwd(repoDir).quiet();
  await Bun.$`git config user.name Test`.cwd(repoDir).quiet();
  await Bun.$`git commit --allow-empty -q -m init`.cwd(repoDir).quiet();
  originalCwd = process.cwd();
  process.chdir(repoDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repoDir, { recursive: true, force: true });
});

describe("GitClient.repoRoot", () => {
  it.effect("returns the repo's top-level directory", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const root = yield* git.repoRoot;
      expect(root).toBe(realpathSync(repoDir));
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("GitClient.currentBranch", () => {
  it.effect("returns the checked-out branch name", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const branch = yield* git.currentBranch;
      expect(branch).toBe("main");
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("GitClient.createBranch", () => {
  it.effect("creates and checks out a new branch from the given base", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      yield* git.createBranch("feature/test", "main");
      const branch = yield* git.currentBranch;
      expect(branch).toBe("feature/test");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("fails when the base branch doesn't exist", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const failure = yield* Effect.flip(
        git.createBranch("feature/test", "does-not-exist"),
      );
      expect(failure).toBeInstanceOf(GitCommandError);
    }).pipe(Effect.provide(testLayer)),
  );
});

const addOriginWithDefaultBranch = async (repoPath: string): Promise<void> => {
  const remoteDir = mkdtempSync(join(tmpdir(), "mono-git-remote-"));
  await Bun.$`git init -q --bare -b main`.cwd(remoteDir).quiet();
  await Bun.$`git remote add origin ${remoteDir}`.cwd(repoPath).quiet();
  await Bun.$`git push -q origin main`.cwd(repoPath).quiet();
  await Bun.$`git remote set-head origin main`.cwd(repoPath).quiet();
};

describe("GitClient.defaultRemoteBranch", () => {
  it.effect("fails clearly when there is no origin remote", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const failure = yield* Effect.flip(git.defaultRemoteBranch);
      expect(failure).toBeInstanceOf(GitCommandError);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("returns the remote's default branch name", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => addOriginWithDefaultBranch(repoDir));
      const git = yield* GitClient;
      const branch = yield* git.defaultRemoteBranch;
      expect(branch).toBe("main");
    }).pipe(Effect.provide(testLayer)),
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/git && bunx vitest run tests/GitClient.test.ts`
Expected: FAIL — `../src/errors.ts` and `../src/GitClient.ts` don't exist yet.

- [ ] **Step 4: Implement `errors.ts` and `GitClient.ts`**

Create `packages/git/src/errors.ts`:

```ts
import { Schema } from "effect";
import * as Runtime from "effect/Runtime";

export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()(
  "GitCommandError",
  { command: Schema.String, stderr: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
}
```

Create `packages/git/src/GitClient.ts`:

```ts
import { Effect, Layer, Stream } from "effect";
import * as Context from "effect/Context";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { GitCommandError } from "./errors.ts";

export class GitClient extends Context.Service<
  GitClient,
  {
    readonly repoRoot: Effect.Effect<string, GitCommandError>;
    readonly currentBranch: Effect.Effect<string, GitCommandError>;
    readonly defaultRemoteBranch: Effect.Effect<string, GitCommandError>;
    readonly createBranch: (
      name: string,
      base: string,
    ) => Effect.Effect<void, GitCommandError>;
  }
>()("@mono/GitClient") {
  static readonly layer = Layer.effect(
    GitClient,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      const run = (args: ReadonlyArray<string>): Effect.Effect<string, GitCommandError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(ChildProcess.make("git", args));
            const [stdout, stderr, exitCode] = yield* Effect.all([
              Stream.mkString(handle.stdout),
              Stream.mkString(handle.stderr),
              handle.exitCode,
            ]);
            return {
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode: Number(exitCode),
            };
          }),
        ).pipe(
          Effect.catch((error) =>
            Effect.fail(
              new GitCommandError({
                command: `git ${args.join(" ")}`,
                stderr: String(error),
              }),
            ),
          ),
          Effect.flatMap(({ stdout, stderr, exitCode }) =>
            exitCode === 0
              ? Effect.succeed(stdout)
              : Effect.fail(
                  new GitCommandError({ command: `git ${args.join(" ")}`, stderr }),
                ),
          ),
        );

      const repoRoot = run(["rev-parse", "--show-toplevel"]);
      const currentBranch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
      const defaultRemoteBranch = run([
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
      ]).pipe(Effect.map((ref) => ref.replace("refs/remotes/origin/", "")));
      const createBranch = (name: string, base: string) =>
        run(["checkout", "-b", name, base]).pipe(Effect.asVoid);

      return { repoRoot, currentBranch, defaultRemoteBranch, createBranch };
    }),
  );
}
```

Create `packages/git/src/index.ts`:

```ts
export * from "./errors.ts";
export * from "./GitClient.ts";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/git && bunx vitest run tests/GitClient.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/git
git commit -m "$(cat <<'EOF'
feat(git): add @mono/git package with GitClient service

Wraps git shell operations (repoRoot, currentBranch, defaultRemoteBranch,
createBranch) behind an Effect service, mirroring @mono/jira's JiraClient.
EOF
)"
```

---

## Task 3: `apps/cli/src/config/Config.ts` — schema and merge (pure)

Defines the `mono.config.json`/global-config shape as `Effect.Schema.Class`, the resolved (defaults-applied) shape consumers use, and the field-by-field merge rule (project wins over global, both win over in-code defaults). No I/O — pure and unit-testable.

**Files:**
- Create: `apps/cli/src/config/Config.ts`
- Create: `apps/cli/tests/config/Config.test.ts`

**Interfaces:**
- Produces: `GitConfig`, `JiraWorkConfig`, `MonoConfig` (Schema classes), `ResolvedConfig` (interface), `defaultConfig: ResolvedConfig`, `mergeConfig(global: MonoConfig | undefined, project: MonoConfig | undefined): ResolvedConfig` — consumed by Task 4 (`loadConfig.ts`) and Task 7 (`start.ts`, via the `ResolvedConfig` type).

- [ ] **Step 1: Write the failing test**

Create `apps/cli/tests/config/Config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { defaultConfig, mergeConfig, MonoConfig } from "../../src/config/Config.ts";

const decode = (json: unknown) => Schema.decodeUnknownSync(MonoConfig)(json);

describe("MonoConfig", () => {
  test("decodes an empty object to all-optional-absent", () => {
    const config = decode({});
    expect(config.git).toBeUndefined();
    expect(config.jira).toBeUndefined();
  });

  test("decodes a fully-populated config", () => {
    const config = decode({
      git: {
        baseBranches: ["main", "develop"],
        branchTemplate: "{type}/{key}-{slug}",
        issueTypeAliases: { Bug: "bugfix" },
      },
      jira: { startTransitionStatus: "In Progress" },
    });
    expect(config.git?.baseBranches).toEqual(["main", "develop"]);
    expect(config.git?.branchTemplate).toBe("{type}/{key}-{slug}");
    expect(config.git?.issueTypeAliases).toEqual({ Bug: "bugfix" });
    expect(config.jira?.startTransitionStatus).toBe("In Progress");
  });

  test("ignores the $schema field", () => {
    const config = decode({ $schema: "./.mono/schema.json" });
    expect(config.git).toBeUndefined();
  });
});

describe("mergeConfig", () => {
  test("returns defaults when both are undefined", () => {
    expect(mergeConfig(undefined, undefined)).toEqual(defaultConfig);
  });

  test("project field wins over global on the same field", () => {
    const global = decode({ git: { baseBranches: ["main"] } });
    const project = decode({ git: { baseBranches: ["develop"] } });
    expect(mergeConfig(global, project).baseBranches).toEqual(["develop"]);
  });

  test("non-conflicting fields from both global and project apply", () => {
    const global = decode({ git: { baseBranches: ["main"] } });
    const project = decode({ jira: { startTransitionStatus: "In Progress" } });
    const merged = mergeConfig(global, project);
    expect(merged.baseBranches).toEqual(["main"]);
    expect(merged.startTransitionStatus).toBe("In Progress");
  });

  test("falls back to defaultConfig.branchTemplate when neither sets it", () => {
    const project = decode({ jira: { startTransitionStatus: "Done" } });
    expect(mergeConfig(undefined, project).branchTemplate).toBe(
      defaultConfig.branchTemplate,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/config/Config.test.ts`
Expected: FAIL — `../../src/config/Config.ts` does not exist.

- [ ] **Step 3: Implement `Config.ts`**

Create `apps/cli/src/config/Config.ts`:

```ts
import { Schema } from "effect";

export class GitConfig extends Schema.Class<GitConfig>("GitConfig")({
  baseBranches: Schema.optional(Schema.Array(Schema.String)),
  branchTemplate: Schema.optional(Schema.String),
  issueTypeAliases: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class JiraWorkConfig extends Schema.Class<JiraWorkConfig>("JiraWorkConfig")({
  startTransitionStatus: Schema.optional(Schema.String),
}) {}

export class MonoConfig extends Schema.Class<MonoConfig>("MonoConfig")({
  $schema: Schema.optional(Schema.String),
  git: Schema.optional(GitConfig),
  jira: Schema.optional(JiraWorkConfig),
}) {}

export interface ResolvedConfig {
  readonly baseBranches: ReadonlyArray<string>;
  readonly branchTemplate: string;
  readonly issueTypeAliases: Readonly<Record<string, string>>;
  readonly startTransitionStatus: string | undefined;
}

export const defaultConfig: ResolvedConfig = {
  baseBranches: [],
  branchTemplate: "{key}-{slug}",
  issueTypeAliases: {},
  startTransitionStatus: undefined,
};

export const mergeConfig = (
  global: MonoConfig | undefined,
  project: MonoConfig | undefined,
): ResolvedConfig => ({
  baseBranches:
    project?.git?.baseBranches ?? global?.git?.baseBranches ?? defaultConfig.baseBranches,
  branchTemplate:
    project?.git?.branchTemplate ?? global?.git?.branchTemplate ?? defaultConfig.branchTemplate,
  issueTypeAliases:
    project?.git?.issueTypeAliases ??
    global?.git?.issueTypeAliases ??
    defaultConfig.issueTypeAliases,
  startTransitionStatus:
    project?.jira?.startTransitionStatus ??
    global?.jira?.startTransitionStatus ??
    defaultConfig.startTransitionStatus,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/config/Config.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/config/Config.ts apps/cli/tests/config/Config.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add MonoConfig schema and field-by-field merge

Pure schema + merge logic for the upcoming global + project mono config
files; no file I/O yet.
EOF
)"
```

---

## Task 4: `apps/cli/src/config/loadConfig.ts` — discovery, decode, merge

Finds the global config (`$XDG_CONFIG_HOME/mono/config.json`, falling back to `~/.config/mono/config.json`) and the project config (`mono.config.json`, walking up from `cwd` to the git repo root), decodes each against `MonoConfig`, and merges them via `mergeConfig` from Task 3.

**Files:**
- Modify: `apps/cli/package.json` (add `@mono/git` dependency)
- Create: `apps/cli/src/config/errors.ts`
- Create: `apps/cli/src/config/loadConfig.ts`
- Create: `apps/cli/tests/config/loadConfig.test.ts`

**Interfaces:**
- Consumes: `GitClient` (`repoRoot`) from Task 2; `MonoConfig`, `mergeConfig`, `ResolvedConfig` from Task 3.
- Produces: `ConfigError` (`{ filePath: string; message: string }`); `findProjectConfigPath(cwd: string): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path | GitClient>`; `loadConfig: Effect.Effect<ResolvedConfig, ConfigError, FileSystem.FileSystem | Path.Path | GitClient>` — both consumed by Task 7 (`start.ts` uses `loadConfig`).

- [ ] **Step 1: Add the `@mono/git` dependency**

Edit `apps/cli/package.json` — add `"@mono/git": "workspace:*"` next to the existing `"@mono/jira"` dependency:

```json
{
  "name": "@mono/cli",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "start": "bun src/index.ts",
    "build": "bun build --compile src/index.ts --outfile dist/cli",
    "lint": "biome check",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "catalog:effect",
    "@effect/platform-bun": "catalog:effect",
    "@mono/git": "workspace:*",
    "@mono/jira": "workspace:*"
  }
}
```

Run: `bun install` (from repo root)
Expected: completes without error

- [ ] **Step 2: Write the failing tests**

Create `apps/cli/tests/config/loadConfig.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GitClient } from "@mono/git";
import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun";
import { Effect, Layer, Option } from "effect";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectConfigPath, loadConfig } from "../../src/config/loadConfig.ts";

const testLayer = Layer.mergeAll(
  BunFileSystem.layer,
  BunPath.layer,
  GitClient.layer.pipe(Layer.provide(BunChildProcessSpawner.layer)),
);

let repoDir: string;
let originalCwd: string;
let originalXdgConfigHome: string | undefined;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-config-test-"));
  await Bun.$`git init -q -b main`.cwd(repoDir).quiet();
  originalCwd = process.cwd();
  originalXdgConfigHome = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = mkdtempSync(join(tmpdir(), "mono-xdg-test-"));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repoDir, { recursive: true, force: true });
  if (originalXdgConfigHome === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = originalXdgConfigHome;
  }
});

describe("findProjectConfigPath", () => {
  test("finds mono.config.json in the cwd", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{}");
    process.chdir(repoDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(repoDir).pipe(Effect.provide(testLayer)),
    );

    expect(Option.isSome(result)).toBe(true);
  });

  test("finds it when invoked from a subdirectory (walks up)", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{}");
    const subDir = join(repoDir, "apps", "frontend");
    mkdirSync(subDir, { recursive: true });
    process.chdir(subDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(subDir).pipe(Effect.provide(testLayer)),
    );

    expect(Option.isSome(result)).toBe(true);
  });

  test("returns None when no config file exists up to the repo root", async () => {
    process.chdir(repoDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(repoDir).pipe(Effect.provide(testLayer)),
    );

    expect(Option.isNone(result)).toBe(true);
  });
});

describe("loadConfig", () => {
  test("returns defaults when neither global nor project config exist", async () => {
    process.chdir(repoDir);

    const config = await Effect.runPromise(loadConfig.pipe(Effect.provide(testLayer)));

    expect(config.branchTemplate).toBe("{key}-{slug}");
    expect(config.baseBranches).toEqual([]);
    expect(config.startTransitionStatus).toBeUndefined();
  });

  test("project config overrides global config field by field", async () => {
    const globalDir = join(process.env["XDG_CONFIG_HOME"]!, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ git: { baseBranches: ["main", "develop"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ jira: { startTransitionStatus: "In Progress" } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(loadConfig.pipe(Effect.provide(testLayer)));

    expect(config.baseBranches).toEqual(["main", "develop"]);
    expect(config.startTransitionStatus).toBe("In Progress");
  });

  test("project's field wins outright over global's on conflict", async () => {
    const globalDir = join(process.env["XDG_CONFIG_HOME"]!, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ git: { baseBranches: ["main"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ git: { baseBranches: ["develop"] } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(loadConfig.pipe(Effect.provide(testLayer)));

    expect(config.baseBranches).toEqual(["develop"]);
  });

  test("fails clearly on invalid JSON in the project config", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{ not valid json");
    process.chdir(repoDir);

    const failure = await Effect.runPromise(
      loadConfig.pipe(Effect.flip, Effect.provide(testLayer)),
    );

    expect(failure._tag).toBe("ConfigError");
    expect(failure.filePath).toContain("mono.config.json");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/cli && bun test tests/config/loadConfig.test.ts`
Expected: FAIL — `../../src/config/loadConfig.ts` does not exist.

- [ ] **Step 4: Implement `errors.ts` and `loadConfig.ts`**

Create `apps/cli/src/config/errors.ts`:

```ts
import { Schema } from "effect";
import * as Runtime from "effect/Runtime";

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()(
  "ConfigError",
  { filePath: Schema.String, message: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
}
```

Create `apps/cli/src/config/loadConfig.ts`:

```ts
import { GitClient } from "@mono/git";
import { homedir } from "node:os";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { mergeConfig, MonoConfig, type ResolvedConfig } from "./Config.ts";
import { ConfigError } from "./errors.ts";

const readAndDecode = (
  fs: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<MonoConfig | undefined, ConfigError> =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return undefined;

    const content = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(() => new ConfigError({ filePath, message: "failed to read file" })),
    );

    const json = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: () => new ConfigError({ filePath, message: "invalid JSON" }),
    });

    return yield* Schema.decodeUnknownEffect(MonoConfig)(json).pipe(
      Effect.mapError((error) => new ConfigError({ filePath, message: String(error) })),
    );
  });

const globalConfigPath = (path: Path.Path): string => {
  const configHome = process.env["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config");
  return path.join(configHome, "mono", "config.json");
};

export const findProjectConfigPath = (
  cwd: string,
): Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | Path.Path | GitClient
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitClient;

    const repoRoot = yield* git.repoRoot.pipe(Effect.option);
    const boundary = Option.getOrElse(repoRoot, () => cwd);

    let dir = cwd;
    while (true) {
      const candidate = path.join(dir, "mono.config.json");
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (exists) return Option.some(candidate);
      if (dir === boundary) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return Option.none();
  });

export const loadConfig: Effect.Effect<
  ResolvedConfig,
  ConfigError,
  FileSystem.FileSystem | Path.Path | GitClient
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const global = yield* readAndDecode(fs, globalConfigPath(path));

  const projectPath = yield* findProjectConfigPath(process.cwd());
  const project = yield* Option.match(projectPath, {
    onNone: () => Effect.succeed(undefined),
    onSome: (filePath) => readAndDecode(fs, filePath),
  });

  return mergeConfig(global, project);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/cli && bun test tests/config/loadConfig.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/cli/package.json apps/cli/src/config/errors.ts apps/cli/src/config/loadConfig.ts apps/cli/tests/config/loadConfig.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add loadConfig — global + project config discovery and merge

Finds ~/.config/mono/config.json and mono.config.json (walking up to the
git repo root), decodes each, and merges them via Config.mergeConfig.
EOF
)"
```

---

## Task 5: `mono-cli config schema` command

Generates a JSON Schema from `MonoConfig` and writes it to `<repoRoot>/.mono/schema.json`, so editors can offer autocompletion via `mono.config.json`'s `$schema` field.

**Files:**
- Create: `apps/cli/src/config/schema.ts`
- Create: `apps/cli/src/config/command.ts`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/tests/config/schema.test.ts`

**Interfaces:**
- Consumes: `GitClient` from Task 2; `MonoConfig` from Task 3.
- Produces: `configCommand` (wired into the root CLI in `index.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/cli/tests/config/schema.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { MonoConfig } from "../../src/config/Config.ts";

describe("MonoConfig JSON Schema", () => {
  test("generates an object schema with git and jira properties", () => {
    const doc = Schema.toJsonSchemaDocument(MonoConfig, { additionalProperties: true });
    expect(doc.schema["type"]).toBe("object");
    const properties = doc.schema["properties"] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["git", "jira", "$schema"]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/config/schema.test.ts`
Expected: FAIL only if `Schema.toJsonSchemaDocument` or the property shape doesn't match — run it to confirm the current baseline before adding the command (this test only exercises `Config.ts`, already implemented in Task 3, so it should already PASS; if it passes, skip to Step 3 without changes — this step exists to lock in the JSON Schema shape used by the command below before wiring the CLI command around it).

- [ ] **Step 3: Implement `schema.ts` and `command.ts`**

Create `apps/cli/src/config/schema.ts`:

```ts
import { GitClient } from "@mono/git";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { MonoConfig } from "./Config.ts";

export const schemaCommand = Command.make("schema", {}, () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitClient;

    const repoRoot = yield* git.repoRoot;
    const doc = Schema.toJsonSchemaDocument(MonoConfig, { additionalProperties: true });

    const outDir = path.join(repoRoot, ".mono");
    yield* fs.makeDirectory(outDir, { recursive: true });

    const outPath = path.join(outDir, "schema.json");
    yield* fs.writeFileString(outPath, JSON.stringify(doc.schema, null, 2));

    yield* Console.log(`Wrote ${outPath}`);
  }).pipe(
    Effect.catchTag("GitCommandError", (e) =>
      Console.error(`Not a git repository: ${e.stderr}`).pipe(
        Effect.andThen(Effect.fail(e)),
      ),
    ),
    Effect.provide(GitClient.layer),
  ),
).pipe(Command.withDescription("Generate a JSON Schema for mono.config.json"));
```

Create `apps/cli/src/config/command.ts`:

```ts
import { Command } from "effect/unstable/cli";
import { schemaCommand } from "./schema.ts";

export const configCommand = Command.make("config").pipe(
  Command.withDescription("mono.config.json helpers"),
  Command.withSubcommands([schemaCommand]),
);
```

Edit `apps/cli/src/index.ts`:

```ts
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { configCommand } from "./config/command.ts";
import { jiraCommand } from "./jira/command.ts";

const name = Argument.string("name").pipe(Argument.withDefault("World"));
const shout = Flag.boolean("shout").pipe(Flag.withAlias("s"));

const greet = Command.make("greet", { name, shout }, ({ name, shout }) => {
  const message = `Hello, ${name}!`;
  return Console.log(shout ? message.toUpperCase() : message);
});

const cli = Command.make("mono-cli", {}).pipe(
  Command.withDescription("mono CLI"),
  Command.withSubcommands([greet, jiraCommand, configCommand]),
);

const program = Command.run(cli, {
  version: "0.0.1",
});

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && bun test tests/config/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Manual verification**

Run: `cd apps/cli && bun run src/index.ts config schema`
Expected: prints `Wrote <repo-root>/.mono/schema.json`; inspect that the file was created and contains a JSON Schema object with `properties.git`, `properties.jira`.

Clean up the manually-generated file so it doesn't get committed by accident:
Run: `rm -rf /Users/jakubprill/Projects/jakubprill/mono/.mono`

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/config/schema.ts apps/cli/src/config/command.ts apps/cli/src/index.ts apps/cli/tests/config/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add mono-cli config schema command

Generates .mono/schema.json from MonoConfig so editors can offer
autocompletion via mono.config.json's $schema field.
EOF
)"
```

---

## Task 6: `apps/cli/src/work/branchName.ts` — pure branch-name helpers

Pure string helpers used by `work start` (Task 7) to turn a Jira issue + config into a branch name: slugify the summary, resolve the `{type}` alias, and render the template.

**Files:**
- Create: `apps/cli/src/work/branchName.ts`
- Create: `apps/cli/tests/work/branchName.test.ts`

**Interfaces:**
- Produces: `slugify(input: string): string`, `renderBranchName(template: string, parts: { type: string; key: string; slug: string }): string`, `resolveBranchType(issueType: string, aliases: Readonly<Record<string, string>>): string` — all consumed by Task 7's `startWork`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/tests/work/branchName.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  renderBranchName,
  resolveBranchType,
  slugify,
} from "../../src/work/branchName.ts";

describe("slugify", () => {
  test("lowercases and hyphenates non-alphanumeric runs", () => {
    expect(slugify("Fix Login Redirect Loop!")).toBe("fix-login-redirect-loop");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("  Weird Spacing  ")).toBe("weird-spacing");
  });
});

describe("renderBranchName", () => {
  test("substitutes type, key, and slug placeholders", () => {
    const name = renderBranchName("{type}/{key}-{slug}", {
      type: "bugfix",
      key: "PROJ-123",
      slug: "fix-login",
    });
    expect(name).toBe("bugfix/PROJ-123-fix-login");
  });

  test("supports a template with no {type} placeholder", () => {
    const name = renderBranchName("{key}-{slug}", {
      type: "bugfix",
      key: "PROJ-123",
      slug: "fix-login",
    });
    expect(name).toBe("PROJ-123-fix-login");
  });
});

describe("resolveBranchType", () => {
  test("uses the alias when configured", () => {
    expect(resolveBranchType("Bug", { Bug: "bugfix" })).toBe("bugfix");
  });

  test("falls back to the lowercased issue type when no alias matches", () => {
    expect(resolveBranchType("Story", {})).toBe("story");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/work/branchName.test.ts`
Expected: FAIL — `../../src/work/branchName.ts` does not exist.

- [ ] **Step 3: Implement `branchName.ts`**

Create `apps/cli/src/work/branchName.ts`:

```ts
export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export interface BranchNameParts {
  readonly type: string;
  readonly key: string;
  readonly slug: string;
}

export const renderBranchName = (template: string, parts: BranchNameParts): string =>
  template
    .replace("{type}", parts.type)
    .replace("{key}", parts.key)
    .replace("{slug}", parts.slug);

export const resolveBranchType = (
  issueType: string,
  aliases: Readonly<Record<string, string>>,
): string => aliases[issueType] ?? issueType.toLowerCase();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/work/branchName.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/work/branchName.ts apps/cli/tests/work/branchName.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add pure branch-name helpers for work start

slugify, renderBranchName, and resolveBranchType — no I/O, unit tested
in isolation ahead of the work start orchestration.
EOF
)"
```

---

## Task 7: `mono-cli work start <KEY>`

The orchestration command: fetch the Jira issue, pick a base branch (flag override, config-list prompt, or autodetected remote default), render the branch name, create it, and optionally transition the Jira issue.

**Files:**
- Create: `apps/cli/src/work/start.ts`
- Create: `apps/cli/src/work/command.ts`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/tests/work/start.test.ts`

**Interfaces:**
- Consumes: `GitClient` from Task 2; `JiraClient`, `Issue`, `Transition` from `@mono/jira`; `ResolvedConfig` from Task 3; `loadConfig` from Task 4; `slugify`, `renderBranchName`, `resolveBranchType` from Task 6; `jiraLayer`, `reportAndFail` from `apps/cli/src/jira/layer.ts` (existing).
- Produces: `startWork(key: string, sourceOverride: string | undefined, config: ResolvedConfig)` — the testable orchestration effect; `startCommand`, `workCommand` (wired into the root CLI in `index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/tests/work/start.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { GitClient } from "@mono/git";
import { Issue, JiraClient, Transition } from "@mono/jira";
import { Effect, Layer } from "effect";
import { defaultConfig } from "../../src/config/Config.ts";
import { startWork } from "../../src/work/start.ts";

const issue = new Issue({
  key: "PROJ-1",
  summary: "Fix login redirect loop!",
  status: "To Do",
  assignee: null,
  description: null,
  issueType: "Bug",
});

const fakeJira = (overrides: {
  transitions?: ReadonlyArray<Transition>;
  onTransition?: (key: string, transitionId: string) => void;
} = {}) =>
  Layer.succeed(JiraClient, {
    getIssue: () => Effect.succeed(issue),
    getTransitions: () => Effect.succeed(overrides.transitions ?? []),
    transitionIssue: (key: string, transitionId: string) =>
      Effect.sync(() => {
        overrides.onTransition?.(key, transitionId);
      }),
  });

const fakeGit = (overrides: {
  defaultRemoteBranch?: string;
  onCreateBranch?: (name: string, base: string) => void;
} = {}) =>
  Layer.succeed(GitClient, {
    repoRoot: Effect.succeed("/repo"),
    currentBranch: Effect.succeed("main"),
    defaultRemoteBranch: Effect.succeed(overrides.defaultRemoteBranch ?? "main"),
    createBranch: (name: string, base: string) =>
      Effect.sync(() => {
        overrides.onCreateBranch?.(name, base);
      }),
  });

describe("startWork", () => {
  test("uses --source directly, skipping the remote lookup", async () => {
    const created: Array<[string, string]> = [];
    const result = await Effect.runPromise(
      startWork("PROJ-1", "develop", defaultConfig).pipe(
        Effect.provide(fakeJira()),
        Effect.provide(fakeGit({ onCreateBranch: (name, base) => created.push([name, base]) })),
      ),
    );
    expect(created).toEqual([["PROJ-1-fix-login-redirect-loop", "develop"]]);
    expect(result).toBe("Created PROJ-1-fix-login-redirect-loop from develop");
  });

  test("falls back to the autodetected remote default branch with no config", async () => {
    const created: Array<[string, string]> = [];
    const result = await Effect.runPromise(
      startWork("PROJ-1", undefined, defaultConfig).pipe(
        Effect.provide(fakeJira()),
        Effect.provide(
          fakeGit({
            defaultRemoteBranch: "main",
            onCreateBranch: (name, base) => created.push([name, base]),
          }),
        ),
      ),
    );
    expect(created).toEqual([["PROJ-1-fix-login-redirect-loop", "main"]]);
    expect(result).toBe("Created PROJ-1-fix-login-redirect-loop from main");
  });

  test("transitions the issue when a matching status is configured", async () => {
    const transitioned: Array<[string, string]> = [];
    const config = { ...defaultConfig, startTransitionStatus: "In Progress" };
    const transitions = [
      new Transition({ id: "21", name: "Start Progress", toStatus: "In Progress" }),
    ];

    const result = await Effect.runPromise(
      startWork("PROJ-1", "develop", config).pipe(
        Effect.provide(
          fakeJira({
            transitions,
            onTransition: (key, transitionId) => transitioned.push([key, transitionId]),
          }),
        ),
        Effect.provide(fakeGit()),
      ),
    );

    expect(transitioned).toEqual([["PROJ-1", "21"]]);
    expect(result).toBe(
      "Created PROJ-1-fix-login-redirect-loop from develop, PROJ-1 → In Progress",
    );
  });

  test("still creates the branch when no transition matches the configured status", async () => {
    const config = { ...defaultConfig, startTransitionStatus: "In Progress" };

    const result = await Effect.runPromise(
      startWork("PROJ-1", "develop", config).pipe(
        Effect.provide(fakeJira({ transitions: [] })),
        Effect.provide(fakeGit()),
      ),
    );

    expect(result).toBe("Created PROJ-1-fix-login-redirect-loop from develop");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/cli && bun test tests/work/start.test.ts`
Expected: FAIL — `../../src/work/start.ts` does not exist.

- [ ] **Step 3: Implement `start.ts` and `command.ts`**

Create `apps/cli/src/work/start.ts`:

```ts
import { GitClient } from "@mono/git";
import { JiraClient } from "@mono/jira";
import { Console, Effect } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import type { ResolvedConfig } from "../config/Config.ts";
import { loadConfig } from "../config/loadConfig.ts";
import { jiraLayer, reportAndFail } from "../jira/layer.ts";
import { renderBranchName, resolveBranchType, slugify } from "./branchName.ts";

export const startWork = (
  key: string,
  sourceOverride: string | undefined,
  config: ResolvedConfig,
) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient;
    const git = yield* GitClient;

    const issue = yield* jira.getIssue(key);

    const base = sourceOverride
      ? sourceOverride
      : config.baseBranches.length > 0
        ? yield* Prompt.run(
            Prompt.select({
              message: "Base branch:",
              choices: config.baseBranches.map((branch) => ({
                title: branch,
                value: branch,
              })),
            }),
          )
        : yield* git.defaultRemoteBranch;

    const branchName = renderBranchName(config.branchTemplate, {
      type: resolveBranchType(issue.issueType, config.issueTypeAliases),
      key,
      slug: slugify(issue.summary),
    });

    yield* git.createBranch(branchName, base);

    if (config.startTransitionStatus === undefined) {
      return `Created ${branchName} from ${base}`;
    }

    const transitions = yield* jira.getTransitions(key);
    const target = transitions.find((t) => t.toStatus === config.startTransitionStatus);

    if (target === undefined) {
      const available = transitions.map((t) => t.toStatus).join(", ") || "none";
      yield* Console.error(
        `No transition to "${config.startTransitionStatus}" for ${key}. Available: ${available}`,
      );
      return `Created ${branchName} from ${base}`;
    }

    yield* jira.transitionIssue(key, target.id);
    return `Created ${branchName} from ${base}, ${key} → ${target.toStatus}`;
  });

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

const source = Flag.string("source").pipe(
  Flag.withAlias("s"),
  Flag.optional,
  Flag.withDescription("Base branch to create from (skips the prompt)"),
);

export const startCommand = Command.make("start", { key, source }, ({ key, source }) =>
  Effect.gen(function* () {
    const config = yield* loadConfig;
    const message = yield* startWork(key, source, config);
    yield* Console.log(message);
  }).pipe(
    Effect.catchTag("QuitError", () => Console.log("Cancelled.")),
    Effect.catchTag("IssueNotFoundError", (e) =>
      reportAndFail(`Issue not found: ${e.key}`, e),
    ),
    Effect.catchTag("JiraAuthError", (e) =>
      reportAndFail("Auth error — check JIRA_BASE_URL and JIRA_TOKEN", e),
    ),
    Effect.catchTag("JiraHttpError", (e) =>
      reportAndFail(`Jira request failed: ${String(e.error)}`, e),
    ),
    Effect.catchTag("GitCommandError", (e) =>
      Console.error(`git failed: ${e.command}\n${e.stderr}`).pipe(
        Effect.andThen(Effect.fail(e)),
      ),
    ),
    Effect.catchTag("ConfigError", (e) =>
      Console.error(`Invalid config (${e.filePath}): ${e.message}`).pipe(
        Effect.andThen(Effect.fail(e)),
      ),
    ),
    Effect.provide(jiraLayer),
    Effect.provide(GitClient.layer),
  ),
).pipe(
  Command.withDescription(
    "Start work on a Jira issue: create a branch and transition its status",
  ),
);
```

Create `apps/cli/src/work/command.ts`:

```ts
import { Command } from "effect/unstable/cli";
import { startCommand } from "./start.ts";

export const workCommand = Command.make("work").pipe(
  Command.withDescription("Work orchestration across git and Jira"),
  Command.withSubcommands([startCommand]),
);
```

Edit `apps/cli/src/index.ts`:

```ts
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { configCommand } from "./config/command.ts";
import { jiraCommand } from "./jira/command.ts";
import { workCommand } from "./work/command.ts";

const name = Argument.string("name").pipe(Argument.withDefault("World"));
const shout = Flag.boolean("shout").pipe(Flag.withAlias("s"));

const greet = Command.make("greet", { name, shout }, ({ name, shout }) => {
  const message = `Hello, ${name}!`;
  return Console.log(shout ? message.toUpperCase() : message);
});

const cli = Command.make("mono-cli", {}).pipe(
  Command.withDescription("mono CLI"),
  Command.withSubcommands([greet, jiraCommand, configCommand, workCommand]),
);

const program = Command.run(cli, {
  version: "0.0.1",
});

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && bun test tests/work/start.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite**

Run: `bun run test` (from repo root)
Expected: PASS across `packages/jira`, `packages/git`, `apps/cli`

- [ ] **Step 6: Manual verification**

Note: the interactive base-branch prompt path (when `config.baseBranches` is non-empty and `--source` is omitted) isn't practically unit-testable through the CLI harness — same as the existing `jira issue move` picker (see `docs/superpowers/specs/2026-07-04-jira-issue-move-design.md`). Verify it manually:

Run: `cd apps/cli && bun run src/index.ts work start --help`
Expected: shows `start <key> [--source|-s <text>]` usage.

If you have `JIRA_BASE_URL`/`JIRA_TOKEN` set for a real (or test) Jira instance, run `bun run src/index.ts work start <a real key>` once with a `mono.config.json` containing a non-empty `git.baseBranches` list to see the interactive picker, and once with `--source <branch>` to confirm it skips the prompt.

- [ ] **Step 7: Typecheck and lint**

Run: `bun run typecheck && bun run lint` (from repo root)
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/work/start.ts apps/cli/src/work/command.ts apps/cli/src/index.ts apps/cli/tests/work/start.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add mono-cli work start command

Fetches the Jira issue, resolves the base branch (--source flag, config
prompt, or autodetected remote default), creates the branch from the
configured template, and transitions the issue if configured to.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** `work start <KEY>` (Task 7), global + project config with project-wins merge (Tasks 3–4), `$XDG_CONFIG_HOME`/`~/.config/mono` global path and `mono.config.json` walk-up discovery (Task 4), `mono-cli config schema` (Task 5), `@mono/git` (Task 2) — all covered. `work commit`/`@mono/ai`/`mcp`/MR/worktree/import-linter are explicitly out of scope and untouched.
- **Placeholder scan:** no TBD/TODO; the one deliberately-skipped test path (interactive prompt) is called out explicitly with a named reason and a manual-verification substitute, consistent with the precedent already in this repo's `jira issue move` design.
- **Type consistency:** `GitClient`'s four members and `GitCommandError`'s two fields are used identically in Tasks 2, 4, 5, and 7. `ResolvedConfig`'s four fields (`baseBranches`, `branchTemplate`, `issueTypeAliases`, `startTransitionStatus`) are defined once in Task 3 and consumed identically in Tasks 4 and 7. `startWork`'s three positional parameters (`key`, `sourceOverride`, `config`) match every call site in Task 7's tests and in `startCommand`.
