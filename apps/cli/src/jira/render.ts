import type { Issue } from "@mono/jira";

export type OutputFormat = "markdown" | "json";

export const renderIssue = (issue: Issue, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(
      {
        key: issue.key,
        summary: issue.summary,
        status: issue.status,
        assignee: issue.assignee,
        description: issue.description,
      },
      null,
      2,
    );
  }
  return issue.toMarkdown();
};
