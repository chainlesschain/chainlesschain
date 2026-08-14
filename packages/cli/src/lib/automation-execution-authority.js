import { createHash } from "node:crypto";
import {
  checkPermission,
  ensurePermissionTables,
} from "./permission-engine.js";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
} from "./scheduler-kernel/contract.js";

export const AUTOMATION_EXECUTE_PERMISSION = "automation:execute";
export const AUTOMATION_EXECUTION_AUTHORITY_SCHEMA_VERSION = 2;
export const AUTOMATION_EXECUTION_BOUNDARY_SCHEMA_VERSION = 1;
export const AUTOMATION_MIN_BUDGET_WINDOW_MS = 60_000;
export const AUTOMATION_MAX_BUDGET_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
export const AUTOMATION_MAX_BUDGET_VALUE = 1_000_000;

const CONNECTOR_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const AUTOMATION_EFFECTS = new Set(["read", "write", "destructive"]);

function authorityError(code, message, details = undefined, cause = undefined) {
  const error = new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
  error.retryable = false;
  return error;
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  if (
    !Number.isSafeInteger(normalized) ||
    normalized <= 0 ||
    normalized > maximum
  ) {
    throw authorityError(
      "AUTOMATION_EXECUTION_BUDGET_INVALID",
      `${field} must be a positive integer no greater than ${maximum}`,
    );
  }
  return normalized;
}

function nonnegativeInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw authorityError(
      "AUTOMATION_EXECUTION_BUDGET_STATE_INVALID",
      `${field} must be a non-negative safe integer`,
    );
  }
  return normalized;
}

function normalizeConnector(value, field) {
  const connector = normalizeIdentifier(value, field, { maxLength: 64 });
  if (!CONNECTOR_PATTERN.test(connector)) {
    throw authorityError(
      "AUTOMATION_EXECUTION_CONNECTOR_INVALID",
      `${field} must be a lowercase connector identifier`,
    );
  }
  return connector;
}

function normalizeDigest(value, field) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw authorityError(
      "AUTOMATION_EXECUTION_AUTHORITY_INVALID",
      `${field} must be a SHA-256 digest`,
    );
  }
  return value;
}

function normalizeFlowAuthorityInputs(flow) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw authorityError(
      "AUTOMATION_EXECUTION_FLOW_INVALID",
      "automation execution authority requires a flow",
    );
  }
  const flowId = normalizeIdentifier(flow.id, "automationFlow.id");
  if (
    typeof flow.createdBy !== "string" ||
    flow.createdBy.trim().length === 0
  ) {
    throw authorityError(
      "AUTOMATION_EXECUTION_PRINCIPAL_REQUIRED",
      `automation flow requires createdBy before unattended execution: ${flowId}`,
      { flowId },
    );
  }
  const principalId = normalizeIdentifier(
    flow.createdBy,
    "automationFlow.createdBy",
  );
  if (!Array.isArray(flow.nodes)) {
    throw authorityError(
      "AUTOMATION_EXECUTION_FLOW_INVALID",
      `automation flow nodes are malformed: ${flowId}`,
      { flowId },
    );
  }
  const connectors = [];
  const effects = [];
  let actionSteps = 0;
  for (let index = 0; index < flow.nodes.length; index += 1) {
    const node = flow.nodes[index];
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw authorityError(
        "AUTOMATION_EXECUTION_FLOW_INVALID",
        `automation flow node is malformed: ${flowId}`,
        { flowId, index },
      );
    }
    if ((node.type || "action") !== "action") continue;
    actionSteps += 1;
    const connector = normalizeConnector(
      node.connector,
      `automationFlow.nodes[${index}].connector`,
    );
    const action = normalizeIdentifier(
      node.action,
      `automationFlow.nodes[${index}].action`,
      { maxLength: 96 },
    );
    connectors.push(connector);
    const rawEffect =
      node.effect &&
      typeof node.effect === "object" &&
      !Array.isArray(node.effect)
        ? node.effect
        : {};
    const effect = String(rawEffect.effect || "write").toLowerCase();
    if (!AUTOMATION_EFFECTS.has(effect)) {
      throw authorityError(
        "AUTOMATION_EXECUTION_EFFECT_INVALID",
        `automationFlow.nodes[${index}].effect.effect is invalid`,
      );
    }
    const declaredScopes = Array.isArray(rawEffect.resourceScopes)
      ? [
          ...new Set(
            rawEffect.resourceScopes.map((scope, scopeIndex) =>
              normalizeIdentifier(
                scope,
                `automationFlow.nodes[${index}].effect.resourceScopes[${scopeIndex}]`,
                { maxLength: 256 },
              ),
            ),
          ),
        ].sort()
      : [];
    // The current connector engine is intentionally a simulator and performs
    // no outbound effect. Legacy flows therefore receive a deterministic,
    // flow-local simulated scope. A future real connector must declare its
    // actual resource scopes in the versioned flow definition before it can
    // pass this same boundary contract.
    const resourceScopes =
      declaredScopes.length > 0
        ? declaredScopes
        : [
            `automation-flow:${flowId}:node:${normalizeIdentifier(
              node.id,
              `automationFlow.nodes[${index}].id`,
            )}:simulated`,
          ];
    effects.push({
      nodeId: normalizeIdentifier(node.id, `automationFlow.nodes[${index}].id`),
      connector,
      action,
      effect,
      resourceScopes,
    });
  }
  return {
    flowId,
    principalId,
    connectors: [...new Set(connectors)].sort(),
    effects,
    actionSteps,
  };
}

