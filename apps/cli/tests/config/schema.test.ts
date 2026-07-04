import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { MonoConfig } from "../../src/config/Config.ts";

describe("MonoConfig JSON Schema", () => {
  test("generates an object schema with git and jira properties", () => {
    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });
    const monoConfigDef = doc.definitions.MonoConfig as Record<string, unknown>;
    expect(monoConfigDef.type).toBe("object");
    const properties = monoConfigDef.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["git", "jira", "$schema"]),
    );
  });
});
