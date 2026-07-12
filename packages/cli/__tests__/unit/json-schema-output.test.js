/** --json-schema structured output: validator subset + extraction + retry loop. */
import { describe, it, expect } from "vitest";
import {
  validateAgainstSchema,
  extractJsonPayload,
  firstBalancedJson,
  buildSchemaInstruction,
  runJsonSchemaConstrained,
  loadSchemaFile,
  buildStructuredResult,
} from "../../src/lib/json-schema-output.js";

const SCHEMA = {
  type: "object",
  required: ["name", "count"],
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    count: { type: "integer" },
    kind: { enum: ["a", "b"] },
    tags: { type: "array", items: { type: "string" } },
  },
};

describe("validateAgainstSchema", () => {
  it("accepts a conforming object", () => {
    expect(
      validateAgainstSchema(
        { name: "x", count: 2, kind: "a", tags: ["t"] },
        SCHEMA,
      ),
    ).toEqual([]);
  });

  it("reports type, required, enum, additionalProperties and item errors", () => {
    const errs = validateAgainstSchema(
      { name: 5, kind: "z", extra: 1, tags: ["ok", 7] },
      SCHEMA,
    );
    const text = errs.join("\n");
    expect(text).toContain("$.name: expected type string");
    expect(text).toContain('missing required property "count"');
    expect(text).toContain("$.kind: value not in enum");
    expect(text).toContain('unexpected property "extra"');
    expect(text).toContain("$.tags[1]: expected type string");
  });

  it("integer satisfies number; top-level type mismatch short-circuits", () => {
    expect(validateAgainstSchema(3, { type: "number" })).toEqual([]);
    expect(validateAgainstSchema("nope", SCHEMA)).toHaveLength(1);
  });
});

describe("extractJsonPayload", () => {
  it("parses bare, fenced and embedded JSON", () => {
    expect(extractJsonPayload('{"a":1}').value).toEqual({ a: 1 });
    expect(
      extractJsonPayload('Sure!\n```json\n{"a":2}\n```\nthanks').value,
    ).toEqual({ a: 2 });
    expect(
      extractJsonPayload('The answer is {"a":3} as requested.').value,
    ).toEqual({ a: 3 });
    expect(extractJsonPayload("no json here").ok).toBe(false);
  });

  it("stops at the first complete value instead of over-capturing (greedy slice would fail)", () => {
    // 旧实现取首 { 到末 }，遇到尾随散文里的落单 } 或第二个对象就 JSON.parse 抛错。
    expect(extractJsonPayload('{"a":1} note: use } sparingly').value).toEqual({
      a: 1,
    });
    expect(extractJsonPayload('{"a":1} and {"b":2}').value).toEqual({ a: 1 });
    expect(extractJsonPayload('[{"x":1}] (1 row) ]').value).toEqual([{ x: 1 }]);
  });
});

describe("firstBalancedJson", () => {
  it("returns the first balanced object/array and ignores trailing prose", () => {
    expect(firstBalancedJson('{"a":1} and {"b":2}')).toBe('{"a":1}');
    expect(firstBalancedJson('x {"a":{"b":2}} y')).toBe('{"a":{"b":2}}');
    expect(firstBalancedJson('[{"x":1}] tail')).toBe('[{"x":1}]');
  });

  it("honors string literals so braces inside strings don't break the depth count", () => {
    expect(firstBalancedJson('{"msg":"has } brace","n":1} tail')).toBe(
      '{"msg":"has } brace","n":1}',
    );
  });

  it("restricts to the requested opener and returns null when none match", () => {
    expect(firstBalancedJson('{"a":1} [1,2,3]', "[")).toBe("[1,2,3]");
    expect(firstBalancedJson("just words")).toBeNull();
    expect(firstBalancedJson('{"a":1')).toBeNull(); // unbalanced
  });
});

