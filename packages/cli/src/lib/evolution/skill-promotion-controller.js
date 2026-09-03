import crypto from "node:crypto";
import { types as utilTypes } from "node:util";
import {
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_TARGET_SCOPES,
  SkillMutationAuthority,
  buildSkillMutationConsumeContext,
  digestSkillMutationReceiptEnvelope,
  digestSkillMutationTransitionSubject,
  verifySkillMutationConsumptionReceipt,
  verifySkillMutationRequest,
} from "./skill-mutation-authority.js";
import { captureSkillEvaluatedPromotionProvider } from "./skill-evaluated-promotion.js";
import { captureStructuredMemoryPromotionReceiptWriter } from "./structured-memory-promotion-receipt-writer.js";
import {
  consumeRegistryTransitionCapability,
  issueRegistryTransitionCapability,
} from "./skill-registry-transition-capability.js";
import { captureSkillPromotionReviewProvider } from "./skill-promotion-review.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const EMPTY_ACTIVE_DOMAIN = "chainlesschain.skill-active/empty/v1\0";

/** The CAS digest used by mutation authority when a Skill has no active release. */
export const EMPTY_SKILL_ACTIVE_DIGEST = `sha256:${crypto
  .createHash("sha256")
  .update(EMPTY_ACTIVE_DOMAIN, "utf8")
  .digest("hex")}`;

const EVALUATED_CONTROL_PLANE_OPTION_KEYS = new Set([
  "candidateRegistry",
  "releaseRegistry",
  "authority",
  "evaluatedPromotionProvider",
  "memoryPromotionReceiptWriter",
  "promotionReviewProvider",
]);
const EVALUATED_CONTROL_PLANE_REQUIRED_KEYS = new Set([
  "candidateRegistry",
  "releaseRegistry",
  "authority",
  "evaluatedPromotionProvider",
]);

export const SKILL_EVALUATED_PROMOTION_CONTROL_PLANE_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-control-plane/v1";
const EVALUATED_PROMOTION_CONTROL_PLANES = new WeakSet();

export class SkillPromotionControllerError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillPromotionControllerError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function failure(code, message, details = {}) {
  return new SkillPromotionControllerError(code, message, details);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        "trusted transition data must contain only own data fields",
      );
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function assertDataRecord(value, allowed, label, { required = allowed } = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    throw failure("SKILL_PROMOTION_INVALID", `${label} must be an object`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    [...required].some((key) => !Object.hasOwn(value, key))
  ) {
    throw failure(
      "SKILL_PROMOTION_INVALID",
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        `${label}.${String(key)} must be an own data field`,
      );
    }
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw failure(
      "SKILL_PROMOTION_INVALID",
      `${label} must be a lowercase sha256 digest`,
    );
  }
  return value;
}

function receiptDigests(request) {
  return deepFreeze(
    Object.fromEntries(
      SKILL_MUTATION_RECEIPT_KINDS.map((kind) => {
        const envelope = request.receipts[`${kind}Receipt`];
        if (typeof envelope !== "string") {
          throw failure(
            "SKILL_PROMOTION_RECEIPTS_INVALID",
            `active mutation requires the ${kind} receipt envelope`,
          );
        }
        return [kind, digestSkillMutationReceiptEnvelope(envelope)];
      }),
    ),
  );
}

function consumeContextFor(request) {
  return buildSkillMutationConsumeContext({
    tenantId: request.tenantId,
    audience: request.audience,
    operationId: request.operationId,
    operation: request.operation,
    transitionSubjectDigest: request.transitionSubjectDigest,
    skillName: request.skillName,
    targetScope: request.targetScope,
    expectedTargetDigest: request.expectedTargetDigest,
    expectedTargetRevision: request.expectedTargetRevision,
    expiresAt: request.expiresAt,
    nonce: request.nonce,
  });
}

