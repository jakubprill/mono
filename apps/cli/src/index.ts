import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { initCommand } from "./init/command.ts";
import { jiraCommand } from "./jira/command.ts";
import { CLI_VERSION, DebugFlag, DebugLayer } from "./observability.ts";
import { workCommand } from "./work/command.ts";

const cli = Command.make("mono-cli", {}).pipe(
  Command.withDescription("mono CLI"),
  Command.withSubcommands([initCommand, jiraCommand, workCommand]),
  // Ordering here is a TypeScript-only constraint, not a runtime one:
  // `Command.withGlobalFlags`'s `Exclude<R, ...>` can only strip types
  // already present in R at the point it's called in this pipe, so it
  // must come after the `Command.provide` calls below that introduce the
  // DebugFlag/GlobalFlag.LogLevel requirements (DebugLayer reads both
  // internally to detect an explicit --log-level override). At runtime,
  // `Command.provide` only wraps `.handle` and `withGlobalFlags` only
  // updates flag metadata used by `Command.runWith` — they don't interact,
  // so this ordering exists purely to keep `tsc --noEmit` clean.
  Command.provide(DebugLayer),
  // Satisfies DebugLayer's HttpClient.HttpClient requirement in production.
  Command.provide(FetchHttpClient.layer),
  Command.withGlobalFlags([DebugFlag, GlobalFlag.LogLevel]),
);

const program = Command.run(cli, {
  version: CLI_VERSION,
}).pipe(Effect.withSpan("mono-cli"));

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
