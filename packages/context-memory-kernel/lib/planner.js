"use strict";

const {
  CONTEXT_PLAN_SCHEMA,
  CONTEXT_PARTITIONS,
  KIND_PARTITION,
  DEFAULT_PARTITION_WEIGHTS,
  CONTEXT_KINDS,
  CONTEXT_ERROR_CODES,
} = require("./constants.js");
const { canonicalDigest } = require("./canonical.js");
const {
  normalizeContextItem,
  boundedInteger,
  boundedString,
  objectValue,
  assertKnownFields,
  assertScope,
} = require("./contracts.js");
const { invalidArgument, kernelError } = require("./errors.js");

const REQUEST_FIELDS = new Set([
  "modelWindowTokens",
  "reservedOutputTokens",
  "safetyMarginTokens",
  "recoveryReserveTokens",
  "items",
  "sink",
  "scopeAdmissions",
  "partitionCeilings",
  "partitionMinimums",
  "policyVersion",
  "modelProfile",
  "sessionHead",
  "memoryRevision",
  "now",
]);
const KIND_ORDER = new Map(CONTEXT_KINDS.map((kind, index) => [kind, index]));

function isProtected(item) {
  const binding = item.binding || {};
  return Boolean(
    item.pinned ||
      (item.kind === "system-policy" && ["host", "verified"].includes(item.trust)) ||
      binding.requiredForRecovery ||
      ["pending", "running", "waiting"].includes(binding.taskState) ||
      ["pending", "unknown"].includes(binding.toolOutcome) ||
      binding.approvalId ||
      binding.questionId ||
      binding.humanTaskId ||
      binding.cwdIdentity ||
      binding.worktreeIdentity ||
      binding.permissionCeilingDigest ||
      binding.budgetRevision !== undefined,
  );
}

function stableItemCompare(left, right) {
  const protectedOrder = Number(isProtected(right)) - Number(isProtected(left));
  if (protectedOrder !== 0) return protectedOrder;
  if (left.priority !== right.priority) return right.priority - left.priority;
  const kindOrder = KIND_ORDER.get(left.kind) - KIND_ORDER.get(right.kind);
  if (kindOrder !== 0) return kindOrder;
  const leftSequence = left.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  return left.itemId.localeCompare(right.itemId, "en");
}

function normalizeAdmissions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw invalidArgument("scopeAdmissions must contain 1-128 entries", { field: "scopeAdmissions" });
  }
  const output = value.map((entry, index) => {
    const input = objectValue(entry, `scopeAdmissions[${index}]`);
    assertKnownFields(input, new Set(["scope", "scopeId"]), `scopeAdmissions[${index}]`);
    return assertScope(input.scope, input.scopeId, `scopeAdmissions[${index}].scope`);
  });
  const keys = output.map((entry) => `${entry.scope}\0${entry.scopeId || ""}`);
  if (new Set(keys).size !== keys.length) throw invalidArgument("scopeAdmissions must not contain duplicates");
  return output;
}

function scopeAdmitted(item, admissions) {
  return admissions.some((entry) => entry.scope === item.scope && entry.scopeId === item.scopeId);
}

function normalizePartitionMap(value, field, inputBudget) {
  if (value === undefined) return {};
  const input = objectValue(value, field);
  const unknown = Object.keys(input).filter(
    (key) => !CONTEXT_PARTITIONS.includes(key) || key === "recovery-reserve",
  );
  if (unknown.length > 0) throw invalidArgument(`${field} contains unknown partitions`, { field, unknown });
  return Object.fromEntries(
    Object.entries(input).map(([key, amount]) => [
      key,
      boundedInteger(amount, `${field}.${key}`, { max: inputBudget }),
    ]),
  );
}

function deriveCeilings(selectableBudget, explicit, minimums) {
  const output = {};
  const partitions = CONTEXT_PARTITIONS.filter((entry) => entry !== "recovery-reserve");
  let assigned = 0;
  for (const partition of partitions) {
    const derived = Math.floor(selectableBudget * DEFAULT_PARTITION_WEIGHTS[partition]);
    output[partition] = Math.max(minimums[partition] || 0, explicit[partition] ?? derived);
    assigned += output[partition];
  }
  if (assigned < selectableBudget) output.conversation += selectableBudget - assigned;
  return output;
}

