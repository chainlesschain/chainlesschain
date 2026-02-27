/**
 * Platform Bridge Manager
 *
 * Bridges ChainlessChain social features to external decentralized platforms:
 * - Mastodon: ActivityPub-based federated social network
 * - Nostr: Relay-based censorship-resistant protocol
 *
 * Features:
 * - Connect/disconnect external platform accounts
 * - Cross-post content to multiple platforms simultaneously
 * - Import feeds from connected platforms
 * - Synchronize feed state
 *
 * @module social/platform-bridge
 * @version 0.45.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

// ============================================================
// Constants
// ============================================================

const SUPPORTED_PLATFORMS = {
  MASTODON: "mastodon",
  NOSTR: "nostr",
  ACTIVITYPUB: "activitypub",
};

const CONNECTION_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  REVOKED: "revoked",
};

const DEFAULT_IMPORT_LIMIT = 50;

// ============================================================
// PlatformBridge
// ============================================================

class PlatformBridge extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;

    // In-memory HTTP client stubs (would be real HTTP clients in production)
    this._mastodonClients = new Map();
    this._nostrRelays = new Map();
  }

  /**
   * Initialize platform bridge manager
   */
  async initialize() {
    logger.info("[PlatformBridge] Initializing platform bridge manager...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[PlatformBridge] Platform bridge manager initialized successfully");
    } catch (error) {
      logger.error("[PlatformBridge] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_connections (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL CHECK(platform IN ('mastodon', 'nostr', 'activitypub')),
        owner_did TEXT NOT NULL,
        external_id TEXT,
        server_url TEXT,
        access_token TEXT,
        relay_urls TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'revoked')),
        last_sync_at INTEGER,
        created_at INTEGER,
        UNIQUE(platform, owner_did)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_bridge_owner ON bridge_connections(owner_did);
      CREATE INDEX IF NOT EXISTS idx_bridge_platform ON bridge_connections(platform);
    `);

    logger.info("[PlatformBridge] Database tables initialized");
  }

  /**
   * Connect a Mastodon account.
   *
   * @param {string} ownerDid - The DID of the account owner
   * @param {string} serverUrl - The Mastodon server URL (e.g., https://mastodon.social)
   * @param {string} token - The OAuth access token for the Mastodon account
   * @returns {Object} The created connection record
   */
  async connectMastodon(ownerDid, serverUrl, token) {
    try {
      if (!ownerDid) {
        throw new Error("Owner DID is required");
      }

      if (!serverUrl) {
        throw new Error("Mastodon server URL is required");
      }

      if (!token) {
        throw new Error("Access token is required");
      }

      // Normalize server URL
      const normalizedUrl = serverUrl.replace(/\/+$/, "");

      const db = this.database.db;
      const connectionId = uuidv4();
      const now = Date.now();

      // Verify the token by simulating account verification
      const externalId = await this._verifyMastodonToken(normalizedUrl, token);

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bridge_connections
        (id, platform, owner_did, external_id, server_url, access_token, relay_urls, status, last_sync_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)
      `);

      stmt.run(
        connectionId,
        SUPPORTED_PLATFORMS.MASTODON,
        ownerDid,
        externalId,
        normalizedUrl,
        token,
        CONNECTION_STATUS.ACTIVE,
        now,
      );

      const connection = {
        id: connectionId,
        platform: SUPPORTED_PLATFORMS.MASTODON,
        owner_did: ownerDid,
        external_id: externalId,
        server_url: normalizedUrl,
        status: CONNECTION_STATUS.ACTIVE,
        created_at: now,
      };

      logger.info(
        "[PlatformBridge] Connected Mastodon account:",
        normalizedUrl,
      );

      this.emit("bridge:connected", {
        platform: SUPPORTED_PLATFORMS.MASTODON,
        connectionId,
      });

      return connection;
    } catch (error) {
      logger.error("[PlatformBridge] Failed to connect Mastodon:", error);
      throw error;
    }
  }

  /**
   * Connect a Nostr account.
   *
   * @param {string} ownerDid - The DID of the account owner
   * @param {Array<string>} relayUrls - List of Nostr relay URLs
   * @param {string} privateKey - The Nostr private key (hex)
   * @returns {Object} The created connection record
   */
  async connectNostr(ownerDid, relayUrls, privateKey) {
    try {
      if (!ownerDid) {
        throw new Error("Owner DID is required");
      }

      if (!relayUrls || !Array.isArray(relayUrls) || relayUrls.length === 0) {
        throw new Error("At least one relay URL is required");
      }

      if (!privateKey) {
        throw new Error("Private key is required");
      }

      const db = this.database.db;
      const connectionId = uuidv4();
      const now = Date.now();

      // Derive public key from private key (simulated)
      // crypto already imported at top
      const externalId = crypto
        .createHash("sha256")
        .update(privateKey)
        .digest("hex")
        .substring(0, 64);

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bridge_connections
        (id, platform, owner_did, external_id, server_url, access_token, relay_urls, status, last_sync_at, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)
      `);

      stmt.run(
        connectionId,
        SUPPORTED_PLATFORMS.NOSTR,
        ownerDid,
        externalId,
        privateKey,
        JSON.stringify(relayUrls),
        CONNECTION_STATUS.ACTIVE,
        now,
      );

      const connection = {
        id: connectionId,
        platform: SUPPORTED_PLATFORMS.NOSTR,
        owner_did: ownerDid,
        external_id: externalId,
        relay_urls: relayUrls,
        status: CONNECTION_STATUS.ACTIVE,
        created_at: now,
      };

      logger.info(
        "[PlatformBridge] Connected Nostr account with",
        relayUrls.length,
        "relays",
      );

      this.emit("bridge:connected", {
        platform: SUPPORTED_PLATFORMS.NOSTR,
        connectionId,
      });

      return connection;
    } catch (error) {
      logger.error("[PlatformBridge] Failed to connect Nostr:", error);
      throw error;
    }
  }

  /**
   * Cross-post content to one or more connected platforms.
   *
   * @param {string} ownerDid - The DID of the posting user
   * @param {string} content - The content to post
   * @param {Array<string>} platforms - List of platform names to post to
   * @returns {Object} Results for each platform
   */
  async crossPost(ownerDid, content, platforms) {
    try {
      if (!ownerDid) {
        throw new Error("Owner DID is required");
      }

      if (!content || content.trim().length === 0) {
        throw new Error("Content is required");
      }

      if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
        throw new Error("At least one platform is required");
      }

      const db = this.database.db;
      const results = {};

      for (const platform of platforms) {
        try {
          const connection = db
            .prepare(
              "SELECT * FROM bridge_connections WHERE owner_did = ? AND platform = ? AND status = ?",
            )
            .get(ownerDid, platform, CONNECTION_STATUS.ACTIVE);

          if (!connection) {
            results[platform] = {
              success: false,
              error: `No active ${platform} connection found`,
            };
            continue;
          }

          if (platform === SUPPORTED_PLATFORMS.MASTODON) {
            const result = await this._postToMastodon(connection, content.trim());
            results[platform] = { success: true, ...result };
          } else if (platform === SUPPORTED_PLATFORMS.NOSTR) {
            const result = await this._postToNostr(connection, content.trim());
            results[platform] = { success: true, ...result };
          } else {
            results[platform] = {
              success: false,
              error: `Unsupported platform: ${platform}`,
            };
          }
        } catch (platformError) {
          results[platform] = {
            success: false,
            error: platformError.message,
          };
          logger.warn(
            `[PlatformBridge] Cross-post to ${platform} failed:`,
            platformError.message,
          );
        }
      }

      logger.info("[PlatformBridge] Cross-posted to", platforms.length, "platforms");

      this.emit("post:cross-posted", { ownerDid, platforms, results });

      return results;
    } catch (error) {
      logger.error("[PlatformBridge] Failed to cross-post:", error);
      throw error;
    }
  }

  /**
   * Import feed items from a connected platform.
   *
   * @param {string} connectionId - The connection ID
   * @param {number} [limit] - Maximum number of items to import
   * @returns {Object} Imported feed data
   */
  async importFeed(connectionId, limit = DEFAULT_IMPORT_LIMIT) {
    try {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      const db = this.database.db;
      const connection = db
        .prepare(
          "SELECT * FROM bridge_connections WHERE id = ? AND status = ?",
        )
        .get(connectionId, CONNECTION_STATUS.ACTIVE);

      if (!connection) {
        throw new Error("Active connection not found");
      }

      let feed = [];

      if (connection.platform === SUPPORTED_PLATFORMS.MASTODON) {
        feed = await this._fetchMastodonFeed(connection, limit);
      } else if (connection.platform === SUPPORTED_PLATFORMS.NOSTR) {
        feed = await this._fetchNostrFeed(connection, limit);
      }

      // Update last sync time
      const now = Date.now();
      db.prepare(
        "UPDATE bridge_connections SET last_sync_at = ? WHERE id = ?",
      ).run(now, connectionId);

      logger.info(
        "[PlatformBridge] Imported",
        feed.length,
        "items from",
        connection.platform,
      );

      this.emit("feed:imported", {
        connectionId,
        platform: connection.platform,
        count: feed.length,
      });

      return {
        platform: connection.platform,
        items: feed,
        syncedAt: now,
      };
    } catch (error) {
      logger.error("[PlatformBridge] Failed to import feed:", error);
      throw error;
    }
  }

  /**
   * Disconnect a platform connection.
   *
   * @param {string} connectionId - The connection ID to disconnect
   * @returns {Object} Result
   */
  async disconnectPlatform(connectionId) {
    try {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      const db = this.database.db;

      const connection = db
        .prepare("SELECT * FROM bridge_connections WHERE id = ?")
        .get(connectionId);

      if (!connection) {
        throw new Error("Connection not found");
      }

      if (connection.status === CONNECTION_STATUS.REVOKED) {
        throw new Error("Connection is already disconnected");
      }

      db.prepare(
        "UPDATE bridge_connections SET status = ? WHERE id = ?",
      ).run(CONNECTION_STATUS.REVOKED, connectionId);

      // Clean up in-memory state
      if (connection.platform === SUPPORTED_PLATFORMS.MASTODON) {
        this._mastodonClients.delete(connectionId);
      } else if (connection.platform === SUPPORTED_PLATFORMS.NOSTR) {
        this._nostrRelays.delete(connectionId);
      }

      logger.info(
        "[PlatformBridge] Disconnected",
        connection.platform,
        "connection:",
        connectionId,
      );

      this.emit("bridge:disconnected", {
        platform: connection.platform,
        connectionId,
      });

      return { success: true, connectionId };
    } catch (error) {
      logger.error("[PlatformBridge] Failed to disconnect platform:", error);
      throw error;
    }
  }

  /**
   * Get all connections for a given owner DID.
   *
   * @param {string} ownerDid - The owner DID
   * @returns {Array} List of connections
   */
  async getConnections(ownerDid) {
    try {
      if (!ownerDid) {
        throw new Error("Owner DID is required");
      }

      const db = this.database.db;
      const connections = db
        .prepare(
          "SELECT * FROM bridge_connections WHERE owner_did = ? ORDER BY created_at DESC",
        )
        .all(ownerDid);

      return connections.map((conn) => ({
        ...conn,
        relay_urls: conn.relay_urls ? JSON.parse(conn.relay_urls) : null,
        // Never expose access_token or private keys in listings
        access_token: conn.access_token ? "***" : null,
      }));
    } catch (error) {
      logger.error("[PlatformBridge] Failed to get connections:", error);
      throw error;
    }
  }

  /**
   * Synchronize feed for a specific connection.
   *
   * @param {string} connectionId - The connection ID to sync
   * @returns {Object} Sync result
   */
  async syncFeed(connectionId) {
    try {
      if (!connectionId) {
        throw new Error("Connection ID is required");
      }

      const db = this.database.db;
      const connection = db
        .prepare(
          "SELECT * FROM bridge_connections WHERE id = ? AND status = ?",
        )
        .get(connectionId, CONNECTION_STATUS.ACTIVE);

      if (!connection) {
        throw new Error("Active connection not found");
      }

      // Import latest feed items since last sync
      const feed = await this.importFeed(connectionId, DEFAULT_IMPORT_LIMIT);

      logger.info(
        "[PlatformBridge] Synced feed for connection:",
        connectionId,
      );

      return {
        success: true,
        connectionId,
        ...feed,
      };
    } catch (error) {
      logger.error("[PlatformBridge] Failed to sync feed:", error);
      throw error;
    }
  }

  // ============================================================
  // Internal Mastodon helpers (simulated)
  // ============================================================

  /**
   * Verify a Mastodon OAuth token (simulated).
   * @private
   */
  async _verifyMastodonToken(serverUrl, token) {
    // In production: GET {serverUrl}/api/v1/accounts/verify_credentials
    // with Authorization: Bearer {token}
    logger.info("[PlatformBridge] Verifying Mastodon token for:", serverUrl);

    // Simulate account ID derivation
    // crypto already imported at top
    return crypto
      .createHash("sha256")
      .update(`mastodon:${serverUrl}:${token}`)
      .digest("hex")
      .substring(0, 20);
  }

  /**
   * Post to Mastodon (simulated).
   * @private
   */
  async _postToMastodon(connection, _unusedContent) {
    // In production: POST {serverUrl}/api/v1/statuses
    // with Authorization: Bearer {access_token}, body: { status: content }
    logger.info("[PlatformBridge] Posting to Mastodon:", connection.server_url);

    return {
      platform: SUPPORTED_PLATFORMS.MASTODON,
      externalPostId: `mastodon-${Date.now()}`,
      url: `${connection.server_url}/@user/${Date.now()}`,
      postedAt: Date.now(),
    };
  }

  /**
   * Fetch Mastodon home feed (simulated).
   * @private
   */
  async _fetchMastodonFeed(connection, _unusedLimit) {
    // In production: GET {serverUrl}/api/v1/timelines/home?limit={limit}
    logger.info("[PlatformBridge] Fetching Mastodon feed from:", connection.server_url);

    // Return empty array as simulated feed
    return [];
  }

  // ============================================================
  // Internal Nostr helpers (simulated)
  // ============================================================

  /**
   * Post to Nostr (simulated).
   * @private
   */
  async _postToNostr(connection, content) {
    // Delegate to NostrBridge if available (Phase 49)
    try {
      // NostrBridge imported at top
      const bridge = getNostrBridge();
      if (bridge.initialized) {
        const result = await bridge.publishEvent({ kind: 1, content });
        return {
          platform: SUPPORTED_PLATFORMS.NOSTR,
          externalPostId: result.eventId || `nostr-${Date.now()}`,
          relayCount: result.relayCount || 0,
          postedAt: Date.now(),
        };
      }
    } catch {
      // NostrBridge not available, use legacy path
    }

    // Legacy fallback: simulated posting
    const relayUrls = connection.relay_urls
      ? JSON.parse(connection.relay_urls)
      : [];

    logger.info(
      "[PlatformBridge] Posting to Nostr via",
      relayUrls.length,
      "relays",
    );

    return {
      platform: SUPPORTED_PLATFORMS.NOSTR,
      externalPostId: `nostr-${Date.now()}`,
      relayCount: relayUrls.length,
      postedAt: Date.now(),
    };
  }

  /**
   * Fetch Nostr feed (simulated).
   * @private
   */
  async _fetchNostrFeed(connection, _unusedLimit) {
    // In production: subscribe to kind-1 events from connected relays
    const relayUrls = connection.relay_urls
      ? JSON.parse(connection.relay_urls)
      : [];

    logger.info(
      "[PlatformBridge] Fetching Nostr feed from",
      relayUrls.length,
      "relays",
    );

    // Return empty array as simulated feed
    return [];
  }

  /**
   * Close the platform bridge manager
   */
  async close() {
    logger.info("[PlatformBridge] Closing platform bridge manager");

    this._mastodonClients.clear();
    this._nostrRelays.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  PlatformBridge,
  SUPPORTED_PLATFORMS,
  CONNECTION_STATUS,
};
