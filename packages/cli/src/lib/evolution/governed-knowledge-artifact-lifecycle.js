import { types as utilTypes } from "node:util";

import evolvableArtifactProtocol from "@chainlesschain/session-core/evolvable-artifact";

import {
  isEvolvableArtifactReleaseResolver,
  isEvolvableArtifactTransitionReader,
} from "./evolvable-artifact-ledger-adapter.js";
import { verifyGovernedKnowledgeRecord } from "./governed-knowledge-sync.js";

const {
  ARTIFACT_TYPE,
  createEvolvableArtifactReceipt,
  digestEvolvableArtifactValue,
  isEvolvableArtifactCandidateGate,
  isEvolvableArtifactReleaseGate,
} = evolvableArtifactProtocol;

export const GOVERNED_KNOWLEDGE_ARTIFACT_LIFECYCLE_SCHEMA =
  "chainlesschain.governed-knowledge-artifact-lifecycle/v1";

const LIFECYCLES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const OPERATIONS = new Set(["publish", "receive", "merge"]);

function freeze(value) {
  const result = structuredClone(value);
  function visit(entry) {
    if (entry && typeof entry === "object" && !Object.isFrozen(entry)) {
      Object.freeze(entry);
      for (const child of Object.values(entry)) visit(child);
    }
  }
  visit(result);
  return result;
}

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  )
    throw new TypeError(`${label}.${method}() is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function manifest(body) {
  return freeze({ ...body, digest: digestEvolvableArtifactValue(body) });
}

function receipt(artifact, kind, issuedAt, operationDigest, claims) {
  return createEvolvableArtifactReceipt({
    kind,
    tenantId: artifact.tenantId,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    dependencyLockDigest: artifact.dependencyLock.digest,
    issuerId: `governed-knowledge-lifecycle:${kind}`,
    issuerRevision: "v1",
    issuedAt,
    decision: "allow",
    claims: { operationDigest, ...claims },
  });
}

export function createGovernedKnowledgeArtifactLifecycle({
  tenantId,
  artifactCandidateGate,
  artifactReleaseGate,
  artifactReleaseResolver,
  verifierArtifactTransitionReader,
} = {}) {
  if (typeof tenantId !== "string" || tenantId.trim() === "")
    throw new TypeError("tenantId is required");
  if (
    !isEvolvableArtifactCandidateGate(
      artifactCandidateGate,
      ARTIFACT_TYPE.KNOWLEDGE,
    ) ||
    artifactCandidateGate.tenantId !== tenantId
  )
    throw new TypeError("a tenant-bound Knowledge candidate gate is required");
  if (
    !isEvolvableArtifactReleaseGate(
      artifactReleaseGate,
      ARTIFACT_TYPE.KNOWLEDGE,
    ) ||
    artifactReleaseGate.tenantId !== tenantId ||
    artifactReleaseGate.authorityScope !== artifactCandidateGate.authorityScope
  )
    throw new TypeError("a same-authority Knowledge release gate is required");
  if (
    !isEvolvableArtifactReleaseResolver(artifactReleaseResolver) ||
    artifactReleaseResolver.tenantId !== tenantId
  )
    throw new TypeError("a tenant-bound artifact release resolver is required");
  if (
    !isEvolvableArtifactTransitionReader(verifierArtifactTransitionReader) ||
    verifierArtifactTransitionReader.tenantId !== tenantId ||
    verifierArtifactTransitionReader.readerScope ===
      artifactReleaseGate.transitionReaderScope
  )
    throw new TypeError(
      "an independent artifact transition reader is required",
    );

  const stageCandidate = capture(
    artifactCandidateGate,
    "stageCandidate",
    "artifactCandidateGate",
  );
  const preparePromotion = capture(
    artifactReleaseGate,
    "preparePromotion",
    "artifactReleaseGate",
  );
  const commitPromotion = capture(
    artifactReleaseGate,
    "commitPreparedPromotion",
    "artifactReleaseGate",
  );
  const resolveDependency = capture(
    artifactReleaseResolver,
    "resolveDependency",
    "artifactReleaseResolver",
  );
  const readTransition = capture(
    verifierArtifactTransitionReader,
    "readTransition",
    "verifierArtifactTransitionReader",
  );
  const preparedHandles = new WeakSet();

  async function resolveOne(dependency) {
    const resolved = await resolveDependency({ tenantId, ...dependency });
    if (
      resolved?.authenticated !== true ||
      resolved.durable !== true ||
      resolved.tenantId !== tenantId ||
      resolved.sourceKind !== dependency.kind ||
      resolved.sourceDigest !== dependency.digest ||
      resolved.sourceDisposition !== dependency.disposition ||
      !DIGEST.test(resolved.artifactDigest ?? "")
    )
      throw new Error("Knowledge artifact dependency resolution is invalid");
    return {
      artifactId: resolved.artifactId,
      type: resolved.type,
      releaseId: resolved.releaseId,
      contentDigest: resolved.contentDigest,
    };
  }

  async function resolveBaseline(currentKnowledge) {
    if (currentKnowledge === null) return null;
    const resolved = await resolveOne({
      kind: "active-knowledge",
      digest: currentKnowledge.contentDigest,
      disposition: "baseline",
    });
    if (resolved.artifactId !== currentKnowledge.knowledgeId)
      throw new Error("Knowledge typed baseline resolved another artifact");
    return resolved;
  }

  const lifecycle = Object.freeze({
    schema: GOVERNED_KNOWLEDGE_ARTIFACT_LIFECYCLE_SCHEMA,
    tenantId,
    async prepare({
      knowledge: knowledgeInput,
      currentKnowledge: currentInput = null,
      operation,
      operationId,
      authorizationReceiptDigest,
      evidenceDigest = null,
      issuedAt,
      activate = true,
      humanReviewed = false,
    } = {}) {
      if (!OPERATIONS.has(operation))
        throw new TypeError("Knowledge lifecycle operation is invalid");
      if (!ID.test(operationId ?? ""))
        throw new TypeError("Knowledge lifecycle operationId is required");
      if (!DIGEST.test(authorizationReceiptDigest ?? ""))
        throw new TypeError("authorizationReceiptDigest is invalid");
      if (!Number.isFinite(Date.parse(issuedAt)))
        throw new TypeError("Knowledge lifecycle issuedAt is invalid");
      const boundEvidenceDigest = evidenceDigest ?? authorizationReceiptDigest;
      if (
        !DIGEST.test(boundEvidenceDigest) ||
        typeof humanReviewed !== "boolean"
      )
        throw new TypeError("Knowledge lifecycle evidence is invalid");
      const knowledge = verifyGovernedKnowledgeRecord(knowledgeInput, {
        tenantId,
      });
      const currentKnowledge =
        currentInput === null
          ? null
          : verifyGovernedKnowledgeRecord(currentInput, { tenantId });
      if (
        currentKnowledge !== null &&
        (currentKnowledge.knowledgeId !== knowledge.knowledgeId ||
          currentKnowledge.scope !== knowledge.scope ||
          currentKnowledge.scopeId !== knowledge.scopeId)
      )
        throw new Error("Knowledge lifecycle baseline boundary changed");
      const baseline = await resolveBaseline(currentKnowledge);
      const dependencies = [];
      if (knowledge.action === "upsert") {
        for (const dependency of knowledge.dependencies)
          dependencies.push(await resolveOne(dependency));
      }
      dependencies.sort((left, right) =>
        left.artifactId.localeCompare(right.artifactId),
      );
      const dependencyLock = {
        dependencies,
        digest: digestEvolvableArtifactValue({ dependencies }),
      };
      const operationCore = {
        tenantId,
        operation,
        operationId,
        knowledgeId: knowledge.knowledgeId,
        contentDigest: knowledge.contentDigest,
        currentContentDigest: currentKnowledge?.contentDigest ?? null,
        authorizationReceiptDigest,
        evidenceDigest: boundEvidenceDigest,
        humanReviewed,
      };
      const operationDigest = digestEvolvableArtifactValue(operationCore);
      const staged = await stageCandidate({
        tenantId,
        artifactId: knowledge.knowledgeId,
        type: ARTIFACT_TYPE.KNOWLEDGE,
        contentDigest: knowledge.contentDigest,
        parent:
          baseline === null
            ? null
            : {
                artifactId: baseline.artifactId,
                releaseId: baseline.releaseId,
                contentDigest: baseline.contentDigest,
              },
        lineage: [
          ...(currentKnowledge ? [currentKnowledge.contentDigest] : []),
          knowledge.contentDigest,
        ],
        dependencyLock,
        runtimeManifest: manifest({
          executable: false,
          operation,
          operationId,
          operationDigest,
          action: knowledge.action,
          scope: knowledge.scope,
          scopeId: knowledge.scopeId,
          vectorClock: knowledge.vectorClock,
          dependencyDispositionDigest: digestEvolvableArtifactValue(
            knowledge.dependencies,
          ),
        }),
        permissionManifest: manifest({
          authorizationReceiptDigest,
          approvalReceiptDigest: knowledge.approvalReceiptDigest,
          revocationReceiptDigest: knowledge.revocationReceiptDigest,
          capabilities: [`knowledge:${knowledge.scope}:${operation}`],
        }),
        candidateId: `knowledge-candidate:${operationDigest.slice(7)}`,
        activeReleaseId: baseline?.releaseId ?? null,
        lastKnownGoodReleaseId: null,
      });
      const promotion = activate
        ? preparePromotion({
            artifact: staged.artifact,
            candidatePersistenceReceipt: staged.receipt,
            evaluationReceipt: receipt(
              staged.artifact,
              "eval",
              issuedAt,
              operationDigest,
              { authorizationReceiptDigest },
            ),
            reviewReceipt: receipt(
              staged.artifact,
              "review",
              issuedAt,
              operationDigest,
              {
                approvalReceiptDigest: knowledge.approvalReceiptDigest,
                automated: !humanReviewed,
                evidenceDigest: boundEvidenceDigest,
              },
            ),
            promotionReceipt: receipt(
              staged.artifact,
              "promotion",
              issuedAt,
              operationDigest,
              { operationId },
            ),
            releaseId: `knowledge-release:${operationDigest.slice(7)}`,
          })
        : null;
      const prepared = Object.freeze({
        operationDigest,
        operation,
        operationId,
        candidate: staged,
        promotion,
        activate,
      });
      preparedHandles.add(prepared);
      return prepared;
    },
    async commit(prepared) {
      if (!preparedHandles.has(prepared))
        throw new TypeError(
          "a prepared Knowledge lifecycle handle is required",
        );
      if (!prepared.activate)
        return freeze({
          candidateOnly: true,
          artifactCandidateDigest: prepared.candidate.artifact.artifactDigest,
          operationDigest: prepared.operationDigest,
        });
      const committed = await commitPromotion(prepared.promotion);
      const readback = await readTransition({
        operationId: committed.receipt.operationId,
      });
      if (
        readback?.request?.previousArtifactDigest !==
          prepared.candidate.artifact.artifactDigest ||
        readback.request.nextArtifactDigest !==
          committed.artifact.artifactDigest ||
        readback.artifact.artifactDigest !==
          committed.artifact.artifactDigest ||
        readback.receipt.receiptDigest !== committed.receipt.receiptDigest ||
        readback.receipt.durable !== true
      )
        throw new Error("Knowledge artifact transition readback is invalid");
      return freeze({
        candidateOnly: false,
        operationDigest: prepared.operationDigest,
        artifactCandidateDigest: prepared.candidate.artifact.artifactDigest,
        artifactDigest: committed.artifact.artifactDigest,
        artifactReleaseId: committed.artifact.activeReleaseId,
        artifactTransitionOperationId: committed.receipt.operationId,
        artifactTransitionReceiptDigest: committed.receipt.receiptDigest,
      });
    },
  });
  LIFECYCLES.add(lifecycle);
  return lifecycle;
}

export function isGovernedKnowledgeArtifactLifecycle(value) {
  return LIFECYCLES.has(value);
}
