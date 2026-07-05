import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { GitClient } from "@mono/git";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import {
  findProjectConfigPath,
  loadConfig,
} from "../../src/config/loadConfig.ts";

const gitLayer = GitClient.layer.pipe(
  Layer.provide(BunChildProcessSpawner.layer),
  Layer.provide(BunFileSystem.layer),
  Layer.provide(BunPath.layer),
);

let repoDir: string;
let originalCwd: string;
let xdgConfigHome: string;

const testLayer = () =>
  Layer.mergeAll(
    gitLayer,
    BunFileSystem.layer,
    BunPath.layer,
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ XDG_CONFIG_HOME: xdgConfigHome }),
    ),
  );

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-config-test-"));
  await Bun.$`git init -q -b main`.cwd(repoDir).quiet();
  originalCwd = process.cwd();
  xdgConfigHome = mkdtempSync(join(tmpdir(), "mono-xdg-test-"));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repoDir, { recursive: true, force: true });
});

describe("findProjectConfigPath", () => {
  test("finds mono.config.json in the cwd", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{}");
    process.chdir(repoDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(repoDir).pipe(Effect.provide(testLayer())),
    );

    expect(Option.isSome(result)).toBe(true);
  });

  test("finds it when invoked from a subdirectory (walks up)", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{}");
    const subDir = join(repoDir, "apps", "frontend");
    mkdirSync(subDir, { recursive: true });
    process.chdir(subDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(subDir).pipe(Effect.provide(testLayer())),
    );

    expect(Option.isSome(result)).toBe(true);
  });

  test("returns None when no config file exists up to the repo root", async () => {
    process.chdir(repoDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(repoDir).pipe(Effect.provide(testLayer())),
    );

    expect(Option.isNone(result)).toBe(true);
  });
});

describe("loadConfig", () => {
  test("returns defaults when neither global nor project config exist", async () => {
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer())),
    );

    expect(config.branchPattern).toBe("{key}-{slug}");
    expect(config.sourceBranches).toEqual([]);
    expect(config.startStatus).toBeUndefined();
  });

  test("project config overrides global config field by field", async () => {
    const globalDir = join(xdgConfigHome, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ work: { sourceBranches: ["main", "develop"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ work: { startStatus: "In Progress" } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer())),
    );

    expect(config.sourceBranches).toEqual(["main", "develop"]);
    expect(config.startStatus).toBe("In Progress");
  });

  test("project's field wins outright over global's on conflict", async () => {
    const globalDir = join(xdgConfigHome, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ work: { sourceBranches: ["main"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ work: { sourceBranches: ["develop"] } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer())),
    );

    expect(config.sourceBranches).toEqual(["develop"]);
  });

  test("fails clearly on invalid JSON in the project config", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{ not valid json");
    process.chdir(repoDir);

    const failure = await Effect.runPromise(
      loadConfig.pipe(Effect.flip, Effect.provide(testLayer())),
    );

    expect(failure._tag).toBe("ConfigError");
    expect(failure.filePath).toContain("mono.config.json");
  });
});
