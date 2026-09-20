"use strict";

const { types: utilTypes } = require("node:util");
const { validateSender } = require("../ipc/ipc-sender-guard");

const OPERATION_PURPOSES = Object.freeze({
  "batch-set-api-keys": "secret-configuration-write",
  "clear-cache": "secret-cache-clear",
  "create-backup": "secret-backup-create",
  delete: "secret-configuration-delete",
  "delete-api-key": "secret-configuration-delete",
  exists: "secret-configuration-status-read",
  export: "secret-configuration-export",
  "get-api-key-masked": "secret-configuration-status-read",
  "get-configured-providers": "secret-configuration-status-read",
  "get-info": "secret-configuration-status-read",
  "get-provider-fields": "secret-field-metadata-read",
  "get-sensitive-fields": "secret-field-metadata-read",
  "has-api-key": "secret-configuration-status-read",
  import: "secret-configuration-import",
  "is-sensitive": "secret-field-metadata-read",
  "list-backups": "secret-backup-list",
  load: "secret-configuration-status-read",
  "migrate-to-safe-storage": "secret-configuration-migration",
  "restore-backup": "secret-backup-restore",
  sanitize: "secret-configuration-validation",
  save: "secret-configuration-write",
  "set-api-key": "secret-configuration-write",
  "validate-api-key": "secret-configuration-validation",
});

function authorizationError() {
  const error = new Error("Secure storage IPC request is not authorized");
  error.code = "CC_SECURE_STORAGE_UNAUTHORIZED";
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

function createSecureStorageIpcAuthorization({
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
} = {}) {
  if (
    typeof getMainWindow !== "function" ||
    typeof getCurrentIdentity !== "function"
  ) {
    throw new TypeError(
      "Secure storage IPC authorization requires window and identity providers",
    );
  }
  if (
    authorizePurpose !== undefined &&
    typeof authorizePurpose !== "function"
  ) {
    throw new TypeError(
      "Secure storage IPC purpose authority must be a function",
    );
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
  createSecureStorageIpcAuthorization,
};
