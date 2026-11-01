import {
  createEvidenceJsonTextBoundary,
  AGENT_CODE_TEXT_RESULT_TOOLS,
  EVIDENCE_JSON_POLICY,
} from "./evolution/evidence-json-text.js";
import { createHash } from "node:crypto";

// Keep host identity outside the JSON evidence object. External JSON results
// cannot nominate a digest or borrow an earlier command's output identity.
const HOST_OUTPUT_IDENTITIES = new WeakMap();
export function registerHostToolOutput(result, output) {
  HOST_OUTPUT_IDENTITIES.set(
    result,
    Object.freeze({
      chars: output.length,
      digest: createHash("sha256").update(output).digest("hex"),
      visibleOutput: result.output,
    }),
  );
  return result;
}
export function copyHostToolOutputIdentity(result, source) {
  const identity = HOST_OUTPUT_IDENTITIES.get(source);
  if (identity) HOST_OUTPUT_IDENTITIES.set(result, identity);
  return result;
}
export function hostToolOutputIdentity(result) {
  const identity = HOST_OUTPUT_IDENTITIES.get(result);
  return identity?.visibleOutput === result?.output ? identity : undefined;
}

const PREVIEW_HINT =
  "Tool output truncated. Narrow the request: filter/count locally, select fields, search_files, or read_file with offset/limit. Omitted text is not full-output evidence.";

/** Check only host-created excerpts; original uncut tool text still reaches ingress. */
function completeExcerpt(text, tool) {
  const scan = createEvidenceJsonTextBoundary((message) => new Error(message), {
    ...EVIDENCE_JSON_POLICY,
    sourceLiteralPolicy: "explicit-source-containers-v1",
    maxSourceTokens: 32768,
  });
  const visit = (value, layer) => {
    if (typeof value === "string") return project(value, layer);
    if (Array.isArray(value)) return value.map((child) => visit(child, layer));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, visit(child, layer)]),
      );
    }
    return value;
  };
  const project = (value, layer = 0) =>
    scan(value, {
      layer,
      codeText: AGENT_CODE_TEXT_RESULT_TOOLS.includes(tool),
      sourceText: layer === 0,
      visit,
      plain: (plain) => plain,
      equal: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    });
  try {
    project(text);
    return true;
  } catch {
    return false;
  }
}

function omitted(chars) {
  return `Text omitted (${chars} chars); narrow the request to inspect a complete value.`;
}

const STATUS_KEYS = new Set([
  "success",
  "error",
  "exitCode",
  "status",
  "code",
  "signal",
  "path",
  "range",
  "nextRead",
  "duration",
  "language",
]);

// Native JSON.parse is used only after checking its lossy cases: duplicate
// decoded keys and non-finite/unsafe numbers must never turn into a safe-looking
// preview. This pass does not repair syntax or decode text leaves.
function parsePreviewJson(text) {
  const value = JSON.parse(text);
  const stack = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      while (++index < text.length) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      const object = stack.at(-1);
      if (object?.key) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (object.keys.has(key)) throw new TypeError("Ambiguous JSON keys");
        object.keys.add(key);
        object.key = false;
      }
    } else if (char === "{") stack.push({ keys: new Set(), key: true });
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)) stack.at(-1).key = true;
    else if (/[\d-]/u.test(char)) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
        text.slice(index),
      )[0];
      const number = Number(token);
      if (
        !Number.isFinite(number) ||
        (Number.isInteger(number) && !Number.isSafeInteger(number))
      )
        throw new TypeError("Unsafe JSON number");
      index += token.length - 1;
    }
  }
  return value;
}

