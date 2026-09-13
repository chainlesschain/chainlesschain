import { types as utilTypes } from "node:util";

import {
  EvolutionEvalChildEvidenceLedgerAdapter,
  createEvolutionEvalChildEvidenceStorePort,
} from "./evolution-eval-child-evidence-ledger-adapter.js";
import {
  SkillTargetMatrixEvalAggregator,
  SkillTargetMatrixEvalReceiptVerifier,
} from "./skill-target-matrix-eval.js";
import { createSkillEvaluatedPromotionDurabilityAdapter } from "./skill-evaluated-promotion-durability.js";

export const EVOLUTION_EVAL_RUNTIME_COMPOSITION_SCHEMA =
  "chainlesschain.evolution-eval-runtime-composition/v1";
export const EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE_CODE =
  "CC_EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE";

const COMPOSITIONS = new WeakMap();
const DESCRIPTOR_KEYS = [
  "tenantId",
  "runId",
  "authorityId",
  "revision",
  "handlerArtifactDigest",
];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function unavailable(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE_CODE;
  return error;
}

function record(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw unavailable(`${label} must be a plain data record`);
  const ownKeys = Reflect.ownKeys(value);
  if (
    keys &&
    (ownKeys.length !== keys.length ||
      ownKeys.some((key) => !keys.includes(key)))
  )
    throw unavailable(`${label} must contain exactly the required ports`);
  for (const key of ownKeys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !property ||
      !("value" in property) ||
      !property.enumerable
    )
      throw unavailable(`${label}.${String(key)} must be an own data property`);
  }
  return value;
}

function descriptor(input) {
  record(input, DESCRIPTOR_KEYS, "Eval composition descriptor");
  for (const key of ["tenantId", "runId", "authorityId"])
    if (typeof input[key] !== "string" || !ID.test(input[key]))
      throw unavailable(`Eval composition ${key} is invalid`);
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    typeof input.handlerArtifactDigest !== "string" ||
    !DIGEST.test(input.handlerArtifactDigest)
  )
    throw unavailable("Eval composition authority revision/digest is invalid");
  return Object.freeze({ ...input });
}

/**
 * Host-authorized construction only: supplies no signing keys, policy defaults,
 * grader, corpus, reservation service, supervisor, or durability authority.
 * Receipt verification uses the exact authority pair captured by the aggregator.
 */
export function createEvolutionEvalRuntimeComposition(options) {
  try {
    record(
      options,
      [
        "descriptor",
        "aggregatorOptions",
        "verificationLimits",
        "durabilityOptions",
      ],
      "Eval composition options",
    );
    const binding = descriptor(options.descriptor);
    const matrix = {
      ...record(options.aggregatorOptions, null, "Eval aggregator options"),
    };
    const limits = record(
      options.verificationLimits,
      ["maximumReceiptTtlMs", "maximumVerificationMs"],
      "Eval verification limits",
    );
    if (matrix.tenantId !== binding.tenantId)
      throw unavailable("Eval aggregator belongs to another tenant");
    const aggregator = new SkillTargetMatrixEvalAggregator(matrix);
    const receiptVerifier = new SkillTargetMatrixEvalReceiptVerifier({
      matrixReceiptVerifier: matrix.matrixReceiptVerifier,
      matrixReceiptSignerDescriptor:
        matrix.matrixReceiptSigner.authorityDescriptor,
      matrixReceiptTrust: matrix.matrixReceiptTrust,
      matrixSupervisor: matrix.matrixSupervisor,
      supervisorPolicy: matrix.supervisorPolicy,
      clock: matrix.clock,
      clockPolicy: matrix.clockPolicy,
      ...limits,
    });
    const durability = createSkillEvaluatedPromotionDurabilityAdapter(
      options.durabilityOptions,
    );
    const composition = Object.freeze({
      schema: EVOLUTION_EVAL_RUNTIME_COMPOSITION_SCHEMA,
      descriptor: binding,
      // Downstream promotion can reuse the same read-only receipt authorities.
      receiptVerifier,
      receiptResolver: durability.resolver,
    });
    COMPOSITIONS.set(
      composition,
      Object.freeze({
        aggregator,
        receiptVerifier,
        durability,
        childReceiptStore: matrix.childReceiptStore,
      }),
    );
    return composition;
  } catch (cause) {
    if (cause?.code === EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE_CODE)
      throw cause;
    throw unavailable("Eval production authority construction failed", cause);
  }
}

