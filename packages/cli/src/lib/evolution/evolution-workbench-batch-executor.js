import { types } from "node:util";
import {
  verifyWorkbenchBatchPlan,
  buildWorkbenchBatchItemRequest,
  verifyWorkbenchHumanDecisionResponse,
  buildWorkbenchExecutionItem,
  buildWorkbenchBatchExecution,
} from "./evolution-workbench-review-protocol.js";
import { capturePruningData as captureData } from "./governed-wiki-pruning-journal.js";
export {
  EVOLUTION_WORKBENCH_BATCH_ITEM_REQUEST_SCHEMA,
  EVOLUTION_WORKBENCH_BATCH_EXECUTION_SCHEMA,
} from "./evolution-workbench-review-protocol.js";

export class EvolutionWorkbenchBatchExecutor {
  constructor({ tenantId, ports, now = Date.now } = {}) {
    if (typeof tenantId !== "string" || tenantId.trim() === "")
      throw new TypeError("tenantId is required");
    if (typeof now !== "function" || types.isProxy(now))
      throw new TypeError("Workbench clock is required");
    if (!ports || typeof ports !== "object" || types.isProxy(ports))
      throw new TypeError("Workbench ports must be fixed own methods");
    this.tenantId = tenantId;
    this._now = now;
    for (const name of [
      "loadProjection",
      "resolvePacket",
      "loadExecutionItem",
      "requestHumanDecision",
      "verifyHumanDecision",
      "prepareDecision",
      "retainDecision",
      "commitExecutionItem",
    ]) {
      const method = Object.getOwnPropertyDescriptor(ports, name)?.value;
      if (typeof method !== "function" || types.isProxy(method))
        throw new TypeError(
          `Workbench batch executor port ${name} is required`,
        );
      this[`_${name}`] = method.bind(ports);
    }
    Object.freeze(this);
  }

  async execute(input) {
    const plan = verifyWorkbenchBatchPlan(input, this.tenantId);
    const projection = captureData(
      await this._loadProjection({
        tenantId: this.tenantId,
        projectionDigest: plan.sourceProjectionDigest,
      }),
    );
    verifyWorkbenchBatchPlan(plan, this.tenantId, projection);
    const pending = new Map(
      projection.candidates.map((candidate) => [
        candidate.packetDigest,
        candidate,
      ]),
    );
    const items = [];
    for (const packetDigest of plan.packetDigests) {
      const packet = captureData(
        await this._resolvePacket({ tenantId: this.tenantId, packetDigest }),
      );
      const request = buildWorkbenchBatchItemRequest(plan, packet);
      if (
        packet.candidateId !== pending.get(packetDigest)?.candidateId ||
        packet.candidateContentDigest !==
          pending.get(packetDigest)?.candidateContentDigest
      )
        throw new Error("Workbench batch packet was substituted");
      const stored = captureData(
        await this._loadExecutionItem({ plan, request }),
      );
      if (
        stored &&
        !["prepared", "applied", "committed"].includes(stored.status)
      )
        throw new Error("Workbench execution state is invalid");
      const raw =
        stored?.response ?? (await this._requestHumanDecision(request));
      // Historical freshness is allowed only for an effect the fixed durable
      // reader has already observed. An unapplied expired approval cannot run.
      const historical =
        stored?.status === "applied" || stored?.status === "committed";
      const response = verifyWorkbenchHumanDecisionResponse(
        raw,
        request,
        packet,
        historical ? Date.parse(raw.decision?.decidedAt) : Number(this._now()),
      );
      if ((await this._verifyHumanDecision({ request, response })) !== true)
        throw new Error(
          "Workbench human decision signature verification failed",
        );
      const item = buildWorkbenchExecutionItem(request, response);
      if (stored?.status === "committed") {
        if (stored.item?.itemDigest !== item.itemDigest)
          throw new Error("Workbench durable execution item differs");
        items.push(item);
        continue;
      }
      if (!stored) {
        const prepared = await this._prepareDecision({
          plan,
          request,
          response,
        });
        if (
          prepared?.authenticated !== true ||
          prepared.durable !== true ||
          prepared.responseDigest !== response.responseDigest
        )
          throw new Error("Workbench human decision was not durably prepared");
      }
      const retained = await this._retainDecision({
        plan,
        packetDigest,
        decision: response.decision,
        request,
        response,
      });
      if (
        retained?.persisted !== true ||
        retained.receiptDigest !== response.decision.receiptDigest
      )
        throw new Error("Workbench batch decision was not durably retained");
      const committed = await this._commitExecutionItem({
        plan,
        request,
        response,
        item,
      });
      if (
        committed?.authenticated !== true ||
        committed.durable !== true ||
        committed.itemDigest !== item.itemDigest
      )
        throw new Error("Workbench batch execution item was not committed");
      const readback = await this._loadExecutionItem({ plan, request });
      if (
        readback?.status !== "committed" ||
        readback.item?.itemDigest !== item.itemDigest
      )
        throw new Error(
          "Workbench batch execution item was not durably read back",
        );
      items.push(item);
    }
    return buildWorkbenchBatchExecution(plan, captureData(items));
  }
}
