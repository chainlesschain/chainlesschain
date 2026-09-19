/**
 * Minimal diagnostic and failure boundary for LLM IPC handlers.
 *
 * Handler arguments, manager configuration, model/provider identifiers, and
 * caught errors are deliberately outside this interface.
 */

const { logger } = require("../utils/logger.js");

const SAFE_COMPONENTS = new Set(["core", "selector"]);
const SAFE_OPERATIONS = new Set([
  "chat",
  "chat-with-template",
  "check-status",
  "clear-context",
  "embeddings",
  "generate-report",
  "get-config",
  "get-selector-info",
  "list-models",
  "query",
  "query-stream",
  "select-best",
  "set-config",
  "switch-provider",
]);

function allowlisted(value, values) {
  return typeof value === "string" && values.has(value) ? value : "unknown";
}

function fixedError(message, code, details) {
  const error = new Error(message);
  error.code = code;
  error.component = details.component;
  error.operation = details.operation;
  return error;
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
      return fixedError(
        "LLM IPC operation failed",
        "CC_LLM_IPC_OPERATION_FAILED",
        safeDetails,
      );
    },
    governanceFailure(operation) {
      const safeDetails = details(operation);
      sink.error("[LLM IPC] governed operation failed", safeDetails);
      return fixedError(
        "Governed Desktop model request failed",
        "CC_AGENT_EVOLUTION_INGRESS_FAILED",
        safeDetails,
      );
    },
    success(operation) {
      sink.info("[LLM IPC] operation succeeded", details(operation));
    },
    unavailable(operation) {
      const safeDetails = details(operation);
      sink.warn("[LLM IPC] service unavailable", safeDetails);
      return {
        available: false,
        error: "LLM service unavailable",
        code: "CC_LLM_IPC_UNAVAILABLE",
        ...safeDetails,
      };
    },
  });
}

module.exports = { createLlmIpcPrivacy };