function verifyDirectConsumptionReceipt(value, request) {
  let receipt;
  try {
    receipt = verifySkillMutationConsumptionReceipt(value);
  } catch (cause) {
    throw failure(
      "SKILL_PROMOTION_AUTHORITY_REJECTED",
      "authority returned an invalid direct consumption receipt",
      { cause },
    );
  }
  for (const field of [
    "tenantId",
    "audience",
    "operationId",
    "operation",
    "transitionSubjectDigest",
    "skillName",
    "targetScope",
    "expectedTargetDigest",
    "expectedTargetRevision",
    "expiresAt",
    "nonce",
    "requestDigest",
  ]) {
    if (receipt[field] !== request[field]) {
      throw failure(
        "SKILL_PROMOTION_AUTHORITY_REJECTED",
        `authority consumption receipt is not bound to request ${field}`,
      );
    }
  }
  if (receipt.role !== SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER) {
    throw failure(
      "SKILL_PROMOTION_AUTHORITY_REJECTED",
      "active mutation was not consumed by the promotion-controller principal",
    );
  }
  return receipt;
}

function validateAuthorizationInput(value, expectedOperation) {
  assertDataRecord(value, new Set(["capability", "request"]), "authorization");
  const request = verifySkillMutationRequest(value.request);
  if (request.targetScope !== SKILL_MUTATION_TARGET_SCOPES.ACTIVE) {
    throw failure(
      "SKILL_PROMOTION_SCOPE_REJECTED",
      "promotion and rollback require an active-scope authorization",
    );
  }
  if (request.operation !== expectedOperation) {
    throw failure(
      "SKILL_PROMOTION_OPERATION_REJECTED",
      `authorization operation ${request.operation} cannot perform ${expectedOperation}`,
    );
  }
  receiptDigests(request);
  return { capability: value.capability, request };
}

function assertTransitionSubject(request, expectedDigest) {
  if (request.transitionSubjectDigest !== expectedDigest) {
    throw failure(
      "SKILL_PROMOTION_SUBJECT_MISMATCH",
      "authorization transition subject does not match the exact operation target, dependency lock, and active CAS",
      {
        actualTransitionSubjectDigest: request.transitionSubjectDigest,
        expectedTransitionSubjectDigest: expectedDigest,
      },
    );
  }
}

export { consumeRegistryTransitionCapability };

export class SkillPromotionController {
  #tenantId;

  #registryIdentity;

  #readCandidate;

  #readState;

  #readRelease;

  #applyTransition;

  #consumeAuthority;

  #evaluatedPromotionProvider;

  #requireEvaluatedPromotion;

  #memoryPromotionReceiptWriter;

  #promotionReviewProvider;

  #requireHumanReview;

