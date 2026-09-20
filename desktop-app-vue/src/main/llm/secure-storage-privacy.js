/** Fixed diagnostics and failure receipts for secure configuration storage. */

const { logger } = require("../utils/logger.js");

const SAFE_COMPONENTS = new Set(["config", "ipc", "storage"]);
const SAFE_EVENTS = new Set([
  "backup-create-failed",
  "backup-created",
  "backup-list-failed",
  "backup-missing",
  "backup-restore-failed",
  "backup-restored",
  "config-delete-failed",
  "config-deleted",
  "config-export-failed",
  "config-exported",
  "config-import-failed",
  "config-imported",
  "config-load-failed",
  "config-loaded",
  "config-missing",
  "config-save-failed",
  "config-saved",
  "encryption-fallback-used",
  "embedding-model-migrated",
  "import-format-invalid",
  "import-source-missing",
  "ipc-registered",
  "ipc-unregistered",
  "migration-failed",
  "migration-not-needed",
  "migration-succeeded",
  "migration-unavailable",
  "model-migrated",
  "safe-storage-availability-checked",
  "safe-storage-check-failed",
  "sensitive-config-load-failed",
  "sensitive-config-loaded",
  "sensitive-config-saved",
  "storage-info-failed",
]);
const SAFE_OPERATIONS = new Set([
  "batch-set-api-keys",
  "clear-cache",
  "create-backup",
  "delete",
  "delete-api-key",
  "exists",
  "export",
  "get-api-key-masked",
  "get-api-key-status",
  "get-configured-providers",
  "get-info",
  "get-provider-fields",
  "get-sensitive-fields",
  "has-api-key",
  "import",
  "is-sensitive",
  "list-backups",
  "load",
  "migrate-to-safe-storage",
  "restore-backup",
  "sanitize",
  "save",
  "set-api-key",
  "validate-api-key",
]);

function allowlisted(value, values) {
  return typeof value === "string" && values.has(value) ? value : "unknown";
}

function createSecureStoragePrivacy(component, sink = logger) {
  const safeComponent = allowlisted(component, SAFE_COMPONENTS);
  return Object.freeze({
    event(event) {
      sink.info("[SecureStorage] internal event", {
        component: safeComponent,
        event: allowlisted(event, SAFE_EVENTS),
      });
    },
    failure(operation) {
      const receipt = {
        success: false,
        error: "Secure storage operation failed",
        code: "CC_SECURE_STORAGE_OPERATION_FAILED",
        component: safeComponent,
        operation: allowlisted(operation, SAFE_OPERATIONS),
      };
      sink.error("[SecureStorage] operation failed", {
        component: receipt.component,
        operation: receipt.operation,
      });
      return receipt;
    },
    authorizationFailure(operation) {
      const receipt = {
        success: false,
        error: "Secure storage request is not authorized",
        code: "CC_SECURE_STORAGE_UNAUTHORIZED",
        component: safeComponent,
        operation: allowlisted(operation, SAFE_OPERATIONS),
      };
      sink.error("[SecureStorage] authorization denied", {
        component: receipt.component,
        operation: receipt.operation,
      });
      return receipt;
    },
  });
}

module.exports = { createSecureStoragePrivacy };
