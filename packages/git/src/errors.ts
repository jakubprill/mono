import { Schema } from "effect";
import * as Runtime from "effect/Runtime";

export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()(
  "GitCommandError",
  { command: Schema.String, stderr: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
}
