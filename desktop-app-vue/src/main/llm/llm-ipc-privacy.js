/**
 * Minimal diagnostic and failure boundary for LLM IPC handlers.
 *
 * Handler arguments, manager configuration, model/provider identifiers, and
 * caught errors are deliberately outside this interface.
 */

const { logger } = require("../utils/logger.js");

const SAFE_COMPONENTS = new Set(["core", "selector"]);
const SAFE_OPERATIONS = new Set([
  "check-status",
  "generate-report",
  "get-selector-info",
  "query",
  "select-best",
  "switch-provider",
]);

function allowlisted(value, values) {
  return typeof value === "string" && values.has(value) ? value : "unknown";
}

function createLlmIpcPrivacy(component, sink = logger) {
  const safeComponent = allowlisted(component, SAFE_COMPONENTS);
  const details = (operation) => ({
    component: safeComponent,
    operation: allowlisted(operation, SAFE_OPERATIONS),
  });

  return Object.freeze({
    failure(operation) {
      const safeDetails = details(operation);
      sink.error("[LLM IPC] operation failed", safeDetails);
      const error = new Error("LLM IPC operation failed");
      error.code = "CC_LLM_IPC_OPERATION_FAILED";
      error.component = safeDetails.component;
      error.operation = safeDetails.operation;
      return error;
    },
    success(operation) {
      sink.info("[LLM IPC] operation succeeded", details(operation));
    },
  });
}

module.exports = { createLlmIpcPrivacy };
