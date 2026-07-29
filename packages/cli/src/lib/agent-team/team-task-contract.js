/**
 * Pure task-level contract resolution for `cc team`.
 *
 * A task may request execution settings in `task.agent` or `task.policy`.
 * Policy has precedence over agent when both declare the same field. The
 * parent contract is always the security/resource ceiling:
 *
 *   - permission mode may only become more restrictive;
 *   - numeric budgets may only become smaller;
 *   - required checkpoint/worktree isolation may not be disabled.
 *
 * Invalid child values inherit the parent value. No I/O, clocks, environment
 * reads, or mutation are performed here, so the resolver is safe to share
 * between planning, execution, resume validation, and UI projection.
 */

import {
  SUBAGENT_PERMISSION_MODES,
  capBudget,
  tightenPermissionMode,
} from "../subagent-contract.js";

const hasOwn = (value, key) =>
  value != null && Object.prototype.hasOwnProperty.call(value, key);

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

function finitePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finitePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeModel(value) {
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model || null;
}

function normalizeRequired(value) {
  return value === true || value === false ? value : null;
}

/**
 * Pick a task request. `task.policy` deliberately wins over `task.agent`.
 * An explicit-but-invalid policy value therefore inherits the parent instead
 * of falling through to a less-authoritative agent declaration.
 */
function requestedField(task, field) {
  const policy = asObject(task?.policy);
  if (hasOwn(policy, field)) {
    return { specified: true, source: "task.policy", raw: policy[field] };
  }
  const agent = asObject(task?.agent);
  if (hasOwn(agent, field)) {
    return { specified: true, source: "task.agent", raw: agent[field] };
  }
  return { specified: false, source: null, raw: null };
}

function addAdjustment(adjustments, request, field, effective, reason) {
  adjustments.push({
    field,
    source: request.source,
    requested: request.raw,
    effective,
    reason,
  });
}

/**
 * Resolve one task's effective execution contract.
 *
 * @param {object} [options]
 * @param {object} [options.parent] Trusted run/team defaults and ceilings.
 * @param {object} [options.task] Task containing optional `agent` / `policy`.
 * @returns {{
 *   permissionMode:string,
 *   maxTurns:number|null,
 *   maxBudgetUsd:number|null,
 *   maxTokens:number|null,
 *   maxWallMs:number|null,
 *   checkpointRequired:boolean,
 *   worktreeRequired:boolean,
 *   model:string|null,
 *   adjustments:Array<{
 *     field:string,
 *     source:string,
 *     requested:unknown,
 *     effective:unknown,
 *     reason:string
 *   }>
 * }}
 */
export function resolveTeamTaskContract({ parent = {}, task = {} } = {}) {
  const defaults = asObject(parent);
  const work = asObject(task);
  const adjustments = [];

  const parentPermission = tightenPermissionMode(defaults.permissionMode, null);
  const permissionRequest = requestedField(work, "permissionMode");
  const requestedPermission =
    permissionRequest.specified &&
    SUBAGENT_PERMISSION_MODES.includes(permissionRequest.raw)
      ? permissionRequest.raw
      : null;
  const permissionMode = tightenPermissionMode(
    parentPermission,
    requestedPermission,
  );
  if (permissionRequest.specified) {
    if (requestedPermission == null) {
      addAdjustment(
        adjustments,
        permissionRequest,
        "permissionMode",
        permissionMode,
        "invalid-value-inherited",
      );
    } else if (permissionMode !== requestedPermission) {
      addAdjustment(
        adjustments,
        permissionRequest,
        "permissionMode",
        permissionMode,
        "parent-permission-ceiling",
      );
    }
  }

  const parentMaxTurns = finitePositiveInteger(defaults.maxTurns);
  const turnsRequest = requestedField(work, "maxTurns");
  const requestedMaxTurns = turnsRequest.specified
    ? finitePositiveInteger(turnsRequest.raw)
    : null;
  const maxTurns =
    requestedMaxTurns == null
      ? parentMaxTurns
      : parentMaxTurns == null
        ? requestedMaxTurns
        : Math.min(parentMaxTurns, requestedMaxTurns);
  if (turnsRequest.specified) {
    if (requestedMaxTurns == null) {
      addAdjustment(
        adjustments,
        turnsRequest,
        "maxTurns",
        maxTurns,
        "invalid-value-inherited",
      );
    } else if (maxTurns !== requestedMaxTurns) {
      addAdjustment(
        adjustments,
        turnsRequest,
        "maxTurns",
        maxTurns,
        "parent-budget-ceiling",
      );
    }
  }

  const budgetFields = [
    {
      field: "maxBudgetUsd",
      budgetKey: "costUsd",
      normalize: finitePositiveNumber,
    },
    {
      field: "maxTokens",
      budgetKey: "tokens",
      normalize: finitePositiveInteger,
    },
    {
      field: "maxWallMs",
      budgetKey: "timeMs",
      normalize: finitePositiveInteger,
    },
  ];
  const parentBudget = {};
  const requestedBudget = {};
  const budgetRequests = new Map();
  for (const spec of budgetFields) {
    parentBudget[spec.budgetKey] = spec.normalize(defaults[spec.field]);
    const request = requestedField(work, spec.field);
    budgetRequests.set(spec.field, request);
    requestedBudget[spec.budgetKey] = request.specified
      ? spec.normalize(request.raw)
      : null;
  }
  const effectiveBudget = capBudget(requestedBudget, parentBudget) || {
    tokens: null,
    costUsd: null,
    timeMs: null,
  };

  for (const spec of budgetFields) {
    const request = budgetRequests.get(spec.field);
    if (!request.specified) continue;
    const normalized = requestedBudget[spec.budgetKey];
    const effective = effectiveBudget[spec.budgetKey] ?? null;
    if (normalized == null) {
      addAdjustment(
        adjustments,
        request,
        spec.field,
        effective,
        "invalid-value-inherited",
      );
    } else if (effective !== normalized) {
      addAdjustment(
        adjustments,
        request,
        spec.field,
        effective,
        "parent-budget-ceiling",
      );
    }
  }

  const resolveRequirement = (field) => {
    const parentRequired = normalizeRequired(defaults[field]) === true;
    const request = requestedField(work, field);
    const requested = request.specified ? normalizeRequired(request.raw) : null;
    const effective =
      requested == null ? parentRequired : parentRequired || requested;
    if (request.specified) {
      if (requested == null) {
        addAdjustment(
          adjustments,
          request,
          field,
          effective,
          "invalid-value-inherited",
        );
      } else if (parentRequired && requested === false) {
        addAdjustment(adjustments, request, field, true, "parent-requirement");
      }
    }
    return effective;
  };

  const checkpointRequired = resolveRequirement("checkpointRequired");
  const worktreeRequired = resolveRequirement("worktreeRequired");

  const parentModel = normalizeModel(defaults.model);
  const modelRequest = requestedField(work, "model");
  const requestedModel = modelRequest.specified
    ? normalizeModel(modelRequest.raw)
    : null;
  const model = requestedModel ?? parentModel;
  if (modelRequest.specified && requestedModel == null) {
    addAdjustment(
      adjustments,
      modelRequest,
      "model",
      model,
      "invalid-value-inherited",
    );
  }

  return {
    permissionMode,
    maxTurns,
    maxBudgetUsd: effectiveBudget.costUsd ?? null,
    maxTokens: effectiveBudget.tokens ?? null,
    maxWallMs: effectiveBudget.timeMs ?? null,
    checkpointRequired,
    worktreeRequired,
    model,
    adjustments,
  };
}
