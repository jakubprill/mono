import { GitClient } from "@mono/git";
import { JiraClient } from "@mono/jira";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import type { ResolvedConfig } from "../config/Config.ts";
import { loadConfig } from "../config/loadConfig.ts";
import { jiraLayer, reportAndFail } from "../jira/layer.ts";
import { renderBranchName, resolveBranchType, slugify } from "./branchName.ts";

export const startWork = (
  key: string,
  sourceOverride: string | undefined,
  config: ResolvedConfig,
) =>
  Effect.gen(function* () {
    const jira = yield* JiraClient;
    const git = yield* GitClient;

    const issue = yield* jira.getIssue(key);

    const base = sourceOverride
      ? sourceOverride
      : config.sourceBranches.length > 0
        ? yield* Prompt.run(
            Prompt.select({
              message: "Base branch:",
              choices: config.sourceBranches.map((branch) => ({
                title: branch,
                value: branch,
              })),
            }),
          )
        : yield* git.defaultRemoteBranch;

    const branchName = renderBranchName(config.branchPattern, {
      type: resolveBranchType(issue.issueType, config.branchTypeAliases),
      key,
      slug: slugify(issue.summary),
    });

    yield* git.createBranch(branchName, base);

    if (config.startStatus === undefined) {
      return `Created ${branchName} from ${base}`;
    }

    const transitions = yield* jira.getTransitions(key);
    const target = transitions.find((t) => t.toStatus === config.startStatus);

    if (target === undefined) {
      const available = transitions.map((t) => t.toStatus).join(", ") || "none";
      yield* Console.error(
        `No transition to "${config.startStatus}" for ${key}. Available: ${available}`,
      );
      return `Created ${branchName} from ${base}`;
    }

    yield* jira.transitionIssue(key, target.id);
    return `Created ${branchName} from ${base}, ${key} → ${target.toStatus}`;
  });

const key = Argument.string("key").pipe(
  Argument.withDescription("Issue key, e.g. PROJ-123"),
);

const source = Flag.string("source").pipe(
  Flag.withAlias("s"),
  Flag.optional,
  Flag.withDescription("Base branch to create from (skips the prompt)"),
);

export const startCommand = Command.make(
  "start",
  { key, source },
  ({ key, source }) =>
    Effect.gen(function* () {
      const config = yield* loadConfig;
      const message = yield* startWork(
        key,
        Option.getOrUndefined(source),
        config,
      );
      yield* Console.log(message);
    }).pipe(
      Effect.catchTag("QuitError", () => Console.log("Cancelled.")),
      Effect.catchTag("IssueNotFoundError", (e) =>
        reportAndFail(`Issue not found: ${e.key}`, e),
      ),
      Effect.catchTag("JiraAuthError", (e) =>
        reportAndFail("Auth error — check JIRA_BASE_URL and JIRA_API_TOKEN", e),
      ),
      Effect.catchTag("JiraHttpError", (e) =>
        reportAndFail(`Jira request failed: ${String(e.error)}`, e),
      ),
      Effect.catchTag("GitCommandError", (e) =>
        Console.error(`git failed: ${e.command}\n${e.stderr}`).pipe(
          Effect.andThen(Effect.fail(e)),
        ),
      ),
      Effect.catchTag("ConfigError", (e) =>
        Console.error(`Invalid config (${e.filePath}): ${e.message}`).pipe(
          Effect.andThen(Effect.fail(e)),
        ),
      ),
      Effect.provide([jiraLayer, GitClient.layer]),
    ),
).pipe(
  Command.withDescription(
    "Start work on a Jira issue: create a branch and transition its status",
  ),
);
