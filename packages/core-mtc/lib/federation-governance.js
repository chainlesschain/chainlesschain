"use strict";

/**
 * Federation governance event log (Phase 3 — closes design doc
 * MTC_联邦治理_v1.md §9.1 schema).
 *
 * The governance log is an append-only sequence of signed events that
 * collectively define the current member roster + threshold for a
 * federation. The mutable members.json registry must be derivable by
 * replaying the log; any inconsistency is treated as registry corruption
 * (replay wins). Verifier uses governance.log to reconstruct historical
 * member sets when validating old landmarks.
 *
 * Event types (per design §9.1):
 *   invite, vote, leave, propose-revoke, confirm-revoke, rotate-key,
 *   propose-threshold, confirm-threshold, fork, merge, dispute, wind-down,
 *   create
 *
 * Signing input: domain-prefix || JCS({event without .signature})
 */

const crypto = require("node:crypto");
const { sha256, encodeHashStr } = require("./hash.js");
const { jcs } = require("./jcs.js");
const ed25519 = require("./signers/ed25519.js");
const slhDsa = require("./signers/slh-dsa.js");

const SCHEMA_GOVERNANCE = "mtc-federation-governance/v1";
const GOVERNANCE_DOMAIN_PREFIX = Buffer.from(
  "mtc/v1/federation-governance\n",
  "utf-8",
);

const EVENT_TYPES = Object.freeze([
  "create",
  "invite",
  "vote",
  "leave",
  "propose-revoke",
  "confirm-revoke",
  "rotate-key",
  "propose-threshold",
  "confirm-threshold",
  "fork",
  "merge",
  "dispute",
  "wind-down",
]);

function isValidEventType(t) {
  return EVENT_TYPES.includes(t);
}

function makeEventId() {
  return crypto.randomUUID();
}

function governanceSigningInput(event) {
  const { signature: _ignored, ...rest } = event;
  const canonical = jcs(rest);
  return Buffer.concat([GOVERNANCE_DOMAIN_PREFIX, canonical]);
}

function pickSigner(alg) {
  // Accept both canonical case ("Ed25519") used by signer.ALG and the
  // lowercase short forms ("ed25519" / "slh-dsa-128f") used in CLI flags.
  if (alg === undefined || alg === "ed25519" || alg === "Ed25519") {
    return ed25519;
  }
  if (alg === "slh-dsa-128f" || alg === "SLH-DSA-SHA2-128F") {
    return slhDsa;
  }
  throw new RangeError(`unsupported alg: ${alg}`);
}

/**
 * Build + sign one governance event.
 *
 * @param {{
 *   federationId: string,
 *   eventType: string,
 *   actorMemberId: string,
 *   payload?: object,
 *   secretKey: Buffer,
 *   publicKey: Buffer,
 *   alg?: "ed25519" | "slh-dsa-128f",
 *   issuedAt?: string,           // ISO 8601 (default: now)
 *   eventId?: string,            // default: random uuid
 * }} params
 * @returns {object} signed governance event
 */
function createGovernanceEvent(params) {
  if (!params || typeof params !== "object") {
    throw new TypeError("createGovernanceEvent: params required");
  }
  if (typeof params.federationId !== "string" || !params.federationId) {
    throw new TypeError("createGovernanceEvent: federationId required");
  }
  if (!isValidEventType(params.eventType)) {
    throw new RangeError(
      `createGovernanceEvent: eventType must be one of ${EVENT_TYPES.join(", ")}`,
    );
  }
  if (typeof params.actorMemberId !== "string" || !params.actorMemberId) {
    throw new TypeError("createGovernanceEvent: actorMemberId required");
  }
  if (
    !Buffer.isBuffer(params.secretKey) ||
    !Buffer.isBuffer(params.publicKey)
  ) {
    throw new TypeError(
      "createGovernanceEvent: secretKey + publicKey buffers required",
    );
  }

  const alg = params.alg || "ed25519";
  const signer = pickSigner(alg);
  const trustAnchor = signer.trustAnchorEntry(
    params.publicKey,
    params.actorMemberId,
  );

  // Build the unsigned event with stable field ordering
  const event = {
    schema: SCHEMA_GOVERNANCE,
    fed_id: params.federationId,
    event_type: params.eventType,
    event_id: params.eventId || makeEventId(),
    issued_at: params.issuedAt || new Date().toISOString(),
    actor_member_id: params.actorMemberId,
    payload: params.payload || {},
  };

  const signingInput = governanceSigningInput(event);
  const sig = signer.signTreeHead(signingInput, {
    secretKey: params.secretKey,
    publicKey: params.publicKey,
    issuer: params.actorMemberId,
  });

  event.signature = {
    alg: sig.alg,
    key_id: trustAnchor.pubkey_id,
    value: sig.sig,
  };

  return event;
}

