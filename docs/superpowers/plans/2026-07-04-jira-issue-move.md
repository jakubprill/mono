# Jira Issue Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mono-cli jira issue move <key>` — an interactive picker that lists the Jira workflow transitions available for an issue and executes the chosen one — and restructure the existing `jira show` command into `jira issue view` to make room for it.

**Architecture:** `packages/jira`'s `JiraClient` gains `getTransitions(key)` (GET `/transitions`, decoded into a new `Transition` domain model) and `transitionIssue(key, transitionId)` (POST `/transitions`), reusing the existing `mapError`/`JiraError` machinery. `apps/cli`'s flat `jira show` command is split into an `issue` subcommand group: `issue view` (renamed, unchanged behavior) and `issue move` (new), sharing a `jiraLayer`/`reportAndFail` helper extracted out of the old `show.ts`. `move` has no `--json`/`--format` flag — it's interactive-only, using `effect/unstable/cli`'s built-in `Prompt.select`.

**Tech Stack:** Effect 4.0.0-beta.93 (`Context.Service`, `Layer`, `Schema`, `effect/unstable/cli` `Prompt`/`Command`, `effect/unstable/http` `HttpClientRequest`/`HttpBody`), Bun, `@effect/vitest` for `packages/jira`, `bun:test` for `apps/cli`.

## Global Constraints

- Effect version: `4.0.0-beta.93` for `effect`/`@effect/platform-bun`/`@effect/vitest` — always via `catalog:effect` in `package.json`, never hardcoded.
- Jira API: Server/Data Center, API v2 (`/rest/api/2/issue/{key}/transitions`), auth via `Authorization: Bearer <JIRA_API_TOKEN>`.
- `packages/jira` has no dependency on `@effect/platform-bun` or Bun-specific APIs — stays runtime-agnostic, depends only on `effect`.
- `packages/jira` tests use `@effect/vitest` (`cd packages/jira && bun run test`); `apps/cli` tests use `bun test` (`cd apps/cli && bun test`).
- `move` has no non-interactive/scripted mode (no `<status>` argument) — deferred, per spec.
- No new error types — `getTransitions`/`transitionIssue` reuse `IssueNotFoundError`/`JiraAuthError`/`JiraHttpError` from `packages/jira/src/errors.ts`.
- Follow existing repo conventions: Biome for lint/format, `tsc --noEmit` for typecheck, `Context.Service` classes named `@mono/<Name>`, layer constants named `layer`/`testLayer`.
- Reference spec: `docs/superpowers/specs/2026-07-04-jira-issue-move-design.md`.

---

### Task 1: `Transition` domain model in `packages/jira`

**Files:**
- Create: `packages/jira/src/Transition.ts`
- Test: `packages/jira/tests/Transition.test.ts`
- Modify: `packages/jira/src/index.ts`

