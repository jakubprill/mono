import { describe, expect, test } from "@effect/vitest";
import { Schema } from "effect";
import { Issue, RawIssue, toIssue } from "../src/Issue.ts";

const decodeRawIssue = Schema.decodeSync(RawIssue);

describe("toIssue", () => {
  test("maps a fully-populated raw issue", () => {
    const raw = decodeRawIssue({
      key: "PROJ-123",
      fields: {
        summary: "Fix login redirect loop",
        status: { name: "In Progress" },
        assignee: { displayName: "Jane Doe" },
        description: "Users are redirected to login instead of dashboard.",
        issuetype: { name: "Bug" },
      },
    });

    const issue = toIssue(raw);

    expect(issue.key).toBe("PROJ-123");
    expect(issue.summary).toBe("Fix login redirect loop");
    expect(issue.status).toBe("In Progress");
    expect(issue.assignee).toBe("Jane Doe");
    expect(issue.description).toBe(
      "Users are redirected to login instead of dashboard.",
    );
    expect(issue.issueType).toBe("Bug");
  });

  test("maps a null assignee and null description to null", () => {
    const raw = decodeRawIssue({
      key: "PROJ-124",
      fields: {
        summary: "Unassigned bug",
        status: { name: "Open" },
        assignee: null,
        description: null,
        issuetype: { name: "Story" },
      },
    });

    const issue = toIssue(raw);

    expect(issue.assignee).toBeNull();
    expect(issue.description).toBeNull();
    expect(issue.issueType).toBe("Story");
  });
});

describe("Issue.toMarkdown", () => {
  test("renders key, summary, status, assignee, and description", () => {
    const issue = new Issue({
      key: "PROJ-123",
      summary: "Fix login redirect loop",
      status: "In Progress",
      assignee: "Jane Doe",
      description: "Users are redirected to login instead of dashboard.",
      issueType: "Bug",
    });

    const markdown = issue.toMarkdown();

    expect(markdown).toContain("PROJ-123: Fix login redirect loop");
    expect(markdown).toContain("Status: In Progress");
    expect(markdown).toContain("Assignee: Jane Doe");
    expect(markdown).toContain(
      "Users are redirected to login instead of dashboard.",
    );
  });

  test("renders Unassigned and omits the description block when both are null", () => {
    const issue = new Issue({
      key: "PROJ-124",
      summary: "Unassigned bug",
      status: "Open",
      assignee: null,
      description: null,
      issueType: "Bug",
    });

    const markdown = issue.toMarkdown();

    expect(markdown).toContain("Assignee: Unassigned");
    expect(markdown).not.toContain("Description:");
  });
});
