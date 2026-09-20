"use strict";

const { types } = require("node:util");
const { validateSender } = require("../ipc/ipc-sender-guard");

const OPERATION_AUTHORIZATION = Object.freeze({
  "check-status": Object.freeze({
    purpose: "model-service-status-read",
    fields: Object.freeze(["availability", "provider", "model-catalog"]),
  }),
  query: Object.freeze({
    purpose: "model-inference",
    fields: Object.freeze(["model-response", "usage"]),
  }),
  chat: Object.freeze({
    purpose: "model-inference",
    fields: Object.freeze([
      "model-response",
      "usage",
      "retrieval-metadata",
      "optimization-receipt",
    ]),
  }),
  "chat-with-template": Object.freeze({
    purpose: "model-template-inference",
    fields: Object.freeze(["model-response", "usage"]),
  }),
  "query-stream": Object.freeze({
    purpose: "model-stream-inference",
    fields: Object.freeze(["model-response", "stream-chunk", "usage"]),
  }),
  "get-config": Object.freeze({
    purpose: "model-configuration-read",
    fields: Object.freeze(["provider-configuration-status"]),
  }),
  "set-config": Object.freeze({
    purpose: "model-configuration-write",
    fields: Object.freeze(["provider-configuration"]),
  }),
  "list-models": Object.freeze({
    purpose: "model-catalog-read",
    fields: Object.freeze(["model-catalog"]),
  }),
  "clear-context": Object.freeze({
    purpose: "model-context-delete",
    fields: Object.freeze(["conversation-context"]),
  }),
  embeddings: Object.freeze({
    purpose: "model-embedding",
    fields: Object.freeze(["embedding-vector", "usage"]),
  }),
  "generate-test-data": Object.freeze({
    purpose: "model-test-data-generate",
    fields: Object.freeze(["usage-test-data"]),
  }),
  "clear-test-data": Object.freeze({
    purpose: "model-test-data-delete",
    fields: Object.freeze(["usage-test-data"]),
  }),
  "instinct-get-all": Object.freeze({
    purpose: "model-instinct-read",
    fields: Object.freeze(["instinct-catalog"]),
  }),
  "instinct-get-relevant": Object.freeze({
    purpose: "model-instinct-match",
    fields: Object.freeze(["instinct-catalog"]),
  }),
  "instinct-add": Object.freeze({
    purpose: "model-instinct-create",
    fields: Object.freeze(["instinct-record"]),
  }),
  "instinct-update": Object.freeze({
    purpose: "model-instinct-update",
    fields: Object.freeze(["instinct-record"]),
  }),
  "instinct-delete": Object.freeze({
    purpose: "model-instinct-delete",
    fields: Object.freeze(["instinct-record"]),
  }),
  "instinct-reinforce": Object.freeze({
    purpose: "model-instinct-update",
    fields: Object.freeze(["instinct-record"]),
  }),
  "instinct-decay": Object.freeze({
    purpose: "model-instinct-update",
    fields: Object.freeze(["instinct-record"]),
  }),
  "instinct-evolve": Object.freeze({
    purpose: "model-instinct-evolve",
    fields: Object.freeze(["instinct-evolution-receipt"]),
  }),
  "instinct-export": Object.freeze({
    purpose: "model-instinct-export",
    fields: Object.freeze(["instinct-export"]),
  }),
  "instinct-import": Object.freeze({
    purpose: "model-instinct-import",
    fields: Object.freeze(["instinct-import-receipt"]),
  }),
  "instinct-get-stats": Object.freeze({
    purpose: "model-instinct-stats-read",
    fields: Object.freeze(["instinct-statistics"]),
  }),
  "response-cache-get-stats": Object.freeze({
    purpose: "model-cache-stats-read",
    fields: Object.freeze(["cache-statistics"]),
  }),
  "response-cache-get-stats-by-provider": Object.freeze({
    purpose: "model-cache-stats-read",
    fields: Object.freeze(["cache-provider-statistics"]),
  }),
  "response-cache-get-hit-rate-trend": Object.freeze({
    purpose: "model-cache-stats-read",
    fields: Object.freeze(["cache-hit-statistics"]),
  }),
  "response-cache-get-config": Object.freeze({
    purpose: "model-cache-configuration-read",
    fields: Object.freeze(["cache-configuration"]),
  }),
  "response-cache-set-config": Object.freeze({
    purpose: "model-cache-configuration-write",
    fields: Object.freeze(["cache-configuration"]),
  }),
  "response-cache-clear-all": Object.freeze({
    purpose: "model-cache-delete",
    fields: Object.freeze(["cache-control-receipt"]),
  }),
  "response-cache-clear-expired": Object.freeze({
    purpose: "model-cache-delete",
    fields: Object.freeze(["cache-control-receipt"]),
  }),
  "response-cache-check": Object.freeze({
    purpose: "model-cache-status-read",
    fields: Object.freeze(["cache-entry-metadata"]),
  }),
  "response-cache-warmup-status": Object.freeze({
    purpose: "model-cache-status-read",
    fields: Object.freeze(["cache-health"]),
  }),
  "response-cache-start-auto-cleanup": Object.freeze({
    purpose: "model-cache-control",
    fields: Object.freeze(["cache-control-receipt"]),
  }),
  "response-cache-stop-auto-cleanup": Object.freeze({
    purpose: "model-cache-control",
    fields: Object.freeze(["cache-control-receipt"]),
  }),
  "tracker-get-usage-stats": Object.freeze({
    purpose: "model-usage-read",
    fields: Object.freeze(["usage-statistics"]),
  }),
  "tracker-get-time-series": Object.freeze({
    purpose: "model-usage-read",
    fields: Object.freeze(["usage-time-series"]),
  }),
  "tracker-get-cost-breakdown": Object.freeze({
    purpose: "model-cost-read",
    fields: Object.freeze(["cost-breakdown"]),
  }),
  "tracker-get-pricing": Object.freeze({
    purpose: "model-pricing-read",
    fields: Object.freeze(["pricing-catalog"]),
  }),
  "tracker-calculate-cost": Object.freeze({
    purpose: "model-cost-estimate",
    fields: Object.freeze(["cost-estimate"]),
  }),
  "tracker-get-budget": Object.freeze({
    purpose: "model-budget-read",
    fields: Object.freeze(["budget-configuration"]),
  }),
  "tracker-set-budget": Object.freeze({
    purpose: "model-budget-write",
    fields: Object.freeze(["budget-configuration"]),
  }),
  "tracker-reset-budget-counters": Object.freeze({
    purpose: "model-budget-reset",
    fields: Object.freeze(["budget-configuration"]),
  }),
  "tracker-record-usage": Object.freeze({
    purpose: "model-usage-record",
    fields: Object.freeze(["usage-record"]),
  }),
  "tracker-export-report": Object.freeze({
    purpose: "model-cost-report-export",
    fields: Object.freeze(["cost-report-receipt"]),
  }),
  "tracker-get-conversation-stats": Object.freeze({
    purpose: "model-usage-read",
    fields: Object.freeze(["conversation-statistics"]),
  }),
  "tracker-set-exchange-rate": Object.freeze({
    purpose: "model-pricing-write",
    fields: Object.freeze(["pricing-configuration"]),
  }),
  "compressor-get-config": Object.freeze({
    purpose: "model-prompt-compression-config-read",
    fields: Object.freeze(["compression-configuration"]),
  }),
  "compressor-set-config": Object.freeze({
    purpose: "model-prompt-compression-config-write",
    fields: Object.freeze(["compression-configuration"]),
  }),
  "compressor-reset-config": Object.freeze({
    purpose: "model-prompt-compression-config-reset",
    fields: Object.freeze(["compression-configuration"]),
  }),
  "compressor-compress": Object.freeze({
    purpose: "model-prompt-compress",
    fields: Object.freeze(["compressed-messages", "compression-statistics"]),
  }),
  "compressor-preview": Object.freeze({
    purpose: "model-prompt-compression-preview",
    fields: Object.freeze(["compression-preview"]),
  }),
  "compressor-estimate-tokens": Object.freeze({
    purpose: "model-token-estimate",
    fields: Object.freeze(["token-estimate"]),
  }),
  "compressor-get-recommendations": Object.freeze({
    purpose: "model-prompt-compression-recommend",
    fields: Object.freeze(["compression-recommendations"]),
  }),
  "compressor-get-stats": Object.freeze({
    purpose: "model-prompt-compression-stats-read",
    fields: Object.freeze(["compression-statistics"]),
  }),
  "compressor-get-history": Object.freeze({
    purpose: "model-prompt-compression-history-read",
    fields: Object.freeze(["compression-history"]),
  }),
  "compressor-clear-history": Object.freeze({
    purpose: "model-prompt-compression-history-delete",
    fields: Object.freeze(["compression-history"]),
  }),
  "get-selector-info": Object.freeze({
    purpose: "model-selector-catalog-read",
    fields: Object.freeze(["selector-catalog"]),
  }),
  "select-best": Object.freeze({
    purpose: "model-selector-recommendation",
    fields: Object.freeze(["provider-selection"]),
  }),
  "generate-report": Object.freeze({
    purpose: "model-selector-report",
    fields: Object.freeze(["selection-report"]),
  }),
  "switch-provider": Object.freeze({
    purpose: "model-provider-switch",
    fields: Object.freeze(["provider-configuration"]),
  }),
  "stream-create": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-reference"]),
  }),
  "stream-start": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "stream-complete": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "stream-destroy": Object.freeze({
    purpose: "model-stream-delete",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "stream-pause": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "stream-resume": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "stream-cancel": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "stream-get-status": Object.freeze({
    purpose: "model-stream-status-read",
    fields: Object.freeze(["stream-status"]),
  }),
  "stream-get-stats": Object.freeze({
    purpose: "model-stream-stats-read",
    fields: Object.freeze(["stream-stats"]),
  }),
  "stream-list-active": Object.freeze({
    purpose: "model-stream-list-read",
    fields: Object.freeze(["stream-list"]),
  }),
  "stream-get-buffer": Object.freeze({
    purpose: "model-stream-buffer-metadata-read",
    fields: Object.freeze(["stream-buffer-metadata"]),
  }),
  "stream-clear-buffer": Object.freeze({
    purpose: "model-stream-buffer-delete",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "create-stream-controller": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-reference"]),
  }),
  "pause-stream": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "resume-stream": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "cancel-stream": Object.freeze({
    purpose: "model-stream-control",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "get-stream-stats": Object.freeze({
    purpose: "model-stream-stats-read",
    fields: Object.freeze(["stream-stats"]),
  }),
  "destroy-stream-controller": Object.freeze({
    purpose: "model-stream-delete",
    fields: Object.freeze(["stream-control-receipt"]),
  }),
  "get-model-budgets": Object.freeze({
    purpose: "model-budget-read",
    fields: Object.freeze(["model-budget"]),
  }),
  "set-model-budget": Object.freeze({
    purpose: "model-budget-write",
    fields: Object.freeze(["model-budget"]),
  }),
  "delete-model-budget": Object.freeze({
    purpose: "model-budget-delete",
    fields: Object.freeze(["model-budget"]),
  }),
  "get-retention-config": Object.freeze({
    purpose: "model-data-retention-read",
    fields: Object.freeze(["retention-configuration"]),
  }),
  "set-retention-config": Object.freeze({
    purpose: "model-data-retention-write",
    fields: Object.freeze(["retention-configuration"]),
  }),
  "cleanup-old-data": Object.freeze({
    purpose: "model-data-retention-delete",
    fields: Object.freeze(["retention-cleanup-receipt"]),
  }),
  "get-alert-history": Object.freeze({
    purpose: "model-alert-history-read",
    fields: Object.freeze(["alert-history"]),
  }),
  "add-alert": Object.freeze({
    purpose: "model-alert-create",
    fields: Object.freeze(["alert-record"]),
  }),
  "dismiss-alert": Object.freeze({
    purpose: "model-alert-update",
    fields: Object.freeze(["alert-record"]),
  }),
  "clear-alert-history": Object.freeze({
    purpose: "model-alert-history-delete",
    fields: Object.freeze(["alert-history"]),
  }),
  "get-usage-stats": Object.freeze({
    purpose: "model-usage-read",
    fields: Object.freeze(["usage-statistics"]),
  }),
  "get-time-series": Object.freeze({
    purpose: "model-usage-read",
    fields: Object.freeze(["usage-time-series"]),
  }),
  "get-cost-breakdown": Object.freeze({
    purpose: "model-cost-read",
    fields: Object.freeze(["cost-breakdown"]),
  }),
  "get-budget": Object.freeze({
    purpose: "model-budget-read",
    fields: Object.freeze(["budget-configuration"]),
  }),
  "set-budget": Object.freeze({
    purpose: "model-budget-write",
    fields: Object.freeze(["budget-configuration"]),
  }),
  "export-cost-report": Object.freeze({
    purpose: "model-cost-report-export",
    fields: Object.freeze(["cost-report-receipt"]),
  }),
  "clear-cache": Object.freeze({
    purpose: "model-cache-delete",
    fields: Object.freeze(["cache-control-receipt"]),
  }),
  "get-cache-stats": Object.freeze({
    purpose: "model-cache-stats-read",
    fields: Object.freeze(["cache-statistics"]),
  }),
  "resume-service": Object.freeze({
    purpose: "model-service-control",
    fields: Object.freeze(["service-control-receipt"]),
  }),
  "pause-service": Object.freeze({
    purpose: "model-service-control",
    fields: Object.freeze(["service-control-receipt"]),
  }),
  "calculate-cost-estimate": Object.freeze({
    purpose: "model-cost-estimate",
    fields: Object.freeze(["cost-estimate"]),
  }),
  "can-perform-operation": Object.freeze({
    purpose: "model-budget-decision",
    fields: Object.freeze(["budget-decision"]),
  }),
});

function authorizationError() {
  const error = new Error("LLM core IPC request is not authorized");
  error.code = "CC_LLM_IPC_UNAUTHORIZED";
  return error;
}

function plainIdentity(value) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw authorizationError();
  }
  return value;
}

