/**
 * `cc agent -p --json-schema <file>` — structured output for headless runs.
 *
 * The final answer must be JSON that validates against a Draft 2020-12 JSON
 * Schema; invalid replies are retried with a corrective prompt (up to
 * MAX_ATTEMPTS total). Implemented around runAgentHeadless using its
 * `deps.writeOut` capture seam: each attempt runs with output captured, and
 * the validated JSON is the only thing printed.
 *
 * Constrained validation delegates to the standards-backed Draft 2020-12
 * adapter in [[json-schema-validate.js]], so retries get precise coded/pointered
 * errors. External references are resolved before the turn starts through a
 * bounded local/HTTPS loader. The legacy `validateAgainstSchema` helper stays
 * exported for compatibility with callers that consume its `$.a.b` strings.
 */

import fsDefault from "fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertSchemaCompiles,
  attachExternalSchemas,
  validate,
  validateSchema,
  buildStructuredResultEvent,
  computeSchemaDigest,
} from "./json-schema-validate.js";
import { checkAllowed, webFetch } from "./web-fetch.js";

export const MAX_ATTEMPTS = 3;
const DEFAULT_MAX_EXTERNAL_DOCUMENTS = 32;
const DEFAULT_MAX_EXTERNAL_DOCUMENT_BYTES = 1_000_000;
const DEFAULT_MAX_EXTERNAL_TOTAL_BYTES = 4_000_000;
const DEFAULT_EXTERNAL_TIMEOUT_MS = 10_000;

export const _deps = { fs: fsDefault, webFetch };

/**
 * Build the terminal `structured_result` stream event for a value against a
 * schema (P2). Delegates to the richer Draft-2020-12-subset validator so the
 * event carries a schema digest + coded/pointered errors — never free text.
 */
export function buildStructuredResult(schema, value) {
  return buildStructuredResultEvent({ schema, value });
}

export { computeSchemaDigest };

/** Legacy subset validator. Returns error strings ([] = valid). */
export function validateAgainstSchema(value, schema, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;

  const typeOf = (v) =>
    v === null
      ? "null"
      : Array.isArray(v)
        ? "array"
        : typeof v === "number" && Number.isInteger(v)
          ? "integer"
          : typeof v;

  if (schema.type) {
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    const got = typeOf(value);
    const ok = want.some(
      (t) => t === got || (t === "number" && got === "integer"),
    );
    if (!ok) {
      errors.push(`${path}: expected type ${want.join("|")}, got ${got}`);
      return errors; // type mismatch — deeper checks are noise
    }
  }
  if (
    schema.enum &&
    !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))
  ) {
    errors.push(
      `${path}: value not in enum [${schema.enum.map((e) => JSON.stringify(e)).join(", ")}]`,
    );
  }
  if (
    schema.const !== undefined &&
    JSON.stringify(schema.const) !== JSON.stringify(value)
  ) {
    errors.push(`${path}: must equal const ${JSON.stringify(schema.const)}`);
  }
  if (typeOf(value) === "object" && !Array.isArray(value)) {
    for (const req of schema.required || []) {
      if (!(req in value))
        errors.push(`${path}: missing required property "${req}"`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) {
        errors.push(...validateAgainstSchema(v, props[k], `${path}.${k}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${k}"`);
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(
        ...validateAgainstSchema(item, schema.items, `${path}[${i}]`),
      );
    });
  }
  return errors;
}

/**
 * Render the richer validator's coded/pointered error objects as human-readable
 * `<JSON Pointer>: <message>` strings for the corrective retry prompt and the
 * final failure report. The empty root pointer is shown as `(root)`.
 *
 * @param {Array<{instancePath?:string, message:string}>} errors
 * @returns {string[]}
 */
export function formatSchemaErrors(errors) {
  return (errors || []).map(
    (e) => `${e.instancePath || "(root)"}: ${e.message}`,
  );
}

/**
 * Return the first *balanced* JSON object/array substring in `text`, honoring
 * string literals so braces inside strings don't throw off the depth count.
 *
 * Unlike a greedy `/\{[\s\S]*\}/` match (which spans to the LAST bracket and
 * over-captures trailing prose or a second object — making JSON.parse throw),
 * this stops at the first complete top-level value.
 *
 * @param {string} text
 * @param {"{"|"["} [only] restrict to object- or array-openers when set
 * @returns {string|null} the balanced substring, or null if none is found
 */
export function firstBalancedJson(text, only) {
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== "{" && open !== "[") continue;
    if (only && open !== only) continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return s.slice(i, j + 1);
      }
    }
    // opener at i never closed — try the next opener
  }
  return null;
}

