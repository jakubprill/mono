import { Effect, Layer, Redacted, type Schema } from "effect";
import * as Context from "effect/Context";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  IssueNotFoundError,
  JiraAuthError,
  type JiraError,
  JiraHttpError,
} from "./errors.ts";
import { type Issue, RawIssue, toIssue } from "./Issue.ts";
import { JiraConfig } from "./JiraConfig.ts";

const mapError = (
  key: string,
  error: HttpClientError.HttpClientError | Schema.SchemaError,
): Effect.Effect<never, JiraError> => {
  if (
    HttpClientError.isHttpClientError(error) &&
    error.reason._tag === "StatusCodeError"
  ) {
    const status = error.reason.response.status;
    if (status === 404) return Effect.fail(new IssueNotFoundError({ key }));
    if (status === 401 || status === 403)
      return Effect.fail(new JiraAuthError({ status }));
  }
  return Effect.fail(new JiraHttpError({ key, error }));
};

export class JiraClient extends Context.Service<
  JiraClient,
  {
    readonly getIssue: (key: string) => Effect.Effect<Issue, JiraError>;
  }
>()("@mono/JiraClient") {
  static readonly layer = Layer.effect(
    JiraClient,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
      );
      const config = yield* JiraConfig;

      const getIssue = Effect.fn("JiraClient.getIssue")(
        (key: string): Effect.Effect<Issue, JiraError> =>
          Effect.gen(function* () {
            const response = yield* http.get(
              `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}`,
              {
                headers: {
                  Authorization: `Bearer ${Redacted.value(config.token)}`,
                },
              },
            );
            const raw =
              yield* HttpClientResponse.schemaBodyJson(RawIssue)(response);
            return toIssue(raw);
          }).pipe(Effect.catch((error) => mapError(key, error))),
      );

      return { getIssue };
    }),
  );
}
