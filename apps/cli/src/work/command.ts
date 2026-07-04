import { Command } from "effect/unstable/cli";
import { startCommand } from "./start.ts";

export const workCommand = Command.make("work").pipe(
  Command.withDescription("Work orchestration across git and Jira"),
  Command.withSubcommands([startCommand]),
);