/** Pull a JSON payload out of an LLM reply (bare, fenced, or embedded). */
export function extractJsonPayload(text) {
  const raw = String(text || "").trim();
  const tries = [];
  tries.push(raw);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence) tries.push(fence[1].trim());
  // Prefer a balanced run (stops at the first complete value) over the greedy
  // first-bracket..last-bracket slice below, which over-captures on trailing
  // prose or a second object.
  const balanced = firstBalancedJson(raw);
  if (balanced) tries.push(balanced);
  const firstObj = raw.indexOf("{");
  const lastObj = raw.lastIndexOf("}");
  if (firstObj !== -1 && lastObj > firstObj)
    tries.push(raw.slice(firstObj, lastObj + 1));
  const firstArr = raw.indexOf("[");
  const lastArr = raw.lastIndexOf("]");
  if (firstArr !== -1 && lastArr > firstArr)
    tries.push(raw.slice(firstArr, lastArr + 1));
  for (const candidate of tries) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      /* next candidate */
    }
  }
  return { ok: false, error: "reply contains no parseable JSON" };
}

export function buildSchemaInstruction(schema) {
  return [
    "OUTPUT CONTRACT: your FINAL reply must be ONLY a JSON value (no prose, no markdown fences) that validates against this JSON Schema:",
    JSON.stringify(schema),
  ].join("\n");
}

export function buildRetryPrompt(originalPrompt, raw, errors) {
  return [
    originalPrompt,
    "",
    "Your previous reply failed JSON Schema validation:",
    ...errors.slice(0, 10).map((e) => `- ${e}`),
    "",
    `Previous reply (for reference): ${String(raw).slice(0, 2000)}`,
    "",
    "Reply again with ONLY the corrected JSON.",
  ].join("\n");
}

/**
 * Load + parse a --json-schema file, raising errors that name the file and
 * the underlying cause instead of a bare `ENOENT …` or `Unexpected token …`
 * stack (which is all the user would otherwise see).
 *
 * @param {{ readFileSync: Function }} fs
 * @param {string} schemaFile
 */
export function loadSchemaFile(fs, schemaFile) {
  if (!schemaFile) {
    throw new Error(
      "No schema provided: pass --json-schema <file> or a schema object",
    );
  }
  // Inline JSON support: a value that starts with `{` is treated as a literal
  // schema object, never a path (a filesystem path can't start with `{`). This
  // lets `--json-schema '{"type":"object",...}'` work without a temp file.
  const trimmed = String(schemaFile).trim();
  const isInline =
    trimmed.startsWith("{") || trimmed === "true" || trimmed === "false";
  let raw;
  if (isInline) {
    raw = trimmed;
  } else {
    try {
      raw = fs.readFileSync(schemaFile, "utf-8");
    } catch (e) {
      throw new Error(`Cannot read schema file "${schemaFile}": ${e.message}`);
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      isInline
        ? `Invalid inline JSON schema: ${e.message}`
        : `Invalid JSON in schema file "${schemaFile}": ${e.message}`,
    );
  }
  // Startup schema meta-validation (P2): reject a malformed schema up front
  // (bad type value, non-array required, invalid regex, …) instead of silently
  // mis-validating every reply against a broken contract.
  const meta = validateSchema(parsed);
  if (!meta.valid) {
    const detail = meta.errors
      .slice(0, 5)
      .map((e) => `  - ${e.schemaPath || "/"}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Invalid JSON Schema in ${isInline ? "inline schema" : `"${schemaFile}"`}:\n${detail}`,
    );
  }
  return parsed;
}

