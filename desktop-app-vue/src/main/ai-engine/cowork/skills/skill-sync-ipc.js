/**
 * Skill Sync IPC Handlers
 *
 * 7 IPC handlers for cross-device skill synchronization and migration.
 *
 * @module ai-engine/cowork/skills/skill-sync-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../../../utils/logger.js");

let syncManager = null;

/**
 * Register skill sync IPC handlers
 * @param {Object} options
 * @param {import('./skill-sync-manager').SkillSyncManager} options.syncManager
 */
function registerSkillSyncIPC(options = {}) {
  syncManager = options.syncManager || null;

  logger.info("[SkillSyncIPC] Registering 7 handlers...");

  // 1. Export skill to transferable package
  ipcMain.handle("skills:sync:export", async (_event, { skillId }) => {
    try {
      if (!syncManager) {
        return { success: false, error: "SyncManager not initialized" };
      }
      const pkg = syncManager.exportSkill(skillId);
      return { success: true, data: pkg };
    } catch (error) {
      logger.error("[SkillSyncIPC] export error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 2. Import skill package
  ipcMain.handle("skills:sync:import", async (_event, { package: pkg }) => {
    try {
      if (!syncManager) {
        return { success: false, error: "SyncManager not initialized" };
      }
      const result = syncManager.importSkill(pkg);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SkillSyncIPC] import error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 3. Get skills from connected peer
  ipcMain.handle(
    "skills:sync:get-peer-catalog",
    async (_event, { peerId }) => {
      try {
        if (!syncManager) {
          return { success: false, error: "SyncManager not initialized" };
        }
        await syncManager.requestPeerCatalog(peerId);
        return { success: true, message: "Catalog request sent" };
      } catch (error) {
        logger.error(
          "[SkillSyncIPC] get-peer-catalog error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 4. Download specific skill from peer
  ipcMain.handle(
    "skills:sync:download-from-peer",
    async (_event, { peerId, skillId }) => {
      try {
        if (!syncManager) {
          return { success: false, error: "SyncManager not initialized" };
        }
        await syncManager.downloadFromPeer(peerId, skillId);
        return { success: true, message: "Download request sent" };
      } catch (error) {
        logger.error(
          "[SkillSyncIPC] download-from-peer error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 5. Broadcast local catalog to all peers
  ipcMain.handle("skills:sync:broadcast-catalog", async () => {
    try {
      if (!syncManager) {
        return { success: false, error: "SyncManager not initialized" };
      }
      const result = await syncManager.broadcastCatalog();
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[SkillSyncIPC] broadcast-catalog error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 6. Get sync status
  ipcMain.handle("skills:sync:get-sync-status", async () => {
    try {
      if (!syncManager) {
        return { success: false, error: "SyncManager not initialized" };
      }
      const status = syncManager.getSyncStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error(
        "[SkillSyncIPC] get-sync-status error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 7. Manual conflict resolution
  ipcMain.handle(
    "skills:sync:resolve-conflict",
    async (_event, { skillId, resolution, remotePkg }) => {
      try {
        if (!syncManager) {
          return { success: false, error: "SyncManager not initialized" };
        }
        const result = syncManager.resolveConflict(
          skillId,
          resolution,
          remotePkg,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[SkillSyncIPC] resolve-conflict error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  logger.info("[SkillSyncIPC] ✓ 7 handlers registered");
}

module.exports = { registerSkillSyncIPC };
