"use strict";

const crypto = require("node:crypto");

const EVOLVABLE_ARTIFACT_SCHEMA = "chainlesschain.evolvable-artifact/v1";
const EVOLVABLE_ARTIFACT_RECEIPT_SCHEMA =
  "chainlesschain.evolvable-artifact-receipt/v1";
const EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA =
  "chainlesschain.evolvable-artifact-persistence-receipt/v1";
const EVOLVABLE_ARTIFACT_DEPENDENCY_PROJECTION_SCHEMA =
  "chainlesschain.evolvable-artifact-dependency-projection/v1";
const EVOLVABLE_ARTIFACT_TRANSITION_REQUEST_SCHEMA =
  "chainlesschain.evolvable-artifact-transition-request/v1";
const EVOLVABLE_ARTIFACT_TRANSITION_RECEIPT_SCHEMA =
  "chainlesschain.evolvable-artifact-transition-receipt/v1";
const EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA =
  "chainlesschain.evolvable-artifact-active-release/v1";
const EVOLVABLE_ARTIFACT_CANDIDATE_READ_SCHEMA =
  "chainlesschain.evolvable-artifact-candidate-read/v1";

const ARTIFACT_TYPE = Object.freeze({
  SKILL: "skill",
  PROMPT: "prompt",
  HOOK: "hook",
  KNOWLEDGE: "knowledge",
});
const ARTIFACT_TYPES = Object.freeze(Object.values(ARTIFACT_TYPE));
const ARTIFACT_TYPE_SET = new Set(ARTIFACT_TYPES);
const RECEIPT_KINDS = new Set([
  "eval",
  "review",
  "promotion",
  "rollback",
  "revalidation",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const policyBrands = new WeakSet();
const authorityBrands = new WeakSet();
const candidateGateBrands = new WeakSet();
const releaseGateBrands = new WeakSet();
const activeReleaseReaderBrands = new WeakSet();
const candidateReaderBrands = new WeakSet();
const lifecycleProducerBrands = new WeakSet();
const runtimeCompositionBrands = new WeakSet();
const runtimeCompositionDependencies = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digestValue(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function requiredDigest(value, name) {
  if (!DIGEST.test(value ?? "")) {
    throw new TypeError(`${name} must be a sha256 digest`);
  }
  return value;
}

function normalizeType(type) {
  if (!ARTIFACT_TYPE_SET.has(type)) {
    throw new TypeError("artifact type is invalid");
  }
  return type;
}

function requireExactObjectKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  if (canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) {
    throw new TypeError(`${name} has unexpected or missing fields`);
  }
  return value;
}

function normalizeParent(parent) {
  if (parent == null) return null;
  return {
    artifactId: requiredString(parent.artifactId, "parent.artifactId"),
    releaseId: requiredString(parent.releaseId, "parent.releaseId"),
    contentDigest: requiredDigest(parent.contentDigest, "parent.contentDigest"),
  };
}

function normalizeDependencyLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    throw new TypeError("dependencyLock is required");
  }
  if (!Array.isArray(lock.dependencies)) {
    throw new TypeError("dependencyLock.dependencies must be an array");
  }
  const dependencies = lock.dependencies.map((entry, index) => ({
    artifactId: requiredString(
      entry.artifactId,
      `dependencyLock.dependencies[${index}].artifactId`,
    ),
    type: normalizeType(entry.type),
    releaseId: requiredString(
      entry.releaseId,
      `dependencyLock.dependencies[${index}].releaseId`,
    ),
    contentDigest: requiredDigest(
      entry.contentDigest,
      `dependencyLock.dependencies[${index}].contentDigest`,
    ),
  }));
  dependencies.sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  if (
    new Set(dependencies.map((entry) => entry.artifactId)).size !==
    dependencies.length
  ) {
    throw new Error("dependencyLock contains duplicate artifactId entries");
  }
  const expectedDigest = digestValue({ dependencies });
  if (lock.digest !== expectedDigest) {
    throw new Error("dependencyLock digest does not match its dependencies");
  }
  return { digest: expectedDigest, dependencies };
}

function normalizeManifest(manifest, name) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError(`${name} is required`);
  }
  const normalized = clone(manifest);
  requiredDigest(normalized.digest, `${name}.digest`);
  const body = Object.fromEntries(
    Object.entries(normalized).filter(([key]) => key !== "digest"),
  );
  if (normalized.digest !== digestValue(body)) {
    throw new Error(`${name}.digest does not match its manifest body`);
  }
  return normalized;
}

function assertTypeSpecificCandidate(candidate) {
  if (candidate.type === ARTIFACT_TYPE.HOOK) {
    for (const field of [
      "codeSignatureDigest",
      "sbomDigest",
      "sandboxDigest",
      "networkEgressPolicyDigest",
    ]) {
      requiredDigest(
        candidate.runtimeManifest[field],
        `runtimeManifest.${field}`,
      );
    }
    if (candidate.runtimeManifest.executable !== true) {
      throw new Error("Hook runtimeManifest must declare executable=true");
    }
  }
  if (candidate.type === ARTIFACT_TYPE.PROMPT) {
    requiredDigest(
      candidate.runtimeManifest.dataPolicyDigest,
      "runtimeManifest.dataPolicyDigest",
    );
  }
}

