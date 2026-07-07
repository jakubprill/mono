# Jira Issue Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch a Jira Server/Data Center issue by key and print it, via a reusable `@mono/jira` package and a `mono jira show <key>` CLI command.

**Architecture:** `packages/jira` exposes an Effect `JiraClient` service (`getIssue(key)`) backed by `HttpClient.HttpClient` + a `JiraConfig` service reading `JIRA_BASE_URL`/`JIRA_API_TOKEN` from env. `apps/cli` wires those into a new `jira show` subcommand that renders the result as markdown (default) or JSON.

**Tech Stack:** Effect 4.0.0-beta.93 (`Context.Service`, `Layer`, `Schema`, `effect/unstable/cli`, `effect/unstable/http`), Bun, `@effect/vitest` for `packages/jira` tests, `bun:test` for the CLI's pure-function test.

## Global Constraints

- Effect version: `4.0.0-beta.93` for `effect`, `@effect/platform-bun`, `@effect/vitest` — always resolve via the `catalog:effect` protocol in `package.json`, never a hardcoded version.
- Jira API: Server/Data Center only, API v2 (`/rest/api/2/issue/{key}`), auth via `Authorization: Bearer <JIRA_API_TOKEN>` (Personal Access Token).
- Config: `JIRA_BASE_URL` and `JIRA_API_TOKEN` read from environment variables only (Bun auto-loads `.env`; no `dotenv` dependency, no config file, no CLI flags for credentials).
- Fields in scope: `key`, `summary`, `status`, `assignee` (nullable), `description` (nullable). No comments, no search/list, no write operations.
- CLI command shape: `mono jira show <key> [--format markdown|json]`, default format `markdown`.
- `packages/jira` has no dependency on `@effect/platform-bun` or Bun-specific APIs — it depends only on `effect`, so it stays runtime-agnostic.
- `packages/jira` tests use `@effect/vitest` (not `bun test`) — the one deviation from this repo's default test runner, required because testing `JiraClient.layer` needs to swap in a test `HttpClient`/`Config` layer, which is `@effect/vitest`'s standard idiom in this codebase.
- Follow existing repo conventions: Biome for lint/format (double quotes, organize imports), `tsc --noEmit` for typecheck, `bun run --filter` scripts, `Context.Service` classes named `@mono/<Name>`, layer constants named `layer`/`testLayer`.

---

### Task 1: Scaffold `packages/jira` and add domain errors

