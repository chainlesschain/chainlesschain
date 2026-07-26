/**
 * Draft 2020-12 JSON Schema validation for structured CLI output.
 *
 * The public result shape is intentionally stable even though the standards
 * implementation is provided by Ajv:
 *
 *   validate(value, schema) -> {
 *     valid,
 *     errors: [{ code, keyword, instancePath, schemaPath, message }]
 *   }
 *
 * Ajv supplies the complete Draft 2020-12 vocabularies, including dynamic
 * references and unevaluated locations. This adapter preserves the CLI's RFC
 * 6901 pointers, stable keyword codes, schema digest and structured-result
 * envelope.
 */

import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ATTACHED_EXTERNAL_SCHEMAS = new WeakMap();
const COMPILED_VALIDATORS = new WeakMap();

const SCHEMA_KEYWORDS = new Set([
  "$anchor",
  "$comment",
  "$defs",
  "$dynamicAnchor",
  "$dynamicRef",
  "$id",
  "$ref",
  "$schema",
  "$vocabulary",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "contains",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "default",
  "dependentRequired",
  "dependentSchemas",
  "deprecated",
  "description",
  "else",
  "enum",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "if",
  "items",
  "maxContains",
  "maximum",
  "maxItems",
  "maxLength",
  "maxProperties",
  "minContains",
  "minimum",
  "minItems",
  "minLength",
  "minProperties",
  "multipleOf",
  "not",
  "oneOf",
  "pattern",
  "patternProperties",
  "prefixItems",
  "properties",
  "propertyNames",
  "readOnly",
  "required",
  "then",
  "title",
  "type",
  "unevaluatedItems",
  "unevaluatedProperties",
  "uniqueItems",
  "writeOnly",
]);

/** Formats asserted by ajv-formats in full mode. */
export const KNOWN_FORMATS = new Set([
  "date",
  "time",
  "date-time",
  "duration",
  "uri",
  "uri-reference",
  "uri-template",
  "url",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "regex",
  "uuid",
  "json-pointer",
  "relative-json-pointer",
]);

function isCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap =
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= days[month - 1];
}

function checkDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return (
    Boolean(match) &&
    isCalendarDate(+match[1], +match[2], +match[3])
  );
}

