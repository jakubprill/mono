import { Command } from "effect/unstable/cli";
import { moveCommand } from "./move.ts";
import { viewCommand } from "./view.ts";

export const issueCommand = Command.make("issue").pipe(
  Command.withDescription("Jira issue commands"),
  Command.withSubcommands([viewCommand, moveCommand]),
);
