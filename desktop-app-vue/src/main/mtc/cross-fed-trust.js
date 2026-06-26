/**
 * cross-fed-trust — extend the per-community membership trust filter with
 * "we also trust these other federations' members" so a single user can
 * audit-verify landmarks coming from federations they don't directly belong
 * to (typical scenario: a parent / sister community cross-recognizes
 * smaller working groups).
 *
 * v1 scope:
 *   - establishTrust(localCommunityId, {remoteCommunityId, remoteMembers[],
 *     issuedAt?, expiresAt?, note?})
 *     → write trust record under
 *       <userData>/cross-fed-trust/<localCommunityId>/<remoteCommunityId>.json
 *   - listTrusted(localCommunityId) → array of trust records
 *   - revokeTrust(localCommunityId, remoteCommunityId) → delete record
 *   - getTrustedDIDs(localCommunityId) → array of all trusted DIDs from
 *     unexpired trust records (UNION across all cross-fed entries — does
 *     NOT include the local community's own members; caller merges if
 *     needed)
 *
 * Hooks: ChannelEnvelopeDistribution's getCommunityMembers callback
 * (B4-cross-trust v1) was a pure local-membership read. social-initializer
 * now wraps it with `(communityManager.getMembers(...)) ∪
 * (crossFedTrust.getTrustedDIDs(...))` so inbound landmarks signed by
 * cross-trusted federation members ALSO pass the trust filter.
 *
 * @module cross-fed-trust
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/logger.js");

const SCHEMA_TRUST_RECORD = "cross-fed-trust-record/v1";

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function safeId(id, fieldName) {
  if (typeof id !== "string" || !id) {
    throw new TypeError(fieldName + " required");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error(fieldName + " unsafe: " + id);
  }
  return id;
}

function safeDID(did) {
  if (typeof did !== "string" || !did) {
    throw new TypeError("DID required");
  }
  if (!/^did:[A-Za-z0-9]+:[A-Za-z0-9_-]+$/.test(did)) {
    throw new Error("DID format unsafe: " + did);
  }
  return did;
}

function communityDir(rootDir, localCommunityId) {
  return path.join(rootDir, safeId(localCommunityId, "localCommunityId"));
}

function recordPath(rootDir, localCommunityId, remoteCommunityId) {
  return path.join(
    communityDir(rootDir, localCommunityId),
    safeId(remoteCommunityId, "remoteCommunityId") + ".json",
  );
}

class CrossFedTrust {
  /**
   * @param {object} opts
   * @param {string} opts.rootDir - <userData>/cross-fed-trust
   */
  constructor(opts = {}) {
    if (!opts.rootDir) {
      throw new Error("CrossFedTrust: rootDir required");
    }
    this._rootDir = opts.rootDir;
  }

  initialize() {
    ensureDir(this._rootDir);
    logger.info("[CrossFedTrust] initialized rootDir=" + this._rootDir);
  }

  /**
   * Establish (or update) cross-trust to a remote federation.
   *
   * @param {string} localCommunityId - the community whose envelope filter we're augmenting
   * @param {object} args
   * @param {string} args.remoteCommunityId - the federation we're cross-trusting
   * @param {string[]} args.remoteMembers - their member DIDs (snapshot)
   * @param {string} [args.issuedAt] - ISO timestamp; defaults to now
   * @param {string} [args.expiresAt] - ISO timestamp; null/undefined = no expiry
   * @param {string} [args.note] - optional human-readable annotation
   * @returns {object} the persisted trust record
   */
  establishTrust(localCommunityId, args = {}) {
    safeId(localCommunityId, "localCommunityId");
    const { remoteCommunityId, remoteMembers, issuedAt, expiresAt, note } =
      args;
    safeId(remoteCommunityId, "remoteCommunityId");
    if (!Array.isArray(remoteMembers) || remoteMembers.length === 0) {
      throw new TypeError("remoteMembers must be non-empty DID array");
    }
    remoteMembers.forEach(safeDID);
    if (new Set(remoteMembers).size !== remoteMembers.length) {
      throw new Error("remoteMembers contains duplicates");
    }

    ensureDir(communityDir(this._rootDir, localCommunityId));
    const record = {
      schema: SCHEMA_TRUST_RECORD,
      localCommunityId,
      remoteCommunityId,
      remoteMembers,
      issuedAt: issuedAt || new Date().toISOString(),
      expiresAt: expiresAt || null,
      note: note || null,
    };
    fs.writeFileSync(
      recordPath(this._rootDir, localCommunityId, remoteCommunityId),
      JSON.stringify(record, null, 2),
      "utf-8",
    );
    logger.info(
      "[CrossFedTrust] established: " +
        localCommunityId +
        " ↔ " +
        remoteCommunityId +
        " (" +
        remoteMembers.length +
        " members)",
    );
    return record;
  }

  /**
   * Revoke a previously-established trust.
   * Idempotent on unknown remoteCommunityId.
   * @returns {boolean} true if record existed and was deleted
   */
  revokeTrust(localCommunityId, remoteCommunityId) {
    const file = recordPath(this._rootDir, localCommunityId, remoteCommunityId);
    if (!fs.existsSync(file)) {
      return false;
    }
    fs.unlinkSync(file);
    logger.info(
      "[CrossFedTrust] revoked: " +
        localCommunityId +
        " ↔ " +
        remoteCommunityId,
    );
    return true;
  }

  /**
   * List all trust records for a local community (parsed; both expired and
   * not-yet-expired included — caller filters).
   */
  listTrusted(localCommunityId) {
    safeId(localCommunityId, "localCommunityId");
    const dir = communityDir(this._rootDir, localCommunityId);
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, n), "utf-8"));
        } catch (err) {
          logger.warn(
            "[CrossFedTrust] record parse failed at " + n + ": " + err.message,
          );
          return null;
        }
      })
      .filter(Boolean);
  }

  /**
   * Aggregate union of all UN-EXPIRED trusted DIDs for a local community.
   * Used by ChannelEnvelopeDistribution's trust filter to widen the
   * accepted-issuer set beyond the local community's own members.
   *
   * @param {string} localCommunityId
   * @param {object} [opts]
   * @param {Date} [opts.now] - clock injection for tests
   * @returns {string[]} de-duped DID array
   */
  getTrustedDIDs(localCommunityId, opts = {}) {
    const now = opts.now || new Date();
    const nowMs = now.getTime();
    const records = this.listTrusted(localCommunityId);
    const out = new Set();
    for (const r of records) {
      if (r.expiresAt) {
        const expMs = new Date(r.expiresAt).getTime();
        // Fail closed: an unparseable expiry (NaN) is treated as expired rather
        // than granting permanent trust. `NaN <= now` is false, so the old
        // `new Date(r.expiresAt) <= now` check let a malformed expiresAt slip
        // through as never-expiring — a security-relevant fail-open since these
        // DIDs widen ChannelEnvelopeDistribution's accepted-issuer set.
        if (Number.isNaN(expMs) || expMs <= nowMs) {
          continue;
        }
      }
      for (const did of r.remoteMembers || []) {
        out.add(did);
      }
    }
    return [...out].sort();
  }
}

module.exports = {
  CrossFedTrust,
  SCHEMA_TRUST_RECORD,
};
