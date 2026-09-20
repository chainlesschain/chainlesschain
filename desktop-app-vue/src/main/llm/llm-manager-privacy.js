/**
 * Fixed diagnostic and failure-event boundary for LLMManager.
 *
 * Callers may provide only allowlisted identifiers. Provider/model names,
 * prompts, messages, costs, user identifiers, and caught Error objects are
 * deliberately outside this interface.
 */

const { logger } = require("../utils/logger.js");

const SAFE_EVENTS = new Set([
  "budget-alert-received",
  "budget-auto-paused",
  "budget-cheaper-model-attempted",
  "cache-hit",
  "cache-save-failed",
  "category-cache-cleared",
  "category-config-load-failed",
  "category-unknown",
  "client-close-failed",
  "cost-estimated",
  "embeddings-failed",
  "function-chat-started",
  "image-chat-started",
  "initialization-failed",
  "initialization-started",
  "knowledge-chat-started",
  "manager-closing",
  "manus-disabled",
  "manus-initialization-failed",
  "manus-optimization-enabled",
  "model-downgrade-unavailable",
  "model-fallback-started",
  "model-list-failed",
  "model-selected",
  "model-switched",
  "multi-tool-chat-started",
  "prompt-compression-completed",
  "prompt-compression-enabled",
  "prompt-compression-started",
  "provider-switch-failed",
  "provider-switch-started",
  "response-cache-enabled",
  "response-cached",
  "service-already-paused",
  "service-available",
  "service-not-paused",
  "service-paused",
  "service-resumed",
  "service-status-check-failed",
  "service-unavailable",
  "state-bus-bind-failed",
  "stream-model-fallback-started",
  "stream-prompt-compression-completed",
  "stream-prompt-compression-started",
  "summary-fallback-used",
  "summary-generated",
  "summary-generation-failed",
  "tag-fallback-used",
  "tag-generated",
  "tag-generation-failed",
  "task-model-selected",
  "token-tracking-enabled",
  "token-tracking-failed",
  "tools-client-initialization-failed",
  "tools-client-initialized",
  "volcengine-only-operation-rejected",
  "web-search-chat-started",
]);

const SAFE_FAILURE_OPERATIONS = new Set([
  "chat",
  "chat-stream",
  "query",
  "query-stream",
]);

function allowlisted(value, values) {
  return typeof value === "string" && values.has(value) ? value : "unknown";
}

function createLlmManagerPrivacy(sink = logger) {
  return Object.freeze({
    event(event) {
      sink.info("[LLMManager] internal event", {
        component: "manager",
        event: allowlisted(event, SAFE_EVENTS),
      });
    },
    failureEvent(operation) {
      return Object.freeze({
        code: "CC_LLM_MANAGER_OPERATION_FAILED",
        component: "manager",
        operation: allowlisted(operation, SAFE_FAILURE_OPERATIONS),
      });
    },
  });
}

module.exports = { createLlmManagerPrivacy };