function validateToolGroup(group) {
  const roles = new Set(group.items.map((item) => item.binding?.toolRole).filter(Boolean));
  const hasPending = group.items.some((item) => ["pending", "unknown"].includes(item.binding?.toolOutcome));
  if (!hasPending && roles.has("call") !== roles.has("result")) {
    throw invalidArgument("settled tool evidence must contain both call and result", {
      toolCallId: group.items[0]?.binding?.toolCallId,
      itemIds: group.items.map((item) => item.itemId),
    });
  }
  const roleCounts = { call: 0, result: 0 };
  for (const item of group.items) {
    if (item.binding?.toolRole) roleCounts[item.binding.toolRole] += 1;
  }
  if (roleCounts.call > 1 || roleCounts.result > 1) {
    throw invalidArgument("tool evidence cannot contain duplicate call/result roles", {
      toolCallId: group.items[0]?.binding?.toolCallId,
    });
  }
}

function groupItems(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.binding?.toolCallId ? `tool:${item.binding.toolCallId}` : `item:${item.itemId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([key, entries]) => {
    const group = {
      key,
      items: entries.sort(stableItemCompare),
      protected: entries.some(isProtected),
      priority: Math.max(...entries.map((entry) => entry.priority)),
      first: [...entries].sort(stableItemCompare)[0],
    };
    if (key.startsWith("tool:")) validateToolGroup(group);
    return group;
  });
}

function stableGroupCompare(left, right) {
  if (left.protected !== right.protected) return left.protected ? -1 : 1;
  if (left.priority !== right.priority) return right.priority - left.priority;
  return stableItemCompare(left.first, right.first) || left.key.localeCompare(right.key, "en");
}

function normalizePlanRequest(input) {
  const request = objectValue(input, "ContextPlanRequest");
  assertKnownFields(request, REQUEST_FIELDS, "ContextPlanRequest");
  const modelWindowTokens = boundedInteger(request.modelWindowTokens, "modelWindowTokens", {
    min: 1,
    max: 16_777_216,
  });
  const reservedOutputTokens = boundedInteger(request.reservedOutputTokens, "reservedOutputTokens", {
    max: modelWindowTokens,
  });
  const safetyMarginTokens = boundedInteger(request.safetyMarginTokens ?? 0, "safetyMarginTokens", {
    max: modelWindowTokens,
  });
  const inputBudget = modelWindowTokens - reservedOutputTokens - safetyMarginTokens;
  if (inputBudget <= 0) {
    throw kernelError(CONTEXT_ERROR_CODES.CONTEXT_OVER_BUDGET, "model window leaves no input budget", {
      modelWindowTokens,
      reservedOutputTokens,
      safetyMarginTokens,
    });
  }
  const recoveryReserveTokens = boundedInteger(request.recoveryReserveTokens ?? 0, "recoveryReserveTokens", {
    max: inputBudget,
  });
  const selectableBudget = inputBudget - recoveryReserveTokens;
  if (selectableBudget <= 0) {
    throw kernelError(CONTEXT_ERROR_CODES.CONTEXT_OVER_BUDGET, "recovery reserve leaves no selectable input budget", {
      inputBudget,
      recoveryReserveTokens,
    });
  }
  if (!Array.isArray(request.items) || request.items.length > 100_000) {
    throw invalidArgument("items must be an array with at most 100000 entries", { field: "items" });
  }
  const items = request.items.map(normalizeContextItem);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.itemId)) throw invalidArgument("ContextItem IDs must be unique", { itemId: item.itemId });
    ids.add(item.itemId);
  }
  let now;
  try {
    now = request.now === undefined ? new Date().toISOString() : new Date(request.now).toISOString();
  } catch {
    throw invalidArgument("now must be a valid timestamp", { field: "now" });
  }
  const minimums = normalizePartitionMap(request.partitionMinimums, "partitionMinimums", inputBudget);
  const ceilings = deriveCeilings(
    selectableBudget,
    normalizePartitionMap(request.partitionCeilings, "partitionCeilings", inputBudget),
    minimums,
  );
  return {
    modelWindowTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    inputBudget,
    recoveryReserveTokens,
    selectableBudget,
    items,
    sink: boundedString(request.sink, "sink", { min: 1, max: 128 }),
    scopeAdmissions: normalizeAdmissions(request.scopeAdmissions),
    ceilings,
    minimums,
    policyVersion: boundedString(request.policyVersion, "policyVersion", { min: 1, max: 128 }),
    modelProfile: boundedString(request.modelProfile, "modelProfile", { min: 1, max: 256 }),
    sessionHead: boundedString(request.sessionHead, "sessionHead", { min: 1, max: 256 }),
    memoryRevision: boundedInteger(request.memoryRevision, "memoryRevision"),
    now,
  };
}

function planContext(input) {
  const request = normalizePlanRequest(input);
  const admitted = [];
  const dropped = [];
  for (const item of request.items) {
    let reason = null;
    if (item.expiresAt && Date.parse(item.expiresAt) <= Date.parse(request.now)) reason = "expired";
    else if (!scopeAdmitted(item, request.scopeAdmissions)) reason = "scope_denied";
    else if (!item.allowedSinks.includes("*") && !item.allowedSinks.includes(request.sink)) reason = "sink_denied";
    else if (item.kind === "system-policy" && !["host", "verified"].includes(item.trust)) {
      reason = "untrusted_system_policy";
    }
    if (reason) dropped.push({ itemId: item.itemId, digest: item.digest, reason, protected: isProtected(item) });
    else admitted.push(item);
  }

  const selected = [];
  const usedByPartition = Object.fromEntries(
    CONTEXT_PARTITIONS.map((partition) => [
      partition,
      partition === "recovery-reserve" ? request.recoveryReserveTokens : 0,
    ]),
  );
  let usedTokens = 0;
  for (const group of groupItems(admitted).sort(stableGroupCompare)) {
    const tokenCost = group.items.reduce((sum, item) => sum + item.tokenEstimate, 0);
    const groupPartitions = new Map();
    for (const item of group.items) {
      const partition = KIND_PARTITION[item.kind];
      groupPartitions.set(partition, (groupPartitions.get(partition) || 0) + item.tokenEstimate);
    }
    const fitsGlobal = usedTokens + tokenCost <= request.selectableBudget;
    const fitsPartitions = [...groupPartitions.entries()].every(
      ([partition, tokens]) => usedByPartition[partition] + tokens <= request.ceilings[partition],
    );
    if (group.protected && !fitsGlobal) {
      throw kernelError(CONTEXT_ERROR_CODES.CONTEXT_OVER_BUDGET, "protected context exceeds input budget", {
        inputBudget: request.inputBudget,
        selectableBudget: request.selectableBudget,
        usedTokens,
        requiredTokens: tokenCost,
        protectedItemIds: group.items.map((item) => item.itemId),
        usedByPartition,
      });
    }
    if (!fitsGlobal || (!fitsPartitions && !group.protected)) {
      const reason = fitsGlobal ? "partition_ceiling" : "input_budget";
      for (const item of group.items) {
        dropped.push({ itemId: item.itemId, digest: item.digest, reason, protected: false });
      }
      continue;
    }
    selected.push(...group.items);
    usedTokens += tokenCost;
    for (const [partition, tokens] of groupPartitions) usedByPartition[partition] += tokens;
  }

  selected.sort(stableItemCompare);
  dropped.sort((left, right) => left.itemId.localeCompare(right.itemId, "en"));
  const minimumShortfalls = Object.fromEntries(
    Object.entries(request.minimums)
      .filter(([partition, minimum]) => usedByPartition[partition] < minimum)
      .map(([partition, minimum]) => [partition, minimum - usedByPartition[partition]]),
  );
  const plan = {
    schema: CONTEXT_PLAN_SCHEMA,
    schemaVersion: 1,
    sessionHead: request.sessionHead,
    memoryRevision: request.memoryRevision,
    policyVersion: request.policyVersion,
    modelProfile: request.modelProfile,
    sink: request.sink,
    inputBudget: request.inputBudget,
    selectableBudget: request.selectableBudget,
    selectedTokens: usedTokens,
    partitions: Object.fromEntries(
      CONTEXT_PARTITIONS.map((partition) => [
        partition,
        {
          ceiling:
            partition === "recovery-reserve"
              ? request.recoveryReserveTokens
              : request.ceilings[partition],
          used: usedByPartition[partition],
        },
      ]),
    ),
    minimumShortfalls,
    selected,
    selectedItemIds: selected.map((item) => item.itemId),
    dropped,
    createdAt: request.now,
  };
  plan.digest = canonicalDigest(plan, "chainlesschain.context-plan/v1");
  return plan;
}

module.exports = {
  stableItemCompare,
  isProtected,
  normalizePlanRequest,
  planContext,
};
