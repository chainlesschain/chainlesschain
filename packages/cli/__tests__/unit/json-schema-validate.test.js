/**
 * JSON Schema (Draft 2020-12 subset) validator (P2 "JSON Schema 结构化输出") —
 * stable codes + RFC 6901 JSON Pointers, schema meta-validation, digest, and the
 * structured_result event. Pure module.
 */
import { describe, it, expect } from "vitest";
import {
  jsonPointer,
  canonical,
  computeSchemaDigest,
  validate,
  validateSchema,
  buildStructuredResultEvent,
} from "../../src/lib/json-schema-validate.js";

describe("jsonPointer (RFC 6901)", () => {
  it("root is empty, escapes ~ and /", () => {
    expect(jsonPointer([])).toBe("");
    expect(jsonPointer(["a", 0, "b"])).toBe("/a/0/b");
    expect(jsonPointer(["a/b", "c~d"])).toBe("/a~1b/c~0d");
  });
});

describe("computeSchemaDigest", () => {
  it("is stable and key-order independent", () => {
    const a = computeSchemaDigest({ type: "object", required: ["x"] });
    const b = computeSchemaDigest({ required: ["x"], type: "object" });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it("canonical sorts object keys recursively", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });
});

describe("validate — core keywords with pointers + codes", () => {
  it("reports type errors with a JSON Pointer + stable code", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "integer" } },
      required: ["name"],
    };
    const r = validate({ name: 42, age: 3.5 }, schema);
    expect(r.valid).toBe(false);
    const name = r.errors.find((e) => e.instancePath === "/name");
    expect(name).toMatchObject({
      code: "type",
      keyword: "type",
      schemaPath: "/properties/name/type",
    });
    expect(
      r.errors.some((e) => e.instancePath === "/age" && e.code === "type"),
    ).toBe(true);
  });

  it("required / additionalProperties:false", () => {
    const schema = {
      type: "object",
      properties: { a: {} },
      required: ["a"],
      additionalProperties: false,
    };
    const r = validate({ b: 1 }, schema);
    expect(r.errors.some((e) => e.code === "required")).toBe(true);
    const extra = r.errors.find((e) => e.code === "additionalProperties");
    expect(extra.instancePath).toBe("/b");
  });

  it("additionalProperties as a schema validates the extra props", () => {
    const schema = {
      type: "object",
      properties: {},
      additionalProperties: { type: "number" },
    };
    expect(validate({ x: 1 }, schema).valid).toBe(true);
    expect(validate({ x: "no" }, schema).valid).toBe(false);
  });

  it("enum and const", () => {
    expect(validate("b", { enum: ["a", "b"] }).valid).toBe(true);
    expect(validate("z", { enum: ["a", "b"] }).errors[0].code).toBe("enum");
    expect(validate(5, { const: 5 }).valid).toBe(true);
    expect(validate(6, { const: 5 }).errors[0].code).toBe("const");
  });
});

describe("validate — numeric / string / array constraints (new coverage)", () => {
  it("numeric minimum/maximum/exclusive/multipleOf", () => {
    expect(validate(3, { minimum: 5 }).errors[0].code).toBe("minimum");
    expect(validate(9, { maximum: 5 }).errors[0].code).toBe("maximum");
    expect(validate(5, { exclusiveMinimum: 5 }).errors[0].code).toBe(
      "exclusiveMinimum",
    );
    expect(validate(5, { exclusiveMaximum: 5 }).errors[0].code).toBe(
      "exclusiveMaximum",
    );
    expect(validate(7, { multipleOf: 2 }).errors[0].code).toBe("multipleOf");
    expect(validate(6, { multipleOf: 2 }).valid).toBe(true);
  });

  it("string minLength/maxLength/pattern", () => {
    expect(validate("a", { minLength: 2 }).errors[0].code).toBe("minLength");
    expect(validate("abc", { maxLength: 2 }).errors[0].code).toBe("maxLength");
    expect(validate("xyz", { pattern: "^[0-9]+$" }).errors[0].code).toBe(
      "pattern",
    );
    expect(validate("123", { pattern: "^[0-9]+$" }).valid).toBe(true);
  });

  it("array minItems/maxItems/uniqueItems/items/prefixItems", () => {
    expect(validate([1], { minItems: 2 }).errors[0].code).toBe("minItems");
    expect(validate([1, 2, 3], { maxItems: 2 }).errors[0].code).toBe(
      "maxItems",
    );
    expect(validate([1, 1], { uniqueItems: true }).errors[0].code).toBe(
      "uniqueItems",
    );
    // items applies to every element; error carries the index pointer
    const r = validate([1, "two"], { items: { type: "number" } });
    expect(r.errors[0].instancePath).toBe("/1");
    // prefixItems (tuple)
    expect(
      validate(["a", 1], {
        prefixItems: [{ type: "string" }, { type: "number" }],
      }).valid,
    ).toBe(true);
    expect(
      validate([1, 1], { prefixItems: [{ type: "string" }] }).errors[0]
        .instancePath,
    ).toBe("/0");
  });

  it("object minProperties/maxProperties", () => {
    expect(
      validate({}, { type: "object", minProperties: 1 }).errors[0].code,
    ).toBe("minProperties");
    expect(
      validate({ a: 1, b: 2 }, { type: "object", maxProperties: 1 }).errors[0]
        .code,
    ).toBe("maxProperties");
  });
});