/**
 * Verify a governance event signature against a known public key.
 *
 * @param {object} event - signed governance event
 * @param {{ publicKey: Buffer, alg?: string }} verifier
 * @returns {{ ok: boolean, code?: string }}
 */
function verifyGovernanceEvent(event, verifier) {
  if (!event || typeof event !== "object" || event.schema !== SCHEMA_GOVERNANCE) {
    return { ok: false, code: "BAD_SCHEMA" };
  }
  if (!isValidEventType(event.event_type)) {
    return { ok: false, code: "BAD_EVENT_TYPE" };
  }
  if (
    typeof event.fed_id !== "string" ||
    typeof event.event_id !== "string" ||
    typeof event.issued_at !== "string" ||
    typeof event.actor_member_id !== "string" ||
    !event.signature ||
    typeof event.signature !== "object"
  ) {
    return { ok: false, code: "BAD_SHAPE" };
  }
  if (!verifier || !Buffer.isBuffer(verifier.publicKey)) {
    throw new TypeError("verifyGovernanceEvent: verifier.publicKey required");
  }

  const alg = event.signature.alg || verifier.alg || "ed25519";
  let signer;
  try {
    signer = pickSigner(alg);
  } catch (_err) {
    return { ok: false, code: "BAD_ALG" };
  }

  const signingInput = governanceSigningInput(event);
  const sigValue = event.signature.value || event.signature.sig;
  // ed25519 + slh-dsa expose makeVerifier(trustedKeys: Map) returning a
  // function (signingInput, signatureObj) -> boolean. Build a one-key map
  // keyed on the event's claimed key_id and run that verifier.
  const trustedKeys = new Map();
  trustedKeys.set(event.signature.key_id, verifier.publicKey);
  let ok;
  try {
    const verifyFn = signer.makeVerifier(trustedKeys);
    ok = verifyFn(signingInput, {
      alg: signer.ALG,
      pubkey_id: event.signature.key_id,
      sig: sigValue,
    });
  } catch (_err) {
    return { ok: false, code: "VERIFY_THREW" };
  }
  return ok ? { ok: true } : { ok: false, code: "BAD_SIGNATURE" };
}

/**
 * Replay a governance log to derive the current effective members + threshold.
 * Pure function — does not mutate input. Caller filters by federation.
 *
 * Replay rules (subset for v0.1):
 *   - create: initialize federation with bootstrap_member + threshold=1
 *   - invite: add { member_id, status: "invited" } awaiting votes
 *   - vote: count toward outstanding invite; once ≥threshold, member becomes
 *           "candidate" with weight 0.5 and candidate_until = issued_at + 30d
 *   - leave: remove member from active set, archive their key
 *   - propose-revoke: mark member.proposed_revoke = event_id
 *   - confirm-revoke: remove member, mark key as compromised
 *   - rotate-key: replace member.pubkey_id, archive old key
 *   - propose-threshold: store proposal with target M and 30d cooldown
 *   - confirm-threshold: apply threshold change after cooldown
 *   - fork: split — caller marks as wind-down separately (returns fork info)
 *   - merge: similar — returns merge info
 *   - dispute: mark federation.status = "dispute"
 *   - wind-down: mark federation.status = "wind-down"
 *
 * @param {Array<object>} events - in chronological order
 * @param {string} federationId
 * @param {{ now?: number }} [options]
 * @returns {{
 *   federation_id: string,
 *   status: "bootstrap" | "steady" | "dispute" | "wind-down" | "closed",
 *   threshold: number,
 *   members: Array<{member_id, pubkey_id, alg, weight, status, joined_at}>,
 *   pending_invites: Array<{member_id, votes, required, expires_at}>,
 *   pending_revokes: Array<{member_id, proposed_at, event_id}>,
 *   pending_threshold: object | null,
 *   archived_keys: Array<string>,
 *   compromised_keys: Array<string>,
 * }}
 */
