import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";

const { StructuredEvolutionMemory, createStructuredMemoryAuthorityReceipt } =
  structuredMemory;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVIEWERS = new WeakSet();

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function requiredDigest(value, name) {
  if (!DIGEST.test(value || "")) {
    throw new TypeError(`${name} must be sha256-bound`);
  }
  return value;
}

function strings(value, name, { allowEmpty = true } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > 256 ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new TypeError(`${name} must be a bounded string list`);
  }
  return [...new Set(value)].sort();
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`${name} port is required`);
  }
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function descriptor(input) {
  if (!["critic", "evaluator"].includes(input?.kind)) {
    throw new TypeError("semantic reviewer kind is invalid");
  }
  for (const field of ["issuerRevision", "verifierRevision"]) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 1) {
      throw new TypeError(`${field} must be a positive integer`);
    }
  }
  const value = Object.freeze({
    tenantId: requiredString(input.tenantId, "tenantId"),
    kind: input.kind,
    issuerId: requiredString(input.issuerId, "issuerId"),
    issuerRevision: input.issuerRevision,
    issuerHandlerDigest: requiredDigest(
      input.issuerHandlerDigest,
      "issuerHandlerDigest",
    ),
    verifierId: requiredString(input.verifierId, "verifierId"),
    verifierRevision: input.verifierRevision,
    verifierHandlerDigest: requiredDigest(
      input.verifierHandlerDigest,
      "verifierHandlerDigest",
    ),
  });
  if (
    value.issuerId === value.verifierId ||
    value.issuerHandlerDigest === value.verifierHandlerDigest
  ) {
    throw new Error(
      "semantic review producer and verifier must be independent",
    );
  }
  return value;
}

function normalizeRequest(input, tenantId) {
  return Object.freeze({
    tenantId,
    memoryId: requiredString(input?.memoryId, "memoryId"),
    layer:
      input?.layer === "semantic"
        ? "semantic"
        : (() => {
            throw new TypeError("semantic layer is required");
          })(),
    action:
      input?.action === "accept"
        ? "accept"
        : (() => {
            throw new TypeError("semantic accept action is required");
          })(),
    contentDigest: requiredDigest(input?.contentDigest, "contentDigest"),
    artifactRef: requiredString(input?.artifactRef, "artifactRef"),
    evidenceRefs: strings(input?.evidenceRefs, "evidenceRefs", {
      allowEmpty: false,
    }),
  });
}

export function createStructuredMemorySemanticReviewer({
  descriptor: input,
  producer,
  attestor,
  verifier,
  clock = () => new Date().toISOString(),
} = {}) {
  const identity = descriptor(input);
  const review = capture(producer, "review");
  const attest = capture(attestor, "attest");
  const verify = capture(verifier, "verify");
  if (typeof clock !== "function")
    throw new TypeError("clock must be a function");
  const reviewer = Object.freeze({
    identity,
    async issue(requestInput) {
      const request = normalizeRequest(requestInput, identity.tenantId);
      const outcome = await review(request);
      if (!outcome || !["accepted", "rejected"].includes(outcome.decision)) {
        throw new Error(`${identity.kind} returned an invalid review decision`);
      }
      const reasonCodes = strings(outcome.reasonCodes || [], "reasonCodes");
      if (outcome.decision !== "accepted") {
        return Object.freeze({
          accepted: false,
          kind: identity.kind,
          reasonCodes,
        });
      }
      const issuedAt = requiredString(clock(), "issuedAt");
      if (!Number.isFinite(Date.parse(issuedAt))) {
        throw new TypeError("issuedAt must be an ISO timestamp");
      }
      const receipt = createStructuredMemoryAuthorityReceipt({
        ...request,
        kind: identity.kind,
        decision: "accepted",
        issuerId: identity.issuerId,
        issuerRevision: identity.issuerRevision,
        issuerHandlerDigest: identity.issuerHandlerDigest,
        issuedAt,
      });
      const attestation = await attest({
        purpose: `structured-memory-${identity.kind}-receipt`,
        payloadDigest: receipt.receiptDigest,
        receipt,
        reasonCodes,
      });
      if (attestation === null || attestation === undefined) {
        throw new Error(`${identity.kind} attestor returned no attestation`);
      }
      const signed = Object.freeze({ ...receipt, attestation });
      if (
        (await verify({
          descriptor: identity,
          request,
          receipt: signed,
          reasonCodes,
        })) !== true
      ) {
        throw new Error(`${identity.kind} receipt authentication failed`);
      }
      return Object.freeze({
        accepted: true,
        kind: identity.kind,
        reasonCodes,
        receipt: signed,
      });
    },
  });
  REVIEWERS.add(reviewer);
  return reviewer;
}

