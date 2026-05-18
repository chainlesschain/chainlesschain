/**
 * @module ipc/domains/ai
 * AI Engine domain IPC handlers
 * Handles: LLM, RAG, cowork, plan-mode, skills, agents, memory
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { logger } = require("../../utils/logger.js");

function registerAIDomain(deps) {
  logger.info(
    "[IPC:AI] AI domain registered (stub - handlers in individual -ipc.js files)",
  );
}

module.exports = { registerAIDomain };
