/**
 * JSON Schema (Draft 2020-12 subset) validator with STABLE error codes + RFC
 * 6901 JSON Pointers, schema meta-validation, a schema digest, and a
 * `structured_result` stream event (P2 "JSON Schema 结构化输出").
 *
 * The existing [[json-schema-output.js]] validator covers only
 * type/properties/required/items/enum/const/additionalProperties:false and
 * reports `$.path`-style strings. This module is the richer, protocol-facing
 * core:
 *
 *   validate(value, schema)   → { valid, errors:[{code, keyword, instancePath,
 *                                schemaPath, message}] }  — JSON Pointers + codes
 *   validateSchema(schema)    → meta-validate the schema itself (startup check)
 *   computeSchemaDigest(s)    → "sha256:…" over the canonical schema
 *   buildStructuredResultEvent({schema, value})
 *                             → { type:"structured_result", schema_digest,
 *                                 valid, value, errors? }
 *
 * On failure the caller must surface the codes + pointers, never silently fall
 * back to free text. Pure (crypto only hashes the digest); zero deps.
 *
 * Supported keywords: type (+ integer), enum, const, properties, required,
 * additionalProperties (bool|schema), patternProperties-free, items,
 * prefixItems, minItems/maxItems, uniqueItems, minLength/maxLength, pattern,
 * format (date-time/date/time/email/uri/uuid/ipv4/ipv6/hostname — asserted;
 * unknown formats pass through as annotations), minimum/maximum/
 * exclusiveMinimum/exclusiveMaximum, multipleOf, minProperties/maxProperties,
 * allOf/anyOf/oneOf/not, if/then/else, and local `$ref` (`#/$defs/…`,
 * `#/definitions/…`, or any in-document JSON Pointer).
 */

import crypto from "crypto";

const KNOWN_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

const MAX_REF_DEPTH = 128; // guards recursive $ref against cyclic data

// ─── format assertions ───────────────────────────────────────────────────────
// Draft 2020-12 `format` is asserted here (the protocol-facing structured-output
// contract wants it enforced, not merely annotated). A format not in this map is
// treated as an annotation and always passes. All checkers are pure strings→bool.

function isCalendarDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

function checkDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return !!m && isCalendarDate(+m[1], +m[2], +m[3]);
}

function checkTime(v) {
  const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/.exec(v);
  if (!m) return false;
  const hh = +m[1];
  const mm = +m[2];
  const ss = +m[3];
  return hh <= 23 && mm <= 59 && ss <= 60; // 60 allows a leap second
}

function checkDateTime(v) {
  const m = /^(.+)[Tt](.+)$/.exec(v);
  if (!m) return false;
  // RFC 3339 date-time requires an offset/Z on the time part.
  if (!/([Zz]|[+-]\d{2}:\d{2})$/.test(m[2])) return false;
  return checkDate(m[1]) && checkTime(m[2]);
}

function checkOctet(s) {
  if (!/^\d{1,3}$/.test(s)) return false;
  if (s.length > 1 && s[0] === "0") return false; // no leading zeros
  return +s <= 255;
}

function checkIpv4(v) {
  const parts = v.split(".");
  return parts.length === 4 && parts.every(checkOctet);
}

function checkIpv6(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  // At most one "::" compression; split on it.
  const halves = v.split("::");
  if (halves.length > 2) return false;
  const hextet = /^[0-9a-fA-F]{1,4}$/;
  if (halves.length === 2) {
    const left = halves[0] === "" ? [] : halves[0].split(":");
    const right = halves[1] === "" ? [] : halves[1].split(":");
    if (
      !left.every((g) => hextet.test(g)) ||
      !right.every((g) => hextet.test(g))
    )
      return false;
    return left.length + right.length <= 7; // "::" stands for ≥1 zero group
  }
  const groups = v.split(":");
  return groups.length === 8 && groups.every((g) => hextet.test(g));
}

function checkHostname(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > 253) return false;
  const labels = v.replace(/\.$/, "").split(".");
  return labels.every((l) =>
    /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l),
  );
}

const FORMAT_CHECKERS = {
  "date-time": checkDateTime,
  date: checkDate,
  time: checkTime,
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  uri: (v) => /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(v),
  uuid: (v) =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      v,
    ),
  ipv4: checkIpv4,
  ipv6: checkIpv6,
  hostname: checkHostname,
};

