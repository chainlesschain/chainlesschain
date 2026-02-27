/**
 * Album IPC Handlers
 *
 * Registers IPC handlers for shared album operations.
 * Handles communication between the renderer process and
 * album-related backend services.
 *
 * Channels:
 * - album:create, album:delete, album:update
 * - album:get-list, album:get-by-id
 * - album:add-photo, album:remove-photo, album:get-photos
 * - album:add-member, album:remove-member, album:get-members
 * - album:share
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register all Album IPC handlers
 * @param {Object} dependencies - Dependency injection
 * @param {Object} dependencies.sharedAlbumManager - Shared album manager
 * @param {Object} dependencies.photoEncryptor - Photo encryptor
 * @param {Object} dependencies.photoSync - Photo sync manager
 * @param {Object} dependencies.exifStripper - EXIF stripper
 */
function registerAlbumIPC({
  sharedAlbumManager,
  photoEncryptor,
  photoSync,
  exifStripper,
}) {
  logger.info("[Album IPC] Registering Album IPC handlers...");

  // ============================================================
  // Album CRUD (4 handlers)
  // ============================================================

  /**
   * Create a new album
   * Channel: 'album:create'
   */
  ipcMain.handle("album:create", async (_event, options) => {
    try {
      if (!sharedAlbumManager) {
        throw new Error("Shared album manager not initialized");
      }

      return await sharedAlbumManager.createAlbum(options);
    } catch (error) {
      logger.error("[Album IPC] Failed to create album:", error);
      throw error;
    }
  });

  /**
   * Delete an album
   * Channel: 'album:delete'
   */
  ipcMain.handle("album:delete", async (_event, albumId) => {
    try {
      if (!sharedAlbumManager) {
        throw new Error("Shared album manager not initialized");
      }

      return await sharedAlbumManager.deleteAlbum(albumId);
    } catch (error) {
      logger.error("[Album IPC] Failed to delete album:", error);
      throw error;
    }
  });

  /**
   * Update an album
   * Channel: 'album:update'
   */
  ipcMain.handle("album:update", async (_event, albumId, updates) => {
    try {
      if (!sharedAlbumManager) {
        throw new Error("Shared album manager not initialized");
      }

      return await sharedAlbumManager.updateAlbum(albumId, updates);
    } catch (error) {
      logger.error("[Album IPC] Failed to update album:", error);
      throw error;
    }
  });

  /**
   * Get list of albums
   * Channel: 'album:get-list'
   */
  ipcMain.handle("album:get-list", async (_event, options) => {
    try {
      if (!sharedAlbumManager) {
        return [];
      }

      return await sharedAlbumManager.getAlbums(options);
    } catch (error) {
      logger.error("[Album IPC] Failed to get album list:", error);
      return [];
    }
  });

  /**
   * Get a single album by ID
   * Channel: 'album:get-by-id'
   */
  ipcMain.handle("album:get-by-id", async (_event, albumId) => {
    try {
      if (!sharedAlbumManager) {
        return null;
      }

      return await sharedAlbumManager.getAlbumById(albumId);
    } catch (error) {
      logger.error("[Album IPC] Failed to get album:", error);
      return null;
    }
  });

  // ============================================================
  // Photo Management (3 handlers)
  // ============================================================

  /**
   * Add a photo to an album
   * Channel: 'album:add-photo'
   *
   * Accepts raw photo options. If exifStripper is available,
   * automatically strips EXIF data and generates thumbnails.
   */
  ipcMain.handle("album:add-photo", async (_event, options) => {
    try {
      if (!sharedAlbumManager) {
        throw new Error("Shared album manager not initialized");
      }

      const photoOptions = { ...options };

      // Process photo if exifStripper is available and we have a raw file path
      if (exifStripper && options.rawFilePath && !options.filePath) {
        try {
          const path = require("path");
          const { app } = require("electron");
          const outputDir = path.join(
            app.getPath("userData"),
            "albums",
            options.albumId,
          );

          const processed = await exifStripper.processForAlbum(
            options.rawFilePath,
            outputDir,
            {
              quality: options.quality || 85,
              thumbnailSize: options.thumbnailSize || 256,
            },
          );

          photoOptions.filePath = processed.filePath;
          photoOptions.thumbnailPath = processed.thumbnailPath;
          photoOptions.fileSize = processed.fileSize;
          photoOptions.width = processed.width;
          photoOptions.height = processed.height;
          photoOptions.mimeType = processed.mimeType;
        } catch (processError) {
          logger.warn(
            "[Album IPC] Failed to process photo, using raw file:",
            processError.message,
          );
          photoOptions.filePath = options.rawFilePath;
        }
      }

      return await sharedAlbumManager.addPhoto(photoOptions);
    } catch (error) {
      logger.error("[Album IPC] Failed to add photo:", error);
      throw error;
    }
  });

  /**
   * Remove a photo from an album
   * Channel: 'album:remove-photo'
   */
  ipcMain.handle("album:remove-photo", async (_event, photoId) => {
    try {
      if (!sharedAlbumManager) {
        throw new Error("Shared album manager not initialized");
      }

      return await sharedAlbumManager.removePhoto(photoId);
    } catch (error) {
      logger.error("[Album IPC] Failed to remove photo:", error);
      throw error;
    }
  });

  /**
   * Get photos in an album
   * Channel: 'album:get-photos'
   */
  ipcMain.handle("album:get-photos", async (_event, albumId, options) => {
    try {
      if (!sharedAlbumManager) {
        return [];
      }

      return await sharedAlbumManager.getPhotos(albumId, options);
    } catch (error) {
      logger.error("[Album IPC] Failed to get photos:", error);
      return [];
    }
  });

  // ============================================================
  // Member Management (3 handlers)
  // ============================================================

  /**
   * Add a member to an album
   * Channel: 'album:add-member'
   */
  ipcMain.handle(
    "album:add-member",
    async (_event, albumId, memberDid, role) => {
      try {
        if (!sharedAlbumManager) {
          throw new Error("Shared album manager not initialized");
        }

        return await sharedAlbumManager.addMember(albumId, memberDid, role);
      } catch (error) {
        logger.error("[Album IPC] Failed to add member:", error);
        throw error;
      }
    },
  );

  /**
   * Remove a member from an album
   * Channel: 'album:remove-member'
   */
  ipcMain.handle(
    "album:remove-member",
    async (_event, albumId, memberDid) => {
      try {
        if (!sharedAlbumManager) {
          throw new Error("Shared album manager not initialized");
        }

        return await sharedAlbumManager.removeMember(albumId, memberDid);
      } catch (error) {
        logger.error("[Album IPC] Failed to remove member:", error);
        throw error;
      }
    },
  );

  /**
   * Get members of an album
   * Channel: 'album:get-members'
   */
  ipcMain.handle("album:get-members", async (_event, albumId) => {
    try {
      if (!sharedAlbumManager) {
        return [];
      }

      return await sharedAlbumManager.getMembers(albumId);
    } catch (error) {
      logger.error("[Album IPC] Failed to get members:", error);
      return [];
    }
  });

  // ============================================================
  // Album Sharing (1 handler)
  // ============================================================

  /**
   * Share an album via P2P
   * Channel: 'album:share'
   */
  ipcMain.handle("album:share", async (_event, albumId, targetDids) => {
    try {
      if (!sharedAlbumManager) {
        throw new Error("Shared album manager not initialized");
      }

      return await sharedAlbumManager.shareAlbum(albumId, targetDids);
    } catch (error) {
      logger.error("[Album IPC] Failed to share album:", error);
      throw error;
    }
  });

  logger.info(
    "[Album IPC] All Album IPC handlers registered successfully (12 handlers)",
  );
}

module.exports = {
  registerAlbumIPC,
};