function normalizeCandidate(input, scopedTenantId, scopedType) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("candidate must be an object");
  }
  const tenantId = requiredString(input.tenantId, "tenantId");
  const type = normalizeType(input.type);
  if (tenantId !== scopedTenantId)
    throw new Error("cross-tenant candidate rejected");
  if (type !== scopedType)
    throw new Error("cross-type candidate authority rejected");
  const contentDigest = requiredDigest(input.contentDigest, "contentDigest");
  if (!Array.isArray(input.lineage) || input.lineage.length === 0) {
    throw new TypeError(
      "lineage must contain at least the candidate content digest",
    );
  }
  const lineage = input.lineage.map((entry, index) =>
    requiredDigest(entry, `lineage[${index}]`),
  );
  if (lineage.at(-1) !== contentDigest) {
    throw new Error("lineage must end at contentDigest");
  }
  const candidate = {
    schema: EVOLVABLE_ARTIFACT_SCHEMA,
    tenantId,
    artifactId: requiredString(input.artifactId, "artifactId"),
    type,
    contentDigest,
    parent: normalizeParent(input.parent),
    lineage,
    dependencyLock: normalizeDependencyLock(input.dependencyLock),
    runtimeManifest: normalizeManifest(
      input.runtimeManifest,
      "runtimeManifest",
    ),
    permissionManifest: normalizeManifest(
      input.permissionManifest,
      "permissionManifest",
    ),
    candidate: {
      candidateId: requiredString(input.candidateId, "candidateId"),
      status: "candidate",
    },
    release: null,
    receipts: {
      revalidation: null,
      eval: null,
      review: null,
      promotion: null,
    },
    activeReleaseId:
      input.activeReleaseId == null
        ? null
        : requiredString(input.activeReleaseId, "activeReleaseId"),
    lastKnownGoodReleaseId:
      input.lastKnownGoodReleaseId == null
        ? null
        : requiredString(
            input.lastKnownGoodReleaseId,
            "lastKnownGoodReleaseId",
          ),
    stale: false,
    staleReasons: [],
  };
  assertTypeSpecificCandidate(candidate);
  candidate.artifactDigest = digestValue(candidate);
  return deepFreeze(candidate);
}

function artifactWithoutDigest(artifact) {
  return Object.fromEntries(
    Object.entries(artifact).filter(([key]) => key !== "artifactDigest"),
  );
}

function verifyEvolvableArtifact(artifact) {
  if (
    artifact?.schema !== EVOLVABLE_ARTIFACT_SCHEMA ||
    !ARTIFACT_TYPE_SET.has(artifact.type) ||
    artifact.artifactDigest !== digestValue(artifactWithoutDigest(artifact))
  ) {
    throw new Error("EvolvableArtifact verification failed");
  }
  return artifact;
}

function normalizeReceipt(receipt, artifact, kind) {
  if (receipt?.schema !== EVOLVABLE_ARTIFACT_RECEIPT_SCHEMA) {
    throw new TypeError(`${kind} receipt schema is invalid`);
  }
  if (!RECEIPT_KINDS.has(kind) || receipt.kind !== kind) {
    throw new TypeError(`${kind} receipt kind is invalid`);
  }
  for (const [field, expected] of [
    ["tenantId", artifact.tenantId],
    ["artifactId", artifact.artifactId],
    ["candidateId", artifact.candidate.candidateId],
    ["contentDigest", artifact.contentDigest],
    ["dependencyLockDigest", artifact.dependencyLock.digest],
  ]) {
    if (receipt[field] !== expected) {
      throw new Error(`${kind} receipt ${field} binding is invalid`);
    }
  }
  requiredString(receipt.issuerId, `${kind} receipt issuerId`);
  requiredString(receipt.issuerRevision, `${kind} receipt issuerRevision`);
  requiredString(receipt.issuedAt, `${kind} receipt issuedAt`);
  if (receipt.decision !== "allow") {
    throw new Error(`${kind} receipt did not allow the transition`);
  }
  const normalized = clone(receipt);
  requiredDigest(normalized.receiptDigest, `${kind} receipt receiptDigest`);
  const body = Object.fromEntries(
    Object.entries(normalized).filter(([key]) => key !== "receiptDigest"),
  );
  if (normalized.receiptDigest !== digestValue(body)) {
    throw new Error(`${kind} receipt digest is invalid`);
  }
  return deepFreeze(normalized);
}

function assertHookReview(review) {
  if (
    review.claims?.riskTier !== "high" ||
    !Array.isArray(review.claims.approvers)
  ) {
    throw new Error("Hook review must be a high-risk human quorum receipt");
  }
  const identities = new Set();
  for (const approver of review.claims.approvers) {
    identities.add(
      requiredString(approver.identityId, "Hook approver identityId"),
    );
    requiredDigest(approver.signatureDigest, "Hook approver signatureDigest");
  }
  if (identities.size < 2) {
    throw new Error(
      "Hook activation requires two distinct signed human approvers",
    );
  }
}

function createEvolvableArtifactPolicy({
  type,
  revision,
  admission,
  evaluator,
  activation,
  rollback,
}) {
  normalizeType(type);
  requiredString(revision, "policy revision");
  for (const [name, method] of Object.entries({
    admission,
    evaluator,
    activation,
    rollback,
  })) {
    if (typeof method !== "function") {
      throw new TypeError(`policy ${name} must be a function`);
    }
  }
  const policy = Object.freeze({
    type,
    revision,
    admit: admission,
    evaluate: evaluator,
    activate: activation,
    rollBack: rollback,
  });
  policyBrands.add(policy);
  return policy;
}

