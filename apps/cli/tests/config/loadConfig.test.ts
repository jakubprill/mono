import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { GitClient } from "@mono/git";
import { Effect, Layer, Option } from "effect";
import {
  findProjectConfigPath,
  loadConfig,
} from "../../src/config/loadConfig.ts";

const gitLayer = GitClient.layer.pipe(
  Layer.provide(BunChildProcessSpawner.layer),
  Layer.provide(BunFileSystem.layer),
  Layer.provide(BunPath.layer),
);

const testLayer = Layer.mergeAll(gitLayer, BunFileSystem.layer, BunPath.layer);

let repoDir: string;
let originalCwd: string;
let originalXdgConfigHome: string | undefined;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-config-test-"));
  await Bun.$`git init -q -b main`.cwd(repoDir).quiet();
  originalCwd = process.cwd();
  originalXdgConfigHome = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = mkdtempSync(
    join(tmpdir(), "mono-xdg-test-"),
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repoDir, { recursive: true, force: true });
  if (originalXdgConfigHome === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = originalXdgConfigHome;
  }
});

describe("findProjectConfigPath", () => {
  test("finds mono.config.json in the cwd", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{}");
    process.chdir(repoDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(repoDir).pipe(Effect.provide(testLayer)),
    );

    expect(Option.isSome(result)).toBe(true);
  });

  test("finds it when invoked from a subdirectory (walks up)", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{}");
    const subDir = join(repoDir, "apps", "frontend");
    mkdirSync(subDir, { recursive: true });
    process.chdir(subDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(subDir).pipe(Effect.provide(testLayer)),
    );

    expect(Option.isSome(result)).toBe(true);
  });

  test("returns None when no config file exists up to the repo root", async () => {
    process.chdir(repoDir);

    const result = await Effect.runPromise(
      findProjectConfigPath(repoDir).pipe(Effect.provide(testLayer)),
    );

    expect(Option.isNone(result)).toBe(true);
  });
});

describe("loadConfig", () => {
  test("returns defaults when neither global nor project config exist", async () => {
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer)),
    );

    expect(config.branchTemplate).toBe("{key}-{slug}");
    expect(config.baseBranches).toEqual([]);
    expect(config.startTransitionStatus).toBeUndefined();
  });

  test("project config overrides global config field by field", async () => {
    const globalDir = join(process.env["XDG_CONFIG_HOME"]!, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ git: { baseBranches: ["main", "develop"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ jira: { startTransitionStatus: "In Progress" } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer)),
    );

    expect(config.baseBranches).toEqual(["main", "develop"]);
    expect(config.startTransitionStatus).toBe("In Progress");
  });

  test("project's field wins outright over global's on conflict", async () => {
    const globalDir = join(process.env["XDG_CONFIG_HOME"]!, "mono");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ git: { baseBranches: ["main"] } }),
    );
    writeFileSync(
      join(repoDir, "mono.config.json"),
      JSON.stringify({ git: { baseBranches: ["develop"] } }),
    );
    process.chdir(repoDir);

    const config = await Effect.runPromise(
      loadConfig.pipe(Effect.provide(testLayer)),
    );

    expect(config.baseBranches).toEqual(["develop"]);
  });

  test("fails clearly on invalid JSON in the project config", async () => {
    writeFileSync(join(repoDir, "mono.config.json"), "{ not valid json");
    process.chdir(repoDir);

    const failure = await Effect.runPromise(
      loadConfig.pipe(Effect.flip, Effect.provide(testLayer)),
    );

    expect(failure._tag).toBe("ConfigError");
    expect(failure.filePath).toContain("mono.config.json");
  });
});
