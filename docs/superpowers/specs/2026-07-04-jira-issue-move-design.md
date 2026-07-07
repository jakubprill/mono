# Jira Issue Move — Design

**Date:** 2026-07-04
**Status:** Draft

## Objective

Add a `mono-cli jira issue move <key>` command that transitions a Jira
Server/Data Center issue through its workflow, and restructure the existing
`jira show` command into an `issue` subcommand group (`jira issue view`) to
make room for it.

## Scope

- Rename `mono-cli jira show <key>` → `mono-cli jira issue view <key>`. Same
  flags, same behavior — just renamed and nested under a new `issue` group.
- New `mono-cli jira issue move <key>` command:
  - Fetches the transitions available from the issue's *current* status
    (Jira workflows are per-project/per-issue-type and status-dependent, so
    this list can't be known statically — it must be queried per issue).
  - Presents them as an interactive picker (arrow keys + enter). No free-text
    status argument — this avoids the ambiguity between a transition's action
    name (e.g. "Start Progress") and its destination status name (e.g. "In
    Progress"), which can differ and aren't reliably guessable.
  - Executes the chosen transition and prints a confirmation.
- Out of scope: non-interactive/scripted status argument (e.g. `move <key>
  <status>` for CI use), `issue create`, `issue comment`, `list`/`search`,
  `worklog`, `jira init`, Jira Cloud support — all deferred, per the wider
  spec this slice was carved out of.

## Architecture

```
apps/cli/src/jira/
  command.ts                 top-level `jira` command: withSubcommands([issueCommand])
  issue/
    command.ts                `issue` group: withSubcommands([viewCommand, moveCommand])
    view.ts                   (renamed from jira/show.ts) `view <key> [--format]`
    move.ts                   new: `move <key>` — interactive transition picker
    render.ts                 (moved as-is from jira/render.ts)

packages/jira/src/
  JiraClient.ts               + getTransitions(key), + transitionIssue(key, transitionId)
  Transition.ts               new Schema.Class: { id, name, toStatus }
  Issue.ts                    unchanged
  errors.ts                   unchanged — reused for the new methods
  JiraConfig.ts                unchanged
  index.ts                    + export * from "./Transition.ts"
```

`apps/cli/tests/jira/render.test.ts` moves to
`apps/cli/tests/jira/issue/render.test.ts` alongside the source move.

Keeping `getTransitions`/`transitionIssue` in `packages/jira` (not inline in
the CLI) preserves reusability for other future consumers (e.g. an
`ai-agent` package), consistent with the existing `getIssue` split. The
interactive picker itself is CLI-only concern and lives in `apps/cli`.

### Request flow

```
mono-cli jira issue move PROJ-123
  → JiraClient.getTransitions("PROJ-123")
      GET {baseUrl}/rest/api/2/issue/PROJ-123/transitions
      Authorization: Bearer {JIRA_API_TOKEN}
  → if empty: print "No transitions available for PROJ-123" and exit 0
  → Prompt.select({
      choices: transitions.map(t => ({
        title: t.name === t.toStatus ? t.toStatus : `${t.toStatus} (${t.name})`,
        value: t.id,
      }))
    })
  → JiraClient.transitionIssue("PROJ-123", chosenId)
      POST {baseUrl}/rest/api/2/issue/PROJ-123/transitions
      Authorization: Bearer {JIRA_API_TOKEN}
      body: { "transition": { "id": chosenId } }
  → print confirmation, e.g. "PROJ-123 → In Progress"
```

`Prompt.select` is `effect/unstable/cli`'s built-in interactive list prompt
(`Prompt.ts` in the `effect` package), already available as a dependency —
no new package needed.

## Data model

`packages/jira/src/Transition.ts`:

```typescript
class RawTransition extends Schema.Class<RawTransition>("RawTransition")({
  id: Schema.String,
  name: Schema.String,
  to: Schema.Struct({ name: Schema.String }),
}) {}

class RawTransitions extends Schema.Class<RawTransitions>("RawTransitions")({
  transitions: Schema.Array(RawTransition),
}) {}

export class Transition extends Schema.Class<Transition>("Transition")({
  id: Schema.String,
  name: Schema.String,       // transition/action name, e.g. "Start Progress"
  toStatus: Schema.String,   // destination status name, e.g. "In Progress"
}) {}

export const toTransition = (raw: RawTransition): Transition =>
  new Transition({ id: raw.id, name: raw.name, toStatus: raw.to.name });
```

## Service

`packages/jira/src/JiraClient.ts` gains two methods, following the same
`Effect.fn` + `mapError` pattern as `getIssue`:

```typescript
readonly getTransitions: (key: string) => Effect.Effect<ReadonlyArray<Transition>, JiraError>
readonly transitionIssue: (key: string, transitionId: string) => Effect.Effect<void, JiraError>
```

- `getTransitions`: `GET /rest/api/2/issue/{key}/transitions`, decode with
  `RawTransitions`, map each entry via `toTransition`. Errors map the same
  way as `getIssue` (404 → `IssueNotFoundError`, 401/403 → `JiraAuthError`,
  else → `JiraHttpError`).
- `transitionIssue`: `POST /rest/api/2/issue/{key}/transitions` with body
  `{ transition: { id: transitionId } }`. Same error mapping. A 400 (e.g. the
  chosen transition became invalid between fetch and pick, due to a
  concurrent status change) falls through to `JiraHttpError` — no new error
  type, since the picker only ever offers transitions that were valid at
  fetch time.

## CLI commands

`apps/cli/src/jira/issue/view.ts` — identical to the current `show.ts`, just
renamed (`Command.make("view", ...)`) and moved into `jira/issue/`.

`apps/cli/src/jira/issue/move.ts`:

```typescript
const key = Argument.string("key").pipe(Argument.withDescription("Issue key, e.g. PROJ-123"));

const moveCommand = Command.make("move", { key }, ({ key }) =>
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
          title: t.name === t.toStatus ? t.toStatus : `${t.toStatus} (${t.name})`,
          value: t.id,
        })),
      }),
    );

    yield* jira.transitionIssue(key, chosenId);
    const target = transitions.find((t) => t.id === chosenId);
    yield* Console.log(`${key} → ${target?.toStatus}`);
  }).pipe(
    Effect.catchTag("IssueNotFoundError", (e) => reportAndFail(`Issue not found: ${e.key}`, e)),
    Effect.catchTag("JiraAuthError", (e) => reportAndFail("Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN", e)),
    Effect.catchTag("JiraHttpError", (e) => reportAndFail(`Jira request failed: ${String(e.error)}`, e)),
    Effect.provide(jiraLayer),
  ),
).pipe(Command.withDescription("Move a Jira issue to a new status"));

export const issueCommand = Command.make("issue").pipe(
  Command.withDescription("Jira issue commands"),
  Command.withSubcommands([viewCommand, moveCommand]),
);
```

`apps/cli/src/jira/command.ts` (new, replaces the top-level export currently
in `show.ts`):

```typescript
export const jiraCommand = Command.make("jira").pipe(
  Command.withDescription("Jira integration"),
  Command.withSubcommands([issueCommand]),
);
```

`apps/cli/src/index.ts` updates its import from `./jira/show.ts` to
`./jira/command.ts`.

No `--json`/`--format` flag on `move` — it's interactive-only by design, so
there's no non-interactive output to format.

## Configuration

Unchanged: `JIRA_BASE_URL`, `JIRA_API_TOKEN`.

## Testing

`packages/jira` (`@effect/vitest`, same as existing `JiraClient.test.ts`):

- `getTransitions`: successful fetch → `Transition[]` mapped correctly
  (including when `name === to.name`); empty list; 404 → `IssueNotFoundError`;
  401/403 → `JiraAuthError`; other failure → `JiraHttpError`.
- `transitionIssue`: successful POST (2xx, no body needed); 404 → `IssueNotFoundError`;
  401/403 → `JiraAuthError`; other failure → `JiraHttpError`.

`apps/cli`:

- `render.test.ts` moves to `jira/issue/` unchanged — no new rendering logic
  for `move` to test there.
- Manual verification of the interactive picker (arrow-key selection isn't
  practical to unit test through `effect`'s CLI harness); the underlying
  `getTransitions`/`transitionIssue` logic is fully covered above.

## Out of scope (explicitly deferred)

- Non-interactive `move <key> <status>` variant for scripts/CI
- `issue create`, `issue comment`, `list`/`search`, `worklog log`, `jira init`
- Jira Cloud support, config file-based credentials
- The rest of the wider `mono-cli jira` blueprint from the original spec note
