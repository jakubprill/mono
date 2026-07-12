import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import { runInit } from "../../src/init/command.ts";

const testLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-init-test-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("runInit", () => {
  test("creates mono.config.json, .mono/schema.json, and .gitignore in a fresh repo", async () => {
    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));

    expect(existsSync(join(repoDir, "mono.config.json"))).toBe(true);
    expect(existsSync(join(repoDir, ".mono", "schema.json"))).toBe(true);

    const gitignore = readFileSync(join(repoDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".mono/schema.json");

    const schema = JSON.parse(
      readFileSync(join(repoDir, ".mono", "schema.json"), "utf8"),
    );
    expect(schema.$defs.MonoConfig).toBeDefined();
    expect(schema.$defs.WorkConfig).toBeDefined();
  });

  test("leaves an existing mono.config.json untouched but still writes the schema", async () => {
    const configPath = join(repoDir, "mono.config.json");
    const original = JSON.stringify({ work: { startStatus: "In Progress" } });
    writeFileSync(configPath, original);

    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));

    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(existsSync(join(repoDir, ".mono", "schema.json"))).toBe(true);
  });

  test("is idempotent: running twice does not duplicate the .gitignore entry", async () => {
    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));
    await Effect.runPromise(runInit(repoDir).pipe(Effect.provide(testLayer)));

    const gitignore = readFileSync(join(repoDir, ".gitignore"), "utf8");
    const occurrences = gitignore.split(".mono/schema.json").length - 1;
    expect(occurrences).toBe(1);
  });
});
