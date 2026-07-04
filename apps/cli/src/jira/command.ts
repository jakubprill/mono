import { Command } from "effect/unstable/cli";
import { issueCommand } from "./issue/command.ts";

export const jiraCommand = Command.make("jira").pipe(
  Command.withDescription("Jira integration"),
  Command.withSubcommands([issueCommand]),
);
