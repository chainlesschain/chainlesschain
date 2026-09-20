/**
 * LLM IPC handlers — data retention group.
 *
 * @module llm/llm-ipc-retention
 */
const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const { projectRetentionConfig } = require("./llm-ipc-record-projection");

const SUCCESS_RECEIPT = Object.freeze({ success: true });
const MAX_RETENTION_DAYS = 3650;
const RETENTION_KEYS = new Set([
  "usageLogRetentionDays",
  "cacheRetentionDays",
  "alertHistoryRetentionDays",
  "autoCleanupEnabled",
]);

function ownData(source, key) {
  if (
    !source ||
    types.isProxy(source) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(source))
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function authorizedActor(request) {
  const actorDid = ownData(request, "actorDid");
  if (
    typeof actorDid !== "string" ||
    actorDid.length < 1 ||
    actorDid.length > 512 ||
    /\p{Cc}/u.test(actorDid)
  ) {
    throw new TypeError("Invalid retention actor");
  }
  return actorDid;
}

function retentionDays(value, fallback) {
  const normalized = value ?? fallback;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 0 ||
    normalized > MAX_RETENTION_DAYS
  ) {
    throw new TypeError("Invalid retention period");
  }
  return normalized;
}

function normalizeRetentionConfig(value) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid retention config");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !RETENTION_KEYS.has(key) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid retention field");
    }
  }
  const autoCleanupEnabled = descriptors.autoCleanupEnabled?.value ?? true;
  if (typeof autoCleanupEnabled !== "boolean") {
    throw new TypeError("Invalid retention cleanup flag");
  }
  return Object.freeze({
    usageLogRetentionDays: retentionDays(
      descriptors.usageLogRetentionDays?.value,
      90,
    ),
    cacheRetentionDays: retentionDays(descriptors.cacheRetentionDays?.value, 7),
    alertHistoryRetentionDays: retentionDays(
      descriptors.alertHistoryRetentionDays?.value,
      30,
    ),
    autoCleanupEnabled,
  });
}

function storedRetentionConfig(value) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid stored retention config");
  }
  return Object.freeze({
    usageLogRetentionDays: retentionDays(
      ownData(value, "usage_log_retention_days"),
      90,
    ),
    alertHistoryRetentionDays: retentionDays(
      ownData(value, "alert_history_retention_days"),
      30,
    ),
  });
}

function registerRetentionHandlers(ctx) {
  const { ipcMain, database } = ctx;
  const privacy = ctx.retentionPrivacy || createLlmIpcPrivacy("retention");
  const authorization = ctx.coreAuthorization;
  if (!authorization || typeof authorization.authorize !== "function") {
    throw new TypeError("LLM retention IPC authorization is required");
  }
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = channel.replace(/^llm:/u, "");
      ipcMain.handle(channel, async (event, ...args) => {
        let actorDid;
        try {
          actorDid = authorizedActor(
            await authorization.authorize(event, operation),
          );
        } catch {
          throw privacy.authorizationFailure(operation);
        }
        return handler(event, actorDid, ...args);
      });
    },
  };

  authorizedIpcMain.handle(
    "llm:get-retention-config",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected retention input");
        }
        if (!database) {
          return null;
        }

        const config = database
          .prepare("SELECT * FROM llm_data_retention_config WHERE user_id = ?")
          .get(actorDid);

        return projectRetentionConfig(config);
      } catch {
        privacy.failure("get-retention-config");
        return null;
      }
    },
  );

  authorizedIpcMain.handle(
    "llm:set-retention-config",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid retention input count");
        }
        if (!database) {
          throw new Error("Database is not initialized");
        }
        const config = normalizeRetentionConfig(args[0]);
        const now = Date.now();

        database
          .prepare(
            `
              INSERT INTO llm_data_retention_config (
                id, user_id, usage_log_retention_days, cache_retention_days,
                alert_history_retention_days, auto_cleanup_enabled,
                last_cleanup_at, total_storage_mb, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                usage_log_retention_days = excluded.usage_log_retention_days,
                cache_retention_days = excluded.cache_retention_days,
                alert_history_retention_days = excluded.alert_history_retention_days,
                auto_cleanup_enabled = excluded.auto_cleanup_enabled,
                updated_at = excluded.updated_at
            `,
          )
          .run(
            randomUUID(),
            actorDid,
            config.usageLogRetentionDays,
            config.cacheRetentionDays,
            config.alertHistoryRetentionDays,
            config.autoCleanupEnabled ? 1 : 0,
            now,
            now,
          );

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("set-retention-config");
      }
    },
  );

  authorizedIpcMain.handle(
    "llm:cleanup-old-data",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected retention cleanup input");
        }
        if (!database) {
          throw new Error("Database is not initialized");
        }

        const cleanup = database.transaction(() => {
          const stored = database
            .prepare(
              "SELECT * FROM llm_data_retention_config WHERE user_id = ?",
            )
            .get(actorDid);
          if (!stored) {
            throw new TypeError("Missing retention config");
          }
          const config = storedRetentionConfig(stored);
          const now = Date.now();

          if (config.usageLogRetentionDays > 0) {
            const cutoff =
              now - config.usageLogRetentionDays * 24 * 60 * 60 * 1000;
            database
              .prepare(
                "DELETE FROM llm_usage_log WHERE created_at < ? AND user_id = ?",
              )
              .run(cutoff, actorDid);
          }

          // llm_cache has no actor or tenant ownership column. A per-actor IPC
          // cannot safely delete from it until the schema carries that scope.

          if (config.alertHistoryRetentionDays > 0) {
            const cutoff =
              now - config.alertHistoryRetentionDays * 24 * 60 * 60 * 1000;
            database
              .prepare(
                "DELETE FROM llm_alert_history WHERE created_at < ? AND user_id = ?",
              )
              .run(cutoff, actorDid);
          }

          database
            .prepare(
              `
                UPDATE llm_data_retention_config
                SET last_cleanup_at = ?, updated_at = ?
                WHERE user_id = ?
              `,
            )
            .run(now, now, actorDid);
        });
        cleanup();

        privacy.event("data-cleanup-completed");
        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("cleanup-old-data");
      }
    },
  );
}

module.exports = { registerRetentionHandlers };