function replayGovernanceLog(events, federationId, options = {}) {
  const now = options.now || Date.now();
  const state = {
    federation_id: federationId,
    status: "bootstrap",
    threshold: 1,
    members: {},
    pending_invites: {},
    pending_revokes: {},
    pending_threshold: null,
    archived_keys: [],
    compromised_keys: [],
  };

  for (const ev of events) {
    if (ev.fed_id !== federationId) continue;
    const t = ev.event_type;
    const p = ev.payload || {};

    if (t === "create") {
      if (p.bootstrap_member_id && p.bootstrap_pubkey_id) {
        state.members[p.bootstrap_member_id] = {
          member_id: p.bootstrap_member_id,
          pubkey_id: p.bootstrap_pubkey_id,
          alg: p.bootstrap_alg || "ed25519",
          weight: 1,
          status: "active",
          joined_at: ev.issued_at,
        };
      }
      state.threshold = Number.isInteger(p.initial_threshold)
        ? p.initial_threshold
        : 1;
      // Bootstrap window: 30 days from create
      state.bootstrap_until = new Date(
        Date.parse(ev.issued_at) + 30 * 24 * 3600 * 1000,
      ).toISOString();
    } else if (t === "invite") {
      if (p.candidate_member_id) {
        state.pending_invites[p.candidate_member_id] = {
          member_id: p.candidate_member_id,
          pubkey_id: p.candidate_pubkey_id || null,
          alg: p.candidate_alg || "ed25519",
          inviter: ev.actor_member_id,
          invited_at: ev.issued_at,
          votes: { approve: [], reject: [] },
          required: state.threshold,
          expires_at: new Date(
            Date.parse(ev.issued_at) + 7 * 24 * 3600 * 1000,
          ).toISOString(),
        };
      }
    } else if (t === "vote") {
      const target = p.invite_target_member_id || p.target_member_id;
      const inv = state.pending_invites[target];
      if (inv && (p.decision === "approve" || p.decision === "reject")) {
        inv.votes[p.decision].push(ev.actor_member_id);
        if (
          inv.votes.approve.length >= inv.required &&
          inv.votes.reject.length === 0
        ) {
          state.members[target] = {
            member_id: target,
            pubkey_id: inv.pubkey_id,
            alg: inv.alg,
            weight: 0.5,
            status: "candidate",
            joined_at: ev.issued_at,
            candidate_until: new Date(
              Date.parse(ev.issued_at) + 30 * 24 * 3600 * 1000,
            ).toISOString(),
          };
          delete state.pending_invites[target];
        }
      }
    } else if (t === "leave") {
      const m = state.members[ev.actor_member_id];
      if (m) {
        state.archived_keys.push(m.pubkey_id);
        delete state.members[ev.actor_member_id];
      }
    } else if (t === "propose-revoke") {
      if (p.target_member_id) {
        state.pending_revokes[p.target_member_id] = {
          member_id: p.target_member_id,
          proposed_at: ev.issued_at,
          event_id: ev.event_id,
          reason: p.reason || null,
        };
      }
    } else if (t === "confirm-revoke") {
      const targetId = p.target_member_id;
      const m = state.members[targetId];
      if (m) {
        const compromised = p.reason === "key-compromise";
        if (compromised) state.compromised_keys.push(m.pubkey_id);
        else state.archived_keys.push(m.pubkey_id);
        delete state.members[targetId];
        delete state.pending_revokes[targetId];
      }
    } else if (t === "rotate-key") {
      const m = state.members[ev.actor_member_id];
      if (m && p.new_pubkey_id) {
        state.archived_keys.push(m.pubkey_id);
        m.pubkey_id = p.new_pubkey_id;
        if (p.new_alg) m.alg = p.new_alg;
        m.rotated_at = ev.issued_at;
      }
    } else if (t === "propose-threshold") {
      if (Number.isInteger(p.proposed_threshold)) {
        state.pending_threshold = {
          target: p.proposed_threshold,
          proposed_at: ev.issued_at,
          event_id: ev.event_id,
          activates_at: new Date(
            Date.parse(ev.issued_at) + 30 * 24 * 3600 * 1000,
          ).toISOString(),
        };
      }
    } else if (t === "confirm-threshold") {
      if (state.pending_threshold) {
        state.threshold = state.pending_threshold.target;
        state.pending_threshold = null;
      }
    } else if (t === "fork") {
      // Original federation continues; the spawned federation is a different fed_id
      state.last_fork = {
        new_federation_id: p.new_federation_id,
        members: p.member_ids || [],
        forked_at: ev.issued_at,
      };
      // Forked-out members leave the original
      for (const mid of p.member_ids || []) {
        const m = state.members[mid];
        if (m) {
          state.archived_keys.push(m.pubkey_id);
          delete state.members[mid];
        }
      }
    } else if (t === "merge") {
      state.last_merge = {
        merged_with: p.other_federation_id,
        new_federation_id: p.new_federation_id,
        merged_at: ev.issued_at,
      };
      state.status = "wind-down";
    } else if (t === "dispute") {
      state.status = "dispute";
      state.dispute_started_at = ev.issued_at;
      state.dispute_deadline = new Date(
        Date.parse(ev.issued_at) + 14 * 24 * 3600 * 1000,
      ).toISOString();
    } else if (t === "wind-down") {
      state.status = "wind-down";
      state.wind_down_at = ev.issued_at;
    }
  }

  // Steady transition: out of bootstrap window AND ≥3 members AND not in dispute/wind-down
  if (
    state.status === "bootstrap" &&
    state.bootstrap_until &&
    Date.parse(state.bootstrap_until) <= now &&
    Object.keys(state.members).length >= 3
  ) {
    state.status = "steady";
  }

  // Promote candidates whose 30-day clock expired
  for (const m of Object.values(state.members)) {
    if (
      m.status === "candidate" &&
      m.candidate_until &&
      Date.parse(m.candidate_until) <= now
    ) {
      m.status = "active";
      m.weight = 1;
    }
  }

  // Convert maps to arrays for stable JSON shape
  return {
    federation_id: state.federation_id,
    status: state.status,
    threshold: state.threshold,
    bootstrap_until: state.bootstrap_until,
    members: Object.values(state.members),
    pending_invites: Object.values(state.pending_invites),
    pending_revokes: Object.values(state.pending_revokes),
    pending_threshold: state.pending_threshold,
    archived_keys: state.archived_keys,
    compromised_keys: state.compromised_keys,
    last_fork: state.last_fork || null,
    last_merge: state.last_merge || null,
    dispute_started_at: state.dispute_started_at || null,
    dispute_deadline: state.dispute_deadline || null,
  };
}