/** Known format names (exported for meta-validation / callers). */
export const KNOWN_FORMATS = new Set(Object.keys(FORMAT_CHECKERS));

/** RFC 6901 JSON Pointer from a segment array ("" = document root). */
export function jsonPointer(segments) {
  if (!segments || segments.length === 0) return "";
  return (
    "/" +
    segments
      .map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1"))
      .join("/")
  );
}

/** JSON value type per Draft 2020-12 (integer is a refinement of number). */
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function deepEqual(a, b) {
  return canonical(a) === canonical(b);
}

/** Canonical JSON (sorted keys) — stable across key order for digest + equality. */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/** "sha256:<hex>" over the canonical form of the schema. */
export function computeSchemaDigest(schema) {
  const h = crypto.createHash("sha256");
  h.update(canonical(schema));
  return `sha256:${h.digest("hex")}`;
}

/** Resolve a local `#/...` JSON Pointer $ref within `root`; null if unresolved. */
function resolveRef(root, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#")) return null;
  const frag = ref.slice(1);
  if (frag === "" || frag === "/") return root;
  const parts = frag
    .replace(/^\//, "")
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return cur === undefined ? null : cur;
}

// ─── instance validation ─────────────────────────────────────────────────────

/**
 * Validate `value` against `schema`.
 * @returns {{valid:boolean, errors:Array<{code,keyword,instancePath,schemaPath,message}>}}
 */
export function validate(value, schema) {
  const errors = [];
  _validate(value, schema, [], [], schema, errors, 0);
  return { valid: errors.length === 0, errors };
}

function _err(errors, keyword, instSegs, schemaSegs, message) {
  errors.push({
    code: keyword,
    keyword,
    instancePath: jsonPointer(instSegs),
    schemaPath: jsonPointer(schemaSegs),
    message,
  });
}

function _validate(value, schema, inst, sch, root, errors, depth) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    _err(errors, "false", inst, sch, "schema is `false` — no value is valid");
    return;
  }
  if (!schema || typeof schema !== "object") return;
  if (depth > MAX_REF_DEPTH) return; // cyclic $ref guard

  // $ref — validate against the referenced schema (local only).
  if (typeof schema.$ref === "string") {
    const target = resolveRef(root, schema.$ref);
    if (target == null) {
      _err(
        errors,
        "$ref",
        inst,
        [...sch, "$ref"],
        `cannot resolve $ref "${schema.$ref}"`,
      );
    } else {
      _validate(value, target, inst, [...sch, "$ref"], root, errors, depth + 1);
    }
    // sibling keywords still apply in 2020-12; fall through.
  }

  const t = typeOf(value);

  if (schema.type !== undefined) {
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = want.some((x) => x === t || (x === "number" && t === "integer"));
    if (!ok) {
      _err(
        errors,
        "type",
        inst,
        [...sch, "type"],
        `expected type ${want.join("|")}, got ${t}`,
      );
      return; // type mismatch — deeper checks would be noise
    }
  }

  if (schema.enum !== undefined) {
    if (
      !Array.isArray(schema.enum) ||
      !schema.enum.some((e) => deepEqual(e, value))
    ) {
      _err(
        errors,
        "enum",
        inst,
        [...sch, "enum"],
        "value is not one of the allowed enum values",
      );
    }
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    _err(
      errors,
      "const",
      inst,
      [...sch, "const"],
      `value must equal ${JSON.stringify(schema.const)}`,
    );
  }

  if (t === "string") _validateString(value, schema, inst, sch, errors);
  if (t === "number" || t === "integer")
    _validateNumber(value, schema, inst, sch, errors);
  if (t === "array")
    _validateArray(value, schema, inst, sch, root, errors, depth);
  if (t === "object")
    _validateObject(value, schema, inst, sch, root, errors, depth);

  _validateCombinators(value, schema, inst, sch, root, errors, depth);
  _validateConditional(value, schema, inst, sch, root, errors, depth);
}

/**
 * if/then/else — Draft 2020-12 conditional application. `if` is a *test* whose
 * own errors are never reported; if the value matches `if`, `then` applies,
 * otherwise `else` applies. No `if` keyword ⇒ then/else are inert.
 */
