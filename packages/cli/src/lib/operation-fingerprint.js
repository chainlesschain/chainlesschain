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

// ── §8.2 cross-device operation fingerprint ──────────────────────────────────
//
// The fingerprint above binds tool + params only. IDE gap §8.2 requires a
// CROSS-DEVICE identity that also covers target environment, workspace, session,
// policy VERSION and a validity window, plus a fail-closed resolver: offline
// replay, multi-card concurrency, timeout and duplicate submission must all be
// rejected. The functions below add that richer tuple WITHOUT changing the
// legacy fingerprint (existing devices/tests keep working).
//
// Two layers of identity:
//   - the LOGICAL key  = tool + params + env + workspace + session + policyVersion
//     (what the human is approving). Any change here invalidates an old approval.
//   - the FINGERPRINT  = the logical key PLUS the validity window, so a card
//     re-issued with a fresh window is a distinct fingerprint (an old card can
//     never be replayed) while still mapping to the same logical operation.

/**
 * The logical-operation key preimage: everything the human is authorizing,
 * EXCLUDING the validity window. Two asks with this equal are the same
 * operation (so re-issuing one supersedes the other). Deterministic.
 * @param {object} desc
 */
export function operationDescriptorKey(desc = {}) {
  return canonicalize({
    tool: desc.toolName ?? desc.tool ?? null,
    params: desc.params !== undefined ? desc.params : (desc.detail ?? null),
    targetEnv: desc.targetEnv ?? null,
    workspace: desc.workspace ?? null,
    session: desc.session ?? null,
    policyVersion: desc.policyVersion ?? null,
  });
}

function intOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The full §8.2 cross-device fingerprint: the logical key plus the validity
 * window `[notBefore, notAfter]`. Prefixed `opf_` (40 hex) so it is never
 * confused with the 32-hex legacy fingerprint in a log or on the wire.
 *
 * @param {object} desc
 * @param {string} [desc.toolName]
 * @param {*}      [desc.params]
 * @param {string} [desc.targetEnv]     e.g. local / wsl / ssh:host / container
 * @param {string} [desc.workspace]
 * @param {string} [desc.session]
 * @param {string} [desc.policyVersion] a REAL policy version, not a rule label
 * @param {number} [desc.notBefore]     ms epoch the approval becomes valid
 * @param {number} [desc.notAfter]      ms epoch the approval expires
 * @returns {string} `opf_` + 40 lowercase hex
 */
export function computeOperationFingerprint(desc = {}) {
  const preimage =
    "cc-operation-fingerprint-v2\n" +
    operationDescriptorKey(desc) +
    "\n" +
    canonicalize({
      notBefore: intOrNull(desc.notBefore),
      notAfter: intOrNull(desc.notAfter),
    });
  return (
    "opf_" +
    createHash("sha256").update(preimage, "utf8").digest("hex").slice(0, 40)
  );
}

/**
 * A short, human-verifiable id for the approval card — the operator eyeballs it
 * on the device against the terminal to confirm they answer the SAME card. Two
 * groups of 4 uppercase hex from the fingerprint (never the secret params).
 * @param {string} fingerprint
 * @returns {string} e.g. "A1B2-C3D4"
 */
export function shortOperationId(fingerprint) {
  const hex = String(fingerprint || "").replace(/^opf_/, "");
  const s = (hex.slice(0, 8) || "00000000").toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

/**
 * A readable, SECRET-FREE one-line summary for the approval card. It NEVER
 * echoes param VALUES (a shell command / token could be secret) — only the
 * tool, the param key names (or an opaque marker), and the target coordinates.
 * @param {object} desc
 * @returns {string}
 */
export function summarizeOperation(desc = {}) {
  const tool = String(desc.toolName ?? desc.tool ?? "operation");
  let paramHint = "";
  const p = desc.params;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const keys = Object.keys(p).sort();
    paramHint = keys.length ? `(${keys.join(", ")})` : "()";
  } else if (p !== undefined && p !== null && p !== "") {
    paramHint = "(…)"; // opaque scalar/string/array — do not reveal the value
  }
  const coords = [];
  if (desc.workspace) coords.push(`ws:${desc.workspace}`);
  if (desc.targetEnv) coords.push(`env:${desc.targetEnv}`);
  if (desc.session) coords.push(`sess:${desc.session}`);
  if (desc.policyVersion) coords.push(`pol:${desc.policyVersion}`);
  return `${tool}${paramHint}${coords.length ? " · " + coords.join(" · ") : ""}`;
}

