import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { MonoConfig } from "../../src/config/Config.ts";
import { toWritableSchema } from "../../src/config/schema.ts";

/** Collects every `$ref` string found anywhere within a JSON value. */
const collectRefs = (
  value: unknown,
  refs: Array<string> = [],
): Array<string> => {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (key === "$ref" && typeof val === "string") {
        refs.push(val);
      } else {
        collectRefs(val, refs);
      }
    }
  }
  return refs;
};

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

  test("toWritableSchema produces a self-resolving schema with $defs", () => {
    const doc = Schema.toJsonSchemaDocument(MonoConfig, {
      additionalProperties: true,
    });
    const written = toWritableSchema(doc);

    expect(written.$defs).toBeDefined();
    const defs = written.$defs as Record<string, unknown>;
    expect(defs.MonoConfig).toBeDefined();
    expect(defs.GitConfig).toBeDefined();
    expect(defs.JiraWorkConfig).toBeDefined();

    // Every $ref found in the written document must resolve to an entry
    // under its own $defs (refs are of the form "#/$defs/<name>").
    const refs = collectRefs(written);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/$defs/")).toBe(true);
      const name = ref.slice("#/$defs/".length);
      expect(defs[name]).toBeDefined();
    }
  });
});
