import { JiraClient } from "@mono/jira";
import { Console, Effect } from "effect";
import { Argument, Command, Prompt } from "effect/unstable/cli";
import { jiraLayer, reportAndFail } from "../layer.ts";

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

export const moveCommand = Command.make("move", { key }, ({ key }) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient;
    const transitions = yield* jira.getTransitions(key);

    if (transitions.length === 0) {
      yield* Console.log(`No transitions available for ${key}`);
      return;
    }

    const chosenId = yield* Prompt.run(
      Prompt.select({
        message: `Move ${key} to:`,
        choices: transitions.map((t) => ({
          title:
            t.name === t.toStatus ? t.toStatus : `${t.toStatus} (${t.name})`,
          value: t.id,
        })),
      }),
    );

    yield* jira.transitionIssue(key, chosenId);
    const target = transitions.find((t) => t.id === chosenId);
    yield* Console.log(`${key} → ${target?.toStatus}`);
  }).pipe(
    Effect.catchTag("QuitError", () => Console.log("Cancelled.")),
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
).pipe(Command.withDescription("Move a Jira issue to a new status"));
