import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "./skill-revocation-release-registry.js";
import {
  decisionFor,
  verifyDecision,
  NOW,
} from "./evolution-workbench-review.js";
import { EvolutionRunLedgerAdapter } from "../../src/lib/evolution/evolution-run-ledger-adapter.js";
import { SkillPromotionReviewLedgerAdapter } from "../../src/lib/evolution/skill-promotion-review-ledger-adapter.js";
import { buildSkillPromotionReviewPacket } from "../../src/lib/evolution/skill-promotion-review.js";
import { EMPTY_SKILL_ACTIVE_DIGEST } from "../../src/lib/evolution/skill-release-registry.js";
import { SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA } from "../../src/lib/evolution/skill-evaluated-promotion.js";
import { createEvolutionWorkbenchDataSource } from "../../src/lib/evolution/evolution-workbench-projection.js";
import { buildEvolutionWorkbenchRollbackPlan } from "../../src/lib/evolution/evolution-workbench-version-control.js";
import { EvolutionWorkbenchReviewLedgerAdapter } from "../../src/lib/evolution/evolution-workbench-review-ledger-adapter.js";
import { EvolutionWorkbenchRollbackLedgerAdapter } from "../../src/lib/evolution/evolution-workbench-rollback-ledger-adapter.js";
import {
  WORKBENCH_ROLLBACK_AUTHORIZATION_SCHEMA,
  digestWorkbenchRollbackAuthorization,
} from "../../src/lib/evolution/evolution-workbench-rollback-authorization.js";
import { createEvolutionWorkbenchRegistrySource } from "../../src/lib/evolution/evolution-workbench-registry-source.js";
export { NOW };
export const TENANT = "tenant:workbench-rollback";
const SKILL = "safe-refactor";
const RUN = "run:workbench-rollback";
const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    createHash("sha256").update("test-only-workbench-rollback-human").digest(),
  ]),
  type: "pkcs8",
  format: "der",
});
export function authorizationFor(plan, overrides = {}, now = NOW) {
  const core = {
    schema: WORKBENCH_ROLLBACK_AUTHORIZATION_SCHEMA,
    tenantId: plan.tenantId,
    skillName: plan.skillName,
    planDigest: plan.planDigest,
    requestedBy: plan.requestedBy,
    reason: plan.reason,
    automated: false,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
    ...overrides,
  };
  const receiptDigest = digestWorkbenchRollbackAuthorization(core);
  return {
    ...core,
    receiptDigest,
    signature: sign(null, Buffer.from(receiptDigest), key).toString(
      "base64url",
    ),
  };
}
export const verifyAuthorization = ({ authorization }) =>
  verify(
    null,
    Buffer.from(authorization.receiptDigest),
    createPublicKey(key),
    Buffer.from(authorization.signature, "base64url"),
  );

export function packetFor(release, activeRelease, revision) {
  const candidate = release.candidate;
  return buildSkillPromotionReviewPacket({
    candidate,
    activeRelease,
    state: {
      tenantId: TENANT,
      skillName: SKILL,
      revision,
      activeReleaseDigest: activeRelease?.releaseDigest ?? null,
    },
    matrixBinding: {
      schema: SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA,
      tenantId: TENANT,
      skillName: SKILL,
      candidateId: candidate.candidateId,
      candidateContentDigest: candidate.contentDigest,
      expectedActiveContentDigest:
        activeRelease?.contentDigest ?? EMPTY_SKILL_ACTIVE_DIGEST,
      expectedActiveRevision: revision,
      matrixEvalId: `matrix-eval:${revision}`,
      matrixReceiptDigest: D(`matrix:${revision}`),
      decisionCommitmentDigest: D(`decision:${revision}`),
      expiresAt: new Date(NOW + 600_000).toISOString(),
      receiptResolution: {
        authorityId: "authority:test-matrix",
        resolverDescriptorDigest: D("test-matrix-resolver"),
        resolverRevision: 1,
        resolvedAt: new Date(NOW).toISOString(),
      },
    },
  });
}

