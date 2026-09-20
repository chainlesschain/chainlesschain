"use strict";

const {
  boundedNumber,
  boundedString,
  ownData,
} = require("./llm-ipc-success-projection");

const MAX_MESSAGE_LENGTH = 16384;

function numberField(row, key) {
  return boundedNumber(ownData(row, key)) ?? 0;
}

function projectAlertDetails(value) {
  if (value == null) {
    return null;
  }
  const budgetType = boundedString(ownData(value, "budgetType"));
  const percentage = boundedNumber(ownData(value, "percentage"));
  const spent = boundedNumber(ownData(value, "spent"));
  const limit = boundedNumber(ownData(value, "limit"));
  if (
    budgetType === undefined &&
    percentage === undefined &&
    spent === undefined &&
    limit === undefined
  ) {
    return null;
  }
  return Object.freeze({
    ...(budgetType === undefined ? {} : { budgetType }),
    ...(percentage === undefined ? {} : { percentage }),
    ...(spent === undefined ? {} : { spent }),
    ...(limit === undefined ? {} : { limit }),
  });
}

function projectAlert(row, parsedDetails) {
  const id = boundedString(ownData(row, "id"));
  const type = boundedString(ownData(row, "type"));
  const level = boundedString(ownData(row, "level"));
  const title = boundedString(ownData(row, "title"), MAX_MESSAGE_LENGTH);
  const message = boundedString(ownData(row, "message"), MAX_MESSAGE_LENGTH);
  if (
    id === undefined ||
    type === undefined ||
    level === undefined ||
    message === undefined
  ) {
    return null;
  }
  return Object.freeze({
    id,
    type,
    level,
    ...(title === undefined ? {} : { title }),
    message,
    details: projectAlertDetails(parsedDetails),
    dismissed: ownData(row, "dismissed") === 1,
    timestamp: numberField(row, "created_at"),
  });
}

function projectModelBudget(row) {
  const provider = boundedString(ownData(row, "provider"));
  const model = boundedString(ownData(row, "model"));
  if (provider === undefined || model === undefined) {
    return null;
  }
  return Object.freeze({
    provider,
    model,
    daily_limit_usd: numberField(row, "daily_limit_usd"),
    weekly_limit_usd: numberField(row, "weekly_limit_usd"),
    monthly_limit_usd: numberField(row, "monthly_limit_usd"),
    current_daily_spend: numberField(row, "current_daily_spend"),
    current_weekly_spend: numberField(row, "current_weekly_spend"),
    current_monthly_spend: numberField(row, "current_monthly_spend"),
    total_calls: numberField(row, "total_calls"),
    total_tokens: numberField(row, "total_tokens"),
    total_cost_usd: numberField(row, "total_cost_usd"),
    enabled: ownData(row, "enabled") === 1,
    alertOnLimit: ownData(row, "alert_on_limit") === 1,
    blockOnLimit: ownData(row, "block_on_limit") === 1,
  });
}

function projectRetentionConfig(row) {
  if (!row) {
    return null;
  }
  return Object.freeze({
    usageLogRetentionDays: numberField(row, "usage_log_retention_days"),
    cacheRetentionDays: numberField(row, "cache_retention_days"),
    alertHistoryRetentionDays: numberField(row, "alert_history_retention_days"),
    autoCleanupEnabled: ownData(row, "auto_cleanup_enabled") === 1,
    lastCleanupAt: numberField(row, "last_cleanup_at"),
  });
}

module.exports = {
  projectAlert,
  projectModelBudget,
  projectRetentionConfig,
};
