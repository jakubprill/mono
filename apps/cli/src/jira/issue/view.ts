import { JiraClient } from "@mono/jira";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { jiraLayer, reportAndFail } from "../layer.ts";

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

const raw = Flag.boolean("raw").pipe(
  Flag.withDescription("Print the raw Jira API response as-is"),
);

export const viewCommand = Command.make("view", { key, raw }, ({ key, raw }) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient;
    if (raw) {
      const body = yield* jira.getIssueRaw(key);
      yield* Console.log(body);
    } else {
      const issue = yield* jira.getIssue(key);
      yield* Console.log(issue.toMarkdown());
    }
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
