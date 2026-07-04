import { GitClient } from "@mono/git";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { MonoConfig } from "./Config.ts";

export const schemaCommand = Command.make("schema", {}, () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitClient;

    const repoRoot = yield* git.repoRoot;
    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });

    const outDir = path.join(repoRoot, ".mono");
    yield* fs.makeDirectory(outDir, { recursive: true });

    const outPath = path.join(outDir, "schema.json");
    yield* fs.writeFileString(outPath, JSON.stringify(doc, null, 2));

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
