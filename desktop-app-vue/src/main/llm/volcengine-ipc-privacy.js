/** Fixed diagnostic and failure boundary for Volcengine IPC. */

const { logger } = require("../utils/logger.js");

const SAFE_EVENTS = new Set([
  "function-execution-started",
  "handlers-registered",
  "handlers-registering",
  "handlers-unregistered",
  "handlers-unregistering",
  "p2p-message-prepared",
]);
const SAFE_OPERATIONS = new Set([
  "chat-with-function-calling",
  "chat-with-image",
  "chat-with-knowledge-base",
  "chat-with-mcp",
  "chat-with-multiple-tools",
  "chat-with-web-search",
  "check-config",
  "estimate-cost",
  "execute-function-calling",
  "list-models",
  "select-model",
  "select-model-by-task",
  "setup-knowledge-base",
  "understand-image",
  "update-config",
]);

function allowlisted(value, values) {
  return typeof value === "string" && values.has(value) ? value : "unknown";
}

function createVolcengineIpcPrivacy(sink = logger) {
  const details = (operation) => ({
    component: "volcengine",
    operation: allowlisted(operation, SAFE_OPERATIONS),
  });

  return Object.freeze({
    event(event) {
      sink.info("[VolcengineIPC] internal event", {
        component: "volcengine",
        event: allowlisted(event, SAFE_EVENTS),
      });
    },
    failure(operation) {
      const safeDetails = details(operation);
      sink.error("[VolcengineIPC] operation failed", safeDetails);
      return {
        success: false,
        error: "Volcengine IPC operation failed",
        code: "CC_VOLCENGINE_IPC_OPERATION_FAILED",
        ...safeDetails,
      };
    },
    governanceFailure(operation) {
      const safeDetails = details(operation);
      sink.error("[VolcengineIPC] governed operation failed", safeDetails);
      return {
        success: false,
        error: "Governed Desktop model request failed",
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
        ...safeDetails,
      };
    },
  });
}

module.exports = { createVolcengineIpcPrivacy };