/** Produce complete JSON values, never prefixes of a JSON leaf. */
export function boundedToolResultText(text, max) {
  if (text.length <= max) return text;
  let original;
  try {
    original = parsePreviewJson(text);
  } catch {
    // Plain output can retain a prefix only when it cannot contain a sliced
    // structured span. In particular, do not hide broken JSON in a preview.
    if (!/[{}\[\]"']/u.test(text)) {
      const marker = `\nTool output truncated (${text.length} chars). Narrow the request.`;
      if (marker.length < max) {
        let end = max - marker.length;
        if (/[\uD800-\uDBFF]/u.test(text[end - 1] ?? "")) end--;
        return text.slice(0, end) + marker;
      }
    }
    original = omitted(text.length);
  }

  for (const limit of [8192, 2048, 512, 128, 0]) {
    let nodes = 0;
    const preview = (value, depth = 0) => {
      if (++nodes > 128 || depth > 6)
        return "Value omitted; select a smaller subtree.";
      if (typeof value === "string")
        return JSON.stringify(value).length > limit
          ? omitted(value.length)
          : value;
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) {
        const kept = [];
        for (const child of value) {
          if (kept.length >= 32 || nodes >= 128) break;
          kept.push(preview(child, depth + 1));
        }
        if (kept.length < value.length)
          kept.push(
            `Items omitted (${value.length - kept.length}); narrow the request.`,
          );
        return kept;
      }
      const kept = Object.create(null);
      const entries = Object.entries(value).sort(
        ([a], [b]) => Number(STATUS_KEYS.has(b)) - Number(STATUS_KEYS.has(a)),
      );
      let count = 0;
      for (const [key, child] of entries) {
        if (count >= 32 || nodes >= 128) break;
        if (key.length > 256) continue;
        Object.defineProperty(kept, key, {
          enumerable: true,
          value: preview(child, depth + 1),
        });
        count++;
      }
      if (count < entries.length) {
        let marker = "_omittedFields";
        while (Object.hasOwn(kept, marker)) marker += "_";
        Object.defineProperty(kept, marker, {
          enumerable: true,
          value: entries.length - count,
        });
      }
      return kept;
    };
    const value = preview(original);
    const result =
      value && !Array.isArray(value) && typeof value === "object"
        ? value
        : { preview: value };
    let marker = "_toolOutputPreview";
    while (Object.hasOwn(result, marker)) marker += "_";
    Object.defineProperty(result, marker, {
      enumerable: true,
      value: {
        truncated: true,
        originalChars: text.length,
        hint: PREVIEW_HINT,
      },
    });
    const serialized = JSON.stringify(result);
    if (serialized.length <= max) return serialized;
  }
  const summary = JSON.stringify({
    truncated: true,
    originalChars: text.length,
    hint: PREVIEW_HINT,
  });
  if (summary.length <= max) return summary;
  if (max >= 18) return '{"truncated":true}';
  return max >= 4 ? "null" : max >= 2 ? "{}" : "0";
}

/** Keep cursors/status, but remove JSON fragments created by host paging. */
export function safeHostToolResultForModel(tool, result) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return result;
  const fields = [];
  if (
    tool === "read_file" &&
    (result.truncated || result.range || result.nextRead)
  )
    fields.push("content");
  if (tool === "run_code" && result.truncated) fields.push("output");
  if (tool === "check_shell") fields.push("stdout", "stderr");
  if (tool === "run_shell" || tool === "git") {
    for (const field of ["stdout", "stderr"])
      if (result[`${field}_truncated`])
        fields.push(field, `${field}_diagnostics`);
  }
  let safe = result;
  for (const field of fields) {
    const text = result[field];
    if (typeof text !== "string" || completeExcerpt(text, tool)) continue;
    if (safe === result) safe = { ...result };
    safe[field] =
      tool === "read_file"
        ? `Text omitted (${text.length} chars); this excerpt could not be safely projected. Read a complete surrounding statement or container; expand the range or read the full file within existing size limits when necessary. Omitted content has not been inspected.`
        : omitted(text.length);
    safe[`${field}Omitted`] = true;
    safe[`${field}OmittedChars`] = text.length;
  }
  return safe;
}

/** Prefer a whole JSON tree over slicing stdout through an embedded value. */
export function boundedCommandOutput(output, max, tool = "run_code") {
  const encoded = JSON.stringify(output);
  if (encoded.length <= max) return output;
  // If stdout itself is JSON, preview that tree rather than its quoted form.
  let json = false;
  try {
    parsePreviewJson(output);
    json = true;
  } catch {
    /* Plain command text. */
  }
  if (json) {
    const preview = boundedToolResultText(
      output,
      Math.max(1, Math.floor(max / 2)),
    );
    if (JSON.stringify(preview).length <= max && completeExcerpt(preview, tool))
      return preview;
  } else if (!/[{}\[\]"']/u.test(output)) {
    let low = 0;
    let high = Math.min(output.length, max);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (JSON.stringify(output.slice(0, middle)).length <= max) low = middle;
      else high = middle - 1;
    }
    if (/[\uD800-\uDBFF]/u.test(output[low - 1] ?? "")) low--;
    return output.slice(0, low);
  }
  return omitted(output.length);
}