function assertPolicyAllowed(result, stage, policy) {
  if (
    result?.decision !== "allow" ||
    result.policyRevision !== policy.revision
  ) {
    throw new Error(`${policy.type} ${stage} policy rejected the transition`);
  }
}

function evolveArtifact(artifact, patch) {
  const next = { ...clone(artifact), ...clone(patch) };
  delete next.artifactDigest;
  next.artifactDigest = digestValue(next);
  return deepFreeze(next);
}

function createEvolvableArtifactAuthority({ tenantId, policy }) {
  requiredString(tenantId, "tenantId");
  if (!policyBrands.has(policy)) {
    throw new TypeError("a branded EvolvableArtifact policy is required");
  }
  const authorityScope = Object.freeze({});
  const authority = Object.freeze({
    tenantId,
    type: policy.type,
    authorityScope,
    stageCandidate(input) {
      const candidate = normalizeCandidate(input, tenantId, policy.type);
      assertPolicyAllowed(policy.admit(candidate), "admission", policy);
      return candidate;
    },
    recordEvaluation(artifact, receipt) {
      verifyEvolvableArtifact(artifact);
      if (artifact.tenantId !== tenantId || artifact.type !== policy.type) {
        throw new Error("artifact is outside this authority scope");
      }
      if (artifact.stale) throw new Error("stale artifact must be revalidated");
      const evaluation = normalizeReceipt(receipt, artifact, "eval");
      assertPolicyAllowed(
        policy.evaluate({ artifact, receipt: evaluation }),
        "evaluator",
        policy,
      );
      return evolveArtifact(artifact, {
        receipts: { ...artifact.receipts, eval: evaluation },
      });
    },
    createRevalidationCandidate(
      artifact,
      { candidateId, dependencyLock, revalidationReceipt },
    ) {
      verifyEvolvableArtifact(artifact);
      if (artifact.tenantId !== tenantId || artifact.type !== policy.type) {
        throw new Error("artifact is outside this authority scope");
      }
      if (!artifact.stale) {
        throw new Error(
          "only a stale artifact can enter dependency revalidation",
        );
      }
      const normalizedLock = normalizeDependencyLock(dependencyLock);
      if (normalizedLock.digest === artifact.dependencyLock.digest) {
        throw new Error(
          "revalidation candidate must bind a changed dependency lock",
        );
      }
      const draft = evolveArtifact(artifact, {
        parent:
          artifact.release == null
            ? artifact.parent
            : {
                artifactId: artifact.artifactId,
                releaseId: artifact.activeReleaseId,
                contentDigest: artifact.contentDigest,
              },
        dependencyLock: normalizedLock,
        candidate: {
          candidateId: requiredString(candidateId, "candidateId"),
          status: "candidate",
        },
        release: null,
        receipts: {
          revalidation: null,
          eval: null,
          review: null,
          promotion: null,
        },
        stale: false,
        staleReasons: [],
      });
      const receipt = normalizeReceipt(
        revalidationReceipt,
        draft,
        "revalidation",
      );
      const candidate = evolveArtifact(draft, {
        receipts: { ...draft.receipts, revalidation: receipt },
      });
      assertPolicyAllowed(
        policy.admit(candidate),
        "revalidation admission",
        policy,
      );
      return candidate;
    },
    activateCandidate(
      artifact,
      { reviewReceipt, promotionReceipt, releaseId },
    ) {
      verifyEvolvableArtifact(artifact);
      if (artifact.tenantId !== tenantId || artifact.type !== policy.type) {
        throw new Error("artifact is outside this authority scope");
      }
      if (artifact.stale) throw new Error("stale artifact must be revalidated");
      if (!artifact.receipts.eval)
        throw new Error("evaluation receipt is required");
      const review = normalizeReceipt(reviewReceipt, artifact, "review");
      const promotion = normalizeReceipt(
        promotionReceipt,
        artifact,
        "promotion",
      );
      if (artifact.type === ARTIFACT_TYPE.HOOK) assertHookReview(review);
      assertPolicyAllowed(
        policy.activate({
          artifact,
          reviewReceipt: review,
          promotionReceipt: promotion,
        }),
        "activation",
        policy,
      );
      const nextReleaseId = requiredString(releaseId, "releaseId");
      return evolveArtifact(artifact, {
        candidate: { ...artifact.candidate, status: "promoted" },
        release: {
          releaseId: nextReleaseId,
          contentDigest: artifact.contentDigest,
          dependencyLockDigest: artifact.dependencyLock.digest,
          status: "active",
        },
        receipts: {
          revalidation: artifact.receipts.revalidation ?? null,
          eval: artifact.receipts.eval,
          review,
          promotion,
        },
        activeReleaseId: nextReleaseId,
        lastKnownGoodReleaseId:
          artifact.activeReleaseId ?? artifact.lastKnownGoodReleaseId,
      });
    },
    rollBack(artifact, { rollbackReceipt, targetReleaseId }) {
      verifyEvolvableArtifact(artifact);
      if (artifact.tenantId !== tenantId || artifact.type !== policy.type) {
        throw new Error("artifact is outside this authority scope");
      }
      const receipt = normalizeReceipt(rollbackReceipt, artifact, "rollback");
      const target = requiredString(targetReleaseId, "targetReleaseId");
      if (target !== artifact.lastKnownGoodReleaseId) {
        throw new Error("rollback target must be the last-known-good release");
      }
      assertPolicyAllowed(
        policy.rollBack({ artifact, receipt, targetReleaseId: target }),
        "rollback",
        policy,
      );
      return evolveArtifact(artifact, {
        release: { ...artifact.release, status: "rolled-back" },
        activeReleaseId: target,
        lastKnownGoodReleaseId: artifact.activeReleaseId,
      });
    },
  });
  authorityBrands.add(authority);
  return authority;
}

