"use strict";

/**
 * Federation member announcements (Phase 3.3 — service discovery).
 *
 * A federation member periodically publishes a self-signed announce so other
 * nodes in the same federation can build a roster without out-of-band coord.
 * The announce is signed by the member's own MTCA key (proving "I claim
 * membership in fed X with this pubkey, and I can authorize that claim
 * because I hold the key"). Cross-validating that the member is *really*
 * authorized to act in the federation is policy-layer (caller ties announces
 * to the joined-member registry from cc mtc federation join).
 *
 * Schema: mtc-federation-announce/v1 — see ANNOUNCE_DOMAIN_PREFIX for
 * the signature domain-separation prefix.
 *
 * Transport-agnostic: this module only handles the JSON shape + signature
 * machinery. The actual distribution (filesystem drop-zone / libp2p
 * gossipsub topic) lives in transports/ + the CLI command.
 */

const { sha256, encodeHashStr } = require("./hash.js");
const { jcs } = require("./jcs.js");
const ed25519 = require("./signers/ed25519.js");
const slhDsa = require("./signers/slh-dsa.js");

const SCHEMA_ANNOUNCE = "mtc-federation-announce/v1";
const ANNOUNCE_DOMAIN_PREFIX = Buffer.from(
  "mtc/v1/federation-announce\n",
  "utf-8",
);
const DEFAULT_TTL_SECONDS = 600;

/**
 * Build the canonical signing input for an announce.
 * The signed bytes are: domain-prefix || JCS({everything except .signature}).
 */
function announceSigningInput(announce) {
  const { signature: _ignored, ...rest } = announce;
  const canonical = jcs(rest);
  return Buffer.concat([ANNOUNCE_DOMAIN_PREFIX, canonical]);
}

/**
 * Produce a self-signed announce for one federation member.
 *
 * @param {{
 *   federationId: string,
 *   memberId: string,
 *   issuer: string,
 *   secretKey: Buffer,
 *   publicKey: Buffer,
 *   signer?: object,           // ed25519 default; pass slhDsa for PQC announces
 *   announcedAt?: string,       // ISO 8601 (default: now)
 *   ttlSeconds?: number,        // default 600 (10 min)
 * }} params
 * @returns {object} signed announce JSON
 */
function createMemberAnnounce(params) {
  if (!params || typeof params !== "object") {
    throw new TypeError("createMemberAnnounce: params required");
  }
  if (typeof params.federationId !== "string" || !params.federationId) {
    throw new TypeError("createMemberAnnounce: federationId required");
  }
  if (typeof params.memberId !== "string" || !params.memberId) {
    throw new TypeError("createMemberAnnounce: memberId required");
  }
  if (typeof params.issuer !== "string" || !params.issuer) {
    throw new TypeError("createMemberAnnounce: issuer required");
  }
  if (!Buffer.isBuffer(params.secretKey) || !Buffer.isBuffer(params.publicKey)) {
    throw new TypeError("createMemberAnnounce: secretKey + publicKey buffers required");
  }
  const signer = params.signer || ed25519;
  if (typeof signer.signTreeHead !== "function" || typeof signer.trustAnchorEntry !== "function") {
    throw new TypeError("createMemberAnnounce: signer must export signTreeHead + trustAnchorEntry");
  }

  const announcedAt = params.announcedAt || new Date().toISOString();
  const ttlSeconds = Number.isInteger(params.ttlSeconds) && params.ttlSeconds > 0
    ? params.ttlSeconds
    : DEFAULT_TTL_SECONDS;

  const trustAnchor = signer.trustAnchorEntry(params.publicKey, params.issuer);

  const announce = {
    schema: SCHEMA_ANNOUNCE,
    federation_id: params.federationId,
    member_id: params.memberId,
    issuer: params.issuer,
    alg: signer.ALG,
    pubkey_id: trustAnchor.pubkey_id,
    pubkey_jwk: trustAnchor.pubkey_jwk,
    announced_at: announcedAt,
    ttl_seconds: ttlSeconds,
  };

  // Sign the canonical announce body. We reuse signTreeHead because its
  // wire shape ({alg, issuer, sig, pubkey_id}) is exactly what we want
  // attached to the announce — only the domain-prefix differs (we use
  // ANNOUNCE_DOMAIN_PREFIX inside announceSigningInput, signTreeHead just
  // takes raw bytes and produces a sig).
  const signingInput = announceSigningInput(announce);
  announce.signature = signer.signTreeHead(signingInput, {
    secretKey: params.secretKey,
    publicKey: params.publicKey,
    issuer: params.issuer,
  });
  return announce;
}

/**
 * Verify a self-signed announce. Returns { ok, code? } — ok=true means
 * the announce was signed by the key whose pubkey_jwk it embeds.
 *
 * @param {object} announce
 * @param {object} [opts]
 * @param {number} [opts.now] - timestamp (default: Date.now())
 * @param {boolean} [opts.allowExpired=false] - if true, skip TTL check
 */
