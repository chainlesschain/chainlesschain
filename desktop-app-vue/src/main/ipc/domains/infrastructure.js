/**
 * @module ipc/domains/infrastructure
 * Infrastructure domain IPC handlers
 * Handles: IPFS, analytics, performance, monitoring, hooks
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { logger } = require("../../utils/logger.js");

function registerInfrastructureDomain(deps) {
  logger.info(
    "[IPC:Infrastructure] Infrastructure domain registered (stub - handlers in individual -ipc.js files)",
  );
}

module.exports = { registerInfrastructureDomain };
