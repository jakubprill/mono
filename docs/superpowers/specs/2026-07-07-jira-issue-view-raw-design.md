# Jira Issue View — `--raw` Flag — Design

**Date:** 2026-07-07
**Status:** Approved

## Objective

`mono-cli jira issue view <KEY> --format json` today only shows a narrow,
hand-modeled subset of the Jira issue (`summary`, `status`, `assignee`,
`description`, `issueType`). Jira's actual response contains many more
fields — most notably a long tail of `customfield_*` entries (story points,
sprint, epic link, etc.) — that the current `RawFields` schema silently drops
during decoding. Users have no way to see them.

This design replaces the narrow JSON output with a true passthrough of the
raw Jira API response, modeled on `jira-cli`'s `--raw` flag.

## Scope

- `jira issue view <KEY>` gets a new `--raw` boolean flag.
- `--raw` prints the exact response body Jira returned for
  `GET /rest/api/2/issue/{key}` — unmodified, uncompacted, not re-parsed —
  so every field (including all `customfield_*` keys) is visible.
- The existing `--format markdown|json` flag is removed. Default behavior
  (no flag) is unchanged: render via `Issue.toMarkdown()`.
- Out of scope (separate, independent effort — see "Deferred" below): a
  global `--debug`/`-d` flag across the whole CLI that logs outgoing HTTP
  requests via Effect logging. This touches CLI-wide infrastructure, not
  just the jira issue view command, and will get its own brainstorming/spec.
- Out of scope: friendly/named access to specific custom fields (e.g. a
  config-driven `customfield_10008` → `Story Points` mapping). The user
  confirmed they want the full raw payload, not a curated subset — a named-
  field mapping can be revisited later if `--raw` proves insufficient.
- Out of scope: changing what Jira is asked for. Jira's default field set
  (no `fields` query param) already includes custom fields; the bug is
  purely that our code discards them after the fact, not that we request
  too little.

## Why raw response text, not parse-and-reencode

`getIssueRaw` returns the literal HTTP response body text
(`HttpClientResponse.text`), not a JSON value that gets `JSON.stringify`'d
back out. Two reasons:

1. **Fidelity.** Parsing and re-serializing risks subtly changing the
   output (key order, number formatting) even though it's meant to be an
   exact mirror of what Jira sent.
2. **Simplicity.** No decoding step is needed at all — the raw text is the
   raw text.

No pretty-printing either: this mirrors `gh api`, `kubectl -o json`, and
`jira-cli`'s `--raw`, which all emit compact JSON as returned by the server
and expect the user to pipe through `jq .` if they want formatting.

## Architecture

```
packages/jira/src/JiraClient.ts
  private fetchIssueResponse(key) -> Effect<HttpClientResponse, JiraError>
    (shared by both methods below; wraps the existing http.get(...) call)

  getIssue(key) -> Effect<Issue, JiraError>
    fetchIssueResponse(key) -> HttpClientResponse.schemaBodyJson(RawIssue) -> toIssue
    (unchanged behavior; used by `jira issue view` markdown path and `work start`)

  getIssueRaw(key) -> Effect<string, JiraError>
    fetchIssueResponse(key) -> response.text
    (new; used only by `jira issue view --raw`)

apps/cli/src/jira/issue/view.ts
  Flag.boolean("raw") replaces Flag.choice("format", ["markdown", "json"])
  --raw          -> jira.getIssueRaw(key) -> Console.log(text)
  (default)      -> jira.getIssue(key) -> Console.log(issue.toMarkdown())
```

`apps/cli/src/jira/issue/render.ts` and
`apps/cli/tests/jira/issue/render.test.ts` are deleted. `render.ts` was a
thin wrapper: its markdown path just called `issue.toMarkdown()` (already
covered by `packages/jira/tests/Issue.test.ts`), and its json path
(`Schema.encodeSync(Issue)(issue)`) is exactly the narrow encoding this
design removes. Nothing else references either file.

## Interface change

`JiraClient`'s `Context.Service` interface gains a method:

```typescript
readonly getIssueRaw: (key: string) => Effect.Effect<string, JiraError>
```

This ripples to every fake `JiraClient` layer built with
`Layer.succeed(JiraClient, {...})` — currently just
`apps/cli/tests/work/start.test.ts`, which needs `getIssueRaw` added (unused
by that test, but required to satisfy the type).

## CLI command

```typescript
const raw = Flag.boolean("raw").pipe(
  Flag.withDescription("Print the raw Jira API response as-is"),
);

export const viewCommand = Command.make(
  "view",
  { key, raw },
  ({ key, raw }) =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      if (raw) {
        const body = yield* jira.getIssueRaw(key);
        yield* Console.log(body);
      } else {
        const issue = yield* jira.getIssue(key);
        yield* Console.log(issue.toMarkdown());
      }
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

Error handling is unchanged in both branches — `getIssueRaw` reuses the same
`mapError` (404 → `IssueNotFoundError`, 401/403 → `JiraAuthError`, else →
`JiraHttpError`) as `getIssue`.

## Testing

- `packages/jira/tests/JiraClient.test.ts`: new `describe("JiraClient.getIssueRaw")`
  block.
  - Success case: mock a response using the existing `rawIssueJson(overrides)`
    helper, call `getIssueRaw`, assert the returned string, parsed via
    `JSON.parse`, deep-equals the mocked body. No need to specifically craft
    a `customfield_*`-laden fixture — the point is proving the passthrough
    is lossless for whatever Jira sends, and the existing minimal fixture
    already demonstrates that.
  - Error cases: reuse the same 404 → `IssueNotFoundError` and
    401/403 → `JiraAuthError` assertions already used for `getIssue`.
- `apps/cli/tests/work/start.test.ts`: add
  `getIssueRaw: () => Effect.succeed("")` to the `fakeJira` layer builder so
  it continues to satisfy the `JiraClient` interface.
- `apps/cli/tests/jira/issue/render.test.ts` is deleted (see Architecture).

## Deferred (separate effort)

Global `--debug`/`-d` flag for the whole CLI, showing outgoing HTTP requests
via Effect logging. Independent of this change — cross-cutting CLI
infrastructure rather than a jira-issue-view concern. To be brainstormed and
spec'd separately.