const SINGLE_SUBSCHEMA_KEYWORDS = [
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

const ARRAY_SUBSCHEMA_KEYWORDS = [
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
];

const MAP_SUBSCHEMA_KEYWORDS = [
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
];

function withoutFragment(uri) {
  const parsed = new URL(uri);
  parsed.hash = "";
  return parsed.href;
}

function resolveSchemaUri(reference, baseUri) {
  try {
    return new URL(reference, baseUri || undefined).href;
  } catch (cause) {
    const error = new Error(
      `Cannot resolve external JSON Schema reference "${reference}"${
        baseUri ? ` from "${baseUri}"` : " without a base URI"
      }`,
      { cause },
    );
    error.code = "JSON_SCHEMA_REF_INVALID";
    throw error;
  }
}

function scanSchemaDocument(
  schema,
  retrievalUri,
  { references, resources },
) {
  const seen = new Set();

  function visit(node, inheritedBase) {
    if (
      node === true ||
      node === false ||
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      seen.has(node)
    ) {
      return;
    }
    seen.add(node);

    let baseUri = inheritedBase;
    if (typeof node.$id === "string") {
      baseUri = resolveSchemaUri(node.$id, inheritedBase);
      resources.add(withoutFragment(baseUri));
    }

    for (const keyword of ["$ref", "$dynamicRef"]) {
      const reference = node[keyword];
      if (typeof reference !== "string" || reference.startsWith("#")) {
        continue;
      }
      const uri = withoutFragment(resolveSchemaUri(reference, baseUri));
      const origins = references.get(uri) || new Set();
      origins.add(new URL(retrievalUri).protocol);
      references.set(uri, origins);
    }

    for (const keyword of SINGLE_SUBSCHEMA_KEYWORDS) {
      visit(node[keyword], baseUri);
    }
    for (const keyword of ARRAY_SUBSCHEMA_KEYWORDS) {
      if (!Array.isArray(node[keyword])) continue;
      for (const child of node[keyword]) visit(child, baseUri);
    }
    for (const keyword of MAP_SUBSCHEMA_KEYWORDS) {
      const map = node[keyword];
      if (!map || typeof map !== "object" || Array.isArray(map)) continue;
      for (const child of Object.values(map)) visit(child, baseUri);
    }
  }

  resources.add(withoutFragment(retrievalUri));
  visit(schema, retrievalUri);
}

function parseExternalSchema(raw, uri) {
  if (
    raw === true ||
    raw === false ||
    (raw && typeof raw === "object" && !Array.isArray(raw))
  ) {
    return raw;
  }
  if (typeof raw !== "string") {
    throw new Error(
      `External JSON Schema "${uri}" must be an object or boolean`,
    );
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed === true ||
      parsed === false ||
      (parsed && typeof parsed === "object" && !Array.isArray(parsed))
    ) {
      return parsed;
    }
    throw new TypeError("top-level value must be an object or boolean");
  } catch (cause) {
    throw new Error(`Invalid external JSON Schema "${uri}": ${cause.message}`, {
      cause,
    });
  }
}

function assertExternalSchemaIsValid(schema, uri) {
  const meta = validateSchema(schema);
  if (meta.valid) return;
  const detail = meta.errors
    .slice(0, 5)
    .map((error) => `${error.schemaPath || "/"}: ${error.message}`)
    .join("; ");
  throw new Error(`Invalid external JSON Schema "${uri}": ${detail}`);
}

function localSchemaPath(uri, rootDirectory, fs) {
  const candidate = path.resolve(fileURLToPath(uri));
  const checkedRoot =
    typeof fs.realpathSync === "function"
      ? fs.realpathSync(rootDirectory)
      : rootDirectory;
  const checkedCandidate =
    typeof fs.realpathSync === "function"
      ? fs.realpathSync(candidate)
      : candidate;
  const relative = path.relative(checkedRoot, checkedCandidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    const error = new Error(
      `Local JSON Schema reference escapes the root schema directory: ${candidate}`,
    );
    error.code = "JSON_SCHEMA_REF_PATH_ESCAPE";
    throw error;
  }
  return candidate;
}

