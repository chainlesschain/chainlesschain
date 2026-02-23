/**
 * Git P2P IPC Handlers
 * 15 IPC handlers for P2P Git sync operations
 *
 * @module git/git-p2p-ipc
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");
const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all Git P2P IPC handlers
 * @param {Object} dependencies
 * @param {Object} [dependencies.p2pGitSync] - P2PGitSync instance
 * @param {Object} [dependencies.deviceDiscovery] - DeviceDiscoveryManager instance
 * @param {Object} [dependencies.mainWindow] - Electron main window
 */
function registerGitP2PIPC({ p2pGitSync, deviceDiscovery, mainWindow }) {
  if (ipcGuard.isModuleRegistered("git-p2p-ipc")) {
    logger.info("[Git P2P IPC] Handlers already registered, skipping...");
    return;
  }

  logger.info("[Git P2P IPC] Registering Git P2P IPC handlers...");

  // ============================================================
  // Status & Configuration
  // ============================================================

  /**
   * Get P2P Git sync status
   * Channel: 'git-p2p:status'
   */
  ipcMain.handle("git-p2p:status", async () => {
    try {
      if (!p2pGitSync) {
        return { enabled: false, error: "P2P Git sync not initialized" };
      }
      return { success: true, ...p2pGitSync.getStatus() };
    } catch (error) {
      logger.error("[Git P2P IPC] Status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Set P2P Git sync configuration
   * Channel: 'git-p2p:set-config'
   */
  ipcMain.handle("git-p2p:set-config", async (_event, config) => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      p2pGitSync.setConfig(config);
      return { success: true };
    } catch (error) {
      logger.error("[Git P2P IPC] Set config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get P2P Git sync configuration
   * Channel: 'git-p2p:get-config'
   */
  ipcMain.handle("git-p2p:get-config", async () => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      return { success: true, config: p2pGitSync.config };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Enable / Disable
  // ============================================================

  /**
   * Enable P2P Git sync
   * Channel: 'git-p2p:enable'
   */
  ipcMain.handle("git-p2p:enable", async () => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      p2pGitSync.enable();
      return { success: true };
    } catch (error) {
      logger.error("[Git P2P IPC] Enable error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Disable P2P Git sync
   * Channel: 'git-p2p:disable'
   */
  ipcMain.handle("git-p2p:disable", async () => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      p2pGitSync.disable();
      return { success: true };
    } catch (error) {
      logger.error("[Git P2P IPC] Disable error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Sync Operations
  // ============================================================

  /**
   * Sync with a specific peer
   * Channel: 'git-p2p:sync-peer'
   */
  ipcMain.handle("git-p2p:sync-peer", async (_event, { peerId, options }) => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      const result = await p2pGitSync.syncWithPeer(peerId, options || {});
      return { success: true, result };
    } catch (error) {
      logger.error("[Git P2P IPC] Sync peer error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Sync with all connected peers
   * Channel: 'git-p2p:sync-all'
   */
  ipcMain.handle("git-p2p:sync-all", async (_event, options) => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      const results = await p2pGitSync.syncAll(options || {});
      return { success: true, results };
    } catch (error) {
      logger.error("[Git P2P IPC] Sync all error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get sync history
   * Channel: 'git-p2p:get-sync-history'
   */
  ipcMain.handle("git-p2p:get-sync-history", async (_event, options) => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      const history = p2pGitSync.getSyncHistory(options || {});
      return { success: true, history };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Device Discovery & Authorization
  // ============================================================

  /**
   * Discover available devices
   * Channel: 'git-p2p:discover-devices'
   */
  ipcMain.handle("git-p2p:discover-devices", async () => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "Device discovery not initialized" };
      }
      const peers = deviceDiscovery.getDiscoveredPeers();
      return { success: true, peers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Get connected/verified peers
   * Channel: 'git-p2p:get-peers'
   */
  ipcMain.handle("git-p2p:get-peers", async () => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "Device discovery not initialized" };
      }
      return {
        success: true,
        discovered: deviceDiscovery.getDiscoveredPeers(),
        verified: deviceDiscovery.getVerifiedPeers(),
        syncable: deviceDiscovery.getSyncablePeers(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Authorize a device for P2P sync
   * Channel: 'git-p2p:authorize-device'
   */
  ipcMain.handle(
    "git-p2p:authorize-device",
    async (_event, { deviceDID, info }) => {
      try {
        if (!deviceDiscovery) {
          return { success: false, error: "Device discovery not initialized" };
        }
        return await deviceDiscovery.authorizeDevice(deviceDID, info || {});
      } catch (error) {
        logger.error("[Git P2P IPC] Authorize device error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Revoke device authorization
   * Channel: 'git-p2p:revoke-device'
   */
  ipcMain.handle("git-p2p:revoke-device", async (_event, { deviceDID }) => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "Device discovery not initialized" };
      }
      return await deviceDiscovery.revokeDevice(deviceDID);
    } catch (error) {
      logger.error("[Git P2P IPC] Revoke device error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get authorized devices list
   * Channel: 'git-p2p:get-authorized'
   */
  ipcMain.handle("git-p2p:get-authorized", async () => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "Device discovery not initialized" };
      }
      const devices = deviceDiscovery.getAuthorizedDevices();
      return { success: true, devices };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Verify a peer's DID identity
   * Channel: 'git-p2p:verify-peer'
   */
  ipcMain.handle("git-p2p:verify-peer", async (_event, { peerId }) => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "Device discovery not initialized" };
      }
      return await deviceDiscovery.verifyPeer(peerId);
    } catch (error) {
      logger.error("[Git P2P IPC] Verify peer error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get bandwidth statistics
   * Channel: 'git-p2p:get-bandwidth-stats'
   */
  ipcMain.handle("git-p2p:get-bandwidth-stats", async () => {
    try {
      if (!p2pGitSync) {
        return { success: false, error: "P2P Git sync not initialized" };
      }
      // Collect bandwidth stats from all active transports
      const stats = {};
      for (const [peerId, transport] of p2pGitSync._transports) {
        stats[peerId] = transport.getStats?.() || {};
      }
      return { success: true, stats };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Register module
  ipcGuard.registerModule("git-p2p-ipc", 15);
  logger.info("[Git P2P IPC] Registered 15 handlers");
}

module.exports = { registerGitP2PIPC };
