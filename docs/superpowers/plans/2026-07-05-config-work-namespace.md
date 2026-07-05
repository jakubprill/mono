# mono-cli Config `work` Namespace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `mono.config.json`'s `git`/`jira` namespaces with a single flat `work` namespace, and rename its four fields to names that describe what they do.

**Architecture:** `MonoConfig` (the Effect `Schema.Class` decoded from JSON) currently has `git: GitConfig` and `jira: JiraWorkConfig`. Both classes collapse into one `WorkConfig` class under `MonoConfig.work`. `ResolvedConfig` (the merged, defaulted shape consumed by `work start`) gets the same renamed fields, so the naming is consistent from JSON all the way to the consumer — no translation layer at either boundary.

**Tech Stack:** Effect `Schema.Class` for config decoding, `bun:test` for tests.

## Global Constraints

- Pure reshape/rename — no new fields, no new behavior.
- No backwards-compatibility shim for the old `git`/`jira` shape. Old config files silently lose those fields (decoded as absent) rather than erroring or migrating — this is acceptable per the spec since mono-cli has no external users yet.
- Structure is flat under `work` (no further nesting by sub-topic).
- Exact renames (spec-approved, do not deviate):
  - `git.baseBranches` → `work.sourceBranches`
  - `git.branchTemplate` → `work.branchPattern`
  - `git.issueTypeAliases` → `work.branchTypeAliases`
  - `jira.startTransitionStatus` → `work.startStatus`
- `ResolvedConfig`/`defaultConfig` field names in code are renamed to match (not just the JSON schema).

---

## File Structure

- Modify: `apps/cli/src/config/Config.ts` — `WorkConfig` class replaces `GitConfig`/`JiraWorkConfig`; `MonoConfig.work` replaces `.git`/`.jira`; `ResolvedConfig`/`defaultConfig`/`mergeConfig` renamed.
- Modify: `apps/cli/src/work/start.ts` — field references updated to new `ResolvedConfig` names.
- Modify: `apps/cli/tests/config/Config.test.ts` — decode/merge tests against the new shape.
- Modify: `apps/cli/tests/work/start.test.ts` — fixtures use new `ResolvedConfig` field names.
- Modify: `apps/cli/tests/config/schema.test.ts` — expects `work`/`WorkConfig` instead of `git`/`jira`/`GitConfig`/`JiraWorkConfig`.
- Modify: `apps/cli/tests/config/loadConfig.test.ts` — JSON fixtures and assertions use the new shape.
- Modify: `apps/cli/README.md` — Configuration section documents the new shape.

No files are created or deleted. `apps/cli/src/config/schema.ts` and `apps/cli/src/config/command.ts` are untouched — the JSON Schema is derived from `MonoConfig` automatically.

---

### Task 1: Rename `Config.ts` and its consumer `work/start.ts`

