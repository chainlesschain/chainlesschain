/**
 * Plan Mode for CLI Agent REPL
 *
 * During plan mode, the AI can only use read-only tools (read_file, search_files, list_dir, list_skills).
 * Write/execute tools (write_file, edit_file, run_shell, git, run_skill) are blocked until the plan is approved.
 *
 * Lightweight port of desktop-app-vue/src/main/ai-engine/plan-mode/index.js
 */

import { EventEmitter } from "events";
import {
  createPlanSessionEvent,
  PLAN_PERSISTENCE_ERROR_CODES,
  PLAN_SESSION_LEGACY_SNAPSHOT_VERSION,
  PLAN_SESSION_SNAPSHOT_SCHEMA,
  PLAN_SESSION_SNAPSHOT_VERSION,
  PlanPersistenceError,
  PlanSessionPersistence,
} from "./plan-persistence.js";

export {
  isUnsafePlanSessionId,
  PLAN_PERSISTENCE_ERROR_CODES,
  PLAN_SESSION_EVENT_SCHEMA,
  PLAN_SESSION_EVENT_VERSION,
  PLAN_SESSION_LEGACY_SNAPSHOT_VERSION,
  PLAN_SESSION_SNAPSHOT_SCHEMA,
  PLAN_SESSION_SNAPSHOT_VERSION,
  planSnapshotPath,
  PlanPersistenceError,
  PlanSessionPersistence,
  resolvePlanStateDir,
} from "./plan-persistence.js";

/**
 * Plan item status
 */
export const PlanStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXECUTING: "executing",
  COMPLETED: "completed",
  FAILED: "failed",
};

/**
 * Plan mode states
 */
export const PlanState = {
  INACTIVE: "inactive",
  ANALYZING: "analyzing",
  PLAN_READY: "plan_ready",
  APPROVED: "approved",
  EXECUTING: "executing",
  COMPLETED: "completed",
  FAILED: "failed",
  REJECTED: "rejected",
};

/**
 * Tool categories for permission control
 */
const READ_TOOLS = new Set([
  "read_file",
  "search_files",
  "list_dir",
  "list_skills",
]);

const WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "move_file",
  "run_shell",
  "git",
  "run_skill",
]);

/**
 * A single item in an execution plan
 */
/**
 * Risk weights for tool categories
 */
const TOOL_RISK_WEIGHTS = {
  read_file: 1,
  search_files: 1,
  list_dir: 1,
  list_skills: 1,
  write_file: 2,
  edit_file: 2,
  delete_file: 2,
  move_file: 2,
  run_skill: 2,
  run_shell: 3,
  git: 3,
};

const IMPACT_MULTIPLIERS = {
  low: 1,
  medium: 2,
  high: 3,
};

export class PlanItem {
  constructor(data = {}) {
    this.id =
      data.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.order = data.order || 0;
    this.title = data.title || "";
    this.description = data.description || "";
    this.tool = data.tool || null;
    this.params = data.params || {};
    this.dependencies = data.dependencies || [];
    this.owner = data.owner ?? null;
    this.checkpoint = data.checkpoint ?? null;
    this.approval = data.approval ?? null;
    this.evidenceLineage = data.evidenceLineage ?? [];
    this.estimatedImpact = data.estimatedImpact || "low"; // low, medium, high
    this.status = data.status || PlanStatus.PENDING;
    this.result = data.result ?? null;
    this.error = data.error ?? null;
    this.turn = Number.isInteger(data.turn) && data.turn > 0 ? data.turn : null;
    this.toolUseId = data.toolUseId || null;
    this.startedAt = data.startedAt || null;
    this.completedAt = data.completedAt || null;
  }

  /**
   * Calculate risk score for this item.
   * Score = tool_weight × impact_multiplier
   */
  get riskScore() {
    const toolWeight = TOOL_RISK_WEIGHTS[this.tool] || 1;
    const impactMul = IMPACT_MULTIPLIERS[this.estimatedImpact] || 1;
    return toolWeight * impactMul;
  }
}

/**
 * An execution plan containing multiple items
 */
export class ExecutionPlan {
  constructor(data = {}) {
    this.id =
      data.id || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.title = data.title || "Untitled Plan";
    this.description = data.description || "";
    this.goal = data.goal || "";
    this.items = (data.items || []).map((i) => new PlanItem(i));
    this.status = data.status || PlanState.ANALYZING;
    this.version =
      Number.isInteger(data.version) && data.version > 0 ? data.version : 1;
    this.revisionOf = data.revisionOf || null;
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  addItem(item) {
    const planItem = item instanceof PlanItem ? item : new PlanItem(item);
    planItem.order = this.items.length;
    this.items.push(planItem);
    return planItem;
  }

  removeItem(itemId) {
    this.items = this.items.filter((i) => i.id !== itemId);
    this.items.forEach((item, idx) => {
      item.order = idx;
    });
  }

  getItem(itemId) {
    return this.items.find((i) => i.id === itemId);
  }

  /**
   * Topological sort of items by dependencies.
   * Returns items in execution order. Throws if cycle detected.
   */
  topologicalSort() {
    const itemMap = new Map(this.items.map((i) => [i.id, i]));
    const visited = new Set();
    const visiting = new Set();
    const sorted = [];

    const visit = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id))
        throw new Error(`Dependency cycle detected involving ${id}`);

