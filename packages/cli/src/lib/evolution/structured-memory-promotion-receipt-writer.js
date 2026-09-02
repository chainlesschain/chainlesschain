import { createHash } from "node:crypto";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import { buildSkillEvaluatedPromotionReceiptEnvelope } from "./skill-evaluated-promotion.js";
import { digestSkillMutationReceiptEnvelope } from "./skill-mutation-authority.js";
import { SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA } from "./skill-target-matrix-eval.js";

const { createStructuredMemoryAuthorityReceipt } = structuredMemory;
const SKILL_RELEASE_RECEIPT_SCHEMA =
  "chainlesschain.skill-release-transition-receipt/v4";
const SKILL_PROMOTION_REVIEW_ENVELOPE_SCHEMA =
  "chainlesschain.skill-promotion-review-envelope/v1";
const RELEASE_RECEIPT_DOMAIN = `${SKILL_RELEASE_RECEIPT_SCHEMA}\0`;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const WRITERS = new WeakSet();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

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

function capture(owner, name) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`${name} port is required`);
  }
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function normalizeDescriptor(input) {
  if (
    !Number.isSafeInteger(input?.issuerRevision) ||
    input.issuerRevision < 1
  ) {
    throw new TypeError("issuerRevision must be a positive integer");
  }
  return Object.freeze({
    tenantId: requiredString(input.tenantId, "tenantId"),
    issuerId: requiredString(input.issuerId, "issuerId"),
    issuerRevision: input.issuerRevision,
    issuerHandlerDigest: requiredDigest(
      input.issuerHandlerDigest,
      "issuerHandlerDigest",
    ),
  });
}

function verifyPromotion(result, matrixBinding, reviewBinding, tenantId) {
  const release = result?.release;
  const state = result?.state;
  const receipt = result?.receipt;
  if (
    receipt?.schema !== SKILL_RELEASE_RECEIPT_SCHEMA ||
    receipt.operation !== "promote" ||
    receipt.tenantId !== tenantId ||
    release?.tenantId !== tenantId ||
    state?.tenantId !== tenantId ||
    receipt.skillName !== release.skillName ||
    state.skillName !== release.skillName ||
    receipt.activeReleaseDigest !== release.releaseDigest ||
    state.activeReleaseDigest !== release.releaseDigest ||
    !DIGEST.test(release.releaseDigest || "") ||
    !DIGEST.test(release.contentDigest || "") ||
    !DIGEST.test(receipt.receiptDigest || "")
  ) {
    throw new Error("promotion result is not a committed release transition");
  }
  const core = structuredClone(receipt);
  delete core.receiptDigest;
  if (
    hash(`${RELEASE_RECEIPT_DOMAIN}${canonical(core)}`) !==
    receipt.receiptDigest
  ) {
    throw new Error("promotion transition receipt digest is invalid");
  }
  const evidenceRefs = [receipt.receiptDigest];
  if (matrixBinding !== null) {
    const expectedEvalReceiptDigest = digestSkillMutationReceiptEnvelope(
      buildSkillEvaluatedPromotionReceiptEnvelope({
        schema: SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
        receiptDigest: matrixBinding.matrixReceiptDigest,
      }),
    );
    if (
      matrixBinding?.tenantId !== tenantId ||
      matrixBinding.skillName !== release.skillName ||
      matrixBinding.candidateContentDigest !== release.contentDigest ||
      !DIGEST.test(matrixBinding.matrixReceiptDigest || "") ||
      receipt.receiptDigests?.eval !== expectedEvalReceiptDigest
    ) {
      throw new Error(
        "matrix binding does not authorize the committed release",
      );
    }
    evidenceRefs.push(matrixBinding.matrixReceiptDigest);
  }
  if (reviewBinding !== null) {
    const reviewEnvelope = canonical({
      schema: SKILL_PROMOTION_REVIEW_ENVELOPE_SCHEMA,
      receiptDigest: reviewBinding.reviewReceiptDigest,
    });
    const expectedPolicyReceiptDigest =
      digestSkillMutationReceiptEnvelope(reviewEnvelope);
    if (
      reviewBinding?.tenantId !== tenantId ||
      reviewBinding.skillName !== release.skillName ||
      reviewBinding.candidateId !== release.candidateId ||
      !DIGEST.test(reviewBinding.reviewReceiptDigest || "") ||
      !DIGEST.test(reviewBinding.packetDigest || "") ||
      !DIGEST.test(reviewBinding.capabilityDiffDigest || "") ||
      !DIGEST.test(reviewBinding.candidateDiffDigest || "") ||
      !DIGEST.test(reviewBinding.contentRiskDigest || "") ||
      reviewBinding.matrixReceiptDigest !==
        matrixBinding?.matrixReceiptDigest ||
      receipt.receiptDigests?.policy !== expectedPolicyReceiptDigest
    ) {
      throw new Error(
        "human review binding does not authorize the committed release",
      );
    }
    evidenceRefs.push(reviewBinding.reviewReceiptDigest);
  }
  return { release, receipt, evidenceRefs: [...new Set(evidenceRefs)].sort() };
}

export function createStructuredMemoryPromotionReceiptWriter({
  descriptor: input,
  authorityStore,
  attestor,
  clock = () => new Date().toISOString(),
} = {}) {
  const descriptor = normalizeDescriptor(input);
  const retainReceipt = capture(authorityStore, "retainReceipt");
  const attest = capture(attestor, "attest");
  if (typeof clock !== "function")
    throw new TypeError("clock must be a function");

  const writer = Object.freeze({
    descriptor,
    async retainPromotion(result, matrixBinding = null, reviewBinding = null) {
      const verified = verifyPromotion(
        result,
        matrixBinding,
        reviewBinding,
        descriptor.tenantId,
      );
      const issuedAt = requiredString(clock(), "issuedAt");
      if (!Number.isFinite(Date.parse(issuedAt))) {
        throw new TypeError("issuedAt must be an ISO timestamp");
      }
      const receipt = createStructuredMemoryAuthorityReceipt({
        tenantId: descriptor.tenantId,
        kind: "promotion",
        decision: "accepted",
        memoryId: `skill-release:${verified.release.skillName}:${verified.release.releaseDigest}`,
        layer: "procedural",
        action: "accept",
        contentDigest: verified.release.contentDigest,
        artifactRef: verified.release.releaseDigest,
        evidenceRefs: verified.evidenceRefs,
        issuerId: descriptor.issuerId,
        issuerRevision: descriptor.issuerRevision,
        issuerHandlerDigest: descriptor.issuerHandlerDigest,
        issuedAt,
      });
      const attestation = await attest({
        purpose: "structured-memory-promotion-receipt",
        payloadDigest: receipt.receiptDigest,
        receipt,
      });
      if (attestation === null || attestation === undefined) {
        throw new Error("promotion receipt attestor returned no attestation");
      }
      const signed = Object.freeze({ ...receipt, attestation });
      const retained = await retainReceipt(signed);
      if (
        retained?.persisted !== true ||
        retained.receiptDigest !== receipt.receiptDigest
      ) {
        throw new Error("promotion receipt was not durably acknowledged");
      }
      return signed;
    },
  });
  WRITERS.add(writer);
  return writer;
}

export function captureStructuredMemoryPromotionReceiptWriter(value) {
  if (!WRITERS.has(value)) {
    throw new TypeError(
      "a branded structured memory promotion writer is required",
    );
  }
  const captured = Object.freeze({
    descriptor: value.descriptor,
    retainPromotion: capture(value, "retainPromotion"),
  });
  WRITERS.add(captured);
  return captured;
}