export function captureEvolutionEvalRuntimeComposition(value, expected) {
  const ports = COMPOSITIONS.get(value);
  if (!ports)
    throw unavailable("a branded Eval runtime composition is required");
  if (expected) {
    for (const key of DESCRIPTOR_KEYS)
      if (value.descriptor[key] !== expected.descriptor[key])
        throw unavailable(`Eval composition differs from runtime ${key}`);
    if (ports.childReceiptStore !== expected.childReceiptStore)
      throw unavailable(
        "Eval composition must use the runtime child evidence store",
      );
  }
  return ports;
}

/** Root-owned authenticated storage; the host receives no ledger write port. */
export function createEvolutionEvalRuntimeChildEvidenceStore({
  descriptor: input,
  artifactPorts,
  ledger,
  ledgerArtifactResolver,
  audience,
  now,
}) {
  const binding = descriptor(input);
  const storeDescriptor = Object.freeze({
    tenantId: binding.tenantId,
    streamId: binding.runId,
    authorityId: binding.authorityId,
    revision: binding.revision,
    handlerArtifactDigest: binding.handlerArtifactDigest,
  });
  const adapter = new EvolutionEvalChildEvidenceLedgerAdapter({
    descriptor: {
      ...storeDescriptor,
      artifactTenantId: binding.tenantId,
      audience,
      purpose: "evolution-ledger",
    },
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    now,
  });
  return createEvolutionEvalChildEvidenceStorePort({
    descriptor: storeDescriptor,
    retain: adapter.retain.bind(adapter),
    resolve: adapter.resolve.bind(adapter),
  });
}

/** Called only by the Agent root after constructing its authenticated backend. */
export function createEvolutionEvalRuntimeStageConfiguration({
  configuration,
  tenantId,
  runId,
  ...storage
}) {
  try {
    record(
      configuration,
      [
        "descriptor",
        "createComposition",
        "planRef",
        "expectedReceipt",
        "usage",
      ],
      "releaseTrain.domain.eval",
    );
    record(
      configuration.descriptor,
      ["authorityId", "revision", "handlerArtifactDigest"],
      "releaseTrain.domain.eval.descriptor",
    );
    const binding = descriptor({
      ...configuration.descriptor,
      tenantId,
      runId,
    });
    const factory = configuration.createComposition;
    if (
      typeof factory !== "function" ||
      utilTypes.isProxy(factory) ||
      utilTypes.isAsyncFunction(factory) ||
      utilTypes.isGeneratorFunction(factory)
    )
      throw unavailable("Eval createComposition must be a synchronous factory");
    const childReceiptStore = createEvolutionEvalRuntimeChildEvidenceStore({
      descriptor: binding,
      ...storage,
    });
    const context = Object.freeze({ descriptor: binding, childReceiptStore });
    const composition = Reflect.apply(factory, undefined, [context]);
    const { aggregator, receiptVerifier, durability } =
      captureEvolutionEvalRuntimeComposition(composition, context);
    return Object.freeze({
      aggregator,
      receiptVerifier,
      durability,
      planRef: configuration.planRef,
      expectedReceipt: configuration.expectedReceipt,
      usage: configuration.usage,
    });
  } catch (cause) {
    if (cause?.code === EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE_CODE)
      throw cause;
    throw unavailable("Eval production composition is unavailable", cause);
  }
}
