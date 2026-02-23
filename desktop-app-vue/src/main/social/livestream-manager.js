/**
 * Livestream Manager
 *
 * Manages decentralized livestream lifecycle:
 * - Stream creation, scheduling, and cancellation
 * - Starting and ending live streams
 * - Viewer join/leave tracking with real-time counts
 * - P2P stream metadata synchronization
 *
 * @module livestream-manager
 * @version 0.44.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Stream status constants
 */
const StreamStatus = {
  SCHEDULED: "scheduled",
  LIVE: "live",
  ENDED: "ended",
  CANCELLED: "cancelled",
};

/**
 * Stream access type constants
 */
const StreamAccessType = {
  PUBLIC: "public",
  FRIENDS: "friends",
  PASSWORD: "password",
  INVITE: "invite",
};

/**
 * Viewer status constants
 */
const ViewerStatus = {
  WATCHING: "watching",
  LEFT: "left",
};

/**
 * LivestreamManager class
 * Handles all livestream lifecycle operations
 */
class LivestreamManager extends EventEmitter {
  constructor(database, didManager, p2pManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;

    this.initialized = false;
  }

  /**
   * Initialize the livestream manager
   */
  async initialize() {
    logger.info("[LivestreamManager] Initializing livestream manager...");

    try {
      await this.initializeTables();

      this.setupP2PListeners();

      this.initialized = true;
      logger.info(
        "[LivestreamManager] Livestream manager initialized successfully",
      );
    } catch (error) {
      logger.error("[LivestreamManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS livestreams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        streamer_did TEXT NOT NULL,
        status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','live','ended','cancelled')),
        access_type TEXT DEFAULT 'public' CHECK(access_type IN ('public','friends','password','invite')),
        access_code TEXT,
        viewer_count INTEGER DEFAULT 0,
        max_viewers INTEGER DEFAULT 100,
        started_at INTEGER,
        ended_at INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_livestreams_streamer_did ON livestreams(streamer_did);
      CREATE INDEX IF NOT EXISTS idx_livestreams_status ON livestreams(status);
      CREATE INDEX IF NOT EXISTS idx_livestreams_created_at ON livestreams(created_at DESC);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS livestream_viewers (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        viewer_did TEXT NOT NULL,
        status TEXT DEFAULT 'watching' CHECK(status IN ('watching','left')),
        joined_at INTEGER,
        left_at INTEGER,
        UNIQUE(stream_id, viewer_did)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_livestream_viewers_stream_id ON livestream_viewers(stream_id);
      CREATE INDEX IF NOT EXISTS idx_livestream_viewers_viewer_did ON livestream_viewers(viewer_did);
    `);

    logger.info("[LivestreamManager] Database tables initialized");
  }

  /**
   * Set up P2P event listeners for stream synchronization
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    this.p2pManager.on("livestream:metadata", async ({ stream }) => {
      await this.handleStreamMetadataReceived(stream);
    });

    this.p2pManager.on(
      "livestream:viewer-update",
      async ({ streamId, viewerDid, action }) => {
        if (action === "joined") {
          await this.handleRemoteViewerJoined(streamId, viewerDid);
        } else if (action === "left") {
          await this.handleRemoteViewerLeft(streamId, viewerDid);
        }
      },
    );

    logger.info("[LivestreamManager] P2P event listeners set up");
  }

  /**
   * Create a new livestream
   * @param {Object} options - Stream options
   * @param {string} options.title - Stream title
   * @param {string} options.description - Stream description
   * @param {string} options.accessType - Access type
   * @param {string} options.accessCode - Access code for password-protected streams
   * @param {number} options.maxViewers - Maximum viewer count
   * @returns {Object} Created stream object
   */
  async createStream({
    title,
    description = "",
    accessType = StreamAccessType.PUBLIC,
    accessCode = null,
    maxViewers = 100,
  }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in, cannot create livestream");
      }

      if (!title || title.trim().length === 0) {
        throw new Error("Stream title cannot be empty");
      }

      if (title.length > 200) {
        throw new Error("Stream title cannot exceed 200 characters");
      }

      if (
        accessType === StreamAccessType.PASSWORD &&
        (!accessCode || accessCode.trim().length === 0)
      ) {
        throw new Error("Password-protected streams require an access code");
      }

      const streamId = uuidv4();
      const now = Date.now();

      const db = this.database.db;
      const stmt = db.prepare(`
        INSERT INTO livestreams
        (id, title, description, streamer_did, status, access_type, access_code, viewer_count, max_viewers, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        streamId,
        title.trim(),
        description.trim(),
        currentDid,
        StreamStatus.SCHEDULED,
        accessType,
        accessCode || null,
        0,
        maxViewers,
        now,
        now,
      );

      const stream = {
        id: streamId,
        title: title.trim(),
        description: description.trim(),
        streamer_did: currentDid,
        status: StreamStatus.SCHEDULED,
        access_type: accessType,
        access_code: accessCode || null,
        viewer_count: 0,
        max_viewers: maxViewers,
        started_at: null,
        ended_at: null,
        created_at: now,
        updated_at: now,
      };

      logger.info("[LivestreamManager] Stream created:", streamId);

      return stream;
    } catch (error) {
      logger.error("[LivestreamManager] Failed to create stream:", error);
      throw error;
    }
  }

  /**
   * Start a scheduled livestream
   * @param {string} streamId - Stream ID
   * @returns {Object} Updated stream object
   */
  async startStream(streamId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const stream = db
        .prepare("SELECT * FROM livestreams WHERE id = ?")
        .get(streamId);

      if (!stream) {
        throw new Error("Stream not found");
      }

      if (stream.streamer_did !== currentDid) {
        throw new Error("Only the streamer can start the stream");
      }

      if (stream.status !== StreamStatus.SCHEDULED) {
        throw new Error(
          `Cannot start stream with status: ${stream.status}`,
        );
      }

      const now = Date.now();

      db.prepare(
        "UPDATE livestreams SET status = ?, started_at = ?, updated_at = ? WHERE id = ?",
      ).run(StreamStatus.LIVE, now, now, streamId);

      const updatedStream = {
        ...stream,
        status: StreamStatus.LIVE,
        started_at: now,
        updated_at: now,
      };

      logger.info("[LivestreamManager] Stream started:", streamId);

      // Broadcast stream started to P2P network
      await this.broadcastStreamEvent(updatedStream, "started");

      this.emit("stream:started", { stream: updatedStream });

      return updatedStream;
    } catch (error) {
      logger.error("[LivestreamManager] Failed to start stream:", error);
      throw error;
    }
  }

  /**
   * End a live stream
   * @param {string} streamId - Stream ID
   * @returns {Object} Updated stream object
   */
  async endStream(streamId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const stream = db
        .prepare("SELECT * FROM livestreams WHERE id = ?")
        .get(streamId);

      if (!stream) {
        throw new Error("Stream not found");
      }

      if (stream.streamer_did !== currentDid) {
        throw new Error("Only the streamer can end the stream");
      }

      if (stream.status !== StreamStatus.LIVE) {
        throw new Error(
          `Cannot end stream with status: ${stream.status}`,
        );
      }

      const now = Date.now();

      // Mark all viewers as left
      db.prepare(
        "UPDATE livestream_viewers SET status = ?, left_at = ? WHERE stream_id = ? AND status = ?",
      ).run(ViewerStatus.LEFT, now, streamId, ViewerStatus.WATCHING);

      db.prepare(
        "UPDATE livestreams SET status = ?, ended_at = ?, viewer_count = 0, updated_at = ? WHERE id = ?",
      ).run(StreamStatus.ENDED, now, now, streamId);

      const updatedStream = {
        ...stream,
        status: StreamStatus.ENDED,
        ended_at: now,
        viewer_count: 0,
        updated_at: now,
      };

      logger.info("[LivestreamManager] Stream ended:", streamId);

      // Broadcast stream ended to P2P network
      await this.broadcastStreamEvent(updatedStream, "ended");

      this.emit("stream:ended", { stream: updatedStream });

      return updatedStream;
    } catch (error) {
      logger.error("[LivestreamManager] Failed to end stream:", error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled stream
   * @param {string} streamId - Stream ID
   * @returns {Object} Result
   */
  async cancelStream(streamId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const stream = db
        .prepare("SELECT * FROM livestreams WHERE id = ?")
        .get(streamId);

      if (!stream) {
        throw new Error("Stream not found");
      }

      if (stream.streamer_did !== currentDid) {
        throw new Error("Only the streamer can cancel the stream");
      }

      if (
        stream.status !== StreamStatus.SCHEDULED &&
        stream.status !== StreamStatus.LIVE
      ) {
        throw new Error(
          `Cannot cancel stream with status: ${stream.status}`,
        );
      }

      const now = Date.now();

      // If live, mark all viewers as left
      if (stream.status === StreamStatus.LIVE) {
        db.prepare(
          "UPDATE livestream_viewers SET status = ?, left_at = ? WHERE stream_id = ? AND status = ?",
        ).run(ViewerStatus.LEFT, now, streamId, ViewerStatus.WATCHING);
      }

      db.prepare(
        "UPDATE livestreams SET status = ?, viewer_count = 0, updated_at = ? WHERE id = ?",
      ).run(StreamStatus.CANCELLED, now, streamId);

      logger.info("[LivestreamManager] Stream cancelled:", streamId);

      return { success: true };
    } catch (error) {
      logger.error("[LivestreamManager] Failed to cancel stream:", error);
      throw error;
    }
  }

  /**
   * Join a livestream as a viewer
   * @param {string} streamId - Stream ID
   * @param {string} accessCode - Access code for password-protected streams
   * @returns {Object} Stream object
   */
  async joinStream(streamId, accessCode = null) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const stream = db
        .prepare("SELECT * FROM livestreams WHERE id = ?")
        .get(streamId);

      if (!stream) {
        throw new Error("Stream not found");
      }

      if (stream.status !== StreamStatus.LIVE) {
        throw new Error("Stream is not currently live");
      }

      // Check access permissions
      if (stream.access_type === StreamAccessType.PASSWORD) {
        if (!accessCode || accessCode !== stream.access_code) {
          throw new Error("Invalid access code");
        }
      }

      // Check max viewers
      if (stream.viewer_count >= stream.max_viewers) {
        throw new Error("Stream has reached maximum viewer capacity");
      }

      const now = Date.now();
      const viewerId = uuidv4();

      // Check if already watching (upsert)
      const existing = db
        .prepare(
          "SELECT * FROM livestream_viewers WHERE stream_id = ? AND viewer_did = ?",
        )
        .get(streamId, currentDid);

      if (existing && existing.status === ViewerStatus.WATCHING) {
        // Already watching, return the stream
        return stream;
      }

      if (existing) {
        // Re-join after leaving
        db.prepare(
          "UPDATE livestream_viewers SET status = ?, joined_at = ?, left_at = NULL WHERE stream_id = ? AND viewer_did = ?",
        ).run(ViewerStatus.WATCHING, now, streamId, currentDid);
      } else {
        db.prepare(
          "INSERT INTO livestream_viewers (id, stream_id, viewer_did, status, joined_at) VALUES (?, ?, ?, ?, ?)",
        ).run(viewerId, streamId, currentDid, ViewerStatus.WATCHING, now);
      }

      // Update viewer count
      const count = db
        .prepare(
          "SELECT COUNT(*) as count FROM livestream_viewers WHERE stream_id = ? AND status = ?",
        )
        .get(streamId, ViewerStatus.WATCHING);

      db.prepare(
        "UPDATE livestreams SET viewer_count = ?, updated_at = ? WHERE id = ?",
      ).run(count.count, now, streamId);

      logger.info(
        "[LivestreamManager] Viewer joined stream:",
        streamId,
        currentDid,
      );

      // Broadcast viewer joined
      await this.broadcastViewerEvent(streamId, currentDid, "joined");

      this.emit("viewer:joined", {
        streamId,
        viewerDid: currentDid,
        viewerCount: count.count,
      });
      this.emit("viewer:count-updated", {
        streamId,
        count: count.count,
      });

      return {
        ...stream,
        viewer_count: count.count,
      };
    } catch (error) {
      logger.error("[LivestreamManager] Failed to join stream:", error);
      throw error;
    }
  }

