import { Effect, FileSystem, Path } from "effect";

export const ensureConfigSkeleton = (repoRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const configPath = path.join(repoRoot, "mono.config.json");
    const exists = yield* fs
      .exists(configPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (exists) return;

    const skeleton = { $schema: "./.mono/schema.json", work: {} };
    yield* fs.writeFileString(
      configPath,
      `${JSON.stringify(skeleton, null, 2)}\n`,
    );
  });