async function fetchExternalSchema(
  uri,
  {
    allowedDomains,
    allowFileReference,
    fetchSchema,
    fs,
    maxDocumentBytes,
    rootDirectory,
    timeoutMs,
  },
) {
  const parsed = new URL(uri);
  if (parsed.protocol === "file:") {
    if (!rootDirectory || !allowFileReference) {
      throw new Error(
        `A file JSON Schema reference is only allowed from a local root graph: ${uri}`,
      );
    }
    const filename = localSchemaPath(uri, rootDirectory, fs);
    const raw = fs.readFileSync(filename, "utf8");
    const bytes = Buffer.byteLength(String(raw), "utf8");
    if (bytes > maxDocumentBytes) {
      throw new Error(
        `External JSON Schema "${uri}" exceeds ${maxDocumentBytes} bytes`,
      );
    }
    return {
      schema: parseExternalSchema(raw, uri),
      bytes,
      retrievalUri: uri,
    };
  }

  if (parsed.protocol !== "https:") {
    const error = new Error(
      `External JSON Schema references must use HTTPS: ${uri}`,
    );
    error.code = "JSON_SCHEMA_REF_PROTOCOL_BLOCKED";
    throw error;
  }
  if (parsed.username || parsed.password) {
    const error = new Error(
      `External JSON Schema references cannot contain credentials: ${uri}`,
    );
    error.code = "JSON_SCHEMA_REF_CREDENTIALS_BLOCKED";
    throw error;
  }

  const policy = checkAllowed(uri, {
    allowedDomains,
    allowPrivateHosts: false,
  });
  if (!policy.allowed) {
    const error = new Error(
      `External JSON Schema reference blocked: ${policy.reason}`,
    );
    error.code = "JSON_SCHEMA_REF_BLOCKED";
    throw error;
  }

  const response = await fetchSchema(uri, {
    format: "json",
    maxBytes: maxDocumentBytes,
    timeout: timeoutMs,
    config: {
      allowedDomains,
      allowPrivateHosts: false,
    },
    headers: {
      Accept: "application/schema+json, application/json",
    },
  });
  const responseEnvelope =
    response &&
    typeof response === "object" &&
    (Object.prototype.hasOwnProperty.call(response, "statusCode") ||
      Object.prototype.hasOwnProperty.call(response, "bytes") ||
      Object.prototype.hasOwnProperty.call(response, "contentType") ||
      Object.prototype.hasOwnProperty.call(response, "format") ||
      Object.prototype.hasOwnProperty.call(response, "url") ||
      (Object.prototype.hasOwnProperty.call(response, "error") &&
        Object.keys(response).length <= 2));
  if (responseEnvelope && response?.error) {
    throw new Error(
      `Could not load external JSON Schema "${uri}": ${response.error}`,
    );
  }
  if (
    Number.isFinite(response?.statusCode) &&
    (response.statusCode < 200 || response.statusCode >= 300)
  ) {
    throw new Error(
      `Could not load external JSON Schema "${uri}": HTTP ${response.statusCode}`,
    );
  }

  const raw =
    responseEnvelope &&
    Object.prototype.hasOwnProperty.call(response, "content")
      ? response.content
      : response;
  const schema = parseExternalSchema(raw, uri);
  const bytes =
    Number.isFinite(response?.bytes) && response.bytes >= 0
    ? response.bytes
    : Buffer.byteLength(JSON.stringify(schema), "utf8");
  if (bytes > maxDocumentBytes) {
    throw new Error(
      `External JSON Schema "${uri}" exceeds ${maxDocumentBytes} bytes`,
    );
  }
  let retrievalUri = uri;
  if (responseEnvelope && response?.url) {
    retrievalUri = withoutFragment(
      resolveSchemaUri(String(response.url), uri),
    );
    const redirected = new URL(retrievalUri);
    const redirectPolicy = checkAllowed(retrievalUri, {
      allowedDomains,
      allowPrivateHosts: false,
    });
    if (
      redirected.protocol !== "https:" ||
      redirected.username ||
      redirected.password ||
      !redirectPolicy.allowed
    ) {
      throw new Error(
        `External JSON Schema redirect is blocked: ${retrievalUri}`,
      );
    }
  }
  return { schema, bytes, retrievalUri };
}

/**
 * Load a root schema and resolve every external `$ref`/`$dynamicRef` before a
 * turn starts. Local references are confined to the root schema directory.
 * Remote references are HTTPS-only and use the shared DNS-rebinding/SSRF-safe
 * fetch path with bounded document count, bytes, redirects and timeout.
 */
