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
  "compressor",
  "core",
  "instinct",
  "response-cache",
  "retention",
  "selector",
  "stream",
  "test-data",
  "token",
  "tracker",
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
  "compressor-config-updated",
  "compressor-initialized",
  "compression-completed",
  "compression-started",
  "data-cleanup-completed",
  "duplicate-message-detected",
  "error-precheck-failed",
  "error-precheck-succeeded",
  "function-calling-failed",
  "function-calling-started",
  "handlers-already-registered",
  "handlers-registered",
  "handlers-registering",
  "handlers-unregistered",
  "history-truncated",
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
  "messages-deduplicated",
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
  "similar-message-detected",
  "service-paused",
  "service-resumed",
  "template-chat-started",
  "template-filled",
  "summarization-completed",
  "summarization-skipped",
  "summarization-started",
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
  "get-pricing",
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
  "record-usage",
  "reset-budget-counters",
  "resume-service",
  "resume-stream",
  "select-best",
  "set-budget",
  "set-config",
  "set-exchange-rate",
  "set-model-budget",
  "set-retention-config",
  "switch-provider",
  "stream-create",
  "stream-start",
  "stream-complete",
  "stream-destroy",
  "stream-pause",
  "stream-resume",
  "stream-cancel",
  "stream-get-status",
  "stream-get-stats",
  "stream-list-active",
  "stream-get-buffer",
  "stream-clear-buffer",
  "calculate-cost",
  "export-report",
  "get-conversation-stats",
  "instinct-get-all",
  "instinct-get-relevant",
  "instinct-add",
  "instinct-update",
  "instinct-delete",
  "instinct-reinforce",
  "instinct-decay",
  "instinct-evolve",
  "instinct-export",
  "instinct-import",
  "instinct-get-stats",
  "response-cache-get-stats",
  "response-cache-get-stats-by-provider",
  "response-cache-get-hit-rate-trend",
  "response-cache-get-config",
  "response-cache-set-config",
  "response-cache-clear-all",
  "response-cache-clear-expired",
  "response-cache-check",
  "response-cache-warmup-status",
  "response-cache-start-auto-cleanup",
  "response-cache-stop-auto-cleanup",
  "tracker-get-usage-stats",
  "tracker-get-time-series",
  "tracker-get-cost-breakdown",
  "tracker-get-pricing",
  "tracker-calculate-cost",
  "tracker-get-budget",
  "tracker-set-budget",
  "tracker-reset-budget-counters",
  "tracker-record-usage",
  "tracker-export-report",
  "tracker-get-conversation-stats",
  "tracker-set-exchange-rate",
  "compressor-get-config",
  "compressor-set-config",
  "compressor-reset-config",
  "compressor-compress",
  "compressor-preview",
  "compressor-estimate-tokens",
  "compressor-get-recommendations",
  "compressor-get-stats",
  "compressor-get-history",
  "compressor-clear-history",
  "compressor-summarize",
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
    authorizationFailure(operation) {
      const safeDetails = details(operation);
      sink.error("[LLM IPC] authorization failed", safeDetails);
      return fixedError(
        "LLM IPC request is not authorized",
        "CC_LLM_IPC_UNAUTHORIZED",
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