function _validateConditional(value, schema, inst, sch, root, errors, depth) {
  if (schema.if === undefined) return;
  const matched = _branchValid(value, schema.if, root, depth);
  if (matched) {
    if (schema.then !== undefined) {
      _validate(
        value,
        schema.then,
        inst,
        [...sch, "then"],
        root,
        errors,
        depth,
      );
    }
  } else if (schema.else !== undefined) {
    _validate(value, schema.else, inst, [...sch, "else"], root, errors, depth);
  }
}

function _validateString(value, schema, inst, sch, errors) {
  if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
    _err(
      errors,
      "minLength",
      inst,
      [...sch, "minLength"],
      `string is shorter than minLength ${schema.minLength}`,
    );
  }
  if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
    _err(
      errors,
      "maxLength",
      inst,
      [...sch, "maxLength"],
      `string is longer than maxLength ${schema.maxLength}`,
    );
  }
  if (typeof schema.pattern === "string") {
    let re;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      re = null;
    }
    if (re && !re.test(value)) {
      _err(
        errors,
        "pattern",
        inst,
        [...sch, "pattern"],
        `string does not match pattern ${schema.pattern}`,
      );
    }
  }
  if (typeof schema.format === "string") {
    const check = FORMAT_CHECKERS[schema.format];
    // Unknown format = annotation only (always passes), per Draft 2020-12.
    if (check && !check(value)) {
      _err(
        errors,
        "format",
        inst,
        [...sch, "format"],
        `string is not a valid ${schema.format}`,
      );
    }
  }
}

function _validateNumber(value, schema, inst, sch, errors) {
  if (Number.isFinite(schema.minimum) && value < schema.minimum) {
    _err(
      errors,
      "minimum",
      inst,
      [...sch, "minimum"],
      `value is less than minimum ${schema.minimum}`,
    );
  }
  if (Number.isFinite(schema.maximum) && value > schema.maximum) {
    _err(
      errors,
      "maximum",
      inst,
      [...sch, "maximum"],
      `value is greater than maximum ${schema.maximum}`,
    );
  }
  if (
    Number.isFinite(schema.exclusiveMinimum) &&
    value <= schema.exclusiveMinimum
  ) {
    _err(
      errors,
      "exclusiveMinimum",
      inst,
      [...sch, "exclusiveMinimum"],
      `value must be > ${schema.exclusiveMinimum}`,
    );
  }
  if (
    Number.isFinite(schema.exclusiveMaximum) &&
    value >= schema.exclusiveMaximum
  ) {
    _err(
      errors,
      "exclusiveMaximum",
      inst,
      [...sch, "exclusiveMaximum"],
      `value must be < ${schema.exclusiveMaximum}`,
    );
  }
  if (Number.isFinite(schema.multipleOf) && schema.multipleOf > 0) {
    const q = value / schema.multipleOf;
    if (Math.abs(q - Math.round(q)) > 1e-9) {
      _err(
        errors,
        "multipleOf",
        inst,
        [...sch, "multipleOf"],
        `value is not a multiple of ${schema.multipleOf}`,
      );
    }
  }
}

function _validateArray(value, schema, inst, sch, root, errors, depth) {
  if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
    _err(
      errors,
      "minItems",
      inst,
      [...sch, "minItems"],
      `array has fewer than minItems ${schema.minItems}`,
    );
  }
  if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
    _err(
      errors,
      "maxItems",
      inst,
      [...sch, "maxItems"],
      `array has more than maxItems ${schema.maxItems}`,
    );
  }
  if (schema.uniqueItems === true) {
    const seen = new Set();
    for (const item of value) {
      const key = canonical(item);
      if (seen.has(key)) {
        _err(
          errors,
          "uniqueItems",
          inst,
          [...sch, "uniqueItems"],
          "array items are not unique",
        );
        break;
      }
      seen.add(key);
    }
  }
  const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
  if (schema.contains !== undefined) {
    const matches = value.reduce(
      (count, item, i) =>
        count + (_branchValid(item, schema.contains, root, depth) ? 1 : 0),
      0,
    );
    const min = Number.isFinite(schema.minContains) ? schema.minContains : 1;
    const max = Number.isFinite(schema.maxContains) ? schema.maxContains : Infinity;
    if (matches < min || matches > max) {
      _err(
        errors,
        "contains",
        inst,
        [...sch, "contains"],
        `array contains ${matches} matching item(s), expected ${min}${max === Infinity ? "+" : `..${max}`}`,
      );
    }
  }
  value.forEach((item, i) => {
    if (i < prefix.length) {
      _validate(
        item,
        prefix[i],
        [...inst, i],
        [...sch, "prefixItems", i],
        root,
        errors,
        depth,
      );
    } else if (schema.items !== undefined) {
      _validate(
        item,
        schema.items,
        [...inst, i],
        [...sch, "items"],
        root,
        errors,
        depth,
      );
    }
  });
}