/**
 * Dedupe an event array by event_id, keeping the first occurrence.
 * Sync helper — when pulling from a shared drop-zone, the same event
 * may appear multiple times (publisher republished, multi-source merge).
 *
 * @param {Array<object>} events
 * @returns {Array<object>}
 */
function dedupeEventsByEventId(events) {
  if (!Array.isArray(events)) return [];
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (!ev || typeof ev.event_id !== "string") continue;
    if (seen.has(ev.event_id)) continue;
    seen.add(ev.event_id);
    out.push(ev);
  }
  return out;
}

/**
 * Sort events by issued_at then event_id (stable).
 * Replay correctness depends on chronological ordering.
 *
 * @param {Array<object>} events
 * @returns {Array<object>}
 */
function sortEventsChronologically(events) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => {
    const ta = Date.parse(a.issued_at) || 0;
    const tb = Date.parse(b.issued_at) || 0;
    if (ta !== tb) return ta - tb;
    return (a.event_id || "").localeCompare(b.event_id || "");
  });
}

/**
 * Verify each event's signature given a pubkey lookup function.
 * Returns parallel arrays of {valid, invalid} (events with reasons).
 *
 * The verifier resolves the actor's public key via getPublicKey(actor, key_id).
 * Returning null means "I don't know this key" — event is treated as
 * unknown-signer, not invalid (caller can decide to defer / quarantine).
 *
 * @param {Array<object>} events
 * @param {(actorMemberId: string, keyId: string) => Buffer|null} getPublicKey
 * @returns {{valid: object[], invalid: {event,reason}[], unknown: {event,reason}[]}}
 */
function verifyGovernanceLog(events, getPublicKey) {
  const valid = [];
  const invalid = [];
  const unknown = [];
  for (const ev of events) {
    let pk = null;
    try {
      pk = getPublicKey(ev.actor_member_id, ev.signature && ev.signature.key_id);
    } catch (_err) {
      pk = null;
    }
    if (!pk) {
      unknown.push({ event: ev, reason: "UNKNOWN_KEY" });
      continue;
    }
    const r = verifyGovernanceEvent(ev, { publicKey: pk });
    if (r.ok) valid.push(ev);
    else invalid.push({ event: ev, reason: r.code });
  }
  return { valid, invalid, unknown };
}

module.exports = {
  SCHEMA_GOVERNANCE,
  GOVERNANCE_DOMAIN_PREFIX,
  EVENT_TYPES,
  isValidEventType,
  governanceSigningInput,
  createGovernanceEvent,
  verifyGovernanceEvent,
  replayGovernanceLog,
  dedupeEventsByEventId,
  sortEventsChronologically,
  verifyGovernanceLog,
};
