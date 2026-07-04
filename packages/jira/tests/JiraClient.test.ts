import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  IssueNotFoundError,
  JiraAuthError,
  JiraHttpError,
} from "../src/errors.ts";
import { JiraClient } from "../src/JiraClient.ts";
import { JiraConfig } from "../src/JiraConfig.ts";

const rawIssueJson = (
  overrides: {
    key?: string;
    assignee?: { displayName: string } | null;
    description?: string | null;
  } = {},
) => ({
  key: overrides.key ?? "PROJ-123",
  fields: {
    summary: "Fix login redirect loop",
    status: { name: "In Progress" },
    assignee:
      "assignee" in overrides
        ? overrides.assignee
        : { displayName: "Jane Doe" },
    description:
      "description" in overrides
        ? overrides.description
        : "Users are redirected to login.",
  },
});

const jsonFetch = (status: number, body: unknown): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status }),
    )) as unknown as typeof fetch;

const failingFetch = (message: string): typeof fetch =>
  (() => Promise.reject(new Error(message))) as unknown as typeof fetch;

const capturingFetch = (
  status: number,
  body: unknown,
): { fetch: typeof fetch; requestedUrl: () => string | undefined } => {
  let requestedUrl: string | undefined;
  const fetchFn = ((input: string | URL) => {
    requestedUrl = String(input);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, requestedUrl: () => requestedUrl };
};

const testLayer = (mockFetch: typeof fetch) =>
  JiraClient.layer.pipe(
    Layer.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, mockFetch)),
      ),
    ),
    Layer.provide(JiraConfig.testLayer),
  );

describe("JiraClient.getIssue", () => {
  it.effect("fetches and maps an issue", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const issue = yield* jira.getIssue("PROJ-123");
      expect(issue.key).toBe("PROJ-123");
      expect(issue.summary).toBe("Fix login redirect loop");
      expect(issue.status).toBe("In Progress");
      expect(issue.assignee).toBe("Jane Doe");
    }).pipe(Effect.provide(testLayer(jsonFetch(200, rawIssueJson())))),
  );

  it.effect("maps a null assignee to null", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const issue = yield* jira.getIssue("PROJ-124");
      expect(issue.assignee).toBeNull();
    }).pipe(
      Effect.provide(
        testLayer(
          jsonFetch(200, rawIssueJson({ key: "PROJ-124", assignee: null })),
        ),
      ),
    ),
  );

  it.effect("maps a 404 response to IssueNotFoundError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getIssue("MISSING-1"));
      expect(failure).toBeInstanceOf(IssueNotFoundError);
      expect((failure as IssueNotFoundError).key).toBe("MISSING-1");
    }).pipe(
      Effect.provide(
        testLayer(jsonFetch(404, { errorMessages: ["Issue does not exist"] })),
      ),
    ),
  );

  it.effect("maps a 401 response to JiraAuthError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getIssue("PROJ-123"));
      expect(failure).toBeInstanceOf(JiraAuthError);
      expect((failure as JiraAuthError).status).toBe(401);
    }).pipe(Effect.provide(testLayer(jsonFetch(401, {})))),
  );

  it.effect("percent-encodes special characters in the issue key", () => {
    const { fetch: mockFetch, requestedUrl } = capturingFetch(
      200,
      rawIssueJson({ key: "PROJ/123" }),
    );

    return Effect.gen(function* () {
      const jira = yield* JiraClient;
      yield* jira.getIssue("../../serverInfo");
      expect(requestedUrl()).toContain(
        "/rest/api/2/issue/..%2F..%2FserverInfo",
      );
    }).pipe(Effect.provide(testLayer(mockFetch)));
  });

  it.effect("maps a transport failure to JiraHttpError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getIssue("PROJ-123"));
      expect(failure).toBeInstanceOf(JiraHttpError);
    }).pipe(Effect.provide(testLayer(failingFetch("network down")))),
  );
});

