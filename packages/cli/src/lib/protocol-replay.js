/**
 * Offline protocol replay — the last open pure item of P1-9 ("离线协议回放") in
 * docs/CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md.
 *
 * [[event-seq-replay.js]] replays for TRANSPORT reliability (re-send a gap over a
 * lossy socket). This module replays for PROTOCOL COMPAT: take a recorded
 * stream-json session and a negotiation context (server offer × client offer) and
 * answer two offline questions no live peer is needed for —
 *
 *   1. REPLAY: what would these frames look like on the wire under THIS
 *      negotiation? (fields whose feature did not survive negotiation are
 *      stripped, exactly as the live emitter's field-gate would strip them.)
 *   2. AUDIT: does a recorded session OBEY a claimed negotiation, i.e. does any
 *      frame carry a negotiable wire field the negotiation gated OFF? A vN-only
 *      client must never receive a vN+1 field; a recording that violates that is
 *      a compat bug this catches deterministically, offline, in CI.
 *
 * The set of gateable wire fields ({seq, trace_id, tool_use_id}) is projected
 * from the ONE canonical [[capability-manifest.js]] via `toFieldGate()` — it can
 * NOT drift from the negotiated feature list. All non-negotiable frame fields
 * (type, content, tool name, …) always pass through untouched.
 *
 * PURE + deterministic: no fs / process / clock / RNG. The `digest` lets a golden
 * recording be pinned so any change to negotiation/gating that alters wire output
 * fails a byte/hash compare (same anti-drift philosophy as the capability doc).
 */

import { createHash } from "node:crypto";
import {
  negotiateProtocol,
  applyNegotiationToGate,
} from "./capability-negotiation.js";
import { toFieldGate } from "./capability-manifest.js";

/** Negotiable wire field names ({seq, trace_id, tool_use_id}), single-sourced. */
export const GATEABLE_FIELDS = Object.freeze(
  [...new Set(Object.values(toFieldGate()))].sort(),
);

/**
 * Run negotiation and fold it into a per-field gate the replay/audit read.
 * On an incompatible (ok:false) negotiation the gate stays empty → every gateable
 * field is treated as OFF (fail-closed safe baseline).
 *
 * @param {object} params
 * @param {object} params.server  server offer {protocolVersion,minProtocolVersion,features}
 * @param {object|null} [params.client]  client offer, or null/undefined = legacy peer
 * @returns {{negotiation:object, gate:object, enabledFields:string[], gatedFields:string[]}}
 */
export function gateFromNegotiation({ server = {}, client = null } = {}) {
  const negotiation = negotiateProtocol(server, client ?? null);
  const gate = applyNegotiationToGate(negotiation, {});
  const enabledFields = GATEABLE_FIELDS.filter((f) => gate[f] === true);
  const gatedFields = GATEABLE_FIELDS.filter((f) => gate[f] !== true);
  return { negotiation, gate, enabledFields, gatedFields };
}

/**
 * Strip from a single frame every gateable wire field the gate has OFF, exactly
 * as the live emitter would; all other fields pass through in original order.
 * Returns a shallow copy — the input frame is never mutated.
 *
 * @param {object} frame
 * @param {object} gate  {seq?:boolean, trace_id?:boolean, tool_use_id?:boolean}
 * @returns {object}
 */
export function replayFrame(frame, gate = {}) {
  if (!frame || typeof frame !== "object") return frame;
  const out = {};
  for (const [k, v] of Object.entries(frame)) {
    if (GATEABLE_FIELDS.includes(k) && gate[k] !== true) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Replay a recorded session under a negotiation → the frames as they'd appear on
 * the wire (gated-off fields stripped) plus a deterministic digest.
 *
 * @param {object[]} frames  recorded stream-json frames
 * @param {{server:object, client?:object|null}} ctx  negotiation context
 * @returns {{negotiation:object, gate:object, enabledFields:string[],
 *            gatedFields:string[], frames:object[], digest:string}}
 */
export function replaySession(frames, ctx = {}) {
  const { negotiation, gate, enabledFields, gatedFields } =
    gateFromNegotiation(ctx);
  const emitted = (Array.isArray(frames) ? frames : []).map((f) =>
    replayFrame(f, gate),
  );
  return {
    negotiation,
    gate,
    enabledFields,
    gatedFields,
    frames: emitted,
    digest: sessionDigest(emitted),
  };
}

/**
 * Audit a recorded session against a claimed negotiation WITHOUT stripping:
 * report every frame that carries a gateable wire field the negotiation gated
 * OFF (a forward-compat violation — a field a peer at the agreed version must not
 * have received). Fail-closed: `ok` is true only when there are zero violations.
 *
 * @param {object[]} frames
 * @param {{server:object, client?:object|null}} ctx
 * @returns {{ok:boolean, violations:Array<{index:number, field:string, type:(string|null)}>, gate:object, gatedFields:string[]}}
 */
export function auditRecordedSession(frames, ctx = {}) {
  const { gate, gatedFields } = gateFromNegotiation(ctx);
  const violations = [];
  (Array.isArray(frames) ? frames : []).forEach((frame, index) => {
    if (!frame || typeof frame !== "object") return;
    for (const field of GATEABLE_FIELDS) {
      if (
        gate[field] !== true &&
        Object.prototype.hasOwnProperty.call(frame, field)
      ) {
        violations.push({
          index,
          field,
          type: typeof frame.type === "string" ? frame.type : null,
        });
      }
    }
  });
  return { ok: violations.length === 0, violations, gate, gatedFields };
}

/** Recursively key-sort a value so JSON.stringify is order-independent. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}

/**
 * Deterministic sha256 over a frame sequence (key-order independent) so a golden
 * recording can be pinned and diffed. Pure.
 * @param {object[]} frames
 * @returns {string} 64-hex digest
 */
export function sessionDigest(frames) {
  const body = (Array.isArray(frames) ? frames : []).map(canonical);
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
