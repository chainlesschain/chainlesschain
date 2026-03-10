/**
 * @module ipc/domains/autonomous
 * Autonomous domain IPC handlers
 * Handles: autonomous operations, pipeline orchestration, deploy agents
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { logger } = require("../../utils/logger.js");

function registerAutonomousDomain(deps) {
  logger.info(
    "[IPC:Autonomous] Autonomous domain registered (stub - handlers in individual -ipc.js files)",
  );
}

module.exports = { registerAutonomousDomain };