**Files:**
- Create: `packages/jira/package.json`
- Create: `packages/jira/tsconfig.json`
- Create: `packages/jira/vitest.config.ts`
- Create: `packages/jira/src/errors.ts`
- Test: `packages/jira/tests/errors.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `IssueNotFoundError`, `JiraAuthError`, `JiraHttpError` classes and the `JiraError` union type from `packages/jira/src/errors.ts`, each a `Schema.TaggedErrorClass`. Later tasks import these via `import { IssueNotFoundError, JiraAuthError, JiraHttpError, type JiraError } from "./errors.ts"` (relative) or `from "@mono/jira"` (from `apps/cli`).

- [ ] **Step 1: Create the package manifest**

`packages/jira/package.json`:

```json
{
  "name": "@mono/jira",
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
    "@effect/vitest": "catalog:effect",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`packages/jira/tsconfig.json`:

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

- [ ] **Step 3: Create the vitest config**

`packages/jira/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
})
```

- [ ] **Step 4: Install dependencies**

Run: `bun install`
Expected: lockfile updates, `node_modules/@mono/jira` symlink and `node_modules/vitest`, `node_modules/@effect/vitest` appear.

- [ ] **Step 5: Write the failing test for the error classes**

`packages/jira/tests/errors.test.ts`:

```typescript
import { describe, expect, test } from "@effect/vitest"
import { IssueNotFoundError, JiraAuthError, JiraHttpError } from "../src/errors.ts"

describe("errors", () => {
  test("IssueNotFoundError carries the issue key and its tag", () => {
    const error = new IssueNotFoundError({ key: "PROJ-123" })
    expect(error._tag).toBe("IssueNotFoundError")
    expect(error.key).toBe("PROJ-123")
  })

  test("JiraAuthError carries the HTTP status and its tag", () => {
    const error = new JiraAuthError({ status: 401 })
    expect(error._tag).toBe("JiraAuthError")
    expect(error.status).toBe(401)
  })

  test("JiraHttpError carries the issue key and wrapped error", () => {
    const cause = new Error("boom")
    const error = new JiraHttpError({ key: "PROJ-123", error: cause })
    expect(error._tag).toBe("JiraHttpError")
    expect(error.key).toBe("PROJ-123")
    expect(error.error).toBe(cause)
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd packages/jira && bun run test`
Expected: FAIL — `Cannot find module '../src/errors.ts'` (file doesn't exist yet).

- [ ] **Step 7: Implement the error classes**

`packages/jira/src/errors.ts`:

```typescript
import { Schema } from "effect"

export class IssueNotFoundError extends Schema.TaggedErrorClass<IssueNotFoundError>()(
  "IssueNotFoundError",
  { key: Schema.String },
) {}

export class JiraAuthError extends Schema.TaggedErrorClass<JiraAuthError>()(
  "JiraAuthError",
  { status: Schema.Number },
) {}

export class JiraHttpError extends Schema.TaggedErrorClass<JiraHttpError>()(
  "JiraHttpError",
  { key: Schema.String, error: Schema.Defect },
) {}

export type JiraError = IssueNotFoundError | JiraAuthError | JiraHttpError
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd packages/jira && bun run test`
Expected: PASS — 3 tests pass.

- [ ] **Step 9: Lint and typecheck**

Run: `cd packages/jira && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/jira/package.json packages/jira/tsconfig.json packages/jira/vitest.config.ts packages/jira/src/errors.ts packages/jira/tests/errors.test.ts bun.lock
git commit -m "feat(jira): scaffold @mono/jira package with domain errors"
```

---

### Task 2: Issue domain model

**Files:**
- Create: `packages/jira/src/Issue.ts`
- Test: `packages/jira/tests/Issue.test.ts`

**Interfaces:**
- Consumes: nothing new (pure Schema/data module).
- Produces: `RawIssue` (Schema.Class matching the raw Jira API v2 response shape), `Issue` (Schema.Class with `key: string`, `summary: string`, `status: string`, `assignee: string | null`, `description: string | null`, and a `toMarkdown(): string` method), and `toIssue(raw: RawIssue): Issue`. Task 4 imports `RawIssue`, `Issue`, `toIssue` from `./Issue.ts`.

- [ ] **Step 1: Write the failing test for mapping and rendering**

`packages/jira/tests/Issue.test.ts`:

```typescript
import { describe, expect, test } from "@effect/vitest"
import { Issue, RawIssue, toIssue } from "../src/Issue.ts"

describe("toIssue", () => {
  test("maps a fully-populated raw issue", () => {
    const raw = new RawIssue({
      key: "PROJ-123",
      fields: {
        summary: "Fix login redirect loop",
        status: { name: "In Progress" },
        assignee: { displayName: "Jane Doe" },
        description: "Users are redirected to login instead of dashboard.",
      },
    })

    const issue = toIssue(raw)

    expect(issue.key).toBe("PROJ-123")
    expect(issue.summary).toBe("Fix login redirect loop")
    expect(issue.status).toBe("In Progress")
    expect(issue.assignee).toBe("Jane Doe")
    expect(issue.description).toBe("Users are redirected to login instead of dashboard.")
  })

  test("maps a null assignee and null description to null", () => {
    const raw = new RawIssue({
      key: "PROJ-124",
      fields: {
        summary: "Unassigned bug",
        status: { name: "Open" },
        assignee: null,
        description: null,
      },
    })

    const issue = toIssue(raw)

    expect(issue.assignee).toBeNull()
    expect(issue.description).toBeNull()
  })
})

describe("Issue.toMarkdown", () => {
  test("renders key, summary, status, assignee, and description", () => {
    const issue = new Issue({
      key: "PROJ-123",
      summary: "Fix login redirect loop",
      status: "In Progress",
      assignee: "Jane Doe",
      description: "Users are redirected to login instead of dashboard.",
    })

    const markdown = issue.toMarkdown()

    expect(markdown).toContain("PROJ-123: Fix login redirect loop")
    expect(markdown).toContain("Status: In Progress")
    expect(markdown).toContain("Assignee: Jane Doe")
    expect(markdown).toContain("Users are redirected to login instead of dashboard.")
  })

  test("renders Unassigned and omits the description block when both are null", () => {
    const issue = new Issue({
      key: "PROJ-124",
      summary: "Unassigned bug",
      status: "Open",
      assignee: null,
      description: null,
    })

    const markdown = issue.toMarkdown()

    expect(markdown).toContain("Assignee: Unassigned")
    expect(markdown).not.toContain("Description:")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/jira && bun run test`
Expected: FAIL — `Cannot find module '../src/Issue.ts'`.

- [ ] **Step 3: Implement the domain model**

`packages/jira/src/Issue.ts`:

```typescript
import { Schema } from "effect"

class RawStatus extends Schema.Class<RawStatus>("RawStatus")({
  name: Schema.String,
}) {}

class RawAssignee extends Schema.Class<RawAssignee>("RawAssignee")({
  displayName: Schema.String,
}) {}

class RawFields extends Schema.Class<RawFields>("RawFields")({
  summary: Schema.String,
  status: RawStatus,
  assignee: Schema.NullOr(RawAssignee),
  description: Schema.NullOr(Schema.String),
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
}) {
  toMarkdown(): string {
    const lines = [
      `${this.key}: ${this.summary}`,
      `Status: ${this.status}`,
      `Assignee: ${this.assignee ?? "Unassigned"}`,
    ]
    if (this.description) {
      lines.push("", "Description:", this.description)
    }
    return lines.join("\n")
  }
}

export const toIssue = (raw: RawIssue): Issue =>
  new Issue({
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status.name,
    assignee: raw.fields.assignee?.displayName ?? null,
    description: raw.fields.description,
  })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/jira && bun run test`
Expected: PASS — 4 tests pass (plus the 3 from Task 1).

- [ ] **Step 5: Lint and typecheck**

Run: `cd packages/jira && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/jira/src/Issue.ts packages/jira/tests/Issue.test.ts
git commit -m "feat(jira): add Issue domain model with markdown rendering"
```

---

### Task 3: `JiraConfig` service

**Files:**
- Create: `packages/jira/src/JiraConfig.ts`
- Test: `packages/jira/tests/JiraConfig.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `JiraConfig` — a `Context.Service` exposing `{ baseUrl: string; token: Redacted.Redacted }`, with `JiraConfig.layer` (reads `JIRA_BASE_URL`/`JIRA_API_TOKEN` from env via `Config`) and `JiraConfig.testLayer` (fixed values: `baseUrl: "https://jira.test"`, `token: Redacted.make("test-token")`). Task 4 depends on `JiraConfig`, `JiraConfig.layer`, `JiraConfig.testLayer`.

- [ ] **Step 1: Write the failing test**

`packages/jira/tests/JiraConfig.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { JiraConfig } from "../src/JiraConfig.ts"

describe("JiraConfig", () => {
  it.effect("reads baseUrl and token from environment config", () => {
    const layer = JiraConfig.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            JIRA_BASE_URL: "https://jira.example.com",
            JIRA_API_TOKEN: "secret-token",
          }),
        ),
      ),
    )

    return Effect.gen(function* () {
      const config = yield* JiraConfig
      expect(config.baseUrl).toBe("https://jira.example.com")
      expect(Redacted.value(config.token)).toBe("secret-token")
    }).pipe(Effect.provide(layer))
  })

  it.effect("testLayer provides fixed values", () =>
    Effect.gen(function* () {
      const config = yield* JiraConfig
      expect(config.baseUrl).toBe("https://jira.test")
      expect(Redacted.value(config.token)).toBe("test-token")
    }).pipe(Effect.provide(JiraConfig.testLayer)),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/jira && bun run test`
Expected: FAIL — `Cannot find module '../src/JiraConfig.ts'`.

- [ ] **Step 3: Implement `JiraConfig`**

`packages/jira/src/JiraConfig.ts`:

```typescript
import { Config, Effect, Layer, Redacted } from "effect"
import * as Context from "effect/Context"

export class JiraConfig extends Context.Service<
  JiraConfig,
  {
    readonly baseUrl: string
    readonly token: Redacted.Redacted
  }
>()("@mono/JiraConfig") {
  static readonly layer = Layer.effect(
    JiraConfig,
    Effect.gen(function* () {
      const baseUrl = yield* Config.string("JIRA_BASE_URL")
      const token = yield* Config.redacted("JIRA_API_TOKEN")
      return { baseUrl, token }
    }),
  )

  static readonly testLayer = Layer.succeed(JiraConfig, {
    baseUrl: "https://jira.test",
    token: Redacted.make("test-token"),
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/jira && bun run test`
Expected: PASS — 2 tests pass (plus the 7 from Tasks 1–2).

- [ ] **Step 5: Lint and typecheck**

Run: `cd packages/jira && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/jira/src/JiraConfig.ts packages/jira/tests/JiraConfig.test.ts
git commit -m "feat(jira): add JiraConfig service reading JIRA_BASE_URL/JIRA_API_TOKEN"
```

---

### Task 4: `JiraClient` service and package barrel export

**Files:**
- Create: `packages/jira/src/JiraClient.ts`
- Create: `packages/jira/src/index.ts`
- Test: `packages/jira/tests/JiraClient.test.ts`

**Interfaces:**
- Consumes: `IssueNotFoundError`, `JiraAuthError`, `JiraHttpError`, `JiraError` (Task 1); `RawIssue`, `Issue`, `toIssue` (Task 2); `JiraConfig`, `JiraConfig.layer`, `JiraConfig.testLayer` (Task 3).
- Produces: `JiraClient` — a `Context.Service` exposing `{ getIssue: (key: string) => Effect.Effect<Issue, JiraError> }`, with `JiraClient.layer`. `packages/jira/src/index.ts` re-exports everything so `apps/cli` can `import { JiraClient, JiraConfig, Issue } from "@mono/jira"`.

- [ ] **Step 1: Write the failing tests**

`packages/jira/tests/JiraClient.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { IssueNotFoundError, JiraAuthError, JiraHttpError } from "../src/errors.ts"
import { JiraClient } from "../src/JiraClient.ts"
import { JiraConfig } from "../src/JiraConfig.ts"

const rawIssueJson = (overrides: {
  key?: string
  assignee?: { displayName: string } | null
  description?: string | null
} = {}) => ({
  key: overrides.key ?? "PROJ-123",
  fields: {
    summary: "Fix login redirect loop",
    status: { name: "In Progress" },
    assignee: "assignee" in overrides ? overrides.assignee : { displayName: "Jane Doe" },
    description: "description" in overrides ? overrides.description : "Users are redirected to login.",
  },
})

const jsonFetch = (status: number, body: unknown): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch

const failingFetch = (message: string): typeof fetch =>
  (() => Promise.reject(new Error(message))) as unknown as typeof fetch

const testLayer = (mockFetch: typeof fetch) =>
  JiraClient.layer.pipe(
    Layer.provide(
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, mockFetch))),
    ),
    Layer.provide(JiraConfig.testLayer),
  )

describe("JiraClient.getIssue", () => {
  it.effect("fetches and maps an issue", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient
      const issue = yield* jira.getIssue("PROJ-123")
      expect(issue.key).toBe("PROJ-123")
      expect(issue.summary).toBe("Fix login redirect loop")
      expect(issue.status).toBe("In Progress")
      expect(issue.assignee).toBe("Jane Doe")
    }).pipe(Effect.provide(testLayer(jsonFetch(200, rawIssueJson())))),
  )

  it.effect("maps a null assignee to null", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient
      const issue = yield* jira.getIssue("PROJ-124")
      expect(issue.assignee).toBeNull()
    }).pipe(
      Effect.provide(testLayer(jsonFetch(200, rawIssueJson({ key: "PROJ-124", assignee: null })))),
    ),
  )

  it.effect("maps a 404 response to IssueNotFoundError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient
      const failure = yield* Effect.flip(jira.getIssue("MISSING-1"))
      expect(failure).toBeInstanceOf(IssueNotFoundError)
      expect((failure as IssueNotFoundError).key).toBe("MISSING-1")
    }).pipe(Effect.provide(testLayer(jsonFetch(404, { errorMessages: ["Issue does not exist"] })))),
  )

  it.effect("maps a 401 response to JiraAuthError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient
      const failure = yield* Effect.flip(jira.getIssue("PROJ-123"))
      expect(failure).toBeInstanceOf(JiraAuthError)
      expect((failure as JiraAuthError).status).toBe(401)
    }).pipe(Effect.provide(testLayer(jsonFetch(401, {})))),
  )

  it.effect("maps a transport failure to JiraHttpError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient
      const failure = yield* Effect.flip(jira.getIssue("PROJ-123"))
      expect(failure).toBeInstanceOf(JiraHttpError)
    }).pipe(Effect.provide(testLayer(failingFetch("network down")))),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/jira && bun run test`
Expected: FAIL — `Cannot find module '../src/JiraClient.ts'`.

- [ ] **Step 3: Implement `JiraClient`**

`packages/jira/src/JiraClient.ts`:

```typescript
import { Effect, Layer, Redacted, Schema } from "effect"
import * as Context from "effect/Context"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"
import { IssueNotFoundError, JiraAuthError, JiraHttpError, type JiraError } from "./errors.ts"
import { type Issue, RawIssue, toIssue } from "./Issue.ts"
import { JiraConfig } from "./JiraConfig.ts"