function verifyMemberAnnounce(announce, opts) {
  if (!announce || typeof announce !== "object") {
    return { ok: false, code: "BAD_ANNOUNCE_SCHEMA" };
  }
  if (announce.schema !== SCHEMA_ANNOUNCE) {
    return { ok: false, code: "BAD_ANNOUNCE_SCHEMA" };
  }
  for (const field of [
    "federation_id",
    "member_id",
    "issuer",
    "alg",
    "pubkey_id",
    "pubkey_jwk",
    "announced_at",
  ]) {
    if (typeof announce[field] === "undefined" || announce[field] === null) {
      return { ok: false, code: "MISSING_FIELD", field };
    }
  }
  if (!announce.signature || typeof announce.signature !== "object") {
    return { ok: false, code: "MISSING_SIGNATURE" };
  }

  // TTL check (unless caller explicitly opts in to expired)
  if (!opts?.allowExpired) {
    const announcedAtMs = Date.parse(announce.announced_at);
    if (Number.isNaN(announcedAtMs)) {
      return { ok: false, code: "BAD_ANNOUNCED_AT" };
    }
    const ttlMs = (announce.ttl_seconds || DEFAULT_TTL_SECONDS) * 1000;
    const now = opts?.now ?? Date.now();
    if (now > announcedAtMs + ttlMs) {
      return { ok: false, code: "ANNOUNCE_EXPIRED" };
    }
  }

  // Signature check — pick the right verifier by alg
  let signer;
  if (announce.alg === ed25519.ALG) {
    signer = ed25519;
  } else if (announce.alg === slhDsa.ALG) {
    signer = slhDsa;
  } else {
    return { ok: false, code: "UNKNOWN_ALG" };
  }

  const publicKey = signer.jwkToPublicKey(announce.pubkey_jwk);
  if (!publicKey) {
    return { ok: false, code: "BAD_PUBKEY_JWK" };
  }

  // Verify pubkey_id matches the JWK
  if (signer.pubkeyId(publicKey) !== announce.pubkey_id) {
    return { ok: false, code: "PUBKEY_ID_MISMATCH" };
  }

  const trustedKeys = new Map([[announce.pubkey_id, publicKey]]);
  const verifier = signer.makeVerifier(trustedKeys);
  const signingInput = announceSigningInput(announce);
  if (!verifier(signingInput, announce.signature)) {
    return { ok: false, code: "BAD_SIGNATURE" };
  }
  return { ok: true };
}

/**
 * In-memory roster of discovered federation members, keyed by
 * (federation_id, pubkey_id). TTL-evicts entries whose announce has expired.
 *
 * Optional persistDir: writes each accepted announce to
 *   <persistDir>/<federation_id>/<pubkey_id_fs_safe>.json
 * so a daemon can resume across restarts.
 */
class FederationAnnounceCache {
  constructor(opts) {
    const o = opts || {};
    this._byFederation = new Map(); // fedId → Map<pubkey_id, announce>
    this._persistDir = o.persistDir || null;
  }

  /**
   * Validate + insert. Returns { accepted: bool, reason?, replaced?: bool }.
   * - accepted=false when the announce fails verification or is expired
   * - replaced=true when this announce updates an existing entry from the
   *   same pubkey_id (e.g. a re-announce after TTL refresh)
   */
  ingest(announce, opts) {
    const result = verifyMemberAnnounce(announce, opts);
    if (!result.ok) {
      return { accepted: false, reason: result.code };
    }
    const fedId = announce.federation_id;
    const pubkeyId = announce.pubkey_id;
    let fed = this._byFederation.get(fedId);
    if (!fed) {
      fed = new Map();
      this._byFederation.set(fedId, fed);
    }
    const existed = fed.has(pubkeyId);
    fed.set(pubkeyId, announce);

    if (this._persistDir) {
      this._persistAnnounce(announce);
    }
    return { accepted: true, replaced: existed };
  }

  /**
   * List currently-cached members for a federation, dropping expired entries.
   */
  listMembers(federationId, opts) {
    const fed = this._byFederation.get(federationId);
    if (!fed) return [];
    const now = opts?.now ?? Date.now();
    const out = [];
    const expired = [];
    for (const [pubkeyId, ann] of fed.entries()) {
      const announcedAt = Date.parse(ann.announced_at);
      const ttlMs = (ann.ttl_seconds || DEFAULT_TTL_SECONDS) * 1000;
      if (now > announcedAt + ttlMs) {
        expired.push(pubkeyId);
        continue;
      }
      out.push(ann);
    }
    for (const id of expired) fed.delete(id);
    return out;
  }

  /**
   * List federations with at least one currently-valid member.
   */
  federations() {
    return [...this._byFederation.keys()];
  }

  /**
   * Total live entries across all federations (post-TTL eviction).
   */
  size(opts) {
    let total = 0;
    for (const fedId of this._byFederation.keys()) {
      total += this.listMembers(fedId, opts).length;
    }
    return total;
  }

  clear() {
    this._byFederation.clear();
  }

  _persistAnnounce(announce) {
    const fs = require("node:fs");
    const path = require("node:path");
    // Sanitize BOTH path components. An announce is self-signed: an attacker can
    // sign one with their OWN key (verifyMemberAnnounce only proves self-
    // consistency; membership legitimacy is policy-layer) and set any
    // federation_id. An unsanitized federation_id like "../../evil" would then
    // traverse outside persistDir and write a file there. Map it to the same
    // filesystem-safe charset as pubkey_id; the real federation_id is preserved
    // inside the JSON content.
    const fedSafe = String(announce.federation_id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const fedDir = path.join(this._persistDir, fedSafe);
    fs.mkdirSync(fedDir, { recursive: true });
    const safe = String(announce.pubkey_id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const file = path.join(fedDir, `${safe}.json`);
    fs.writeFileSync(file, JSON.stringify(announce, null, 2), "utf-8");
  }
}

module.exports = {
  SCHEMA_ANNOUNCE,
  ANNOUNCE_DOMAIN_PREFIX,
  DEFAULT_TTL_SECONDS,
  createMemberAnnounce,
  verifyMemberAnnounce,
  announceSigningInput,
  FederationAnnounceCache,
};