function verifyPersistenceReceipt(receipt, artifact) {
  if (
    receipt?.schema !== EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA ||
    receipt.tenantId !== artifact.tenantId ||
    receipt.type !== artifact.type ||
    receipt.artifactId !== artifact.artifactId ||
    receipt.candidateId !== artifact.candidate.candidateId ||
    receipt.contentDigest !== artifact.contentDigest ||
    receipt.artifactDigest !== artifact.artifactDigest ||
    receipt.status !== "candidate" ||
    receipt.persisted !== true
  ) {
    throw new Error("candidate persistence receipt is invalid");
  }
  return deepFreeze(clone(receipt));
}

function createEvolvableArtifactCandidateGate({ authority, candidateWriter }) {
  if (!authorityBrands.has(authority)) {
    throw new TypeError("a branded EvolvableArtifact authority is required");
  }
  if (
    !candidateWriter ||
    typeof candidateWriter.persistCandidate !== "function"
  ) {
    throw new TypeError("candidateWriter.persistCandidate is required");
  }
  const persistCandidate =
    candidateWriter.persistCandidate.bind(candidateWriter);

  async function persist(artifact, content) {
    if (
      content !== undefined &&
      digestValue(content) !== artifact.contentDigest
    ) {
      throw new Error("candidate content does not match contentDigest");
    }
    const receipt = verifyPersistenceReceipt(
      await persistCandidate(artifact, content),
      artifact,
    );
    return deepFreeze({ artifact, receipt });
  }

  const gate = Object.freeze({
    tenantId: authority.tenantId,
    type: authority.type,
    authorityScope: authority.authorityScope,
    async stageCandidate(input, content = undefined) {
      const artifact = authority.stageCandidate(input);
      return persist(artifact, content);
    },
    async stageRevalidationCandidate(
      staleArtifact,
      { candidateId, dependencyLock, revalidationReceipt },
      content = undefined,
    ) {
      const artifact = authority.createRevalidationCandidate(staleArtifact, {
        candidateId,
        dependencyLock,
        revalidationReceipt,
      });
      return persist(artifact, content);
    },
  });
  candidateGateBrands.add(gate);
  return gate;
}

function isEvolvableArtifactCandidateGate(value, type = null) {
  return (
    candidateGateBrands.has(value) &&
    (type == null || value.type === normalizeType(type))
  );
}

function createTransitionRequest(kind, previous, next) {
  const core = {
    schema: EVOLVABLE_ARTIFACT_TRANSITION_REQUEST_SCHEMA,
    kind,
    tenantId: next.tenantId,
    type: next.type,
    artifactId: next.artifactId,
    candidateId: next.candidate.candidateId,
    releaseId: next.activeReleaseId,
    previousArtifactDigest: previous.artifactDigest,
    nextArtifactDigest: next.artifactDigest,
  };
  const requestDigest = digestValue(core);
  return deepFreeze({
    ...core,
    requestDigest,
    operationId: `artifact-transition:${requestDigest.slice(7)}`,
  });
}

function verifyTransitionReceipt(receipt, request) {
  if (
    receipt?.schema !== EVOLVABLE_ARTIFACT_TRANSITION_RECEIPT_SCHEMA ||
    receipt.operationId !== request.operationId ||
    receipt.requestDigest !== request.requestDigest ||
    receipt.kind !== request.kind ||
    receipt.tenantId !== request.tenantId ||
    receipt.type !== request.type ||
    receipt.artifactId !== request.artifactId ||
    receipt.candidateId !== request.candidateId ||
    receipt.releaseId !== request.releaseId ||
    receipt.artifactDigest !== request.nextArtifactDigest ||
    receipt.persisted !== true ||
    receipt.durable !== true ||
    !Number.isSafeInteger(receipt.revision) ||
    receipt.revision < 1
  ) {
    throw new Error("artifact transition receipt is invalid");
  }
  requiredDigest(receipt.receiptDigest, "transition receiptDigest");
  const body = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receiptDigest"),
  );
  if (receipt.receiptDigest !== digestValue(body)) {
    throw new Error("artifact transition receipt digest is invalid");
  }
  return deepFreeze(clone(receipt));
}

function verifyTransitionReadback(readback, request, artifact, receipt = null) {
  if (
    !readback ||
    canonical(readback.request) !== canonical(request) ||
    readback.artifact?.artifactDigest !== artifact.artifactDigest ||
    canonical(readback.artifact) !== canonical(artifact)
  ) {
    throw new Error("artifact transition durable readback is invalid");
  }
  verifyEvolvableArtifact(readback.artifact);
  const storedReceipt = verifyTransitionReceipt(readback.receipt, request);
  if (receipt && canonical(storedReceipt) !== canonical(receipt)) {
    throw new Error(
      "artifact transition response differs from durable readback",
    );
  }
  return storedReceipt;
}

