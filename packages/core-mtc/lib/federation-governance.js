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
        // Consensus rule: count at most ONE vote per *current member*, and
        // never the invite target voting for its own admission. `votes.approve`
        // is a raw array compared by `length >= required`, so without this gate
        // the M-of-N threshold is bypassable — a single member (or a forged /
        // non-member actor_member_id) could append N approvals and reach quorum
        // alone. Mirrors the per-pubkey dedup the federated landmark path uses.
        const voter = ev.actor_member_id;
        const alreadyVoted =
          inv.votes.approve.includes(voter) || inv.votes.reject.includes(voter);
        if (!state.members[voter] || voter === target || alreadyVoted) {
          // ignore: non-member, self-vote, or duplicate vote
        } else {
          inv.votes[p.decision].push(voter);
        }
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
        // v0.10: keep ALL open proposals indexed by event_id (was overwriting
        // by target before, which lost concurrent proposals from different
        // proposers for the same target). pending_revokes[target] still
        // returns ONE for backward compat — the most recent.
        state.pending_revokes_all ||= [];
        state.pending_revokes_all.push({
          member_id: p.target_member_id,
          proposed_at: ev.issued_at,
          event_id: ev.event_id,
          reason: p.reason || null,
          proposer: ev.actor_member_id,
        });
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
        // Drop ALL pending revoke proposals for this target — once revoked,
        // the member's gone, no follow-up proposal is meaningful.
        if (state.pending_revokes_all) {
          state.pending_revokes_all = state.pending_revokes_all.filter(
            (r) => r.member_id !== targetId,
          );
        }
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
        // v0.10: keep ALL open threshold proposals (was overwriting,
        // which lost concurrent proposals with different target Ms).
        const proposal = {
          target: p.proposed_threshold,
          proposed_at: ev.issued_at,
          event_id: ev.event_id,
          activates_at: new Date(
            Date.parse(ev.issued_at) + 30 * 24 * 3600 * 1000,
          ).toISOString(),
          proposer: ev.actor_member_id,
        };
        state.pending_thresholds ||= [];
        state.pending_thresholds.push(proposal);
        // Backward-compat: pending_threshold = MOST RECENT proposal
        state.pending_threshold = proposal;
      }
    } else if (t === "confirm-threshold") {
      // v0.10: confirm-threshold can target a specific proposal via
      // payload.proposal_event_id (CRDT-style explicit selection). When
      // absent (back-compat), confirms the most recent proposal.
      let proposal = null;
      if (p.proposal_event_id && state.pending_thresholds) {
        proposal = state.pending_thresholds.find(
          (pp) => pp.event_id === p.proposal_event_id,
        );
      } else if (state.pending_threshold) {
        proposal = state.pending_threshold;
      }
      if (proposal) {
        state.threshold = proposal.target;
        // Drop ALL pending — once threshold changes, all stale proposals
        // are obsolete (callers can re-propose against the new threshold)
        state.pending_threshold = null;
        state.pending_thresholds = [];
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
    // pending_revokes: backward-compat (one per target, most recent)
    pending_revokes: Object.values(state.pending_revokes),
    // v0.10: ALL open revoke proposals (multiple proposers may propose same target)
    pending_revokes_all: state.pending_revokes_all || [],
    // pending_threshold: backward-compat (most recent only)
    pending_threshold: state.pending_threshold,
    // v0.10: ALL open threshold proposals
    pending_thresholds: state.pending_thresholds || [],
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

/**
 * v0.3 — Cross-federation trust anchor schema.
 *
 * Federation A's verifier may want to accept landmarks signed by federation B
 * (e.g. cross-platform Marketplace publishing). Without an anchor record, the
 * verifier has no way to know which other-federation member-pubkeys to trust.
 *
 * The trust-anchor record is a self-signed document (by federation A's own
 * threshold M-of-N — caller's responsibility to assemble) declaring the
 * accepted other-federation IDs + their pinned member roster snapshot at
 * the time of anchoring. Renewal/revocation goes through the same governance
 * log channel as all other federation operations.
 *
 * Schema: mtc-cross-federation-trust-anchor/v1
 */
const SCHEMA_CROSS_FED_TRUST_ANCHOR = "mtc-cross-federation-trust-anchor/v1";

/**
 * Build a cross-federation trust-anchor record. NOT signed here — caller
 * runs it through createGovernanceEvent (eventType = "create" or a future
 * "cross-federation-trust" event type) so the anchor lives in the host
 * federation's governance.log and is replayable.
 *
 * @param {{
 *   host_federation_id: string,    // who is granting trust
 *   trusted_federation_id: string, // who is being trusted
 *   member_roster_snapshot: Array<{member_id, pubkey_id, alg}>, // pinned
 *   threshold: number,             // remote federation's threshold at snapshot time
 *   accepted_kinds?: string[],     // ["did", "skill", "bridge", "audit"] — what landmark types we accept
 *   expires_at?: string,           // ISO 8601 — defaults to 90 days
 *   notes?: string,
 * }} params
 * @returns {object} unsigned anchor record
 */
function createCrossFederationTrustAnchor(params) {
  if (!params || typeof params !== "object") {
    throw new TypeError("createCrossFederationTrustAnchor: params required");
  }
  if (
    typeof params.host_federation_id !== "string" ||
    !params.host_federation_id
  ) {
    throw new TypeError("host_federation_id required");
  }
  if (
    typeof params.trusted_federation_id !== "string" ||
    !params.trusted_federation_id
  ) {
    throw new TypeError("trusted_federation_id required");
  }
  if (params.host_federation_id === params.trusted_federation_id) {
    throw new RangeError("host and trusted federation must differ");
  }
  if (!Array.isArray(params.member_roster_snapshot)) {
    throw new TypeError("member_roster_snapshot must be an array");
  }
  if (
    !Number.isInteger(params.threshold) ||
    params.threshold < 1 ||
    params.threshold > params.member_roster_snapshot.length
  ) {
    throw new RangeError(
      "threshold must be 1..member_roster_snapshot.length",
    );
  }
  for (const m of params.member_roster_snapshot) {
    if (
      !m ||
      typeof m.member_id !== "string" ||
      typeof m.pubkey_id !== "string"
    ) {
      throw new TypeError(
        "member_roster_snapshot entries must have {member_id, pubkey_id}",
      );
    }
  }
  const now = Date.now();
  const expiresAt =
    params.expires_at ||
    new Date(now + 90 * 24 * 3600 * 1000).toISOString();
  return {
    schema: SCHEMA_CROSS_FED_TRUST_ANCHOR,
    host_federation_id: params.host_federation_id,
    trusted_federation_id: params.trusted_federation_id,
    member_roster_snapshot: params.member_roster_snapshot.slice(),
    threshold: params.threshold,
    accepted_kinds: params.accepted_kinds || [
      "did",
      "skill",
      "bridge",
      "audit",
    ],
    pinned_at: new Date(now).toISOString(),
    expires_at: expiresAt,
    notes: params.notes || null,
  };
}

/**
 * Validate a cross-federation trust anchor's structure + freshness.
 * Does NOT verify member signatures (caller composes its own verifier
 * against host federation's governance.log).
 *
 * @param {object} anchor
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: boolean, code?: string }}
 */
function validateCrossFederationTrustAnchor(anchor, opts = {}) {
  if (!anchor || typeof anchor !== "object") {
    return { ok: false, code: "BAD_SHAPE" };
  }
  if (anchor.schema !== SCHEMA_CROSS_FED_TRUST_ANCHOR) {
    return { ok: false, code: "BAD_SCHEMA" };
  }
  if (
    typeof anchor.host_federation_id !== "string" ||
    typeof anchor.trusted_federation_id !== "string" ||
    anchor.host_federation_id === anchor.trusted_federation_id
  ) {
    return { ok: false, code: "BAD_FEDERATION_IDS" };
  }
  if (!Array.isArray(anchor.member_roster_snapshot)) {
    return { ok: false, code: "BAD_ROSTER" };
  }
  if (
    !Number.isInteger(anchor.threshold) ||
    anchor.threshold < 1 ||
    anchor.threshold > anchor.member_roster_snapshot.length
  ) {
    return { ok: false, code: "BAD_THRESHOLD" };
  }
  if (typeof anchor.expires_at !== "string") {
    return { ok: false, code: "BAD_EXPIRY" };
  }
  const now = opts.now || Date.now();
  if (Date.parse(anchor.expires_at) < now) {
    return { ok: false, code: "EXPIRED" };
  }
  return { ok: true };
}

/**
 * v0.3 — Independent auditor's offline verifier.
 *
 * Replays governance.log + verifies every event signature against the
 * roster derived from earlier replayed events. Returns a complete audit
 * report suitable for compliance review (no network calls; all inputs
 * are pure data).
 *
 * Detects gaps the regular replay would silently allow:
 *   - Events whose actor isn't in the active member set at issued_at
 *   - Events whose signature key_id doesn't match the actor's recorded pubkey_id
 *   - Out-of-order events (issued_at decreases)
 *   - Forged / missing signatures — ONLY when opts.getPublicKey is supplied.
 *     Without a key resolver the audit is purely structural (the key_id check
 *     is a label match, not a cryptographic proof); pass getPublicKey to also
 *     verify each signature against the real key.
 *
 * @param {Array<object>} events - chronologically sorted governance events
 * @param {string} federationId
 * @param {{ now?: number,
 *           getPublicKey?: (memberId: string, keyId: string) => (Buffer|null)
 *         }} [opts] - getPublicKey enables cryptographic signature verification
 *           (pubkey_id → key bytes); omit for a structural-only audit.
 * @returns {{
 *   ok: boolean,
 *   federation_id: string,
 *   events_count: number,
 *   findings: Array<{event_id, severity, code, message}>,
 *   final_state: object,
 * }}
 */
function auditGovernanceLog(events, federationId, opts = {}) {
  const findings = [];
  let lastTs = -Infinity;

  // We need to walk events in order, building up the roster as we go,
  // and verify each event's signature against the roster known AT THAT MOMENT.
  // The trick: the bootstrap "create" event is self-signed by the future first
  // member, so its key_id must equal what create.payload.bootstrap_pubkey_id says.
  const rosterByMember = new Map(); // member_id → {pubkey_id, alg, status, joined_at}

  // Structural checks alone (key_id label == recorded pubkey_id) do NOT prove an
  // event was actually signed by that key — a forger who knows a member's public
  // pubkey_id can stamp it on a garbage signature and pass every check above.
  // When the caller supplies opts.getPublicKey (pubkey_id → key bytes), also
  // verify the signature cryptographically, so a forged or absent signature is
  // surfaced. Without it, this stays a structural/roster audit (pair it with
  // verifyGovernanceLog for crypto verification).
  const verifyCrypto = typeof opts.getPublicKey === "function";
  const cryptoCheck = (ev, memberId, keyId) => {
    if (!verifyCrypto) return;
    if (!ev.signature || typeof ev.signature !== "object") {
      findings.push({
        event_id: ev.event_id,
        severity: "error",
        code: "MISSING_SIGNATURE",
        message: "event has no signature to verify",
      });
      return;
    }
    let pk = null;
    try {
      pk = opts.getPublicKey(memberId, keyId);
    } catch (_err) {
      pk = null;
    }
    if (!pk) {
      findings.push({
        event_id: ev.event_id,
        severity: "error",
        code: "UNKNOWN_KEY",
        message: `no public key for ${memberId} / ${keyId}`,
      });
      return;
    }
    let r;
    try {
      r = verifyGovernanceEvent(ev, { publicKey: pk });
    } catch (_err) {
      r = { ok: false, code: "VERIFY_THREW" };
    }
    if (!r.ok) {
      findings.push({
        event_id: ev.event_id,
        severity: "error",
        code: "FORGED_SIGNATURE",
        message: `signature verification failed (${r.code})`,
      });
    }
  };

  for (const ev of events) {
    if (!ev || ev.fed_id !== federationId) continue;

    // 1. Schema check
    if (ev.schema !== SCHEMA_GOVERNANCE) {
      findings.push({
        event_id: ev.event_id,
        severity: "error",
        code: "BAD_SCHEMA",
        message: `Schema must be ${SCHEMA_GOVERNANCE}`,
      });
      continue;
    }

    // 2. Chronological ordering
    const ts = Date.parse(ev.issued_at);
    if (Number.isNaN(ts)) {
      findings.push({
        event_id: ev.event_id,
        severity: "error",
        code: "BAD_TIMESTAMP",
        message: "issued_at not parseable",
      });
      continue;
    }
    if (ts < lastTs) {
      findings.push({
        event_id: ev.event_id,
        severity: "warn",
        code: "OUT_OF_ORDER",
        message: `issued_at ${ev.issued_at} earlier than previous`,
      });
    }
    lastTs = ts;

    // 3. Special bootstrap path: create can be self-signed by a brand-new actor
    if (ev.event_type === "create" && rosterByMember.size === 0) {
      const claimedId = ev.payload && ev.payload.bootstrap_pubkey_id;
      if (
        claimedId &&
        ev.signature &&
        ev.signature.key_id !== claimedId
      ) {
        findings.push({
          event_id: ev.event_id,
          severity: "error",
          code: "BOOTSTRAP_KEY_MISMATCH",
          message: `create.signature.key_id ${ev.signature.key_id} != payload.bootstrap_pubkey_id ${claimedId}`,
        });
      }
      // Add bootstrap member to roster so subsequent events can be checked
      if (
        ev.payload &&
        ev.payload.bootstrap_member_id &&
        ev.payload.bootstrap_pubkey_id
      ) {
        rosterByMember.set(ev.payload.bootstrap_member_id, {
          pubkey_id: ev.payload.bootstrap_pubkey_id,
          alg: ev.payload.bootstrap_alg || "ed25519",
          joined_at: ev.issued_at,
        });
      }
      // Bootstrap is self-signed by the future first member.
      cryptoCheck(
        ev,
        ev.payload && ev.payload.bootstrap_member_id,
        ev.payload && ev.payload.bootstrap_pubkey_id,
      );
      continue;
    }

    // 4. Actor membership check
    const actor = rosterByMember.get(ev.actor_member_id);
    if (!actor) {
      findings.push({
        event_id: ev.event_id,
        severity: "error",
        code: "UNKNOWN_ACTOR",
        message: `actor_member_id ${ev.actor_member_id} not in roster at issued_at`,
      });
      continue;
    }

    // 5. Signature key_id matches recorded pubkey_id
    if (ev.signature && ev.signature.key_id !== actor.pubkey_id) {
      findings.push({
        event_id: ev.event_id,
        severity: "error",
        code: "ACTOR_KEY_MISMATCH",
        message: `signature.key_id ${ev.signature.key_id} != actor's recorded pubkey_id ${actor.pubkey_id}`,
      });
    }

    // 5b. Cryptographic signature verification (opt-in via opts.getPublicKey).
    cryptoCheck(
      ev,
      ev.actor_member_id,
      ev.signature && ev.signature.key_id,
    );

    // 6. Event-specific roster updates (so later events validate against new state)
    if (ev.event_type === "vote" && ev.payload) {
      // An approve vote can move a candidate into the point-in-time roster (using
      // the candidate_pubkey_id from its invite). Mirror the authenticity half of
      // replayGovernanceLog's vote gate: only count a vote from a CURRENT member,
      // and never the invite target voting for its own admission — otherwise a
      // single forged / non-member actor (or the target itself) could stamp one
      // approval and get admitted into the auditor's roster, defeating its whole
      // purpose (the target's later events would then wrongly validate as a known
      // actor). Admission here is idempotent (guarded by !rosterByMember.has), so
      // dedup is moot; full M-of-N quorum tallying for threshold>=2 stays replay's
      // job — final_state below is derived from replayGovernanceLog.
      const target =
        ev.payload.invite_target_member_id || ev.payload.target_member_id;
      const decision = ev.payload.decision;
      const voter = ev.actor_member_id;
      if (
        target &&
        decision === "approve" &&
        rosterByMember.has(voter) &&
        voter !== target
      ) {
        // Find the most recent invite for this target in events seen so far
        const inviteMatches = events
          .slice(0, events.indexOf(ev))
          .filter(
            (e) =>
              e.event_type === "invite" &&
              e.payload &&
              e.payload.candidate_member_id === target,
          );
        if (inviteMatches.length > 0) {
          const lastInvite = inviteMatches[inviteMatches.length - 1];
          if (
            lastInvite.payload.candidate_pubkey_id &&
            !rosterByMember.has(target)
          ) {
            rosterByMember.set(target, {
              pubkey_id: lastInvite.payload.candidate_pubkey_id,
              alg: lastInvite.payload.candidate_alg || "ed25519",
              joined_at: ev.issued_at,
            });
          }
        }
      }
    } else if (ev.event_type === "leave") {
      rosterByMember.delete(ev.actor_member_id);
    } else if (
      ev.event_type === "confirm-revoke" &&
      ev.payload &&
      ev.payload.target_member_id
    ) {
      rosterByMember.delete(ev.payload.target_member_id);
    } else if (
      ev.event_type === "rotate-key" &&
      ev.payload &&
      ev.payload.new_pubkey_id
    ) {
      const m = rosterByMember.get(ev.actor_member_id);
      if (m) m.pubkey_id = ev.payload.new_pubkey_id;
    }
  }

  // Final replay state for the report
  const final_state = replayGovernanceLog(events, federationId, opts);

  return {
    ok: findings.filter((f) => f.severity === "error").length === 0,
    federation_id: federationId,
    events_count: events.filter((e) => e && e.fed_id === federationId).length,
    findings,
    final_state,
  };
}

/**
 * v0.3 #2 — On-chain governance anchor (Q-COMP-3 unlocked 2026-05-03).
 *
 * The host federation periodically publishes a SHA-256 snapshot hash of
 * its governance.log to a chain (typically a domestic consortium chain).
 * The chain stores the hash + a small metadata header — the events
 * themselves stay off-chain (privacy + cost). Any verifier can later
 * compute the same hash from the events and compare against the chain
 * record, getting tamper-evidence without putting member identities
 * on-chain.
 *
 * Pluggable IChainAnchorClient — production deploys swap in a real
 * client (ethers.js / web3.js wrapping a consortium chain endpoint).
 * Lib ships an in-memory mock + filesystem mock for testing.
 *
 * Schema: mtc-federation-governance-anchor/v1
 */
const SCHEMA_GOVERNANCE_ANCHOR = "mtc-federation-governance-anchor/v1";

/**
 * Compute the canonical snapshot hash of a governance.log for anchoring.
 *
 * snapshot_hash = sha256(JCS({
 *   schema,
 *   fed_id,
 *   events_count,
 *   last_event_id,
 *   last_event_at,
 *   event_id_chain_root,  // sha256(JCS(sorted event_ids))
 * }))
 *
 * The event_id_chain_root binds the order. Two callers running
 * computeGovernanceSnapshotHash on the same set of events get the
 * same hash regardless of disk layout.
 *
 * @param {Array<object>} events
 * @param {string} federationId
 * @returns {{ snapshot_hash: string, events_count: number,
 *             last_event_id: string|null, last_event_at: string|null,
 *             event_id_chain_root: string|null }}
 */
function computeGovernanceSnapshotHash(events, federationId) {
  const fedEvents = sortEventsChronologically(
    (events || []).filter((e) => e && e.fed_id === federationId),
  );
  let event_id_chain_root = null;
  let last_event_id = null;
  let last_event_at = null;
  if (fedEvents.length > 0) {
    const ids = fedEvents.map((e) => e.event_id);
    event_id_chain_root = encodeHashStr(sha256(jcs(ids)));
    last_event_id = ids[ids.length - 1];
    last_event_at = fedEvents[fedEvents.length - 1].issued_at;
  }
  const header = {
    schema: SCHEMA_GOVERNANCE_ANCHOR,
    fed_id: federationId,
    events_count: fedEvents.length,
    last_event_id,
    last_event_at,
    event_id_chain_root,
  };
  return {
    snapshot_hash: encodeHashStr(sha256(jcs(header))),
    events_count: fedEvents.length,
    last_event_id,
    last_event_at,
    event_id_chain_root,
  };
}

/**
 * @typedef {object} AnchorRecord
 * @property {string} schema             - SCHEMA_GOVERNANCE_ANCHOR
 * @property {string} fed_id             - federation id
 * @property {string} snapshot_hash      - hex-encoded sha256 of canonical header
 * @property {number} events_count       - count at snapshot time
 * @property {string} last_event_id      - chronological last event id
 * @property {string} last_event_at      - ISO-8601 timestamp
 * @property {string} event_id_chain_root - hex-encoded merkle root of event ids
 * @property {string} issued_at          - ISO-8601 timestamp
 * @property {string} anchor_actor_member_id - member id that issued anchor
 */

/**
 * @typedef {object} AnchorReceipt
 * @property {string} tx_hash        - chain-specific tx hash (impl-defined prefix)
 * @property {number} block_height   - monotonic per (chain, fed_id)
 * @property {string} anchored_at    - ISO-8601 timestamp
 */

/**
 * @typedef {object} StoredAnchorRecord
 * Extends AnchorRecord with receipt fields and chain_name. Returned by fetch/fetchLatest.
 * @property {string} schema
 * @property {string} fed_id
 * @property {string} snapshot_hash
 * @property {number} events_count
 * @property {string} last_event_id
 * @property {string} last_event_at
 * @property {string} event_id_chain_root
 * @property {string} issued_at
 * @property {string} anchor_actor_member_id
 * @property {string} tx_hash
 * @property {number} block_height
 * @property {string} anchored_at
 * @property {string} chain_name
 */

/**
 * @typedef {object} ChainHealth
 * @property {boolean} ok
 * @property {string} chain_name
 *   Additional impl-specific fields (e.g., root_dir, rpc_endpoint) are allowed.
 */

/**
 * IChainAnchorClient — production swaps in a real chain client.
 *
 * Conformance contract for new chain clients (e.g. ConsortiumChainClient when
 * Q-COMP-3 unblocks per memory `external_blocked_items_triggers.md`):
 *
 *   class MyChainClient {
 *     // Append a new anchor record to chain. Must be atomic per (fed_id, block_height)
 *     // — block_height is implementation-allocated and MUST be strictly increasing per fed_id.
 *     // tx_hash format is impl-defined; recommend prefix indicating chain (e.g. "evm:0x..").
 *     async publish(record: AnchorRecord): Promise<AnchorReceipt>;
 *
 *     // Return all StoredAnchorRecord for the federation, oldest-first.
 *     // If opts.limit is a positive integer, return the LAST `limit` records.
 *     // Empty array (not null) if no records yet.
 *     async fetch(fedId: string, opts?: { limit?: number }): Promise<StoredAnchorRecord[]>;
 *
 *     // Convenience: latest by chronological order, or null if empty.
 *     async fetchLatest(fedId: string): Promise<StoredAnchorRecord | null>;
 *
 *     // Health probe. ok=true if chain reachable and read/write ready.
 *     async health(): Promise<ChainHealth>;
 *   }
 *
 * Production-implementor checklist (ConsortiumChainClient / EVM / Cosmos / BSN):
 *   - publish MUST be idempotent under retry (same record → same receipt OR new
 *     receipt with higher block_height that supersedes — caller uses fetchLatest).
 *   - fetch MUST return chronological order (ascending block_height).
 *   - All 4 methods MUST be async (return Promise) and reject (not throw sync) on error.
 *   - Errors SHOULD carry .code for caller branching (e.g. "CHAIN_UNREACHABLE",
 *     "TX_REJECTED", "INSUFFICIENT_GAS"). No required code list yet — caller treats
 *     any rejection as transient unless code indicates otherwise.
 *   - chain_name on StoredAnchorRecord and ChainHealth MUST match (constant per instance).
 *
 * Lib provides:
 *   - InMemoryChainAnchorClient (testing, deterministic, no persistence)
 *   - FilesystemChainAnchorClient (smoke / cron mock against shared dir, atomic writes)
 */
class InMemoryChainAnchorClient {
  constructor(opts = {}) {
    this._chainName = opts.chainName || "in-memory-mock";
    this._records = []; // chronological
    this._blockHeight = 0;
  }
  async publish(record) {
    this._blockHeight += 1;
    const stored = {
      ...record,
      tx_hash: `imem:${record.fed_id}:${this._blockHeight}`,
      block_height: this._blockHeight,
      anchored_at: new Date().toISOString(),
      chain_name: this._chainName,
    };
    this._records.push(stored);
    return {
      tx_hash: stored.tx_hash,
      block_height: stored.block_height,
      anchored_at: stored.anchored_at,
    };
  }
  async fetch(fedId, opts = {}) {
    const out = this._records.filter((r) => r.fed_id === fedId);
    if (Number.isInteger(opts.limit) && opts.limit > 0) {
      return out.slice(-opts.limit);
    }
    return out;
  }
  async fetchLatest(fedId) {
    const all = await this.fetch(fedId);
    return all.length === 0 ? null : all[all.length - 1];
  }
  async health() {
    return { ok: true, chain_name: this._chainName };
  }
}

class FilesystemChainAnchorClient {
  /**
   * @param {{ rootDir: string, chainName?: string }} opts
   */
  constructor(opts) {
    if (!opts || typeof opts.rootDir !== "string") {
      throw new TypeError("FilesystemChainAnchorClient: rootDir required");
    }
    const fs = require("node:fs");
    const path = require("node:path");
    this._fs = fs;
    this._path = path;
    this._rootDir = opts.rootDir;
    this._chainName = opts.chainName || "filesystem-mock";
  }
  _fedDir(fedId) {
    return this._path.join(this._rootDir, "governance-anchors", fedId);
  }
  async publish(record) {
    const dir = this._fedDir(record.fed_id);
    this._fs.mkdirSync(dir, { recursive: true });
    const existing = this._fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json")).length;
    const block_height = existing + 1;
    const tx_hash = `fs:${record.fed_id}:${block_height}`;
    const stored = {
      ...record,
      tx_hash,
      block_height,
      anchored_at: new Date().toISOString(),
      chain_name: this._chainName,
    };
    const file = this._path.join(
      dir,
      `${String(block_height).padStart(8, "0")}.json`,
    );
    // Atomic write
    const tmp = `${file}.${process.pid}.tmp`;
    this._fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), "utf-8");
    this._fs.renameSync(tmp, file);
    return { tx_hash, block_height, anchored_at: stored.anchored_at };
  }
  async fetch(fedId, opts = {}) {
    const dir = this._fedDir(fedId);
    if (!this._fs.existsSync(dir)) return [];
    const files = this._fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort();
    const out = [];
    for (const name of files) {
      try {
        out.push(
          JSON.parse(this._fs.readFileSync(this._path.join(dir, name), "utf-8")),
        );
      } catch (_err) {
        /* skip malformed */
      }
    }
    if (Number.isInteger(opts.limit) && opts.limit > 0) {
      return out.slice(-opts.limit);
    }
    return out;
  }
  async fetchLatest(fedId) {
    const all = await this.fetch(fedId);
    return all.length === 0 ? null : all[all.length - 1];
  }
  async health() {
    return { ok: true, chain_name: this._chainName, root_dir: this._rootDir };
  }
}