const mapError = (
  key: string,
  error: HttpClientError.HttpClientError | Schema.SchemaError,
): Effect.Effect<never, JiraError> => {
  if (HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError") {
    const status = error.reason.response.status
    if (status === 404) return Effect.fail(new IssueNotFoundError({ key }))
    if (status === 401 || status === 403) return Effect.fail(new JiraAuthError({ status }))
  }
  return Effect.fail(new JiraHttpError({ key, error }))
}

export class JiraClient extends Context.Service<
  JiraClient,
  {
    readonly getIssue: (key: string) => Effect.Effect<Issue, JiraError>
  }
>()("@mono/JiraClient") {
  static readonly layer = Layer.effect(
    JiraClient,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const config = yield* JiraConfig

      const getIssue = Effect.fn("JiraClient.getIssue")(
        (key: string): Effect.Effect<Issue, JiraError> =>
          Effect.gen(function* () {
            const response = yield* http.get(`${config.baseUrl}/rest/api/2/issue/${key}`, {
              headers: { Authorization: `Bearer ${Redacted.value(config.token)}` },
            })
            const raw = yield* HttpClientResponse.schemaBodyJson(RawIssue)(response)
            return toIssue(raw)
          }).pipe(Effect.catch((error) => mapError(key, error))),
      )

      return { getIssue }
    }),
  )
}
```

- [ ] **Step 4: Create the package barrel export**

`packages/jira/src/index.ts`:

```typescript
export * from "./errors.ts"
export * from "./Issue.ts"
export * from "./JiraClient.ts"
export * from "./JiraConfig.ts"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/jira && bun run test`
Expected: PASS — 5 tests pass (plus the 9 from Tasks 1–3).

- [ ] **Step 6: Lint and typecheck**

Run: `cd packages/jira && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/jira/src/JiraClient.ts packages/jira/src/index.ts packages/jira/tests/JiraClient.test.ts
git commit -m "feat(jira): add JiraClient.getIssue with status-code error mapping"
```

---

### Task 5: CLI output renderer (pure function)

**Files:**
- Create: `apps/cli/src/jira/render.ts`
- Test: `apps/cli/tests/jira/render.test.ts`

**Interfaces:**
- Consumes: `Issue` from `@mono/jira` (Task 2, re-exported via Task 4's barrel).
- Produces: `renderIssue(issue: Issue, format: "markdown" | "json"): string` and the `OutputFormat` type. Task 6 imports both from `./render.ts`.

- [ ] **Step 1: Add the workspace dependency**

Edit `apps/cli/package.json`, adding `@mono/jira` to `dependencies`:

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
    "@mono/jira": "workspace:*"
  }
}
```

