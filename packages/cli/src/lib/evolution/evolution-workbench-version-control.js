import { createHash } from "node:crypto";
import { types } from "node:util";
import { capturePruningData } from "./governed-wiki-pruning-journal.js";

import { filterEvolutionWorkbenchProjection } from "./evolution-workbench-projection.js";

export const EVOLUTION_WORKBENCH_VERSION_COMPARISON_SCHEMA =
  "chainlesschain.evolution-workbench-version-comparison/v1";
export const EVOLUTION_WORKBENCH_ROLLBACK_PLAN_SCHEMA =
  "chainlesschain.evolution-workbench-rollback-plan/v1";
export const EVOLUTION_WORKBENCH_ROLLBACK_RECEIPT_SCHEMA =
  "chainlesschain.evolution-workbench-rollback-receipt/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function digest(value, name) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${name} is invalid`);
  return value;
}

function string(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function verifiedProjection(projection) {
  filterEvolutionWorkbenchProjection(projection, { limit: 1 });
  return projection;
}

function candidate(projection, packetDigest, label) {
  digest(packetDigest, `${label} packetDigest`);
  const matches = projection.candidates.filter(
    (item) => item.packetDigest === packetDigest,
  );
  if (matches.length !== 1)
    throw new Error(`${label} Workbench version is missing or ambiguous`);
  return matches[0];
}

function summary(item) {
  return {
    packetDigest: item.packetDigest,
    candidateId: item.candidateId,
    contentDigest: item.candidateContentDigest,
    parentContentDigest: item.why.parentContentDigest,
    candidateDiffDigest: item.changes.candidateDiffDigest,
    capabilities: clone(item.changes.capabilities),
    contentRisk: clone(item.changes.contentRisk),
    matrixReceiptDigest: item.validation.matrixReceiptDigest,
    targetRuntimes: [...item.validation.targetRuntimes],
    actualUsage: {
      active: item.actualUsage.active,
      receiptCount: item.actualUsage.receiptCount,
      completed: item.actualUsage.completed,
      failedOrBlocked: item.actualUsage.failedOrBlocked,
      totalCostUsd: item.actualUsage.totalCostUsd,
    },
  };
}

export function compareEvolutionWorkbenchVersions(
  projection,
  { leftPacketDigest, rightPacketDigest } = {},
) {
  verifiedProjection(projection);
  if (leftPacketDigest === rightPacketDigest)
    throw new Error("Workbench version comparison requires two versions");
  const left = candidate(projection, leftPacketDigest, "left");
  const right = candidate(projection, rightPacketDigest, "right");
  const core = {
    schema: EVOLUTION_WORKBENCH_VERSION_COMPARISON_SCHEMA,
    tenantId: projection.tenantId,
    skillName: projection.skillName,
    sourceProjectionDigest: projection.projectionDigest,
    left: summary(left),
    right: summary(right),
  };
  return freeze({
    ...core,
    comparisonDigest: hash(EVOLUTION_WORKBENCH_VERSION_COMPARISON_SCHEMA, core),
  });
}

export function buildEvolutionWorkbenchRollbackPlan(
  projection,
  {
    fromPacketDigest,
    toPacketDigest,
    expectedActiveStateDigest,
    requestedBy,
    reason,
  } = {},
) {
  const comparison = compareEvolutionWorkbenchVersions(projection, {
    leftPacketDigest: fromPacketDigest,
    rightPacketDigest: toPacketDigest,
  });
  const from = candidate(projection, fromPacketDigest, "active");
  const to = candidate(projection, toPacketDigest, "rollback target");
  if (from.actualUsage.active !== true)
    throw new Error("Workbench rollback source is not active");
  if (to.status !== "approved" || to.decision?.decision !== "approved")
    throw new Error("Workbench rollback target lacks human approval");
  digest(expectedActiveStateDigest, "expectedActiveStateDigest");
  string(requestedBy, "requestedBy");
  string(reason, "reason");
  if (reason.length > 2048) throw new TypeError("rollback reason is too long");
  const core = {
    schema: EVOLUTION_WORKBENCH_ROLLBACK_PLAN_SCHEMA,
    tenantId: projection.tenantId,
    skillName: projection.skillName,
    sourceProjectionDigest: projection.projectionDigest,
    comparisonDigest: comparison.comparisonDigest,
    fromPacketDigest,
    fromCandidateId: from.candidateId,
    fromContentDigest: from.candidateContentDigest,
    toPacketDigest,
    toCandidateId: to.candidateId,
    toContentDigest: to.candidateContentDigest,
    expectedActiveStateDigest,
    requestedBy,
    reason,
  };
  return freeze({
    ...core,
    planDigest: hash(EVOLUTION_WORKBENCH_ROLLBACK_PLAN_SCHEMA, core),
  });
}

export function verifyEvolutionWorkbenchRollbackPlan(input, tenantId) {
  const plan = capturePruningData(input);
  if (
    plan?.schema !== EVOLUTION_WORKBENCH_ROLLBACK_PLAN_SCHEMA ||
    plan.tenantId !== tenantId ||
    !DIGEST.test(plan?.planDigest ?? "")
  )
    throw new TypeError("Workbench rollback plan is invalid");
  const core = clone(plan);
  delete core.planDigest;
  if (hash(EVOLUTION_WORKBENCH_ROLLBACK_PLAN_SCHEMA, core) !== plan.planDigest)
    throw new Error("Workbench rollback plan digest is invalid");
  return freeze(clone(plan));
}

export function buildEvolutionWorkbenchRollbackRequest(
  plan,
  authorizationReceiptDigest,
) {
  const core = {
    planDigest: plan.planDigest,
    expectedActiveStateDigest: plan.expectedActiveStateDigest,
    fromContentDigest: plan.fromContentDigest,
    toContentDigest: plan.toContentDigest,
    authorizationReceiptDigest: digest(
      authorizationReceiptDigest,
      "authorization receipt",
    ),
  };
  return freeze({
    ...core,
    requestDigest: hash(
      "chainlesschain.evolution-workbench-rollback-request/v1",
      core,
    ),
  });
}

export function buildEvolutionWorkbenchRollbackReceipt(
  plan,
  request,
  transitionReceiptDigest,
  active,
) {
  const core = {
    schema: EVOLUTION_WORKBENCH_ROLLBACK_RECEIPT_SCHEMA,
    tenantId: plan.tenantId,
    skillName: plan.skillName,
    planDigest: plan.planDigest,
    requestDigest: request.requestDigest,
    authorizationReceiptDigest: request.authorizationReceiptDigest,
    transitionReceiptDigest,
    activeStateDigest: active.stateDigest,
    activeContentDigest: active.contentDigest,
  };
  return freeze({
    ...core,
    receiptDigest: hash(EVOLUTION_WORKBENCH_ROLLBACK_RECEIPT_SCHEMA, core),
  });
}

export class EvolutionWorkbenchRollbackExecutor {
  constructor({ tenantId, ports } = {}) {
    this.tenantId = string(tenantId, "tenantId");
    if (!ports || types.isProxy(ports))
      throw new TypeError("fixed rollback ports are required");
    for (const name of [
      "loadProjection",
      "authorizeHumanRollback",
      "applyRollback",
      "readActiveState",
      "commitRollback",
    ]) {
      const method = Object.getOwnPropertyDescriptor(ports, name)?.value;
      if (typeof method !== "function" || types.isProxy(method))
        throw new TypeError(`Workbench rollback port ${name} is required`);
      this[`_${name}`] = method.bind(ports);
    }
    Object.freeze(this);
  }

  async execute(input) {
    const plan = verifyEvolutionWorkbenchRollbackPlan(input, this.tenantId);
    const projection = await this._loadProjection({
      tenantId: this.tenantId,
      projectionDigest: plan.sourceProjectionDigest,
    });
    const rebuilt = buildEvolutionWorkbenchRollbackPlan(projection, {
      fromPacketDigest: plan.fromPacketDigest,
      toPacketDigest: plan.toPacketDigest,
      expectedActiveStateDigest: plan.expectedActiveStateDigest,
      requestedBy: plan.requestedBy,
      reason: plan.reason,
    });
    if (rebuilt.planDigest !== plan.planDigest)
      throw new Error("Workbench rollback source projection changed");
    const authorization = await this._authorizeHumanRollback({ plan });
    if (
      authorization?.authenticated !== true ||
      authorization.durable !== true ||
      authorization.automated !== false ||
      authorization.planDigest !== plan.planDigest ||
      !DIGEST.test(authorization.receiptDigest ?? "")
    )
      throw new Error("Workbench rollback lacks exact human authorization");
    const request = buildEvolutionWorkbenchRollbackRequest(
      plan,
      authorization.receiptDigest,
    );
    const applied = await this._applyRollback(request);
    if (
      applied?.authenticated !== true ||
      applied.durable !== true ||
      applied.requestDigest !== request.requestDigest ||
      !DIGEST.test(applied.receiptDigest ?? "")
    )
      throw new Error("Workbench rollback was not durably applied");
    const active = await this._readActiveState({
      tenantId: this.tenantId,
      skillName: plan.skillName,
    });
    if (
      active?.authenticated !== true ||
      active.durable !== true ||
      active.tenantId !== this.tenantId ||
      active.skillName !== plan.skillName ||
      active.contentDigest !== plan.toContentDigest ||
      !DIGEST.test(active.stateDigest ?? "")
    )
      throw new Error("Workbench rollback active readback differs from target");
    const receipt = buildEvolutionWorkbenchRollbackReceipt(
      plan,
      request,
      applied.receiptDigest,
      active,
    );
    const committed = await this._commitRollback({ receipt });
    if (
      committed?.authenticated !== true ||
      committed.durable !== true ||
      committed.receiptDigest !== receipt.receiptDigest
    )
      throw new Error("Workbench rollback receipt was not durably committed");
    return receipt;
  }
}