/**
 * Build an anchor record (UNSIGNED) from current governance.log state.
 * Caller signs separately via createGovernanceEvent or by feeding
 * the record into the chain client's publish() (signature optional —
 * chain itself provides tamper-evidence).
 *
 * @param {Array<object>} events
 * @param {string} federationId
 * @param {string} actorMemberId
 * @returns {object} anchor record (without tx_hash/block_height)
 */
function buildGovernanceAnchorRecord(events, federationId, actorMemberId) {
  if (typeof actorMemberId !== "string" || !actorMemberId) {
    throw new TypeError("buildGovernanceAnchorRecord: actorMemberId required");
  }
  const snap = computeGovernanceSnapshotHash(events, federationId);
  return {
    schema: SCHEMA_GOVERNANCE_ANCHOR,
    fed_id: federationId,
    snapshot_hash: snap.snapshot_hash,
    events_count: snap.events_count,
    last_event_id: snap.last_event_id,
    last_event_at: snap.last_event_at,
    event_id_chain_root: snap.event_id_chain_root,
    issued_at: new Date().toISOString(),
    anchor_actor_member_id: actorMemberId,
  };
}

/**
 * Verify that a chain-fetched anchor matches what we'd compute from
 * the local governance.log right now. Tamper-evidence: any local
 * mutation that doesn't recompute + re-anchor will surface as MISMATCH.
 *
 * @param {object} anchorFromChain - from client.fetchLatest(fedId)
 * @param {Array<object>} localEvents - this caller's local governance.log
 * @returns {{ ok: boolean, code?: string, expected_hash?: string,
 *             actual_hash?: string, drift?: object }}
 */
