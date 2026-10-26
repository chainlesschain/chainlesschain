import {
  createEvidenceJsonTextBoundary,
  EVIDENCE_JSON_POLICY,
} from "./evolution/evidence-json-text.js";
import { boundedToolResultText } from "./tool-result-preview.js";

// Recovery excerpts are host-created summaries, not original tool evidence.
// They may be attached to a JSON tool result or sent as a standalone message.
// Reserve decoding layers for both envelopes and validate both text contexts.
function completeText(text, reservedLayers) {
  return [false, true].every((codeText) => {
    const scan = createEvidenceJsonTextBoundary(
      (message) => new Error(message),
      {
        ...EVIDENCE_JSON_POLICY,
        maxLayers: EVIDENCE_JSON_POLICY.maxLayers - reservedLayers,
      },
    );
    const visit = (value, layer) => {
      if (typeof value === "string") return project(value, layer);
      if (Array.isArray(value))
        return value.map((child) => visit(child, layer));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            key,
            visit(child, layer),
          ]),
        );
      return value;
    };
    const project = (value, layer = 0) =>
      scan(value, {
        layer,
        codeText,
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
  });
}

function omitted(length, limit) {
  const note = `Excerpt omitted (${length} chars); inspect the saved source with a focused read.`;
  return note.length <= limit ? note : "Excerpt omitted".slice(0, limit);
}

/** Never let host truncation turn a structured span into malformed model input. */
export function retainedContextText(value, limit = 1200) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const marker = " … [truncated]";
  let end = Math.max(0, limit - marker.length);
  if (/[\uD800-\uDBFF]/u.test(raw[end - 1] ?? "")) end--;
  const candidate = raw.length <= limit ? raw : raw.slice(0, end) + marker;
  if (candidate.length <= limit && completeText(candidate, 2)) return candidate;
  // Whole JSON can be reduced structurally. A broken/opaque leaf is omitted,
  // never repaired, escaped into an exemption, or admitted as original data.
  const preview = boundedToolResultText(raw, limit);
  if (preview !== raw && completeText(preview, 2)) return preview;
  return omitted(raw.length, limit);
}

/** Project a copy, including old checkpoints; never rewrite canonical history. */
export function serializeRetainedContext(value, limit) {
  const visit = (entry) => {
    if (typeof entry === "string")
      return retainedContextText(entry, Math.max(entry.length, 100));
    if (Array.isArray(entry)) return entry.map(visit);
    if (!entry || typeof entry !== "object") return entry;
    const result = Object.fromEntries(
      Object.entries(entry).map(([key, child]) => [key, visit(child)]),
    );
    if (typeof entry.content === "string" && result.content !== entry.content) {
      result.contentOmitted = true;
      result.contentOmittedChars = entry.content.length;
    }
    return result;
  };
  const serialized = boundedToolResultText(JSON.stringify(visit(value)), limit);
  if (completeText(serialized, 1)) return serialized;
  return boundedToolResultText(
    JSON.stringify({
      omitted: true,
      reason:
        "Recovery excerpt exceeds decoding limits; inspect the saved source.",
    }),
    limit,
  );
}