  /**
   * Leave a livestream
   * @param {string} streamId - Stream ID
   * @returns {Object} Result
   */
  async leaveStream(streamId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const now = Date.now();

      const result = db
        .prepare(
          "UPDATE livestream_viewers SET status = ?, left_at = ? WHERE stream_id = ? AND viewer_did = ? AND status = ?",
        )
        .run(
          ViewerStatus.LEFT,
          now,
          streamId,
          currentDid,
          ViewerStatus.WATCHING,
        );

      if (result.changes === 0) {
        return { success: true }; // Not watching, nothing to do
      }

      // Update viewer count
      const count = db
        .prepare(
          "SELECT COUNT(*) as count FROM livestream_viewers WHERE stream_id = ? AND status = ?",
        )
        .get(streamId, ViewerStatus.WATCHING);

      db.prepare(
        "UPDATE livestreams SET viewer_count = ?, updated_at = ? WHERE id = ?",
      ).run(count.count, now, streamId);

      logger.info(
        "[LivestreamManager] Viewer left stream:",
        streamId,
        currentDid,
      );

      // Broadcast viewer left
      await this.broadcastViewerEvent(streamId, currentDid, "left");

      this.emit("viewer:left", {
        streamId,
        viewerDid: currentDid,
        viewerCount: count.count,
      });
      this.emit("viewer:count-updated", {
        streamId,
        count: count.count,
      });

      return { success: true };
    } catch (error) {
      logger.error("[LivestreamManager] Failed to leave stream:", error);
      throw error;
    }
  }

  /**
   * Get all active (live) streams
   * @returns {Array} List of active streams
   */
  async getActiveStreams() {
    try {
      const db = this.database.db;
      const streams = db
        .prepare(
          "SELECT * FROM livestreams WHERE status = ? ORDER BY started_at DESC",
        )
        .all(StreamStatus.LIVE);

      return streams || [];
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to get active streams:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get a stream by ID
   * @param {string} streamId - Stream ID
   * @returns {Object|null} Stream object or null
   */
  async getStreamById(streamId) {
    try {
      const db = this.database.db;
      const stream = db
        .prepare("SELECT * FROM livestreams WHERE id = ?")
        .get(streamId);

      return stream || null;
    } catch (error) {
      logger.error("[LivestreamManager] Failed to get stream:", error);
      throw error;
    }
  }

  /**
   * Get viewers of a stream
   * @param {string} streamId - Stream ID
   * @param {boolean} activeOnly - Only return active viewers
   * @returns {Array} List of viewers
   */
  async getViewers(streamId, activeOnly = true) {
    try {
      const db = this.database.db;

      let query =
        "SELECT * FROM livestream_viewers WHERE stream_id = ?";
      const params = [streamId];

      if (activeOnly) {
        query += " AND status = ?";
        params.push(ViewerStatus.WATCHING);
      }

      query += " ORDER BY joined_at DESC";

      const viewers = db.prepare(query).all(...params);

      return viewers || [];
    } catch (error) {
      logger.error("[LivestreamManager] Failed to get viewers:", error);
      throw error;
    }
  }

  /**
   * Get viewer count for a stream
   * @param {string} streamId - Stream ID
   * @returns {number} Viewer count
   */
  async getViewerCount(streamId) {
    try {
      const db = this.database.db;
      const result = db
        .prepare(
          "SELECT COUNT(*) as count FROM livestream_viewers WHERE stream_id = ? AND status = ?",
        )
        .get(streamId, ViewerStatus.WATCHING);

      return result ? result.count : 0;
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to get viewer count:",
        error,
      );
      return 0;
    }
  }

  /**
   * Update stream information
   * @param {string} streamId - Stream ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated stream
   */
  async updateStreamInfo(streamId, updates) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("Not logged in");
      }

      const db = this.database.db;
      const stream = db
        .prepare("SELECT * FROM livestreams WHERE id = ?")
        .get(streamId);

      if (!stream) {
        throw new Error("Stream not found");
      }

      if (stream.streamer_did !== currentDid) {
        throw new Error("Only the streamer can update stream info");
      }

      const allowedFields = [
        "title",
        "description",
        "access_type",
        "access_code",
        "max_viewers",
      ];
      const setClauses = [];
      const params = [];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          params.push(updates[field]);
        }
      }

      if (setClauses.length === 0) {
        return stream;
      }

      const now = Date.now();
      setClauses.push("updated_at = ?");
      params.push(now);
      params.push(streamId);

      db.prepare(
        `UPDATE livestreams SET ${setClauses.join(", ")} WHERE id = ?`,
      ).run(...params);

      const updatedStream = db
        .prepare("SELECT * FROM livestreams WHERE id = ?")
        .get(streamId);

      logger.info("[LivestreamManager] Stream info updated:", streamId);

      return updatedStream;
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to update stream info:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get streams created by the current user
   * @param {Object} options - Query options
   * @param {number} options.limit - Result limit
   * @param {number} options.offset - Result offset
   * @returns {Array} List of streams
   */
  async getMyStreams({ limit = 20, offset = 0 } = {}) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        return [];
      }

      const db = this.database.db;
      const streams = db
        .prepare(
          "SELECT * FROM livestreams WHERE streamer_did = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(currentDid, limit, offset);

      return streams || [];
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to get my streams:",
        error,
      );
      throw error;
    }
  }

  /**
   * Broadcast stream event to P2P network
   * @param {Object} stream - Stream object
   * @param {string} event - Event type (started, ended)
   */
  async broadcastStreamEvent(stream, event) {
    if (!this.p2pManager) {
      return;
    }

    try {
      const connectedPeers = this.p2pManager.getConnectedPeers
        ? this.p2pManager.getConnectedPeers()
        : [];

      for (const peer of connectedPeers) {
        try {
          await this.p2pManager.sendEncryptedMessage(
            peer.id || peer,
            JSON.stringify({
              type: "livestream:metadata",
              stream: {
                id: stream.id,
                title: stream.title,
                description: stream.description,
                streamer_did: stream.streamer_did,
                status: stream.status,
                access_type: stream.access_type,
                viewer_count: stream.viewer_count,
                started_at: stream.started_at,
                ended_at: stream.ended_at,
              },
              event,
            }),
          );
        } catch (error) {
          logger.warn(
            "[LivestreamManager] Failed to broadcast to peer:",
            peer.id || peer,
            error.message,
          );
        }
      }

      logger.info(
        "[LivestreamManager] Stream event broadcast to",
        connectedPeers.length,
        "peers",
      );
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to broadcast stream event:",
        error,
      );
    }
  }

  /**
   * Broadcast viewer event to P2P network
   * @param {string} streamId - Stream ID
   * @param {string} viewerDid - Viewer DID
   * @param {string} action - Action (joined, left)
   */
  async broadcastViewerEvent(streamId, viewerDid, action) {
    if (!this.p2pManager) {
      return;
    }

    try {
      const db = this.database.db;
      const stream = db
        .prepare("SELECT streamer_did FROM livestreams WHERE id = ?")
        .get(streamId);

      if (stream && stream.streamer_did) {
        await this.p2pManager.sendEncryptedMessage(
          stream.streamer_did,
          JSON.stringify({
            type: "livestream:viewer-update",
            streamId,
            viewerDid,
            action,
          }),
        );
      }
    } catch (error) {
      logger.warn(
        "[LivestreamManager] Failed to broadcast viewer event:",
        error.message,
      );
    }
  }

  /**
   * Handle stream metadata received from P2P network
   * @param {Object} stream - Stream metadata
   */
  async handleStreamMetadataReceived(stream) {
    try {
      if (!stream || !stream.id) {
        return;
      }

      const db = this.database.db;
      const existing = db
        .prepare("SELECT id FROM livestreams WHERE id = ?")
        .get(stream.id);

      if (existing) {
        // Update existing stream
        db.prepare(
          "UPDATE livestreams SET status = ?, viewer_count = ?, updated_at = ? WHERE id = ?",
        ).run(
          stream.status,
          stream.viewer_count || 0,
          Date.now(),
          stream.id,
        );
      } else {
        // Insert new stream from remote
        const now = Date.now();
        db.prepare(`
          INSERT OR IGNORE INTO livestreams
          (id, title, description, streamer_did, status, access_type, viewer_count, started_at, ended_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          stream.id,
          stream.title,
          stream.description || "",
          stream.streamer_did,
          stream.status,
          stream.access_type || StreamAccessType.PUBLIC,
          stream.viewer_count || 0,
          stream.started_at || null,
          stream.ended_at || null,
          now,
          now,
        );
      }

      logger.info(
        "[LivestreamManager] Stream metadata received:",
        stream.id,
      );
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to handle stream metadata:",
        error,
      );
    }
  }

  /**
   * Handle remote viewer joined event
   * @param {string} streamId - Stream ID
   * @param {string} viewerDid - Viewer DID
   */
  async handleRemoteViewerJoined(streamId, viewerDid) {
    try {
      const db = this.database.db;
      const now = Date.now();
      const viewerId = uuidv4();

      const existing = db
        .prepare(
          "SELECT * FROM livestream_viewers WHERE stream_id = ? AND viewer_did = ?",
        )
        .get(streamId, viewerDid);

      if (existing && existing.status === ViewerStatus.WATCHING) {
        return;
      }

      if (existing) {
        db.prepare(
          "UPDATE livestream_viewers SET status = ?, joined_at = ?, left_at = NULL WHERE stream_id = ? AND viewer_did = ?",
        ).run(ViewerStatus.WATCHING, now, streamId, viewerDid);
      } else {
        db.prepare(
          "INSERT OR IGNORE INTO livestream_viewers (id, stream_id, viewer_did, status, joined_at) VALUES (?, ?, ?, ?, ?)",
        ).run(
          viewerId,
          streamId,
          viewerDid,
          ViewerStatus.WATCHING,
          now,
        );
      }

      // Recalculate viewer count
      const count = db
        .prepare(
          "SELECT COUNT(*) as count FROM livestream_viewers WHERE stream_id = ? AND status = ?",
        )
        .get(streamId, ViewerStatus.WATCHING);

      db.prepare(
        "UPDATE livestreams SET viewer_count = ?, updated_at = ? WHERE id = ?",
      ).run(count.count, now, streamId);

      this.emit("viewer:joined", {
        streamId,
        viewerDid,
        viewerCount: count.count,
      });
      this.emit("viewer:count-updated", {
        streamId,
        count: count.count,
      });
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to handle remote viewer joined:",
        error,
      );
    }
  }

  /**
   * Handle remote viewer left event
   * @param {string} streamId - Stream ID
   * @param {string} viewerDid - Viewer DID
   */
  async handleRemoteViewerLeft(streamId, viewerDid) {
    try {
      const db = this.database.db;
      const now = Date.now();

      db.prepare(
        "UPDATE livestream_viewers SET status = ?, left_at = ? WHERE stream_id = ? AND viewer_did = ? AND status = ?",
      ).run(ViewerStatus.LEFT, now, streamId, viewerDid, ViewerStatus.WATCHING);

      // Recalculate viewer count
      const count = db
        .prepare(
          "SELECT COUNT(*) as count FROM livestream_viewers WHERE stream_id = ? AND status = ?",
        )
        .get(streamId, ViewerStatus.WATCHING);

      db.prepare(
        "UPDATE livestreams SET viewer_count = ?, updated_at = ? WHERE id = ?",
      ).run(count.count, now, streamId);

      this.emit("viewer:left", {
        streamId,
        viewerDid,
        viewerCount: count.count,
      });
      this.emit("viewer:count-updated", {
        streamId,
        count: count.count,
      });
    } catch (error) {
      logger.error(
        "[LivestreamManager] Failed to handle remote viewer left:",
        error,
      );
    }
  }

  /**
   * Close the livestream manager
   */
  async close() {
    logger.info("[LivestreamManager] Closing livestream manager");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  LivestreamManager,
  StreamStatus,
  StreamAccessType,
  ViewerStatus,
};
