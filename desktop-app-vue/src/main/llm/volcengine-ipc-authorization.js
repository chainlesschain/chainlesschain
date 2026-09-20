"use strict";

const { types: utilTypes } = require("node:util");
const { validateSender } = require("../ipc/ipc-sender-guard");

const OPERATION_PURPOSES = Object.freeze({
  "chat-with-function-calling": "model-tool-execution",
  "chat-with-image": "model-vision-request",
  "chat-with-knowledge-base": "model-knowledge-request",
  "chat-with-mcp": "model-tool-execution",
  "chat-with-multiple-tools": "model-tool-execution",
  "chat-with-web-search": "model-web-search",
  "check-config": "provider-configuration-read",
  "estimate-cost": "model-cost-estimation",
  "execute-function-calling": "model-tool-execution",
  "list-models": "model-catalog-read",
  "select-model": "model-selection",
  "select-model-by-task": "model-selection",
  "setup-knowledge-base": "model-knowledge-configuration",
  "understand-image": "model-vision-request",
  "update-config": "provider-configuration-write",
});

function authorizationError() {
  const error = new Error("Volcengine IPC request is not authorized");
  error.code = "CC_VOLCENGINE_IPC_UNAUTHORIZED";
  return error;
}

function plainIdentity(value) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
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

function createVolcengineIpcAuthorization({
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
} = {}) {
  if (
    typeof getMainWindow !== "function" ||
    typeof getCurrentIdentity !== "function"
  ) {
    throw new TypeError(
      "Volcengine IPC authorization requires window and identity providers",
    );
  }
  if (
    authorizePurpose !== undefined &&
    typeof authorizePurpose !== "function"
  ) {
    throw new TypeError("Volcengine IPC purpose authority must be a function");
  }

  return Object.freeze({
    async authorize(event, operation) {
      const purpose = OPERATION_PURPOSES[operation];
      if (!purpose) {
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
      // The personal Desktop deployment is a single-tenant boundary. An
      // enterprise identity may provide a narrower tenantId; otherwise the
      // authenticated DID is the durable local tenant namespace. Renderer
      // payloads never participate in this binding.
      const tenantId = boundedIdentifier(identity.tenantId || actorDid);
      const request = Object.freeze({
        actorDid,
        operation,
        purpose,
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
  OPERATION_PURPOSES,
  createVolcengineIpcAuthorization,
};
