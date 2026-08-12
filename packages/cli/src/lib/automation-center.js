import { createHash } from "node:crypto";
import {
  automationExecutionAuthorityDigest,
  automationExecutionAuthoritySnapshot,
  inspectAutomationExecutionAuthority,
  reserveAutomationExecutionAuthority,
} from "./automation-execution-authority.js";
import {
  EXECUTION_STATUS,
  FLOW_STATUS,
  TRIGGER_TYPE,
  executeFlow,
  getFlow,
  listExecutions,
  listFlows,
  listTriggers,
  updateFlowStatus,
} from "./automation-engine.js";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeIdentifier,
} from "./scheduler-kernel/contract.js";

export const AUTOMATION_CENTER_SCHEMA = "chainlesschain.automation-center/v1";
export const AUTOMATION_CENTER_SCHEMA_VERSION = 1;
export const AUTOMATION_CENTER_ACTIONS = Object.freeze([
  "run_now",
  "pause",
  "resume",
]);

function centerError(code, message, details = undefined) {
  const error = new SchedulerKernelError(code, message, details);
  error.retryable = false;
  return error;
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.automation-center.v1\0", "utf8")
    .update(canonicalJson(value, "automationCenter"), "utf8")
    .digest("hex")}`;
}

function boundedText(value, maximum = 240) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, maximum);
}

function safeTriggerScope(trigger) {
  const config = trigger?.config || {};
  if (trigger.type === TRIGGER_TYPE.EVENT) {
    return {
      event: boundedText(config.event, 80) || null,
      origins: Array.isArray(config.scope?.origins)
        ? config.scope.origins
            .map((value) => boundedText(value, 64))
            .slice(0, 16)
        : [],
      senders: Array.isArray(config.scope?.senders)
        ? config.scope.senders
            .map((value) => boundedText(value, 96))
            .slice(0, 32)
        : [],
    };
  }
  if (trigger.type === TRIGGER_TYPE.SCHEDULE) {
    return { cron: boundedText(config.cron, 120) || null };
  }
  if (trigger.type === TRIGGER_TYPE.WEBHOOK) {
    // Webhook URLs often embed bearer material. The center reports that a
    // route is configured without reflecting the URL into privileged IDE UI.
    return {
      endpointConfigured: typeof config.url === "string" && Boolean(config.url),
    };
  }
  if (trigger.type === TRIGGER_TYPE.CONDITION) {
    return { expression: boundedText(config.expression, 240) || null };
  }
  return {};
}

function projectTrigger(trigger) {
  return {
    id: trigger.id,
    type: trigger.type,
    enabled: trigger.enabled === true,
    scope: safeTriggerScope(trigger),
    triggerCount: Number(trigger.triggerCount) || 0,
    lastTriggeredAt: trigger.lastTriggeredAt || null,
  };
}

function projectExecution(execution) {
  return {
    id: execution.id,
    status: execution.status,
    triggerType: execution.triggerType || null,
    durationMs: Number(execution.durationMs) || 0,
    startedAt: execution.startedAt || null,
    completedAt: execution.completedAt || null,
    error: execution.error ? boundedText(execution.error, 400) : null,
  };
}

function projectSecurity(db, flow, now) {
  try {
    const result = inspectAutomationExecutionAuthority(db, flow, { now });
    return {
      state: result.ready ? "ready" : "denied",
      ready: result.ready,
      principalId: result.snapshot.principalId,
      connectors: result.snapshot.connectors,
      permissions: result.permissions,
      budget: {
        revision: result.snapshot.budget.revision,
        windowMs: result.snapshot.budget.windowMs,
        maxRuns: result.snapshot.budget.maxRuns,
        maxActionSteps: result.snapshot.budget.maxActionSteps,
        ...result.window,
      },
      issue: null,
    };
  } catch (error) {
    const code = boundedText(
      error?.code || "AUTOMATION_EXECUTION_PREFLIGHT_FAILED",
      96,
    );
    return {
      state:
        code === "AUTOMATION_EXECUTION_BUDGET_REQUIRED" ||
        code === "AUTOMATION_EXECUTION_PRINCIPAL_REQUIRED"
          ? "unconfigured"
          : "invalid",
      ready: false,
      principalId:
        typeof flow.createdBy === "string" && flow.createdBy
          ? flow.createdBy
          : null,
      connectors: [],
      permissions: [],
      budget: null,
      issue: { code, message: boundedText(error?.message || error, 400) },
    };
  }
}

function action(id, available, reason, flowId, itemRevision) {
  return {
    id,
    available,
    reason: available ? null : reason,
    preview: available
      ? {
          executor: "cli",
          argv: [
            "automation",
            "center-action",
            flowId,
            id,
            "--expected-revision",
            itemRevision,
            "--json",
          ],
          mutates: true,
        }
      : null,
  };
}

function projectFlow(db, flow, { historyLimit, now }) {
  const triggers = listTriggers(db, flow.id).map(projectTrigger);
  const history = listExecutions(db, {
    flowId: flow.id,
    limit: historyLimit,
  }).map(projectExecution);
  const security = projectSecurity(db, flow, now);
  const content = {
    id: flow.id,
    name: boundedText(flow.name, 200),
    description: boundedText(flow.description, 500),
    status: flow.status,
    schedule: flow.schedule || null,
    updatedAt: flow.updatedAt || null,
    triggers,
    history,
    security,
  };
  const revision = digest(content);
  const active = flow.status === FLOW_STATUS.ACTIVE;
  const paused = flow.status === FLOW_STATUS.PAUSED;
  return {
    ...content,
    revision,
    actions: [
      action(
        "run_now",
        active && security.ready,
        !active
          ? "flow is not active"
          : "permission or budget preflight denied",
        flow.id,
        revision,
      ),
      action(
        "pause",
        active,
        "only an active flow can be paused",
        flow.id,
        revision,
      ),
      action(
        "resume",
        paused && security.ready,
        !paused
          ? "only a paused flow can be resumed"
          : "permission or budget preflight denied",
        flow.id,
        revision,
      ),
    ],
  };
}

export function buildAutomationCenterProjection(
  db,
  { limit = 100, historyLimit = 20, now = Date.now } = {},
) {
  if (typeof now !== "function") {
    throw centerError(
      "AUTOMATION_CENTER_CLOCK_REQUIRED",
      "automation center requires a clock",
    );
  }
  const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const boundedHistory = Math.max(1, Math.min(100, Number(historyLimit) || 20));
  const flows = listFlows(db, { limit: boundedLimit }).map((flow) =>
    projectFlow(db, flow, { historyLimit: boundedHistory, now }),
  );
  const summary = {
    total: flows.length,
    active: flows.filter((flow) => flow.status === FLOW_STATUS.ACTIVE).length,
    paused: flows.filter((flow) => flow.status === FLOW_STATUS.PAUSED).length,
    needsAttention: flows.filter(
      (flow) =>
        flow.security.ready !== true ||
        flow.history[0]?.status === EXECUTION_STATUS.FAILED,
    ).length,
  };
  return {
    schema: AUTOMATION_CENTER_SCHEMA,
    schemaVersion: AUTOMATION_CENTER_SCHEMA_VERSION,
    authority: "cli",
    connected: true,
    generatedAt: new Date(Number(now())).toISOString(),
    revision: digest({
      summary,
      flows: flows.map((flow) => ({ id: flow.id, revision: flow.revision })),
    }),
    summary,
    flows,
  };
}

function executionIdFor(flowId, revision) {
  return `exec-center-${createHash("sha256")
    .update(`${flowId}\0${revision}`, "utf8")
    .digest("hex")}`;
}

export function runAutomationCenterAction(
  db,
  { flowId, action: requestedAction, expectedRevision, now = Date.now } = {},
) {
  const id = normalizeIdentifier(flowId, "flowId");
  if (!AUTOMATION_CENTER_ACTIONS.includes(requestedAction)) {
    throw centerError(
      "AUTOMATION_CENTER_ACTION_INVALID",
      `unsupported automation center action: ${requestedAction}`,
    );
  }
  const flow = getFlow(db, id);
  if (!flow) {
    throw centerError(
      "AUTOMATION_CENTER_FLOW_NOT_FOUND",
      `automation flow not found: ${id}`,
    );
  }
  const item = projectFlow(db, flow, { historyLimit: 20, now });
  if (expectedRevision !== item.revision) {
    throw centerError(
      "AUTOMATION_CENTER_STALE",
      `automation flow changed before ${requestedAction}: ${id}`,
      { expectedRevision, currentRevision: item.revision },
    );
  }
  const capability = item.actions.find((entry) => entry.id === requestedAction);
  if (!capability?.available) {
    throw centerError(
      "AUTOMATION_CENTER_ACTION_UNAVAILABLE",
      capability?.reason ||
        `automation action is unavailable: ${requestedAction}`,
    );
  }

  let result;
  if (requestedAction === "pause") {
    result = updateFlowStatus(db, id, FLOW_STATUS.PAUSED);
  } else if (requestedAction === "resume") {
    result = updateFlowStatus(db, id, FLOW_STATUS.ACTIVE);
  } else {
    const authority = automationExecutionAuthoritySnapshot(db, flow);
    const occurrenceId = `automation-center:${id}:${item.revision.slice("sha256:".length)}`;
    reserveAutomationExecutionAuthority(
      db,
      flow,
      occurrenceId,
      authority,
      automationExecutionAuthorityDigest(authority, flow),
      { now },
    );
    result = executeFlow(db, id, {
      triggerType: TRIGGER_TYPE.MANUAL,
      inputData: { source: "automation-center" },
      executionId: executionIdFor(id, item.revision),
    });
  }
  return {
    schema: "chainlesschain.automation-center-action/v1",
    schemaVersion: 1,
    authority: "cli",
    flowId: id,
    action: requestedAction,
    previousRevision: item.revision,
    result,
  };
}
