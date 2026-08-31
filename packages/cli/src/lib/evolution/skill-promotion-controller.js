import crypto from "node:crypto";
import {
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_TARGET_SCOPES,
  SkillMutationAuthority,
  buildSkillMutationConsumeContext,
  digestSkillMutationReceiptEnvelope,
  verifySkillMutationConsumptionReceipt,
  verifySkillMutationRequest,
} from "./skill-mutation-authority.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const EMPTY_ACTIVE_DOMAIN = "chainlesschain.skill-active/empty/v1\0";

/** The CAS digest used by mutation authority when a Skill has no active release. */
export const EMPTY_SKILL_ACTIVE_DIGEST = `sha256:${crypto
  .createHash("sha256")
  .update(EMPTY_ACTIVE_DOMAIN, "utf8")
  .digest("hex")}`;

const TRANSITION_CAPABILITIES = new WeakMap();

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

function normalizeJsonData(value, label, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 20 || budget.nodes > 4096) {
    throw failure(
      "SKILL_PROMOTION_INVALID",
      `${label} exceeds the JSON structure budget`,
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        `${label} numbers must be safe integers`,
      );
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 16_384) {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        `${label} string exceeds the size limit`,
      );
    }
    return value;
  }
  if (!value || typeof value !== "object") {
    throw failure(
      "SKILL_PROMOTION_INVALID",
      `${label} must be JSON-compatible data`,
    );
  }
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (
      value.length > 4096 ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
      ) ||
      value.length !== ownKeys.length - 1
    ) {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        `${label} must be a dense bounded array`,
      );
    }
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw failure(
          "SKILL_PROMOTION_INVALID",
          `${label}[${index}] must be an own data field`,
        );
      }
      output.push(
        normalizeJsonData(
          descriptor.value,
          `${label}[${index}]`,
          depth + 1,
          budget,
        ),
      );
    }
    return Object.freeze(output);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw failure("SKILL_PROMOTION_INVALID", `${label} must use plain objects`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > 2048 ||
    keys.some((key) => typeof key !== "string" || key.length > 256)
  ) {
    throw failure(
      "SKILL_PROMOTION_INVALID",
      `${label} object keys are invalid`,
    );
  }
  const output = Object.create(null);
  for (const key of keys.sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(
        "SKILL_PROMOTION_INVALID",
        `${label}.${key} must be an enumerable own data field`,
      );
    }
    Object.defineProperty(output, key, {
      value: normalizeJsonData(
        descriptor.value,
        `${label}.${key}`,
        depth + 1,
        budget,
      ),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function assertDataRecord(value, allowed, label, { required = allowed } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

function validateAuthorizationInput(value) {
  assertDataRecord(value, new Set(["capability", "request"]), "authorization");
  const request = verifySkillMutationRequest(value.request);
  if (request.targetScope !== SKILL_MUTATION_TARGET_SCOPES.ACTIVE) {
    throw failure(
      "SKILL_PROMOTION_SCOPE_REJECTED",
      "promotion and rollback require an active-scope authorization",
    );
  }
  receiptDigests(request);
  return { capability: value.capability, request };
}

function issueRegistryTransitionCapability(registry, payload) {
  const capability = Object.freeze(Object.create(null));
  TRANSITION_CAPABILITIES.set(capability, {
    registry,
    payload: deepFreeze(payload),
    status: "issued",
  });
  return capability;
}

/**
 * Registry-only broker. It is exported solely to break the module boundary;
 * callers cannot manufacture a WeakMap-backed capability or replay one.
 */
export function consumeRegistryTransitionCapability(capability, registry) {
  const state =
    capability && typeof capability === "object"
      ? TRANSITION_CAPABILITIES.get(capability)
      : null;
  if (!state || state.registry !== registry) {
    throw failure(
      "SKILL_PROMOTION_TRANSITION_CAPABILITY_INVALID",
      "registry transition capability is forged or bound to another registry",
    );
  }
  if (state.status !== "issued") {
    throw failure(
      "SKILL_PROMOTION_TRANSITION_CAPABILITY_REPLAYED",
      "registry transition capability has already been consumed",
    );
  }
  state.status = "consumed";
  return state.payload;
}

export class SkillPromotionController {
  #registryIdentity;

  #readCandidate;

  #readState;

  #readRelease;

  #applyTransition;

  #consumeAuthority;

  constructor({ candidateRegistry, releaseRegistry, authority } = {}) {
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
      !(authority instanceof SkillMutationAuthority) ||
      typeof authority.consume !== "function"
    ) {
      throw failure(
        "SKILL_PROMOTION_AUTHORITY_REQUIRED",
        "SkillMutationAuthority.consume is required",
      );
    }

    this.#registryIdentity = releaseRegistry;
    this.#readCandidate = candidateRegistry.read.bind(candidateRegistry);
    this.#readState = releaseRegistry.readState.bind(releaseRegistry);
    this.#readRelease = releaseRegistry.readRelease.bind(releaseRegistry);
    this.#applyTransition =
      releaseRegistry.applyTransition.bind(releaseRegistry);
    this.#consumeAuthority = authority.consume.bind(authority);

    Object.freeze(candidateRegistry);
    Object.freeze(releaseRegistry);
    Object.freeze(authority);
    Object.freeze(this);
  }

  #currentContentDigest(state) {
    if (state.activeReleaseDigest === null) return EMPTY_SKILL_ACTIVE_DIGEST;
    const active = this.#readRelease(state.activeReleaseDigest);
    return active.contentDigest;
  }

  #assertRequestCas(request, state, currentContentDigest) {
    if (
      request.skillName !== state.skillName ||
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

  async promote(input = {}) {
    assertDataRecord(
      input,
      new Set(["authorization", "candidateId", "dependencyLock"]),
      "promotion input",
    );
    const { candidateId, dependencyLock, authorization } = input;
    assertDigest(candidateId, "candidateId");
    const normalizedDependencyLock = normalizeJsonData(
      dependencyLock,
      "dependencyLock",
    );
    const { capability, request } = validateAuthorizationInput(authorization);
    const candidate = this.#readCandidate(candidateId);
    if (
      candidate.candidateId !== candidateId ||
      candidate.skillName !== request.skillName
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

    const consumptionReceipt = await this.#consume(capability, request);
    const transitionCapability = issueRegistryTransitionCapability(
      this.#registryIdentity,
      {
        authorityReceipt: consumptionReceipt,
        candidate,
        dependencyLock: normalizedDependencyLock,
        expectedParentDigest: currentContentDigest,
        expectedRevision: state.revision,
        mutationRequest: request,
        operation: "promote",
        operationId: request.operationId,
        receiptDigests: receiptDigests(request),
        requestDigest: request.requestDigest,
        skillName: request.skillName,
        targetReleaseDigest: null,
      },
    );
    return this.#applyTransition(transitionCapability);
  }

  async rollback(input = {}) {
    assertDataRecord(
      input,
      new Set(["authorization", "targetReleaseDigest"]),
      "rollback input",
      { required: new Set(["authorization"]) },
    );
    const { authorization, targetReleaseDigest = null } = input;
    const { capability, request } = validateAuthorizationInput(authorization);
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
    if (target.skillName !== request.skillName) {
      throw failure(
        "SKILL_PROMOTION_ROLLBACK_REJECTED",
        "rollback target belongs to another Skill",
      );
    }

    const consumptionReceipt = await this.#consume(capability, request);
    const transitionCapability = issueRegistryTransitionCapability(
      this.#registryIdentity,
      {
        authorityReceipt: consumptionReceipt,
        candidate: null,
        dependencyLock: null,
        expectedParentDigest: currentContentDigest,
        expectedRevision: state.revision,
        mutationRequest: request,
        operation: "rollback",
        operationId: request.operationId,
        receiptDigests: receiptDigests(request),
        requestDigest: request.requestDigest,
        skillName: request.skillName,
        targetReleaseDigest: selected,
      },
    );
    return this.#applyTransition(transitionCapability);
  }
}

Object.freeze(SkillPromotionController.prototype);