**Interfaces:**
- Consumes: nothing (mirrors `Issue.ts`'s existing `RawIssue`/`toIssue` pattern).
- Produces: `RawTransition` (Schema.Class, single transition shape: `{ id, name, to: { name } }`), `RawTransitionsResponse` (Schema.Class wrapping `{ transitions: RawTransition[] }`, used to decode the `/transitions` GET response body), `Transition` (Schema.Class: `{ id: string, name: string, toStatus: string }`), and `toTransition(raw: RawTransition): Transition`. Task 2 imports `RawTransitionsResponse`, `Transition`, `toTransition` from `./Transition.ts`.

- [ ] **Step 1: Write the failing test**

`packages/jira/tests/Transition.test.ts`:

```typescript
import { describe, expect, test } from "@effect/vitest";
import { Schema } from "effect";
import { RawTransition, toTransition } from "../src/Transition.ts";

const decodeRawTransition = Schema.decodeSync(RawTransition);

describe("toTransition", () => {
  test("maps id, action name, and destination status name", () => {
    const raw = decodeRawTransition({
      id: "21",
      name: "Start Progress",
      to: { name: "In Progress" },
    });

    const transition = toTransition(raw);

    expect(transition.id).toBe("21");
    expect(transition.name).toBe("Start Progress");
    expect(transition.toStatus).toBe("In Progress");
  });

  test("maps a transition whose action name matches its destination status name", () => {
    const raw = decodeRawTransition({
      id: "31",
      name: "Done",
      to: { name: "Done" },
    });

    const transition = toTransition(raw);

    expect(transition.name).toBe("Done");
    expect(transition.toStatus).toBe("Done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/jira && bun run test`
Expected: FAIL — `Cannot find module '../src/Transition.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/jira/src/Transition.ts`:

```typescript
import { Schema } from "effect";

class RawTransitionTo extends Schema.Class<RawTransitionTo>(
  "RawTransitionTo",
)({
  name: Schema.String,
}) {}

export class RawTransition extends Schema.Class<RawTransition>(
  "RawTransition",
)({
  id: Schema.String,
  name: Schema.String,
  to: RawTransitionTo,
}) {}

export class RawTransitionsResponse extends Schema.Class<RawTransitionsResponse>(
  "RawTransitionsResponse",
)({
  transitions: Schema.Array(RawTransition),
}) {}

export class Transition extends Schema.Class<Transition>("Transition")({
  id: Schema.String,
  name: Schema.String,
  toStatus: Schema.String,
}) {}

export const toTransition = (raw: RawTransition): Transition =>
  new Transition({ id: raw.id, name: raw.name, toStatus: raw.to.name });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/jira && bun run test`
Expected: PASS — 18 tests pass (16 existing + 2 new).

- [ ] **Step 5: Export from the package barrel**

Modify `packages/jira/src/index.ts` — add one line:

```typescript
export * from "./errors.ts";
export * from "./Issue.ts";
export * from "./JiraClient.ts";
export * from "./JiraConfig.ts";
export * from "./Transition.ts";
```

- [ ] **Step 6: Lint and typecheck**

Run: `cd packages/jira && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/jira/src/Transition.ts packages/jira/tests/Transition.test.ts packages/jira/src/index.ts
git commit -m "feat(jira): add Transition domain model"
```

---

### Task 2: `JiraClient.getTransitions` and `JiraClient.transitionIssue`

**Files:**
- Modify: `packages/jira/src/JiraClient.ts`
- Modify: `packages/jira/tests/JiraClient.test.ts`

**Interfaces:**
- Consumes: `RawTransitionsResponse`, `Transition`, `toTransition` from `./Transition.ts` (Task 1).
- Produces: `JiraClient.getTransitions: (key: string) => Effect.Effect<ReadonlyArray<Transition>, JiraError>` and `JiraClient.transitionIssue: (key: string, transitionId: string) => Effect.Effect<void, JiraError>`. Task 4's CLI `move` command calls both by name with these exact signatures.

- [ ] **Step 1: Write the failing tests**

Append the following helper and two `describe` blocks to the end of `packages/jira/tests/JiraClient.test.ts`. No new imports are needed — everything used below (`describe`, `it`, `expect`, `Effect`, `JiraClient`, `IssueNotFoundError`, `JiraAuthError`, `JiraHttpError`, `jsonFetch`, `failingFetch`, `testLayer`) is already imported or defined earlier in the file:

```typescript
const capturingPostFetch = (
  status: number,
): { fetch: typeof fetch; requestedInit: () => RequestInit | undefined } => {
  let requestedInit: RequestInit | undefined;
  const fetchFn = ((_input: string | URL, init?: RequestInit) => {
    requestedInit = init;
    return Promise.resolve(new Response(null, { status }));
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, requestedInit: () => requestedInit };
};

describe("JiraClient.getTransitions", () => {
  it.effect("fetches and maps transitions", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const transitions = yield* jira.getTransitions("PROJ-123");
      expect(transitions).toEqual([
        { id: "21", name: "Start Progress", toStatus: "In Progress" },
        { id: "31", name: "Done", toStatus: "Done" },
      ]);
    }).pipe(
      Effect.provide(
        testLayer(
          jsonFetch(200, {
            transitions: [
              {
                id: "21",
                name: "Start Progress",
                to: { name: "In Progress" },
              },
              { id: "31", name: "Done", to: { name: "Done" } },
            ],
          }),
        ),
      ),
    ),
  );

  it.effect("maps an empty transitions list", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const transitions = yield* jira.getTransitions("PROJ-123");
      expect(transitions).toEqual([]);
    }).pipe(Effect.provide(testLayer(jsonFetch(200, { transitions: [] })))),
  );

  it.effect("maps a 404 response to IssueNotFoundError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getTransitions("MISSING-1"));
      expect(failure).toBeInstanceOf(IssueNotFoundError);
      expect((failure as IssueNotFoundError).key).toBe("MISSING-1");
    }).pipe(
      Effect.provide(
        testLayer(jsonFetch(404, { errorMessages: ["Issue does not exist"] })),
      ),
    ),
  );

  it.effect("maps a 401 response to JiraAuthError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getTransitions("PROJ-123"));
      expect(failure).toBeInstanceOf(JiraAuthError);
      expect((failure as JiraAuthError).status).toBe(401);
    }).pipe(Effect.provide(testLayer(jsonFetch(401, {})))),
  );

  it.effect("maps a transport failure to JiraHttpError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getTransitions("PROJ-123"));
      expect(failure).toBeInstanceOf(JiraHttpError);
    }).pipe(Effect.provide(testLayer(failingFetch("network down")))),
  );
});

describe("JiraClient.transitionIssue", () => {
  it.effect("sends the chosen transition id in the request body", () => {
    const { fetch: mockFetch, requestedInit } = capturingPostFetch(204);

    return Effect.gen(function* () {
      const jira = yield* JiraClient;
      yield* jira.transitionIssue("PROJ-123", "21");
      const body = JSON.parse(String(requestedInit()?.body));
      expect(body).toEqual({ transition: { id: "21" } });
    }).pipe(Effect.provide(testLayer(mockFetch)));
  });

  it.effect("maps a 404 response to IssueNotFoundError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(
        jira.transitionIssue("MISSING-1", "21"),
      );
      expect(failure).toBeInstanceOf(IssueNotFoundError);
      expect((failure as IssueNotFoundError).key).toBe("MISSING-1");
    }).pipe(
      Effect.provide(
        testLayer(jsonFetch(404, { errorMessages: ["Issue does not exist"] })),
      ),
    ),
  );

  it.effect("maps a 401 response to JiraAuthError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(
        jira.transitionIssue("PROJ-123", "21"),
      );
      expect(failure).toBeInstanceOf(JiraAuthError);
      expect((failure as JiraAuthError).status).toBe(401);
    }).pipe(Effect.provide(testLayer(jsonFetch(401, {})))),
  );

  it.effect("maps a transport failure to JiraHttpError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(
        jira.transitionIssue("PROJ-123", "21"),
      );
      expect(failure).toBeInstanceOf(JiraHttpError);
    }).pipe(Effect.provide(testLayer(failingFetch("network down")))),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/jira && bun run test`
Expected: FAIL — `jira.getTransitions is not a function` (and similarly for `transitionIssue`).

- [ ] **Step 3: Implement the methods**

Replace the full contents of `packages/jira/src/JiraClient.ts`:

```typescript
import { Effect, Layer, Redacted, type Schema } from "effect";
import * as Context from "effect/Context";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  IssueNotFoundError,
  JiraAuthError,
  type JiraError,
  JiraHttpError,
} from "./errors.ts";
import { type Issue, RawIssue, toIssue } from "./Issue.ts";
import { JiraConfig } from "./JiraConfig.ts";
import {
  RawTransitionsResponse,
  type Transition,
  toTransition,
} from "./Transition.ts";

const mapError = (
  key: string,
  error: HttpClientError.HttpClientError | Schema.SchemaError,
): Effect.Effect<never, JiraError> => {
  if (
    HttpClientError.isHttpClientError(error) &&
    error.reason._tag === "StatusCodeError"
  ) {
    const status = error.reason.response.status;
    if (status === 404) return Effect.fail(new IssueNotFoundError({ key }));
    if (status === 401 || status === 403)
      return Effect.fail(new JiraAuthError({ status }));
  }
  return Effect.fail(new JiraHttpError({ key, error }));
};

export class JiraClient extends Context.Service<
  JiraClient,
  {
    readonly getIssue: (key: string) => Effect.Effect<Issue, JiraError>;
    readonly getTransitions: (
      key: string,
    ) => Effect.Effect<ReadonlyArray<Transition>, JiraError>;
    readonly transitionIssue: (
      key: string,
      transitionId: string,
    ) => Effect.Effect<void, JiraError>;
  }
>()("@mono/JiraClient") {
  static readonly layer = Layer.effect(
    JiraClient,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
      );
      const config = yield* JiraConfig;

      const authHeaders = {
        Authorization: `Bearer ${Redacted.value(config.token)}`,
      };

      const getIssue = Effect.fn("JiraClient.getIssue")(
        (key: string): Effect.Effect<Issue, JiraError> =>
          Effect.gen(function* () {
            const response = yield* http.get(
              `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}`,
              { headers: authHeaders },
            );
            const raw =
              yield* HttpClientResponse.schemaBodyJson(RawIssue)(response);
            return toIssue(raw);
          }).pipe(Effect.catch((error) => mapError(key, error))),
      );

      const getTransitions = Effect.fn("JiraClient.getTransitions")(
        (key: string): Effect.Effect<ReadonlyArray<Transition>, JiraError> =>
          Effect.gen(function* () {
            const response = yield* http.get(
              `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
              { headers: authHeaders },
            );
            const raw =
              yield* HttpClientResponse.schemaBodyJson(RawTransitionsResponse)(
                response,
              );
            return raw.transitions.map(toTransition);
          }).pipe(Effect.catch((error) => mapError(key, error))),
      );

      const transitionIssue = Effect.fn("JiraClient.transitionIssue")(
        (key: string, transitionId: string): Effect.Effect<void, JiraError> =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post(
              `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
              { headers: authHeaders },
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                transition: { id: transitionId },
              }),
            );
            yield* http.execute(request);
          }).pipe(Effect.catch((error) => mapError(key, error))),
      );

      return { getIssue, getTransitions, transitionIssue };
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/jira && bun run test`
Expected: PASS — 27 tests pass (18 from Task 1 + 9 new).

- [ ] **Step 5: Lint and typecheck**

Run: `cd packages/jira && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/jira/src/JiraClient.ts packages/jira/tests/JiraClient.test.ts
git commit -m "feat(jira): add getTransitions and transitionIssue to JiraClient"
```

---

### Task 3: Restructure the CLI into `jira issue view` (no behavior change)

**Files:**
- Create: `apps/cli/src/jira/layer.ts`
- Create: `apps/cli/src/jira/issue/render.ts` (moved from `apps/cli/src/jira/render.ts`)
- Create: `apps/cli/src/jira/issue/view.ts` (renamed from `apps/cli/src/jira/show.ts`)
- Create: `apps/cli/src/jira/issue/command.ts`
- Create: `apps/cli/src/jira/command.ts`
- Delete: `apps/cli/src/jira/show.ts`
- Delete: `apps/cli/src/jira/render.ts`
- Modify: `apps/cli/src/index.ts`
- Move: `apps/cli/tests/jira/render.test.ts` → `apps/cli/tests/jira/issue/render.test.ts`

**Interfaces:**
- Consumes: nothing new — pure rename/relocation of the existing `show` command and `renderIssue`.
- Produces: `jiraLayer`, `reportAndFail` exported from `apps/cli/src/jira/layer.ts` (Task 4's `move.ts` imports both). `viewCommand` exported from `apps/cli/src/jira/issue/view.ts`. `issueCommand` exported from `apps/cli/src/jira/issue/command.ts` (Task 4 adds `moveCommand` to its `withSubcommands` list). `jiraCommand` exported from `apps/cli/src/jira/command.ts`, consumed by `apps/cli/src/index.ts`.

- [ ] **Step 1: Extract the shared layer and error helper**

Create `apps/cli/src/jira/layer.ts`:

```typescript
import type { JiraError } from "@mono/jira";
import { JiraClient, JiraConfig } from "@mono/jira";
import { Console, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

export const jiraLayer = JiraClient.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(JiraConfig.layer),
);

export const reportAndFail = (message: string, error: JiraError) =>
  Console.error(message).pipe(Effect.andThen(Effect.fail(error)));
```

- [ ] **Step 2: Move `render.ts` under `issue/` and its test alongside it**

Create `apps/cli/src/jira/issue/render.ts` with the exact current contents of `apps/cli/src/jira/render.ts`:

```typescript
import { Issue } from "@mono/jira";
import { Schema } from "effect";

export type OutputFormat = "markdown" | "json";

export const renderIssue = (issue: Issue, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(Schema.encodeSync(Issue)(issue), null, 2);
  }
  return issue.toMarkdown();
};
```

Delete `apps/cli/src/jira/render.ts`.

Create `apps/cli/tests/jira/issue/render.test.ts` with the current contents of `apps/cli/tests/jira/render.test.ts`, updating only the import path (one extra `../` since it's now one directory deeper):

```typescript
import { describe, expect, test } from "bun:test";
import { Issue } from "@mono/jira";
import { renderIssue } from "../../../src/jira/issue/render.ts";

const issue = new Issue({
  key: "PROJ-123",
  summary: "Fix login redirect loop",
  status: "In Progress",
  assignee: "Jane Doe",
  description: "Users are redirected to login instead of dashboard.",
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

Delete `apps/cli/tests/jira/render.test.ts`.

- [ ] **Step 3: Rename `show.ts` to `issue/view.ts`**

Create `apps/cli/src/jira/issue/view.ts`:

```typescript
import { JiraClient } from "@mono/jira";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { jiraLayer, reportAndFail } from "../layer.ts";
import { renderIssue } from "./render.ts";

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

const format = Flag.choice("format", ["markdown", "json"]).pipe(
  Flag.withDefault("markdown"),
  Flag.withDescription("Output format"),
);

export const viewCommand = Command.make(
  "view",
  { key, format },
  ({ key, format }) =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const issue = yield* jira.getIssue(key);
      yield* Console.log(renderIssue(issue, format));
    }).pipe(
      Effect.catchTag("IssueNotFoundError", (e) =>
        reportAndFail(`Issue not found: ${e.key}`, e),
      ),
      Effect.catchTag("JiraAuthError", (e) =>
        reportAndFail("Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN", e),
      ),
      Effect.catchTag("JiraHttpError", (e) =>
        reportAndFail(`Jira request failed: ${String(e.error)}`, e),
      ),
      Effect.provide(jiraLayer),
    ),
).pipe(Command.withDescription("View a Jira issue by key"));
```

Delete `apps/cli/src/jira/show.ts`.

- [ ] **Step 4: Create the `issue` command group**

Create `apps/cli/src/jira/issue/command.ts`:

```typescript
import { Command } from "effect/unstable/cli";
import { viewCommand } from "./view.ts";

export const issueCommand = Command.make("issue").pipe(
  Command.withDescription("Jira issue commands"),
  Command.withSubcommands([viewCommand]),
);
```

- [ ] **Step 5: Create the top-level `jira` command**

Create `apps/cli/src/jira/command.ts`:

```typescript
import { Command } from "effect/unstable/cli";
import { issueCommand } from "./issue/command.ts";

export const jiraCommand = Command.make("jira").pipe(
  Command.withDescription("Jira integration"),
  Command.withSubcommands([issueCommand]),
);
```

- [ ] **Step 6: Update `index.ts`'s import**

Modify `apps/cli/src/index.ts:4` — change:

```typescript
import { jiraCommand } from "./jira/show.ts";
```

to:

```typescript
import { jiraCommand } from "./jira/command.ts";
```

- [ ] **Step 7: Run tests to verify the move didn't break anything**

Run: `cd apps/cli && bun test`
Expected: PASS — 3 tests pass (same tests, now at `tests/jira/issue/render.test.ts`).

- [ ] **Step 8: Lint and typecheck**

Run: `cd apps/cli && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 9: Smoke-test the renamed command (no network required)**

Run: `cd apps/cli && bun run src/index.ts jira issue view --help`
Expected: help output showing the `view` command with `key` argument and `--format` flag description ("View a Jira issue by key").

Run: `cd apps/cli && bun run src/index.ts jira show --help`
Expected: an "unknown command" error — confirms the old flat `show` command no longer exists.

- [ ] **Step 10: Commit**

```bash
git add apps/cli/src/jira apps/cli/tests/jira apps/cli/src/index.ts
git commit -m "refactor(cli): restructure jira show into issue view under an issue subcommand group"
```

---

### Task 4: `jira issue move` — interactive transition picker

**Files:**
- Create: `apps/cli/src/jira/issue/move.ts`
- Modify: `apps/cli/src/jira/issue/command.ts`

**Interfaces:**
- Consumes: `jiraLayer`, `reportAndFail` from `../layer.ts` (Task 3); `JiraClient.getTransitions`/`transitionIssue` from `@mono/jira` (Task 2); `Prompt` from `effect/unstable/cli` (built into the already-installed `effect` package, no new dependency).
- Produces: `moveCommand` exported from `apps/cli/src/jira/issue/move.ts`, added to `issueCommand`'s subcommands.

- [ ] **Step 1: Implement the `move` command**

Create `apps/cli/src/jira/issue/move.ts`:

```typescript
import { JiraClient } from "@mono/jira";
import { Console, Effect } from "effect";
import { Argument, Command, Prompt } from "effect/unstable/cli";
import { jiraLayer, reportAndFail } from "../layer.ts";

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

export const moveCommand = Command.make("move", { key }, ({ key }) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient;
    const transitions = yield* jira.getTransitions(key);

    if (transitions.length === 0) {
      yield* Console.log(`No transitions available for ${key}`);
      return;
    }

    const chosenId = yield* Prompt.run(
      Prompt.select({
        message: `Move ${key} to:`,
        choices: transitions.map((t) => ({
          title:
            t.name === t.toStatus ? t.toStatus : `${t.toStatus} (${t.name})`,
          value: t.id,
        })),
      }),
    );

    yield* jira.transitionIssue(key, chosenId);
    const target = transitions.find((t) => t.id === chosenId);
    yield* Console.log(`${key} → ${target?.toStatus}`);
  }).pipe(
    Effect.catchTag("QuitError", () => Console.log("Cancelled.")),
    Effect.catchTag("IssueNotFoundError", (e) =>
      reportAndFail(`Issue not found: ${e.key}`, e),
    ),
    Effect.catchTag("JiraAuthError", (e) =>
      reportAndFail("Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN", e),
    ),
    Effect.catchTag("JiraHttpError", (e) =>
      reportAndFail(`Jira request failed: ${String(e.error)}`, e),
    ),
    Effect.provide(jiraLayer),
  ),
).pipe(Command.withDescription("Move a Jira issue to a new status"));
```

- [ ] **Step 2: Wire `moveCommand` into the `issue` group**

Modify `apps/cli/src/jira/issue/command.ts` to:

```typescript
import { Command } from "effect/unstable/cli";
import { moveCommand } from "./move.ts";
import { viewCommand } from "./view.ts";

export const issueCommand = Command.make("issue").pipe(
  Command.withDescription("Jira issue commands"),
  Command.withSubcommands([viewCommand, moveCommand]),
);
```

- [ ] **Step 3: Lint and typecheck**

Run: `cd apps/cli && bun run lint && bun run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 4: Smoke-test command registration (no network required)**

Run: `cd apps/cli && bun run src/index.ts jira issue move --help`
Expected: help output showing the `move` command with a `key` argument and the description "Move a Jira issue to a new status".

Run: `cd apps/cli && bun run src/index.ts jira issue move`
Expected: a "missing argument `key`" error (proves the argument is required and no accidental network call happens before validation).

- [ ] **Step 5: Manual end-to-end verification against a real Jira instance**

This can't be automated — `Prompt.select` reads real terminal input, and this is explicitly out of scope for unit testing per the design spec. With `JIRA_BASE_URL`/`JIRA_API_TOKEN` pointing at a real Jira Server/Data Center instance and a real issue key:

Run: `cd apps/cli && bun run src/index.ts jira issue move PROJ-123`

Expected: an arrow-key-selectable list of the issue's real available transitions (destination status name, with the action name in parentheses when it differs), selecting one transitions the issue in Jira and prints `PROJ-123 → <chosen status>`. Confirm in the Jira UI that the issue's status actually changed. Also verify: an issue with zero available transitions prints `No transitions available for <key>` and exits without opening a picker; pressing Ctrl+C/Esc during selection prints `Cancelled.` and exits without calling `transitionIssue`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/jira/issue/move.ts apps/cli/src/jira/issue/command.ts
git commit -m "feat(cli): add jira issue move interactive transition picker"
```