describe("runJsonSchemaConstrained", () => {
  const base = { prompt: "list things", appendSystemPrompt: "PERSONA" };

  it("prints validated JSON and returns 0 on first success", async () => {
    let out = "";
    let seen = null;
    const code = await runJsonSchemaConstrained({
      schema: SCHEMA,
      baseOptions: base,
      writeOut: (s) => {
        out += s;
      },
      writeErr: () => {},
      runHeadless: async (opts) => {
        seen = opts;
        return { result: '{"name":"x","count":1}', exitCode: 0 };
      },
    });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ name: "x", count: 1 });
    expect(seen.outputFormat).toBe("text"); // forced — stream modes don't mix
    expect(seen.appendSystemPrompt).toContain("PERSONA");
    expect(seen.appendSystemPrompt).toContain("OUTPUT CONTRACT");
    expect(seen.appendSystemPrompt).toContain('"required":["name","count"]');
  });

  it("retries with a corrective prompt and succeeds on attempt 2", async () => {
    const prompts = [];
    let out = "";
    const code = await runJsonSchemaConstrained({
      schema: SCHEMA,
      baseOptions: base,
      writeOut: (s) => {
        out += s;
      },
      writeErr: () => {},
      runHeadless: async (opts) => {
        prompts.push(opts.prompt);
        return prompts.length === 1
          ? { result: '{"name":"x"}' } // missing count
          : { result: '{"name":"x","count":9}' };
      },
    });
    expect(code).toBe(0);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("failed JSON Schema validation");
    expect(prompts[1]).toContain('missing required property "count"');
    expect(JSON.parse(out).count).toBe(9);
  });

  it("returns 1 with errors after exhausting attempts", async () => {
    let err = "";
    const code = await runJsonSchemaConstrained({
      schema: SCHEMA,
      baseOptions: base,
      maxAttempts: 2,
      writeOut: () => {},
      writeErr: (s) => {
        err += s;
      },
      runHeadless: async () => ({ result: "not json at all" }),
    });
    expect(code).toBe(1);
    expect(err).toContain("failed validation after 2 attempts");
    expect(err).toContain("no parseable JSON");
  });

  it("falls back to captured writeOut text when result is empty", async () => {
    let out = "";
    const code = await runJsonSchemaConstrained({
      schema: { type: "object" },
      baseOptions: base,
      writeOut: (s) => {
        out += s;
      },
      writeErr: () => {},
      runHeadless: async (_opts, deps) => {
        deps.writeOut('{"via":"capture"}');
        return { result: "" };
      },
    });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ via: "capture" });
  });

  it("buildSchemaInstruction embeds the schema verbatim", () => {
    expect(buildSchemaInstruction({ type: "object" })).toContain(
      '{"type":"object"}',
    );
  });
});

describe("loadSchemaFile", () => {
  it("reads and parses a valid schema file", () => {
    const fs = { readFileSync: () => '{"type":"object"}' };
    expect(loadSchemaFile(fs, "schema.json")).toEqual({ type: "object" });
  });

  it("names the file when it cannot be read", () => {
    const fs = {
      readFileSync: () => {
        throw new Error("ENOENT: no such file or directory");
      },
    };
    expect(() => loadSchemaFile(fs, "missing.json")).toThrow(
      /Cannot read schema file "missing\.json": ENOENT/,
    );
  });

  it("names the file when its JSON is malformed", () => {
    const fs = { readFileSync: () => "{bad" };
    expect(() => loadSchemaFile(fs, "bad.json")).toThrow(
      /Invalid JSON in schema file "bad\.json":/,
    );
  });

  it("errors clearly when no schema file is given", () => {
    expect(() => loadSchemaFile({}, undefined)).toThrow(/No schema provided/);
  });

  it("rejects a malformed schema at load time (startup meta-validation)", () => {
    const fs = { readFileSync: () => '{"type":"objetc"}' }; // typo'd type
    expect(() => loadSchemaFile(fs, "typo.json")).toThrow(
      /Invalid JSON Schema in "typo\.json"/,
    );
  });
});

describe("buildStructuredResult (P2 structured_result event)", () => {
  const schema = {
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
  };
  it("emits a valid structured_result with a schema digest", () => {
    const ev = buildStructuredResult(schema, { n: 1 });
    expect(ev).toMatchObject({ type: "structured_result", valid: true });
    expect(ev.schema_digest).toMatch(/^sha256:/);
  });
  it("emits valid:false with coded/pointered errors, never free text", () => {
    const ev = buildStructuredResult(schema, { n: "x" });
    expect(ev.valid).toBe(false);
    expect(ev.errors[0]).toMatchObject({ code: "type", instancePath: "/n" });
  });
});