function _validateObject(value, schema, inst, sch, root, errors, depth) {
  const keys = Object.keys(value);
  if (
    Number.isFinite(schema.minProperties) &&
    keys.length < schema.minProperties
  ) {
    _err(
      errors,
      "minProperties",
      inst,
      [...sch, "minProperties"],
      `object has fewer than minProperties ${schema.minProperties}`,
    );
  }
  if (
    Number.isFinite(schema.maxProperties) &&
    keys.length > schema.maxProperties
  ) {
    _err(
      errors,
      "maxProperties",
      inst,
      [...sch, "maxProperties"],
      `object has more than maxProperties ${schema.maxProperties}`,
    );
  }
  for (const req of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(value, req)) {
      _err(
        errors,
        "required",
        inst,
        [...sch, "required"],
        `missing required property "${req}"`,
      );
    }
  }
  const props = schema.properties || {};
  const patterns = schema.patternProperties || {};
  const patternEntries = Object.entries(patterns).map(([pattern, sub]) => {
    try { return [new RegExp(pattern), pattern, sub]; } catch { return [null, pattern, sub]; }
  });
  for (const [k, v] of Object.entries(value)) {
    if (Object.prototype.hasOwnProperty.call(props, k)) {
      _validate(
        v,
        props[k],
        [...inst, k],
        [...sch, "properties", k],
        root,
        errors,
        depth,
      );
    } else {
      const matches = patternEntries.filter(([re]) => re && re.test(k));
      if (matches.length > 0) {
        for (const [, pattern, sub] of matches) {
          _validate(v, sub, [...inst, k], [...sch, "patternProperties", pattern], root, errors, depth);
        }
        continue;
      }
      if (schema.additionalProperties === false || schema.unevaluatedProperties === false) {
      _err(
        errors,
        schema.additionalProperties === false ? "additionalProperties" : "unevaluatedProperties",
        [...inst, k],
        [...sch, schema.additionalProperties === false ? "additionalProperties" : "unevaluatedProperties"],
        `unexpected property "${k}"`,
      );
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      _validate(
        v,
        schema.additionalProperties,
        [...inst, k],
        [...sch, "additionalProperties"],
        root,
        errors,
        depth,
      );
      }
    }
  }
  if (schema.propertyNames !== undefined) {
    for (const key of keys) {
      _validate(key, schema.propertyNames, [...inst, key], [...sch, "propertyNames"], root, errors, depth);
    }
  }
  if (schema.dependentRequired && typeof schema.dependentRequired === "object") {
    for (const [key, required] of Object.entries(schema.dependentRequired)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      for (const dep of Array.isArray(required) ? required : []) {
        if (!Object.prototype.hasOwnProperty.call(value, dep)) {
          _err(errors, "dependentRequired", inst, [...sch, "dependentRequired", key], `property "${key}" requires property "${dep}"`);
        }
      }
    }
  }
  if (schema.dependentSchemas && typeof schema.dependentSchemas === "object") {
    for (const [key, sub] of Object.entries(schema.dependentSchemas)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        _validate(value, sub, inst, [...sch, "dependentSchemas", key], root, errors, depth);
      }
    }
  }
}

function _branchValid(value, subschema, root, depth) {
  const errs = [];
  _validate(value, subschema, [], [], root, errs, depth + 1);
  return errs.length === 0;
}

