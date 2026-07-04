import { describe, expect, test } from "bun:test";
import {
  renderBranchName,
  resolveBranchType,
  slugify,
} from "../../src/work/branchName.ts";

describe("slugify", () => {
  test("lowercases and hyphenates non-alphanumeric runs", () => {
    expect(slugify("Fix Login Redirect Loop!")).toBe("fix-login-redirect-loop");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("  Weird Spacing  ")).toBe("weird-spacing");
  });
});

describe("renderBranchName", () => {
  test("substitutes type, key, and slug placeholders", () => {
    const name = renderBranchName("{type}/{key}-{slug}", {
      type: "bugfix",
      key: "PROJ-123",
      slug: "fix-login",
    });
    expect(name).toBe("bugfix/PROJ-123-fix-login");
  });

  test("supports a template with no {type} placeholder", () => {
    const name = renderBranchName("{key}-{slug}", {
      type: "bugfix",
      key: "PROJ-123",
      slug: "fix-login",
    });
    expect(name).toBe("PROJ-123-fix-login");
  });
});

describe("resolveBranchType", () => {
  test("uses the alias when configured", () => {
    expect(resolveBranchType("Bug", { Bug: "bugfix" })).toBe("bugfix");
  });

  test("falls back to the lowercased issue type when no alias matches", () => {
    expect(resolveBranchType("Story", {})).toBe("story");
  });
});
