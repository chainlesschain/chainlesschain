/**
 * Content-addressed idempotency — the P0-2 "Diff Apply 使用内容哈希/版本号" +
 * "外部 API 优先使用 Provider Idempotency Key" primitives.
 *
 * All PURE (deterministic, no clock / RNG / I/O):
 *
 *  - `classifyEditReplay` — decide, from the CURRENT file content alone, whether
 *    a literal edit still applies, has ALREADY landed (a resumed replay), or
 *    genuinely conflicts. Lets a recovered worker skip an edit it already made
 *    instead of double-applying it or erroring confusingly.
 *  - `editIdempotencyKey` / `operationIdempotencyKey` — stable keys derived from
 *    the operation and a canonicalized (order-independent) view of its args, so
 *    a retry of the SAME effect yields the SAME key. An external provider that
 *    honors `Idempotency-Key` then de-dupes a resumed replay; internally the key
 *    tags each side-effect ledger op for duplicate detection.
 */

import { createHash } from "node:crypto";

function sha256Hex(input) {
  return createHash("sha256").update(String(input), "utf8").digest("hex");
}

/**
 * Canonicalize a value so semantically-equal args hash identically regardless of
 * key order. Arrays keep order (order is meaningful); object keys are sorted.
 */
function canonicalize(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(canonicalize);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

/** Fate of an edit checked against the current on-disk content. */
export const EDIT_REPLAY = Object.freeze({
  APPLY: "apply", // old_string present — the edit still applies
  ALREADY_APPLIED: "already_applied", // old gone, new present — idempotent no-op
  CONFLICT: "conflict", // neither present — a genuine mismatch, surface it
});

/**
 * Decide the fate of a literal (old→new) edit against CURRENT content — the
 * content-addressed idempotency check. On a resumed replay the edit already
 * landed, so `old_string` is gone and `new_string` is present → already_applied
 * (skip, never double-apply). PURE.
 *
 * Deletions (`new_string === ""`) are deliberately NOT auto-detected as
 * already-applied: "old absent + nothing to look for" is indistinguishable from
 * "old never existed", so those keep surfacing as a conflict (the safe default).
 *
 * @param {{content:string, oldString:string, newString:string, replaceAll?:boolean}} p
 * @returns {"apply"|"already_applied"|"conflict"}
 */
export function classifyEditReplay({ content, oldString, newString }) {
  const text = String(content ?? "");
  const oldS = String(oldString ?? "");
  const newS = String(newString ?? "");
  if (oldS && text.includes(oldS)) return EDIT_REPLAY.APPLY;
  // old_string is absent. A present, non-empty new_string means the intended
  // change is already in the file — the edit already happened.
  if (newS && text.includes(newS)) return EDIT_REPLAY.ALREADY_APPLIED;
  return EDIT_REPLAY.CONFLICT;
}

/** Stable idempotency key for a literal edit against a target file. */
export function editIdempotencyKey({ path, oldString, newString, replaceAll }) {
  return (
    "edit_" +
    sha256Hex(
      JSON.stringify([
        String(path || ""),
        String(oldString ?? ""),
        String(newString ?? ""),
        replaceAll === true,
      ]),
    ).slice(0, 40)
  );
}

/**
 * Deterministic idempotency key for an external, irreversible operation — stable
 * across retries so a provider honoring `Idempotency-Key` de-dupes a resumed
 * replay, and so the side-effect ledger can spot a duplicated commit. Derived
 * from the tool + a canonicalized view of its args; NO wall-clock / RNG so the
 * SAME logical effect always maps to the SAME key.
 *
 * `scope` is optional namespacing (e.g. a session id); OMIT it when you want a
 * pure retry of the same call to collide with its earlier attempt.
 *
 * @param {{tool:string, args?:object, scope?:string}} p
 * @returns {string}
 */
export function operationIdempotencyKey({ tool, args, scope } = {}) {
  return (
    "op_" +
    sha256Hex(
      JSON.stringify([
        String(tool || ""),
        scope == null ? "" : String(scope),
        canonicalize(args ?? null),
      ]),
    ).slice(0, 40)
  );
}
