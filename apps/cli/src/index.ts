import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

const name = Argument.string("name").pipe(Argument.withDefault("World"));
const shout = Flag.boolean("shout").pipe(Flag.withAlias("s"));

const greet = Command.make("greet", { name, shout }, ({ name, shout }) => {
  const message = `Hello, ${name}!`;
  return Console.log(shout ? message.toUpperCase() : message);
});

const cli = Command.make("mono-cli", {}).pipe(
  Command.withDescription("mono CLI"),
  Command.withSubcommands([greet]),
);

const program = Command.run(cli, {
  version: "0.0.1",
});

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