  constructor({
    candidateRegistry,
    releaseRegistry,
    authority,
    evaluatedPromotionProvider = null,
    requireEvaluatedPromotion = false,
    memoryPromotionReceiptWriter = null,
    promotionReviewProvider = null,
    requireHumanReview = false,
  } = {}) {
    if (!candidateRegistry || typeof candidateRegistry.read !== "function") {
      throw failure(
        "SKILL_PROMOTION_CANDIDATE_REGISTRY_REQUIRED",
        "trusted candidate registry is required",
      );
    }
    if (
      !releaseRegistry ||
      typeof releaseRegistry.readState !== "function" ||
      typeof releaseRegistry.readRelease !== "function" ||
      typeof releaseRegistry.applyTransition !== "function"
    ) {
      throw failure(
        "SKILL_PROMOTION_RELEASE_REGISTRY_REQUIRED",
        "trusted release registry facade is required",
      );
    }
    if (
      typeof candidateRegistry.tenantId !== "string" ||
      typeof releaseRegistry.tenantId !== "string" ||
      candidateRegistry.tenantId !== releaseRegistry.tenantId
    ) {
      throw failure(
        "SKILL_PROMOTION_TENANT_MISMATCH",
        "candidate and release registries must capture the same tenant",
      );
    }
    if (
      !(authority instanceof SkillMutationAuthority) ||
      typeof authority.consume !== "function"
    ) {
      throw failure(
        "SKILL_PROMOTION_AUTHORITY_REQUIRED",
        "SkillMutationAuthority.consume is required",
      );
    }
    if (typeof requireEvaluatedPromotion !== "boolean") {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        "requireEvaluatedPromotion must be boolean",
      );
    }
    if (requireEvaluatedPromotion && evaluatedPromotionProvider === null) {
      throw failure(
        "SKILL_PROMOTION_EVALUATION_REQUIRED",
        "evaluated-only promotion requires a captured evidence provider",
      );
    }
    if (typeof requireHumanReview !== "boolean") {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        "requireHumanReview must be boolean",
      );
    }
    if (requireHumanReview && promotionReviewProvider === null) {
      throw failure(
        "SKILL_PROMOTION_REVIEW_REQUIRED",
        "human-reviewed promotion requires a captured review provider",
      );
    }

    this.#tenantId = candidateRegistry.tenantId;
    this.#registryIdentity = releaseRegistry;
    this.#readCandidate = candidateRegistry.read.bind(candidateRegistry);
    this.#readState = releaseRegistry.readState.bind(releaseRegistry);
    this.#readRelease = releaseRegistry.readRelease.bind(releaseRegistry);
    this.#applyTransition =
      releaseRegistry.applyTransition.bind(releaseRegistry);
    this.#consumeAuthority = authority.consume.bind(authority);
    this.#evaluatedPromotionProvider =
      evaluatedPromotionProvider === null
        ? null
        : captureSkillEvaluatedPromotionProvider(evaluatedPromotionProvider);
    this.#requireEvaluatedPromotion = requireEvaluatedPromotion;
    this.#memoryPromotionReceiptWriter =
      memoryPromotionReceiptWriter === null
        ? null
        : captureStructuredMemoryPromotionReceiptWriter(
            memoryPromotionReceiptWriter,
          );
    this.#promotionReviewProvider =
      promotionReviewProvider === null
        ? null
        : captureSkillPromotionReviewProvider(promotionReviewProvider);
    this.#requireHumanReview = requireHumanReview;

    Object.freeze(candidateRegistry);
    Object.freeze(releaseRegistry);
    Object.freeze(authority);
    Object.freeze(this);
  }

  #currentContentDigest(state) {
    if (state.activeReleaseDigest === null) return EMPTY_SKILL_ACTIVE_DIGEST;
    const active = this.#readRelease(state.activeReleaseDigest);
    if (active.tenantId !== this.#tenantId) {
      throw failure(
        "SKILL_PROMOTION_TENANT_MISMATCH",
        "active release belongs to another tenant",
      );
    }
    return active.contentDigest;
  }

  #assertRequestCas(request, state, currentContentDigest) {
    if (
      request.skillName !== state.skillName ||
      request.tenantId !== this.#tenantId ||
      state.tenantId !== this.#tenantId ||
      request.expectedTargetRevision !== state.revision ||
      request.expectedTargetDigest !== currentContentDigest
    ) {
      throw failure(
        "SKILL_PROMOTION_CAS_MISMATCH",
        "authorization request is stale for the active Skill state",
        {
          actualRevision: state.revision,
          actualTargetDigest: currentContentDigest,
        },
      );
    }
  }

  async #consume(capability, request) {
    let directReceipt;
    try {
      directReceipt = await this.#consumeAuthority(
        capability,
        consumeContextFor(request),
      );
    } catch (cause) {
      throw failure(
        "SKILL_PROMOTION_AUTHORITY_REJECTED",
        "SkillMutationAuthority rejected capability consumption",
        { cause },
      );
    }
    return verifyDirectConsumptionReceipt(directReceipt, request);
  }

  async #promote(input = {}) {
    assertDataRecord(
      input,
      new Set(["authorization", "candidateId"]),
      "promotion input",
    );
    const { candidateId, authorization } = input;
    assertDigest(candidateId, "candidateId");
    const { capability, request } = validateAuthorizationInput(
      authorization,
      SKILL_MUTATION_OPERATIONS.PROMOTE,
    );
    const candidate = this.#readCandidate(candidateId);
    if (
      candidate.candidateId !== candidateId ||
      candidate.skillName !== request.skillName ||
      candidate.tenantId !== this.#tenantId ||
      request.tenantId !== this.#tenantId
    ) {
      throw failure(
        "SKILL_PROMOTION_CANDIDATE_MISMATCH",
        "candidate is not bound to the authorized Skill",
      );
    }
    const state = this.#readState(candidate.skillName);
    const currentContentDigest = this.#currentContentDigest(state);
    this.#assertRequestCas(request, state, currentContentDigest);
    const expectedCandidateParent =
      state.activeReleaseDigest === null ? null : currentContentDigest;
    if (candidate.parentDigest !== expectedCandidateParent) {
      throw failure(
        "SKILL_PROMOTION_PARENT_MISMATCH",
        "candidate parent is not the active content digest",
      );
    }
    const dependencyLockDigest = candidate.dependencyLockDigest;
    assertTransitionSubject(
      request,
      digestSkillMutationTransitionSubject({
        tenantId: request.tenantId,
        skillName: request.skillName,
        operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
        candidateId: candidate.candidateId,
        rollbackTargetReleaseDigest: null,
        dependencyLockDigest,
        expectedActiveContentDigest: currentContentDigest,
        expectedActiveRevision: state.revision,
      }),
    );

    const consumptionReceipt = await this.#consume(capability, request);
    const transitionCapability = issueRegistryTransitionCapability(
      this.#registryIdentity,
      {
        authorityReceipt: consumptionReceipt,
        candidate,
        dependencyLockDigest,
        expectedParentDigest: currentContentDigest,
        expectedRevision: state.revision,
        mutationRequest: request,
        operation: "promote",
        operationId: request.operationId,
        receiptDigests: receiptDigests(request),
        requestDigest: request.requestDigest,
        transitionSubjectDigest: request.transitionSubjectDigest,
        skillName: request.skillName,
        targetReleaseDigest: null,
        tenantId: this.#tenantId,
      },
    );
    return this.#applyTransition(transitionCapability);
  }

  async promote(input = {}) {
    if (this.#requireEvaluatedPromotion) {
      throw failure(
        "SKILL_PROMOTION_EVALUATION_REQUIRED",
        "direct promotion is disabled by the evaluated-only controller policy",
      );
    }
    const result = await this.#promote(input);
    if (this.#memoryPromotionReceiptWriter === null) return result;
    const memoryAuthorityReceipt =
      await this.#memoryPromotionReceiptWriter.retainPromotion(result);
    return deepFreeze({ ...result, memoryAuthorityReceipt });
  }

  async promoteEvaluated(input = {}) {
    assertDataRecord(
      input,
      new Set(["authorization", "candidateId", "matrixContext"]),
      "evaluated promotion input",
    );
    if (this.#evaluatedPromotionProvider === null) {
      throw failure(
        "SKILL_PROMOTION_EVALUATION_REQUIRED",
        "evaluated promotion requires a captured evidence provider",
      );
    }
    const candidate = this.#readCandidate(input.candidateId);
    const state = this.#readState(candidate.skillName);
    const activeContentDigest = this.#currentContentDigest(state);
    const matrixBinding = await this.#evaluatedPromotionProvider.verify({
      matrixContext: input.matrixContext,
      authorization: input.authorization,
      candidate,
      state,
      activeContentDigest,
    });
    let reviewBinding = null;
    if (this.#requireHumanReview) {
      const activeRelease =
        state.activeReleaseDigest === null
          ? null
          : this.#readRelease(state.activeReleaseDigest);
      reviewBinding = await this.#promotionReviewProvider.verify({
        activeRelease,
        authorization: input.authorization,
        candidate,
        matrixBinding,
        state,
      });
    }
    const result = await this.#promote({
      authorization: input.authorization,
      candidateId: input.candidateId,
    });
    if (this.#memoryPromotionReceiptWriter === null) {
      return deepFreeze({ ...result, matrixBinding, reviewBinding });
    }
    const memoryAuthorityReceipt =
      await this.#memoryPromotionReceiptWriter.retainPromotion(
        result,
        matrixBinding,
        reviewBinding,
      );
    return deepFreeze({
      ...result,
      matrixBinding,
      reviewBinding,
      memoryAuthorityReceipt,
    });
  }

  async rollback(input = {}) {
    assertDataRecord(
      input,
      new Set(["authorization", "targetReleaseDigest"]),
      "rollback input",
      { required: new Set(["authorization"]) },
    );
    const { authorization, targetReleaseDigest = null } = input;
    const { capability, request } = validateAuthorizationInput(
      authorization,
      SKILL_MUTATION_OPERATIONS.ROLLBACK,
    );
    const state = this.#readState(request.skillName);
    const currentContentDigest = this.#currentContentDigest(state);
    this.#assertRequestCas(request, state, currentContentDigest);
    if (state.activeReleaseDigest === null) {
      throw failure(
        "SKILL_PROMOTION_ROLLBACK_REJECTED",
        "a Skill without an active release cannot be rolled back",
      );
    }
    const selected = targetReleaseDigest ?? state.lastKnownGoodReleaseDigest;
    assertDigest(selected, "targetReleaseDigest");
    if (selected !== state.lastKnownGoodReleaseDigest) {
      throw failure(
        "SKILL_PROMOTION_ROLLBACK_REJECTED",
        "rollback target must be the last-known-good release",
      );
    }
    const target = this.#readRelease(selected);
    if (
      request.tenantId !== this.#tenantId ||
      target.tenantId !== this.#tenantId ||
      target.skillName !== request.skillName
    ) {
      throw failure(
        "SKILL_PROMOTION_ROLLBACK_REJECTED",
        "rollback target belongs to another Skill",
      );
    }
    assertTransitionSubject(
      request,
      digestSkillMutationTransitionSubject({
        tenantId: request.tenantId,
        skillName: request.skillName,
        operation: SKILL_MUTATION_OPERATIONS.ROLLBACK,
        candidateId: null,
        rollbackTargetReleaseDigest: target.releaseDigest,
        dependencyLockDigest: target.dependencyLockDigest,
        expectedActiveContentDigest: currentContentDigest,
        expectedActiveRevision: state.revision,
      }),
    );

    const consumptionReceipt = await this.#consume(capability, request);
    const transitionCapability = issueRegistryTransitionCapability(
      this.#registryIdentity,
      {
        authorityReceipt: consumptionReceipt,
        candidate: null,
        dependencyLockDigest: target.dependencyLockDigest,
        expectedParentDigest: currentContentDigest,
        expectedRevision: state.revision,
        mutationRequest: request,
        operation: "rollback",
        operationId: request.operationId,
        receiptDigests: receiptDigests(request),
        requestDigest: request.requestDigest,
        transitionSubjectDigest: request.transitionSubjectDigest,
        skillName: request.skillName,
        targetReleaseDigest: selected,
        tenantId: this.#tenantId,
      },
    );
    return this.#applyTransition(transitionCapability);
  }
}