export async function openWorkbenchRollbackStore(root, options = {}) {
  const store = openEvolutionDurableStore(root, {
    tenantId: TENANT,
    streamId: "workbench-rollback",
  });
  const now = options.now ?? (() => NOW);
  const release = await openRevocationReleaseRegistry({
    root,
    storage: { ...store, now: NOW },
    fsImpl: store.fsImpl,
    tenantId: TENANT,
    artifactTenantId: store.descriptor.artifactTenantId,
    seed: options.seed ?? false,
    crashPoint: options.crashPoint ?? "none",
    onTransition: options.onTransition ?? null,
  });
  const independentStore = openEvolutionDurableStore(root, {
    tenantId: TENANT,
    streamId: "workbench-rollback",
  });
  const independent = await openRevocationReleaseRegistry({
    root,
    storage: { ...independentStore, now: NOW },
    fsImpl: independentStore.fsImpl,
    tenantId: TENANT,
    artifactTenantId: store.descriptor.artifactTenantId,
  });
  const descriptor = {
    ...store.descriptor,
    runId: RUN,
    skillName: SKILL,
    authorityId: "authority:workbench-rollback-test",
    revision: 1,
    handlerArtifactDigest:
      options.handlerArtifactDigest ?? D("rollback-test-module"),
  };
  const shared = {
    descriptor,
    artifactPorts: store.artifactPorts,
    ledger: store.backend.ledger,
    ledgerArtifactResolver: store.resolver,
    now,
  };
  const review = new SkillPromotionReviewLedgerAdapter({
    ...shared,
    decisionVerifier: { verify: verifyDecision },
  });
  const run = new EvolutionRunLedgerAdapter(shared);
  const packets = [
    packetFor(release.baseline, null, 0),
    packetFor(release.candidateRelease, release.baseline, 1),
  ];
  if (options.seed) {
    const events = [
      { type: "run-started", subjectId: null, payloadDigest: D("start") },
    ];
    for (const value of [release.baseline, release.candidateRelease]) {
      events.push({
        type: "skill-candidate-recorded",
        subjectId: value.candidate.candidateId,
        payloadDigest: value.contentDigest,
      });
      events.push({
        type: "release-activated",
        subjectId: value.releaseDigest,
        payloadDigest: value.contentDigest,
      });
    }
    for (const [index, event] of events.entries())
      run.appendEvent({
        ...event,
        schema: evolutionRun.EVOLUTION_RUN_EVENT_SCHEMA,
        tenantId: TENANT,
        runId: RUN,
        eventId: `event:${index + 1}`,
        sequence: index + 1,
        artifactRef: event.subjectId ? `artifact://${event.subjectId}` : null,
        keyRef: null,
        data: {},
      });
    for (const packet of packets) {
      await review.submitPacket(packet);
      await review.retainDecision({
        packetDigest: packet.packetDigest,
        decision: decisionFor(packet),
      });
    }
  }
  const registryOptions = {
    ...shared,
    ...release.pruningRollbackOptions,
    verifierLedger: independentStore.backend.ledger,
    verifierLedgerArtifactResolver: independentStore.resolver,
    verifierReleaseRegistry: independent.pruningRollbackOptions.releaseRegistry,
    verifierTransactionLedger:
      independent.pruningRollbackOptions.transactionLedger,
  };
  const registrySource =
    createEvolutionWorkbenchRegistrySource(registryOptions);
  const projectionSource = createEvolutionWorkbenchDataSource({
    tenantId: TENANT,
    runId: RUN,
    skillName: SKILL,
    runAdapter: run,
    reviewAdapter: review,
    registrySource,
  });
  const reviewBridge = new EvolutionWorkbenchReviewLedgerAdapter({
    ...shared,
    projectionSource,
    decisionVerifier: { verify: verifyDecision },
    humanDecisionProvider: {
      request: async () => {
        throw new Error("no review request expected");
      },
    },
    humanDecisionVerifier: { verify: () => false },
  });
  let plan = null;
  if (options.seed) {
    const projection = await reviewBridge.loadCurrentProjection();
    await reviewBridge.retainProjection({ tenantId: TENANT, projection });
    plan = buildEvolutionWorkbenchRollbackPlan(projection, {
      fromPacketDigest: packets[1].packetDigest,
      toPacketDigest: packets[0].packetDigest,
      expectedActiveStateDigest: release.readActive().state.stateDigest,
      requestedBy: "human:alice",
      reason:
        "Revert the observed regression to the approved last-known-good release.",
    });
  }
  const asks = [];
  const mutationRequests = [];
  const baseAuthorization =
    release.pruningRollbackOptions.authorizationProvider.authorizeRollback;
  const adapterOptions = {
    ...shared,
    ...release.pruningRollbackOptions,
    projectionReader: reviewBridge.createProjectionReader(),
    verifierReleaseRegistry: independent.pruningRollbackOptions.releaseRegistry,
    verifierTransactionLedger:
      independent.pruningRollbackOptions.transactionLedger,
    authorizationProvider: {
      authorizeRollback: async (expected) => {
        mutationRequests.push(expected);
        return options.authorizeMutation
          ? options.authorizeMutation(expected, baseAuthorization)
          : baseAuthorization(expected);
      },
    },
    humanRollbackProvider: {
      authorize: async ({ plan: value }) => {
        asks.push(value);
        return options.authorizeHuman
          ? options.authorizeHuman(value)
          : authorizationFor(value, {}, Number(now()));
      },
    },
    humanRollbackVerifier: {
      verify: options.verifyHuman ?? verifyAuthorization,
    },
  };
  const adapter = new EvolutionWorkbenchRollbackLedgerAdapter(adapterOptions);
  return {
    ...store,
    shared,
    descriptor,
    release,
    independent,
    independentStore,
    review,
    reviewBridge,
    run,
    projectionSource,
    registrySource,
    registryOptions,
    adapter,
    adapterOptions,
    plan,
    packets,
    asks,
    mutationRequests,
  };
}
