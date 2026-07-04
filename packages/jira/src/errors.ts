import { Schema } from "effect";

export class IssueNotFoundError extends Schema.TaggedErrorClass<IssueNotFoundError>()(
  "IssueNotFoundError",
  { key: Schema.String },
) {}

export class JiraAuthError extends Schema.TaggedErrorClass<JiraAuthError>()(
  "JiraAuthError",
  { status: Schema.Number },
) {}

export class JiraHttpError extends Schema.TaggedErrorClass<JiraHttpError>()(
  "JiraHttpError",
  { key: Schema.String, error: Schema.Defect() },
) {}

export type JiraError = IssueNotFoundError | JiraAuthError | JiraHttpError;