These two `src/` files must change together: `tsc` typechecks all of `src/` (see `apps/cli/tsconfig.json`'s `"include": ["src"]`), and the repo's pre-commit hook (`lefthook.yml`) runs `bun run typecheck` — so a commit that renames `ResolvedConfig` fields without updating `start.ts` would fail to commit. Their tests are updated in the same task so `bun test` is green at the end.

**Files:**
- Modify: `apps/cli/src/config/Config.ts`
- Modify: `apps/cli/src/work/start.ts`
- Test: `apps/cli/tests/config/Config.test.ts`
- Test: `apps/cli/tests/work/start.test.ts`

**Interfaces:**
- Produces: `WorkConfig` (new `Schema.Class`, replaces `GitConfig`/`JiraWorkConfig`) with fields `sourceBranches?: ReadonlyArray<string>`, `branchPattern?: string`, `branchTypeAliases?: Readonly<Record<string, string>>`, `startStatus?: string`.
- Produces: `MonoConfig` with `$schema?: string` and `work?: WorkConfig` (replaces `git`/`jira`).
- Produces: `ResolvedConfig` interface with `sourceBranches: ReadonlyArray<string>`, `branchPattern: string`, `branchTypeAliases: Readonly<Record<string, string>>`, `startStatus: string | undefined` (replaces `baseBranches`/`branchTemplate`/`issueTypeAliases`/`startTransitionStatus`).
- Produces: `defaultConfig: ResolvedConfig` and `mergeConfig(global, project): ResolvedConfig`, same signatures as today, reading from `work` instead of `git`/`jira`.
- Consumes (in `start.ts`): the renamed `ResolvedConfig` fields above.

- [ ] **Step 1: Update `Config.test.ts` to assert the new shape**

Replace the full contents of `apps/cli/tests/config/Config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  defaultConfig,
  MonoConfig,
  mergeConfig,
} from "../../src/config/Config.ts";

const decode = (json: unknown) => Schema.decodeUnknownSync(MonoConfig)(json);

describe("MonoConfig", () => {
  test("decodes an empty object to all-optional-absent", () => {
    const config = decode({});
    expect(config.work).toBeUndefined();
  });

  test("decodes a fully-populated config", () => {
    const config = decode({
      work: {
        sourceBranches: ["main", "develop"],
        branchPattern: "{type}/{key}-{slug}",
        branchTypeAliases: { Bug: "bugfix" },
        startStatus: "In Progress",
      },
    });
    expect(config.work?.sourceBranches).toEqual(["main", "develop"]);
    expect(config.work?.branchPattern).toBe("{type}/{key}-{slug}");
    expect(config.work?.branchTypeAliases).toEqual({ Bug: "bugfix" });
    expect(config.work?.startStatus).toBe("In Progress");
  });

  test("ignores the $schema field", () => {
    const config = decode({ $schema: "./.mono/schema.json" });
    expect(config.work).toBeUndefined();
  });
});

describe("mergeConfig", () => {
  test("returns defaults when both are undefined", () => {
    expect(mergeConfig(undefined, undefined)).toEqual(defaultConfig);
  });

  test("project field wins over global on the same field", () => {
    const global = decode({ work: { sourceBranches: ["main"] } });
    const project = decode({ work: { sourceBranches: ["develop"] } });
    expect(mergeConfig(global, project).sourceBranches).toEqual(["develop"]);
  });

  test("non-conflicting fields from both global and project apply", () => {
    const global = decode({ work: { sourceBranches: ["main"] } });
    const project = decode({ work: { startStatus: "In Progress" } });
    const merged = mergeConfig(global, project);
    expect(merged.sourceBranches).toEqual(["main"]);
    expect(merged.startStatus).toBe("In Progress");
  });

  test("falls back to defaultConfig.branchPattern when neither sets it", () => {
    const project = decode({ work: { startStatus: "Done" } });
    expect(mergeConfig(undefined, project).branchPattern).toBe(
      defaultConfig.branchPattern,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/cli && bun test tests/config/Config.test.ts`
Expected: FAIL — `config.work` is `undefined` in the "fully-populated config" test (current `MonoConfig` has no `work` field yet, so the `work: {...}` input is decoded away as an excess property), and other assertions on `.sourceBranches`/`.branchPattern`/`.startStatus` fail similarly.

- [ ] **Step 3: Rewrite `Config.ts`**

Replace the full contents of `apps/cli/src/config/Config.ts`:

```ts
import { Schema } from "effect";

export class WorkConfig extends Schema.Class<WorkConfig>("WorkConfig")({
  sourceBranches: Schema.optional(Schema.Array(Schema.String)),
  branchPattern: Schema.optional(Schema.String),
  branchTypeAliases: Schema.optional(
    Schema.Record(Schema.String, Schema.String),
  ),
  startStatus: Schema.optional(Schema.String),
}) {}

export class MonoConfig extends Schema.Class<MonoConfig>("MonoConfig")({
  $schema: Schema.optional(Schema.String),
  work: Schema.optional(WorkConfig),
}) {}

export interface ResolvedConfig {
  readonly sourceBranches: ReadonlyArray<string>;
  readonly branchPattern: string;
  readonly branchTypeAliases: Readonly<Record<string, string>>;
  readonly startStatus: string | undefined;
}

export const defaultConfig: ResolvedConfig = {
  sourceBranches: [],
  branchPattern: "{key}-{slug}",
  branchTypeAliases: {},
  startStatus: undefined,
};

export const mergeConfig = (
  global: MonoConfig | undefined,
  project: MonoConfig | undefined,
): ResolvedConfig => ({
  sourceBranches:
    project?.work?.sourceBranches ??
    global?.work?.sourceBranches ??
    defaultConfig.sourceBranches,
  branchPattern:
    project?.work?.branchPattern ??
    global?.work?.branchPattern ??
    defaultConfig.branchPattern,
  branchTypeAliases:
    project?.work?.branchTypeAliases ??
    global?.work?.branchTypeAliases ??
    defaultConfig.branchTypeAliases,
  startStatus:
    project?.work?.startStatus ??
    global?.work?.startStatus ??
    defaultConfig.startStatus,
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/cli && bun test tests/config/Config.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Update `start.test.ts` to use the renamed `ResolvedConfig` fields**

In `apps/cli/tests/work/start.test.ts`, apply these replacements:

1. The test titled `"prompts for a base branch when config.baseBranches is non-empty, ..."` — rename the title and its config object:

```ts
  test("prompts for a base branch when config.sourceBranches is non-empty, and creates the branch from the selected choice", async () => {
    const created: Array<[string, string]> = [];
    const config = {
      ...defaultConfig,
      sourceBranches: ["main", "develop", "staging"],
    };
```

2. Both occurrences of `{ ...defaultConfig, startTransitionStatus: "In Progress" }` become:

```ts
    const config = { ...defaultConfig, startStatus: "In Progress" };
```

(These appear in the `"transitions the issue when a matching status is configured"` test and the `"still creates the branch when no transition matches the configured status"` test.)

No other lines in this file change — `defaultConfig` import, `startWork` calls, and all assertions are unaffected since they don't reference the renamed fields by name.

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/cli && bun test tests/work/start.test.ts`
Expected: FAIL to compile/run cleanly — `defaultConfig` no longer has a `baseBranches`/`startTransitionStatus` field for `start.ts` to read (it now has `sourceBranches`/`startStatus`), so `startWork` won't prompt or transition as the test expects. (If Bun's transpiler doesn't hard-error on the now-removed property access in `start.ts`, the observable symptom is the relevant assertions failing — e.g., the prompt-related test creating a branch from the autodetected default branch instead of the selected one, since `config.sourceBranches` in the new test fixture is invisible to old `start.ts` code still reading `config.baseBranches`.)

- [ ] **Step 7: Update `start.ts` field references**

In `apps/cli/src/work/start.ts`, apply these replacements inside `startWork`:

```ts
    const base = sourceOverride
      ? sourceOverride
      : config.sourceBranches.length > 0
        ? yield* Prompt.run(
            Prompt.select({
              message: "Base branch:",
              choices: config.sourceBranches.map((branch) => ({
                title: branch,
                value: branch,
              })),
            }),
          )
        : yield* git.defaultRemoteBranch;

    const branchName = renderBranchName(config.branchPattern, {
      type: resolveBranchType(issue.issueType, config.branchTypeAliases),
      key,
      slug: slugify(issue.summary),
    });

    yield* git.createBranch(branchName, base);

    if (config.startStatus === undefined) {
      return `Created ${branchName} from ${base}`;
    }

    const transitions = yield* jira.getTransitions(key);
    const target = transitions.find(
      (t) => t.toStatus === config.startStatus,
    );

    if (target === undefined) {
      const available = transitions.map((t) => t.toStatus).join(", ") || "none";
      yield* Console.error(
        `No transition to "${config.startStatus}" for ${key}. Available: ${available}`,
      );
      return `Created ${branchName} from ${base}`;
    }
```

Everything else in the file (imports, `key`/`source` argument/flag definitions, `startCommand`, error handling) is unchanged.

- [ ] **Step 8: Run both test files and the typecheck to verify everything passes**

Run: `cd apps/cli && bun test tests/config/Config.test.ts tests/work/start.test.ts`
Expected: PASS (all tests green).

Run: `bun run typecheck` (from repo root, or `cd apps/cli && bun run typecheck`)
Expected: no errors from `@mono/cli`.

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/config/Config.ts apps/cli/src/work/start.ts apps/cli/tests/config/Config.test.ts apps/cli/tests/work/start.test.ts
git commit -m "refactor(cli): rename config git/jira namespaces to work"
```

---

### Task 2: Update `schema.test.ts` for the new `WorkConfig` definition

`apps/cli/src/config/schema.ts` itself needs no change — `Schema.toJsonSchemaDocument(MonoConfig, ...)` picks up `WorkConfig` automatically now that `Config.ts` is renamed (Task 1). This task only updates the test's expectations.

**Files:**
- Test: `apps/cli/tests/config/schema.test.ts`

**Interfaces:**
- Consumes: `MonoConfig` from `../../src/config/Config.ts` (renamed in Task 1), `toWritableSchema` from `../../src/config/schema.ts` (unchanged).

- [ ] **Step 1: Run the test to verify it currently fails**

Run: `cd apps/cli && bun test tests/config/schema.test.ts`
Expected: FAIL — `Object.keys(properties)` no longer contains `"git"`/`"jira"` (now `"work"`/`"$schema"`), and `defs.GitConfig`/`defs.JiraWorkConfig` are `undefined` (now `defs.WorkConfig`), since Task 1 already renamed `Config.ts`.

- [ ] **Step 2: Update the test's expectations**

Replace the full contents of `apps/cli/tests/config/schema.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { MonoConfig } from "../../src/config/Config.ts";
import { toWritableSchema } from "../../src/config/schema.ts";

/** Collects every `$ref` string found anywhere within a JSON value. */
const collectRefs = (
  value: unknown,
  refs: Array<string> = [],
): Array<string> => {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (key === "$ref" && typeof val === "string") {
        refs.push(val);
      } else {
        collectRefs(val, refs);
      }
    }
  }
  return refs;
};

describe("MonoConfig JSON Schema", () => {
  test("generates an object schema with a work property", () => {
    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });
    const monoConfigDef = doc.definitions.MonoConfig as Record<string, unknown>;
    expect(monoConfigDef.type).toBe("object");
    const properties = monoConfigDef.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["work", "$schema"]),
    );
  });

  test("toWritableSchema produces a self-resolving schema with $defs", () => {
    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });
    const written = toWritableSchema(doc);

    expect(written.$defs).toBeDefined();
    const defs = written.$defs as Record<string, unknown>;
    expect(defs.MonoConfig).toBeDefined();
    expect(defs.WorkConfig).toBeDefined();

    // Every $ref found in the written document must resolve to an entry
    // under its own $defs (refs are of the form "#/$defs/<name>").
    const refs = collectRefs(written);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/$defs/")).toBe(true);
      const name = ref.slice("#/$defs/".length);
      expect(defs[name]).toBeDefined();
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd apps/cli && bun test tests/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/tests/config/schema.test.ts
git commit -m "test(cli): update schema test for WorkConfig rename"
```

---

### Task 3: Update `loadConfig.test.ts` fixtures for the new shape

`apps/cli/src/config/loadConfig.ts` needs no change — it only calls `Schema.decodeUnknownEffect(MonoConfig)` and `mergeConfig`, both generic over whatever fields `Config.ts` defines. This task only updates the test's JSON fixtures and assertions.

**Files:**
- Test: `apps/cli/tests/config/loadConfig.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `findProjectConfigPath` from `../../src/config/loadConfig.ts` (unchanged), producing a `ResolvedConfig` with the Task-1-renamed fields.

