import { Command } from "effect/unstable/cli";
import { schemaCommand } from "./schema.ts";

export const configCommand = Command.make("config").pipe(
  Command.withDescription("mono.config.json helpers"),
  Command.withSubcommands([schemaCommand]),
);