function checkTime(value) {
  const match =
    /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const hours = +match[1];
  const minutes = +match[2];
  const seconds = +match[3];
  const offset = match[5];
  if (hours > 23 || minutes > 59 || seconds > 60) return false;
  if (/^[+-]/.test(offset)) {
    const [offsetHours, offsetMinutes] = offset
      .slice(1)
      .split(":")
      .map(Number);
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return true;
}

function checkDateTime(value) {
  const match = /^(.+)[Tt](.+)$/.exec(value);
  return Boolean(match) && checkDate(match[1]) && checkTime(match[2]);
}

/** RFC 6901 JSON Pointer from a segment array ("" = document root). */
export function jsonPointer(segments) {
  if (!segments || segments.length === 0) return "";
  return `/${segments
    .map((segment) =>
      String(segment).replace(/~/g, "~0").replace(/\//g, "~1"),
    )
    .join("/")}`;
}

/** Canonical JSON with recursively sorted object keys. */
export function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

/** "sha256:<hex>" over the canonical form of the schema. */
export function computeSchemaDigest(schema) {
  const attached =
    schema && typeof schema === "object"
      ? ATTACHED_EXTERNAL_SCHEMAS.get(schema)
      : null;
  const externalSchemas = attached?.externalSchemas || {};
  const digestInput =
    Object.keys(externalSchemas).length > 0
      ? { schema, externalSchemas }
      : schema;
  const hash = crypto.createHash("sha256");
  hash.update(canonical(digestInput));
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Associate resolved external documents with a root schema without mutating
 * the JSON value (and therefore without changing its digest or model prompt).
 */
export function attachExternalSchemas(
  schema,
  externalSchemas = {},
  { baseUri = null } = {},
) {
  if (schema && typeof schema === "object") {
    COMPILED_VALIDATORS.delete(schema);
    ATTACHED_EXTERNAL_SCHEMAS.set(schema, {
      baseUri,
      externalSchemas: { ...externalSchemas },
    });
  }
  return schema;
}

function decodePointerSegment(value) {
  return String(value || "")
    .replace(/~1/g, "/")
    .replace(/~0/g, "~");
}

function appendPointer(pointer, segment) {
  const encoded = String(segment)
    .replace(/~/g, "~0")
    .replace(/\//g, "~1");
  return `${pointer || ""}/${encoded}`;
}

function schemaPathFromAjv(value) {
  const path = String(value || "");
  return path.startsWith("#") ? path.slice(1) : path;
}

function stableMessage(error) {
  const params = error?.params || {};
  switch (error?.keyword) {
    case "required":
      return `missing required property "${params.missingProperty}"`;
    case "additionalProperties":
    case "unevaluatedProperties":
      return `unexpected property "${
        params.additionalProperty || params.unevaluatedProperty
      }"`;
    case "type":
      return `expected type ${params.type}, got a different type`;
    case "enum":
      return "value is not one of the allowed enum values";
    case "format":
      return `string is not a valid ${params.format}`;
    default:
      return `${error?.keyword || "schema"}: ${
        error?.message || "validation failed"
      }`;
  }
}

function normalizeValidationError(error) {
  const keyword = error?.keyword || "schema";
  let instancePath = String(error?.instancePath || "");
  if (keyword === "additionalProperties") {
    instancePath = appendPointer(
      instancePath,
      error?.params?.additionalProperty,
    );
  } else if (keyword === "unevaluatedProperties") {
    instancePath = appendPointer(
      instancePath,
      error?.params?.unevaluatedProperty,
    );
  }
  return {
    code: keyword,
    keyword,
    instancePath,
    schemaPath: schemaPathFromAjv(error?.schemaPath),
    message: stableMessage(error),
  };
}

function normalizeValidationErrors(errors) {
  const normalized = (errors || []).map(normalizeValidationError);
  // Preserve the original CLI contract: aggregate applicator failures precede
  // their noisy branch details, so retry prompts lead with the actionable rule.
  const aggregate = new Set(["anyOf", "oneOf", "not"]);
  return normalized
    .map((error, index) => ({ error, index }))
    .sort((a, b) => {
      const aRank = aggregate.has(a.error.keyword) ? 0 : 1;
      const bRank = aggregate.has(b.error.keyword) ? 0 : 1;
      return aRank - bRank || a.index - b.index;
    })
    .map(({ error }) => error);
}

function mergedExternalSchemas(schema, externalSchemas) {
  const attached =
    schema && typeof schema === "object"
      ? ATTACHED_EXTERNAL_SCHEMAS.get(schema)
      : null;
  return {
    baseUri: attached?.baseUri || null,
    externalSchemas: {
      ...(attached?.externalSchemas || {}),
      ...(externalSchemas || {}),
    },
  };
}

function createAjv(externalSchemas = {}) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: true,
    logger: false,
  });
  addFormats(ajv, { mode: "full" });
  // ajv-formats historically rejects RFC 3339 leap seconds. Draft 2020-12
  // delegates to RFC 3339, whose full-time grammar permits second 60.
  ajv.addFormat("date", { type: "string", validate: checkDate });
  ajv.addFormat("time", { type: "string", validate: checkTime });
  ajv.addFormat("date-time", {
    type: "string",
    validate: checkDateTime,
  });

  const registered = new Set();
  for (const [rawUri, document] of Object.entries(externalSchemas || {})) {
    if (
      document === undefined ||
      (!document && document !== false) ||
      (typeof document !== "object" && typeof document !== "boolean")
    ) {
      continue;
    }
    let uri = String(rawUri);
    try {
      const parsed = new URL(uri);
      parsed.hash = "";
      uri = parsed.href;
    } catch {
      // Ajv also accepts caller-defined non-URL registry keys.
    }
    if (registered.has(uri)) continue;
    ajv.addSchema(document, uri);
    registered.add(uri);
  }
  return ajv;
}

function unresolvedReferenceError(cause, schema) {
  const missingReference =
    Boolean(cause?.missingRef) || cause?.name === "MissingRefError";
  const dynamic =
    String(cause?.message || "").includes("$dynamicRef") &&
    schema?.$dynamicRef;
  const keyword = missingReference
    ? dynamic
      ? "$dynamicRef"
      : "$ref"
    : "schema";
  return {
    code: keyword,
    keyword,
    instancePath: "",
    schemaPath: keyword === "schema" ? "" : `/${keyword}`,
    message: missingReference && cause?.missingRef
      ? `cannot resolve ${keyword} "${cause.missingRef}"`
      : cause?.message || "cannot compile JSON Schema",
  };
}

/**
 * Compile a root schema and all caller-provided/attached external documents.
 * The returned function is synchronous because every remote document must be
 * resolved before a structured-output turn starts.
 */
export function compileSchema(schema, { externalSchemas = {} } = {}) {
  const cacheable =
    schema &&
    typeof schema === "object" &&
    Object.keys(externalSchemas || {}).length === 0;
  const digest = cacheable ? computeSchemaDigest(schema) : null;
  const cached = cacheable ? COMPILED_VALIDATORS.get(schema) : null;
  if (cached?.digest === digest) {
    return cached.validator;
  }
  const context = mergedExternalSchemas(schema, externalSchemas);
  const ajv = createAjv(context.externalSchemas);
  let validator;
  if (context.baseUri) {
    ajv.addSchema(schema, context.baseUri);
    validator = ajv.getSchema(context.baseUri);
    if (!validator) {
      throw new Error(`could not compile schema at ${context.baseUri}`);
    }
  } else {
    validator = ajv.compile(schema);
  }
  if (cacheable) {
    COMPILED_VALIDATORS.set(schema, { digest, validator });
  }
  return validator;
}

