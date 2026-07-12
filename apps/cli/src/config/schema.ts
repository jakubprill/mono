import type { JsonSchema } from "effect";

/**
 * Converts a `Schema.toJsonSchemaDocument` result into a self-resolving JSON
 * Schema object suitable for writing to a standalone file. The document's
 * `schema` and `definitions` fields are separate; the `$ref`s inside them
 * point at `#/$defs/...`, so the definitions must be embedded under a
 * `$defs` key at the root for those refs to resolve when the file is read
 * on its own.
 */
export const toWritableSchema = (
  doc: JsonSchema.Document<"draft-2020-12">,
): Record<string, unknown> => ({
  ...doc.schema,
  $defs: doc.definitions,
});