describe("validate — combinators + $ref", () => {
  it("anyOf / oneOf / allOf / not", () => {
    const anyOf = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(validate(5, anyOf).valid).toBe(true);
    expect(validate(true, anyOf).errors[0].code).toBe("anyOf");

    const oneOf = { oneOf: [{ type: "number" }, { type: "integer" }] };
    // 5 is both number and integer → matches 2 → oneOf fails
    expect(validate(5, oneOf).errors[0].code).toBe("oneOf");

    const allOf = { allOf: [{ type: "number" }, { minimum: 10 }] };
    expect(validate(5, allOf).errors[0].code).toBe("minimum");

    expect(validate("x", { not: { type: "number" } }).valid).toBe(true);
    expect(validate(5, { not: { type: "number" } }).errors[0].code).toBe("not");
  });

  it("resolves a local $ref into $defs", () => {
    const schema = {
      $defs: { pos: { type: "integer", minimum: 1 } },
      type: "object",
      properties: { qty: { $ref: "#/$defs/pos" } },
    };
    expect(validate({ qty: 3 }, schema).valid).toBe(true);
    expect(
      validate({ qty: 0 }, schema).errors.some((e) => e.code === "minimum"),
    ).toBe(true);
  });

  it("reports an unresolvable $ref", () => {
    expect(validate({}, { $ref: "#/$defs/missing" }).errors[0].code).toBe(
      "$ref",
    );
  });
});

describe("validateSchema (startup meta-validation)", () => {
  it("accepts a well-formed schema and boolean schemas", () => {
    expect(
      validateSchema({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      }).valid,
    ).toBe(true);
    expect(validateSchema(true).valid).toBe(true);
    expect(validateSchema(false).valid).toBe(true);
  });

  it("rejects an unknown type", () => {
    const r = validateSchema({ type: "objetc" });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: "type", schemaPath: "/type" });
  });

  it("rejects a non-array required, non-number numeric, bad regex", () => {
    expect(validateSchema({ required: "a" }).errors[0].code).toBe("required");
    expect(validateSchema({ minimum: "5" }).errors[0].code).toBe("minimum");
    expect(validateSchema({ pattern: "([" }).errors[0].code).toBe("pattern");
    expect(validateSchema({ minLength: -1 }).errors[0].code).toBe("minLength");
    expect(validateSchema({ multipleOf: 0 }).errors[0].code).toBe("multipleOf");
  });

  it("recurses into nested properties and reports the nested schemaPath", () => {
    const r = validateSchema({
      type: "object",
      properties: { a: { type: "wrong" } },
    });
    expect(r.errors[0].schemaPath).toBe("/properties/a/type");
  });
});

describe("buildStructuredResultEvent", () => {
  const schema = {
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
  };

  it("valid → {type, schema_digest, valid:true, value} with no errors", () => {
    const ev = buildStructuredResultEvent({ schema, value: { n: 1 } });
    expect(ev).toMatchObject({
      type: "structured_result",
      valid: true,
      value: { n: 1 },
    });
    expect(ev.schema_digest).toMatch(/^sha256:/);
    expect(ev.errors).toBeUndefined();
  });

  it("invalid → valid:false with coded/pointered errors, never free text", () => {
    const ev = buildStructuredResultEvent({ schema, value: { n: "x" } });
    expect(ev.valid).toBe(false);
    expect(ev.errors[0]).toMatchObject({ code: "type", instancePath: "/n" });
  });
});
