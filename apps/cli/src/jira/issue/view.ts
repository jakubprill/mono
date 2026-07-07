import { JiraClient } from "@mono/jira";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { jiraLayer, reportAndFail } from "../layer.ts";
import { renderIssue } from "./render.ts";

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

const format = Flag.choice("format", ["markdown", "json"]).pipe(
  Flag.withDefault("markdown"),
  Flag.withDescription("Output format"),
);

export const viewCommand = Command.make(
  "view",
  { key, format },
  ({ key, format }) =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const issue = yield* jira.getIssue(key);
      yield* Console.log(renderIssue(issue, format));
    }).pipe(
      Effect.catchTag("IssueNotFoundError", (e) =>
        reportAndFail(`Issue not found: ${e.key}`, e),
      ),
      Effect.catchTag("JiraAuthError", (e) =>
        reportAndFail("Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN", e),
      ),
      Effect.catchTag("JiraHttpError", (e) =>
        reportAndFail(`Jira request failed: ${String(e.error)}`, e),
      ),
      Effect.provide(jiraLayer),
    ),
).pipe(Command.withDescription("View a Jira issue by key"));
