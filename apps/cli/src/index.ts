import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { configCommand } from "./config/command.ts";
import { jiraCommand } from "./jira/command.ts";
import { CLI_VERSION, DebugFlag, DebugLayer } from "./observability.ts";
import { workCommand } from "./work/command.ts";

const name = Argument.string("name").pipe(Argument.withDefault("World"));
const shout = Flag.boolean("shout").pipe(Flag.withAlias("s"));

const greet = Command.make("greet", { name, shout }, ({ name, shout }) => {
  const message = `Hello, ${name}!`;
  return Console.log(shout ? message.toUpperCase() : message);
});

const cli = Command.make("mono-cli", {}).pipe(
  Command.withDescription("mono CLI"),
  Command.withSubcommands([greet, jiraCommand, configCommand, workCommand]),
  // DebugLayer/FetchHttpClient.layer are applied first so their added
  // requirements (DebugFlag, GlobalFlag.LogLevel, HttpClient.HttpClient) are
  // already part of R — withGlobalFlags must run last so it can exclude
  // DebugFlag/LogLevel from R (DebugLayer reads GlobalFlag.LogLevel
  // internally to detect an explicit --log-level override).
  Command.provide(DebugLayer),
  // Satisfies DebugLayer's HttpClient.HttpClient requirement in production.
  Command.provide(FetchHttpClient.layer),
  Command.withGlobalFlags([DebugFlag, GlobalFlag.LogLevel]),
);

const program = Command.run(cli, {
  version: CLI_VERSION,
}).pipe(Effect.withSpan("mono-cli"));

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
