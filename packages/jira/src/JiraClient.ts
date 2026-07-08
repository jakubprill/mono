import { Effect, Layer, Redacted, type Schema } from "effect";
import * as Context from "effect/Context";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
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
import {
  RawTransitionsResponse,
  type Transition,
  toTransition,
} from "./Transition.ts";

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
    readonly getIssueRaw: (key: string) => Effect.Effect<string, JiraError>;
    readonly getTransitions: (
      key: string,
    ) => Effect.Effect<ReadonlyArray<Transition>, JiraError>;
    readonly transitionIssue: (
      key: string,
      transitionId: string,
    ) => Effect.Effect<void, JiraError>;
  }
>()("@mono/JiraClient") {
  static readonly layer = Layer.effect(
    JiraClient,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
      );
      const config = yield* JiraConfig;

      const authHeaders = {
        Authorization: `Bearer ${Redacted.value(config.token)}`,
      };

      const fetchIssueResponse = Effect.fn("JiraClient.fetchIssueResponse")(
        (key: string) =>
          http.get(
            `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}`,
            { headers: authHeaders },
          ),
      );

      const getIssue = Effect.fn("JiraClient.getIssue")(
        (key: string): Effect.Effect<Issue, JiraError> =>
          Effect.gen(function* () {
            const response = yield* fetchIssueResponse(key);
            const raw =
              yield* HttpClientResponse.schemaBodyJson(RawIssue)(response);
            return toIssue(raw);
          }).pipe(
            Effect.catch((error) => mapError(key, error)),
            Effect.annotateSpans({ "jira.issue_key": key }),
          ),
      );

      const getIssueRaw = Effect.fn("JiraClient.getIssueRaw")(
        (key: string): Effect.Effect<string, JiraError> =>
          Effect.gen(function* () {
            const response = yield* fetchIssueResponse(key);
            return yield* response.text;
          }).pipe(
            Effect.catch((error) => mapError(key, error)),
            Effect.annotateSpans({ "jira.issue_key": key }),
          ),
      );

      const getTransitions = Effect.fn("JiraClient.getTransitions")(
        (key: string): Effect.Effect<ReadonlyArray<Transition>, JiraError> =>
          Effect.gen(function* () {
            const response = yield* http.get(
              `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
              { headers: authHeaders },
            );
            const raw = yield* HttpClientResponse.schemaBodyJson(
              RawTransitionsResponse,
            )(response);
            return raw.transitions.map(toTransition);
          }).pipe(
            Effect.catch((error) => mapError(key, error)),
            Effect.annotateSpans({ "jira.issue_key": key }),
          ),
      );

      const transitionIssue = Effect.fn("JiraClient.transitionIssue")(
        (key: string, transitionId: string): Effect.Effect<void, JiraError> =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post(
              `${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
              { headers: authHeaders },
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                transition: { id: transitionId },
              }),
            );
            yield* http.execute(request);
          }).pipe(
            Effect.catch((error) => mapError(key, error)),
            Effect.annotateSpans({
              "jira.issue_key": key,
              "jira.transition_id": transitionId,
            }),
          ),
      );

      return { getIssue, getIssueRaw, getTransitions, transitionIssue };
    }),
  );
}
