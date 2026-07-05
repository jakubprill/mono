import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  defaultConfig,
  MonoConfig,
  mergeConfig,
} from "../../src/config/Config.ts";

const decode = (json: unknown) => Schema.decodeUnknownSync(MonoConfig)(json);

describe("MonoConfig", () => {
  test("decodes an empty object to all-optional-absent", () => {
    const config = decode({});
    expect(config.work).toBeUndefined();
  });

  test("decodes a fully-populated config", () => {
    const config = decode({
      work: {
        sourceBranches: ["main", "develop"],
        branchPattern: "{type}/{key}-{slug}",
        branchTypeAliases: { Bug: "bugfix" },
        startStatus: "In Progress",
      },
    });
    expect(config.work?.sourceBranches).toEqual(["main", "develop"]);
    expect(config.work?.branchPattern).toBe("{type}/{key}-{slug}");
    expect(config.work?.branchTypeAliases).toEqual({ Bug: "bugfix" });
    expect(config.work?.startStatus).toBe("In Progress");
  });

  test("ignores the $schema field", () => {
    const config = decode({ $schema: "./.mono/schema.json" });
    expect(config.work).toBeUndefined();
  });
});

describe("mergeConfig", () => {
  test("returns defaults when both are undefined", () => {
    expect(mergeConfig(undefined, undefined)).toEqual(defaultConfig);
  });

  test("project field wins over global on the same field", () => {
    const global = decode({ work: { sourceBranches: ["main"] } });
    const project = decode({ work: { sourceBranches: ["develop"] } });
    expect(mergeConfig(global, project).sourceBranches).toEqual(["develop"]);
  });

  test("non-conflicting fields from both global and project apply", () => {
    const global = decode({ work: { sourceBranches: ["main"] } });
    const project = decode({ work: { startStatus: "In Progress" } });
    const merged = mergeConfig(global, project);
    expect(merged.sourceBranches).toEqual(["main"]);
    expect(merged.startStatus).toBe("In Progress");
  });

  test("falls back to defaultConfig.branchPattern when neither sets it", () => {
    const project = decode({ work: { startStatus: "Done" } });
    expect(mergeConfig(undefined, project).branchPattern).toBe(
      defaultConfig.branchPattern,
    );
  });
});