/**
 * Fail-closed verdict for resolving one pending approval. Every rejection is
 * named so the audit log records WHY. Ordering matters: a missing input or a
 * superseded/duplicate card is rejected before the fingerprint compare so a
 * stale card can never settle a gate.
 *
 * @param {object} pending      {fingerprint, notBefore?, notAfter?, resolved?, supersededBy?}
 * @param {object} resolution   {fingerprint}
 * @param {object} [opts]
 * @param {number} [opts.now]   ms epoch (injected clock; required for window checks)
 * @returns {{ok:boolean, reason:(string|null)}}
 */
export function resolveOperationApproval(pending, resolution, opts = {}) {
  if (!pending || typeof pending !== "object")
    return { ok: false, reason: "no-pending" };
  if (!resolution || typeof resolution !== "object")
    return { ok: false, reason: "no-resolution" };
  if (pending.resolved) return { ok: false, reason: "duplicate" };
  if (pending.supersededBy != null) return { ok: false, reason: "superseded" };

  if (!fingerprintsMatch(pending.fingerprint, resolution.fingerprint)) {
    return { ok: false, reason: "fingerprint-mismatch" };
  }

  const now = intOrNull(opts.now);
  const nb = intOrNull(pending.notBefore);
  const na = intOrNull(pending.notAfter);
  if (nb != null || na != null) {
    if (now == null) return { ok: false, reason: "no-clock" }; // can't prove validity → closed
    if (nb != null && now < nb) return { ok: false, reason: "not-yet-valid" };
    if (na != null && now > na) return { ok: false, reason: "expired" };
  }
  return { ok: true, reason: null };
}

/**
 * In-memory registry that enforces the §8.2 cross-device guarantees for a set
 * of live approval cards: single-winner across concurrent cards for one logical
 * operation (multi-card), at-most-once (duplicate submission), and validity
 * window (timeout / not-yet-valid). Pure aside from an injected `clock` — no
 * fs/RNG — so it is fully unit-testable and serializable alongside a session.
 */
export class OperationApprovalRegistry {
  constructor({ clock } = {}) {
    this._byFingerprint = new Map(); // fingerprint -> pending record
    this._activeByLogicalKey = new Map(); // logical key -> active fingerprint
    this._clock = typeof clock === "function" ? clock : null;
  }

  _now() {
    return this._clock ? intOrNull(this._clock()) : null;
  }

  /**
   * Issue a card for an operation. Any still-unresolved card for the SAME
   * logical operation is superseded (single-winner) so only this newest card
   * can resolve.
   * @returns {{fingerprint:string, shortId:string, summary:string}}
   */
  issue(desc = {}) {
    const fingerprint = computeOperationFingerprint(desc);
    const logicalKey = operationDescriptorKey(desc);

    const priorFp = this._activeByLogicalKey.get(logicalKey);
    if (priorFp && priorFp !== fingerprint) {
      const prior = this._byFingerprint.get(priorFp);
      if (prior && !prior.resolved) prior.supersededBy = fingerprint;
    }

    this._byFingerprint.set(fingerprint, {
      fingerprint,
      logicalKey,
      notBefore: intOrNull(desc.notBefore),
      notAfter: intOrNull(desc.notAfter),
      resolved: false,
      supersededBy: null,
    });
    this._activeByLogicalKey.set(logicalKey, fingerprint);

    return {
      fingerprint,
      shortId: shortOperationId(fingerprint),
      summary: summarizeOperation(desc),
    };
  }

  /**
   * Resolve a card by fingerprint. Fails closed (with a named reason) on an
   * unknown, superseded, duplicate, mismatched, not-yet-valid or expired card.
   * On success the card is marked resolved so a replay is a `duplicate`.
   * @param {string} fingerprint
   * @param {object} [opts]  {now?} overrides the injected clock
   * @returns {{ok:boolean, reason:(string|null)}}
   */
  resolve(fingerprint, opts = {}) {
    const pending = this._byFingerprint.get(fingerprint);
    if (!pending) return { ok: false, reason: "unknown" };
    const now = opts.now !== undefined ? intOrNull(opts.now) : this._now();
    const verdict = resolveOperationApproval(pending, { fingerprint }, { now });
    if (verdict.ok) pending.resolved = true;
    return verdict;
  }

  /** A read-only view of a pending card (or null). */
  get(fingerprint) {
    const p = this._byFingerprint.get(fingerprint);
    return p ? { ...p } : null;
  }
}