Run: `bun install`
Expected: `node_modules/@mono/jira` symlink appears under `apps/cli`'s resolution scope (hoisted to root `node_modules/@mono/jira`).

- [ ] **Step 2: Write the failing test**

`apps/cli/tests/jira/render.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { Issue } from "@mono/jira"
import { renderIssue } from "../../src/jira/render.ts"

const issue = new Issue({
  key: "PROJ-123",
  summary: "Fix login redirect loop",
  status: "In Progress",
  assignee: "Jane Doe",
  description: "Users are redirected to login instead of dashboard.",
})

describe("renderIssue", () => {
  test("markdown format includes key, status, and assignee", () => {
    const output = renderIssue(issue, "markdown")
    expect(output).toContain("PROJ-123: Fix login redirect loop")
    expect(output).toContain("Status: In Progress")
    expect(output).toContain("Assignee: Jane Doe")
  })

  test("json format produces valid, parseable JSON with core fields", () => {
    const output = renderIssue(issue, "json")
    const parsed = JSON.parse(output)
    expect(parsed).toEqual({
      key: "PROJ-123",
      summary: "Fix login redirect loop",
      status: "In Progress",
      assignee: "Jane Doe",
      description: "Users are redirected to login instead of dashboard.",
    })
  })

  test("markdown format shows Unassigned when assignee is null", () => {
    const unassigned = new Issue({ ...issue, assignee: null })
    expect(renderIssue(unassigned, "markdown")).toContain("Assignee: Unassigned")
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/cli && bun test tests/jira/render.test.ts`
Expected: FAIL — `Cannot find module '../../src/jira/render.ts'`.

