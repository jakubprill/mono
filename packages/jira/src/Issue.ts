import { Schema } from "effect";

class RawStatus extends Schema.Class<RawStatus>("RawStatus")({
  name: Schema.String,
}) {}

class RawAssignee extends Schema.Class<RawAssignee>("RawAssignee")({
  displayName: Schema.String,
}) {}

class RawIssueType extends Schema.Class<RawIssueType>("RawIssueType")({
  name: Schema.String,
}) {}

class RawFields extends Schema.Class<RawFields>("RawFields")({
  summary: Schema.String,
  status: RawStatus,
  assignee: Schema.NullOr(RawAssignee),
  description: Schema.NullOr(Schema.String),
  issuetype: RawIssueType,
}) {}

export class RawIssue extends Schema.Class<RawIssue>("RawIssue")({
  key: Schema.String,
  fields: RawFields,
}) {}

export class Issue extends Schema.Class<Issue>("Issue")({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  assignee: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  issueType: Schema.String,
}) {
  toMarkdown(): string {
    const lines = [
      `${this.key}: ${this.summary}`,
      `Status: ${this.status}`,
      `Assignee: ${this.assignee ?? "Unassigned"}`,
    ];
    if (this.description) {
      lines.push("", "Description:", this.description);
    }
    return lines.join("\n");
  }
}

export const toIssue = (raw: RawIssue): Issue =>
  new Issue({
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status.name,
    assignee: raw.fields.assignee?.displayName ?? null,
    description: raw.fields.description,
    issueType: raw.fields.issuetype.name,
  });