function boundedIdentifier(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    /\p{Cc}/u.test(value)
  ) {
    throw authorizationError();
  }
  return value;
}

function senderId(event) {
  try {
    const value = event?.sender?.id;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function assertMainFrame(event, mainWindow) {
  let contents;
  try {
    contents = mainWindow?.webContents;
  } catch {
    contents = null;
  }
  if (
    !contents ||
    event?.sender !== contents ||
    !event.senderFrame ||
    event.senderFrame !== contents.mainFrame ||
    validateSender(event).trusted !== true
  ) {
    throw authorizationError();
  }
}

function createLlmCoreIpcAuthorization({
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
} = {}) {
  if (
    typeof getMainWindow !== "function" ||
    typeof getCurrentIdentity !== "function"
  ) {
    throw new TypeError(
      "LLM core IPC authorization requires window and identity providers",
    );
  }
  if (
    authorizePurpose !== undefined &&
    typeof authorizePurpose !== "function"
  ) {
    throw new TypeError("LLM core IPC purpose authority must be a function");
  }

  return Object.freeze({
    async authorize(event, operation) {
      const rule = OPERATION_AUTHORIZATION[operation];
      if (!rule) {
        throw authorizationError();
      }

      let mainWindow;
      let identity;
      try {
        mainWindow = getMainWindow();
        identity = plainIdentity(getCurrentIdentity());
      } catch {
        throw authorizationError();
      }
      assertMainFrame(event, mainWindow);

      const actorDid = boundedIdentifier(identity.did);
      const tenantId = boundedIdentifier(identity.tenantId || actorDid);
      const request = Object.freeze({
        actorDid,
        fields: rule.fields,
        operation,
        purpose: rule.purpose,
        senderId: senderId(event),
        tenantId,
      });

      if (authorizePurpose) {
        let decision;
        try {
          decision = await authorizePurpose(request);
        } catch {
          throw authorizationError();
        }
        if (decision !== true && decision?.authorized !== true) {
          throw authorizationError();
        }
      }

      return request;
    },
  });
}

module.exports = {
  OPERATION_AUTHORIZATION,
  createLlmCoreIpcAuthorization,
};