- [ ] **Step 4: Implement the renderer**

`apps/cli/src/jira/render.ts`:

```typescript
import type { Issue } from "@mono/jira"

export type OutputFormat = "markdown" | "json"

export const renderIssue = (issue: Issue, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(
      {
        key: issue.key,
        summary: issue.summary,
        status: issue.status,
        assignee: issue.assignee,
        description: issue.description,
      },
      null,
      2,
    )
  }
  return issue.toMarkdown()
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/cli && bun test tests/jira/render.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Lint and typecheck**

Run: `cd apps/cli && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/package.json apps/cli/src/jira/render.ts apps/cli/tests/jira/render.test.ts bun.lock
git commit -m "feat(cli): add pure renderIssue helper for markdown/json output"
```

---

### Task 6: `jira show` CLI command

**Files:**
- Create: `apps/cli/src/jira/show.ts`
- Modify: `apps/cli/src/index.ts`

**Interfaces:**
- Consumes: `JiraClient`, `JiraConfig` (from `@mono/jira`, Tasks 3–4); `renderIssue`, `OutputFormat` (Task 5).
- Produces: `jiraCommand` (exported from `apps/cli/src/jira/show.ts`), wired into the root CLI in `apps/cli/src/index.ts`. Nothing downstream consumes this — it's the final integration point.

- [ ] **Step 1: Implement the `show` command**

`apps/cli/src/jira/show.ts`:

```typescript
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { JiraClient } from "@mono/jira"
import { renderIssue } from "./render.ts"