function createEvolvableArtifactReleaseGate({
  authority,
  transitionWriter,
  transitionReader,
}) {
  if (!authorityBrands.has(authority)) {
    throw new TypeError("a branded EvolvableArtifact authority is required");
  }
  if (
    !transitionWriter ||
    typeof transitionWriter.commitTransition !== "function"
  ) {
    throw new TypeError("transitionWriter.commitTransition is required");
  }
  if (
    !transitionReader ||
    typeof transitionReader.readTransition !== "function"
  ) {
    throw new TypeError("transitionReader.readTransition is required");
  }
  const commitTransition =
    transitionWriter.commitTransition.bind(transitionWriter);
  const readTransition = transitionReader.readTransition.bind(transitionReader);
  const preparedPromotions = new WeakSet();

  async function commit(kind, previous, next) {
    const request = createTransitionRequest(kind, previous, next);
    let responseReceipt = null;
    let responseError = null;
    try {
      responseReceipt = verifyTransitionReceipt(
        await commitTransition({ request, artifact: next }),
        request,
      );
    } catch (error) {
      responseError = error;
    }
    const readback = await readTransition({
      operationId: request.operationId,
    });
    if (!readback) {
      if (responseError) throw responseError;
      throw new Error("artifact transition was not durably readable");
    }
    const durableReceipt = verifyTransitionReadback(
      readback,
      request,
      next,
      responseReceipt,
    );
    return deepFreeze({
      artifact: next,
      receipt: durableReceipt,
      recovered: responseError !== null,
    });
  }

  const gate = Object.freeze({
    tenantId: authority.tenantId,
    type: authority.type,
    authorityScope: authority.authorityScope,
    transitionReaderScope: transitionReader.readerScope ?? transitionReader,
    preparePromotion({
      artifact,
      candidatePersistenceReceipt,
      evaluationReceipt,
      reviewReceipt,
      promotionReceipt,
      releaseId,
    }) {
      verifyEvolvableArtifact(artifact);
      verifyPersistenceReceipt(candidatePersistenceReceipt, artifact);
      const evaluated = authority.recordEvaluation(artifact, evaluationReceipt);
      const active = authority.activateCandidate(evaluated, {
        reviewReceipt,
        promotionReceipt,
        releaseId,
      });
      const prepared = deepFreeze({
        kind: "promote",
        tenantId: authority.tenantId,
        type: authority.type,
        previousArtifact: artifact,
        artifact: active,
      });
      preparedPromotions.add(prepared);
      return prepared;
    },
    async commitPreparedPromotion(prepared) {
      if (!preparedPromotions.has(prepared) || prepared.kind !== "promote") {
        throw new TypeError(
          "a promotion prepared by this release gate is required",
        );
      }
      return commit("promote", prepared.previousArtifact, prepared.artifact);
    },
    async promote(input) {
      return gate.commitPreparedPromotion(gate.preparePromotion(input));
    },
    async rollBack({ artifact, rollbackReceipt, targetReleaseId }) {
      verifyEvolvableArtifact(artifact);
      const rolledBack = authority.rollBack(artifact, {
        rollbackReceipt,
        targetReleaseId,
      });
      return commit("rollback", artifact, rolledBack);
    },
  });
  releaseGateBrands.add(gate);
  return gate;
}

function isEvolvableArtifactReleaseGate(value, type = null) {
  return (
    releaseGateBrands.has(value) &&
    (type == null || value.type === normalizeType(type))
  );
}

