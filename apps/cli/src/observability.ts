import { Config, Effect, Layer, Option, References } from "effect";
import { Flag, GlobalFlag } from "effect/unstable/cli";
import {
  OtlpLogger,
  OtlpSerialization,
  OtlpTracer,
} from "effect/unstable/observability";

export const CLI_VERSION = "0.0.1";

/**
 * Global flag: usable anywhere in the command line
 * (`mono-cli --debug jira issue view KEY` or
 * `mono-cli jira issue view KEY --debug`), shows up in --help.
 */
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

/**
 * Tracer + Logger only (no metrics). Requires `HttpClient.HttpClient`
 * externally (NOT baked in here) so the caller controls the transport —
 * production wires in `FetchHttpClient.layer` (see index.ts), tests wire in
 * a stub that records requests instead of hitting the network. Baking
 * `FetchHttpClient.layer` in here would capture its `Fetch` dependency at
 * this module's layer-construction time, making it much harder for tests
 * to override — see `packages/jira/src/JiraClient.ts` /
 * `packages/jira/tests/JiraClient.test.ts` for the same
 * externalized-HttpClient pattern already used in this repo.
 */
export const ObservabilityLayer = Layer.unwrap(
  Effect.gen(function* () {
    const endpoint = yield* otlpEndpoint;
    return Layer.merge(
      OtlpTracer.layer({ url: `${endpoint}/v1/traces`, resource }),
      OtlpLogger.layer({ url: `${endpoint}/v1/logs`, resource }),
    );
  }),
).pipe(Layer.provide(OtlpSerialization.layerJson));

/**
 * Active only when --debug is passed. Also raises MinimumLogLevel to
 * Debug, but only if the user did not explicitly pass --log-level (that
 * always wins, since GlobalFlag.LogLevel is read here and respected).
 * Still requires HttpClient.HttpClient externally, same reasoning as
 * ObservabilityLayer above.
 */
export const DebugLayer = Layer.unwrap(
  Effect.gen(function* () {
    const debug = yield* DebugFlag;
    if (!debug) return Layer.empty;
    const explicitLogLevel = yield* GlobalFlag.LogLevel;
    return Option.isNone(explicitLogLevel)
      ? Layer.merge(
          ObservabilityLayer,
          Layer.succeed(References.MinimumLogLevel, "Debug"),
        )
      : ObservabilityLayer;
  }),
);