function verifyGovernanceAnchor(anchorFromChain, localEvents) {
  if (!anchorFromChain || typeof anchorFromChain !== "object") {
    return { ok: false, code: "NO_ANCHOR" };
  }
  if (anchorFromChain.schema !== SCHEMA_GOVERNANCE_ANCHOR) {
    return { ok: false, code: "BAD_SCHEMA" };
  }
  const localSnap = computeGovernanceSnapshotHash(
    localEvents,
    anchorFromChain.fed_id,
  );
  if (localSnap.snapshot_hash === anchorFromChain.snapshot_hash) {
    return {
      ok: true,
      expected_hash: anchorFromChain.snapshot_hash,
      actual_hash: localSnap.snapshot_hash,
    };
  }
  return {
    ok: false,
    code: "HASH_MISMATCH",
    expected_hash: anchorFromChain.snapshot_hash,
    actual_hash: localSnap.snapshot_hash,
    drift: {
      events_count_diff:
        localSnap.events_count - anchorFromChain.events_count,
      local_last_event_id: localSnap.last_event_id,
      anchor_last_event_id: anchorFromChain.last_event_id,
    },
  };
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
  // v0.3 cross-federation + auditor
  SCHEMA_CROSS_FED_TRUST_ANCHOR,
  createCrossFederationTrustAnchor,
  validateCrossFederationTrustAnchor,
  auditGovernanceLog,
  // v0.3 #2 on-chain governance anchor (Q-COMP-3 unlocked 2026-05-03)
  SCHEMA_GOVERNANCE_ANCHOR,
  computeGovernanceSnapshotHash,
  buildGovernanceAnchorRecord,
  verifyGovernanceAnchor,
  InMemoryChainAnchorClient,
  FilesystemChainAnchorClient,
};
