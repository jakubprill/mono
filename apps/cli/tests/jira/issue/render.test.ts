import { describe, expect, test } from "bun:test";
import { Issue } from "@mono/jira";
import { renderIssue } from "../../../src/jira/issue/render.ts";

const issue = new Issue({
  key: "PROJ-123",
  summary: "Fix login redirect loop",
  status: "In Progress",
  assignee: "Jane Doe",
  description: "Users are redirected to login instead of dashboard.",
});

describe("renderIssue", () => {
  test("markdown format includes key, status, and assignee", () => {
    const output = renderIssue(issue, "markdown");
    expect(output).toContain("PROJ-123: Fix login redirect loop");
    expect(output).toContain("Status: In Progress");
    expect(output).toContain("Assignee: Jane Doe");
  });

  test("json format produces valid, parseable JSON with core fields", () => {
    const output = renderIssue(issue, "json");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      key: "PROJ-123",
      summary: "Fix login redirect loop",
      status: "In Progress",
      assignee: "Jane Doe",
      description: "Users are redirected to login instead of dashboard.",
    });
  });

  test("markdown format shows Unassigned when assignee is null", () => {
    const unassigned = new Issue({ ...issue, assignee: null });
    expect(renderIssue(unassigned, "markdown")).toContain(
      "Assignee: Unassigned",
    );
  });
});
