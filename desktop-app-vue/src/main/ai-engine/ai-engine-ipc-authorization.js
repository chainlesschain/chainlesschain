"use strict";

const { types: utilTypes } = require("node:util");
const { validateSender } = require("../ipc/ipc-sender-guard");

const OPERATION_PURPOSES = Object.freeze({
  "generate-ppt": "project-presentation-generate",
  "generate-word": "project-document-generate",
});

function authorizationError() {
  const error = new Error("AI Engine IPC request is not authorized");
  error.code = "CC_AI_ENGINE_IPC_UNAUTHORIZED";
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

function createAIEngineIpcAuthorization({
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
} = {}) {
  if (
    typeof getMainWindow !== "function" ||
    typeof getCurrentIdentity !== "function"
  ) {
    throw new TypeError(
      "AI Engine IPC authorization requires window and identity providers",
    );
  }
  if (
    authorizePurpose !== undefined &&
    typeof authorizePurpose !== "function"
  ) {
    throw new TypeError("AI Engine IPC purpose authority must be a function");
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
  createAIEngineIpcAuthorization,
};