/**
 * Builds the narrow promotion surface intended for production adapters.
 *
 * This is a composition primitive, not proof that any production entry point
 * uses it. The returned facade deliberately withholds both the controller and
 * direct promote(), while retaining authorized rollback as the recovery path.
 */
export function createSkillEvaluatedPromotionControlPlane(options = {}) {
  assertDataRecord(
    options,
    EVALUATED_CONTROL_PLANE_OPTION_KEYS,
    "evaluated promotion control plane options",
    { required: EVALUATED_CONTROL_PLANE_REQUIRED_KEYS },
  );
  const provider = captureSkillEvaluatedPromotionProvider(
    options.evaluatedPromotionProvider,
  );
  const reviewProvider = captureSkillPromotionReviewProvider(
    options.promotionReviewProvider,
  );
  const controller = new SkillPromotionController({
    candidateRegistry: options.candidateRegistry,
    releaseRegistry: options.releaseRegistry,
    authority: options.authority,
    evaluatedPromotionProvider: options.evaluatedPromotionProvider,
    memoryPromotionReceiptWriter: options.memoryPromotionReceiptWriter ?? null,
    promotionReviewProvider: options.promotionReviewProvider,
    requireEvaluatedPromotion: true,
    requireHumanReview: true,
  });
  const controlPlane = {
    schema: SKILL_EVALUATED_PROMOTION_CONTROL_PLANE_SCHEMA,
    tenantId: options.candidateRegistry.tenantId,
    providerAuthorityId: provider.authorityId,
    providerRevision: provider.revision,
    providerHandlerArtifactDigest: provider.handlerArtifactDigest,
    reviewAuthorityId: reviewProvider.authorityId,
    reviewRevision: reviewProvider.revision,
    reviewHandlerArtifactDigest: reviewProvider.handlerArtifactDigest,
    promoteEvaluated: Object.freeze((input) =>
      controller.promoteEvaluated(input),
    ),
    rollback: Object.freeze((input) => controller.rollback(input)),
  };
  EVALUATED_PROMOTION_CONTROL_PLANES.add(controlPlane);
  return Object.freeze(controlPlane);
}

export function captureSkillEvaluatedPromotionControlPlane(value) {
  if (!value || !EVALUATED_PROMOTION_CONTROL_PLANES.has(value)) {
    throw failure(
      "SKILL_PROMOTION_CONTROL_PLANE_REQUIRED",
      "a branded evaluated promotion control plane is required",
    );
  }
  return Object.freeze({
    schema: value.schema,
    tenantId: value.tenantId,
    promoteEvaluated: value.promoteEvaluated.bind(value),
  });
}

Object.freeze(SkillPromotionController.prototype);