function normalizeActiveRelease(value, gate) {
  let artifact;
  try {
    artifact = verifyEvolvableArtifact(value?.artifact);
  } catch {
    throw new Error("active artifact release is invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.tenantId !== gate.tenantId ||
    value.type !== gate.type ||
    typeof value.artifactId !== "string" ||
    value.artifactId.trim() === "" ||
    typeof value.releaseId !== "string" ||
    value.releaseId.trim() === "" ||
    !DIGEST.test(value.contentDigest || "") ||
    !DIGEST.test(value.artifactDigest || "") ||
    typeof value.contentAvailable !== "boolean" ||
    artifact.tenantId !== value.tenantId ||
    artifact.type !== value.type ||
    artifact.artifactId !== value.artifactId ||
    artifact.activeReleaseId !== value.releaseId ||
    artifact.contentDigest !== value.contentDigest ||
    artifact.artifactDigest !== value.artifactDigest ||
    artifact.release?.status !== "active" ||
    (value.contentAvailable
      ? digestValue(value.content) !== value.contentDigest
      : value.content !== null)
  ) {
    throw new Error("active artifact release is invalid");
  }
  return deepFreeze(clone(value));
}

function createEvolvableArtifactActiveReleaseReader({ releaseGate, provider }) {
  if (!releaseGateBrands.has(releaseGate)) {
    throw new TypeError("a branded EvolvableArtifact release gate is required");
  }
  if (
    !provider ||
    typeof provider.listActive !== "function" ||
    typeof provider.readActive !== "function"
  ) {
    throw new TypeError("active release reader provider is required");
  }
  const listActive = provider.listActive.bind(provider);
  const readActive = provider.readActive.bind(provider);
  const reader = Object.freeze({
    tenantId: releaseGate.tenantId,
    type: releaseGate.type,
    readerScope: provider.readerScope ?? provider,
    async listActive() {
      const values = await listActive({ type: releaseGate.type });
      if (!Array.isArray(values) || values.length > 10_000) {
        throw new Error("active artifact release list is invalid");
      }
      const normalized = values.map((value) =>
        normalizeActiveRelease(value, releaseGate),
      );
      const ids = normalized.map((value) => value.artifactId);
      if (new Set(ids).size !== ids.length) {
        throw new Error("active artifact release list is ambiguous");
      }
      normalized.sort((left, right) =>
        left.artifactId.localeCompare(right.artifactId),
      );
      return deepFreeze(normalized);
    },
    async readActive({ artifactId } = {}) {
      const normalizedId = requiredString(artifactId, "artifactId");
      const value = await readActive({
        type: releaseGate.type,
        artifactId: normalizedId,
      });
      if (value === null) return null;
      const normalized = normalizeActiveRelease(value, releaseGate);
      if (normalized.artifactId !== normalizedId) {
        throw new Error("active artifact release substituted artifactId");
      }
      return normalized;
    },
  });
  activeReleaseReaderBrands.add(reader);
  return reader;
}

function isEvolvableArtifactActiveReleaseReader(value, type = null) {
  return (
    activeReleaseReaderBrands.has(value) &&
    (type == null || value.type === normalizeType(type))
  );
}

function createEvolvableArtifactCandidateReader({ candidateGate, provider }) {
  if (!candidateGateBrands.has(candidateGate)) {
    throw new TypeError(
      "a branded EvolvableArtifact candidate gate is required",
    );
  }
  if (!provider || typeof provider.readCandidate !== "function") {
    throw new TypeError("candidate reader provider is required");
  }
  const readCandidate = provider.readCandidate.bind(provider);
  const reader = Object.freeze({
    tenantId: candidateGate.tenantId,
    type: candidateGate.type,
    readerScope: provider.readerScope ?? provider,
    async readCandidate({ artifactId, candidateId } = {}) {
      const expectedArtifactId = requiredString(artifactId, "artifactId");
      const expectedCandidateId = requiredString(candidateId, "candidateId");
      const value = await readCandidate({
        type: candidateGate.type,
        artifactId: expectedArtifactId,
        candidateId: expectedCandidateId,
      });
      if (value === null) return null;
      let artifact;
      try {
        artifact = verifyEvolvableArtifact(value?.artifact);
      } catch {
        throw new Error("candidate artifact read is invalid");
      }
      const persistenceReceipt = verifyPersistenceReceipt(
        value.persistenceReceipt,
        artifact,
      );
      if (
        value.schema !== EVOLVABLE_ARTIFACT_CANDIDATE_READ_SCHEMA ||
        value.authenticated !== true ||
        value.durable !== true ||
        value.tenantId !== candidateGate.tenantId ||
        value.type !== candidateGate.type ||
        value.artifactId !== expectedArtifactId ||
        value.candidateId !== expectedCandidateId ||
        value.contentDigest !== artifact.contentDigest ||
        value.artifactDigest !== artifact.artifactDigest ||
        artifact.tenantId !== candidateGate.tenantId ||
        artifact.type !== candidateGate.type ||
        artifact.artifactId !== expectedArtifactId ||
        artifact.candidate.candidateId !== expectedCandidateId ||
        artifact.candidate.status !== "candidate" ||
        artifact.release !== null ||
        typeof value.contentAvailable !== "boolean" ||
        (value.contentAvailable
          ? digestValue(value.content) !== artifact.contentDigest
          : value.content !== null)
      ) {
        throw new Error("candidate artifact read is invalid");
      }
      return deepFreeze({
        ...clone(value),
        artifact,
        persistenceReceipt,
      });
    },
  });
  candidateReaderBrands.add(reader);
  return reader;
}

function isEvolvableArtifactCandidateReader(value, type = null) {
  return (
    candidateReaderBrands.has(value) &&
    (type == null || value.type === normalizeType(type))
  );
}

function createEvolvableArtifactLifecycleProducer({
  candidateGate,
  releaseGate,
  activeReleaseReader,
  candidateReader,
  promotionProvider,
  revalidationProvider,
}) {
  if (
    !candidateGateBrands.has(candidateGate) ||
    !releaseGateBrands.has(releaseGate) ||
    !activeReleaseReaderBrands.has(activeReleaseReader) ||
    !candidateReaderBrands.has(candidateReader) ||
    candidateGate.authorityScope !== releaseGate.authorityScope ||
    new Set([
      candidateGate.tenantId,
      releaseGate.tenantId,
      activeReleaseReader.tenantId,
      candidateReader.tenantId,
    ]).size !== 1 ||
    new Set([
      candidateGate.type,
      releaseGate.type,
      activeReleaseReader.type,
      candidateReader.type,
    ]).size !== 1
  ) {
    throw new TypeError(
      "lifecycle producer requires one branded artifact scope",
    );
  }
  if (typeof promotionProvider?.authorizePromotion !== "function") {
    throw new TypeError("promotionProvider.authorizePromotion is required");
  }
  if (typeof revalidationProvider?.authorizeRevalidation !== "function") {
    throw new TypeError(
      "revalidationProvider.authorizeRevalidation is required",
    );
  }
  const authorizePromotion =
    promotionProvider.authorizePromotion.bind(promotionProvider);
  const authorizeRevalidation =
    revalidationProvider.authorizeRevalidation.bind(revalidationProvider);
  const producer = Object.freeze({
    tenantId: candidateGate.tenantId,
    type: candidateGate.type,
    async promote({ artifactId, candidateId } = {}) {
      const candidate = await candidateReader.readCandidate({
        artifactId,
        candidateId,
      });
      if (!candidate) throw new Error("artifact candidate is unavailable");
      const authorization = await authorizePromotion({
        tenantId: candidateGate.tenantId,
        type: candidateGate.type,
        artifact: candidate.artifact,
        persistenceReceipt: candidate.persistenceReceipt,
      });
      if (
        authorization?.authenticated !== true ||
        authorization?.durable !== true
      ) {
        throw new Error("artifact promotion authorization is not durable");
      }
      const transition = await releaseGate.promote({
        artifact: candidate.artifact,
        candidatePersistenceReceipt: candidate.persistenceReceipt,
        evaluationReceipt: authorization.evaluationReceipt,
        reviewReceipt: authorization.reviewReceipt,
        promotionReceipt: authorization.promotionReceipt,
        releaseId: authorization.releaseId,
      });
      const active = await activeReleaseReader.readActive({ artifactId });
      if (
        !active ||
        active.artifactDigest !== transition.artifact.artifactDigest ||
        active.releaseId !== transition.artifact.activeReleaseId ||
        active.contentDigest !== transition.artifact.contentDigest
      ) {
        throw new Error("artifact promotion active readback differs");
      }
      return deepFreeze({ transition, active });
    },
    async revalidate({ artifactId } = {}) {
      const active = await activeReleaseReader.readActive({ artifactId });
      if (!active) throw new Error("active artifact is unavailable");
      if (!active.artifact.stale) {
        throw new Error("only a stale active artifact can be revalidated");
      }
      if (!active.contentAvailable) {
        throw new Error("stale artifact content is unavailable");
      }
      const authorization = await authorizeRevalidation({
        tenantId: candidateGate.tenantId,
        type: candidateGate.type,
        artifact: active.artifact,
      });
      if (
        authorization?.authenticated !== true ||
        authorization?.durable !== true
      ) {
        throw new Error("artifact revalidation authorization is not durable");
      }
      return candidateGate.stageRevalidationCandidate(
        active.artifact,
        {
          candidateId: authorization.candidateId,
          dependencyLock: authorization.dependencyLock,
          revalidationReceipt: authorization.revalidationReceipt,
        },
        active.content,
      );
    },
  });
  lifecycleProducerBrands.add(producer);
  return producer;
}

function isEvolvableArtifactLifecycleProducer(value, type = null) {
  return (
    lifecycleProducerBrands.has(value) &&
    (type == null || value.type === normalizeType(type))
  );
}

const ARTIFACT_DEPENDENCY_PREFIX = Object.freeze({
  [ARTIFACT_TYPE.SKILL]: "Skill",
  [ARTIFACT_TYPE.PROMPT]: "Prompt",
  [ARTIFACT_TYPE.HOOK]: "Hook",
  [ARTIFACT_TYPE.KNOWLEDGE]: "Knowledge",
});

function createEvolvableArtifactRuntimeComposition({ tenantId, artifacts }) {
  requiredString(tenantId, "tenantId");
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new TypeError("runtime composition artifacts must be an object");
  }
  const entries = Object.entries(artifacts);
  if (entries.length === 0) {
    throw new TypeError(
      "runtime composition requires at least one artifact type",
    );
  }

  const dependencies = {};
  const types = [];
  for (const [type, config] of entries) {
    normalizeType(type);
    requireExactObjectKeys(
      config,
      [
        "policy",
        "candidateWriter",
        "transitionWriter",
        "transitionReader",
        "activeProvider",
        "candidateProvider",
        "promotionProvider",
        "revalidationProvider",
      ],
      `${type} runtime composition config`,
    );
    requireExactObjectKeys(
      config.policy,
      ["revision", "admission", "evaluator", "activation", "rollback"],
      `${type} runtime composition policy`,
    );
    const policy = createEvolvableArtifactPolicy({ type, ...config.policy });
    const authority = createEvolvableArtifactAuthority({ tenantId, policy });
    const candidateGate = createEvolvableArtifactCandidateGate({
      authority,
      candidateWriter: config.candidateWriter,
    });
    const releaseGate = createEvolvableArtifactReleaseGate({
      authority,
      transitionWriter: config.transitionWriter,
      transitionReader: config.transitionReader,
    });
    const activeReleaseReader = createEvolvableArtifactActiveReleaseReader({
      releaseGate,
      provider: config.activeProvider,
    });
    const candidateReader = createEvolvableArtifactCandidateReader({
      candidateGate,
      provider: config.candidateProvider,
    });
    const lifecycleProducer = createEvolvableArtifactLifecycleProducer({
      candidateGate,
      releaseGate,
      activeReleaseReader,
      candidateReader,
      promotionProvider: config.promotionProvider,
      revalidationProvider: config.revalidationProvider,
    });
    const prefix = ARTIFACT_DEPENDENCY_PREFIX[type];
    dependencies[`evolvableArtifact${prefix}CandidateGate`] = candidateGate;
    dependencies[`evolvableArtifact${prefix}ReleaseGate`] = releaseGate;
    dependencies[`evolvableArtifact${prefix}ActiveReleaseReader`] =
      activeReleaseReader;
    dependencies[`evolvableArtifact${prefix}CandidateReader`] = candidateReader;
    dependencies[`evolvableArtifact${prefix}LifecycleProducer`] =
      lifecycleProducer;
    types.push(type);
  }

  const composition = Object.freeze({
    tenantId,
    types: Object.freeze(types.sort()),
  });
  runtimeCompositionBrands.add(composition);
  runtimeCompositionDependencies.set(composition, Object.freeze(dependencies));
  return composition;
}

