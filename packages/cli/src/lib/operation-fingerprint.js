/**
 * Operation fingerprint — binds an approval to the specific operation it
 * authorizes (IDE gap P0#2 "每个副作用关联唯一 approvalId；approvalId 绑定操作
 * 指纹（工具名+参数哈希）").
 *
 * A remote permission ask is matched to its resolve by a random `requestId`.
 * That alone answers "which ask" but not "which OPERATION" — a stale approval
 * card, a replayed resolve, or a request body swapped in flight could settle a
 * gate for an operation the human never actually saw. A fingerprint over the
 * operation's identity (tool + canonicalized arguments) lets the host verify
 * that the decision coming back approves the SAME operation it published, and
 * reject a mismatch (confused-deputy defense) while still failing closed.
 *
 * Pure + deterministic (no clock / RNG): the same operation always yields the
 * same fingerprint, so both ends compute it independently and compare.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Recursively canonical JSON: object keys sorted so argument ORDER never
 * changes the fingerprint ({a:1,b:2} === {b:2,a:1}); arrays keep their order
 * (order is semantic for a list). Cycles are impossible here (inputs are the
 * plain ask payload), but a depth guard keeps it total.
 */
function canonicalize(value, depth = 0) {
  if (value === null || value === undefined) return "null";
  if (depth > 32) return '"[maxdepth]"';
  const t = typeof value;
  if (t === "number")
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (t !== "object") return JSON.stringify(String(value)); // bigint/function/symbol → string
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v, depth + 1)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k], depth + 1)}`).join(",")}}`;
}

/**
 * Stable 32-hex fingerprint of an operation. `args` (structured) is preferred;
 * a `detail` string (e.g. a shell command) is the fallback identity. tool +
 * action + the argument payload together identify the side effect.
 *
 * @param {object} op
 * @param {string} [op.tool]    the tool / capability name
 * @param {string} [op.action]  a sub-action within the tool
 * @param {*}      [op.args]    structured arguments (preferred)
 * @param {string} [op.detail]  a human/string form used when args is absent
 * @returns {string} 32-char lowercase hex
 */
export function operationFingerprint(op = {}) {
  const canonical = canonicalize({
    tool: op.tool ?? null,
    action: op.action ?? null,
    args: op.args !== undefined ? op.args : (op.detail ?? null),
  });
  return createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Constant-time equality of two fingerprints. Both must be non-empty strings
 * of equal length; anything else (null / mismatched length / non-string) →
 * false. Constant-time so a mismatch position is not observable.
 */
export function fingerprintsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Verdict for a resolve carrying (or omitting) a fingerprint against the
 * pending ask's fingerprint. Backward compatible: a resolve with NO fingerprint
 * is accepted (old devices predate the field) — absence is tolerated, presence
 * is verified. A PRESENT-but-mismatched fingerprint is rejected.
 *
 * @param {string|null|undefined} pending  the pending ask's fingerprint
 * @param {string|null|undefined} resolved the fingerprint the resolve carries
 * @returns {boolean} true = settle the gate; false = reject (keep fail-closed)
 */
export function approvalFingerprintOk(pending, resolved) {
  if (resolved === null || resolved === undefined || resolved === "")
    return true;
  if (!pending) return true; // nothing to bind against (legacy pending ask)
  return fingerprintsMatch(pending, resolved);
}
