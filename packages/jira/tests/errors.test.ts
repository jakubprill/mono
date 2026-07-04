import { describe, expect, test } from "@effect/vitest";
import {
  IssueNotFoundError,
  JiraAuthError,
  JiraHttpError,
} from "../src/errors.ts";

describe("errors", () => {
  test("IssueNotFoundError carries the issue key and its tag", () => {
    const error = new IssueNotFoundError({ key: "PROJ-123" });
    expect(error._tag).toBe("IssueNotFoundError");
    expect(error.key).toBe("PROJ-123");
  });

  test("JiraAuthError carries the HTTP status and its tag", () => {
    const error = new JiraAuthError({ status: 401 });
    expect(error._tag).toBe("JiraAuthError");
    expect(error.status).toBe(401);
  });

  test("JiraHttpError carries the issue key and wrapped error", () => {
    const cause = new Error("boom");
    const error = new JiraHttpError({ key: "PROJ-123", error: cause });
    expect(error._tag).toBe("JiraHttpError");
    expect(error.key).toBe("PROJ-123");
    expect(error.error).toBe(cause);
  });
});