function isEvolvableArtifactRuntimeComposition(value) {
  return runtimeCompositionBrands.has(value);
}

function getEvolvableArtifactRuntimeDependencies(composition) {
  if (!runtimeCompositionBrands.has(composition)) {
    throw new TypeError(
      "a branded EvolvableArtifact runtime composition is required",
    );
  }
  return runtimeCompositionDependencies.get(composition);
}

function projectEvolvableArtifactDependencyChange(
  artifacts,
  changedDependency,
) {
  if (!Array.isArray(artifacts))
    throw new TypeError("artifacts must be an array");
  const verified = artifacts.map(verifyEvolvableArtifact);
  const changedId = requiredString(
    changedDependency.artifactId,
    "changed artifactId",
  );
  const releaseId = requiredString(
    changedDependency.releaseId,
    "changed releaseId",
  );
  const contentDigest = requiredDigest(
    changedDependency.contentDigest,
    "changed contentDigest",
  );
  const staleIds = new Set();
  const reasons = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of verified) {
      if (staleIds.has(artifact.artifactId)) continue;
      const mismatches = artifact.dependencyLock.dependencies.filter(
        (dependency) =>
          dependency.artifactId === changedId
            ? dependency.releaseId !== releaseId ||
              dependency.contentDigest !== contentDigest
            : staleIds.has(dependency.artifactId),
      );
      if (mismatches.length > 0) {
        staleIds.add(artifact.artifactId);
        reasons.set(
          artifact.artifactId,
          mismatches.map((dependency) => `dependency:${dependency.artifactId}`),
        );
        changed = true;
      }
    }
  }
  const projected = verified.map((artifact) =>
    staleIds.has(artifact.artifactId)
      ? evolveArtifact(artifact, {
          stale: true,
          staleReasons: reasons.get(artifact.artifactId),
        })
      : artifact,
  );
  return deepFreeze({
    schema: EVOLVABLE_ARTIFACT_DEPENDENCY_PROJECTION_SCHEMA,
    changedDependency: { artifactId: changedId, releaseId, contentDigest },
    staleArtifactIds: [...staleIds].sort(),
    artifacts: projected,
    projectionDigest: digestValue(
      projected.map((artifact) => artifact.artifactDigest),
    ),
  });
}