function _validateCombinators(value, schema, inst, sch, root, errors, depth) {
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((s, i) => {
      _validate(value, s, inst, [...sch, "allOf", i], root, errors, depth);
    });
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((s) => _branchValid(value, s, root, depth));
    if (!ok)
      _err(
        errors,
        "anyOf",
        inst,
        [...sch, "anyOf"],
        "value does not match any of the anyOf schemas",
      );
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((s) =>
      _branchValid(value, s, root, depth),
    ).length;
    if (matches !== 1) {
      _err(
        errors,
        "oneOf",
        inst,
        [...sch, "oneOf"],
        `value matched ${matches} oneOf schemas (must match exactly 1)`,
      );
    }
  }
  if (
    schema.not !== undefined &&
    _branchValid(value, schema.not, root, depth)
  ) {
    _err(
      errors,
      "not",
      inst,
      [...sch, "not"],
      "value must NOT match the `not` schema",
    );
  }
}

// ─── schema meta-validation (startup) ────────────────────────────────────────

/**
 * Meta-validate a schema itself — the "启动时校验 schema" check. Rejects a
 * malformed schema (bad type value, non-array required, non-number numeric
 * keyword, invalid regex, non-object properties, …) so a broken contract fails
 * fast instead of silently mis-validating every value.
 *
 * @returns {{valid:boolean, errors:Array<{code, schemaPath, message}>}}
 */
export function validateSchema(schema) {
  const errors = [];
  _metaValidate(schema, [], errors, 0);
  return { valid: errors.length === 0, errors };
}

function _metaErr(errors, code, segs, message) {
  errors.push({ code, schemaPath: jsonPointer(segs), message });
}

