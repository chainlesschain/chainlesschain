/**
 * ActivityPub Bridge
 *
 * Full ActivityPub S2S protocol implementation:
 * - Actor management (Person type)
 * - Inbox/Outbox processing
 * - HTTP Signature authentication
 * - ActivityStreams 2.0 serialization
 *
 * @module social/activitypub-bridge
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const AP_CONTEXT = "https://www.w3.org/ns/activitystreams";
const AP_SECURITY_CONTEXT = "https://w3id.org/security/v1";

const ACTIVITY_TYPES = {
  CREATE: "Create",
  UPDATE: "Update",
  DELETE: "Delete",
  FOLLOW: "Follow",
  ACCEPT: "Accept",
  REJECT: "Reject",
  LIKE: "Like",
  ANNOUNCE: "Announce",
  UNDO: "Undo",
};

const OBJECT_TYPES = {
  NOTE: "Note",
  ARTICLE: "Article",
  PERSON: "Person",
  IMAGE: "Image",
};

// ============================================================
// ActivityPubBridge
// ============================================================

class ActivityPubBridge extends EventEmitter {
  constructor(database, didManager) {
    super();
    this.database = database;
    this.didManager = didManager;
    this.initialized = false;
    this._localDomain = null;
    this._actorCache = new Map();
    // Optional async resolver (keyId → PEM) used to authenticate inbound HTTP
    // Signatures from remote actors whose key we don't already hold locally.
    // Left null by default: without a resolver, only keys already in the actor
    // store verify — a genuinely-remote signer with no injected resolver is
    // rejected (fail-closed). A resolver that fetches keyId over the network
    // MUST guard against SSRF before it is wired.
    this.keyResolver = null;
    this._remoteKeyCache = new Map();
  }

  /**
   * Inject an async resolver mapping an HTTP-Signature keyId to the signer's
   * RSA public key PEM (used to authenticate inbound federation).
   * @param {(keyId: string) => Promise<string|null>} fn
   */
  setKeyResolver(fn) {
    this.keyResolver = typeof fn === "function" ? fn : null;
  }

  async initialize(options = {}) {
    logger.info("[ActivityPubBridge] Initializing ActivityPub bridge...");
    this._localDomain = options.domain || "localhost";
    this._ensureTables();
    this.initialized = true;
    logger.info(
      "[ActivityPubBridge] ActivityPub bridge initialized successfully",
    );
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      logger.warn("[ActivityPubBridge] Database not available");
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS activitypub_actors (
        id TEXT PRIMARY KEY,
        did TEXT,
        preferred_username TEXT NOT NULL,
        display_name TEXT,
        summary TEXT,
        inbox_url TEXT NOT NULL,
        outbox_url TEXT NOT NULL,
        followers_url TEXT,
        following_url TEXT,
        public_key_pem TEXT,
        private_key_pem TEXT,
        icon_url TEXT,
        domain TEXT NOT NULL,
        is_local INTEGER DEFAULT 0,
        follower_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_ap_actors_did ON activitypub_actors(did);
      CREATE INDEX IF NOT EXISTS idx_ap_actors_username ON activitypub_actors(preferred_username, domain);

      CREATE TABLE IF NOT EXISTS activitypub_activities (
        id TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        object_type TEXT,
        object_id TEXT,
        object_content TEXT,
        target_id TEXT,
        raw_json TEXT,
        is_local INTEGER DEFAULT 0,
        processed INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_ap_activities_actor ON activitypub_activities(actor_id);
      CREATE INDEX IF NOT EXISTS idx_ap_activities_type ON activitypub_activities(activity_type);
      CREATE INDEX IF NOT EXISTS idx_ap_activities_created ON activitypub_activities(created_at DESC);
    `);
  }

  /**
   * Create a local ActivityPub actor from a DID identity.
   * @param {string} did - User DID
   * @param {Object} profile - User profile
   * @returns {Object} Actor record
   */
  async createLocalActor(did, profile = {}) {
    try {
      const username =
        profile.username || did.split(":").pop().substring(0, 16);
      const actorId = `https://${this._localDomain}/users/${username}`;

      // Generate RSA key pair for HTTP Signatures
      const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      const now = Date.now();

      this.database.db
        .prepare(
          `INSERT OR REPLACE INTO activitypub_actors
           (id, did, preferred_username, display_name, summary, inbox_url, outbox_url,
            followers_url, following_url, public_key_pem, private_key_pem, domain, is_local, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          actorId,
          did,
          username,
          profile.displayName || username,
          profile.bio || "",
          `${actorId}/inbox`,
          `${actorId}/outbox`,
          `${actorId}/followers`,
          `${actorId}/following`,
          publicKey,
          privateKey,
          this._localDomain,
          now,
          now,
        );

      this.database.saveToFile();

      const actor = {
        id: actorId,
        did,
        preferredUsername: username,
        displayName: profile.displayName || username,
        inboxUrl: `${actorId}/inbox`,
        outboxUrl: `${actorId}/outbox`,
      };

      this._actorCache.set(did, actor);
      this.emit("actor:created", actor);

      logger.info("[ActivityPubBridge] Created local actor:", actorId);
      return actor;
    } catch (error) {
      logger.error("[ActivityPubBridge] Failed to create actor:", error);
      throw error;
    }
  }

  /**
   * Get actor by DID.
   * @param {string} did - User DID
   * @returns {Object|null} Actor record
   */
  async getActorByDid(did) {
    try {
      if (this._actorCache.has(did)) {
        return this._actorCache.get(did);
      }

      if (!this.database || !this.database.db) {
        return null;
      }

      const row = this.database.db
        .prepare("SELECT * FROM activitypub_actors WHERE did = ?")
        .get(did);

      if (row) {
        this._actorCache.set(did, row);
      }
      return row || null;
    } catch (error) {
      logger.error("[ActivityPubBridge] Failed to get actor:", error);
      return null;
    }
  }

  /**
   * Build an ActivityStreams actor document.
   * @param {string} did - User DID
   * @returns {Object} AS2 actor document
   */
  async buildActorDocument(did) {
    const actor = await this.getActorByDid(did);
    if (!actor) {
      throw new Error("Actor not found for DID: " + did);
    }

    return {
      "@context": [AP_CONTEXT, AP_SECURITY_CONTEXT],
      id: actor.id,
      type: OBJECT_TYPES.PERSON,
      preferredUsername: actor.preferred_username,
      name: actor.display_name,
      summary: actor.summary || "",
      inbox: actor.inbox_url,
      outbox: actor.outbox_url,
      followers: actor.followers_url,
      following: actor.following_url,
      publicKey: {
        id: `${actor.id}#main-key`,
        owner: actor.id,
        publicKeyPem: actor.public_key_pem,
      },
      icon: actor.icon_url ? { type: "Image", url: actor.icon_url } : undefined,
    };
  }

  /**
   * Create an ActivityPub activity and store it.
   * @param {string} actorDid - Actor DID
   * @param {string} type - Activity type
   * @param {Object} object - Activity object
   * @returns {Object} Created activity
   */
  async createActivity(actorDid, type, object) {
    try {
      const actor = await this.getActorByDid(actorDid);
      if (!actor) {
        throw new Error("Actor not found");
      }

      const activityId = `https://${this._localDomain}/activities/${uuidv4()}`;
      const now = Date.now();

      const activity = {
        "@context": AP_CONTEXT,
        id: activityId,
        type,
        actor: actor.id,
        object,
        published: new Date(now).toISOString(),
      };

      this.database.db
        .prepare(
          `INSERT INTO activitypub_activities
           (id, activity_type, actor_id, object_type, object_id, object_content, raw_json, is_local, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          activityId,
          type,
          actor.id,
          object.type || null,
          object.id || null,
          typeof object === "string" ? object : JSON.stringify(object),
          JSON.stringify(activity),
          now,
        );

      this.database.saveToFile();
      this.emit("activity:created", activity);

      return activity;
    } catch (error) {
      logger.error("[ActivityPubBridge] Failed to create activity:", error);
      throw error;
    }
  }

  /**
   * Process an incoming activity (inbox).
   * @param {Object} activity - Incoming ActivityPub activity
   * @returns {Object} Processing result
   */
  async processInboxActivity(activity, options = {}) {
    try {
      if (!activity || !activity.type) {
        throw new Error("Invalid activity");
      }

      // Authenticate the sender BEFORE storing/dispatching. Untrusted, unsigned
      // (or badly-signed) inbound activities are rejected fail-closed so a
      // remote peer cannot forge Follow/Create/Like to impersonate an actor,
      // inflate follower counts, or inject items into the local feed.
      const auth = await this._authorizeInbound(activity, options);
      if (!auth.ok) {
        logger.warn(
          `[ActivityPubBridge] Rejected inbound ${activity.type}: ${auth.reason}`,
        );
        this.emit("inbox:rejected", {
          type: activity.type,
          actor:
            typeof activity.actor === "string"
              ? activity.actor
              : activity.actor?.id || null,
          reason: auth.reason,
        });
        return { accepted: false, reason: auth.reason };
      }

      const now = Date.now();

      // Inbound activities are often anonymous/embedded with no top-level id.
      // Compute the stored row id ONCE (with a fallback) and reuse it for the
      // mark-processed UPDATE below — passing the raw (undefined) activity.id to
      // better-sqlite3 throws "Undefined value used as bound parameter", so the
      // activity would never be marked processed and would be retried forever.
      const activityRowId = activity.id || `urn:uuid:${uuidv4()}`;

      // Store activity
      this.database.db
        .prepare(
          `INSERT OR IGNORE INTO activitypub_activities
           (id, activity_type, actor_id, object_type, object_id, object_content, raw_json, is_local, processed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        )
        .run(
          activityRowId,
          activity.type,
          typeof activity.actor === "string"
            ? activity.actor
            : activity.actor?.id || "",
          activity.object?.type || null,
          typeof activity.object === "string"
            ? activity.object
            : activity.object?.id || null,
          typeof activity.object === "string"
            ? activity.object
            : JSON.stringify(activity.object),
          JSON.stringify(activity),
          now,
        );

      // Process by type
      let result = { accepted: true };
      switch (activity.type) {
        case ACTIVITY_TYPES.FOLLOW:
          result = await this._handleFollow(activity);
          break;
        case ACTIVITY_TYPES.CREATE:
          result = await this._handleCreate(activity);
          break;
        case ACTIVITY_TYPES.LIKE:
          result = await this._handleLike(activity);
          break;
        case ACTIVITY_TYPES.ANNOUNCE:
          result = await this._handleAnnounce(activity);
          break;
        case ACTIVITY_TYPES.UNDO:
          result = await this._handleUndo(activity);
          break;
        default:
          logger.info(
            "[ActivityPubBridge] Unhandled activity type:",
            activity.type,
          );
      }

      // Mark as processed (use the same id we stored under, not the raw
      // possibly-undefined activity.id)
      this.database.db
        .prepare("UPDATE activitypub_activities SET processed = 1 WHERE id = ?")
        .run(activityRowId);

      this.database.saveToFile();
      this.emit("inbox:received", { activity, result });

      return result;
    } catch (error) {
      logger.error(
        "[ActivityPubBridge] Failed to process inbox activity:",
        error,
      );
      throw error;
    }
  }

  async _handleFollow(activity) {
    const targetActorId =
      typeof activity.object === "string"
        ? activity.object
        : activity.object?.id;
    const actor = this.database.db
      .prepare("SELECT * FROM activitypub_actors WHERE id = ?")
      .get(targetActorId);

    if (actor && actor.is_local) {
      this.database.db
        .prepare(
          "UPDATE activitypub_actors SET follower_count = follower_count + 1 WHERE id = ?",
        )
        .run(targetActorId);
      return { accepted: true, type: "follow" };
    }
    return { accepted: false, reason: "Actor not found" };
  }

  async _handleCreate(activity) {
    this.emit("content:received", activity.object);
    return { accepted: true, type: "create" };
  }

  async _handleLike(activity) {
    this.emit("like:received", {
      actor: activity.actor,
      object: activity.object,
    });
    return { accepted: true, type: "like" };
  }

  async _handleAnnounce(activity) {
    this.emit("boost:received", {
      actor: activity.actor,
      object: activity.object,
    });
    return { accepted: true, type: "announce" };
  }

  async _handleUndo(_unused_activity) {
    return { accepted: true, type: "undo" };
  }

  /**
   * Sign an HTTP request using the actor's private key.
   * @param {string} actorDid - Actor DID
   * @param {string} targetUrl - Target URL
   * @param {Object} body - Request body
   * @returns {Object} Signed headers
   */
  async signRequest(actorDid, targetUrl, body) {
    try {
      const actor = await this.getActorByDid(actorDid);
      if (!actor || !actor.private_key_pem) {
        throw new Error("Actor or private key not found");
      }

      const url = new URL(targetUrl);
      const date = new Date().toUTCString();
      const digest = body
        ? `SHA-256=${crypto.createHash("sha256").update(JSON.stringify(body)).digest("base64")}`
        : null;

      const signString = [
        `(request-target): post ${url.pathname}`,
        `host: ${url.host}`,
        `date: ${date}`,
        digest ? `digest: ${digest}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const signer = crypto.createSign("sha256");
      signer.update(signString);
      const signature = signer.sign(actor.private_key_pem, "base64");

      const headers = {
        Host: url.host,
        Date: date,
        Signature: `keyId="${actor.id}#main-key",headers="(request-target) host date${digest ? " digest" : ""}",signature="${signature}"`,
      };

      if (digest) {
        headers.Digest = digest;
      }

      return headers;
    } catch (error) {
      logger.error("[ActivityPubBridge] Failed to sign request:", error);
      throw error;
    }
  }

  /**
   * Parse an HTTP Signature header (draft-cavage) into its components.
   * Format: keyId="...",algorithm="...",headers="(request-target) host date digest",signature="..."
   * @param {string} sigHeader
   * @returns {{ keyId: string, headers: string[], signature: string }|null}
   * @private
   */
  _parseSignatureHeader(sigHeader) {
    if (!sigHeader || typeof sigHeader !== "string") {
      return null;
    }
    const params = {};
    // Split on commas that separate key="value" pairs (values are quoted, so
    // internal commas — e.g. in a header list — don't appear unquoted here).
    for (const part of sigHeader.split(/,(?=[a-zA-Z]+=")/)) {
      const m = part.match(/^\s*([a-zA-Z]+)="(.*)"\s*$/);
      if (m) {
        params[m[1]] = m[2];
      }
    }
    if (!params.keyId || !params.signature || !params.headers) {
      return null;
    }
    return {
      keyId: params.keyId,
      headers: params.headers.split(/\s+/).filter(Boolean),
      signature: params.signature,
    };
  }

  /**
   * Resolve the RSA public key PEM for a signature keyId. Tries the local actor
   * store first (keyId minus the #fragment is the actor id), then the in-memory
   * cache, then the injected keyResolver. Returns null if unresolvable — the
   * caller then fails closed rather than trusting an unauthenticated activity.
   * @param {string} keyId
   * @returns {Promise<string|null>}
   * @private
   */
  async _resolveSignatureKey(keyId) {
    const actorId = String(keyId).split("#")[0];
    if (this.database && this.database.db) {
      try {
        const row = this.database.db
          .prepare("SELECT public_key_pem FROM activitypub_actors WHERE id = ?")
          .get(actorId);
        if (row && row.public_key_pem) {
          return row.public_key_pem;
        }
      } catch (err) {
        logger.warn(
          "[ActivityPubBridge] actor key lookup failed:",
          err.message,
        );
      }
    }
    if (this._remoteKeyCache.has(keyId)) {
      return this._remoteKeyCache.get(keyId);
    }
    if (this.keyResolver) {
      try {
        const pem = await this.keyResolver(keyId);
        if (pem) {
          this._remoteKeyCache.set(keyId, pem);
          return pem;
        }
      } catch (err) {
        logger.warn(
          "[ActivityPubBridge] keyResolver failed for",
          keyId,
          err.message,
        );
      }
    }
    return null;
  }

  /**
   * Verify an inbound request's HTTP Signature (draft-cavage), the symmetric
   * counterpart of signRequest(): rebuild the signing string from the signed
   * header list, verify the rsa-sha256 signature against the signer's public
   * key, and — when `digest` is covered — confirm the body Digest matches.
   * @param {Object} req
   * @param {string} [req.method="post"]
   * @param {string} req.path - request path (must equal the signed (request-target))
   * @param {Object} req.headers - inbound headers (case-insensitive lookup)
   * @param {string} [req.rawBody] - exact request body bytes (for digest check)
   * @returns {Promise<{ ok: boolean, reason?: string, keyId?: string }>}
   */
  async verifyInboxSignature({ method = "post", path, headers, rawBody } = {}) {
    try {
      if (!headers || typeof headers !== "object") {
        return { ok: false, reason: "no headers" };
      }
      // Case-insensitive header access.
      const lower = {};
      for (const [k, v] of Object.entries(headers)) {
        lower[k.toLowerCase()] = v;
      }
      const parsed = this._parseSignatureHeader(lower.signature);
      if (!parsed) {
        return { ok: false, reason: "missing or malformed Signature header" };
      }

      // Rebuild the signing string from the covered header list.
      const lines = [];
      for (const name of parsed.headers) {
        if (name === "(request-target)") {
          lines.push(
            `(request-target): ${String(method).toLowerCase()} ${path}`,
          );
        } else {
          const val = lower[name];
          if (val === undefined) {
            return { ok: false, reason: `signed header "${name}" absent` };
          }
          lines.push(`${name}: ${val}`);
        }
      }
      const signingString = lines.join("\n");

      const pem = await this._resolveSignatureKey(parsed.keyId);
      if (!pem) {
        return {
          ok: false,
          reason: `unresolved signing key: ${parsed.keyId}`,
        };
      }

      const verifier = crypto.createVerify("sha256");
      verifier.update(signingString, "utf8");
      const valid = verifier.verify(pem, parsed.signature, "base64");
      if (!valid) {
        return { ok: false, reason: "signature verification failed" };
      }

      // If the signature covers the body digest, it must match the actual body.
      if (parsed.headers.includes("digest") && rawBody !== undefined) {
        const expected =
          "SHA-256=" +
          crypto.createHash("sha256").update(rawBody).digest("base64");
        if (lower.digest !== expected) {
          return { ok: false, reason: "digest does not match body" };
        }
      }

      return { ok: true, keyId: parsed.keyId };
    } catch (err) {
      return { ok: false, reason: `verify error: ${err.message}` };
    }
  }

  /**
   * Decide whether an inbound activity is authentic enough to process.
   *   - options.trusted → internal replay / local origin, accepted.
   *   - HTTP Signature present → verify it (reject on failure).
   *   - otherwise unsigned+untrusted → rejected (fail-closed), unless the
   *     CHAINLESSCHAIN_AP_ALLOW_UNSIGNED_INBOX=1 kill-switch restores the old
   *     accept-all behavior for operators without federation signing wired.
   * @private
   */
  async _authorizeInbound(activity, options = {}) {
    if (options.trusted === true) {
      return { ok: true };
    }
    const hasSignature =
      options.headers &&
      (options.headers.signature || options.headers.Signature);
    if (hasSignature) {
      return this.verifyInboxSignature({
        method: options.method,
        path: options.path,
        headers: options.headers,
        rawBody: options.rawBody,
      });
    }
    if (process.env.CHAINLESSCHAIN_AP_ALLOW_UNSIGNED_INBOX === "1") {
      logger.warn(
        `[ActivityPubBridge] Accepting UNSIGNED inbound ${activity.type} (kill-switch CHAINLESSCHAIN_AP_ALLOW_UNSIGNED_INBOX=1)`,
      );
      return { ok: true };
    }
    return {
      ok: false,
      reason: "unsigned inbound activity (no HTTP Signature)",
    };
  }

  /**
   * Get outbox activities for an actor.
   * @param {string} actorDid - Actor DID
   * @param {Object} [options] - Query options
   * @returns {Object} OrderedCollection
   */
  async getOutbox(actorDid, options = {}) {
    try {
      const actor = await this.getActorByDid(actorDid);
      if (!actor) {
        throw new Error("Actor not found");
      }

      const limit = options.limit || 20;
      const offset = options.offset || 0;

      const activities = this.database.db
        .prepare(
          `SELECT * FROM activitypub_activities
           WHERE actor_id = ? AND is_local = 1
           ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(actor.id, limit, offset);

      const total = this.database.db
        .prepare(
          "SELECT COUNT(*) as count FROM activitypub_activities WHERE actor_id = ? AND is_local = 1",
        )
        .get(actor.id);

      return {
        "@context": AP_CONTEXT,
        type: "OrderedCollection",
        totalItems: total?.count || 0,
        orderedItems: activities.map((a) => {
          try {
            return JSON.parse(a.raw_json);
          } catch {
            return { id: a.id, type: a.activity_type };
          }
        }),
      };
    } catch (error) {
      logger.error("[ActivityPubBridge] Failed to get outbox:", error);
      throw error;
    }
  }

  /**
   * Get bridge status.
   * @returns {Object} Bridge status
   */
  async getStatus() {
    try {
      if (!this.database || !this.database.db) {
        return {
          initialized: this.initialized,
          domain: this._localDomain,
          actorCount: 0,
          activityCount: 0,
        };
      }

      const actorCount = this.database.db
        .prepare(
          "SELECT COUNT(*) as count FROM activitypub_actors WHERE is_local = 1",
        )
        .get();

      const activityCount = this.database.db
        .prepare("SELECT COUNT(*) as count FROM activitypub_activities")
        .get();

      return {
        initialized: this.initialized,
        domain: this._localDomain,
        actorCount: actorCount?.count || 0,
        activityCount: activityCount?.count || 0,
      };
    } catch (error) {
      logger.error("[ActivityPubBridge] Failed to get status:", error);
      return { initialized: false, error: error.message };
    }
  }

  async close() {
    logger.info("[ActivityPubBridge] Closing bridge");
    this._actorCache.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

let _instance;
function getActivityPubBridge() {
  if (!_instance) {
    _instance = new ActivityPubBridge();
  }
  return _instance;
}

export {
  ActivityPubBridge,
  getActivityPubBridge,
  ACTIVITY_TYPES,
  OBJECT_TYPES,
  AP_CONTEXT,
};
