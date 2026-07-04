import { Schema } from "effect";
import * as Runtime from "effect/Runtime";

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()(
  "ConfigError",
  { filePath: Schema.String, message: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
}
