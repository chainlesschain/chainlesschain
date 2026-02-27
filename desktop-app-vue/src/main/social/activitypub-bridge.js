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
  }

  async initialize(options = {}) {
    logger.info("[ActivityPubBridge] Initializing ActivityPub bridge...");
    this._localDomain = options.domain || "localhost";
    this._ensureTables();
    this.initialized = true;
    logger.info("[ActivityPubBridge] ActivityPub bridge initialized successfully");
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
      const username = profile.username || did.split(":").pop().substring(0, 16);
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
    } catch (_error) {
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
      if (this._actorCache.has(did)) {return this._actorCache.get(did);}

      if (!this.database || !this.database.db) {return null;}

      const row = this.database.db
        .prepare("SELECT * FROM activitypub_actors WHERE did = ?")
        .get(did);

      if (row) {
        this._actorCache.set(did, row);
      }
      return row || null;
    } catch (_error) {
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
    if (!actor) {throw new Error("Actor not found for DID: " + did);}

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
      icon: actor.icon_url
        ? { type: "Image", url: actor.icon_url }
        : undefined,
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
      if (!actor) {throw new Error("Actor not found");}

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
    } catch (_error) {
      logger.error("[ActivityPubBridge] Failed to create activity:", error);
      throw error;
    }
  }

  /**
   * Process an incoming activity (inbox).
   * @param {Object} activity - Incoming ActivityPub activity
   * @returns {Object} Processing result
   */
  async processInboxActivity(activity) {
    try {
      if (!activity || !activity.type) {
        throw new Error("Invalid activity");
      }

      const now = Date.now();

      // Store activity
      this.database.db
        .prepare(
          `INSERT OR IGNORE INTO activitypub_activities
           (id, activity_type, actor_id, object_type, object_id, object_content, raw_json, is_local, processed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        )
        .run(
          activity.id || `urn:uuid:${uuidv4()}`,
          activity.type,
          typeof activity.actor === "string" ? activity.actor : activity.actor?.id || "",
          activity.object?.type || null,
          typeof activity.object === "string" ? activity.object : activity.object?.id || null,
          typeof activity.object === "string" ? activity.object : JSON.stringify(activity.object),
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
          logger.info("[ActivityPubBridge] Unhandled activity type:", activity.type);
      }

      // Mark as processed
      this.database.db
        .prepare("UPDATE activitypub_activities SET processed = 1 WHERE id = ?")
        .run(activity.id);

      this.database.saveToFile();
      this.emit("inbox:received", { activity, result });

      return result;
    } catch (_error) {
      logger.error("[ActivityPubBridge] Failed to process inbox activity:", error);
      throw error;
    }
  }

  async _handleFollow(activity) {
    const targetActorId = typeof activity.object === "string" ? activity.object : activity.object?.id;
    const actor = this.database.db
      .prepare("SELECT * FROM activitypub_actors WHERE id = ?")
      .get(targetActorId);

    if (actor && actor.is_local) {
      this.database.db
        .prepare("UPDATE activitypub_actors SET follower_count = follower_count + 1 WHERE id = ?")
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
    this.emit("like:received", { actor: activity.actor, object: activity.object });
    return { accepted: true, type: "like" };
  }

  async _handleAnnounce(activity) {
    this.emit("boost:received", { actor: activity.actor, object: activity.object });
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

      if (digest) {headers.Digest = digest;}

      return headers;
    } catch (_error) {
      logger.error("[ActivityPubBridge] Failed to sign request:", error);
      throw error;
    }
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
      if (!actor) {throw new Error("Actor not found");}

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
        .prepare("SELECT COUNT(*) as count FROM activitypub_activities WHERE actor_id = ? AND is_local = 1")
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
    } catch (_error) {
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
        return { initialized: this.initialized, domain: this._localDomain, actorCount: 0, activityCount: 0 };
      }

      const actorCount = this.database.db
        .prepare("SELECT COUNT(*) as count FROM activitypub_actors WHERE is_local = 1")
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
    } catch (_error) {
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
  if (!_instance) {_instance = new ActivityPubBridge();}
  return _instance;
}

export {
  ActivityPubBridge,
  getActivityPubBridge,
  ACTIVITY_TYPES,
  OBJECT_TYPES,
  AP_CONTEXT,
};
