"use strict";

/**
 * IPFS IPC Handlers - Decentralized Storage
 *
 * Registers 18 IPC handlers for the IPFS subsystem.
 * All handlers follow the standard { success, data/error } response pattern.
 *
 * Channels:
 *  1. ipfs:initialize         - Initialize manager + start node
 *  2. ipfs:start-node         - Start IPFS node
 *  3. ipfs:stop-node          - Stop IPFS node
 *  4. ipfs:get-node-status    - Get current node status
 *  5. ipfs:add-content        - Add text/buffer content to IPFS
 *  6. ipfs:add-file           - Add file from disk to IPFS
 *  7. ipfs:get-content        - Retrieve content by CID
 *  8. ipfs:get-file           - Retrieve content and save to disk
 *  9. ipfs:pin                - Pin a CID
 * 10. ipfs:unpin              - Unpin a CID
 * 11. ipfs:list-pins          - List pinned content
 * 12. ipfs:get-storage-stats  - Get storage statistics
 * 13. ipfs:garbage-collect    - Run garbage collection
 * 14. ipfs:set-quota          - Set storage quota
 * 15. ipfs:set-mode           - Set operating mode
 * 16. ipfs:add-knowledge-attachment  - Add IPFS content linked to knowledge item
 * 17. ipfs:get-knowledge-attachment  - Retrieve IPFS content for knowledge item
 * 18. ipfs:get-config         - Get current IPFS configuration
 *
 * @module ipfs/ipfs-ipc
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { getIPFSManager } = require("./ipfs-manager.js");

/**
 * Register all IPFS IPC handlers
 * @param {Object} deps - Optional dependencies { database, config, ipcMain }
 */
function registerIPFSIPC(deps = {}) {
  const electron = require("electron");
  const ipcMain = deps.ipcMain || electron.ipcMain;
  const manager = deps.manager || getIPFSManager();

  // ----------------------------------------------------------
  // 1. ipfs:initialize
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:initialize", async (_event, config) => {
    try {
      await manager.initialize({
        database: deps.database || null,
        config: config || deps.config || {},
      });
      await manager.startNode();
      return {
        success: true,
        data: {
          mode: manager.mode,
          nodeStatus: manager.getNodeStatus(),
        },
      };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:initialize error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 2. ipfs:start-node
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:start-node", async () => {
    try {
      await manager.startNode();
      return {
        success: true,
        data: manager.getNodeStatus(),
      };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:start-node error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 3. ipfs:stop-node
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:stop-node", async () => {
    try {
      await manager.stopNode();
      return {
        success: true,
        data: manager.getNodeStatus(),
      };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:stop-node error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 4. ipfs:get-node-status
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:get-node-status", async () => {
    try {
      const status = manager.getNodeStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:get-node-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 5. ipfs:add-content
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:add-content", async (_event, { content, options }) => {
    try {
      const result = await manager.addContent(content, options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:add-content error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 6. ipfs:add-file
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:add-file", async (_event, { filePath, options }) => {
    try {
      const result = await manager.addFile(filePath, options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:add-file error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 7. ipfs:get-content
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:get-content", async (_event, { cid, options }) => {
    try {
      const result = await manager.getContent(cid, options || {});
      return {
        success: true,
        data: {
          // Convert Buffer to base64 for IPC transfer
          content: result.content.toString("base64"),
          contentEncoding: "base64",
          metadata: result.metadata,
        },
      };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:get-content error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 8. ipfs:get-file
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:get-file", async (_event, { cid, outputPath }) => {
    try {
      const result = await manager.getFile(cid, outputPath);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:get-file error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 9. ipfs:pin
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:pin", async (_event, cid) => {
    try {
      const result = await manager.pin(cid);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:pin error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 10. ipfs:unpin
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:unpin", async (_event, cid) => {
    try {
      const result = await manager.unpin(cid);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:unpin error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 11. ipfs:list-pins
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:list-pins", async (_event, options) => {
    try {
      const result = await manager.listPins(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:list-pins error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 12. ipfs:get-storage-stats
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:get-storage-stats", async () => {
    try {
      const stats = await manager.getStorageStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:get-storage-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 13. ipfs:garbage-collect
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:garbage-collect", async () => {
    try {
      const result = await manager.garbageCollect();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:garbage-collect error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 14. ipfs:set-quota
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:set-quota", async (_event, quotaBytes) => {
    try {
      await manager.setQuota(quotaBytes);
      return {
        success: true,
        data: { quotaBytes: manager.config.storageQuotaBytes },
      };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:set-quota error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 15. ipfs:set-mode
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:set-mode", async (_event, mode) => {
    try {
      await manager.setMode(mode);
      return {
        success: true,
        data: { mode: manager.mode, nodeStatus: manager.getNodeStatus() },
      };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:set-mode error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 16. ipfs:add-knowledge-attachment
  // ----------------------------------------------------------
  ipcMain.handle(
    "ipfs:add-knowledge-attachment",
    async (_event, { knowledgeId, content, metadata }) => {
      try {
        const result = await manager.addKnowledgeAttachment(
          knowledgeId,
          content,
          metadata || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[IPFS-IPC] ipfs:add-knowledge-attachment error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // ----------------------------------------------------------
  // 17. ipfs:get-knowledge-attachment
  // ----------------------------------------------------------
  ipcMain.handle(
    "ipfs:get-knowledge-attachment",
    async (_event, { knowledgeId, cid }) => {
      try {
        const result = await manager.getKnowledgeAttachment(knowledgeId, cid);
        return {
          success: true,
          data: {
            content: result.content.toString("base64"),
            contentEncoding: "base64",
            metadata: result.metadata,
          },
        };
      } catch (error) {
        logger.error(
          "[IPFS-IPC] ipfs:get-knowledge-attachment error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // ----------------------------------------------------------
  // 18. ipfs:get-config
  // ----------------------------------------------------------
  ipcMain.handle("ipfs:get-config", async () => {
    try {
      return {
        success: true,
        data: {
          gatewayUrl: manager.config.gatewayUrl,
          storageQuotaBytes: manager.config.storageQuotaBytes,
          externalApiUrl: manager.config.externalApiUrl,
          encryptionEnabled: manager.config.encryptionEnabled,
          mode: manager.mode,
        },
      };
    } catch (error) {
      logger.error("[IPFS-IPC] ipfs:get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[IPFS-IPC] Registered 18 IPC handlers");
}

module.exports = { registerIPFSIPC };