const capturingPostFetch = (
  status: number,
): { fetch: typeof fetch; requestedInit: () => RequestInit | undefined } => {
  let requestedInit: RequestInit | undefined;
  const fetchFn = ((_input: string | URL, init?: RequestInit) => {
    // effect's HttpClientRequest.bodyJsonUnsafe encodes the JSON body as a
    // Uint8Array before it reaches fetch, so decode it back to text here to
    // give tests a plain string body to JSON.parse.
    const body = init?.body;
    requestedInit =
      body instanceof Uint8Array
        ? { ...init, body: new TextDecoder().decode(body) }
        : init;
    return Promise.resolve(new Response(null, { status }));
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, requestedInit: () => requestedInit };
};

describe("JiraClient.getTransitions", () => {
  it.effect("fetches and maps transitions", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const transitions = yield* jira.getTransitions("PROJ-123");
      expect(transitions).toEqual([
        { id: "21", name: "Start Progress", toStatus: "In Progress" },
        { id: "31", name: "Done", toStatus: "Done" },
      ]);
    }).pipe(
      Effect.provide(
        testLayer(
          jsonFetch(200, {
            transitions: [
              {
                id: "21",
                name: "Start Progress",
                to: { name: "In Progress" },
              },
              { id: "31", name: "Done", to: { name: "Done" } },
            ],
          }),
        ),
      ),
    ),
  );

  it.effect("maps an empty transitions list", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const transitions = yield* jira.getTransitions("PROJ-123");
      expect(transitions).toEqual([]);
    }).pipe(Effect.provide(testLayer(jsonFetch(200, { transitions: [] })))),
  );

  it.effect("maps a 404 response to IssueNotFoundError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getTransitions("MISSING-1"));
      expect(failure).toBeInstanceOf(IssueNotFoundError);
      expect((failure as IssueNotFoundError).key).toBe("MISSING-1");
    }).pipe(
      Effect.provide(
        testLayer(jsonFetch(404, { errorMessages: ["Issue does not exist"] })),
      ),
    ),
  );

  it.effect("maps a 401 response to JiraAuthError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getTransitions("PROJ-123"));
      expect(failure).toBeInstanceOf(JiraAuthError);
      expect((failure as JiraAuthError).status).toBe(401);
    }).pipe(Effect.provide(testLayer(jsonFetch(401, {})))),
  );

  it.effect("maps a transport failure to JiraHttpError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(jira.getTransitions("PROJ-123"));
      expect(failure).toBeInstanceOf(JiraHttpError);
    }).pipe(Effect.provide(testLayer(failingFetch("network down")))),
  );
});

describe("JiraClient.transitionIssue", () => {
  it.effect("sends the chosen transition id in the request body", () => {
    const { fetch: mockFetch, requestedInit } = capturingPostFetch(204);

    return Effect.gen(function* () {
      const jira = yield* JiraClient;
      yield* jira.transitionIssue("PROJ-123", "21");
      const body = JSON.parse(String(requestedInit()?.body));
      expect(body).toEqual({ transition: { id: "21" } });
    }).pipe(Effect.provide(testLayer(mockFetch)));
  });

  it.effect("maps a 404 response to IssueNotFoundError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(
        jira.transitionIssue("MISSING-1", "21"),
      );
      expect(failure).toBeInstanceOf(IssueNotFoundError);
      expect((failure as IssueNotFoundError).key).toBe("MISSING-1");
    }).pipe(
      Effect.provide(
        testLayer(jsonFetch(404, { errorMessages: ["Issue does not exist"] })),
      ),
    ),
  );

  it.effect("maps a 401 response to JiraAuthError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(
        jira.transitionIssue("PROJ-123", "21"),
      );
      expect(failure).toBeInstanceOf(JiraAuthError);
      expect((failure as JiraAuthError).status).toBe(401);
    }).pipe(Effect.provide(testLayer(jsonFetch(401, {})))),
  );

  it.effect("maps a transport failure to JiraHttpError", () =>
    Effect.gen(function* () {
      const jira = yield* JiraClient;
      const failure = yield* Effect.flip(
        jira.transitionIssue("PROJ-123", "21"),
      );
      expect(failure).toBeInstanceOf(JiraHttpError);
    }).pipe(Effect.provide(testLayer(failingFetch("network down")))),
  );
});