const key = Argument.string("key").pipe(Argument.withDescription("Issue key, e.g. PROJ-123"))

const format = Flag.choice("format", ["markdown", "json"]).pipe(
  Flag.withDefault("markdown"),
  Flag.withDescription("Output format"),
)

const showCommand = Command.make("show", { key, format }, ({ key, format }) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient
    const issue = yield* jira.getIssue(key)
    yield* Console.log(renderIssue(issue, format))
  }).pipe(
    Effect.catchTag("IssueNotFoundError", (e) => Console.error(`Issue not found: ${e.key}`)),
    Effect.catchTag("JiraAuthError", () =>
      Console.error("Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN"),
    ),
    Effect.catchTag("JiraHttpError", (e) => Console.error(`Jira request failed: ${String(e.error)}`)),
  ),
).pipe(Command.withDescription("Show a Jira issue by key"))

export const jiraCommand = Command.make("jira").pipe(
  Command.withDescription("Jira integration"),
  Command.withSubcommands([showCommand]),
)
```

- [ ] **Step 2: Wire the command and HTTP/config layers into the CLI entry point**

Modify `apps/cli/src/index.ts` (full file after the change):

```typescript
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { JiraClient, JiraConfig } from "@mono/jira";
import { Console, Effect, Layer } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { jiraCommand } from "./jira/show.ts";

