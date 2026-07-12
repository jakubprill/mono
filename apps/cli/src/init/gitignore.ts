import { Effect, FileSystem, Path } from "effect";

const SCHEMA_GITIGNORE_ENTRY = ".mono/schema.json";

export const ensureGitignoreEntry = (repoRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const gitignorePath = path.join(repoRoot, ".gitignore");
    const exists = yield* fs
      .exists(gitignorePath)
      .pipe(Effect.orElseSucceed(() => false));

    let content = "";
    if (exists) {
      content = yield* fs.readFileString(gitignorePath);
    }

    if (content.split("\n").includes(SCHEMA_GITIGNORE_ENTRY)) return;

    const withTrailingNewline =
      content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
    yield* fs.writeFileString(
      gitignorePath,
      `${withTrailingNewline}${SCHEMA_GITIGNORE_ENTRY}\n`,
    );
  });
