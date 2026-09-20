/**
 * LLM IPC handlers — model budget group.
 *
 * @module llm/llm-ipc-budgets
 */
const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const { projectModelBudget } = require("./llm-ipc-record-projection");

const SUCCESS_RECEIPT = Object.freeze({ success: true });
const MAX_BUDGET_USD = 1_000_000_000;
const SET_BUDGET_KEYS = new Set([
  "provider",
  "model",
  "dailyLimitUsd",
  "weeklyLimitUsd",
  "monthlyLimitUsd",
  "enabled",
  "alertOnLimit",
  "blockOnLimit",
]);
const DELETE_BUDGET_KEYS = new Set(["provider", "model"]);

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
    throw new TypeError("Invalid model budget actor");
  }
  return actorDid;
}

function descriptorsFor(value, allowedKeys) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid model budget input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid model budget field");
    }
  }
  return descriptors;
}

function boundedText(descriptors, key, maximum) {
  const value = descriptors[key]?.value;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Invalid model budget identifier");
  }
  return value;
}

function budgetLimit(descriptors, key) {
  const value = descriptors[key]?.value ?? 0;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_BUDGET_USD
  ) {
    throw new TypeError("Invalid model budget limit");
  }
  return value;
}

function budgetFlag(descriptors, key, fallback) {
  const descriptor = descriptors[key];
  if (descriptor === undefined) {
    return fallback;
  }
  if (typeof descriptor.value !== "boolean") {
    throw new TypeError("Invalid model budget flag");
  }
  return descriptor.value;
}

function normalizeBudget(value) {
  const descriptors = descriptorsFor(value, SET_BUDGET_KEYS);
  return Object.freeze({
    provider: boundedText(descriptors, "provider", 128),
    model: boundedText(descriptors, "model", 256),
    dailyLimitUsd: budgetLimit(descriptors, "dailyLimitUsd"),
    weeklyLimitUsd: budgetLimit(descriptors, "weeklyLimitUsd"),
    monthlyLimitUsd: budgetLimit(descriptors, "monthlyLimitUsd"),
    enabled: budgetFlag(descriptors, "enabled", true),
    alertOnLimit: budgetFlag(descriptors, "alertOnLimit", true),
    blockOnLimit: budgetFlag(descriptors, "blockOnLimit", false),
  });
}

function normalizeBudgetReference(value) {
  const descriptors = descriptorsFor(value, DELETE_BUDGET_KEYS);
  return Object.freeze({
    provider: boundedText(descriptors, "provider", 128),
    model: boundedText(descriptors, "model", 256),
  });
}

function registerBudgetHandlers(ctx) {
  const { ipcMain, database } = ctx;
  const privacy = ctx.budgetPrivacy || createLlmIpcPrivacy("budgets");
  const authorization = ctx.coreAuthorization;
  if (!authorization || typeof authorization.authorize !== "function") {
    throw new TypeError("LLM model budget IPC authorization is required");
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
    "llm:get-model-budgets",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected model budget input");
        }
        if (!database) {
          return [];
        }

        const budgets = database
          .prepare(
            "SELECT * FROM llm_model_budgets WHERE user_id = ? ORDER BY total_cost_usd DESC",
          )
          .all(actorDid);

        return budgets.map(projectModelBudget).filter(Boolean);
      } catch {
        privacy.failure("get-model-budgets");
        return [];
      }
    },
  );

  authorizedIpcMain.handle(
    "llm:set-model-budget",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid model budget input count");
        }
        if (!database) {
          throw new Error("Database is not initialized");
        }
        const config = normalizeBudget(args[0]);
        const now = Date.now();

        const upsert = database.prepare(`
          INSERT INTO llm_model_budgets (
            id, user_id, provider, model,
            daily_limit_usd, weekly_limit_usd, monthly_limit_usd,
            current_daily_spend, current_weekly_spend, current_monthly_spend,
            total_calls, total_tokens, total_cost_usd,
            enabled, alert_on_limit, block_on_limit,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, provider, model) DO UPDATE SET
            daily_limit_usd = excluded.daily_limit_usd,
            weekly_limit_usd = excluded.weekly_limit_usd,
            monthly_limit_usd = excluded.monthly_limit_usd,
            enabled = excluded.enabled,
            alert_on_limit = excluded.alert_on_limit,
            block_on_limit = excluded.block_on_limit,
            updated_at = excluded.updated_at
        `);

        upsert.run(
          randomUUID(),
          actorDid,
          config.provider,
          config.model,
          config.dailyLimitUsd,
          config.weeklyLimitUsd,
          config.monthlyLimitUsd,
          config.enabled ? 1 : 0,
          config.alertOnLimit ? 1 : 0,
          config.blockOnLimit ? 1 : 0,
          now,
          now,
        );

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("set-model-budget");
      }
    },
  );

  authorizedIpcMain.handle(
    "llm:delete-model-budget",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid model budget reference count");
        }
        if (!database) {
          throw new Error("Database is not initialized");
        }
        const { provider, model } = normalizeBudgetReference(args[0]);

        database
          .prepare(
            "DELETE FROM llm_model_budgets WHERE user_id = ? AND provider = ? AND model = ?",
          )
          .run(actorDid, provider, model);

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("delete-model-budget");
      }
    },
  );
}

module.exports = { registerBudgetHandlers };