function _metaValidate(schema, segs, errors, depth) {
  if (schema === true || schema === false) return; // boolean schemas are valid
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    _metaErr(errors, "schema", segs, "schema must be an object or a boolean");
    return;
  }
  if (depth > MAX_REF_DEPTH) return;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const x of types) {
      if (!KNOWN_TYPES.has(x)) {
        _metaErr(errors, "type", [...segs, "type"], `unknown type "${x}"`);
      }
    }
  }
  if (schema.required !== undefined) {
    if (
      !Array.isArray(schema.required) ||
      schema.required.some((r) => typeof r !== "string")
    ) {
      _metaErr(
        errors,
        "required",
        [...segs, "required"],
        "required must be an array of strings",
      );
    }
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    _metaErr(errors, "enum", [...segs, "enum"], "enum must be an array");
  }
  for (const k of [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
  ]) {
    if (schema[k] !== undefined && typeof schema[k] !== "number") {
      _metaErr(errors, k, [...segs, k], `${k} must be a number`);
    }
  }
  if (
    schema.multipleOf !== undefined &&
    typeof schema.multipleOf === "number" &&
    schema.multipleOf <= 0
  ) {
    _metaErr(
      errors,
      "multipleOf",
      [...segs, "multipleOf"],
      "multipleOf must be > 0",
    );
  }
  for (const k of [
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
    "minContains",
    "maxContains",
  ]) {
    if (
      schema[k] !== undefined &&
      (!Number.isInteger(schema[k]) || schema[k] < 0)
    ) {
      _metaErr(errors, k, [...segs, k], `${k} must be a non-negative integer`);
    }
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") {
      _metaErr(
        errors,
        "pattern",
        [...segs, "pattern"],
        "pattern must be a string",
      );
    } else {
      try {
        new RegExp(schema.pattern);
      } catch (e) {
        _metaErr(
          errors,
          "pattern",
          [...segs, "pattern"],
          `pattern is not a valid regex: ${e.message}`,
        );
      }
    }
  }
  if (schema.$ref !== undefined && typeof schema.$ref !== "string") {
    _metaErr(errors, "$ref", [...segs, "$ref"], "$ref must be a string");
  }
  if (schema.properties !== undefined) {
    if (
      typeof schema.properties !== "object" ||
      Array.isArray(schema.properties)
    ) {
      _metaErr(
        errors,
        "properties",
        [...segs, "properties"],
        "properties must be an object",
      );
    } else {
      for (const [k, sub] of Object.entries(schema.properties)) {
        _metaValidate(sub, [...segs, "properties", k], errors, depth + 1);
      }
    }
  }
  for (const k of ["patternProperties", "dependentSchemas"]) {
    if (schema[k] === undefined) continue;
    if (typeof schema[k] !== "object" || Array.isArray(schema[k])) {
      _metaErr(errors, k, [...segs, k], `${k} must be an object`);
    } else {
      for (const [name, sub] of Object.entries(schema[k])) {
        if (k === "patternProperties") {
          try { new RegExp(name); } catch (e) { _metaErr(errors, k, [...segs, k, name], `invalid regex: ${e.message}`); }
        }
        _metaValidate(sub, [...segs, k, name], errors, depth + 1);
      }
    }
  }
  if (schema.propertyNames !== undefined) {
    _metaValidate(schema.propertyNames, [...segs, "propertyNames"], errors, depth + 1);
  }
  if (schema.dependentRequired !== undefined) {
    if (typeof schema.dependentRequired !== "object" || Array.isArray(schema.dependentRequired)) {
      _metaErr(errors, "dependentRequired", [...segs, "dependentRequired"], "dependentRequired must be an object");
    } else {
      for (const [key, required] of Object.entries(schema.dependentRequired)) {
        if (!Array.isArray(required) || required.some((v) => typeof v !== "string")) {
          _metaErr(errors, "dependentRequired", [...segs, "dependentRequired", key], "dependentRequired values must be arrays of strings");
        }
      }
    }
  }
  if (schema.contains !== undefined) {
    _metaValidate(schema.contains, [...segs, "contains"], errors, depth + 1);
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties === "object"
  ) {
    _metaValidate(
      schema.additionalProperties,
      [...segs, "additionalProperties"],
      errors,
      depth + 1,
    );
  }
  if (schema.items !== undefined) {
    _metaValidate(schema.items, [...segs, "items"], errors, depth + 1);
  }
  if (schema.prefixItems !== undefined) {
    if (!Array.isArray(schema.prefixItems)) {
      _metaErr(
        errors,
        "prefixItems",
        [...segs, "prefixItems"],
        "prefixItems must be an array of schemas",
      );
    } else {
      schema.prefixItems.forEach((sub, i) =>
        _metaValidate(sub, [...segs, "prefixItems", i], errors, depth + 1),
      );
    }
  }
  for (const k of ["allOf", "anyOf", "oneOf"]) {
    if (schema[k] !== undefined) {
      if (!Array.isArray(schema[k])) {
        _metaErr(errors, k, [...segs, k], `${k} must be an array of schemas`);
      } else {
        schema[k].forEach((sub, i) =>
          _metaValidate(sub, [...segs, k, i], errors, depth + 1),
        );
      }
    }
  }
  if (schema.not !== undefined)
    _metaValidate(schema.not, [...segs, "not"], errors, depth + 1);
  if (schema.format !== undefined && typeof schema.format !== "string") {
    _metaErr(errors, "format", [...segs, "format"], "format must be a string");
  }
  for (const k of ["if", "then", "else"]) {
    if (schema[k] !== undefined) {
      _metaValidate(schema[k], [...segs, k], errors, depth + 1);
    }
  }
  for (const defsKey of ["$defs", "definitions"]) {
    if (schema[defsKey] !== undefined) {
      if (
        typeof schema[defsKey] !== "object" ||
        Array.isArray(schema[defsKey])
      ) {
        _metaErr(
          errors,
          defsKey,
          [...segs, defsKey],
          `${defsKey} must be an object`,
        );
      } else {
        for (const [k, sub] of Object.entries(schema[defsKey])) {
          _metaValidate(sub, [...segs, defsKey, k], errors, depth + 1);
        }
      }
    }
  }
}

// ─── structured_result stream event ──────────────────────────────────────────

/**
 * Build the terminal `structured_result` stream event. Carries the schema
 * digest (so a consumer can pin the contract), the validity, the value, and —
 * when invalid — the coded/pointered errors. Never returns free text.
 */
export function buildStructuredResultEvent({ schema, value }) {
  const { valid, errors } = validate(value, schema);
  const event = {
    type: "structured_result",
    schema_digest: computeSchemaDigest(schema),
    valid,
    value,
  };
  if (!valid) event.errors = errors;
  return event;
}