- [ ] **Step 1: Run the test to verify it currently fails**

Run: `cd apps/cli && bun test tests/config/loadConfig.test.ts`
Expected: FAIL — e.g. `config.branchTemplate`/`config.baseBranches`/`config.startTransitionStatus` are all `undefined` (property no longer exists on `ResolvedConfig`; the fixtures also write `git`/`jira` JSON keys, which the renamed `MonoConfig` schema now ignores as excess).

- [ ] **Step 2: Update the `describe("loadConfig", ...)` block**

In `apps/cli/tests/config/loadConfig.test.ts`, replace the entire `describe("loadConfig", ...)` block (lines 83–148 of the current file, including its opening/closing braces) with:

```ts
describe("loadConfig", () => {
  test("returns defaults when neither global nor project config exist", async () => {
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer())),
    );

    expect(config.branchPattern).toBe("{key}-{slug}");
    expect(config.sourceBranches).toEqual([]);
    expect(config.startStatus).toBeUndefined();
  });

  test("project config overrides global config field by field", async () => {
    const globalDir = join(xdgConfigHome, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ work: { sourceBranches: ["main", "develop"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ work: { startStatus: "In Progress" } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer())),
    );

    expect(config.sourceBranches).toEqual(["main", "develop"]);
    expect(config.startStatus).toBe("In Progress");
  });

  test("project's field wins outright over global's on conflict", async () => {
    const globalDir = join(xdgConfigHome, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ work: { sourceBranches: ["main"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ work: { sourceBranches: ["develop"] } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer())),
    );

    expect(config.sourceBranches).toEqual(["develop"]);
  });

  test("fails clearly on invalid JSON in the project config", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{ not valid json");
    process.chdir(repoDir);

    const failure = await Effect.runPromise(
      loadConfig.pipe(Effect.flip, Effect.provide(testLayer())),
    );

    expect(failure._tag).toBe("ConfigError");
    expect(failure.filePath).toContain("mono.config.json");
  });
});
```

