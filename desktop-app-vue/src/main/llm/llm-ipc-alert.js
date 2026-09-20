/**
 * LLM IPC handlers — alert history group.
 *
 * @module llm/llm-ipc-alert
 */
const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const { projectAlert } = require("./llm-ipc-record-projection");

const SUCCESS_RECEIPT = Object.freeze({ success: true });
const ALERT_LEVELS = new Set(["info", "warning", "critical"]);
const ALERT_TYPES = new Set([
  "budget_warning",
  "budget_critical",
  "rate_limit",
  "error",
]);
const READ_KEYS = new Set(["limit", "level", "includesDismissed"]);
const ADD_KEYS = new Set([
  "type",
  "level",
  "title",
  "message",
  "details",
  "provider",
  "model",
]);
const DETAIL_KEYS = new Set(["budgetType", "percentage", "spent", "limit"]);
const CLEAR_KEYS = new Set(["olderThanDays"]);

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
    throw new TypeError("Invalid alert actor");
  }
  return actorDid;
}

function descriptorsFor(value, allowedKeys) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid alert input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid alert field");
    }
  }
  return descriptors;
}

function boundedText(value, maximum, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Invalid alert text");
  }
  return value;
}

function normalizeReadOptions(value) {
  const descriptors = descriptorsFor(value, READ_KEYS);
  const limit = descriptors.limit?.value ?? 100;
  const level = descriptors.level?.value;
  const includesDismissed = descriptors.includesDismissed?.value ?? true;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    throw new TypeError("Invalid alert limit");
  }
  if (level !== undefined && !ALERT_LEVELS.has(level)) {
    throw new TypeError("Invalid alert level");
  }
  if (typeof includesDismissed !== "boolean") {
    throw new TypeError("Invalid dismissed filter");
  }
  return Object.freeze({ includesDismissed, level, limit });
}

function alertNumber(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1_000_000_000_000_000
  ) {
    throw new TypeError("Invalid alert detail number");
  }
  return value;
}

function normalizeDetails(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const descriptors = descriptorsFor(value, DETAIL_KEYS);
  const details = {};
  if (descriptors.budgetType) {
    details.budgetType = boundedText(descriptors.budgetType.value, 64);
  }
  for (const key of ["percentage", "spent", "limit"]) {
    if (descriptors[key]) {
      details[key] = alertNumber(descriptors[key].value);
    }
  }
  return Object.freeze(details);
}

function normalizeAlert(value) {
  const descriptors = descriptorsFor(value, ADD_KEYS);
  const type = descriptors.type?.value;
  const level = descriptors.level?.value;
  if (!ALERT_TYPES.has(type) || !ALERT_LEVELS.has(level)) {
    throw new TypeError("Invalid alert classification");
  }
  return Object.freeze({
    type,
    level,
    title: boundedText(descriptors.title?.value, 512),
    message: boundedText(descriptors.message?.value, 4096),
    details: normalizeDetails(descriptors.details?.value),
    provider: boundedText(descriptors.provider?.value, 128, { optional: true }),
    model: boundedText(descriptors.model?.value, 256, { optional: true }),
  });
}

function normalizeClearOptions(value) {
  const descriptors = descriptorsFor(value, CLEAR_KEYS);
  const olderThanDays = descriptors.olderThanDays?.value;
  if (
    olderThanDays !== undefined &&
    (!Number.isSafeInteger(olderThanDays) ||
      olderThanDays < 1 ||
      olderThanDays > 3650)
  ) {
    throw new TypeError("Invalid alert cleanup period");
  }
  return Object.freeze({ olderThanDays });
}

function safeParse(raw, privacy) {
  if (raw == null || raw === "") {
    return null;
  }
  if (typeof raw !== "string" || raw.length > 65_536) {
    privacy.event("malformed-storage-json");
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    privacy.event("malformed-storage-json");
    return null;
  }
}

function registerAlertHandlers(ctx) {
  const { ipcMain, database } = ctx;
  const privacy = ctx.alertPrivacy || createLlmIpcPrivacy("alert");
  const authorization = ctx.coreAuthorization;
  if (!authorization || typeof authorization.authorize !== "function") {
    throw new TypeError("LLM alert IPC authorization is required");
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
    "llm:get-alert-history",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid alert read input count");
        }
        const options = normalizeReadOptions(args[0] ?? {});
        if (!database) {
          return [];
        }

        let sql = `
          SELECT * FROM llm_alert_history
          WHERE user_id = ?
        `;
        const params = [actorDid];
        if (options.level) {
          sql += " AND level = ?";
          params.push(options.level);
        }
        if (!options.includesDismissed) {
          sql += " AND dismissed = 0";
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(options.limit);

        const alerts = database.prepare(sql).all(...params);
        return alerts
          .map((alert) =>
            projectAlert(alert, safeParse(ownData(alert, "details"), privacy)),
          )
          .filter(Boolean);
      } catch {
        privacy.failure("get-alert-history");
        return [];
      }
    },
  );

  authorizedIpcMain.handle(
    "llm:add-alert",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid alert input count");
        }
        if (!database) {
          throw new Error("Database is not initialized");
        }
        const alert = normalizeAlert(args[0]);
        const now = Date.now();

        database
          .prepare(
            `
              INSERT INTO llm_alert_history (
                id, user_id, type, level, title, message, details,
                dismissed, dismissed_at, dismissed_by,
                related_provider, related_model, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?)
            `,
          )
          .run(
            randomUUID(),
            actorDid,
            alert.type,
            alert.level,
            alert.title,
            alert.message,
            alert.details ? JSON.stringify(alert.details) : null,
            alert.provider,
            alert.model,
            now,
            now,
          );

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("add-alert");
      }
    },
  );

  authorizedIpcMain.handle(
    "llm:dismiss-alert",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 1 || typeof args[0] !== "string") {
          throw new TypeError("Invalid alert reference count");
        }
        if (!database) {
          throw new Error("Database is not initialized");
        }
        const alertId = boundedText(args[0], 128);
        const now = Date.now();
        database
          .prepare(
            `
              UPDATE llm_alert_history
              SET dismissed = 1, dismissed_at = ?, dismissed_by = ?, updated_at = ?
              WHERE id = ? AND user_id = ?
            `,
          )
          .run(now, actorDid, now, alertId, actorDid);

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("dismiss-alert");
      }
    },
  );

  authorizedIpcMain.handle(
    "llm:clear-alert-history",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid alert cleanup input count");
        }
        if (!database) {
          throw new Error("Database is not initialized");
        }
        const { olderThanDays } = normalizeClearOptions(args[0] ?? {});

        if (olderThanDays !== undefined) {
          const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
          database
            .prepare(
              "DELETE FROM llm_alert_history WHERE user_id = ? AND created_at < ?",
            )
            .run(actorDid, cutoff);
        } else {
          database
            .prepare("DELETE FROM llm_alert_history WHERE user_id = ?")
            .run(actorDid);
        }

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("clear-alert-history");
      }
    },
  );
}

module.exports = { registerAlertHandlers };
