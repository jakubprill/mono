import { Issue } from "@mono/jira";
import { Schema } from "effect";

export type OutputFormat = "markdown" | "json";

export const renderIssue = (issue: Issue, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(Schema.encodeSync(Issue)(issue), null, 2);
  }
  return issue.toMarkdown();
};
