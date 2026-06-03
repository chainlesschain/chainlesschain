/**
 * @module ipc/domains/evomap
 * EvoMap domain IPC handlers
 * Handles: evolution mapping, agent federation, reputation
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { logger } = require("../../utils/logger.js");

function registerEvomapDomain(deps) {
  logger.info(
    "[IPC:EvoMap] EvoMap domain registered (stub - handlers in individual -ipc.js files)",
  );
}

module.exports = { registerEvomapDomain };