export async function loadSchemaFileWithRefs(
  fs,
  schemaFile,
  options = {},
) {
  const schema = loadSchemaFile(fs, schemaFile);
  if (!schema || typeof schema !== "object") return schema;

  const trimmed = String(schemaFile).trim();
  const inline =
    trimmed.startsWith("{") || trimmed === "true" || trimmed === "false";
  const rootPath = inline ? null : path.resolve(schemaFile);
  const retrievalUri = rootPath
    ? pathToFileURL(rootPath).href
    : typeof schema.$id === "string"
      ? resolveSchemaUri(schema.$id, null)
      : "urn:chainlesschain:inline-schema";
  const rootDirectory = rootPath ? path.dirname(rootPath) : null;
  const allowedDomains = Array.isArray(options.allowedDomains)
    ? options.allowedDomains
    : ["*"];
  const maxDocuments =
    options.maxDocuments ?? DEFAULT_MAX_EXTERNAL_DOCUMENTS;
  const maxDocumentBytes =
    options.maxDocumentBytes ?? DEFAULT_MAX_EXTERNAL_DOCUMENT_BYTES;
  const maxTotalBytes =
    options.maxTotalBytes ?? DEFAULT_MAX_EXTERNAL_TOTAL_BYTES;
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS;
  const fetchSchema =
    options.fetchSchema || _deps.webFetch;

  const references = new Map();
  const resources = new Set();
  const fetched = new Set();
  const registry = {};
  let totalBytes = 0;

  scanSchemaDocument(schema, retrievalUri, { references, resources });

  while (true) {
    const uri = [...references.keys()].find(
      (candidate) =>
        !resources.has(candidate) && !fetched.has(candidate),
    );
    if (!uri) break;
    if (fetched.size >= maxDocuments) {
      throw new Error(
        `External JSON Schema graph exceeds ${maxDocuments} documents`,
      );
    }
    fetched.add(uri);

    const loaded = await fetchExternalSchema(uri, {
      allowedDomains,
      allowFileReference: [...(references.get(uri) || [])].every(
        (protocol) => protocol === "file:",
      ),
      fetchSchema,
      fs,
      maxDocumentBytes,
      rootDirectory,
      timeoutMs,
    });
    totalBytes += loaded.bytes;
    if (totalBytes > maxTotalBytes) {
      throw new Error(
        `External JSON Schema graph exceeds ${maxTotalBytes} bytes`,
      );
    }
    assertExternalSchemaIsValid(loaded.schema, uri);
    const redirected =
      loaded.retrievalUri && loaded.retrievalUri !== uri;
    if (redirected) {
      registry[loaded.retrievalUri] = loaded.schema;
      registry[uri] = { $ref: loaded.retrievalUri };
      resources.add(uri);
      scanSchemaDocument(loaded.schema, loaded.retrievalUri, {
        references,
        resources,
      });
    } else {
      registry[uri] = loaded.schema;
      scanSchemaDocument(loaded.schema, loaded.retrievalUri || uri, {
        references,
        resources,
      });
    }
  }

  attachExternalSchemas(schema, registry, { baseUri: retrievalUri });
  assertSchemaCompiles(schema);
  return schema;
}

/**
 * Run a headless turn constrained to a schema, retrying on validation
 * failure. Prints the validated JSON to writeOut; returns the exit code.
 *
 * @param {object} cfg { schemaFile|schema, baseOptions, runHeadless,
 *                       maxAttempts?, writeOut?, writeErr?, deps? }
 */
export async function runJsonSchemaConstrained(cfg = {}) {
  const fs = cfg.deps?.fs || _deps.fs;
  const writeOut = cfg.writeOut || ((s) => process.stdout.write(s));
  const writeErr = cfg.writeErr || ((s) => process.stderr.write(s));
  const maxAttempts = cfg.maxAttempts || MAX_ATTEMPTS;

  const schema =
    cfg.schema ||
    (await loadSchemaFileWithRefs(fs, cfg.schemaFile, {
      ...(cfg.schemaLoadOptions || {}),
      fetchSchema:
        cfg.schemaLoadOptions?.fetchSchema ||
        cfg.deps?.webFetch ||
        _deps.webFetch,
    }));
  const instruction = buildSchemaInstruction(schema);
  const base = cfg.baseOptions || {};

  let prompt = base.prompt;
  let lastRaw = "";
  let lastErrors = ["no attempts ran"];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let captured = "";
    const outcome = await cfg.runHeadless(
      {
        ...base,
        prompt,
        outputFormat: "text",
        appendSystemPrompt: [base.appendSystemPrompt, instruction]
          .filter(Boolean)
          .join("\n\n"),
      },
      {
        writeOut: (s) => {
          captured += s;
        },
        writeErr,
      },
    );
    const raw =
      String(outcome?.result ?? captured ?? "").trim() || captured.trim();
    lastRaw = raw;
    const parsed = extractJsonPayload(raw);
    if (parsed.ok) {
      // Richer validator: enforces the full supported subset (format assertions,
      // if/then/else, min/max, pattern, combinators, …) and yields coded/pointered
      // errors so the retry prompt tells the model exactly which pointer failed.
      const { valid, errors } = validate(parsed.value, schema);
      if (valid) {
        writeOut(`${JSON.stringify(parsed.value, null, 2)}\n`);
        return 0;
      }
      lastErrors = formatSchemaErrors(errors);
    } else {
      lastErrors = [parsed.error];
    }
    if (attempt < maxAttempts) {
      writeErr(
        `--json-schema: attempt ${attempt} failed validation (${lastErrors.length} error(s)) — retrying…\n`,
      );
      prompt = buildRetryPrompt(base.prompt, raw, lastErrors);
    }
  }

  writeErr(
    `--json-schema: reply failed validation after ${maxAttempts} attempts:\n${lastErrors
      .map((e) => `  - ${e}`)
      .join("\n")}\nLast reply:\n${lastRaw.slice(0, 1000)}\n`,
  );
  return 1;
}
