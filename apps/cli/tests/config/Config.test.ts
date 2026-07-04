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
    expect(config.git).toBeUndefined();
    expect(config.jira).toBeUndefined();
  });

  test("decodes a fully-populated config", () => {
    const config = decode({
      git: {
        baseBranches: ["main", "develop"],
        branchTemplate: "{type}/{key}-{slug}",
        issueTypeAliases: { Bug: "bugfix" },
      },
      jira: { startTransitionStatus: "In Progress" },
    });
    expect(config.git?.baseBranches).toEqual(["main", "develop"]);
    expect(config.git?.branchTemplate).toBe("{type}/{key}-{slug}");
    expect(config.git?.issueTypeAliases).toEqual({ Bug: "bugfix" });
    expect(config.jira?.startTransitionStatus).toBe("In Progress");
  });

  test("ignores the $schema field", () => {
    const config = decode({ $schema: "./.mono/schema.json" });
    expect(config.git).toBeUndefined();
  });
});

describe("mergeConfig", () => {
  test("returns defaults when both are undefined", () => {
    expect(mergeConfig(undefined, undefined)).toEqual(defaultConfig);
  });

  test("project field wins over global on the same field", () => {
    const global = decode({ git: { baseBranches: ["main"] } });
    const project = decode({ git: { baseBranches: ["develop"] } });
    expect(mergeConfig(global, project).baseBranches).toEqual(["develop"]);
  });

  test("non-conflicting fields from both global and project apply", () => {
    const global = decode({ git: { baseBranches: ["main"] } });
    const project = decode({ jira: { startTransitionStatus: "In Progress" } });
    const merged = mergeConfig(global, project);
    expect(merged.baseBranches).toEqual(["main"]);
    expect(merged.startTransitionStatus).toBe("In Progress");
  });

  test("falls back to defaultConfig.branchTemplate when neither sets it", () => {
    const project = decode({ jira: { startTransitionStatus: "Done" } });
    expect(mergeConfig(undefined, project).branchTemplate).toBe(
      defaultConfig.branchTemplate,
    );
  });
});
