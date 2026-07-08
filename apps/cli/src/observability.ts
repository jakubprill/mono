import { Config, Effect, Layer } from "effect";
import { Flag, GlobalFlag } from "effect/unstable/cli";

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

export const otlpEndpoint = Config.string("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
  Config.withDefault("http://localhost:4318"),
);

export const resource = {
  serviceName: "mono-cli",
  serviceVersion: CLI_VERSION,
};

// Placeholder — replaced with the real conditional layer in Task 2.
export const DebugLayer = Layer.unwrap(Effect.succeed(Layer.empty));
