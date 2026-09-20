/**
 * Minimal diagnostic and failure boundary for LLM IPC handlers.
 *
 * Handler arguments, manager configuration, model/provider identifiers, and
 * caught errors are deliberately outside this interface.
 */

const { logger } = require("../utils/logger.js");

const SAFE_COMPONENTS = new Set([
  "alert",
  "bootstrap",
  "budgets",
  "core",
  "retention",
  "selector",
  "stream",
  "test-data",
  "token",
]);
const SAFE_EVENTS = new Set([
  "agent-execution-failed",
  "agent-execution-succeeded",
  "agent-route-check-failed",
  "agent-selected",
  "cache-check-failed",
  "cache-hit",
  "cache-write-failed",
  "chat-requested",
  "chat-succeeded",
  "code-task-detected",
  "config-reinitialized",
  "data-cleanup-completed",
  "error-precheck-failed",
  "error-precheck-succeeded",
  "function-calling-failed",
  "function-calling-started",
  "handlers-already-registered",
  "handlers-registered",
  "handlers-registering",
  "image-input-detected",
  "long-context-detected",
  "manus-optimization-applied",
  "manus-optimization-started",
  "malformed-storage-json",
  "mcp-discovery-failed",
  "mcp-tool-execution-failed",
  "mcp-tool-execution-started",
  "mcp-tools-available",
  "mcp-tools-requested",
  "model-selected",
  "model-selection-failed",
  "mock-service-create-failed",
  "mock-service-create-started",
  "mock-service-created",
  "prompt-compressed",
  "prompt-compression-failed",
  "prompt-kept-original",
  "rag-retrieval-failed",
  "rag-retrieval-succeeded",
  "response-cache-written",
  "response-record-failed",
  "response-recorded",
  "session-created",
  "session-load-failed",
  "session-loaded",
  "session-tracking-failed",
  "service-paused",
  "service-resumed",
  "template-chat-started",
  "template-filled",
  "test-config-updated",
  "test-data-cleared",
  "test-data-generated",
  "test-template-fill-started",
  "thinking-task-detected",
  "volcengine-tools-selected",
  "web-search-detected",
]);
const SAFE_OPERATIONS = new Set([
  "add-alert",
  "calculate-cost-estimate",
  "can-perform-operation",
  "cancel-stream",
  "chat",
  "chat-with-template",
  "check-status",
  "cleanup-old-data",
  "clear-alert-history",
  "clear-cache",
  "clear-context",
  "create-stream-controller",
  "delete-model-budget",
  "destroy-stream-controller",
  "dismiss-alert",
  "embeddings",
  "export-cost-report",
  "generate-report",
  "generate-test-data",
  "get-alert-history",
  "get-budget",
  "get-cache-stats",
  "get-config",
  "get-cost-breakdown",
  "get-model-budgets",
  "get-retention-config",
  "get-selector-info",
  "get-stream-stats",
  "get-time-series",
  "get-usage-stats",
  "list-models",
  "pause-service",
  "pause-stream",
  "query",
  "query-stream",
  "resume-service",
  "resume-stream",
  "select-best",
  "set-budget",
  "set-config",
  "set-model-budget",
  "set-retention-config",
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
    event(event) {
      sink.info("[LLM IPC] internal event", {
        component: safeComponent,
        event: allowlisted(event, SAFE_EVENTS),
      });
    },
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