(The `describe("findProjectConfigPath", ...)` block above it, and everything from the imports through `afterEach`, is unchanged.)

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd apps/cli && bun test tests/config/loadConfig.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/tests/config/loadConfig.test.ts
git commit -m "test(cli): update loadConfig fixtures for work namespace"
```

---

### Task 4: Update `README.md` documentation

**Files:**
- Modify: `apps/cli/README.md`

- [ ] **Step 1: Replace the Configuration section's example and bullet list**

In `apps/cli/README.md`, replace the JSON example (currently lines 28–40) with:

```json
{
  "$schema": "./.mono/schema.json",
  "work": {
    "sourceBranches": ["main", "develop"],
    "branchPattern": "{type}/{key}-{slug}",
    "branchTypeAliases": { "Bug": "fix", "Story": "feat" },
    "startStatus": "In Progress"
  }
}
```

And replace the bullet list below it (currently lines 42–51) with:

```markdown
- `work.sourceBranches` — if non-empty, `work start` prompts you to pick one
  instead of defaulting to the remote's default branch. Ignored when
  `--source`/`-s` is passed.
- `work.branchPattern` — placeholders: `{type}` (resolved via
  `branchTypeAliases`, falling back to the Jira issue type name),
  `{key}` (the Jira issue key), `{slug}` (slugified issue summary).
- `work.branchTypeAliases` — maps a Jira issue type name to the `{type}`
  token in `branchPattern`.
- `work.startStatus` — if set, `work start` transitions the issue to this
  status name after creating the branch (skipped with a warning if no
  matching transition exists).
```

Leave the rest of the file (the intro, Commands section, and the closing `mono-cli config schema` line) unchanged.

- [ ] **Step 2: Commit**

```bash
git add apps/cli/README.md
git commit -m "docs(cli): update README config example for work namespace"
```
