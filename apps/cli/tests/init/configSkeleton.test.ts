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
import { ensureConfigSkeleton } from "../../src/init/configSkeleton.ts";

const testLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "mono-init-test-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("ensureConfigSkeleton", () => {
  test("creates mono.config.json when missing", async () => {
    await Effect.runPromise(
      ensureConfigSkeleton(repoDir).pipe(Effect.provide(testLayer)),
    );

    const configPath = join(repoDir, "mono.config.json");
    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.$schema).toBe("./.mono/schema.json");
    expect(written.work).toEqual({});
  });

  test("leaves an existing mono.config.json untouched", async () => {
    const configPath = join(repoDir, "mono.config.json");
    const original = JSON.stringify({ work: { startStatus: "In Progress" } });
    writeFileSync(configPath, original);

    await Effect.runPromise(
      ensureConfigSkeleton(repoDir).pipe(Effect.provide(testLayer)),
    );

    expect(readFileSync(configPath, "utf8")).toBe(original);
  });
});
