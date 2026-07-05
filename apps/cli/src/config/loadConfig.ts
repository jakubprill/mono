import { homedir } from "node:os";
import { GitClient } from "@mono/git";
import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import { MonoConfig, mergeConfig, type ResolvedConfig } from "./Config.ts";
import { ConfigError } from "./errors.ts";

const readAndDecode = (
  fs: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<MonoConfig | undefined, ConfigError> =>
  Effect.gen(function* () {
    const exists = yield* fs
      .exists(filePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) return undefined;

    const content = yield* fs
      .readFileString(filePath)
      .pipe(
        Effect.mapError(
          () => new ConfigError({ filePath, message: "failed to read file" }),
        ),
      );

    const json = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: () => new ConfigError({ filePath, message: "invalid JSON" }),
    });

    return yield* Schema.decodeUnknownEffect(MonoConfig)(json).pipe(
      Effect.mapError(
        (error) => new ConfigError({ filePath, message: String(error) }),
      ),
    );
  });

const globalConfigPath = (
  path: Path.Path,
): Effect.Effect<string, ConfigError> =>
  Config.string("XDG_CONFIG_HOME").pipe(
    Config.withDefault(path.join(homedir(), ".config")),
    Effect.mapError(
      (error) =>
        new ConfigError({
          filePath: "XDG_CONFIG_HOME",
          message: String(error),
        }),
    ),
    Effect.map((configHome) => path.join(configHome, "mono", "config.json")),
  );

export const findProjectConfigPath = (
  cwd: string,
): Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | Path.Path | GitClient
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitClient;

    const repoRoot = yield* git.repoRoot.pipe(Effect.option);
    const boundary = Option.getOrElse(repoRoot, () => cwd);

    let dir = cwd;
    while (true) {
      const candidate = path.join(dir, "mono.config.json");
      const exists = yield* fs
        .exists(candidate)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) return Option.some(candidate);
      if (dir === boundary) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return Option.none();
  });

export const loadConfig: Effect.Effect<
  ResolvedConfig,
  ConfigError,
  FileSystem.FileSystem | Path.Path | GitClient
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const global = yield* readAndDecode(fs, yield* globalConfigPath(path));

  const projectPath = yield* findProjectConfigPath(process.cwd());
  const project = yield* Option.match(projectPath, {
    onNone: () => Effect.succeed(undefined),
    onSome: (filePath) => readAndDecode(fs, filePath),
  });

  return mergeConfig(global, project);
});