const name = Argument.string("name").pipe(Argument.withDefault("World"));
const shout = Flag.boolean("shout").pipe(Flag.withAlias("s"));

const greet = Command.make("greet", { name, shout }, ({ name, shout }) => {
  const message = `Hello, ${name}!`;
  return Console.log(shout ? message.toUpperCase() : message);
});

const cli = Command.make("mono-cli", {}).pipe(
  Command.withDescription("mono CLI"),
  Command.withSubcommands([greet, jiraCommand]),
);

const program = Command.run(cli, {
  version: "0.0.1",
});

const jiraLayer = JiraClient.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(JiraConfig.layer),
);

const mainLayer = Layer.mergeAll(BunServices.layer, jiraLayer);

program.pipe(Effect.provide(mainLayer), BunRuntime.runMain);
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/cli && bun run typecheck && bun run lint`
Expected: both succeed with no errors.

- [ ] **Step 4: Run the full test suite for both packages**

Run: `bun run test`
Expected: `@mono/jira` and `@mono/cli` both report all tests passing (14 tests across `packages/jira` from Tasks 1–4, 3 tests in `apps/cli` from Task 5).

- [ ] **Step 5: Manually verify the command against a real Jira Server/DC instance**

Run:
```bash
JIRA_BASE_URL=https://<your-jira-host> JIRA_API_TOKEN=<your-PAT> bun run --filter=@mono/cli dev -- jira show <REAL-ISSUE-KEY>
```
Expected: markdown output with the issue key, summary, status, assignee, and description.

Run:
```bash
JIRA_BASE_URL=https://<your-jira-host> JIRA_API_TOKEN=<your-PAT> bun run --filter=@mono/cli dev -- jira show <REAL-ISSUE-KEY> --format json
```
Expected: pretty-printed JSON with the same fields.

Run:
```bash
JIRA_BASE_URL=https://<your-jira-host> JIRA_API_TOKEN=<your-PAT> bun run --filter=@mono/cli dev -- jira show DOES-NOT-EXIST
```
Expected: `Issue not found: DOES-NOT-EXIST` printed to stderr, non-zero exit code.

Run:
```bash
JIRA_BASE_URL=https://<your-jira-host> JIRA_API_TOKEN=invalid-token bun run --filter=@mono/cli dev -- jira show <REAL-ISSUE-KEY>
```
Expected: `Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN` printed to stderr, non-zero exit code.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/jira/show.ts apps/cli/src/index.ts
git commit -m "feat(cli): add mono jira show command"
```

---

## Plan Self-Review

**Spec coverage:**
- Package `@mono/jira` with `JiraConfig`, `JiraClient`, `Issue`, errors → Tasks 1–4.
- CLI `mono jira show <key> [--format]` → Tasks 5–6.
- Env-var config (`JIRA_BASE_URL`, `JIRA_API_TOKEN`), Bearer auth, API v2 → Task 3, Task 4 Step 3.
- Core fields (key, summary, status, assignee, description) → Task 2.
- Markdown default / JSON via `--format` → Task 5, Task 6 Step 1.
- Error handling (404, 401/403, other) → Task 1 (errors), Task 4 (mapping + tests), Task 6 (CLI messages).
- `@effect/vitest` for `packages/jira`, `bun test` for the CLI's pure function → Tasks 1–5.
- Manual end-to-end verification against a real instance → Task 6 Step 5 (no test credentials available for automated coverage of the real network path).

**Placeholder scan:** no TBD/TODO markers; every step has complete code or an exact command with expected output.

**Type consistency:** `Issue`, `RawIssue`, `toIssue` (Task 2) → consumed identically in `JiraClient.ts` (Task 4) and `render.ts`/`show.ts` (Tasks 5–6). `JiraError` union (Task 1) matches `JiraClient.getIssue`'s return type (Task 4) and the `catchTag` calls in `show.ts` (Task 6). `OutputFormat` (Task 5) matches `Flag.choice("format", ["markdown", "json"])`'s inferred type (Task 6).
