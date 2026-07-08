# CLI `--debug` / `-d` flag with OTLP tracing (design)

## Purpose

Add a `--debug`/`-d` global flag to `mono-cli` that, when passed, gives the
user visibility into what the CLI is doing:

1. Raises local console log verbosity to `Debug` (unless the user already
   passed `--log-level` explicitly, which always wins).
2. Exports distributed tracing spans over OTLP/HTTP to a local Jaeger
   instance, so operation timing and call structure (Jira API calls, git
   subprocess calls) can be inspected visually.
3. Exports structured logs over OTLP/HTTP alongside the spans, so log lines
   correlate with the trace in the Jaeger UI.

This targets local development/debugging of `mono-cli` (e.g. `work start`,
`jira issue view`), based on the Effect observability guide
(https://effect-ts-effect-smol.mintlify.app/advanced/observability) and the
`effect/unstable/observability` OTLP modules (`OtlpTracer`, `OtlpLogger`,
`OtlpSerialization`).

## Non-goals

- No metrics export (YAGNI — only tracing + logs requested).
- No production-grade OTLP collector config; `docker-compose.yml` provides a
  local, single-container `jaegertracing/all-in-one` for local dev only.
- No change to existing command behavior when `--debug` is not passed —
  `Effect.withSpan` is a no-op without a tracer layer, so there is zero
  overhead by default.

## Architecture

### New module: `apps/cli/src/observability.ts`

```ts
import { Config, Effect, Layer, Option, References } from "effect";
import { Flag, GlobalFlag } from "effect/unstable/cli";
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

export const CLI_VERSION = "0.0.1";

// Global flag: usable anywhere in the command line
// (`mono-cli --debug jira issue view KEY` or
//  `mono-cli jira issue view KEY --debug`), shows up in --help.
export const DebugFlag = GlobalFlag.setting("debug")({
  flag: Flag.boolean("debug").pipe(
    Flag.withAlias("d"),
    Flag.withDescription(
      "Verbose logging + OTLP tracing/log export to a local collector " +
        "(see apps/cli/docker-compose.yml). Endpoint overridable via " +
        "OTEL_EXPORTER_OTLP_ENDPOINT.",
    ),
  ),
});

const otlpEndpoint = Config.string("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
  Config.withDefault("http://localhost:4318"),
);

const resource = { serviceName: "mono-cli", serviceVersion: CLI_VERSION };

// Tracer + Logger only (no metrics). Requires HttpClient.HttpClient
// externally (NOT baked in here) so the caller controls the transport —
// production wires in FetchHttpClient.layer (see index.ts below), tests
// wire in a stub HttpClient that records requests instead of hitting the
// network. Baking FetchHttpClient.layer in here would capture its `Fetch`
// dependency at this module's layer-construction time, making it much
// harder for tests to override — see JiraClient.layer/JiraClient.test.ts
// for the same externalized-HttpClient pattern already used in this repo.
export const ObservabilityLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const endpoint = yield* otlpEndpoint;
    return Layer.merge(
      OtlpTracer.layer({ url: `${endpoint}/v1/traces`, resource }),
      OtlpLogger.layer({ url: `${endpoint}/v1/logs`, resource }),
    );
  }),
).pipe(Layer.provide(OtlpSerialization.layerJson));

// Active only when --debug is passed. Also raises MinimumLogLevel to Debug,
// but only if the user did not explicitly pass --log-level (that always
// wins, since GlobalFlag.LogLevel is read here and respected). Still
// requires HttpClient.HttpClient externally, same reasoning as above.
export const DebugLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const debug = yield* DebugFlag;
    if (!debug) return Layer.empty;
    const explicitLogLevel = yield* GlobalFlag.LogLevel;
    return Option.isNone(explicitLogLevel)
      ? Layer.merge(ObservabilityLayer, Layer.succeed(References.MinimumLogLevel, "Debug"))
      : ObservabilityLayer;
  }),
);
```

### `apps/cli/src/index.ts`

```ts
const cli = Command.make("mono-cli", {}).pipe(
  Command.withDescription("mono CLI"),
  Command.withSubcommands([greet, jiraCommand, configCommand, workCommand]),
  Command.withGlobalFlags([DebugFlag]),
  Command.provide(DebugLayer),
  // Satisfies DebugLayer's HttpClient.HttpClient requirement in production.
  Command.provide(FetchHttpClient.layer),
);

const program = Command.run(cli, { version: CLI_VERSION }).pipe(
  Effect.withSpan("mono-cli"),
);

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
```

**Why this shape:** `GlobalFlag.setting` values are exposed to command
handlers as a `Context.Service`, read via `yield*`. `Command.provide` wraps
the *entire* composed command-tree handler (including subcommand dispatch)
with a layer built from an effect — and that effect can itself read
`DebugFlag`/`GlobalFlag.LogLevel`, because `Command.runWith` provides all
active `Setting` global flags onto the whole handler effect from the
outside, satisfying any nested requirement for those same tags. This means:

- No changes needed in any existing subcommand file to wire up the flag.
- `--debug` is validated/parsed by the CLI framework and shows up in
  `--help`, with alias `-d`.
- `Effect.withSpan("mono-cli")` around `Command.run(...)` is always present
  but harmless — Effect's default `Tracer` is a no-op, so without `--debug`
  there is no tracer layer and the span is simply discarded.

**Flush on exit:** `OtlpTracer`/`OtlpLogger` batch-export and flush when
their surrounding `Scope` closes (default `shutdownTimeout` of 3s). Because
`DebugLayer` is provided via `Command.provide` (tied to the command's own
run scope) and `BunRuntime.runMain` awaits the full effect including layer
teardown, even fast single-shot commands (e.g. `jira issue view`) will
flush their spans/logs before the process exits — no explicit flush call
needed.

## Instrumentation (span tree)

- `apps/cli/src/jira/issue/view.ts`, `move.ts`, `apps/cli/src/work/start.ts`:
  wrap the command's handler `Effect.gen(...)` in
  `Effect.withSpan("jira.issue.view")` / `"jira.issue.move"` /
  `"work.start"` and `Effect.annotateCurrentSpan({ "jira.issue_key": key })`
  where a key is available. This is the "root span" per invocation, child of
  the top-level `"mono-cli"` span.
- `packages/jira/src/JiraClient.ts`: already uses `Effect.fn("JiraClient.*")`
  for each method (auto-named spans per the Effect tracing best practices).
  Add `Effect.annotateSpans({ "jira.issue_key": key })` to each method for
  richer span attributes (no structural change).
- `packages/git/src/GitClient.ts`: `run()` has no span today. Wrap it with a
  dynamically-named span: `Effect.withSpan(\`git.${args[0]}\`, { attributes: { "git.args": args.join(" ") } })`
  so each git subprocess call (`rev-parse`, `checkout`, `symbolic-ref`) is
  its own named child span.

Resulting example trace for `mono-cli work start KEY --debug`:

```
mono-cli
└─ work.start (jira.issue_key=KEY)
   ├─ JiraClient.getIssue
   │  └─ JiraClient.fetchIssueResponse
   ├─ git.symbolic-ref
   ├─ git.checkout
   ├─ JiraClient.getTransitions
   └─ JiraClient.transitionIssue
```

## Local Jaeger setup

New file `apps/cli/docker-compose.yml`:

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686" # UI
      - "4318:4318" # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

## Documentation

`apps/cli/README.md` gets a new "Debugging / Tracing" section:

- `docker compose -f apps/cli/docker-compose.yml up -d` to start Jaeger.
- `mono-cli work start KEY --debug` (or `-d`) to run with tracing/verbose
  logs enabled.
- Open http://localhost:16686 and select the `mono-cli` service to inspect
  traces.
- `OTEL_EXPORTER_OTLP_ENDPOINT` env var to point at a different collector
  (defaults to `http://localhost:4318`).

## Error handling

- If the OTLP endpoint is unreachable (e.g. Jaeger not running), the
  `OtlpExporter`'s batch export simply fails/retries in the background per
  its existing internal behavior — this must not crash or block the CLI
  command itself; the command's own success/failure is independent of
  whether the trace/log export succeeds. No new error handling code is
  needed here since this is already how `OtlpExporter` behaves (fire depending
  on export interval, not blocking the main fiber).

## Testing

New test file `apps/cli/tests/observability.test.ts` builds a small
throwaway `Command.make("test", {}, ...)` wired with `DebugFlag`/`DebugLayer`
(same pattern as the `effect/unstable/cli` test suite for `GlobalFlag`), run
via `Command.runWith`. `HttpClient.HttpClient` is supplied as
`FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, mockFetch)))`
— the exact stubbing pattern already used in
`packages/jira/tests/JiraClient.test.ts` — so requests never touch the
network. Because `OtlpExporter` flushes its buffer as a scope finalizer (see
`OtlpExporter.ts`), the final POST happens as soon as the command's effect
(and its layer scope) completes — no need to wait out the export interval.

- Without `--debug`: running the test command makes zero requests to the
  mock fetch, and `References.MinimumLogLevel` (read inside the handler)
  is unchanged (`"Info"`, the framework default).
- With `--debug`: running the test command results in at least one request
  captured by the mock fetch (to a `/v1/traces` or `/v1/logs` URL), and
  `References.MinimumLogLevel` reads as `"Debug"`.
- With `--debug --log-level warn`: `References.MinimumLogLevel` reads as
  `"Warn"` (explicit `--log-level` wins over `--debug`'s auto-Debug), while
  requests are still captured (tracing/log export stays on regardless of
  console verbosity).

## Files touched

- `apps/cli/src/observability.ts` (new)
- `apps/cli/src/index.ts` (wire up global flag + layer + top span)
- `apps/cli/src/jira/issue/view.ts`, `move.ts`, `apps/cli/src/work/start.ts`
  (per-command root spans)
- `packages/jira/src/JiraClient.ts` (span attributes)
- `packages/git/src/GitClient.ts` (per-subcommand spans)
- `apps/cli/docker-compose.yml` (new)
- `apps/cli/README.md` (docs)
- `apps/cli/tests/observability.test.ts` (new)
