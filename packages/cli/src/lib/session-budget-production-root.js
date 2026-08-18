import {
  openSessionBudget,
  SessionBudgetSidecarStore,
} from "./session-budget-runtime.js";
import { normalizeSessionResourceBudgetSnapshot } from "./session-resource-budget.js";

export const SESSION_BUDGET_ROOT_SCHEMA =
  "chainlesschain.session-budget-root/v1";

const OPTION_FIELDS = Object.freeze([
  ["sessionMaxConcurrent", "maxConcurrent", "--session-max-concurrent", true],
  ["sessionMaxSpawns", "maxSpawns", "--session-max-spawns", true],
  ["sessionMaxDepth", "maxDepth", "--session-max-depth", true],
  ["sessionMaxTurns", "maxTurns", "--session-max-turns", true],
  ["sessionMaxTokens", "maxTokens", "--session-max-tokens", true],
  ["sessionMaxCostUsd", "maxUsd", "--session-max-cost-usd", false],
  ["sessionMaxWallMs", "maxWallMs", "--session-max-wall-ms", true],
  ["sessionMaxToolMs", "maxToolMs", "--session-max-tool-ms", true],
]);

const LIMIT_FIELDS = Object.freeze(
  OPTION_FIELDS.map(([, field, flag, integer]) => ({
    field,
    flag,
    integer,
  })),
);

function normalizeLimit(raw, flag, { integer, allowZero = false } = {}) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    (allowZero ? value < 0 : value <= 0) ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(
      `${flag} requires ${allowZero ? "a non-negative" : "a positive"}${integer ? " integer" : " number"}`,
    );
  }
  return value;
}

export function resolveSessionBudgetRootOptions(options = {}) {
  const limits = {};
  let hasLimit = false;
  for (const [optionName, field, flag, integer] of OPTION_FIELDS) {
    const value = normalizeLimit(options[optionName], flag, {
      integer,
      allowZero: field === "maxDepth",
    });
    if (value !== null) {
      limits[field] = value;
      hasLimit = true;
    }
  }
  return Object.freeze({
    schema: SESSION_BUDGET_ROOT_SCHEMA,
    enabled: options.sessionBudget === true || hasLimit,
    limits: Object.freeze(limits),
  });
}

export function normalizeSessionBudgetRootConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    const error = new TypeError("session budget root config must be an object");
    error.code = "CC_SESSION_BUDGET_CONFIG_INVALID";
    throw error;
  }
  try {
    if (config.schema !== SESSION_BUDGET_ROOT_SCHEMA) {
      throw new TypeError("session budget root schema is unsupported");
    }
    if (typeof config.enabled !== "boolean") {
      throw new TypeError("session budget root enabled flag is invalid");
    }
    if (
      !config.limits ||
      typeof config.limits !== "object" ||
      Array.isArray(config.limits)
    ) {
      throw new TypeError("session budget root limits must be an object");
    }
    const allowed = new Set(LIMIT_FIELDS.map(({ field }) => field));
    if (Object.keys(config.limits).some((field) => !allowed.has(field))) {
      throw new TypeError("session budget root contains an unknown limit");
    }
    const limits = {};
    for (const { field, flag, integer } of LIMIT_FIELDS) {
      const value = normalizeLimit(config.limits[field], flag, {
        integer,
        allowZero: field === "maxDepth",
      });
      if (value !== null) limits[field] = value;
    }
    if (!config.enabled && Object.keys(limits).length > 0) {
      throw new TypeError("disabled session budget root cannot contain limits");
    }
    return Object.freeze({
      schema: SESSION_BUDGET_ROOT_SCHEMA,
      enabled: config.enabled,
      limits: Object.freeze(limits),
    });
  } catch (error) {
    error.code ||= "CC_SESSION_BUDGET_CONFIG_INVALID";
    throw error;
  }
}