/**
 * Validate `value` against a Draft 2020-12 schema.
 *
 * Compilation failures (most notably unresolved references) are represented in
 * the same stable error envelope instead of escaping or falling back to text.
 */
export function validate(value, schema, { externalSchemas = {} } = {}) {
  let validator;
  try {
    validator = compileSchema(schema, { externalSchemas });
  } catch (cause) {
    return {
      valid: false,
      errors: [unresolvedReferenceError(cause, schema)],
    };
  }
  const valid = validator(value);
  return {
    valid: Boolean(valid),
    errors: valid ? [] : normalizeValidationErrors(validator.errors),
  };
}

function pointerSegments(pointer) {
  if (!pointer) return [];
  return String(pointer)
    .replace(/^\//, "")
    .split("/")
    .map(decodePointerSegment);
}

function metaCode(error) {
  const segments = pointerSegments(error?.instancePath);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (SCHEMA_KEYWORDS.has(segments[index])) return segments[index];
  }
  return error?.keyword || "schema";
}

function normalizeMetaErrors(errors) {
  return (errors || []).map((error) => ({
    code: metaCode(error),
    schemaPath: String(error?.instancePath || ""),
    message: error?.message || "invalid JSON Schema",
  }));
}

function collectRegexMetaErrors(schema, segments = [], seen = new Set()) {
  const errors = [];
  if (
    schema === true ||
    schema === false ||
    !schema ||
    typeof schema !== "object" ||
    seen.has(schema)
  ) {
    return errors;
  }
  seen.add(schema);

  if (typeof schema.pattern === "string") {
    try {
      new RegExp(schema.pattern);
    } catch (cause) {
      errors.push({
        code: "pattern",
        schemaPath: jsonPointer([...segments, "pattern"]),
        message: `pattern is not a valid regular expression: ${cause.message}`,
      });
    }
  }
  if (
    schema.patternProperties &&
    typeof schema.patternProperties === "object" &&
    !Array.isArray(schema.patternProperties)
  ) {
    for (const pattern of Object.keys(schema.patternProperties)) {
      try {
        new RegExp(pattern);
      } catch (cause) {
        errors.push({
          code: "patternProperties",
          schemaPath: jsonPointer([
            ...segments,
            "patternProperties",
            pattern,
          ]),
          message: `patternProperties key is not a valid regular expression: ${cause.message}`,
        });
      }
    }
  }

  const single = [
    "additionalProperties",
    "contains",
    "contentSchema",
    "else",
    "if",
    "items",
    "not",
    "propertyNames",
    "then",
    "unevaluatedItems",
    "unevaluatedProperties",
  ];
  for (const keyword of single) {
    const child = schema[keyword];
    if (child && typeof child === "object") {
      errors.push(
        ...collectRegexMetaErrors(
          child,
          [...segments, keyword],
          seen,
        ),
      );
    }
  }
  for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    if (!Array.isArray(schema[keyword])) continue;
    schema[keyword].forEach((child, index) => {
      errors.push(
        ...collectRegexMetaErrors(
          child,
          [...segments, keyword, index],
          seen,
        ),
      );
    });
  }
  for (const keyword of [
    "$defs",
    "definitions",
    "dependentSchemas",
    "patternProperties",
    "properties",
  ]) {
    const map = schema[keyword];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [name, child] of Object.entries(map)) {
      errors.push(
        ...collectRegexMetaErrors(
          child,
          [...segments, keyword, name],
          seen,
        ),
      );
    }
  }
  return errors;
}

/**
 * Validate the schema itself against the Draft 2020-12 meta-schema, then
 * compile it to catch invalid regular expressions and unsupported dialects.
 * Missing external documents are left to the bounded reference resolver.
 */
export function validateSchema(schema) {
  const ajv = createAjv();
  let valid;
  try {
    valid = ajv.validateSchema(schema);
  } catch (cause) {
    return {
      valid: false,
      errors: [
        {
          code: "$schema",
          schemaPath: "/$schema",
          message: cause.message,
        },
      ],
    };
  }

  const errors = valid ? [] : normalizeMetaErrors(ajv.errors);
  errors.push(...collectRegexMetaErrors(schema));
  return { valid: errors.length === 0, errors };
}

/**
 * Assert that the fully-resolved schema graph compiles. Used at startup after
 * the bounded local/HTTPS resolver has populated the external registry.
 */
export function assertSchemaCompiles(schema, { externalSchemas = {} } = {}) {
  try {
    compileSchema(schema, { externalSchemas });
  } catch (cause) {
    const detail = unresolvedReferenceError(cause, schema);
    const error = new Error(detail.message, { cause });
    error.code = "JSON_SCHEMA_COMPILE_FAILED";
    error.schemaError = detail;
    throw error;
  }
  return true;
}

/** Build the terminal protocol event for one structured value. */
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
