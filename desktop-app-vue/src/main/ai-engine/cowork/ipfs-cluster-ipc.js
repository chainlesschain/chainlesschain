/**
 * IPFS Cluster IPC Handlers — Distributed Pin Management (Feature 4)
 *
 * Registers 12 IPC handlers for IPFS cluster operations:
 * - Node (4): add-node, remove-node, list-nodes, get-node-status
 * - Pin (4): pin-content, unpin-content, get-pin-status, list-pins
 * - Cluster (4): rebalance, get-health, get-stats, get-config
 *
 * @module ai-engine/cowork/ipfs-cluster-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const IPFS_CLUSTER_CHANNELS = [
  // Node management (4)
  "ipfs-cluster:add-node",
  "ipfs-cluster:remove-node",
  "ipfs-cluster:list-nodes",
  "ipfs-cluster:get-node-status",
  // Pin management (4)
  "ipfs-cluster:pin-content",
  "ipfs-cluster:unpin-content",
  "ipfs-cluster:get-pin-status",
  "ipfs-cluster:list-pins",
  // Cluster operations (4)
  "ipfs-cluster:rebalance",
  "ipfs-cluster:get-health",
  "ipfs-cluster:get-stats",
  "ipfs-cluster:get-config",
];

/**
 * Register all IPFS Cluster IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.ipfsClusterManager - IPFSClusterManager instance
 * @returns {Object} Registration metadata
 */
function registerIPFSClusterIPC(dependencies = {}) {
  const { ipfsClusterManager } = dependencies;

  // ============================================================
  // Node Management (4 handlers)
  // ============================================================

  ipcMain.handle("ipfs-cluster:add-node", async (_event, options) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const node = ipfsClusterManager.addNode(options);
      return { success: true, data: node };
    } catch (error) {
      logger.error("[IPFSClusterIPC] add-node error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:remove-node", async (_event, nodeId) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const result = ipfsClusterManager.removeNode(nodeId);
      return { success: result, data: { removed: result } };
    } catch (error) {
      logger.error("[IPFSClusterIPC] remove-node error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:list-nodes", async (_event, filter) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const nodes = ipfsClusterManager.listNodes(filter || {});
      return { success: true, data: nodes };
    } catch (error) {
      logger.error("[IPFSClusterIPC] list-nodes error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:get-node-status", async (_event, nodeId) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const status = ipfsClusterManager.getNodeStatus(nodeId);
      return { success: true, data: status };
    } catch (error) {
      logger.error("[IPFSClusterIPC] get-node-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Pin Management (4 handlers)
  // ============================================================

  ipcMain.handle("ipfs-cluster:pin-content", async (_event, options) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const pin = ipfsClusterManager.pinContent(options);
      return { success: true, data: pin };
    } catch (error) {
      logger.error("[IPFSClusterIPC] pin-content error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:unpin-content", async (_event, pinId) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const result = ipfsClusterManager.unpinContent(pinId);
      return { success: result, data: { unpinned: result } };
    } catch (error) {
      logger.error("[IPFSClusterIPC] unpin-content error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:get-pin-status", async (_event, pinId) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const pin = ipfsClusterManager.getPinStatus(pinId);
      return { success: true, data: pin };
    } catch (error) {
      logger.error("[IPFSClusterIPC] get-pin-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:list-pins", async (_event, filter) => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const pins = ipfsClusterManager.listPins(filter || {});
      return { success: true, data: pins };
    } catch (error) {
      logger.error("[IPFSClusterIPC] list-pins error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Cluster Operations (4 handlers)
  // ============================================================

  ipcMain.handle("ipfs-cluster:rebalance", async () => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const result = ipfsClusterManager.rebalance();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPFSClusterIPC] rebalance error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:get-health", async () => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const health = ipfsClusterManager.getClusterHealth();
      return { success: true, data: health };
    } catch (error) {
      logger.error("[IPFSClusterIPC] get-health error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:get-stats", async () => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const stats = ipfsClusterManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[IPFSClusterIPC] get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipfs-cluster:get-config", async () => {
    try {
      if (!ipfsClusterManager?.initialized) {
        return { success: false, error: "IPFSClusterManager not initialized" };
      }
      const config = ipfsClusterManager.getConfig();
      return { success: true, data: config };
    } catch (error) {
      logger.error("[IPFSClusterIPC] get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[IPFSClusterIPC] Registered ${IPFS_CLUSTER_CHANNELS.length} IPC handlers`,
  );

  return {
    channels: IPFS_CLUSTER_CHANNELS,
    count: IPFS_CLUSTER_CHANNELS.length,
  };
}

module.exports = { registerIPFSClusterIPC };
