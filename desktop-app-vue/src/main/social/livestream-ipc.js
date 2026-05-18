/**
 * Livestream IPC Handlers
 *
 * Registers IPC handlers for livestream and danmaku operations.
 * Bridges renderer process requests to LivestreamManager and DanmakuEngine.
 *
 * @module livestream-ipc
 * @version 0.44.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register all Livestream IPC handlers
 * @param {Object} dependencies - Dependency injection
 * @param {Object} dependencies.livestreamManager - LivestreamManager instance
 * @param {Object} dependencies.danmakuEngine - DanmakuEngine instance
 */
function registerLivestreamIPC({ livestreamManager, danmakuEngine }) {
  logger.info("[Livestream IPC] Registering Livestream IPC handlers...");

  // ============================================================
  // Livestream Management - 9 handlers
  // ============================================================

  /**
   * Create a new livestream
   * Channel: 'livestream:create'
   */
  ipcMain.handle("livestream:create", async (_event, options) => {
    try {
      if (!livestreamManager) {
        throw new Error("Livestream manager not initialized");
      }

      return await livestreamManager.createStream(options);
    } catch (error) {
      logger.error("[Livestream IPC] Failed to create stream:", error);
      throw error;
    }
  });

  /**
   * Start a scheduled livestream
   * Channel: 'livestream:start'
   */
  ipcMain.handle("livestream:start", async (_event, streamId) => {
    try {
      if (!livestreamManager) {
        throw new Error("Livestream manager not initialized");
      }

      return await livestreamManager.startStream(streamId);
    } catch (error) {
      logger.error("[Livestream IPC] Failed to start stream:", error);
      throw error;
    }
  });

  /**
   * End a live stream
   * Channel: 'livestream:end'
   */
  ipcMain.handle("livestream:end", async (_event, streamId) => {
    try {
      if (!livestreamManager) {
        throw new Error("Livestream manager not initialized");
      }

      return await livestreamManager.endStream(streamId);
    } catch (error) {
      logger.error("[Livestream IPC] Failed to end stream:", error);
      throw error;
    }
  });

  /**
   * Join a livestream as a viewer
   * Channel: 'livestream:join'
   */
  ipcMain.handle(
    "livestream:join",
    async (_event, streamId, accessCode) => {
      try {
        if (!livestreamManager) {
          throw new Error("Livestream manager not initialized");
        }

        return await livestreamManager.joinStream(streamId, accessCode);
      } catch (error) {
        logger.error("[Livestream IPC] Failed to join stream:", error);
        throw error;
      }
    },
  );

  /**
   * Leave a livestream
   * Channel: 'livestream:leave'
   */
  ipcMain.handle("livestream:leave", async (_event, streamId) => {
    try {
      if (!livestreamManager) {
        throw new Error("Livestream manager not initialized");
      }

      return await livestreamManager.leaveStream(streamId);
    } catch (error) {
      logger.error("[Livestream IPC] Failed to leave stream:", error);
      throw error;
    }
  });

  /**
   * Get all active (live) streams
   * Channel: 'livestream:get-active'
   */
  ipcMain.handle("livestream:get-active", async () => {
    try {
      if (!livestreamManager) {
        return [];
      }

      return await livestreamManager.getActiveStreams();
    } catch (error) {
      logger.error(
        "[Livestream IPC] Failed to get active streams:",
        error,
      );
      return [];
    }
  });

  /**
   * Get a stream by ID
   * Channel: 'livestream:get-by-id'
   */
  ipcMain.handle("livestream:get-by-id", async (_event, streamId) => {
    try {
      if (!livestreamManager) {
        return null;
      }

      return await livestreamManager.getStreamById(streamId);
    } catch (error) {
      logger.error("[Livestream IPC] Failed to get stream:", error);
      return null;
    }
  });

  /**
   * Get viewers of a stream
   * Channel: 'livestream:get-viewers'
   */
  ipcMain.handle(
    "livestream:get-viewers",
    async (_event, streamId, activeOnly) => {
      try {
        if (!livestreamManager) {
          return [];
        }

        return await livestreamManager.getViewers(streamId, activeOnly);
      } catch (error) {
        logger.error("[Livestream IPC] Failed to get viewers:", error);
        return [];
      }
    },
  );

  /**
   * Get streams created by current user
   * Channel: 'livestream:get-my-streams'
   */
  ipcMain.handle("livestream:get-my-streams", async (_event, options) => {
    try {
      if (!livestreamManager) {
        return [];
      }

      return await livestreamManager.getMyStreams(options);
    } catch (error) {
      logger.error(
        "[Livestream IPC] Failed to get my streams:",
        error,
      );
      return [];
    }
  });

  // ============================================================
  // Danmaku (Bullet Chat) - 3 handlers
  // ============================================================

  /**
   * Send a danmaku message
   * Channel: 'danmaku:send'
   */
  ipcMain.handle(
    "danmaku:send",
    async (_event, { streamId, senderDid, content, options }) => {
      try {
        if (!danmakuEngine) {
          throw new Error("Danmaku engine not initialized");
        }

        return await danmakuEngine.sendDanmaku(
          streamId,
          senderDid,
          content,
          options,
        );
      } catch (error) {
        logger.error("[Livestream IPC] Failed to send danmaku:", error);
        throw error;
      }
    },
  );

  /**
   * Get danmaku history for a stream
   * Channel: 'danmaku:get-history'
   */
  ipcMain.handle(
    "danmaku:get-history",
    async (_event, streamId, limit, offset) => {
      try {
        if (!danmakuEngine) {
          return [];
        }

        return await danmakuEngine.getDanmakuHistory(
          streamId,
          limit,
          offset,
        );
      } catch (error) {
        logger.error(
          "[Livestream IPC] Failed to get danmaku history:",
          error,
        );
        return [];
      }
    },
  );

  /**
   * Moderate a danmaku message
   * Channel: 'danmaku:moderate'
   */
  ipcMain.handle(
    "danmaku:moderate",
    async (_event, danmakuId, action) => {
      try {
        if (!danmakuEngine) {
          throw new Error("Danmaku engine not initialized");
        }

        return await danmakuEngine.moderateDanmaku(danmakuId, action);
      } catch (error) {
        logger.error(
          "[Livestream IPC] Failed to moderate danmaku:",
          error,
        );
        throw error;
      }
    },
  );

  logger.info(
    "[Livestream IPC] All Livestream IPC handlers registered successfully (12 handlers)",
  );
}

module.exports = {
  registerLivestreamIPC,
};
