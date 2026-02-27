/**
 * ActivityPub Content Sync
 *
 * Bidirectional synchronization of posts, comments, likes, boosts,
 * and follows between local social features and ActivityPub federation.
 *
 * @module social/ap-content-sync
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { ACTIVITY_TYPES } from "./activitypub-bridge.js";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// APContentSync
// ============================================================

class APContentSync extends EventEmitter {
  constructor(database, activityPubBridge, postManager) {
    super();
    this.database = database;
    this.apBridge = activityPubBridge;
    this.postManager = postManager;
    this.initialized = false;
    this._syncInterval = null;
  }

  async initialize(options = {}) {
    logger.info("[APContentSync] Initializing content sync...");
    this.initialized = true;

    if (options.autoSync) {
      const interval = options.syncIntervalMs || 5 * 60 * 1000;
      this._syncInterval = setInterval(() => this.syncAll().catch(() => {}), interval);
    }

    logger.info("[APContentSync] Content sync initialized successfully");
  }

  /**
   * Publish a local post as an ActivityPub Note.
   * @param {string} actorDid - Actor DID
   * @param {Object} post - Local post object
   * @returns {Object} Published activity
   */
  async publishPost(actorDid, post) {
    try {
      if (!post || !post.content) {throw new Error("Post content is required");}

      const actor = await this.apBridge.getActorByDid(actorDid);
      if (!actor) {throw new Error("Actor not found");}

      const noteObject = {
        type: "Note",
        id: `${actor.id}/posts/${post.id || Date.now()}`,
        attributedTo: actor.id,
        content: post.content,
        published: new Date(post.created_at || Date.now()).toISOString(),
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [actor.followers_url],
      };

      if (post.media) {
        noteObject.attachment = Array.isArray(post.media)
          ? post.media.map((m) => ({ type: "Document", url: m.url, mediaType: m.type }))
          : [];
      }

      const activity = await this.apBridge.createActivity(
        actorDid,
        ACTIVITY_TYPES.CREATE,
        noteObject,
      );

      this.emit("post:published", { post, activity });
      return activity;
    } catch (_error) {
      logger.error("[APContentSync] Failed to publish post:", error);
      throw error;
    }
  }

  /**
   * Publish a like as an ActivityPub Like activity.
   * @param {string} actorDid - Actor DID
   * @param {string} objectId - The ID of the object being liked
   * @returns {Object} Like activity
   */
  async publishLike(actorDid, objectId) {
    try {
      return await this.apBridge.createActivity(actorDid, ACTIVITY_TYPES.LIKE, objectId);
    } catch (_error) {
      logger.error("[APContentSync] Failed to publish like:", error);
      throw error;
    }
  }

  /**
   * Publish a boost (Announce).
   * @param {string} actorDid - Actor DID
   * @param {string} objectId - The ID of the object being boosted
   * @returns {Object} Announce activity
   */
  async publishBoost(actorDid, objectId) {
    try {
      return await this.apBridge.createActivity(actorDid, ACTIVITY_TYPES.ANNOUNCE, objectId);
    } catch (_error) {
      logger.error("[APContentSync] Failed to publish boost:", error);
      throw error;
    }
  }

  /**
   * Send a follow request.
   * @param {string} actorDid - Follower DID
   * @param {string} targetActorId - ActivityPub actor ID to follow
   * @returns {Object} Follow activity
   */
  async publishFollow(actorDid, targetActorId) {
    try {
      return await this.apBridge.createActivity(actorDid, ACTIVITY_TYPES.FOLLOW, targetActorId);
    } catch (_error) {
      logger.error("[APContentSync] Failed to publish follow:", error);
      throw error;
    }
  }

  /**
   * Import a remote ActivityPub Note into local posts.
   * @param {Object} noteObject - ActivityPub Note object
   * @param {string} ownerDid - Local owner DID
   * @returns {Object} Imported post
   */
  async importNote(noteObject, ownerDid) {
    try {
      if (!noteObject || !noteObject.content) {
        throw new Error("Note content is required");
      }

      const post = {
        id: noteObject.id || uuidv4(),
        author_did: ownerDid,
        content: noteObject.content,
        visibility: "public",
        source: "activitypub",
        remote_id: noteObject.id,
        remote_actor: noteObject.attributedTo,
        created_at: noteObject.published ? new Date(noteObject.published).getTime() : Date.now(),
      };

      this.emit("note:imported", post);
      return { success: true, post };
    } catch (_error) {
      logger.error("[APContentSync] Failed to import note:", error);
      throw error;
    }
  }

  /**
   * Get sync status.
   * @returns {Object} Sync status
   */
  async getSyncStatus() {
    try {
      if (!this.database || !this.database.db) {
        return { published: 0, received: 0, pending: 0 };
      }

      const published = this.database.db
        .prepare("SELECT COUNT(*) as count FROM activitypub_activities WHERE is_local = 1")
        .get();

      const received = this.database.db
        .prepare("SELECT COUNT(*) as count FROM activitypub_activities WHERE is_local = 0 AND processed = 1")
        .get();

      const pending = this.database.db
        .prepare("SELECT COUNT(*) as count FROM activitypub_activities WHERE is_local = 0 AND processed = 0")
        .get();

      return {
        published: published?.count || 0,
        received: received?.count || 0,
        pending: pending?.count || 0,
      };
    } catch (_error) {
      logger.error("[APContentSync] Failed to get sync status:", error);
      return { published: 0, received: 0, pending: 0 };
    }
  }

  /**
   * Sync all pending activities.
   * @returns {Object} Sync results
   */
  async syncAll() {
    try {
      if (!this.database || !this.database.db) {return { synced: 0 };}

      const pending = this.database.db
        .prepare(
          "SELECT * FROM activitypub_activities WHERE is_local = 0 AND processed = 0 ORDER BY created_at ASC LIMIT 50",
        )
        .all();

      let synced = 0;
      for (const activity of pending) {
        try {
          const parsed = JSON.parse(activity.raw_json);
          await this.apBridge.processInboxActivity(parsed);
          synced++;
        } catch (_err) {
          logger.warn("[APContentSync] Failed to sync activity:", activity.id, err.message);
        }
      }

      return { synced, total: pending.length };
    } catch (_error) {
      logger.error("[APContentSync] Sync failed:", error);
      return { synced: 0, error: error.message };
    }
  }

  async close() {
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[APContentSync] Closed");
  }
}

let _instance;
function getAPContentSync() {
  if (!_instance) {_instance = new APContentSync();}
  return _instance;
}

export { APContentSync, getAPContentSync };
