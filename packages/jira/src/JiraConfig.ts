import { Config, Effect, Layer, Redacted } from "effect";
import * as Context from "effect/Context";

export class JiraConfig extends Context.Service<
  JiraConfig,
  {
    readonly baseUrl: string;
    readonly token: Redacted.Redacted;
  }
>()("@mono/JiraConfig") {
  static readonly layer = Layer.effect(
    JiraConfig,
    Effect.gen(function* () {
      const baseUrl = yield* Config.string("JIRA_BASE_URL").pipe(
        Config.map((url) => url.replace(/\/+$/, "")),
      );
      const token = yield* Config.redacted("JIRA_API_TOKEN");
      return { baseUrl, token };
    }),
  );

  static readonly testLayer = Layer.succeed(JiraConfig, {
    baseUrl: "https://jira.test",
    token: Redacted.make("test-token"),
  });
}
