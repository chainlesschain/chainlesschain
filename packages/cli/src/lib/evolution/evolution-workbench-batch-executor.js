import { createHash } from "node:crypto";

import {
  EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA,
  filterEvolutionWorkbenchProjection,
} from "./evolution-workbench-projection.js";
import { verifySkillPromotionReviewPacketArtifact } from "./skill-promotion-review.js";

export const EVOLUTION_WORKBENCH_BATCH_ITEM_REQUEST_SCHEMA =
  "chainlesschain.evolution-workbench-batch-item-request/v1";
export const EVOLUTION_WORKBENCH_BATCH_EXECUTION_SCHEMA =
  "chainlesschain.evolution-workbench-batch-execution/v1";

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

function verifyPlan(input, tenantId) {
  if (
    input?.schema !== EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA ||
    input.tenantId !== tenantId ||
    !DIGEST.test(input?.planDigest ?? "")
  )
    throw new TypeError("Workbench batch plan is invalid");
  const core = clone(input);
  delete core.planDigest;
  if (hash(EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA, core) !== input.planDigest)
    throw new Error("Workbench batch plan digest is invalid");
  return freeze(clone(input));
}

function itemRequest(plan, packet) {
  const core = {
    schema: EVOLUTION_WORKBENCH_BATCH_ITEM_REQUEST_SCHEMA,
    tenantId: plan.tenantId,
    planDigest: plan.planDigest,
    sourceProjectionDigest: plan.sourceProjectionDigest,
    packetDigest: packet.packetDigest,
    candidateId: packet.candidateId,
    candidateContentDigest: packet.candidateContentDigest,
    decision: plan.decision,
    reason: plan.reason,
    requestedBy: plan.requestedBy,
    requiredHumanQuorum: packet.requiredHumanQuorum,
    contentRiskDigest: packet.contentRisk.contentRiskDigest,
    contentRiskDetected: packet.contentRisk.detected,
  };
  return freeze({
    ...core,
    requestDigest: hash(EVOLUTION_WORKBENCH_BATCH_ITEM_REQUEST_SCHEMA, core),
  });
}

export class EvolutionWorkbenchBatchExecutor {
  constructor({ tenantId, ports } = {}) {
    if (typeof tenantId !== "string" || tenantId.trim() === "")
      throw new TypeError("tenantId is required");
    this.tenantId = tenantId;
    for (const name of [
      "loadProjection",
      "resolvePacket",
      "requestHumanDecision",
      "retainDecision",
      "commitExecutionItem",
    ]) {
      if (typeof ports?.[name] !== "function")
        throw new TypeError(
          `Workbench batch executor port ${name} is required`,
        );
      this[`_${name}`] = ports[name].bind(ports);
    }
  }

  async execute(input) {
    const plan = verifyPlan(input, this.tenantId);
    const projection = await this._loadProjection({
      tenantId: this.tenantId,
      projectionDigest: plan.sourceProjectionDigest,
    });
    filterEvolutionWorkbenchProjection(projection, { limit: 1 });
    if (
      projection.tenantId !== plan.tenantId ||
      projection.runId !== plan.runId ||
      projection.skillName !== plan.skillName ||
      projection.projectionDigest !== plan.sourceProjectionDigest
    )
      throw new Error("Workbench batch source projection changed");
    const pending = new Map(
      projection.candidates
        .filter(({ status }) => status === "pending")
        .map((candidate) => [candidate.packetDigest, candidate]),
    );
    const items = [];
    for (const packetDigest of plan.packetDigests) {
      if (!pending.has(packetDigest))
        throw new Error("Workbench batch packet is no longer pending");
      const packet = verifySkillPromotionReviewPacketArtifact(
        await this._resolvePacket({ tenantId: this.tenantId, packetDigest }),
      );
      if (
        packet.packetDigest !== packetDigest ||
        packet.candidateId !== pending.get(packetDigest).candidateId
      )
        throw new Error("Workbench batch packet was substituted");
      const request = itemRequest(plan, packet);
      const decision = await this._requestHumanDecision(request);
      const expectedDecision =
        plan.decision === "approve" ? "approved" : "rejected";
      if (
        decision?.tenantId !== this.tenantId ||
        decision.packetDigest !== packetDigest ||
        decision.candidateId !== packet.candidateId ||
        decision.decision !== expectedDecision ||
        decision.automated !== false ||
        decision.reason !== plan.reason ||
        decision.requestDigest !== request.requestDigest ||
        !DIGEST.test(decision.receiptDigest ?? "") ||
        typeof decision.signature !== "string" ||
        decision.signature.length < 32
      )
        throw new Error("Workbench batch human decision is not exactly bound");
      const retained = await this._retainDecision({
        packetDigest,
        decision,
      });
      if (
        retained?.persisted !== true ||
        retained.receiptDigest !== decision.receiptDigest
      )
        throw new Error("Workbench batch decision was not durably retained");
      const itemCore = {
        packetDigest,
        requestDigest: request.requestDigest,
        decisionReceiptDigest: decision.receiptDigest,
      };
      const item = freeze({
        ...itemCore,
        itemDigest: hash(
          "chainlesschain.evolution-workbench-batch-execution-item/v1",
          itemCore,
        ),
      });
      const committed = await this._commitExecutionItem({
        tenantId: this.tenantId,
        planDigest: plan.planDigest,
        item,
      });
      if (
        committed?.authenticated !== true ||
        committed.durable !== true ||
        committed.itemDigest !== item.itemDigest
      )
        throw new Error("Workbench batch execution item was not committed");
      items.push(item);
    }
    const core = {
      schema: EVOLUTION_WORKBENCH_BATCH_EXECUTION_SCHEMA,
      tenantId: this.tenantId,
      planDigest: plan.planDigest,
      sourceProjectionDigest: plan.sourceProjectionDigest,
      items,
    };
    return freeze({
      ...core,
      executionDigest: hash(EVOLUTION_WORKBENCH_BATCH_EXECUTION_SCHEMA, core),
    });
  }
}
