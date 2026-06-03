/**
 * @module ipc/domains/security
 * Security domain IPC handlers
 * Handles: U-Key, SIMKey, encryption, authentication
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { logger } = require("../../utils/logger.js");

function registerSecurityDomain(deps) {
  logger.info(
    "[IPC:Security] Security domain registered (stub - handlers in individual -ipc.js files)",
  );
}

module.exports = { registerSecurityDomain };
