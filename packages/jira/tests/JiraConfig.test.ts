import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { JiraConfig } from "../src/JiraConfig.ts";

describe("JiraConfig", () => {
  it.effect("reads baseUrl and token from environment config", () => {
    const layer = JiraConfig.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            JIRA_BASE_URL: "https://jira.example.com",
            JIRA_TOKEN: "secret-token",
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const config = yield* JiraConfig;
      expect(config.baseUrl).toBe("https://jira.example.com");
      expect(Redacted.value(config.token)).toBe("secret-token");
    }).pipe(Effect.provide(layer));
  });

  it.effect("testLayer provides fixed values", () =>
    Effect.gen(function* () {
      const config = yield* JiraConfig;
      expect(config.baseUrl).toBe("https://jira.test");
      expect(Redacted.value(config.token)).toBe("test-token");
    }).pipe(Effect.provide(JiraConfig.testLayer)),
  );
});
