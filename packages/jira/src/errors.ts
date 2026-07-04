import { Schema } from "effect";
import * as Runtime from "effect/Runtime";

export class IssueNotFoundError extends Schema.TaggedErrorClass<IssueNotFoundError>()(
  "IssueNotFoundError",
  { key: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
}

export class JiraAuthError extends Schema.TaggedErrorClass<JiraAuthError>()(
  "JiraAuthError",
  { status: Schema.Number },
) {
  override readonly [Runtime.errorReported] = false;
}

export class JiraHttpError extends Schema.TaggedErrorClass<JiraHttpError>()(
  "JiraHttpError",
  { key: Schema.String, error: Schema.Defect() },
) {
  override readonly [Runtime.errorReported] = false;
}

export type JiraError = IssueNotFoundError | JiraAuthError | JiraHttpError;
