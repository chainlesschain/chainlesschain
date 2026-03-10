/**
 * @module ipc/domains/p2p
 * P2P domain IPC handlers
 * Handles: libp2p, WebRTC, signaling, encrypted messaging
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { logger } = require("../../utils/logger.js");

function registerP2PDomain(deps) {
  logger.info(
    "[IPC:P2P] P2P domain registered (stub - handlers in individual -ipc.js files)",
  );
}

module.exports = { registerP2PDomain };
