import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import { types as utilTypes } from "node:util";
import { StructuredMemoryLedgerAdapter } from "./structured-memory-ledger-adapter.js";
import { StructuredMemoryAuthorityLedgerAdapter } from "./structured-memory-authority-ledger-adapter.js";
import { captureStructuredMemoryPromotionReceiptWriter } from "./structured-memory-promotion-receipt-writer.js";
import { captureStructuredMemoryPolicyReceiptWriter } from "./structured-memory-policy-receipt-writer.js";
import { createStructuredMemorySemanticReviewPipeline } from "./structured-memory-semantic-review-pipeline.js";
import { createSkillEvaluatedPromotionControlPlane } from "./skill-promotion-controller.js";
import { SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA } from "./skill-revocation-propagation.js";

const { captureStructuredMemoryAuthority } = structuredMemory;

export const STRUCTURED_MEMORY_AGENT_CONTROL_PLANE_SCHEMA =
  "chainlesschain.structured-memory-agent-control-plane/v1";

const CONTROL_PLANES = new WeakSet();
const REVOCATION_REQUEST_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "operationId",
  "transitionDigest",
  "candidateId",
  "skillName",
  "occurredAt",
  "sourceReceiptDigest",
  "resolutionDigest",
  "dependency",
  "requestDigest",
]);
const REVOCATION_DEPENDENCY_KEYS = new Set([
  "kind",
  "ref",
  "digest",
  "disposition",
]);

function exactDataRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.size ||
    own.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} is not a data field`);
    }
  }
}

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
  promotionAuthority,
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
  const promotionActor = captureStructuredMemoryAuthority(promotionAuthority, {
    tenantId,
    role: "promotion-controller",
    actorType: "service",
  });
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
  const appendPromotionMemory = async (authorityReceipt) => {
    if (
      authorityReceipt?.kind !== "promotion" ||
      authorityReceipt.tenantId !== tenantId ||
      authorityReceipt.layer !== "procedural" ||
      authorityReceipt.action !== "accept" ||
      authorityReceipt.decision !== "accepted"
    ) {
      throw new Error("invalid durable Memory promotion authority receipt");
    }
    const existing = memory.projection().memories[authorityReceipt.memoryId];
    if (existing) {
      if (
        existing.layer !== "procedural" ||
        existing.status !== "active" ||
        existing.contentDigest !== authorityReceipt.contentDigest ||
        existing.artifactRef !== authorityReceipt.artifactRef ||
        existing.receipts?.promotion !== authorityReceipt.receiptDigest
      ) {
        throw new Error(
          "persisted procedural memory conflicts with the promotion receipt",
        );
      }
      return Object.freeze({
        status: "recovered",
        memory: existing,
        projection: memory.projection(),
      });
    }
    return memory.append({
      eventId: `promotion-${authorityReceipt.receiptDigest.slice("sha256:".length)}`,
      memoryId: authorityReceipt.memoryId,
      layer: "procedural",
      action: "accept",
      authority: promotionActor,
      automatic: true,
      contentDigest: authorityReceipt.contentDigest,
      artifactRef: authorityReceipt.artifactRef,
      evidenceRefs: authorityReceipt.evidenceRefs,
      supersedes: [],
      receiptRefs: { promotion: authorityReceipt.receiptDigest },
      timestamp: authorityReceipt.issuedAt,
      metadata: {
        promotionAuthorityReceiptDigest: authorityReceipt.receiptDigest,
      },
    });
  };
  const reconcilePromotionMemories = async () => {
    const receipts = await authorityAdapter.listReceipts("promotion");
    const reconciled = [];
    for (const receipt of receipts) {
      const transition = await appendPromotionMemory(receipt);
      reconciled.push(
        Object.freeze({
          receiptDigest: receipt.receiptDigest,
          status: transition.status ?? "persisted",
        }),
      );
    }
    return Object.freeze({
      status: "converged",
      receiptCount: receipts.length,
      reconciled: Object.freeze(reconciled),
      projection: memory.projection(),
    });
  };
  const quarantineMemory = async (input) => {
    exactDataRecord(
      input,
      REVOCATION_REQUEST_KEYS,
      "Memory revocation request",
    );
    exactDataRecord(
      input.dependency,
      REVOCATION_DEPENDENCY_KEYS,
      "Memory revocation dependency",
    );
    const request = structuredClone(input);
    const projection = memory.projection();
    const active = projection.memories[request?.dependency?.ref];
    const quarantined = projection.quarantines?.[request?.dependency?.ref];
    const subject =
      active ??
      (quarantined
        ? {
            ...quarantined,
            memoryId: request.dependency.ref,
            status: "active",
          }
        : null);
    if (!subject) {
      throw new Error("procedural Memory dependency is missing");
    }
    const authorityReceipt = await promotion.retainRevocation(request, subject);
    if (quarantined) {
      if (
        quarantined.metadata?.revocationPropagationRequestDigest !==
          request.requestDigest ||
        quarantined.receipts?.revocation !== authorityReceipt.receiptDigest
      ) {
        throw new Error("quarantined Memory conflicts with the rollback");
      }
    } else {
      await memory.append({
        eventId: `revocation-${request.requestDigest.slice("sha256:".length)}`,
        memoryId: subject.memoryId,
        layer: "procedural",
        action: "quarantine",
        authority: promotionActor,
        automatic: true,
        contentDigest: subject.contentDigest,
        artifactRef: subject.artifactRef,
        evidenceRefs: authorityReceipt.evidenceRefs,
        supersedes: [],
        receiptRefs: { revocation: authorityReceipt.receiptDigest },
        timestamp: request.occurredAt,
        metadata: {
          revocationPropagationRequestDigest: request.requestDigest,
          transitionDigest: request.transitionDigest,
        },
      });
    }
    return Object.freeze({
      schema: SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
      authenticated: true,
      durable: true,
      applied: true,
      idempotent: true,
      tenantId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      dependencyKind: request.dependency.kind,
      dependencyRef: request.dependency.ref,
      dependencyDigest: request.dependency.digest,
      disposition: request.dependency.disposition,
      receiptDigest: memory.projection().projectionDigest,
    });
  };
  const controlPlane = Object.freeze({
    schema: STRUCTURED_MEMORY_AGENT_CONTROL_PLANE_SCHEMA,
    tenantId,
    streamId: memoryAdapter.descriptor.streamId,
    memory,
    semantic,
    promotionReceiptWriter: promotion,
    policyReceiptWriter: policy,
    reconcilePromotionMemories: Object.freeze(reconcilePromotionMemories),
    quarantineMemory: Object.freeze(quarantineMemory),
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
      const evaluated = createSkillEvaluatedPromotionControlPlane({
        ...options,
        memoryPromotionReceiptWriter: promotion,
      });
      const recordPromotionMemory = async (result) => {
        const authorityReceipt = result?.memoryAuthorityReceipt;
        const release = result?.release;
        if (
          !authorityReceipt ||
          authorityReceipt.contentDigest !== release?.contentDigest ||
          authorityReceipt.artifactRef !== release?.releaseDigest
        ) {
          throw new Error(
            "evaluated promotion result lacks its durable Memory authority receipt",
          );
        }
        return appendPromotionMemory(authorityReceipt);
      };
      return Object.freeze({
        ...evaluated,
        promoteEvaluated: Object.freeze(async (input) => {
          const result = await evaluated.promoteEvaluated(input);
          try {
            const memoryTransition = await recordPromotionMemory(result);
            return Object.freeze({ ...result, memoryTransition });
          } catch (cause) {
            const error = new Error(
              "release committed but procedural Memory persistence is pending",
              { cause },
            );
            error.code = "CC_PROMOTION_MEMORY_COMMIT_PENDING";
            error.commitState = "release-committed-memory-pending";
            error.promotionResult = result;
            throw error;
          }
        }),
        recordPromotionMemory: Object.freeze(recordPromotionMemory),
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
