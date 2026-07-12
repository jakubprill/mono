import { GitClient } from "@mono/git";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { MonoConfig } from "../config/Config.ts";
import { toWritableSchema } from "../config/schema.ts";
import { ensureConfigSkeleton } from "./configSkeleton.ts";
import { ensureGitignoreEntry } from "./gitignore.ts";

const writeSchema = (repoRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });
    const outputSchema = toWritableSchema(doc);

    const outDir = path.join(repoRoot, ".mono");
    yield* fs.makeDirectory(outDir, { recursive: true });

    const outPath = path.join(outDir, "schema.json");
    yield* fs.writeFileString(outPath, JSON.stringify(outputSchema, null, 2));
  });

export const runInit = (repoRoot: string) =>
  Effect.gen(function* () {
    yield* ensureConfigSkeleton(repoRoot);
    yield* writeSchema(repoRoot);
    yield* ensureGitignoreEntry(repoRoot);
    yield* Console.log(`Initialized mono-cli in ${repoRoot}`);
  });

export const initCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const git = yield* GitClient;
    const repoRoot = yield* git.repoRoot;
    yield* runInit(repoRoot);
  }).pipe(
    Effect.catchTag("GitCommandError", (e) =>
      Console.error(`Not a git repository: ${e.stderr}`).pipe(
        Effect.andThen(Effect.fail(e)),
      ),
    ),
    Effect.provide(GitClient.layer),
  ),
).pipe(
  Command.withDescription(
    "Set up mono-cli in this repo: mono.config.json, .mono/schema.json, .gitignore",
  ),
);
