import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { GitCommandError } from "../src/errors.ts";
import { GitClient } from "../src/GitClient.ts";

const testLayer = GitClient.layer.pipe(
  Layer.provide(BunChildProcessSpawner.layer),
  Layer.provide(BunFileSystem.layer),
  Layer.provide(BunPath.layer),
);

let repoDir: string;
let remoteDir: string | undefined;
let originalCwd: string;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-git-test-"));
  remoteDir = undefined;
  await Bun.$`git init -q -b main`.cwd(repoDir).quiet();
  await Bun.$`git config user.email test@example.com`.cwd(repoDir).quiet();
  await Bun.$`git config user.name Test`.cwd(repoDir).quiet();
  await Bun.$`git commit --allow-empty -q -m init`.cwd(repoDir).quiet();
  originalCwd = process.cwd();
  process.chdir(repoDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repoDir, { recursive: true, force: true });
  if (remoteDir !== undefined) {
    rmSync(remoteDir, { recursive: true, force: true });
  }
});

describe("GitClient.repoRoot", () => {
  it.effect("returns the repo's top-level directory", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const root = yield* git.repoRoot;
      expect(root).toBe(realpathSync(repoDir));
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("GitClient.currentBranch", () => {
  it.effect("returns the checked-out branch name", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const branch = yield* git.currentBranch;
      expect(branch).toBe("main");
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("GitClient.createBranch", () => {
  it.effect("creates and checks out a new branch from the given base", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      yield* git.createBranch("feature/test", "main");
      const branch = yield* git.currentBranch;
      expect(branch).toBe("feature/test");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("fails when the base branch doesn't exist", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const failure = yield* Effect.flip(
        git.createBranch("feature/test", "does-not-exist"),
      );
      expect(failure).toBeInstanceOf(GitCommandError);
    }).pipe(Effect.provide(testLayer)),
  );
});

const addOriginWithDefaultBranch = async (repoPath: string): Promise<void> => {
  remoteDir = mkdtempSync(join(tmpdir(), "mono-git-remote-"));
  await Bun.$`git init -q --bare -b main`.cwd(remoteDir).quiet();
  await Bun.$`git remote add origin ${remoteDir}`.cwd(repoPath).quiet();
  await Bun.$`git push -q origin main`.cwd(repoPath).quiet();
  await Bun.$`git remote set-head origin main`.cwd(repoPath).quiet();
};

describe("GitClient.defaultRemoteBranch", () => {
  it.effect("fails clearly when there is no origin remote", () =>
    Effect.gen(function* () {
      const git = yield* GitClient;
      const failure = yield* Effect.flip(git.defaultRemoteBranch);
      expect(failure).toBeInstanceOf(GitCommandError);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("returns the remote's default branch name", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => addOriginWithDefaultBranch(repoDir));
      const git = yield* GitClient;
      const branch = yield* git.defaultRemoteBranch;
      expect(branch).toBe("main");
    }).pipe(Effect.provide(testLayer)),
  );
});