function createEvolvableArtifactReceipt(input) {
  const body = {
    schema: EVOLVABLE_ARTIFACT_RECEIPT_SCHEMA,
    kind: input.kind,
    tenantId: input.tenantId,
    artifactId: input.artifactId,
    candidateId: input.candidateId,
    contentDigest: input.contentDigest,
    dependencyLockDigest: input.dependencyLockDigest,
    issuerId: input.issuerId,
    issuerRevision: input.issuerRevision,
    issuedAt: input.issuedAt,
    decision: input.decision,
    claims: clone(input.claims ?? {}),
  };
  if (!RECEIPT_KINDS.has(body.kind))
    throw new TypeError("receipt kind is invalid");
  return deepFreeze({ ...body, receiptDigest: digestValue(body) });
}

module.exports = {
  EVOLVABLE_ARTIFACT_SCHEMA,
  EVOLVABLE_ARTIFACT_RECEIPT_SCHEMA,
  EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
  EVOLVABLE_ARTIFACT_DEPENDENCY_PROJECTION_SCHEMA,
  EVOLVABLE_ARTIFACT_TRANSITION_REQUEST_SCHEMA,
  EVOLVABLE_ARTIFACT_TRANSITION_RECEIPT_SCHEMA,
  EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA,
  EVOLVABLE_ARTIFACT_CANDIDATE_READ_SCHEMA,
  ARTIFACT_TYPE,
  ARTIFACT_TYPES,
  digestEvolvableArtifactValue: digestValue,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
  isEvolvableArtifactCandidateGate,
  createEvolvableArtifactReleaseGate,
  isEvolvableArtifactReleaseGate,
  createEvolvableArtifactActiveReleaseReader,
  isEvolvableArtifactActiveReleaseReader,
  createEvolvableArtifactCandidateReader,
  isEvolvableArtifactCandidateReader,
  createEvolvableArtifactLifecycleProducer,
  isEvolvableArtifactLifecycleProducer,
  createEvolvableArtifactRuntimeComposition,
  isEvolvableArtifactRuntimeComposition,
  getEvolvableArtifactRuntimeDependencies,
  verifyEvolvableArtifact,
  projectEvolvableArtifactDependencyChange,
  createEvolvableArtifactReceipt,
};