function combineSignals(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function budgetRootError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function openProductionSessionBudgetRoot(
  sessionId,
  config,
  {
    persist = false,
    signal = null,
    table = undefined,
    open = openSessionBudget,
    store = undefined,
    registry = undefined,
  } = {},
) {
  if (config?.enabled !== true) {
    return Object.freeze({
      enabled: false,
      options: Object.freeze({}),
      close: () => false,
    });
  }
  if (!persist || !sessionId) {
    throw budgetRootError(
      "CC_SESSION_BUDGET_REQUIRES_DURABLE_SESSION",
      "session budget root requires a durable --session/--resume/--continue target",
    );
  }
  if (typeof open !== "function") {
    throw new TypeError("session budget root requires an opener");
  }

  const handle = open(String(sessionId), {
    limits: config.limits || {},
    table,
    ...(store ? { store } : {}),
    ...(registry ? { registry } : {}),
  });
  let closed = false;
  try {
    const status = handle.status();
    if (status.recoveryRequired) {
      throw budgetRootError(
        "CC_SESSION_BUDGET_RECOVERY_REQUIRED",
        `session budget recovery is required for ${sessionId}; inspect it with \`cc session budget status ${sessionId}\``,
        {
          sessionId: String(sessionId),
          pendingRecovery: status.pendingRecovery,
        },
      );
    }
    const combinedSignal = combineSignals(signal, handle.budget.signal);
    return Object.freeze({
      enabled: true,
      sessionId: String(sessionId),
      handle,
      budget: handle.budget,
      options: Object.freeze({
        sessionBudget: handle.budget,
        ...(combinedSignal ? { signal: combinedSignal } : {}),
      }),
      close() {
        if (closed) return false;
        closed = true;
        return handle.close();
      },
    });
  } catch (error) {
    if (!closed) {
      closed = true;
      try {
        handle.close();
      } catch {
        // Preserve the admission/recovery failure that prevented dispatch.
      }
    }
    throw error;
  }
}

function projectPending(snapshot) {
  return [
    ...snapshot.inFlight.work.map((entry) => ({
      authorityId: entry.id,
      resourceType: "work",
      kind: entry.kind,
      ...(entry.depth !== undefined ? { depth: entry.depth } : {}),
      ...(entry.elapsedMs !== undefined ? { elapsedMs: entry.elapsedMs } : {}),
    })),
    ...snapshot.inFlight.tools.map((entry) => ({
      authorityId: entry.id,
      resourceType: "tool",
      kind: entry.kind,
      ...(entry.elapsedMs !== undefined ? { elapsedMs: entry.elapsedMs } : {}),
    })),
  ].sort((left, right) => left.authorityId.localeCompare(right.authorityId));
}

export function readProductionSessionBudget(
  sessionId,
  { store = new SessionBudgetSidecarStore() } = {},
) {
  const record = store.read(String(sessionId));
  if (!record) return null;
  const snapshot = normalizeSessionResourceBudgetSnapshot(record.snapshot);
  const pending = projectPending(snapshot);
  return Object.freeze({
    schema: SESSION_BUDGET_ROOT_SCHEMA,
    sessionId: String(sessionId),
    revision: record.revision,
    usageUnknown: record.usageUnknown === true,
    limits: Object.freeze({ ...snapshot.limits }),
    totals: Object.freeze({ ...snapshot.totals }),
    state: Object.freeze({ ...snapshot.state }),
    recoveryRequired: pending.length > 0,
    pendingRecovery: Object.freeze(
      pending.map((entry) => Object.freeze(entry)),
    ),
  });
}

export function adjudicateProductionSessionBudgetRecovery(
  sessionId,
  abandoned,
  {
    store = new SessionBudgetSidecarStore(),
    registry = new Map(),
    open = openSessionBudget,
  } = {},
) {
  if (!Array.isArray(abandoned) || abandoned.length === 0) {
    throw budgetRootError(
      "CC_SESSION_BUDGET_RECOVERY_IDS_REQUIRED",
      "session budget recovery requires every exact --abandon authority id",
    );
  }
  const handle = open(String(sessionId), { store, registry });
  let result;
  try {
    const pending = handle.budget.pendingRecovery();
    if (pending.length === 0) {
      throw budgetRootError(
        "CC_SESSION_BUDGET_RECOVERY_NOT_REQUIRED",
        `session budget recovery is not required for ${sessionId}`,
      );
    }
    result = handle.budget.adjudicateRecovery({ abandoned });
    if (!result.ok) {
      throw budgetRootError(
        "CC_SESSION_BUDGET_RECOVERY_INCOMPLETE",
        "session budget recovery requires the exact pending authority-id set",
        { pending: result.pending },
      );
    }
    return Object.freeze({
      schema: SESSION_BUDGET_ROOT_SCHEMA,
      sessionId: String(sessionId),
      abandoned: Object.freeze([...result.abandoned]),
      status: Object.freeze({ ...handle.status() }),
    });
  } finally {
    handle.close();
  }
}

export function sessionBudgetAdmissionError(reason, operation) {
  return budgetRootError(
    "CC_SESSION_BUDGET_EXHAUSTED",
    `session budget blocked ${operation}: ${reason || "session-aborted"}`,
    { budgetReason: reason || "session-aborted" },
  );
}

export function sessionBudgetUsageUnknownError(operation, callId = null) {
  return budgetRootError(
    "CC_SESSION_BUDGET_USAGE_UNKNOWN",
    `session budget requires usage adjudication after ${operation}`,
    {
      budgetReason: "provider-usage-unknown",
      ...(callId ? { callId: String(callId) } : {}),
    },
  );
}
