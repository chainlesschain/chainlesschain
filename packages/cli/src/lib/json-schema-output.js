/**
 * `cc agent -p --json-schema <file>` — structured output for headless runs.
 *
 * The final answer must be JSON that validates against a (subset) JSON
 * Schema; invalid replies are retried with a corrective prompt (up to
 * MAX_ATTEMPTS total). Implemented entirely AROUND runAgentHeadless using its
 * `deps.writeOut` capture seam — the runner itself is untouched: each attempt
 * runs with output captured, the validated JSON is the only thing printed.
 *
 * Validator subset (enough for tool/script contracts, not full draft-2020):
 * type (object/array/string/number/integer/boolean/null), properties,
 * required, items, enum, const, additionalProperties:false. Zero deps.
 */

import fsDefault from "fs";
import {
  validateSchema,
  buildStructuredResultEvent,
  computeSchemaDigest,
} from "./json-schema-validate.js";

export const MAX_ATTEMPTS = 3;
export const _deps = { fs: fsDefault };

/**
 * Build the terminal `structured_result` stream event for a value against a
 * schema (P2). Delegates to the richer Draft-2020-12-subset validator so the
 * event carries a schema digest + coded/pointered errors — never free text.
 */
export function buildStructuredResult(schema, value) {
  return buildStructuredResultEvent({ schema, value });
}

export { computeSchemaDigest };

/** Validate `value` against the schema subset. Returns error strings ([] = valid). */
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
  const isInline = trimmed.startsWith("{");
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

  const schema = cfg.schema || loadSchemaFile(fs, cfg.schemaFile);
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
      const errors = validateAgainstSchema(parsed.value, schema);
      if (errors.length === 0) {
        writeOut(`${JSON.stringify(parsed.value, null, 2)}\n`);
        return 0;
      }
      lastErrors = errors;
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
