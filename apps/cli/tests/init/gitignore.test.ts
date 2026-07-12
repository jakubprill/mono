import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import { ensureGitignoreEntry } from "../../src/init/gitignore.ts";

const testLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-init-test-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("ensureGitignoreEntry", () => {
  test("creates .gitignore with the entry when missing", async () => {
    await Effect.runPromise(
      ensureGitignoreEntry(repoDir).pipe(Effect.provide(testLayer)),
    );

    const content = readFileSync(join(repoDir, ".gitignore"), "utf8");
    expect(content).toBe(".mono/schema.json\n");
  });

  test("appends the entry to an existing .gitignore", async () => {
    const gitignorePath = join(repoDir, ".gitignore");
    writeFileSync(gitignorePath, "node_modules\n");

    await Effect.runPromise(
      ensureGitignoreEntry(repoDir).pipe(Effect.provide(testLayer)),
    );

    const content = readFileSync(gitignorePath, "utf8");
    expect(content).toBe("node_modules\n.mono/schema.json\n");
  });

  test("does not duplicate an existing entry", async () => {
    const gitignorePath = join(repoDir, ".gitignore");
    writeFileSync(gitignorePath, "node_modules\n.mono/schema.json\n");

    await Effect.runPromise(
      ensureGitignoreEntry(repoDir).pipe(Effect.provide(testLayer)),
    );

    const content = readFileSync(gitignorePath, "utf8");
    expect(content).toBe("node_modules\n.mono/schema.json\n");
  });
});
