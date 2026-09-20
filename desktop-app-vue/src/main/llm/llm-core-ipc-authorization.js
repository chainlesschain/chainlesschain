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
