import { GitClient } from "@mono/git";
import {
  Console,
  Effect,
  FileSystem,
  type JsonSchema,
  Path,
  Schema,
} from "effect";
import { Command } from "effect/unstable/cli";
import { MonoConfig } from "./Config.ts";

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

export const schemaCommand = Command.make("schema", {}, () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitClient;

    const repoRoot = yield* git.repoRoot;
    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });
    const outputSchema = toWritableSchema(doc);

    const outDir = path.join(repoRoot, ".mono");
    yield* fs.makeDirectory(outDir, { recursive: true });

    const outPath = path.join(outDir, "schema.json");
    yield* fs.writeFileString(outPath, JSON.stringify(outputSchema, null, 2));

    yield* Console.log(`Wrote ${outPath}`);
  }).pipe(
    Effect.catchTag("GitCommandError", (e) =>
      Console.error(`Not a git repository: ${e.stderr}`).pipe(
        Effect.andThen(Effect.fail(e)),
      ),
    ),
    Effect.provide(GitClient.layer),
  ),
).pipe(Command.withDescription("Generate a JSON Schema for mono.config.json"));
