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
  KNOWN_FORMATS,
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

describe("validate — format assertions", () => {
  it("exposes the known format set", () => {
    expect(KNOWN_FORMATS.has("date-time")).toBe(true);
    expect(KNOWN_FORMATS.has("email")).toBe(true);
    expect(KNOWN_FORMATS.has("uuid")).toBe(true);
  });

  it("date-time (RFC 3339) — needs a date, time and offset", () => {
    expect(
      validate("2026-07-12T10:30:00Z", { format: "date-time" }).valid,
    ).toBe(true);
    expect(
      validate("2026-07-12T10:30:00+08:00", { format: "date-time" }).valid,
    ).toBe(true);
    // no offset
    expect(validate("2026-07-12T10:30:00", { format: "date-time" }).valid).toBe(
      false,
    );
    // not a datetime at all
    expect(validate("2026-07-12", { format: "date-time" }).valid).toBe(false);
  });

  it("date rejects impossible calendar dates", () => {
    expect(validate("2024-02-29", { format: "date" }).valid).toBe(true); // leap
    expect(validate("2023-02-29", { format: "date" }).valid).toBe(false); // not leap
    expect(validate("2026-13-01", { format: "date" }).valid).toBe(false); // month 13
    expect(validate("2026-04-31", { format: "date" }).valid).toBe(false); // April has 30
  });

  it("time accepts leap second, rejects out-of-range", () => {
    expect(validate("23:59:60", { format: "time" }).valid).toBe(true);
    expect(validate("24:00:00", { format: "time" }).valid).toBe(false);
    expect(validate("10:61:00", { format: "time" }).valid).toBe(false);
  });

  it("email / uri / uuid", () => {
    expect(validate("a@b.com", { format: "email" }).valid).toBe(true);
    expect(validate("no-at-sign", { format: "email" }).valid).toBe(false);
    expect(validate("https://x.io/p?q=1", { format: "uri" }).valid).toBe(true);
    expect(validate("/relative/path", { format: "uri" }).valid).toBe(false);
    expect(
      validate("123e4567-e89b-12d3-a456-426614174000", { format: "uuid" })
        .valid,
    ).toBe(true);
    expect(validate("not-a-uuid", { format: "uuid" }).valid).toBe(false);
  });

  it("ipv4 rejects >255 octets and leading zeros", () => {
    expect(validate("192.168.0.1", { format: "ipv4" }).valid).toBe(true);
    expect(validate("256.0.0.1", { format: "ipv4" }).valid).toBe(false);
    expect(validate("192.168.01.1", { format: "ipv4" }).valid).toBe(false);
    expect(validate("1.2.3", { format: "ipv4" }).valid).toBe(false);
  });

  it("ipv6 accepts full + :: compressed, rejects garbage", () => {
    expect(
      validate("2001:0db8:0000:0000:0000:0000:0000:0001", { format: "ipv6" })
        .valid,
    ).toBe(true);
    expect(validate("2001:db8::1", { format: "ipv6" }).valid).toBe(true);
    expect(validate("::1", { format: "ipv6" }).valid).toBe(true);
    expect(validate("not:ipv6", { format: "ipv6" }).valid).toBe(false);
    expect(validate("2001:db8:::1", { format: "ipv6" }).valid).toBe(false);
  });

  it("hostname per RFC 1123 labels", () => {
    expect(validate("example.com", { format: "hostname" }).valid).toBe(true);
    expect(validate("-bad.com", { format: "hostname" }).valid).toBe(false);
    expect(validate("a..b", { format: "hostname" }).valid).toBe(false);
  });

  it("unknown format is annotation-only (always passes)", () => {
    expect(validate("anything", { format: "made-up-format" }).valid).toBe(true);
  });

  it("format error carries the format code + JSON Pointer", () => {
    const schema = {
      type: "object",
      properties: { when: { type: "string", format: "date-time" } },
    };
    const r = validate({ when: "nope" }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatchObject({
      code: "format",
      keyword: "format",
      instancePath: "/when",
      schemaPath: "/properties/when/format",
    });
  });
});

describe("validate — if/then/else conditional", () => {
  // if country is US, postal must be 5 digits, else non-empty
  const schema = {
    type: "object",
    properties: { country: {}, postal: { type: "string" } },
    if: { properties: { country: { const: "US" } }, required: ["country"] },
    then: { properties: { postal: { pattern: "^[0-9]{5}$" } } },
    else: { properties: { postal: { minLength: 1 } } },
  };

  it("applies `then` when `if` matches", () => {
    expect(validate({ country: "US", postal: "94107" }, schema).valid).toBe(
      true,
    );
    const bad = validate({ country: "US", postal: "abc" }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.schemaPath.startsWith("/then"))).toBe(true);
  });

  it("applies `else` when `if` does not match", () => {
    expect(validate({ country: "CA", postal: "K1A" }, schema).valid).toBe(true);
    const bad = validate({ country: "CA", postal: "" }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.schemaPath.startsWith("/else"))).toBe(true);
  });

  it("`if` errors are never reported (it is only a test)", () => {
    // value fails `if` (no country) → else applies; there must be no error
    // whose schemaPath points into `/if`.
    const r = validate({ postal: "x" }, schema);
    expect(r.valid).toBe(true);
    expect(r.errors.every((e) => !e.schemaPath.startsWith("/if"))).toBe(true);
  });

  it("`then`/`else` are inert without `if`", () => {
    expect(
      validate("x", { then: { type: "number" }, else: { type: "boolean" } })
        .valid,
    ).toBe(true);
  });
});

describe("validate Draft 2020-12 dependent and collection keywords", () => {
  it("supports patternProperties, dependentRequired, and dependentSchemas", () => {
    const schema = {
      type: "object",
      patternProperties: { "^x-": { type: "number" } },
      dependentRequired: { creditCard: ["billingAddress"] },
      dependentSchemas: { creditCard: { required: ["billingAddress"] } },
      unevaluatedProperties: false,
    };
    expect(validate({ "x-count": 2 }, schema).valid).toBe(true);
    expect(validate({ "x-count": "2" }, schema).valid).toBe(false);
    expect(validate({ creditCard: "1" }, schema).errors.some((e) => e.code === "dependentRequired")).toBe(true);
    expect(validate({ unknown: true }, schema).errors.some((e) => e.code === "unevaluatedProperties")).toBe(true);
  });

  it("supports contains with minContains/maxContains and propertyNames", () => {
    const schema = {
      type: "array",
      contains: { type: "integer" },
      minContains: 2,
      maxContains: 2,
    };
    expect(validate([1, "x", 2], schema).valid).toBe(true);
    expect(validate([1, "x"], schema).valid).toBe(false);
    expect(validate({ good: 1 }, { type: "object", propertyNames: { pattern: "^[a-z]+$" } }).valid).toBe(true);
    expect(validate({ "Bad-Key": 1 }, { type: "object", propertyNames: { pattern: "^[a-z]+$" } }).valid).toBe(false);
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

  it("rejects a non-string format", () => {
    expect(validateSchema({ format: 42 }).errors[0]).toMatchObject({
      code: "format",
      schemaPath: "/format",
    });
    expect(validateSchema({ format: "email" }).valid).toBe(true);
  });

  it("recurses into if/then/else subschemas", () => {
    const r = validateSchema({
      if: { type: "string" },
      then: { type: "wrong" },
    });
    expect(r.errors[0].schemaPath).toBe("/then/type");
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
