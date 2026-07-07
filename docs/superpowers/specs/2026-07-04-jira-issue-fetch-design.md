# Jira Issue Fetch — Design

**Date:** 2026-07-04
**Status:** Approved

## Objective

Add a small, self-contained integration that fetches a Jira Server/Data Center
issue by key and prints it — as a reusable library and a CLI command. This is
the first slice of the larger `mono` assistant vision (see prior blueprint
discussion); everything else in that blueprint is out of scope for now.

## Scope

- Fetch a single issue by key (e.g. `PROJ-123`) from Jira Server/Data Center.
- Core fields only: summary, status, assignee, description.
- Two output formats: human/AI-readable markdown (default) and JSON.
- New package `packages/jira` (`@mono/jira`) + a `mono jira show <key>` CLI
  command in `apps/cli`.
- Out of scope: comments, issue search/list, writing/transitioning issues,
  config files, Jira Cloud support, the wider `mono` blueprint (gitflow,
  ai-agent, imports-monitor, etc).

## Architecture

```
packages/jira/                  @mono/jira
  src/
    JiraConfig.ts                Config service: JIRA_BASE_URL, JIRA_API_TOKEN
    JiraClient.ts                Service: getIssue(key) -> Effect<Issue, JiraError>
    Issue.ts                     Schema.Class domain model + toMarkdown()
    errors.ts                    IssueNotFoundError, JiraAuthError, JiraHttpError

apps/cli/src/
  jira/show.ts                   `show <key> [--format markdown|json]` command
  index.ts                       wires jiraCommand + JiraClient.layer into the CLI
```

Keeping the Jira logic in `packages/jira` (not inline in the CLI) means it can
be reused later by other apps (e.g. an `ai-agent` package) without changes.

### Request flow

```
mono jira show PROJ-123
  → CLI parses key + --format
  → JiraClient.getIssue("PROJ-123")
  → GET {JIRA_BASE_URL}/rest/api/2/issue/PROJ-123
      Authorization: Bearer {JIRA_API_TOKEN}
      ?fields=summary,status,assignee,description
  → parse response into Issue (Schema)
  → render: markdown (default) or JSON (--format json)
```

## Data model

`packages/jira/src/Issue.ts`:

```typescript
class Issue extends Schema.Class<Issue>("Issue")({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  assignee: Schema.NullOr(Schema.String),   // displayName, or null if unassigned
  description: Schema.NullOr(Schema.String),
}) {
  toMarkdown(): string { ... }
}
```

Jira Server API v2 (`/rest/api/2/issue/{key}`) returns `description` as a plain
string (wiki markup), not ADF, so no additional document parsing is needed.
The raw response is decoded into a `RawIssue` shape and mapped to `Issue`.

## Service

`packages/jira/src/JiraClient.ts`:

```typescript
class JiraClient extends Context.Service<JiraClient, {
  readonly getIssue: (key: string) => Effect.Effect<Issue, JiraError>
}>()("@mono/JiraClient") {
  static readonly layer = Layer.effect(JiraClient, Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const config = yield* JiraConfig

    const getIssue = Effect.fn("JiraClient.getIssue")(function* (key: string) {
      const response = yield* http.get(
        `${config.baseUrl}/rest/api/2/issue/${key}`,
        { headers: { Authorization: `Bearer ${Redacted.value(config.token)}` } }
      )
      // map 404 -> IssueNotFoundError, 401/403 -> JiraAuthError, else -> JiraHttpError
      return yield* HttpClientResponse.schemaBodyJson(RawIssue)(response).pipe(
        Effect.map(toIssue)
      )
    })

    return { getIssue }
  }))
}
```

`packages/jira/src/JiraConfig.ts`:

```typescript
class JiraConfig extends Context.Service<JiraConfig, {
  readonly baseUrl: string
  readonly token: Redacted.Redacted
}>()("@mono/JiraConfig") {
  static readonly layer = Layer.effect(JiraConfig, Effect.gen(function* () {
    const baseUrl = yield* Config.string("JIRA_BASE_URL")
    const token = yield* Config.redacted("JIRA_API_TOKEN")
    return { baseUrl, token }
  }))

  static readonly testLayer = Layer.succeed(JiraConfig, {
    baseUrl: "https://jira.test",
    token: Redacted.make("test-token"),
  })
}
```

## Errors

`packages/jira/src/errors.ts`, modeled with `Schema.TaggedErrorClass`:

- `IssueNotFoundError({ key })` — HTTP 404
- `JiraAuthError({ status })` — HTTP 401/403
- `JiraHttpError({ key, error })` — any other HTTP/network failure

`JiraClient.getIssue` catches `HttpClientError` and maps by status code to one
of these, following the pattern in the project's `services-and-layers` guide.

## CLI command

`apps/cli/src/jira/show.ts`:

```typescript
const key = Argument.string("key").pipe(Argument.withDescription("Issue key, e.g. PROJ-123"))
const format = Flag.choice("format", ["markdown", "json"]).pipe(
  Flag.withDefault("markdown"),
  Flag.withDescription("Output format")
)

const showCommand = Command.make("show", { key, format }, ({ key, format }) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient
    const issue = yield* jira.getIssue(key)

    if (format === "json") {
      yield* Console.log(JSON.stringify(Schema.encodeSync(Issue)(issue), null, 2))
    } else {
      yield* Console.log(issue.toMarkdown())
    }
  }).pipe(
    Effect.catchTag("IssueNotFoundError", (e) => Console.error(`Issue not found: ${e.key}`)),
    Effect.catchTag("JiraAuthError", () => Console.error("Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN")),
    Effect.catchTag("JiraHttpError", (e) => Console.error(`Jira request failed: ${e.error}`)),
  )
)

const jiraCommand = Command.make("jira").pipe(
  Command.withDescription("Jira integration"),
  Command.withSubcommands([showCommand])
)
```

Errors are caught and printed as a readable message on stderr with a non-zero
exit code, instead of a raw stack trace.

`apps/cli/src/index.ts` adds `jiraCommand` to `Command.withSubcommands([...])`
and extends the provided layer with `JiraClient.layer`, `JiraConfig.layer`, and
`FetchHttpClient.layer` (re-exported from `@effect/platform-bun` as
`BunHttpClient`, backed by `effect/unstable/http/FetchHttpClient`) alongside
the existing `BunServices.layer`.

## Configuration

- `JIRA_BASE_URL` — e.g. `https://jira.company.internal`
- `JIRA_API_TOKEN` — Personal Access Token (Bearer), Jira Server/DC 8.14+

Both read via Bun's automatic `.env` loading (no `dotenv` dependency).

## Testing

`packages/jira` is tested with `@effect/vitest` (not `bun test`) — the one
deviation from the repo's default test runner, because exercising
`JiraClient.layer` requires swapping in a test `HttpClient` layer to simulate
200/404/401/network-failure responses, and `it.effect`/test layers are this
project's standard way of testing Effect services. `JiraConfig.testLayer`
supplies fixed config values in tests.

Cases to cover:
- successful fetch → `Issue` mapped correctly (including null assignee)
- 404 → `IssueNotFoundError`
- 401/403 → `JiraAuthError`
- other HTTP/network failure → `JiraHttpError`
- CLI: `--format json` produces valid JSON; default produces markdown

## Out of scope (explicitly deferred)

- Jira Cloud support (different auth, API v3, ADF descriptions)
- Comments, issue search/list, write operations
- Config file / CLI-flag-based credentials
- The rest of the `mono` blueprint (gitflow, ai-agent, imports-monitor, mcp daemon)