      visiting.add(id);
      const item = itemMap.get(id);
      if (item && item.dependencies) {
        for (const depId of item.dependencies) {
          if (itemMap.has(depId)) {
            visit(depId);
          }
        }
      }
      visiting.delete(id);
      visited.add(id);
      if (item) sorted.push(item);
    };

    for (const item of this.items) {
      visit(item.id);
    }

    return sorted;
  }

  /**
   * Execute items in DAG topological order using provided executor.
   * If a dependency fails, downstream items are marked as blocked.
   *
   * @param {function} executor - async (item) => result
   * @returns {Array<{ item: PlanItem, success: boolean, result: any, error: string }>}
   */
  async executeInOrder(executor) {
    const sorted = this.topologicalSort();
    const results = [];
    const failedIds = new Set();

    for (const item of sorted) {
      // Check if any dependency failed
      const blocked = (item.dependencies || []).some((depId) =>
        failedIds.has(depId),
      );
      if (blocked) {
        item.status = PlanStatus.FAILED;
        item.error = "Blocked by failed dependency";
        failedIds.add(item.id);
        results.push({ item, success: false, result: null, error: item.error });
        continue;
      }

      item.status = PlanStatus.EXECUTING;
      try {
        const result = await executor(item);
        item.status = PlanStatus.COMPLETED;
        item.result = result;
        results.push({ item, success: true, result, error: null });
      } catch (err) {
        item.status = PlanStatus.FAILED;
        item.error = err.message;
        failedIds.add(item.id);
        results.push({
          item,
          success: false,
          result: null,
          error: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Calculate aggregate risk score for the plan.
   */
  getRiskAssessment() {
    const scores = this.items.map((i) => i.riskScore);
    const total = scores.reduce((sum, s) => sum + s, 0);
    const max = Math.max(...scores, 0);
    const avg = scores.length > 0 ? total / scores.length : 0;

    let level = "low";
    if (max >= 6 || avg >= 4) level = "high";
    else if (max >= 4 || avg >= 2) level = "medium";

    return {
      level,
      totalScore: total,
      maxScore: max,
      averageScore: Math.round(avg * 100) / 100,
      itemScores: this.items.map((i) => ({
        id: i.id,
        title: i.title,
        score: i.riskScore,
      })),
    };
  }
}

const PLAN_ITEM_SNAPSHOT_FIELDS = Object.freeze([
  "id",
  "order",
  "title",
  "description",
  "tool",
  "params",
  "dependencies",
  "owner",
  "checkpoint",
  "approval",
  "evidenceLineage",
  "estimatedImpact",
  "status",
  "result",
  "error",
  "turn",
  "toolUseId",
  "startedAt",
  "completedAt",
]);
const PLAN_SNAPSHOT_FIELDS = Object.freeze([
  "id",
  "title",
  "description",
  "goal",
  "items",
  "status",
  "version",
  "revisionOf",
  "createdAt",
]);
const PLAN_MANAGER_SNAPSHOT_FIELDS = Object.freeze([
  "state",
  "currentPlan",
  "history",
  "blockedToolLog",
  "executionLock",
]);
const LEGACY_PLAN_ITEM_SNAPSHOT_FIELDS = Object.freeze(
  PLAN_ITEM_SNAPSHOT_FIELDS.filter(
    (field) =>
      !["owner", "checkpoint", "approval", "evidenceLineage"].includes(field),
  ),
);
const LEGACY_PLAN_MANAGER_SNAPSHOT_FIELDS = Object.freeze([
  "state",
  "currentPlan",
  "history",
  "blockedToolLog",
]);
const LEGACY_SESSION_SNAPSHOT_FIELDS = Object.freeze([
  "schema",
  "version",
  "sessionId",
  "revision",
  "updatedAt",
  "state",
]);
const EXECUTION_LOCK_FIELDS = Object.freeze([
  "planId",
  "permissionMode",
  "approvedItemIds",
  "allowedTools",
  "createdAt",
]);
const AUTHORIZED_ITEM_STATUSES = new Set([
  PlanStatus.APPROVED,
  PlanStatus.EXECUTING,
  PlanStatus.COMPLETED,
  PlanStatus.FAILED,
]);
const AUTHORITY_STATES = new Set([
  PlanState.APPROVED,
  PlanState.EXECUTING,
  PlanState.COMPLETED,
  PlanState.FAILED,
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, fields, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has missing or unknown fields`);
  }
}

function cloneJsonValue(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new Error(`${label} must be JSON-serializable`, { cause: error });
  }
}

function optionalString(value, label) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function serializePlanItem(item) {
  return {
    id: item.id,
    order: item.order,
    title: item.title,
    description: item.description,
    tool: item.tool,
    params: cloneJsonValue(item.params ?? {}, "plan item params"),
    dependencies: [...(item.dependencies || [])],
    owner: item.owner ?? null,
    checkpoint: cloneJsonValue(item.checkpoint ?? null, "plan checkpoint"),
    approval: cloneJsonValue(item.approval ?? null, "plan approval"),
    evidenceLineage: cloneJsonValue(
      item.evidenceLineage ?? [],
      "plan evidence lineage",
    ),
    estimatedImpact: item.estimatedImpact,
    status: item.status,
    result: cloneJsonValue(item.result ?? null, "plan item result"),
    error: item.error ?? null,
    turn: item.turn ?? null,
    toolUseId: item.toolUseId ?? null,
    startedAt: item.startedAt ?? null,
    completedAt: item.completedAt ?? null,
  };
}

function normalizePlanItem(value, index) {
  assertExactKeys(value, PLAN_ITEM_SNAPSHOT_FIELDS, "plan item");
  if (typeof value.id !== "string" || !value.id) {
    throw new Error("plan item id must be a non-empty string");
  }
  if (!Number.isSafeInteger(value.order) || value.order !== index) {
    throw new Error("plan item order is invalid");
  }
  if (
    typeof value.title !== "string" ||
    typeof value.description !== "string"
  ) {
    throw new Error("plan item title and description must be strings");
  }
  if (value.tool != null && typeof value.tool !== "string") {
    throw new Error("plan item tool must be a string or null");
  }
  if (!isPlainObject(value.params)) {
    throw new Error("plan item params must be an object");
  }
  if (
    !Array.isArray(value.dependencies) ||
    value.dependencies.some((dependency) => typeof dependency !== "string") ||
    new Set(value.dependencies).size !== value.dependencies.length
  ) {
    throw new Error("plan item dependencies must be unique strings");
  }
  if (value.owner != null && typeof value.owner !== "string") {
    throw new Error("plan item owner must be a string or null");
  }
  if (!Array.isArray(value.evidenceLineage)) {
    throw new Error("plan item evidenceLineage must be an array");
  }
  if (!Object.hasOwn(IMPACT_MULTIPLIERS, value.estimatedImpact)) {
    throw new Error("plan item estimatedImpact is invalid");
  }
  if (!Object.values(PlanStatus).includes(value.status)) {
    throw new Error("plan item status is invalid");
  }
  if (value.error != null && typeof value.error !== "string") {
    throw new Error("plan item error must be a string or null");
  }
  if (
    value.turn != null &&
    (!Number.isSafeInteger(value.turn) || value.turn < 1)
  ) {
    throw new Error("plan item turn must be a positive integer or null");
  }
  for (const [field, fieldValue] of [
    ["toolUseId", value.toolUseId],
    ["startedAt", value.startedAt],
    ["completedAt", value.completedAt],
  ]) {
    optionalString(fieldValue, `plan item ${field}`);
  }
  return serializePlanItem(value);
}

function migrateLegacyPlanItem(value, index) {
  assertExactKeys(value, LEGACY_PLAN_ITEM_SNAPSHOT_FIELDS, "legacy plan item");
  return normalizePlanItem(
    {
      ...value,
      owner: null,
      checkpoint: null,
      approval: null,
      evidenceLineage: [],
    },
    index,
  );
}

function serializePlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    goal: plan.goal,
    items: plan.items.map((item) => serializePlanItem(item)),
    status: plan.status,
    version: plan.version,
    revisionOf: plan.revisionOf,
    createdAt: plan.createdAt,
  };
}

function normalizePlan(value) {
  assertExactKeys(value, PLAN_SNAPSHOT_FIELDS, "execution plan");
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.createdAt !== "string" ||
    !value.createdAt
  ) {
    throw new Error("execution plan identity fields are invalid");
  }
  if (!Array.isArray(value.items)) {
    throw new Error("execution plan items must be an array");
  }
  if (!Object.values(PlanState).includes(value.status)) {
    throw new Error("execution plan status is invalid");
  }
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    throw new Error("execution plan version is invalid");
  }
  optionalString(value.revisionOf, "execution plan revisionOf");
  const items = value.items.map((item, index) =>
    normalizePlanItem(item, index),
  );
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("execution plan item ids must be unique");
  }
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    goal: value.goal,
    items,
    status: value.status,
    version: value.version,
    revisionOf: value.revisionOf,
    createdAt: value.createdAt,
  };
}

function migrateLegacyPlan(value) {
  assertExactKeys(value, PLAN_SNAPSHOT_FIELDS, "legacy execution plan");
  if (!Array.isArray(value.items)) {
    throw new Error("legacy execution plan items must be an array");
  }
  return normalizePlan({
    ...value,
    items: value.items.map((item, index) => migrateLegacyPlanItem(item, index)),
  });
}

function normalizeExecutionLock(value, plan) {
  assertExactKeys(value, EXECUTION_LOCK_FIELDS, "execution lock");
  if (
    value.planId !== plan.id ||
    typeof value.permissionMode !== "string" ||
    !value.permissionMode ||
    typeof value.createdAt !== "string" ||
    !value.createdAt ||
    !Array.isArray(value.approvedItemIds) ||
    !Array.isArray(value.allowedTools)
  ) {
    throw new Error("execution lock identity fields are invalid");
  }
  for (const [label, entries] of [
    ["approvedItemIds", value.approvedItemIds],
    ["allowedTools", value.allowedTools],
  ]) {
    if (
      entries.some((entry) => typeof entry !== "string" || !entry) ||
      new Set(entries).size !== entries.length
    ) {
      throw new Error(`execution lock ${label} must contain unique strings`);
    }
  }

  const itemMap = new Map(plan.items.map((item) => [item.id, item]));
  const approvedIds = new Set(value.approvedItemIds);
  for (const itemId of approvedIds) {
    const item = itemMap.get(itemId);
    if (!item || !AUTHORIZED_ITEM_STATUSES.has(item.status)) {
      throw new Error("execution lock references an unauthorized plan item");
    }
  }
  for (const item of plan.items) {
    if (
      AUTHORIZED_ITEM_STATUSES.has(item.status) !== approvedIds.has(item.id)
    ) {
      throw new Error("execution lock does not exactly cover authorized items");
    }
  }

  const expectedTools = new Set(READ_TOOLS);
  for (const itemId of approvedIds) {
    const tool = itemMap.get(itemId)?.tool;
    if (tool) expectedTools.add(tool);
  }
  if (
    expectedTools.size !== value.allowedTools.length ||
    value.allowedTools.some((tool) => !expectedTools.has(tool))
  ) {
    throw new Error("execution lock allowedTools widens or changes approval");
  }

  return Object.freeze({
    planId: value.planId,
    permissionMode: value.permissionMode,
    approvedItemIds: Object.freeze([...value.approvedItemIds]),
    allowedTools: Object.freeze([...value.allowedTools]),
    createdAt: value.createdAt,
  });
}

function emptyPlanManagerState() {
  return {
    state: PlanState.INACTIVE,
    currentPlan: null,
    history: [],
    blockedToolLog: [],
    executionLock: null,
  };
}

function serializeManagerState(manager) {
  return {
    state: manager.state,
    currentPlan: serializePlan(manager.currentPlan),
    history: manager.history.map((plan) => serializePlan(plan)),
    blockedToolLog: manager.blockedToolLog.map((entry) => ({ ...entry })),
    executionLock: manager.getExecutionLock(),
  };
}

function normalizeManagerState(value) {
  assertExactKeys(value, PLAN_MANAGER_SNAPSHOT_FIELDS, "plan manager state");
  if (!Object.values(PlanState).includes(value.state)) {
    throw new Error("plan manager state is invalid");
  }
  if (!Array.isArray(value.history) || !Array.isArray(value.blockedToolLog)) {
    throw new Error("plan manager history and blockedToolLog must be arrays");
  }
  const currentPlan =
    value.currentPlan == null ? null : normalizePlan(value.currentPlan);
  const history = value.history.map((plan) => normalizePlan(plan));
  const blockedToolLog = value.blockedToolLog.map((entry) => {
    assertExactKeys(
      entry,
      ["tool", "reason", "timestamp"],
      "blocked tool entry",
    );
    if (
      typeof entry.tool !== "string" ||
      typeof entry.reason !== "string" ||
      typeof entry.timestamp !== "string"
    ) {
      throw new Error("blocked tool entry is invalid");
    }
    return { ...entry };
  });

  if (value.state === PlanState.INACTIVE) {
    if (currentPlan !== null || value.executionLock !== null) {
      throw new Error(
        "inactive plan state cannot retain a plan authority lock",
      );
    }
  } else {
    if (!currentPlan || currentPlan.status !== value.state) {
      throw new Error("active plan state and current plan do not match");
    }
    if (value.state !== PlanState.ANALYZING) {
      const ids = new Set(currentPlan.items.map((item) => item.id));
      for (const item of currentPlan.items) {
        if (item.dependencies.some((dependency) => !ids.has(dependency))) {
          throw new Error("execution plan contains an unknown dependency");
        }
      }
    }
  }

  let executionLock = null;
  if (AUTHORITY_STATES.has(value.state)) {
    if (!value.executionLock) {
      throw new Error("authority-bearing plan state is missing executionLock");
    }
    executionLock = normalizeExecutionLock(value.executionLock, currentPlan);
  } else if (value.executionLock !== null) {
    throw new Error("non-executing plan state cannot carry executionLock");
  }

  return {
    state: value.state,
    currentPlan,
    history,
    blockedToolLog,
    executionLock,
  };
}

function migrateLegacySessionSnapshot(value, { sessionId }) {
  assertExactKeys(
    value,
    LEGACY_SESSION_SNAPSHOT_FIELDS,
    "legacy plan session snapshot",
  );
  if (
    value.schema !== PLAN_SESSION_SNAPSHOT_SCHEMA ||
    value.version !== PLAN_SESSION_LEGACY_SNAPSHOT_VERSION ||
    value.sessionId !== sessionId ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isFinite(value.updatedAt)
  ) {
    throw new Error("legacy plan session snapshot identity is invalid");
  }

  assertExactKeys(
    value.state,
    LEGACY_PLAN_MANAGER_SNAPSHOT_FIELDS,
    "legacy plan manager state",
  );
  if (
    ![PlanState.INACTIVE, PlanState.ANALYZING, PlanState.PLAN_READY].includes(
      value.state.state,
    )
  ) {
    throw new Error(
      "legacy authority-bearing plan state cannot be migrated without an executionLock",
    );
  }
  if (
    !Array.isArray(value.state.history) ||
    !Array.isArray(value.state.blockedToolLog)
  ) {
    throw new Error("legacy plan manager collections are invalid");
  }

  const state = normalizeManagerState({
    state: value.state.state,
    currentPlan:
      value.state.currentPlan == null
        ? null
        : migrateLegacyPlan(value.state.currentPlan),
    history: value.state.history.map((plan) => migrateLegacyPlan(plan)),
    blockedToolLog: value.state.blockedToolLog.map((entry) => ({ ...entry })),
    executionLock: null,
  });
  return {
    schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
    version: PLAN_SESSION_SNAPSHOT_VERSION,
    sessionId,
    revision: value.revision,
    updatedAt: value.updatedAt,
    event: createPlanSessionEvent({
      sessionId,
      revision: value.revision,
      previousRevision: value.revision - 1,
      type: "legacy-snapshot-migrated",
      timestamp: value.updatedAt,
    }),
    state,
  };
}

function persistenceFailure(error) {
  const known =
    error instanceof PlanPersistenceError ||
    String(error?.code || "").startsWith("PLAN_");
  return {
    error: known ? error.message : "Plan persistence failed",
    code: known ? error.code : PLAN_PERSISTENCE_ERROR_CODES.WRITE_FAILED,
    ...(Number.isSafeInteger(error?.expectedRevision)
      ? { expectedRevision: error.expectedRevision }
      : {}),
    ...(Number.isSafeInteger(error?.actualRevision)
      ? { actualRevision: error.actualRevision }
      : {}),
    ...(typeof error?.recoveryStrategy === "string"
      ? { recoveryStrategy: error.recoveryStrategy }
      : {}),
  };
}

/**
 * Plan Mode Manager
 *
 * Controls the plan mode lifecycle in the agent REPL.
 */
export class PlanModeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.state = PlanState.INACTIVE;
    this.currentPlan = null;
    this.history = [];
    this.blockedToolLog = [];
    this.executionLock = null;
    this._hookDb = null;
    const sessionId =
      typeof options.sessionId === "string" && options.sessionId
        ? options.sessionId
        : null;
    const memoryOnly =
      !sessionId ||
      options.memoryOnly === true ||
      options.persistence === false;
    Object.defineProperties(this, {
      sessionId: {
        value: sessionId,
        enumerable: true,
        writable: false,
        configurable: false,
      },
      memoryOnly: {
        value: memoryOnly,
        enumerable: true,
        writable: false,
        configurable: false,
      },
    });
    this.revision = 0;
    this.updatedAt = 0;
    this.lastEvent = null;
    this._persistence = null;

    if (!this.memoryOnly) {
      const supplied = options.persistence;
      this._persistence =
        supplied && typeof supplied === "object"
          ? supplied
          : new PlanSessionPersistence({
              ...(options.persistenceOptions || {}),
              ...(options.stateDir ? { stateDir: options.stateDir } : {}),
              normalizeState: normalizeManagerState,
              emptyState: emptyPlanManagerState,
              migrateSnapshot: migrateLegacySessionSnapshot,
            });
      if (typeof this._persistence.configureStateSchema === "function") {
        this._persistence.configureStateSchema({
          normalizeState: normalizeManagerState,
          emptyState: emptyPlanManagerState,
          migrateSnapshot: migrateLegacySessionSnapshot,
        });
      }
      const snapshot = this._persistence.load(this.sessionId);
      this._applyManagerState(snapshot.state);
      this.revision = snapshot.revision;
      this.updatedAt = snapshot.updatedAt;
      this.lastEvent = snapshot.event;
    }
  }

  _applyManagerState(value) {
    const normalized = normalizeManagerState(value);
    this.state = normalized.state;
    this.currentPlan = normalized.currentPlan
      ? new ExecutionPlan(normalized.currentPlan)
      : null;
    this.history = normalized.history.map((plan) => new ExecutionPlan(plan));
    this.blockedToolLog = normalized.blockedToolLog.map((entry) => ({
      ...entry,
    }));
    this.executionLock = normalized.executionLock;
  }

  _beginMutation() {
    if (!this._persistence) return { rollback: null };
    try {
      return {
        rollback: {
          state: serializeManagerState(this),
          revision: this.revision,
          updatedAt: this.updatedAt,
          event: this.lastEvent,
        },
      };
    } catch (error) {
      return { failure: persistenceFailure(error) };
    }
  }

  _commitMutation(transaction, eventType) {
    if (!this._persistence) {
      const previousRevision = this.revision;
      this.revision += 1;
      this.updatedAt = Date.now();
      this.lastEvent = this.sessionId
        ? createPlanSessionEvent({
            sessionId: this.sessionId,
            revision: this.revision,
            previousRevision,
            type: eventType,
            timestamp: this.updatedAt,
          })
        : null;
      if (this.lastEvent) this.emit("session-event", { ...this.lastEvent });
      return null;
    }

    try {
      const snapshot = this._persistence.compareAndSwap(
        this.sessionId,
        this.revision,
        serializeManagerState(this),
        eventType,
      );
      this.revision = snapshot.revision;
      this.updatedAt = snapshot.updatedAt;
      this.lastEvent = snapshot.event;
      this.emit("session-event", { ...this.lastEvent });
      return null;
    } catch (error) {
      const rollback = transaction?.rollback;
      if (rollback) {
        this._applyManagerState(rollback.state);
        this.revision = rollback.revision;
        this.updatedAt = rollback.updatedAt;
        this.lastEvent = rollback.event;
      }
      return persistenceFailure(error);
    }
  }

  getSessionSnapshot() {
    return {
      schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
      version: PLAN_SESSION_SNAPSHOT_VERSION,
      sessionId: this.sessionId,
      revision: this.revision,
      updatedAt: this.updatedAt,
      event: this.lastEvent ? { ...this.lastEvent } : null,
      state: serializeManagerState(this),
    };
  }

  reloadSession() {
    if (!this._persistence) {
      return { memoryOnly: true, snapshot: this.getSessionSnapshot() };
    }
    const snapshot = this._persistence.load(this.sessionId);
    this._applyManagerState(snapshot.state);
    this.revision = snapshot.revision;
    this.updatedAt = snapshot.updatedAt;
    this.lastEvent = snapshot.event;
    return { memoryOnly: false, snapshot: this.getSessionSnapshot() };
  }

  recoverSessionPersistence(strategy) {
    if (!this._persistence) {
      return { strategy, recovered: 0, memoryOnly: true };
    }
    return this._persistence.recover(this.sessionId, strategy);
  }

  /**
   * Set DB reference for hook execution.
   */
  setHookDb(db) {
    this._hookDb = db;
  }

  /**
   * Check if plan mode is active
   */
  isActive() {
    return this.state !== PlanState.INACTIVE;
  }

  /**
   * Enter plan mode
   */
  enterPlanMode(options = {}) {
    if (this.isActive()) {
      return { error: "Already in plan mode" };
    }
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    this.currentPlan = new ExecutionPlan({
      title: options.title || "New Plan",
      goal: options.goal || "",
    });
    this.state = PlanState.ANALYZING;
    this.blockedToolLog = [];
    this.executionLock = null;

    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-entered",
    );
    if (persistenceFailureResult) return persistenceFailureResult;

    this.emit("enter", { plan: this.currentPlan, state: this.state });
    this._fireHook("PlanModeEnter", { planId: this.currentPlan.id });
    return { plan: this.currentPlan, revision: this.revision };
  }

  /**
   * Exit plan mode
   */
  exitPlanMode(options = {}) {
    if (!this.isActive()) {
      return { error: "Not in plan mode" };
    }
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    if (options.savePlan && this.currentPlan) {
      this.history.push(this.currentPlan);
    }

    const plan = this.currentPlan;
    this.state = PlanState.INACTIVE;
    this.currentPlan = null;
    this.blockedToolLog = [];
    this.executionLock = null;

    const persistenceFailureResult = this._commitMutation(
      transaction,
      options.eventType || "plan-exited",
    );
    if (persistenceFailureResult) return persistenceFailureResult;

    this.emit("exit", { plan, reason: options.reason || "manual" });
    return { plan, revision: this.revision };
  }

  /**
   * Add a plan item
   */
  addPlanItem(itemData) {
    if (!this.currentPlan) {
      return { error: "No active plan" };
    }
    if (
      this.state !== PlanState.ANALYZING &&
      this.state !== PlanState.PLAN_READY
    ) {
      return { error: "Approved plan is locked" };
    }
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    const item = this.currentPlan.addItem(itemData);
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-item-added",
    );
    if (persistenceFailureResult) return persistenceFailureResult;
    this.emit("item-added", { planId: this.currentPlan.id, item });
    return { item, revision: this.revision };
  }

  /**
   * Mark the plan as ready for approval
   */
  markPlanReady() {
    if (this.state !== PlanState.ANALYZING) {
      return { error: "Plan is not in analyzing state" };
    }
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    this.state = PlanState.PLAN_READY;
    this.currentPlan.status = PlanState.PLAN_READY;
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-ready",
    );
    if (persistenceFailureResult) return persistenceFailureResult;
    this.emit("plan-ready", { plan: this.currentPlan });
    return { plan: this.currentPlan, revision: this.revision };
  }

  /**
   * Freeze the current draft and start a fresh plan version. This is the only
   * supported way to replace an awaiting-review plan, so old/new IDE diffs can
   * bind to stable plan IDs instead of guessing from mutable item arrays.
   */
  beginPlanRevision(options = {}) {
    if (!this.currentPlan || !this.isActive()) {
      return { error: "No active plan" };
    }
    if (
      this.state !== PlanState.ANALYZING &&
      this.state !== PlanState.PLAN_READY
    ) {
      return { error: "Approved plan is locked" };
    }
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    const previousPlan = this.currentPlan;
    this.history.push(previousPlan);
    this.currentPlan = new ExecutionPlan({
      title: options.title || previousPlan.title,
      goal: options.goal ?? previousPlan.goal,
      description: options.description ?? previousPlan.description,
      version: previousPlan.version + 1,
      revisionOf: previousPlan.id,
    });
    this.state = PlanState.ANALYZING;
    this.blockedToolLog = [];
    this.executionLock = null;
    const payload = {
      plan: this.currentPlan,
      previousPlan,
      reason: String(options.reason || "revision"),
    };
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-revised",
    );
    if (persistenceFailureResult) return persistenceFailureResult;
    this.emit("plan-revised", payload);
    this._fireHook("PlanRevised", {
      planId: this.currentPlan.id,
      previousPlanId: previousPlan.id,
      version: this.currentPlan.version,
      reason: payload.reason,
    });
    return { ...payload, revision: this.revision };
  }

  /**
   * Approve the plan (or specific items)
   */
  approvePlan(options = {}) {
    if (
      this.state !== PlanState.PLAN_READY &&
      this.state !== PlanState.ANALYZING
    ) {
      return { error: "Plan is not ready for approval" };
    }
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    const approvedItems = options.itemIds
      ? this.currentPlan.items.filter((i) => options.itemIds.includes(i.id))
      : this.currentPlan.items;

    for (const item of approvedItems) {
      item.status = PlanStatus.APPROVED;
    }

    this.executionLock = this._buildExecutionLock(
      approvedItems,
      options.permissionMode,
    );
    for (const item of approvedItems) {
      item.approval = {
        ...(isPlainObject(item.approval)
          ? cloneJsonValue(item.approval, "plan approval")
          : {}),
        decision: "approved",
        permissionMode: this.executionLock.permissionMode,
        approvedAt: this.executionLock.createdAt,
      };
    }
    this.state = PlanState.APPROVED;
    this.currentPlan.status = PlanState.APPROVED;
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-approved",
    );
    if (persistenceFailureResult) return persistenceFailureResult;
    this.emit("plan-approved", {
      plan: this.currentPlan,
      approvedCount: approvedItems.length,
      executionLock: this.getExecutionLock(),
    });
    this._fireHook("PlanApproved", {
      planId: this.currentPlan.id,
      itemCount: approvedItems.length,
      permissionMode: this.executionLock.permissionMode,
      allowedTools: this.executionLock.allowedTools,
    });
    return {
      plan: this.currentPlan,
      approvedCount: approvedItems.length,
      executionLock: this.getExecutionLock(),
      revision: this.revision,
    };
  }

  /** Build the immutable authority envelope used after plan approval. */
  _buildExecutionLock(approvedItems, permissionMode) {
    const approvedItemIds = approvedItems.map((item) => item.id);
    const allowedTools = [
      ...new Set([
        ...READ_TOOLS,
        ...approvedItems.map((item) => item.tool).filter(Boolean),
      ]),
    ].sort();
    return Object.freeze({
      planId: this.currentPlan.id,
      permissionMode: String(permissionMode || "default"),
      approvedItemIds: Object.freeze(approvedItemIds),
      allowedTools: Object.freeze(allowedTools),
      createdAt: new Date().toISOString(),
    });
  }

  /** Return a serializable copy so callers cannot widen the live lock. */
  getExecutionLock() {
    if (!this.executionLock) return null;
    return {
      ...this.executionLock,
      approvedItemIds: [...this.executionLock.approvedItemIds],
      allowedTools: [...this.executionLock.allowedTools],
    };
  }

  /**
   * Attribute a live tool call to the next approved item for that tool.
   * Read-only/helper calls that were not part of the approved plan remain
   * unbound instead of advancing an unrelated item.
   */
  startPlanItemForTool(toolName, context = {}) {
    if (
      !this.currentPlan ||
      (this.state !== PlanState.APPROVED && this.state !== PlanState.EXECUTING)
    ) {
      return null;
    }
    const tool = String(toolName || "");
    const item = this.currentPlan.items.find(
      (candidate) =>
        candidate.status === PlanStatus.APPROVED && candidate.tool === tool,
    );
    if (!item) return null;
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    item.status = PlanStatus.EXECUTING;
    item.toolUseId = context.toolUseId || null;
    item.turn =
      Number.isInteger(context.turn) && context.turn > 0 ? context.turn : null;
    item.startedAt = String(context.startedAt || new Date().toISOString());
    item.completedAt = null;
    item.result = null;
    item.error = null;
    if (context.owner !== undefined) item.owner = context.owner;
    if (context.checkpoint !== undefined) item.checkpoint = context.checkpoint;
    if (context.approval !== undefined) item.approval = context.approval;
    if (context.evidenceLineage !== undefined) {
      item.evidenceLineage = context.evidenceLineage;
    }
    this.state = PlanState.EXECUTING;
    this.currentPlan.status = PlanState.EXECUTING;
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-item-executing",
    );
    if (persistenceFailureResult) return persistenceFailureResult;
    this.emit("item-executing", { planId: this.currentPlan.id, item });
    this._fireHook("PlanItemExecute", {
      planId: this.currentPlan.id,
      itemId: item.id,
      tool: item.tool,
      toolUseId: item.toolUseId,
      turn: item.turn,
    });
    return item;
  }

  /** Settle a tool-attributed item and derive the aggregate execution state. */
  settlePlanItem(itemId, options = {}) {
    if (!this.currentPlan || !itemId) return null;
    const item = this.currentPlan.getItem(itemId);
    if (!item || item.status !== PlanStatus.EXECUTING) return null;
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    const success = options.success !== false;
    item.status = success ? PlanStatus.COMPLETED : PlanStatus.FAILED;
    item.completedAt = String(options.completedAt || new Date().toISOString());
    item.result = success ? (options.result ?? null) : null;
    item.error = success ? null : String(options.error || "tool failed");
    if (options.owner !== undefined) item.owner = options.owner;
    if (options.checkpoint !== undefined) item.checkpoint = options.checkpoint;
    if (options.approval !== undefined) item.approval = options.approval;
    if (options.evidenceLineage !== undefined) {
      item.evidenceLineage = options.evidenceLineage;
    }

    const tracked = this.currentPlan.items.filter((candidate) =>
      [
        PlanStatus.APPROVED,
        PlanStatus.EXECUTING,
        PlanStatus.COMPLETED,
        PlanStatus.FAILED,
      ].includes(candidate.status),
    );
    const allSettled =
      tracked.length > 0 &&
      tracked.every((candidate) =>
        [PlanStatus.COMPLETED, PlanStatus.FAILED].includes(candidate.status),
      );
    if (allSettled) {
      this.state = tracked.some(
        (candidate) => candidate.status === PlanStatus.FAILED,
      )
        ? PlanState.FAILED
        : PlanState.COMPLETED;
    } else {
      this.state = PlanState.EXECUTING;
    }
    this.currentPlan.status = this.state;
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-item-settled",
    );
    if (persistenceFailureResult) return persistenceFailureResult;
    this.emit("item-settled", {
      planId: this.currentPlan.id,
      item,
      success,
      state: this.state,
    });
    return item;
  }

  /**
   * Reject the plan
   */
  rejectPlan(reason = "") {
    if (!this.isActive()) {
      return { error: "No active plan" };
    }
    const transaction = this._beginMutation();
    if (transaction.failure) return transaction.failure;

    for (const item of this.currentPlan.items) {
      item.status = PlanStatus.REJECTED;
    }

    const plan = this.currentPlan;
    this.state = PlanState.REJECTED;
    this.currentPlan.status = PlanState.REJECTED;
    this.history.push(this.currentPlan);
    this.state = PlanState.INACTIVE;
    this.currentPlan = null;
    this.blockedToolLog = [];
    this.executionLock = null;
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-rejected",
    );
    if (persistenceFailureResult) return persistenceFailureResult;
    this._fireHook("PlanRejected", { planId: plan.id, reason });
    this.emit("exit", { plan, reason: reason || "rejected" });
    return { plan, revision: this.revision };
  }

  /**
   * Check if a tool is allowed in current state
   */
  isToolAllowed(toolName) {
    if (!this.isActive()) return true;
    if (
      this.state === PlanState.APPROVED ||
      this.state === PlanState.EXECUTING
    ) {
      const allowed =
        this.executionLock?.allowedTools.includes(toolName) === true;
      if (!allowed) this._recordBlockedTool(toolName, "execution-lock");
      return allowed;
    }

    // In analyzing/plan_ready state, only read tools are allowed
    if (READ_TOOLS.has(toolName)) return true;

    // Block write tools and log
    if (WRITE_TOOLS.has(toolName)) {
      this._recordBlockedTool(toolName, "planning");
      return false;
    }

    // Unknown tools are blocked by default in plan mode
    return false;
  }

  _recordBlockedTool(toolName, reason) {
    const transaction = this._beginMutation();
    if (transaction.failure) {
      this.emit("persistence-error", transaction.failure);
      return;
    }
    this.blockedToolLog.push({
      tool: toolName,
      reason,
      timestamp: new Date().toISOString(),
    });
    const persistenceFailureResult = this._commitMutation(
      transaction,
      "plan-tool-blocked",
    );
    if (persistenceFailureResult) {
      this.emit("persistence-error", persistenceFailureResult);
      return;
    }
    this.emit("tool-blocked", { toolName, reason });
  }

  /**
   * Generate a text summary of the current plan
   */
  generatePlanSummary() {
    if (!this.currentPlan) return "No active plan.";

    const plan = this.currentPlan;
    const lines = [
      `## Plan: ${plan.title}`,
      plan.goal ? `**Goal**: ${plan.goal}` : "",
      `**Status**: ${this.state}`,
      `**Items**: ${plan.items.length}`,
      "",
    ];

    for (const item of plan.items) {
      const icon =
        item.status === PlanStatus.COMPLETED
          ? "✅"
          : item.status === PlanStatus.FAILED
            ? "❌"
            : item.status === PlanStatus.APPROVED
              ? "✓"
              : "○";
      lines.push(
        `${icon} ${item.order + 1}. ${item.title} [${item.estimatedImpact}]`,
      );
      if (item.description) {
        lines.push(`   ${item.description}`);
      }
    }

    // Risk assessment
    const risk = plan.getRiskAssessment();
    lines.push("");
    lines.push(
      `**Risk**: ${risk.level} (total: ${risk.totalScore}, max: ${risk.maxScore}, avg: ${risk.averageScore})`,
    );

    if (this.blockedToolLog.length > 0) {
      lines.push("");
      lines.push(
        `**Blocked tools**: ${this.blockedToolLog.map((b) => b.tool).join(", ")}`,
      );
    }

    return lines.filter(Boolean).join("\n");
  }

  /**
   * Get risk assessment for current plan.
   */
  getRiskAssessment() {
    if (!this.currentPlan) return null;
    return this.currentPlan.getRiskAssessment();
  }

  /**
   * Execute approved plan items in DAG order.
   * @param {function} executor - async (item) => result
   */
  async executePlan(executor) {
    if (!this.currentPlan) return { error: "No active plan" };
    if (this.state !== PlanState.APPROVED)
      return { error: "Plan not approved" };
    const startTransaction = this._beginMutation();
    if (startTransaction.failure) return startTransaction.failure;

    this.state = PlanState.EXECUTING;
    this.currentPlan.status = PlanState.EXECUTING;
    const startPersistenceFailure = this._commitMutation(
      startTransaction,
      "plan-execution-started",
    );
    if (startPersistenceFailure) return startPersistenceFailure;
    // Keep the last committed state as the rollback point while the executor
    // mutates item statuses/results in memory. A failed final CAS/write must
    // not leave memory ahead of the durable execution-start snapshot.
    const settleTransaction = this._beginMutation();
    if (settleTransaction.failure) return settleTransaction.failure;

    const results = await this.currentPlan.executeInOrder(async (item) => {
      this._fireHook("PlanItemExecute", {
        planId: this.currentPlan.id,
        itemId: item.id,
        tool: item.tool,
      });
      return executor(item);
    });

    const allDone = results.every((r) => r.success);
    this.state = allDone ? PlanState.COMPLETED : PlanState.FAILED;
    this.currentPlan.status = allDone ? PlanState.COMPLETED : PlanState.FAILED;
    const settlePersistenceFailure = this._commitMutation(
      settleTransaction,
      "plan-execution-settled",
    );
    if (settlePersistenceFailure) return settlePersistenceFailure;

    return { results, success: allDone, revision: this.revision };
  }

  /**
   * Get plans history
   */
  getHistory() {
    return this.history;
  }

  /**
   * Fire a hook event (best-effort, non-blocking).
   */
  _fireHook(eventName, context) {
    if (!this._hookDb) return;
    // Dynamic import avoids a constructor-time dependency while keeping the
    // legacy SQLite registry behind the canonical Hooks v2 adapter.
    import("./hooks-v2-producers.js")
      .then(({ executeHooksV2Event }) => {
        executeHooksV2Event(eventName, context, {
          hookDb: this._hookDb,
          matchTarget: context?.target || eventName,
        }).catch(() => {});
      })
      .catch(() => {});
  }
}

// Singleton
let _instance = null;

export function getPlanModeManager(options = {}) {
  if (!_instance) {
    _instance = new PlanModeManager(options);
  }
  return _instance;
}

export function destroyPlanModeManager() {
  if (_instance) {
    _instance.removeAllListeners();
    _instance = null;
  }
}

// ===== V2 Surface: Plan Mode governance overlay (CLI v0.141.0) =====
export const PLAN_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const PLAN_STEP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _planPTrans = new Map([
  [
    PLAN_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PLAN_PROFILE_MATURITY_V2.ACTIVE,
      PLAN_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PLAN_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PLAN_PROFILE_MATURITY_V2.PAUSED,
      PLAN_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PLAN_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      PLAN_PROFILE_MATURITY_V2.ACTIVE,
      PLAN_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PLAN_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _planPTerminal = new Set([PLAN_PROFILE_MATURITY_V2.ARCHIVED]);
const _planSTrans = new Map([
  [
    PLAN_STEP_LIFECYCLE_V2.QUEUED,
    new Set([PLAN_STEP_LIFECYCLE_V2.RUNNING, PLAN_STEP_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    PLAN_STEP_LIFECYCLE_V2.RUNNING,
    new Set([
      PLAN_STEP_LIFECYCLE_V2.COMPLETED,
      PLAN_STEP_LIFECYCLE_V2.FAILED,
      PLAN_STEP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PLAN_STEP_LIFECYCLE_V2.COMPLETED, new Set()],
  [PLAN_STEP_LIFECYCLE_V2.FAILED, new Set()],
  [PLAN_STEP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _planPsV2 = new Map();
const _planSsV2 = new Map();
let _planMaxActivePerOwner = 6,
  _planMaxPendingStepsPerProfile = 15,
  _planIdleMs = 7 * 24 * 60 * 60 * 1000,
  _planStuckMs = 30 * 60 * 1000;
function _planPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _planCheckP(from, to) {
  const a = _planPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid plan profile transition ${from} → ${to}`);
}
function _planCheckS(from, to) {
  const a = _planSTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid plan step transition ${from} → ${to}`);
}
export function setMaxActivePlanProfilesPerOwnerV2(n) {
  _planMaxActivePerOwner = _planPos(n, "maxActivePlanProfilesPerOwner");
}
export function getMaxActivePlanProfilesPerOwnerV2() {
  return _planMaxActivePerOwner;
}
export function setMaxPendingPlanStepsPerProfileV2(n) {
  _planMaxPendingStepsPerProfile = _planPos(n, "maxPendingPlanStepsPerProfile");
}
export function getMaxPendingPlanStepsPerProfileV2() {
  return _planMaxPendingStepsPerProfile;
}
export function setPlanProfileIdleMsV2(n) {
  _planIdleMs = _planPos(n, "planProfileIdleMs");
}
export function getPlanProfileIdleMsV2() {
  return _planIdleMs;
}
export function setPlanStepStuckMsV2(n) {
  _planStuckMs = _planPos(n, "planStepStuckMs");
}
export function getPlanStepStuckMsV2() {
  return _planStuckMs;
}
export function _resetStatePlanModeV2() {
  _planPsV2.clear();
  _planSsV2.clear();
  _planMaxActivePerOwner = 6;
  _planMaxPendingStepsPerProfile = 15;
  _planIdleMs = 7 * 24 * 60 * 60 * 1000;
  _planStuckMs = 30 * 60 * 1000;
}
export function registerPlanProfileV2({ id, owner, goal, metadata } = {}) {
  if (!id) throw new Error("plan profile id required");
  if (!owner) throw new Error("plan profile owner required");
  if (_planPsV2.has(id))
    throw new Error(`plan profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    goal: goal || "",
    status: PLAN_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _planPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _planCountActive(owner) {
  let n = 0;
  for (const p of _planPsV2.values())
    if (p.owner === owner && p.status === PLAN_PROFILE_MATURITY_V2.ACTIVE) n++;
  return n;
}
export function activatePlanProfileV2(id) {
  const p = _planPsV2.get(id);
  if (!p) throw new Error(`plan profile ${id} not found`);
  _planCheckP(p.status, PLAN_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === PLAN_PROFILE_MATURITY_V2.PAUSED;
  if (!recovery && _planCountActive(p.owner) >= _planMaxActivePerOwner)
    throw new Error(`max active plan profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = PLAN_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pausePlanProfileV2(id) {
  const p = _planPsV2.get(id);
  if (!p) throw new Error(`plan profile ${id} not found`);
  _planCheckP(p.status, PLAN_PROFILE_MATURITY_V2.PAUSED);
  p.status = PLAN_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePlanProfileV2(id) {
  const p = _planPsV2.get(id);
  if (!p) throw new Error(`plan profile ${id} not found`);
  _planCheckP(p.status, PLAN_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PLAN_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPlanProfileV2(id) {
  const p = _planPsV2.get(id);
  if (!p) throw new Error(`plan profile ${id} not found`);
  if (_planPTerminal.has(p.status))
    throw new Error(`cannot touch terminal plan profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPlanProfileV2(id) {
  const p = _planPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPlanProfilesV2() {
  return [..._planPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
function _planCountPending(profileId) {
  let n = 0;
  for (const s of _planSsV2.values())
    if (
      s.profileId === profileId &&
      (s.status === PLAN_STEP_LIFECYCLE_V2.QUEUED ||
        s.status === PLAN_STEP_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}
export function createPlanStepV2({ id, profileId, action, metadata } = {}) {
  if (!id) throw new Error("plan step id required");
  if (!profileId) throw new Error("plan step profileId required");
  if (_planSsV2.has(id)) throw new Error(`plan step ${id} already exists`);
  if (!_planPsV2.has(profileId))
    throw new Error(`plan profile ${profileId} not found`);
  if (_planCountPending(profileId) >= _planMaxPendingStepsPerProfile)
    throw new Error(`max pending plan steps for profile ${profileId} reached`);
  const now = Date.now();
  const s = {
    id,
    profileId,
    action: action || "",
    status: PLAN_STEP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _planSsV2.set(id, s);
  return { ...s, metadata: { ...s.metadata } };
}
export function startPlanStepV2(id) {
  const s = _planSsV2.get(id);
  if (!s) throw new Error(`plan step ${id} not found`);
  _planCheckS(s.status, PLAN_STEP_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  s.status = PLAN_STEP_LIFECYCLE_V2.RUNNING;
  s.updatedAt = now;
  if (!s.startedAt) s.startedAt = now;
  return { ...s, metadata: { ...s.metadata } };
}
export function completePlanStepV2(id) {
  const s = _planSsV2.get(id);
  if (!s) throw new Error(`plan step ${id} not found`);
  _planCheckS(s.status, PLAN_STEP_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  s.status = PLAN_STEP_LIFECYCLE_V2.COMPLETED;
  s.updatedAt = now;
  if (!s.settledAt) s.settledAt = now;
  return { ...s, metadata: { ...s.metadata } };
}
export function failPlanStepV2(id, reason) {
  const s = _planSsV2.get(id);
  if (!s) throw new Error(`plan step ${id} not found`);
  _planCheckS(s.status, PLAN_STEP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  s.status = PLAN_STEP_LIFECYCLE_V2.FAILED;
  s.updatedAt = now;
  if (!s.settledAt) s.settledAt = now;
  if (reason) s.metadata.failReason = String(reason);
  return { ...s, metadata: { ...s.metadata } };
}
export function cancelPlanStepV2(id, reason) {
  const s = _planSsV2.get(id);
  if (!s) throw new Error(`plan step ${id} not found`);
  _planCheckS(s.status, PLAN_STEP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  s.status = PLAN_STEP_LIFECYCLE_V2.CANCELLED;
  s.updatedAt = now;
  if (!s.settledAt) s.settledAt = now;
  if (reason) s.metadata.cancelReason = String(reason);
  return { ...s, metadata: { ...s.metadata } };
}
export function getPlanStepV2(id) {
  const s = _planSsV2.get(id);
  if (!s) return null;
  return { ...s, metadata: { ...s.metadata } };
}
export function listPlanStepsV2() {
  return [..._planSsV2.values()].map((s) => ({
    ...s,
    metadata: { ...s.metadata },
  }));
}
export function autoPauseIdlePlanProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _planPsV2.values())
    if (
      p.status === PLAN_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _planIdleMs
    ) {
      p.status = PLAN_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPlanStepsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const s of _planSsV2.values())
    if (
      s.status === PLAN_STEP_LIFECYCLE_V2.RUNNING &&
      s.startedAt != null &&
      t - s.startedAt >= _planStuckMs
    ) {
      s.status = PLAN_STEP_LIFECYCLE_V2.FAILED;
      s.updatedAt = t;
      if (!s.settledAt) s.settledAt = t;
      s.metadata.failReason = "auto-fail-stuck";
      flipped.push(s.id);
    }
  return { flipped, count: flipped.length };
}
export function getPlanModeGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PLAN_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _planPsV2.values()) profilesByStatus[p.status]++;
  const stepsByStatus = {};
  for (const v of Object.values(PLAN_STEP_LIFECYCLE_V2)) stepsByStatus[v] = 0;
  for (const s of _planSsV2.values()) stepsByStatus[s.status]++;
  return {
    totalPlanProfilesV2: _planPsV2.size,
    totalPlanStepsV2: _planSsV2.size,
    maxActivePlanProfilesPerOwner: _planMaxActivePerOwner,
    maxPendingPlanStepsPerProfile: _planMaxPendingStepsPerProfile,
    planProfileIdleMs: _planIdleMs,
    planStepStuckMs: _planStuckMs,
    profilesByStatus,
    stepsByStatus,
  };
}

// === Iter28 V2 governance overlay: Pmodegov ===
export const PMODEGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const PMODEGOV_PLAN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  PLANNING: "planning",
  FINALIZED: "finalized",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _pmodegovPTrans = new Map([
  [
    PMODEGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PMODEGOV_PROFILE_MATURITY_V2.ACTIVE,
      PMODEGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PMODEGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PMODEGOV_PROFILE_MATURITY_V2.PAUSED,
      PMODEGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PMODEGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      PMODEGOV_PROFILE_MATURITY_V2.ACTIVE,
      PMODEGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PMODEGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pmodegovPTerminal = new Set([PMODEGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _pmodegovJTrans = new Map([
  [
    PMODEGOV_PLAN_LIFECYCLE_V2.QUEUED,
    new Set([
      PMODEGOV_PLAN_LIFECYCLE_V2.PLANNING,
      PMODEGOV_PLAN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PMODEGOV_PLAN_LIFECYCLE_V2.PLANNING,
    new Set([
      PMODEGOV_PLAN_LIFECYCLE_V2.FINALIZED,
      PMODEGOV_PLAN_LIFECYCLE_V2.FAILED,
      PMODEGOV_PLAN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PMODEGOV_PLAN_LIFECYCLE_V2.FINALIZED, new Set()],
  [PMODEGOV_PLAN_LIFECYCLE_V2.FAILED, new Set()],
  [PMODEGOV_PLAN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pmodegovPsV2 = new Map();
const _pmodegovJsV2 = new Map();
let _pmodegovMaxActive = 6,
  _pmodegovMaxPending = 15,
  _pmodegovIdleMs = 2592000000,
  _pmodegovStuckMs = 60 * 1000;
function _pmodegovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _pmodegovCheckP(from, to) {
  const a = _pmodegovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pmodegov profile transition ${from} → ${to}`);
}
function _pmodegovCheckJ(from, to) {
  const a = _pmodegovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pmodegov plan transition ${from} → ${to}`);
}
function _pmodegovCountActive(owner) {
  let c = 0;
  for (const p of _pmodegovPsV2.values())
    if (p.owner === owner && p.status === PMODEGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _pmodegovCountPending(profileId) {
  let c = 0;
  for (const j of _pmodegovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PMODEGOV_PLAN_LIFECYCLE_V2.QUEUED ||
        j.status === PMODEGOV_PLAN_LIFECYCLE_V2.PLANNING)
    )
      c++;
  return c;
}
export function setMaxActivePmodeProfilesPerOwnerV2(n) {
  _pmodegovMaxActive = _pmodegovPos(n, "maxActivePmodeProfilesPerOwner");
}
export function getMaxActivePmodeProfilesPerOwnerV2() {
  return _pmodegovMaxActive;
}
export function setMaxPendingPmodePlansPerProfileV2(n) {
  _pmodegovMaxPending = _pmodegovPos(n, "maxPendingPmodePlansPerProfile");
}
export function getMaxPendingPmodePlansPerProfileV2() {
  return _pmodegovMaxPending;
}
export function setPmodeProfileIdleMsV2(n) {
  _pmodegovIdleMs = _pmodegovPos(n, "pmodegovProfileIdleMs");
}
export function getPmodeProfileIdleMsV2() {
  return _pmodegovIdleMs;
}
export function setPmodePlanStuckMsV2(n) {
  _pmodegovStuckMs = _pmodegovPos(n, "pmodegovPlanStuckMs");
}
export function getPmodePlanStuckMsV2() {
  return _pmodegovStuckMs;
}
export function _resetStatePmodegovV2() {
  _pmodegovPsV2.clear();
  _pmodegovJsV2.clear();
  _pmodegovMaxActive = 6;
  _pmodegovMaxPending = 15;
  _pmodegovIdleMs = 2592000000;
  _pmodegovStuckMs = 60 * 1000;
}
export function registerPmodeProfileV2({ id, owner, template, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pmodegovPsV2.has(id))
    throw new Error(`pmodegov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    template: template || "default",
    status: PMODEGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pmodegovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePmodeProfileV2(id) {
  const p = _pmodegovPsV2.get(id);
  if (!p) throw new Error(`pmodegov profile ${id} not found`);
  const isInitial = p.status === PMODEGOV_PROFILE_MATURITY_V2.PENDING;
  _pmodegovCheckP(p.status, PMODEGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pmodegovCountActive(p.owner) >= _pmodegovMaxActive)
    throw new Error(
      `max active pmodegov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = PMODEGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pausedPmodeProfileV2(id) {
  const p = _pmodegovPsV2.get(id);
  if (!p) throw new Error(`pmodegov profile ${id} not found`);
  _pmodegovCheckP(p.status, PMODEGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = PMODEGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePmodeProfileV2(id) {
  const p = _pmodegovPsV2.get(id);
  if (!p) throw new Error(`pmodegov profile ${id} not found`);
  _pmodegovCheckP(p.status, PMODEGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PMODEGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPmodeProfileV2(id) {
  const p = _pmodegovPsV2.get(id);
  if (!p) throw new Error(`pmodegov profile ${id} not found`);
  if (_pmodegovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal pmodegov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPmodeProfileV2(id) {
  const p = _pmodegovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPmodeProfilesV2() {
  return [..._pmodegovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPmodePlanV2({ id, profileId, planId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pmodegovJsV2.has(id))
    throw new Error(`pmodegov plan ${id} already exists`);
  if (!_pmodegovPsV2.has(profileId))
    throw new Error(`pmodegov profile ${profileId} not found`);
  if (_pmodegovCountPending(profileId) >= _pmodegovMaxPending)
    throw new Error(
      `max pending pmodegov plans for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    planId: planId || "",
    status: PMODEGOV_PLAN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pmodegovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function planningPmodePlanV2(id) {
  const j = _pmodegovJsV2.get(id);
  if (!j) throw new Error(`pmodegov plan ${id} not found`);
  _pmodegovCheckJ(j.status, PMODEGOV_PLAN_LIFECYCLE_V2.PLANNING);
  const now = Date.now();
  j.status = PMODEGOV_PLAN_LIFECYCLE_V2.PLANNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completePlanPmodeV2(id) {
  const j = _pmodegovJsV2.get(id);
  if (!j) throw new Error(`pmodegov plan ${id} not found`);
  _pmodegovCheckJ(j.status, PMODEGOV_PLAN_LIFECYCLE_V2.FINALIZED);
  const now = Date.now();
  j.status = PMODEGOV_PLAN_LIFECYCLE_V2.FINALIZED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPmodePlanV2(id, reason) {
  const j = _pmodegovJsV2.get(id);
  if (!j) throw new Error(`pmodegov plan ${id} not found`);
  _pmodegovCheckJ(j.status, PMODEGOV_PLAN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PMODEGOV_PLAN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPmodePlanV2(id, reason) {
  const j = _pmodegovJsV2.get(id);
  if (!j) throw new Error(`pmodegov plan ${id} not found`);
  _pmodegovCheckJ(j.status, PMODEGOV_PLAN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PMODEGOV_PLAN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPmodePlanV2(id) {
  const j = _pmodegovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPmodePlansV2() {
  return [..._pmodegovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPausedIdlePmodeProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pmodegovPsV2.values())
    if (
      p.status === PMODEGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pmodegovIdleMs
    ) {
      p.status = PMODEGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPmodePlansV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _pmodegovJsV2.values())
    if (
      j.status === PMODEGOV_PLAN_LIFECYCLE_V2.PLANNING &&
      j.startedAt != null &&
      t - j.startedAt >= _pmodegovStuckMs
    ) {
      j.status = PMODEGOV_PLAN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getPmodegovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PMODEGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _pmodegovPsV2.values()) profilesByStatus[p.status]++;
  const plansByStatus = {};
  for (const v of Object.values(PMODEGOV_PLAN_LIFECYCLE_V2))
    plansByStatus[v] = 0;
  for (const j of _pmodegovJsV2.values()) plansByStatus[j.status]++;
  return {
    totalPmodeProfilesV2: _pmodegovPsV2.size,
    totalPmodePlansV2: _pmodegovJsV2.size,
    maxActivePmodeProfilesPerOwner: _pmodegovMaxActive,
    maxPendingPmodePlansPerProfile: _pmodegovMaxPending,
    pmodegovProfileIdleMs: _pmodegovIdleMs,
    pmodegovPlanStuckMs: _pmodegovStuckMs,
    profilesByStatus,
    plansByStatus,
  };
}
