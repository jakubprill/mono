import type { JiraError } from "@mono/jira";
import { JiraClient, JiraConfig } from "@mono/jira";
import { Console, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

export const jiraLayer = JiraClient.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(JiraConfig.layer),
);

export const reportAndFail = (message: string, error: JiraError) =>
  Console.error(message).pipe(Effect.andThen(Effect.fail(error)));