function captureReviewer(value, kind, tenantId) {
  if (
    !REVIEWERS.has(value) ||
    value.identity.kind !== kind ||
    value.identity.tenantId !== tenantId
  ) {
    throw new TypeError(`a branded tenant-scoped ${kind} reviewer is required`);
  }
  return Object.freeze({
    identity: value.identity,
    issue: capture(value, "issue"),
  });
}

export function createStructuredMemorySemanticReviewPipeline({
  tenantId: tenantIdInput,
  memory,
  authorityStore,
  critic,
  evaluator,
  proposerAuthority,
  governorAuthority,
} = {}) {
  const tenantId = requiredString(tenantIdInput, "tenantId");
  if (
    !(memory instanceof StructuredEvolutionMemory) ||
    memory.tenantId !== tenantId
  ) {
    throw new TypeError(
      "a tenant-scoped StructuredEvolutionMemory is required",
    );
  }
  const retainReceipt = capture(authorityStore, "retainReceipt");
  const reviewers = Object.freeze({
    critic: captureReviewer(critic, "critic", tenantId),
    evaluator: captureReviewer(evaluator, "evaluator", tenantId),
  });
  const authorityIds = [
    reviewers.critic.identity.issuerId,
    reviewers.critic.identity.verifierId,
    reviewers.evaluator.identity.issuerId,
    reviewers.evaluator.identity.verifierId,
  ];
  const handlerDigests = [
    reviewers.critic.identity.issuerHandlerDigest,
    reviewers.critic.identity.verifierHandlerDigest,
    reviewers.evaluator.identity.issuerHandlerDigest,
    reviewers.evaluator.identity.verifierHandlerDigest,
  ];
  if (
    new Set(authorityIds).size !== authorityIds.length ||
    new Set(handlerDigests).size !== handlerDigests.length
  ) {
    throw new Error("critic and evaluator authorities must be independent");
  }

  return Object.freeze({
    tenantId,
    async propose(input = {}) {
      return memory.append({
        eventId: requiredString(input.eventId, "eventId"),
        memoryId: requiredString(input.memoryId, "memoryId"),
        layer: "semantic",
        action: "propose",
        authority: proposerAuthority,
        automatic: input.automatic !== false,
        contentDigest: requiredDigest(input.contentDigest, "contentDigest"),
        artifactRef: requiredString(input.artifactRef, "artifactRef"),
        evidenceRefs: strings(input.evidenceRefs, "evidenceRefs", {
          allowEmpty: false,
        }),
        supersedes: strings(input.supersedes || [], "supersedes"),
        timestamp: requiredString(input.timestamp, "timestamp"),
        metadata: input.metadata || {},
      });
    },
    async reviewAndAccept({
      memoryId,
      eventId,
      timestamp,
      metadata = {},
    } = {}) {
      const proposed =
        memory.projection().memories[requiredString(memoryId, "memoryId")];
      if (
        !proposed ||
        proposed.layer !== "semantic" ||
        proposed.status !== "proposed"
      ) {
        throw new Error("semantic memory is not awaiting review");
      }
      const request = {
        tenantId,
        memoryId: proposed.memoryId,
        layer: "semantic",
        action: "accept",
        contentDigest: proposed.contentDigest,
        artifactRef: proposed.artifactRef,
        evidenceRefs: proposed.evidenceRefs,
      };
      const [criticResult, evaluatorResult] = await Promise.all([
        reviewers.critic.issue(request),
        reviewers.evaluator.issue(request),
      ]);
      if (!criticResult.accepted || !evaluatorResult.accepted) {
        throw new Error("semantic memory was rejected by independent review");
      }
      for (const result of [criticResult, evaluatorResult]) {
        const retained = await retainReceipt(result.receipt);
        if (
          retained?.persisted !== true ||
          retained.receiptDigest !== result.receipt.receiptDigest
        ) {
          throw new Error(
            `${result.kind} receipt was not durably acknowledged`,
          );
        }
      }
      return memory.append({
        eventId: requiredString(eventId, "eventId"),
        memoryId: proposed.memoryId,
        layer: "semantic",
        action: "accept",
        authority: governorAuthority,
        automatic: false,
        contentDigest: proposed.contentDigest,
        artifactRef: proposed.artifactRef,
        evidenceRefs: proposed.evidenceRefs,
        supersedes: proposed.supersedes,
        receiptRefs: {
          critic: criticResult.receipt.receiptDigest,
          evaluator: evaluatorResult.receipt.receiptDigest,
        },
        timestamp: requiredString(timestamp, "timestamp"),
        metadata,
      });
    },
  });
}
