import { StructuredMemoryLedgerAdapter } from "./structured-memory-ledger-adapter.js";
import { StructuredMemoryAuthorityLedgerAdapter } from "./structured-memory-authority-ledger-adapter.js";
import { captureStructuredMemoryPromotionReceiptWriter } from "./structured-memory-promotion-receipt-writer.js";
import { captureStructuredMemoryPolicyReceiptWriter } from "./structured-memory-policy-receipt-writer.js";
import { createStructuredMemorySemanticReviewPipeline } from "./structured-memory-semantic-review-pipeline.js";
import { createSkillEvaluatedPromotionControlPlane } from "./skill-promotion-controller.js";

export const STRUCTURED_MEMORY_AGENT_CONTROL_PLANE_SCHEMA =
  "chainlesschain.structured-memory-agent-control-plane/v1";

const CONTROL_PLANES = new WeakSet();

function sameStorage(left, right) {
  return (
    left.tenantId === right.tenantId &&
    left.artifactTenantId === right.artifactTenantId &&
    left.streamId === right.streamId &&
    left.audience === right.audience &&
    left.purpose === right.purpose
  );
}

export function createStructuredMemoryAgentControlPlane({
  memoryAdapter,
  authorityAdapter,
  critic,
  evaluator,
  proposerAuthority,
  governorAuthority,
  promotionReceiptWriter,
  policyReceiptWriter,
} = {}) {
  if (!(memoryAdapter instanceof StructuredMemoryLedgerAdapter)) {
    throw new TypeError("a StructuredMemoryLedgerAdapter is required");
  }
  if (!(authorityAdapter instanceof StructuredMemoryAuthorityLedgerAdapter)) {
    throw new TypeError("a StructuredMemoryAuthorityLedgerAdapter is required");
  }
  if (!sameStorage(memoryAdapter.descriptor, authorityAdapter.descriptor)) {
    throw new Error(
      "memory and authority adapters must share one durable stream",
    );
  }
  const promotion = captureStructuredMemoryPromotionReceiptWriter(
    promotionReceiptWriter,
  );
  const policy =
    captureStructuredMemoryPolicyReceiptWriter(policyReceiptWriter);
  const tenantId = memoryAdapter.descriptor.tenantId;
  if (
    promotion.descriptor.tenantId !== tenantId ||
    policy.descriptor.tenantId !== tenantId
  ) {
    throw new Error(
      "memory receipt writers must share the control-plane tenant",
    );
  }

  // createMemory() performs the authoritative event/snapshot replay and rejects
  // invalid lineage before any producer can receive the resulting capability.
  const memory = memoryAdapter.createMemory();
  const semantic = createStructuredMemorySemanticReviewPipeline({
    tenantId,
    memory,
    authorityStore: authorityAdapter,
    critic,
    evaluator,
    proposerAuthority,
    governorAuthority,
  });
  const controlPlane = Object.freeze({
    schema: STRUCTURED_MEMORY_AGENT_CONTROL_PLANE_SCHEMA,
    tenantId,
    streamId: memoryAdapter.descriptor.streamId,
    memory,
    semantic,
    promotionReceiptWriter: promotion,
    policyReceiptWriter: policy,
    createEvaluatedPromotionControlPlane(options = {}) {
      if (
        !options ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        Object.hasOwn(options, "memoryPromotionReceiptWriter")
      ) {
        throw new TypeError(
          "evaluated promotion options cannot override the Agent memory writer",
        );
      }
      return createSkillEvaluatedPromotionControlPlane({
        ...options,
        memoryPromotionReceiptWriter: promotion,
      });
    },
    recovery: Object.freeze({
      sequence: memory.projection().sequence,
      projectionDigest: memory.projection().projectionDigest,
      snapshotDigest: memory.snapshot()?.snapshotDigest ?? null,
    }),
  });
  CONTROL_PLANES.add(controlPlane);
  return controlPlane;
}

export function captureStructuredMemoryAgentControlPlane(value) {
  if (!CONTROL_PLANES.has(value)) {
    throw new TypeError(
      "a branded structured memory Agent control plane is required",
    );
  }
  return value;
}
