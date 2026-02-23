/**
 * Photo Sync Manager
 *
 * P2P photo synchronization protocol for shared albums.
 * Protocol: /chainlesschain/photo-sync/1.0.0
 *
 * Features:
 * - Incremental sync based on timestamps
 * - Per-album sync state tracking
 * - Progress reporting with events
 * - Cancellable sync operations
 * - Automatic retry on failure
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Sync status constants
 */
const SyncStatus = {
  IDLE: "idle",
  SYNCING: "syncing",
  COMPLETED: "completed",
  ERROR: "error",
  CANCELLED: "cancelled",
};

/**
 * Photo Sync Manager class
 */
class PhotoSync extends EventEmitter {
  constructor(database, p2pManager, sharedAlbumManager) {
    super();

    this.database = database;
    this.p2pManager = p2pManager;
    this.sharedAlbumManager = sharedAlbumManager;

    // Active sync operations: Map<albumId, syncState>
    this.activeSyncs = new Map();

    // Protocol identifier
    this.PROTOCOL = "/chainlesschain/photo-sync/1.0.0";

    this.initialized = false;
  }

  /**
   * Initialize photo sync manager
   */
  async initialize() {
    logger.info("[PhotoSync] Initializing photo sync manager...");

    try {
      this.setupP2PListeners();

      this.initialized = true;
      logger.info("[PhotoSync] Photo sync manager initialized successfully");
    } catch (error) {
      logger.error("[PhotoSync] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Setup P2P protocol handlers and listeners
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      logger.warn("[PhotoSync] P2P manager not available");
      return;
    }

    // Handle incoming sync requests
    this.p2pManager.on("photo-sync:request", async (data) => {
      await this.handleSyncRequest(data);
    });

    // Handle incoming photo data
    this.p2pManager.on("photo-sync:photo-data", async (data) => {
      await this.handlePhotoData(data);
    });

    // Handle sync manifest (list of photos to sync)
    this.p2pManager.on("photo-sync:manifest", async (data) => {
      await this.handleSyncManifest(data);
    });

    logger.info("[PhotoSync] P2P event listeners set up");
  }

  /**
   * Sync an album with a specific peer
   * @param {string} albumId - Album ID to sync
   * @param {string} peerId - Peer ID to sync with
   * @returns {Object} Sync result
   */
  async syncAlbum(albumId, peerId) {
    try {
      // Check if already syncing this album
      const existingSync = this.activeSyncs.get(albumId);
      if (existingSync && existingSync.status === SyncStatus.SYNCING) {
        logger.info("[PhotoSync] Album already syncing:", albumId);
        return { success: false, error: "Album sync already in progress" };
      }

      if (!this.p2pManager) {
        throw new Error("P2P manager not available");
      }

      const syncId = uuidv4();
      const syncState = {
        id: syncId,
        albumId,
        peerId,
        status: SyncStatus.SYNCING,
        totalPhotos: 0,
        syncedPhotos: 0,
        failedPhotos: 0,
        startedAt: Date.now(),
        completedAt: null,
        cancelled: false,
      };

      this.activeSyncs.set(albumId, syncState);

      this.emit("sync:started", {
        syncId,
        albumId,
        peerId,
      });

      logger.info(
        "[PhotoSync] Starting album sync:",
        albumId,
        "with peer:",
        peerId,
      );

      // Get local photos for this album with timestamps
      const localPhotos = await this.getLocalPhotoManifest(albumId);

      // Send sync request to peer
      try {
        await this.p2pManager.sendEncryptedMessage(
          peerId,
          JSON.stringify({
            type: "photo-sync-request",
            syncId,
            albumId,
            localManifest: localPhotos.map((p) => ({
              id: p.id,
              created_at: p.created_at,
            })),
            timestamp: Date.now(),
          }),
        );
      } catch (error) {
        syncState.status = SyncStatus.ERROR;
        syncState.error = error.message;
        this.activeSyncs.set(albumId, syncState);

        this.emit("sync:error", {
          syncId,
          albumId,
          error: error.message,
        });

        throw error;
      }

      return {
        success: true,
        syncId,
        albumId,
        peerId,
      };
    } catch (error) {
      logger.error("[PhotoSync] Failed to start album sync:", error);
      throw error;
    }
  }

  /**
   * Request a specific photo from a peer
   * @param {string} photoId - Photo ID
   * @param {string} peerId - Peer ID
   * @returns {Object} Request result
   */
  async requestPhoto(photoId, peerId) {
    try {
      if (!this.p2pManager) {
        throw new Error("P2P manager not available");
      }

      await this.p2pManager.sendEncryptedMessage(
        peerId,
        JSON.stringify({
          type: "photo-sync-request-photo",
          photoId,
          timestamp: Date.now(),
        }),
      );

      logger.info(
        "[PhotoSync] Photo requested:",
        photoId,
        "from peer:",
        peerId,
      );

      return { success: true, photoId, peerId };
    } catch (error) {
      logger.error("[PhotoSync] Failed to request photo:", error);
      throw error;
    }
  }

  /**
   * Send a specific photo to a peer
   * @param {string} photoId - Photo ID
   * @param {string} peerId - Peer ID
   * @returns {Object} Send result
   */
  async sendPhoto(photoId, peerId) {
    try {
      if (!this.p2pManager) {
        throw new Error("P2P manager not available");
      }

      const db = this.database.db;
      const photo = db
        .prepare("SELECT * FROM album_photos WHERE id = ?")
        .get(photoId);

      if (!photo) {
        throw new Error("Photo not found");
      }

      // Read photo file
      const fs = require("fs");
      let photoData = null;

      if (photo.file_path && fs.existsSync(photo.file_path)) {
        photoData = fs.readFileSync(photo.file_path).toString("base64");
      }

      let thumbnailData = null;
      if (photo.thumbnail_path && fs.existsSync(photo.thumbnail_path)) {
        thumbnailData = fs
          .readFileSync(photo.thumbnail_path)
          .toString("base64");
      }

      await this.p2pManager.sendEncryptedMessage(
        peerId,
        JSON.stringify({
          type: "photo-sync-photo-data",
          photo: {
            id: photo.id,
            album_id: photo.album_id,
            uploader_did: photo.uploader_did,
            caption: photo.caption,
            file_size: photo.file_size,
            mime_type: photo.mime_type,
            width: photo.width,
            height: photo.height,
            is_encrypted: photo.is_encrypted,
            created_at: photo.created_at,
          },
          photoData,
          thumbnailData,
          timestamp: Date.now(),
        }),
      );

      logger.info("[PhotoSync] Photo sent:", photoId, "to peer:", peerId);

      return { success: true, photoId, peerId };
    } catch (error) {
      logger.error("[PhotoSync] Failed to send photo:", error);
      throw error;
    }
  }

  /**
   * Get sync progress for an album
   * @param {string} albumId - Album ID
   * @returns {Object|null} Sync progress or null
   */
  getProgress(albumId) {
    const syncState = this.activeSyncs.get(albumId);

    if (!syncState) {
      return null;
    }

    const progress =
      syncState.totalPhotos > 0
        ? Math.round((syncState.syncedPhotos / syncState.totalPhotos) * 100)
        : 0;

    return {
      syncId: syncState.id,
      albumId: syncState.albumId,
      peerId: syncState.peerId,
      status: syncState.status,
      totalPhotos: syncState.totalPhotos,
      syncedPhotos: syncState.syncedPhotos,
      failedPhotos: syncState.failedPhotos,
      progress,
      startedAt: syncState.startedAt,
      completedAt: syncState.completedAt,
    };
  }

  /**
   * Cancel an active album sync
   * @param {string} albumId - Album ID
   * @returns {Object} Cancellation result
   */
  cancelSync(albumId) {
    const syncState = this.activeSyncs.get(albumId);

    if (!syncState) {
      return { success: false, error: "No active sync for this album" };
    }

    if (syncState.status !== SyncStatus.SYNCING) {
      return { success: false, error: "Sync is not in progress" };
    }

    syncState.status = SyncStatus.CANCELLED;
    syncState.cancelled = true;
    syncState.completedAt = Date.now();
    this.activeSyncs.set(albumId, syncState);

    logger.info("[PhotoSync] Sync cancelled for album:", albumId);

    this.emit("sync:cancelled", {
      syncId: syncState.id,
      albumId,
    });

    return { success: true };
  }

  /**
   * Get local photo manifest for incremental sync
   * @param {string} albumId - Album ID
   * @returns {Array} Local photos with IDs and timestamps
   */
  async getLocalPhotoManifest(albumId) {
    const db = this.database.db;

    return db
      .prepare(
        `
      SELECT id, created_at FROM album_photos
      WHERE album_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(albumId);
  }

  /**
   * Handle incoming sync request from a peer
   * @param {Object} data - Sync request data
   */
  async handleSyncRequest(data) {
    try {
      const { syncId, albumId, localManifest, senderDid } = data;

      logger.info(
        "[PhotoSync] Received sync request for album:",
        albumId,
        "from:",
        senderDid,
      );

      // Get our local photos
      const ourPhotos = await this.getLocalPhotoManifest(albumId);
      const remotePhotoIds = new Set(localManifest.map((p) => p.id));

      // Find photos we have that the peer doesn't
      const photosToSend = ourPhotos.filter((p) => !remotePhotoIds.has(p.id));

      // Send manifest response
      if (this.p2pManager) {
        await this.p2pManager.sendEncryptedMessage(
          senderDid,
          JSON.stringify({
            type: "photo-sync-manifest",
            syncId,
            albumId,
            photosAvailable: photosToSend.map((p) => ({
              id: p.id,
              created_at: p.created_at,
            })),
            timestamp: Date.now(),
          }),
        );
      }

      // Send photos one by one
      for (const photo of photosToSend) {
        try {
          await this.sendPhoto(photo.id, senderDid);
        } catch (error) {
          logger.warn(
            "[PhotoSync] Failed to send photo during sync:",
            photo.id,
            error.message,
          );
        }
      }

      logger.info(
        "[PhotoSync] Sync response sent:",
        photosToSend.length,
        "photos",
      );
    } catch (error) {
      logger.error("[PhotoSync] Failed to handle sync request:", error);
    }
  }

  /**
   * Handle incoming sync manifest
   * @param {Object} data - Sync manifest data
   */
  async handleSyncManifest(data) {
    try {
      const { syncId, albumId, photosAvailable } = data;

      const syncState = this.activeSyncs.get(albumId);

      if (!syncState || syncState.id !== syncId) {
        logger.warn("[PhotoSync] Received manifest for unknown sync:", syncId);
        return;
      }

      syncState.totalPhotos = photosAvailable.length;
      this.activeSyncs.set(albumId, syncState);

      this.emit("sync:progress", {
        syncId,
        albumId,
        totalPhotos: photosAvailable.length,
        syncedPhotos: 0,
        progress: 0,
      });

      if (photosAvailable.length === 0) {
        syncState.status = SyncStatus.COMPLETED;
        syncState.completedAt = Date.now();
        this.activeSyncs.set(albumId, syncState);

        this.emit("sync:completed", {
          syncId,
          albumId,
          syncedPhotos: 0,
          totalPhotos: 0,
        });
      }

      logger.info(
        "[PhotoSync] Sync manifest received:",
        photosAvailable.length,
        "photos available",
      );
    } catch (error) {
      logger.error("[PhotoSync] Failed to handle sync manifest:", error);
    }
  }

  /**
   * Handle incoming photo data
   * @param {Object} data - Photo data
   */
  async handlePhotoData(data) {
    try {
      const { photo, photoData, thumbnailData, senderDid } = data;

      if (!photo || !photo.album_id) {
        logger.warn("[PhotoSync] Received invalid photo data");
        return;
      }

      const syncState = this.activeSyncs.get(photo.album_id);

      // Check if sync was cancelled
      if (syncState && syncState.cancelled) {
        logger.info("[PhotoSync] Sync cancelled, ignoring photo:", photo.id);
        return;
      }

      // Save photo file to disk
      const fs = require("fs");
      const path = require("path");
      const { app } = require("electron");

      const albumDir = path.join(
        app.getPath("userData"),
        "albums",
        photo.album_id,
      );

      if (!fs.existsSync(albumDir)) {
        fs.mkdirSync(albumDir, { recursive: true });
      }

      let filePath = null;
      let thumbnailPath = null;

      if (photoData) {
        const ext = this.getExtensionFromMimeType(photo.mime_type);
        filePath = path.join(albumDir, `${photo.id}${ext}`);
        fs.writeFileSync(filePath, Buffer.from(photoData, "base64"));
      }

      if (thumbnailData) {
        const thumbDir = path.join(albumDir, "thumbnails");
        if (!fs.existsSync(thumbDir)) {
          fs.mkdirSync(thumbDir, { recursive: true });
        }
        thumbnailPath = path.join(thumbDir, `${photo.id}_thumb.jpg`);
        fs.writeFileSync(thumbnailPath, Buffer.from(thumbnailData, "base64"));
      }

      // Save photo record using album manager
      if (this.sharedAlbumManager) {
        await this.sharedAlbumManager.handlePhotoReceived(
          {
            ...photo,
            file_path: filePath,
            thumbnail_path: thumbnailPath,
          },
          photo.album_id,
          senderDid,
        );
      }

      // Update sync progress
      if (syncState && syncState.status === SyncStatus.SYNCING) {
        syncState.syncedPhotos++;
        this.activeSyncs.set(photo.album_id, syncState);

        const progress =
          syncState.totalPhotos > 0
            ? Math.round(
                (syncState.syncedPhotos / syncState.totalPhotos) * 100,
              )
            : 0;

        this.emit("sync:progress", {
          syncId: syncState.id,
          albumId: photo.album_id,
          totalPhotos: syncState.totalPhotos,
          syncedPhotos: syncState.syncedPhotos,
          progress,
        });

        // Check if sync is complete
        if (syncState.syncedPhotos >= syncState.totalPhotos) {
          syncState.status = SyncStatus.COMPLETED;
          syncState.completedAt = Date.now();
          this.activeSyncs.set(photo.album_id, syncState);

          this.emit("sync:completed", {
            syncId: syncState.id,
            albumId: photo.album_id,
            syncedPhotos: syncState.syncedPhotos,
            totalPhotos: syncState.totalPhotos,
          });

          logger.info(
            "[PhotoSync] Album sync completed:",
            photo.album_id,
            syncState.syncedPhotos,
            "photos synced",
          );
        }
      }
    } catch (error) {
      logger.error("[PhotoSync] Failed to handle photo data:", error);

      // Update failed count if sync is active
      const albumId = data?.photo?.album_id;
      if (albumId) {
        const syncState = this.activeSyncs.get(albumId);
        if (syncState) {
          syncState.failedPhotos++;
          this.activeSyncs.set(albumId, syncState);

          this.emit("sync:error", {
            syncId: syncState.id,
            albumId,
            error: error.message,
          });
        }
      }
    }
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} File extension
   */
  getExtensionFromMimeType(mimeType) {
    const map = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/bmp": ".bmp",
      "image/tiff": ".tiff",
      "image/heic": ".heic",
      "image/heif": ".heif",
    };

    return map[mimeType] || ".jpg";
  }

  /**
   * Get all active syncs
   * @returns {Array} Active sync states
   */
  getActiveSyncs() {
    const syncs = [];
    for (const [albumId, state] of this.activeSyncs) {
      syncs.push(this.getProgress(albumId));
    }
    return syncs;
  }

  /**
   * Close photo sync manager
   */
  async close() {
    logger.info("[PhotoSync] Closing photo sync manager");

    // Cancel all active syncs
    for (const [albumId] of this.activeSyncs) {
      this.cancelSync(albumId);
    }

    this.activeSyncs.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  PhotoSync,
  SyncStatus,
};