export function automationConnectorPermission(connector) {
  return `automation:connector:${normalizeConnector(connector, "connector")}`;
}

export function automationRequiredPermissions(flow) {
  const inputs = normalizeFlowAuthorityInputs(flow);
  return [
    AUTOMATION_EXECUTE_PERMISSION,
    ...inputs.connectors.map(automationConnectorPermission),
  ];
}

export function ensureAutomationExecutionAuthorityTables(db) {
  if (
    !db ||
    typeof db.exec !== "function" ||
    typeof db.prepare !== "function"
  ) {
    throw authorityError(
      "AUTOMATION_EXECUTION_DATABASE_REQUIRED",
      "automation execution authority requires a compatible database",
    );
  }
  ensurePermissionTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_execution_budgets (
      flow_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      window_ms INTEGER NOT NULL,
      max_runs INTEGER NOT NULL,
      max_action_steps INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_execution_budget_usage (
      flow_id TEXT NOT NULL,
      budget_revision INTEGER NOT NULL,
      window_started_at_ms INTEGER NOT NULL,
      runs INTEGER NOT NULL,
      action_steps INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (flow_id, budget_revision, window_started_at_ms)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_execution_budget_reservations (
      occurrence_id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      budget_revision INTEGER NOT NULL,
      window_started_at_ms INTEGER NOT NULL,
      principal_id TEXT NOT NULL,
      authority_digest TEXT NOT NULL,
      action_steps INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS auto_execution_budget_reservations_window_idx
    ON auto_execution_budget_reservations
      (flow_id, budget_revision, window_started_at_ms)
  `);
}

function rowToBudget(row) {
  if (!row) return null;
  return {
    flowId: row.flow_id,
    revision: row.revision,
    windowMs: row.window_ms,
    maxRuns: row.max_runs,
    maxActionSteps: row.max_action_steps,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export function normalizeAutomationExecutionBudget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw authorityError(
      "AUTOMATION_EXECUTION_BUDGET_INVALID",
      "automation execution budget must be an object",
    );
  }
  const windowMs = positiveInteger(
    value.windowMs,
    "automationBudget.windowMs",
    AUTOMATION_MAX_BUDGET_WINDOW_MS,
  );
  if (windowMs < AUTOMATION_MIN_BUDGET_WINDOW_MS) {
    throw authorityError(
      "AUTOMATION_EXECUTION_BUDGET_INVALID",
      `automationBudget.windowMs must be at least ${AUTOMATION_MIN_BUDGET_WINDOW_MS}`,
    );
  }
  return {
    flowId: normalizeIdentifier(value.flowId, "automationBudget.flowId"),
    revision: positiveInteger(
      value.revision,
      "automationBudget.revision",
      Number.MAX_SAFE_INTEGER,
    ),
    windowMs,
    maxRuns: positiveInteger(
      value.maxRuns,
      "automationBudget.maxRuns",
      AUTOMATION_MAX_BUDGET_VALUE,
    ),
    maxActionSteps: positiveInteger(
      value.maxActionSteps,
      "automationBudget.maxActionSteps",
      AUTOMATION_MAX_BUDGET_VALUE,
    ),
  };
}

export function getAutomationExecutionBudget(db, flowId) {
  ensureAutomationExecutionAuthorityTables(db);
  const id = normalizeIdentifier(flowId, "flowId");
  return rowToBudget(
    db
      .prepare("SELECT * FROM auto_execution_budgets WHERE flow_id = ?")
      .get(id),
  );
}

export function setAutomationExecutionBudget(
  db,
  flowId,
  { windowMs, maxRuns, maxActionSteps } = {},
  { now = Date.now } = {},
) {
  ensureAutomationExecutionAuthorityTables(db);
  const id = normalizeIdentifier(flowId, "flowId");
  const flow = db.prepare("SELECT id FROM auto_flows WHERE id = ?").get(id);
  if (!flow) {
    throw authorityError(
      "AUTOMATION_EXECUTION_FLOW_NOT_FOUND",
      `automation flow not found: ${id}`,
    );
  }
  const normalizedWindow = positiveInteger(
    windowMs,
    "windowMs",
    AUTOMATION_MAX_BUDGET_WINDOW_MS,
  );
  if (normalizedWindow < AUTOMATION_MIN_BUDGET_WINDOW_MS) {
    throw authorityError(
      "AUTOMATION_EXECUTION_BUDGET_INVALID",
      `windowMs must be at least ${AUTOMATION_MIN_BUDGET_WINDOW_MS}`,
    );
  }
  const normalizedRuns = positiveInteger(
    maxRuns,
    "maxRuns",
    AUTOMATION_MAX_BUDGET_VALUE,
  );
  const normalizedSteps = positiveInteger(
    maxActionSteps,
    "maxActionSteps",
    AUTOMATION_MAX_BUDGET_VALUE,
  );
  const timestamp = normalizeEpochMs(Number(now()), "now");
  if (typeof db.transaction !== "function") {
    throw authorityError(
      "AUTOMATION_EXECUTION_TRANSACTION_REQUIRED",
      "automation execution budget requires transactional database support",
    );
  }
  const write = db.transaction(() => {
    const current = rowToBudget(
      db
        .prepare("SELECT * FROM auto_execution_budgets WHERE flow_id = ?")
        .get(id),
    );
    const revision = (current?.revision || 0) + 1;
    db.prepare(
      `INSERT INTO auto_execution_budgets
         (flow_id, revision, window_ms, max_runs, max_action_steps, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(flow_id) DO UPDATE SET
         revision = excluded.revision,
         window_ms = excluded.window_ms,
         max_runs = excluded.max_runs,
         max_action_steps = excluded.max_action_steps,
         updated_at_ms = excluded.updated_at_ms`,
    ).run(
      id,
      revision,
      normalizedWindow,
      normalizedRuns,
      normalizedSteps,
      current?.createdAtMs || timestamp,
      timestamp,
    );
    return rowToBudget(
      db
        .prepare("SELECT * FROM auto_execution_budgets WHERE flow_id = ?")
        .get(id),
    );
  });
  return write.immediate();
}

export function automationExecutionAuthoritySnapshot(db, flow) {
  const inputs = normalizeFlowAuthorityInputs(flow);
  const budget = getAutomationExecutionBudget(db, inputs.flowId);
  if (!budget) {
    throw authorityError(
      "AUTOMATION_EXECUTION_BUDGET_REQUIRED",
      `automation flow requires an execution budget: ${inputs.flowId}`,
      { flowId: inputs.flowId },
    );
  }
  return {
    schemaVersion: AUTOMATION_EXECUTION_AUTHORITY_SCHEMA_VERSION,
    flowId: inputs.flowId,
    principalId: inputs.principalId,
    requiredPermissions: [
      AUTOMATION_EXECUTE_PERMISSION,
      ...inputs.connectors.map(automationConnectorPermission),
    ],
    connectors: inputs.connectors,
    effectBoundary: {
      schemaVersion: AUTOMATION_EXECUTION_BOUNDARY_SCHEMA_VERSION,
      effects: inputs.effects,
    },
    actionSteps: inputs.actionSteps,
    budget: normalizeAutomationExecutionBudget(budget),
  };
}

export function normalizeAutomationExecutionAuthoritySnapshot(value, flow) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw authorityError(
      "AUTOMATION_EXECUTION_AUTHORITY_INVALID",
      "automation execution authority snapshot is required",
    );
  }
  const inputs = normalizeFlowAuthorityInputs(flow);
  const budget = normalizeAutomationExecutionBudget(value.budget);
  const requiredPermissions = automationRequiredPermissions(flow);
  const expectedEffectBoundary = {
    schemaVersion: AUTOMATION_EXECUTION_BOUNDARY_SCHEMA_VERSION,
    effects: inputs.effects,
  };
  const hasEffectBoundary = Object.prototype.hasOwnProperty.call(
    value,
    "effectBoundary",
  );
  const normalized = {
    schemaVersion: Number(value.schemaVersion),
    flowId: normalizeIdentifier(value.flowId, "executionAuthority.flowId"),
    principalId: normalizeIdentifier(
      value.principalId,
      "executionAuthority.principalId",
    ),
    requiredPermissions: Array.isArray(value.requiredPermissions)
      ? value.requiredPermissions.map((permission, index) =>
          normalizeIdentifier(
            permission,
            `executionAuthority.requiredPermissions[${index}]`,
          ),
        )
      : [],
    connectors: Array.isArray(value.connectors)
      ? value.connectors.map((connector, index) =>
          normalizeConnector(
            connector,
            `executionAuthority.connectors[${index}]`,
          ),
        )
      : [],
    effectBoundary:
      value.effectBoundary &&
      typeof value.effectBoundary === "object" &&
      !Array.isArray(value.effectBoundary)
        ? value.effectBoundary
        : null,
    actionSteps: Number(value.actionSteps),
    budget,
  };
  const boundaryMatches =
    canonicalJson(
      normalized.effectBoundary,
      "executionAuthority.effectBoundary",
    ) === canonicalJson(expectedEffectBoundary, "effectBoundary");
  // Schema v1 is the pre-write-scope authority snapshot already persisted by
  // released schedulers. It is accepted only for an otherwise exact flow and
  // is upgraded in memory to the deterministic boundary derived from that
  // immutable flow snapshot. New snapshots are v2 and must carry the boundary.
  const compatibleSchema =
    (normalized.schemaVersion === 1 &&
      (!hasEffectBoundary || boundaryMatches)) ||
    (normalized.schemaVersion ===
      AUTOMATION_EXECUTION_AUTHORITY_SCHEMA_VERSION &&
      hasEffectBoundary &&
      boundaryMatches);
  const valid =
    compatibleSchema &&
    normalized.flowId === inputs.flowId &&
    normalized.principalId === inputs.principalId &&
    canonicalJson(
      normalized.requiredPermissions,
      "executionAuthority.requiredPermissions",
    ) === canonicalJson(requiredPermissions, "requiredPermissions") &&
    canonicalJson(normalized.connectors, "executionAuthority.connectors") ===
      canonicalJson(inputs.connectors, "connectors") &&
    normalized.actionSteps === inputs.actionSteps &&
    budget.flowId === inputs.flowId;
  if (!valid) {
    throw authorityError(
      "AUTOMATION_EXECUTION_AUTHORITY_INVALID",
      `automation execution authority does not match flow: ${inputs.flowId}`,
    );
  }
  return { ...normalized, effectBoundary: expectedEffectBoundary };
}

export function automationExecutionAuthorityDigest(snapshot, flow) {
  const normalized = normalizeAutomationExecutionAuthoritySnapshot(
    snapshot,
    flow,
  );
  const digestSnapshot =
    normalized.schemaVersion === 1
      ? {
          schemaVersion: 1,
          flowId: normalized.flowId,
          principalId: normalized.principalId,
          requiredPermissions: normalized.requiredPermissions,
          connectors: normalized.connectors,
          actionSteps: normalized.actionSteps,
          budget: normalized.budget,
        }
      : normalized;
  return createHash("sha256")
    .update(
      normalized.schemaVersion === 1
        ? "chainlesschain.automation-execution-authority.v1\0"
        : "chainlesschain.automation-execution-authority.v2\0",
      "utf8",
    )
    .update(
      canonicalJson(digestSnapshot, "automationExecutionAuthority"),
      "utf8",
    )
    .digest("hex");
}

export function automationExecutionBoundary(snapshot, flow) {
  const normalized = normalizeAutomationExecutionAuthoritySnapshot(
    snapshot,
    flow,
  );
  return structuredClone(normalized.effectBoundary);
}

export function automationExecutionBoundaryDigest(snapshot, flow) {
  const boundary = automationExecutionBoundary(snapshot, flow);
  return createHash("sha256")
    .update("chainlesschain.automation-execution-boundary.v1\0", "utf8")
    .update(canonicalJson(boundary, "automationExecutionBoundary"), "utf8")
    .digest("hex");
}

export function assertAutomationRuntimeBoundary(
  snapshot,
  flow,
  { nodeId, connector, action, effect, resourceScopes } = {},
) {
  const boundary = automationExecutionBoundary(snapshot, flow);
  const id = normalizeIdentifier(nodeId, "runtimeEffect.nodeId");
  const expected = boundary.effects.find((entry) => entry.nodeId === id);
  const actual = {
    nodeId: id,
    connector: normalizeConnector(connector, "runtimeEffect.connector"),
    action: normalizeIdentifier(action, "runtimeEffect.action", {
      maxLength: 96,
    }),
    effect: String(effect || "").toLowerCase(),
    resourceScopes: Array.isArray(resourceScopes)
      ? [
          ...new Set(
            resourceScopes.map((scope, index) =>
              normalizeIdentifier(
                scope,
                `runtimeEffect.resourceScopes[${index}]`,
                { maxLength: 256 },
              ),
            ),
          ),
        ].sort()
      : [],
  };
  if (
    !expected ||
    canonicalJson(actual, "runtimeEffect") !==
      canonicalJson(expected, "expectedRuntimeEffect")
  ) {
    throw authorityError(
      "AUTOMATION_EXECUTION_WRITE_SCOPE_DENIED",
      `automation runtime effect exceeds its declared boundary: ${id}`,
      { flowId: boundary.flowId || flow?.id || null, nodeId: id },
    );
  }
  return actual;
}

export function classifyAutomationBoundaryError(error) {
  const code = String(error?.code || "");
  if (code === "AUTOMATION_EXECUTION_BUDGET_EXHAUSTED") {
    return { category: "budget", code };
  }
  if (
    code === "AUTOMATION_EXECUTION_BUDGET_REQUIRED" ||
    code === "AUTOMATION_EXECUTION_BUDGET_INVALID" ||
    code === "AUTOMATION_EXECUTION_BUDGET_STATE_INVALID" ||
    code === "AUTOMATION_EXECUTION_AUTHORITY_STALE"
  ) {
    return { category: "budget", code };
  }
  if (
    code === "AUTOMATION_EXECUTION_WRITE_SCOPE_DENIED" ||
    code === "AUTOMATION_EXECUTION_WRITE_SCOPE_REQUIRED" ||
    code === "AUTOMATION_EXECUTION_EFFECT_INVALID"
  ) {
    return { category: "write_scope", code };
  }
  if (code === "AUTOMATION_EXECUTION_PERMISSION_DENIED") {
    const denied = Array.isArray(error?.details?.permissions)
      ? error.details.permissions.map(String)
      : [];
    return {
      category: denied.some((permission) =>
        permission.startsWith("automation:connector:"),
      )
        ? "connector"
        : "permission",
      code,
    };
  }
  if (
    code === "AUTOMATION_EXECUTION_PRINCIPAL_REQUIRED" ||
    code === "AUTOMATION_EXECUTION_AUTHORITY_INVALID"
  ) {
    return { category: "permission", code };
  }
  if (code === "AUTOMATION_EXECUTION_CONNECTOR_INVALID") {
    return { category: "connector", code };
  }
  return null;
}

export function automationSchedulerAuthority(snapshot, flow, capability) {
  const normalized = normalizeAutomationExecutionAuthoritySnapshot(
    snapshot,
    flow,
  );
  const digest = automationExecutionAuthorityDigest(normalized, flow);
  return {
    schemaVersion: 1,
    principal: { type: "user", id: normalized.principalId },
    tenantId: null,
    workspaceId: null,
    requestedCapabilities: [
      normalizeIdentifier(capability, "capability"),
      ...normalized.connectors.map(
        (connector) => `automation.connector.${connector}`,
      ),
    ].sort(),
    authorizationRefs: {
      decisionId: null,
      policyRevision: `automation-budget:${normalized.budget.revision}:${digest.slice(0, 16)}`,
      grantIds: [],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

function currentWindow(budget, now) {
  return Math.floor(now / budget.windowMs) * budget.windowMs;
}

function usageRow(db, flowId, revision, windowStartedAtMs) {
  const row = db
    .prepare(
      `SELECT runs, action_steps
       FROM auto_execution_budget_usage
       WHERE flow_id = ? AND budget_revision = ? AND window_started_at_ms = ?`,
    )
    .get(flowId, revision, windowStartedAtMs);
  return {
    runs: row ? nonnegativeInteger(row.runs, "budgetUsage.runs") : 0,
    actionSteps: row
      ? nonnegativeInteger(row.action_steps, "budgetUsage.actionSteps")
      : 0,
  };
}

function reservationUsage(db, flowId, revision, windowStartedAtMs) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(action_steps), 0) AS action_steps
       FROM auto_execution_budget_reservations
       WHERE flow_id = ? AND budget_revision = ? AND window_started_at_ms = ?`,
    )
    .get(flowId, revision, windowStartedAtMs);
  return {
    runs: nonnegativeInteger(row?.runs ?? 0, "budgetReservations.runs"),
    actionSteps: nonnegativeInteger(
      row?.action_steps ?? 0,
      "budgetReservations.actionSteps",
    ),
  };
}

function assertUsageMatchesReservations(usage, reservations, flowId) {
  if (
    usage.runs !== reservations.runs ||
    usage.actionSteps !== reservations.actionSteps
  ) {
    throw authorityError(
      "AUTOMATION_EXECUTION_BUDGET_STATE_INVALID",
      `automation budget usage does not match reservations: ${flowId}`,
      { usage, reservations },
    );
  }
}

export function inspectAutomationExecutionAuthority(
  db,
  flow,
  { now = Date.now } = {},
) {
  const snapshot = automationExecutionAuthoritySnapshot(db, flow);
  const timestamp = normalizeEpochMs(Number(now()), "now");
  const permissions = snapshot.requiredPermissions.map((permission) => ({
    permission,
    allowed: checkPermission(db, snapshot.principalId, permission, {
      nowMs: timestamp,
    }),
  }));
  const windowStartedAtMs = currentWindow(snapshot.budget, timestamp);
  const usage = usageRow(
    db,
    snapshot.flowId,
    snapshot.budget.revision,
    windowStartedAtMs,
  );
  assertUsageMatchesReservations(
    usage,
    reservationUsage(
      db,
      snapshot.flowId,
      snapshot.budget.revision,
      windowStartedAtMs,
    ),
    snapshot.flowId,
  );
  return {
    ready:
      permissions.every((entry) => entry.allowed) &&
      usage.runs + 1 <= snapshot.budget.maxRuns &&
      usage.actionSteps + snapshot.actionSteps <=
        snapshot.budget.maxActionSteps,
    snapshot,
    digest: automationExecutionAuthorityDigest(snapshot, flow),
    permissions,
    window: {
      startedAtMs: windowStartedAtMs,
      endsAtMs: windowStartedAtMs + snapshot.budget.windowMs,
      usedRuns: usage.runs,
      usedActionSteps: usage.actionSteps,
      remainingRuns: Math.max(0, snapshot.budget.maxRuns - usage.runs),
      remainingActionSteps: Math.max(
        0,
        snapshot.budget.maxActionSteps - usage.actionSteps,
      ),
    },
  };
}

function assertSameReservation(row, expected) {
  const matches =
    row.flow_id === expected.flowId &&
    row.budget_revision === expected.budgetRevision &&
    row.principal_id === expected.principalId &&
    row.authority_digest === expected.authorityDigest &&
    row.action_steps === expected.actionSteps;
  if (!matches) {
    throw authorityError(
      "AUTOMATION_EXECUTION_RESERVATION_MISMATCH",
      `automation budget reservation identity is mismatched: ${expected.occurrenceId}`,
    );
  }
}

export function reserveAutomationExecutionAuthority(
  db,
  flow,
  occurrenceId,
  snapshot,
  snapshotDigest,
  { now = Date.now } = {},
) {
  ensureAutomationExecutionAuthorityTables(db);
  if (typeof db.transaction !== "function") {
    throw authorityError(
      "AUTOMATION_EXECUTION_TRANSACTION_REQUIRED",
      "automation execution budget requires transactional database support",
    );
  }
  const occurrence = normalizeIdentifier(occurrenceId, "occurrenceId");
  const normalized = normalizeAutomationExecutionAuthoritySnapshot(
    snapshot,
    flow,
  );
  const expectedDigest = automationExecutionAuthorityDigest(normalized, flow);
  if (
    normalizeDigest(snapshotDigest, "executionAuthorityDigest") !==
    expectedDigest
  ) {
    throw authorityError(
      "AUTOMATION_EXECUTION_AUTHORITY_INVALID",
      `automation execution authority digest is invalid: ${normalized.flowId}`,
    );
  }
  const timestamp = normalizeEpochMs(Number(now()), "now");
  const reserve = db.transaction(() => {
    const current = automationExecutionAuthoritySnapshot(db, flow);
    const comparableCurrent =
      normalized.schemaVersion === 1
        ? {
            schemaVersion: 1,
            flowId: current.flowId,
            principalId: current.principalId,
            requiredPermissions: current.requiredPermissions,
            connectors: current.connectors,
            actionSteps: current.actionSteps,
            budget: current.budget,
          }
        : current;
    const currentDigest = automationExecutionAuthorityDigest(
      comparableCurrent,
      flow,
    );
    if (currentDigest !== expectedDigest) {
      throw authorityError(
        "AUTOMATION_EXECUTION_AUTHORITY_STALE",
        `automation execution authority changed after enqueue: ${normalized.flowId}`,
      );
    }
    const denied = normalized.requiredPermissions.filter(
      (permission) =>
        !checkPermission(db, normalized.principalId, permission, {
          nowMs: timestamp,
        }),
    );
    if (denied.length > 0) {
      throw authorityError(
        "AUTOMATION_EXECUTION_PERMISSION_DENIED",
        `automation execution permission denied: ${normalized.flowId}`,
        { principalId: normalized.principalId, permissions: denied },
      );
    }
    const expected = {
      occurrenceId: occurrence,
      flowId: normalized.flowId,
      budgetRevision: normalized.budget.revision,
      principalId: normalized.principalId,
      authorityDigest: expectedDigest,
      actionSteps: normalized.actionSteps,
    };
    const existing = db
      .prepare(
        "SELECT * FROM auto_execution_budget_reservations WHERE occurrence_id = ?",
      )
      .get(occurrence);
    if (existing) {
      assertSameReservation(existing, expected);
      const usage = usageRow(
        db,
        normalized.flowId,
        normalized.budget.revision,
        existing.window_started_at_ms,
      );
      assertUsageMatchesReservations(
        usage,
        reservationUsage(
          db,
          normalized.flowId,
          normalized.budget.revision,
          existing.window_started_at_ms,
        ),
        normalized.flowId,
      );
      return {
        ...expected,
        windowStartedAtMs: existing.window_started_at_ms,
        deduplicated: true,
      };
    }
    const windowStartedAtMs = currentWindow(normalized.budget, timestamp);
    const usage = usageRow(
      db,
      normalized.flowId,
      normalized.budget.revision,
      windowStartedAtMs,
    );
    assertUsageMatchesReservations(
      usage,
      reservationUsage(
        db,
        normalized.flowId,
        normalized.budget.revision,
        windowStartedAtMs,
      ),
      normalized.flowId,
    );
    const nextRuns = usage.runs + 1;
    const nextActionSteps = usage.actionSteps + normalized.actionSteps;
    if (
      nextRuns > normalized.budget.maxRuns ||
      nextActionSteps > normalized.budget.maxActionSteps
    ) {
      throw authorityError(
        "AUTOMATION_EXECUTION_BUDGET_EXHAUSTED",
        `automation execution budget exhausted: ${normalized.flowId}`,
        {
          maxRuns: normalized.budget.maxRuns,
          maxActionSteps: normalized.budget.maxActionSteps,
          nextRuns,
          nextActionSteps,
          windowStartedAtMs,
        },
      );
    }
    db.prepare(
      `INSERT INTO auto_execution_budget_usage
         (flow_id, budget_revision, window_started_at_ms, runs, action_steps, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(flow_id, budget_revision, window_started_at_ms) DO UPDATE SET
         runs = excluded.runs,
         action_steps = excluded.action_steps,
         updated_at_ms = excluded.updated_at_ms`,
    ).run(
      normalized.flowId,
      normalized.budget.revision,
      windowStartedAtMs,
      nextRuns,
      nextActionSteps,
      timestamp,
    );
    db.prepare(
      `INSERT INTO auto_execution_budget_reservations
         (occurrence_id, flow_id, budget_revision, window_started_at_ms, principal_id, authority_digest, action_steps, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      occurrence,
      normalized.flowId,
      normalized.budget.revision,
      windowStartedAtMs,
      normalized.principalId,
      expectedDigest,
      normalized.actionSteps,
      timestamp,
    );
    return { ...expected, windowStartedAtMs, deduplicated: false };
  });
  return reserve.immediate();
}
