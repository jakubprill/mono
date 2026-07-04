import type { JiraError } from "@mono/jira";
import { JiraClient, JiraConfig } from "@mono/jira";
import { Console, Effect, Layer } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { renderIssue } from "./render.ts";

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

const format = Flag.choice("format", ["markdown", "json"]).pipe(
  Flag.withDefault("markdown"),
  Flag.withDescription("Output format"),
);

const jiraLayer = JiraClient.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(JiraConfig.layer),
);

const reportAndFail = (message: string, error: JiraError) =>
  Console.error(message).pipe(Effect.andThen(Effect.fail(error)));

const showCommand = Command.make("show", { key, format }, ({ key, format }) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient;
    const issue = yield* jira.getIssue(key);
    yield* Console.log(renderIssue(issue, format));
  }).pipe(
    Effect.catchTag("IssueNotFoundError", (e) =>
      reportAndFail(`Issue not found: ${e.key}`, e),
    ),
    Effect.catchTag("JiraAuthError", (e) =>
      reportAndFail("Auth error — check JIRA_BASE_URL and JIRA_TOKEN", e),
    ),
    Effect.catchTag("JiraHttpError", (e) =>
      reportAndFail(`Jira request failed: ${String(e.error)}`, e),
    ),
    Effect.provide(jiraLayer),
  ),
).pipe(Command.withDescription("Show a Jira issue by key"));

export const jiraCommand = Command.make("jira").pipe(
  Command.withDescription("Jira integration"),
  Command.withSubcommands([showCommand]),
);
