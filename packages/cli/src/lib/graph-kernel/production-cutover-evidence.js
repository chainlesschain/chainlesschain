import { GRAPH_CUTOVER_REQUIRED_PLATFORMS } from "./cutover-contract.js";
import {
  canonicalGraphEvidenceJson as canonicalGraphJson,
  graphEvidenceDigest as graphDigest,
} from "./evidence-digest.js";
import {
  GRAPH_PRODUCTION_SOURCE_ENVIRONMENT,
  GRAPH_PRODUCTION_SOURCE_REF,
  GRAPH_PRODUCTION_SOURCE_WORKFLOW,
  normalizeGraphProductionSourceBundle,
} from "./production-source-evidence.js";
import {
  assertGraphProductionRuntimeSurfaceManifest,
  graphRuntimeEntryManifestDigest,
  graphRuntimeSurfaceManifestDigest,
  loadGraphRuntimeSurfaceManifest,
} from "./runtime-surface-manifest.js";
import {
  normalizeGraphLegacyWriterObservation,
  normalizeGraphRetirementContract,
  normalizeGraphRetirementEvidence,
} from "./retirement-evidence.js";

export const GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA =
  "chainlesschain.graph-production-cutover-evidence/v1";
export const GRAPH_ENTRY_WRITER_OBSERVATION_SCHEMA =
  "chainlesschain.graph-entry-writer-observation/v1";
export const GRAPH_PRODUCTION_CUTOVER_RECEIPT_SCHEMA =
  "chainlesschain.graph-production-cutover-receipt/v1";
export const GRAPH_PRODUCTION_EVIDENCE_WORKFLOW =
  GRAPH_PRODUCTION_SOURCE_WORKFLOW;
export const GRAPH_PRODUCTION_EVIDENCE_ENVIRONMENT =
  GRAPH_PRODUCTION_SOURCE_ENVIRONMENT;
export const GRAPH_PRODUCTION_EVIDENCE_REF = GRAPH_PRODUCTION_SOURCE_REF;
export const GRAPH_MINIMUM_SHADOW_OBSERVATION_MS = 30 * 60 * 1_000;
export const GRAPH_MINIMUM_CANARY_OBSERVATION_MS = 60 * 60 * 1_000;
export const GRAPH_MINIMUM_RETIREMENT_OBSERVATION_MS = 60 * 60 * 1_000;
export const GRAPH_MINIMUM_LEGACY_WRITER_OBSERVATION_MS = 60 * 60 * 1_000;
export const GRAPH_PRODUCTION_SOURCE_KINDS = Object.freeze([
  "physical_self_hosted_runner",
  "authenticated_production_endpoint",
]);

export const GRAPH_REQUIRED_CUTOVER_STAGES = Object.freeze([
  "shadow",
  "internal_canary",
  "opt_in_canary",
  "canonical_default",
  "legacy_read_only",
]);
export const GRAPH_REQUIRED_SHADOW_DIMENSIONS = Object.freeze([
  "definition_revision",
  "run_terminal_root",
  "node_attempt_terminal",
  "assignment_executor",
  "message_handoff_custody",
  "effect_receipt_reconciliation",
  "artifact_provenance",
  "budget_delta",
  "workspace_commit_test_receipt",
]);
export const GRAPH_REQUIRED_ROLLBACK_DRILLS = Object.freeze([
  "shadow_to_legacy",
  "canary_to_shadow",
  "canonical_to_canary",
]);

const COMMIT = /^[a-f0-9]{40,64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ERROR_CODE = /^CC_[A-Z0-9_]{2,120}$/u;

function evidenceError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphProductionCutoverEvidenceError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function text(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 1024) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `${field} must be a non-empty string no larger than 1 KiB`,
      { field },
    );
  }
  return normalized;
}

function digest(value, field) {
  const normalized = String(value || "");
  if (!DIGEST.test(normalized)) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `${field} must be a sha256 digest`,
      { field },
    );
  }
  return normalized;
}

function commit(value, field = "commitSha") {
  const normalized = String(value || "").toLowerCase();
  if (!COMMIT.test(normalized)) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `${field} must be an exact commit SHA`,
      { field },
    );
  }
  return normalized;
}

function positive(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `${field} must be a positive safe integer`,
      { field, value },
    );
  }
  return normalized;
}

function nonNegative(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `${field} must be a non-negative safe integer`,
      { field, value },
    );
  }
  return normalized;
}

function atLeast(value, minimum, field) {
  const normalized = nonNegative(value, field);
  if (normalized < minimum) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `${field} must be at least ${minimum}`,
      { field, value, minimum },
    );
  }
  return normalized;
}

function zero(value, field) {
  const normalized = nonNegative(value, field);
  if (normalized !== 0) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_GATE_FAILED",
      `${field} must be zero`,
      { field, value },
    );
  }
  return 0;
}

function timestamp(value, field) {
  const normalized = String(value || "");
  const milliseconds = Date.parse(normalized);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== normalized
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `${field} must be a canonical ISO timestamp`,
      { field },
    );
  }
  return { value: normalized, milliseconds };
}

function windowEvidence(
  input,
  field,
  { notBefore, minimumDurationMs = 1 } = {},
) {
  const started = timestamp(input?.startedAt, `${field}.startedAt`);
  const ended = timestamp(input?.endedAt, `${field}.endedAt`);
  if (ended.milliseconds <= started.milliseconds) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_OBSERVATION_INVALID",
      `${field} must end after it starts`,
    );
  }
  if (notBefore && started.milliseconds < Date.parse(notBefore)) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_OBSERVATION_INVALID",
      `${field} cannot start before canonical authority`,
      { notBefore, startedAt: started.value },
    );
  }
  const durationMs = ended.milliseconds - started.milliseconds;
  if (durationMs < minimumDurationMs || input?.durationMs !== durationMs) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_OBSERVATION_TOO_SHORT",
      `${field}.durationMs must equal its timestamp window and be at least ${minimumDurationMs}`,
      { field, durationMs, minimumDurationMs },
    );
  }
  return {
    startedAt: started.value,
    endedAt: ended.value,
    durationMs,
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function compareCanonicalText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactMembers(actual, expected, code, message, details = {}) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (
    new Set(normalizedActual).size !== normalizedActual.length ||
    !sameMembers(normalizedActual, normalizedExpected)
  ) {
    throw evidenceError(code, message, {
      ...details,
      expected: normalizedExpected,
      actual: normalizedActual,
    });
  }
}

function normalizeObservationSources(input, expectedDigestsByPlatform, field) {
  const sources = Array.isArray(input)
    ? input.map((entry, index) => {
        const sourceKind = text(
          entry?.sourceKind,
          `${field}[${index}].sourceKind`,
        );
        const platform = String(entry?.platform || "").toLowerCase();
        if (
          !GRAPH_PRODUCTION_SOURCE_KINDS.includes(sourceKind) ||
          !GRAPH_CUTOVER_REQUIRED_PLATFORMS.includes(platform)
        ) {
          throw evidenceError(
            "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
            `${field}[${index}] must identify a physical self-hosted runner or authenticated production endpoint on a required platform`,
            { field, sourceKind, platform },
          );
        }
        const observationDigests = Array.isArray(entry?.observationDigests)
          ? entry.observationDigests.map((value, digestIndex) =>
              digest(
                value,
                `${field}[${index}].observationDigests[${digestIndex}]`,
              ),
            )
          : [];
        exactMembers(
          observationDigests,
          expectedDigestsByPlatform.get(platform) || [],
          "CC_GRAPH_PRODUCTION_SOURCE_BINDING_INCOMPLETE",
          "each production source must bind every required observation digest for its platform",
          { field, platform },
        );
        return {
          platform,
          sourceKind,
          sourceId: text(entry?.sourceId, `${field}[${index}].sourceId`),
          identityDigest: digest(
            entry?.identityDigest,
            `${field}[${index}].identityDigest`,
          ),
          keyId: digest(entry?.keyId, `${field}[${index}].keyId`),
          registryDigest: digest(
            entry?.registryDigest,
            `${field}[${index}].registryDigest`,
          ),
          runnerRegistrationId: positive(
            entry?.runnerRegistrationId,
            `${field}[${index}].runnerRegistrationId`,
          ),
          runnerName: text(entry?.runnerName, `${field}[${index}].runnerName`),
          runnerLabels: Array.isArray(entry?.runnerLabels)
            ? [...entry.runnerLabels]
                .map((label, labelIndex) =>
                  text(label, `${field}[${index}].runnerLabels[${labelIndex}]`),
                )
                .sort()
            : [],
          challenge: text(entry?.challenge, `${field}[${index}].challenge`),
          nonce: text(entry?.nonce, `${field}[${index}].nonce`),
          rawLogRoot: digest(
            entry?.rawLogRoot,
            `${field}[${index}].rawLogRoot`,
          ),
          receiptDigest: digest(
            entry?.receiptDigest,
            `${field}[${index}].receiptDigest`,
          ),
          authenticationDigest: digest(
            entry?.authenticationDigest,
            `${field}[${index}].authenticationDigest`,
          ),
          observationDigests: [...observationDigests].sort(),
        };
      })
    : [];
  sources.sort((left, right) =>
    compareCanonicalText(left.platform, right.platform),
  );
  exactMembers(
    sources.map((entry) => entry.platform),
    GRAPH_CUTOVER_REQUIRED_PLATFORMS,
    "CC_GRAPH_PRODUCTION_SOURCE_COVERAGE_INCOMPLETE",
    "production observations must cover Linux, macOS, and Windows sources",
    { field },
  );
  if (
    new Set(sources.map((entry) => entry.identityDigest)).size !==
      sources.length ||
    new Set(sources.map((entry) => entry.sourceId)).size !== sources.length ||
    new Set(sources.map((entry) => entry.runnerRegistrationId)).size !==
      sources.length ||
    new Set(sources.map((entry) => entry.keyId)).size !== sources.length
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_HOST_IDENTITY_REUSED",
      "Linux, macOS, and Windows production observations must come from distinct source identities",
      { field },
    );
  }
  return sources;
}

function verifyDigest(input, normalized, domain, field = "evidenceDigest") {
  const supplied = digest(input?.[field], field);
  const unsigned = clone(normalized);
  delete unsigned[field];
  const expected = graphDigest(unsigned, domain);
  if (supplied !== expected) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_DIGEST_MISMATCH",
      `${field} does not match the normalized evidence`,
      { expectedEvidenceDigest: expected, actualEvidenceDigest: supplied },
    );
  }
  return supplied;
}

function entryIdentity(input, expected, commitSha) {
  const identity = {
    surface: text(input?.surface, "surface"),
    entryId: text(input?.entryId, "entryId"),
    rolloutKey: text(input?.rolloutKey, "rolloutKey"),
    cutoverStrategy: text(input?.cutoverStrategy, "cutoverStrategy"),
    manifestDigest: digest(input?.manifestDigest, "manifestDigest"),
    commitSha: commit(input?.commitSha),
  };
  const expectedManifestDigest = graphRuntimeEntryManifestDigest(
    expected.manifest,
    expected.surface.originSurface,
    expected.entry.id,
  );
  if (
    identity.surface !== expected.surface.originSurface ||
    identity.entryId !== expected.entry.id ||
    identity.rolloutKey !== expected.entry.rolloutKey ||
    identity.cutoverStrategy !== expected.entry.cutoverStrategy ||
    identity.manifestDigest !== expectedManifestDigest ||
    identity.commitSha !== commitSha
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_ENTRY_BINDING_MISMATCH",
      "entry evidence does not match the manifest or exact commit",
      {
        surface: expected.surface.originSurface,
        entryId: expected.entry.id,
      },
    );
  }
  return identity;
}

function normalizeShadow(input) {
  const comparisons = Array.isArray(input?.comparisons)
    ? input.comparisons.map((entry, index) => {
        const dimension = text(
          entry?.dimension,
          `shadow.comparisons[${index}].dimension`,
        );
        if (entry?.status !== "equivalent") {
          throw evidenceError(
            "CC_GRAPH_PRODUCTION_SHADOW_DIVERGENCE",
            `${dimension} is not equivalent`,
          );
        }
        return {
          dimension,
          status: "equivalent",
          sampleCount: positive(
            entry?.sampleCount,
            `shadow.comparisons[${index}].sampleCount`,
          ),
          evidenceDigest: digest(
            entry?.evidenceDigest,
            `shadow.comparisons[${index}].evidenceDigest`,
          ),
        };
      })
    : [];
  comparisons.sort((left, right) =>
    compareCanonicalText(left.dimension, right.dimension),
  );
  exactMembers(
    comparisons.map((entry) => entry.dimension),
    GRAPH_REQUIRED_SHADOW_DIMENSIONS,
    "CC_GRAPH_PRODUCTION_SHADOW_COVERAGE_INCOMPLETE",
    "shadow evidence must cover every semantic projection dimension",
  );
  return {
    ...windowEvidence(input, "shadow", {
      minimumDurationMs: GRAPH_MINIMUM_SHADOW_OBSERVATION_MS,
    }),
    runCount: positive(input?.runCount, "shadow.runCount"),
    divergenceCount: zero(input?.divergenceCount, "shadow.divergenceCount"),
    unknownEffectCount: zero(
      input?.unknownEffectCount,
      "shadow.unknownEffectCount",
    ),
    realEffectInvocationCount: zero(
      input?.realEffectInvocationCount,
      "shadow.realEffectInvocationCount",
    ),
    comparisons,
    evidenceDigest: digest(input?.evidenceDigest, "shadow.evidenceDigest"),
  };
}

function normalizeCanary(input, commitSha) {
  const platformJourneys = Array.isArray(input?.platformJourneys)
    ? input.platformJourneys.map((entry, index) => {
        const platform = String(entry?.platform || "").toLowerCase();
        if (
          !GRAPH_CUTOVER_REQUIRED_PLATFORMS.includes(platform) ||
          commit(
            entry?.commitSha,
            `canary.platformJourneys[${index}].commitSha`,
          ) !== commitSha ||
          entry?.status !== "passed"
        ) {
          throw evidenceError(
            "CC_GRAPH_PRODUCTION_CANARY_PLATFORM_FAILED",
            "canary platform journey must pass on the exact commit",
            { platform },
          );
        }
        return {
          platform,
          commitSha,
          status: "passed",
          evidenceDigest: digest(
            entry?.evidenceDigest,
            `canary.platformJourneys[${index}].evidenceDigest`,
          ),
        };
      })
    : [];
  platformJourneys.sort((left, right) =>
    compareCanonicalText(left.platform, right.platform),
  );
  exactMembers(
    platformJourneys.map((entry) => entry.platform),
    GRAPH_CUTOVER_REQUIRED_PLATFORMS,
    "CC_GRAPH_PRODUCTION_CANARY_PLATFORM_INCOMPLETE",
    "canary evidence must cover every required platform",
  );
  return {
    ...windowEvidence(input, "canary", {
      minimumDurationMs: GRAPH_MINIMUM_CANARY_OBSERVATION_MS,
    }),
    internalRunCount: positive(
      input?.internalRunCount,
      "canary.internalRunCount",
    ),
    optInRunCount: positive(input?.optInRunCount, "canary.optInRunCount"),
    defaultRunCount: positive(input?.defaultRunCount, "canary.defaultRunCount"),
    failureCount: zero(input?.failureCount, "canary.failureCount"),
    reconciliationCount: zero(
      input?.reconciliationCount,
      "canary.reconciliationCount",
    ),
    platformJourneys,
    evidenceDigest: digest(input?.evidenceDigest, "canary.evidenceDigest"),
  };
}

function normalizeRollback(input) {
  const drills = Array.isArray(input?.drills)
    ? input.drills.map((entry, index) => {
        const transition = text(
          entry?.transition,
          `rollback.drills[${index}].transition`,
        );
        if (entry?.status !== "passed") {
          throw evidenceError(
            "CC_GRAPH_PRODUCTION_ROLLBACK_FAILED",
            `${transition} rollback drill did not pass`,
          );
        }
        if (
          transition !== "shadow_to_legacy" &&
          entry?.existingCanonicalRunsRetained !== true
        ) {
          throw evidenceError(
            "CC_GRAPH_PRODUCTION_ROLLBACK_UNSAFE",
            `${transition} must retain existing canonical run authority`,
          );
        }
        return {
          transition,
          status: "passed",
          activeDispatchCount: zero(
            entry?.activeDispatchCount,
            `rollback.drills[${index}].activeDispatchCount`,
          ),
          rpoLossCount: zero(
            entry?.rpoLossCount,
            `rollback.drills[${index}].rpoLossCount`,
          ),
          duplicateEffectCount: zero(
            entry?.duplicateEffectCount,
            `rollback.drills[${index}].duplicateEffectCount`,
          ),
          existingCanonicalRunsRetained:
            transition === "shadow_to_legacy"
              ? Boolean(entry?.existingCanonicalRunsRetained)
              : true,
          evidenceDigest: digest(
            entry?.evidenceDigest,
            `rollback.drills[${index}].evidenceDigest`,
          ),
        };
      })
    : [];
  drills.sort((left, right) =>
    compareCanonicalText(left.transition, right.transition),
  );
  exactMembers(
    drills.map((entry) => entry.transition),
    GRAPH_REQUIRED_ROLLBACK_DRILLS,
    "CC_GRAPH_PRODUCTION_ROLLBACK_COVERAGE_INCOMPLETE",
    "rollback evidence must cover every supported rollback boundary",
  );
  return {
    drills,
    evidenceDigest: digest(input?.evidenceDigest, "rollback.evidenceDigest"),
  };
}

function normalizeMutationProbes(value, mutationFunctions, field) {
  const probes = Array.isArray(value)
    ? value.map((entry, index) => {
        const mutationFunction = text(
          entry?.mutationFunction,
          `${field}[${index}].mutationFunction`,
        );
        const attemptCount = positive(
          entry?.attemptCount,
          `${field}[${index}].attemptCount`,
        );
        const blockedCount = positive(
          entry?.blockedCount,
          `${field}[${index}].blockedCount`,
        );
        if (
          blockedCount !== attemptCount ||
          !ERROR_CODE.test(entry?.errorCode)
        ) {
          throw evidenceError(
            "CC_GRAPH_PRODUCTION_LEGACY_MUTATION_ALLOWED",
            `${mutationFunction} was not consistently rejected with a stable error`,
          );
        }
        return {
          mutationFunction,
          attemptCount,
          blockedCount,
          successCount: zero(
            entry?.successCount,
            `${field}[${index}].successCount`,
          ),
          errorCode: entry.errorCode,
          evidenceDigest: digest(
            entry?.evidenceDigest,
            `${field}[${index}].evidenceDigest`,
          ),
        };
      })
    : [];
  probes.sort((left, right) =>
    compareCanonicalText(left.mutationFunction, right.mutationFunction),
  );
  exactMembers(
    probes.map((entry) => entry.mutationFunction),
    mutationFunctions,
    "CC_GRAPH_PRODUCTION_LEGACY_MUTATION_COVERAGE_INCOMPLETE",
    "legacy read-only evidence must probe every declared mutation",
  );
  return probes;
}

function normalizeMigratedWriterObservation(input, identity, entry, notBefore) {
  if (input?.schema !== GRAPH_ENTRY_WRITER_OBSERVATION_SCHEMA) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_WRITER_OBSERVATION_INVALID",
      `writer observation schema must be ${GRAPH_ENTRY_WRITER_OBSERVATION_SCHEMA}`,
    );
  }
  const observedIdentity = {
    schema: GRAPH_ENTRY_WRITER_OBSERVATION_SCHEMA,
    surface: text(input?.surface, "legacyReadOnly.surface"),
    entryId: text(input?.entryId, "legacyReadOnly.entryId"),
    rolloutKey: text(input?.rolloutKey, "legacyReadOnly.rolloutKey"),
    manifestDigest: digest(
      input?.manifestDigest,
      "legacyReadOnly.manifestDigest",
    ),
    commitSha: commit(input?.commitSha, "legacyReadOnly.commitSha"),
  };
  for (const field of [
    "surface",
    "entryId",
    "rolloutKey",
    "manifestDigest",
    "commitSha",
  ]) {
    if (observedIdentity[field] !== identity[field]) {
      throw evidenceError(
        "CC_GRAPH_PRODUCTION_ENTRY_BINDING_MISMATCH",
        `legacy writer observation ${field} does not match its entry`,
      );
    }
  }
  const writerObservations = Array.isArray(input?.writerObservations)
    ? input.writerObservations.map((observation, index) => ({
        writerFile: text(
          observation?.writerFile,
          `legacyReadOnly.writerObservations[${index}].writerFile`,
        ),
        observationSampleCount: positive(
          observation?.observationSampleCount,
          `legacyReadOnly.writerObservations[${index}].observationSampleCount`,
        ),
        mutationSuccessCount: zero(
          observation?.mutationSuccessCount,
          `legacyReadOnly.writerObservations[${index}].mutationSuccessCount`,
        ),
        evidenceDigest: digest(
          observation?.evidenceDigest,
          `legacyReadOnly.writerObservations[${index}].evidenceDigest`,
        ),
      }))
    : [];
  writerObservations.sort((left, right) =>
    compareCanonicalText(left.writerFile, right.writerFile),
  );
  exactMembers(
    writerObservations.map((observation) => observation.writerFile),
    entry.writerFiles,
    "CC_GRAPH_PRODUCTION_WRITER_COVERAGE_INCOMPLETE",
    "legacy writer observation must cover every writer file",
  );
  const normalized = {
    ...observedIdentity,
    ...windowEvidence(input, "legacyReadOnly", {
      notBefore,
      minimumDurationMs: GRAPH_MINIMUM_LEGACY_WRITER_OBSERVATION_MS,
    }),
    observationSampleCount: positive(
      input?.observationSampleCount,
      "legacyReadOnly.observationSampleCount",
    ),
    activeLegacyRunCount: zero(
      input?.activeLegacyRunCount,
      "legacyReadOnly.activeLegacyRunCount",
    ),
    legacyMutationSuccessCount: zero(
      input?.legacyMutationSuccessCount,
      "legacyReadOnly.legacyMutationSuccessCount",
    ),
    writerObservations,
    mutationProbes: normalizeMutationProbes(
      input?.mutationProbes,
      entry.mutationFunctions,
      "legacyReadOnly.mutationProbes",
    ),
  };
  normalized.evidenceDigest = verifyDigest(
    input,
    normalized,
    "cc.graph.entry-writer-observation/v1",
  );
  return normalized;
}

function retirementContract(entry) {
  return normalizeGraphRetirementContract({
    rolloutKey: entry.rolloutKey,
    replacementEntrypoint: entry.replacementEntrypoint,
    replacementEntryIds: entry.replacementEntryIds,
    historicalReadFunctions: entry.historicalReadFunctions,
    mutationFunctions: entry.mutationFunctions,
    writerFiles: entry.writerFiles,
  });
}

function normalizeFinalLedger(input, commitSha) {
  const canonicalActivated = timestamp(
    input?.canonicalActivatedAt,
    "finalLedger.canonicalActivatedAt",
  );
  if (
    input?.stage !== "legacy_read_only" ||
    commit(input?.canonicalCommitSha, "finalLedger.canonicalCommitSha") !==
      commitSha
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_FINAL_STAGE_INVALID",
      "final ledger must retain the exact canonical commit in legacy_read_only",
    );
  }
  return {
    stage: "legacy_read_only",
    canonicalCommitSha: commitSha,
    canonicalActivatedAt: canonicalActivated.value,
    eventHead: digest(input?.eventHead, "finalLedger.eventHead"),
    rollbackCount: atLeast(
      input?.rollbackCount,
      GRAPH_REQUIRED_ROLLBACK_DRILLS.length,
      "finalLedger.rollbackCount",
    ),
    transitionCount: atLeast(
      input?.transitionCount,
      10,
      "finalLedger.transitionCount",
    ),
    evidenceDigest: digest(input?.evidenceDigest, "finalLedger.evidenceDigest"),
  };
}

function normalizeEntry(input, expected, commitSha) {
  const identity = entryIdentity(input, expected, commitSha);
  exactMembers(
    input?.stageSequence || [],
    GRAPH_REQUIRED_CUTOVER_STAGES,
    "CC_GRAPH_PRODUCTION_STAGE_COVERAGE_INCOMPLETE",
    "entry evidence must cover every rollout stage",
    { surface: identity.surface, entryId: identity.entryId },
  );
  if (
    JSON.stringify(input.stageSequence) !==
    JSON.stringify(GRAPH_REQUIRED_CUTOVER_STAGES)
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_STAGE_ORDER_INVALID",
      "rollout stages must occur in the canonical order",
      { surface: identity.surface, entryId: identity.entryId },
    );
  }
  const finalLedger = normalizeFinalLedger(input?.finalLedger, commitSha);
  const shadow = normalizeShadow(input?.shadow);
  const canary = normalizeCanary(input?.canary, commitSha);
  if (
    Date.parse(shadow.endedAt) > Date.parse(canary.startedAt) ||
    Date.parse(canary.endedAt) > Date.parse(finalLedger.canonicalActivatedAt)
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_STAGE_ORDER_INVALID",
      "shadow, canary, and canonical activation evidence overlap or are out of order",
      { surface: identity.surface, entryId: identity.entryId },
    );
  }
  const normalized = {
    ...identity,
    stageSequence: [...GRAPH_REQUIRED_CUTOVER_STAGES],
    shadow,
    canary,
    rollback: normalizeRollback(input?.rollback),
    finalLedger,
  };
  if (expected.entry.cutoverStrategy === "retire") {
    const contract = retirementContract(expected.entry);
    normalized.retirementEvidence = normalizeGraphRetirementEvidence(
      input?.retirementEvidence,
      {
        surface: identity.surface,
        entryId: identity.entryId,
        manifestDigest: identity.manifestDigest,
        commitSha,
        contract,
        requiredPlatforms: GRAPH_CUTOVER_REQUIRED_PLATFORMS,
        minimumDurationMs: GRAPH_MINIMUM_RETIREMENT_OBSERVATION_MS,
      },
    );
    normalized.legacyReadOnly = normalizeGraphLegacyWriterObservation(
      input?.legacyReadOnly,
      {
        surface: identity.surface,
        entryId: identity.entryId,
        manifestDigest: identity.manifestDigest,
        commitSha,
        contract,
        notBefore: finalLedger.canonicalActivatedAt,
        minimumDurationMs: GRAPH_MINIMUM_LEGACY_WRITER_OBSERVATION_MS,
      },
    );
  } else {
    normalized.legacyReadOnly = normalizeMigratedWriterObservation(
      input?.legacyReadOnly,
      identity,
      expected.entry,
      finalLedger.canonicalActivatedAt,
    );
  }
  const expectedLegacyErrorCode =
    expected.manifest?.cutoverPolicy?.legacyMutationErrorCodes?.[
      identity.surface
    ];
  for (const probe of [
    ...normalized.legacyReadOnly.mutationProbes,
    ...(normalized.retirementEvidence?.mutationProbes || []),
  ]) {
    if (probe.errorCode !== expectedLegacyErrorCode) {
      throw evidenceError(
        "CC_GRAPH_PRODUCTION_LEGACY_ERROR_CODE_MISMATCH",
        `${probe.mutationFunction} did not return the manifest-pinned legacy writer error code`,
      );
    }
  }
  const commonObservationDigests = [
    normalized.shadow.evidenceDigest,
    normalized.canary.evidenceDigest,
    normalized.rollback.evidenceDigest,
    normalized.finalLedger.evidenceDigest,
    normalized.legacyReadOnly.evidenceDigest,
    ...(normalized.retirementEvidence
      ? [normalized.retirementEvidence.evidenceDigest]
      : []),
  ];
  const expectedDigestsByPlatform = new Map(
    normalized.canary.platformJourneys.map(({ platform }) => [
      platform,
      [...commonObservationDigests],
    ]),
  );
  normalized.observationSources = normalizeObservationSources(
    input?.observationSources,
    expectedDigestsByPlatform,
    "observationSources",
  );
  normalized.evidenceDigest = verifyDigest(
    input,
    normalized,
    "cc.graph.production-cutover-entry/v1",
  );
  return normalized;
}

function normalizeDisabledEntry(input, expected, commitSha) {
  const manifestDigest = graphRuntimeEntryManifestDigest(
    expected.manifest,
    expected.surface.originSurface,
    expected.entry.id,
  );
  const normalized = {
    surface: text(input?.surface, "disabledEntry.surface"),
    entryId: text(input?.entryId, "disabledEntry.entryId"),
    rolloutKey: text(input?.rolloutKey, "disabledEntry.rolloutKey"),
    manifestDigest: digest(
      input?.manifestDigest,
      "disabledEntry.manifestDigest",
    ),
    commitSha: commit(input?.commitSha, "disabledEntry.commitSha"),
    cutoverStrategy: text(
      input?.cutoverStrategy,
      "disabledEntry.cutoverStrategy",
    ),
    runtimeDurability: text(
      input?.runtimeDurability,
      "disabledEntry.runtimeDurability",
    ),
    featureFlagDefault: text(
      input?.featureFlagDefault,
      "disabledEntry.featureFlagDefault",
    ),
    directEngineInvocationCount: zero(
      input?.directEngineInvocationCount,
      "disabledEntry.directEngineInvocationCount",
    ),
    durableAuthorityClaimCount: zero(
      input?.durableAuthorityClaimCount,
      "disabledEntry.durableAuthorityClaimCount",
    ),
    disablementProbeDigest: digest(
      input?.disablementProbeDigest,
      "disabledEntry.disablementProbeDigest",
    ),
  };
  if (
    normalized.surface !== expected.surface.originSurface ||
    normalized.entryId !== expected.entry.id ||
    normalized.rolloutKey !== expected.entry.rolloutKey ||
    normalized.manifestDigest !== manifestDigest ||
    normalized.commitSha !== commitSha ||
    normalized.cutoverStrategy !== "disabled" ||
    normalized.runtimeDurability !== "non_durable" ||
    normalized.featureFlagDefault !== "disabled" ||
    expected.surface.featureFlag.default !== "disabled"
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_DISABLED_ENTRY_INVALID",
      "disabled entry evidence must preserve truthful non-durable fail-closed claims",
      { surface: expected.surface.originSurface, entryId: expected.entry.id },
    );
  }
  normalized.observationSources = normalizeObservationSources(
    input?.observationSources,
    new Map(
      GRAPH_CUTOVER_REQUIRED_PLATFORMS.map((platform) => [
        platform,
        [normalized.disablementProbeDigest],
      ]),
    ),
    "disabledEntry.observationSources",
  );
  normalized.evidenceDigest = verifyDigest(
    input,
    normalized,
    "cc.graph.production-disabled-entry/v1",
  );
  return normalized;
}

function manifestEntries(manifest) {
  return manifest.surfaces.flatMap((surface) =>
    surface.entries.map((entry) => ({ manifest, surface, entry })),
  );
}

function indexedEvidence(value, field) {
  if (!Array.isArray(value)) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_ENTRY_COVERAGE_INCOMPLETE",
      `${field} must be an array`,
    );
  }
  const map = new Map();
  for (const entry of value) {
    const key = `${entry?.surface}/${entry?.entryId}`;
    if (map.has(key)) {
      throw evidenceError(
        "CC_GRAPH_PRODUCTION_ENTRY_COVERAGE_INCOMPLETE",
        `${field} contains duplicate ${key}`,
      );
    }
    map.set(key, entry);
  }
  return map;
}

export function graphProductionCutoverEvidenceDigest(value) {
  const unsigned = clone(value);
  delete unsigned.evidenceDigest;
  return graphDigest(unsigned, "cc.graph.production-cutover-evidence/v1");
}

export function graphProductionExpectedIdentityBinding({
  commitSha,
  repository,
  workflow = GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
  ref = GRAPH_PRODUCTION_EVIDENCE_REF,
  environment = GRAPH_PRODUCTION_EVIDENCE_ENVIRONMENT,
  workflowRunId,
  workflowRunAttempt,
  manifestDigest,
  sourceRegistryDigest,
  challenge,
}) {
  return graphDigest(
    {
      commitSha: commit(commitSha),
      repository: text(repository, "provenance.repository"),
      workflow: text(workflow, "provenance.workflow"),
      ref: text(ref, "provenance.ref"),
      environment: text(environment, "provenance.environment"),
      workflowRunId: positive(workflowRunId, "provenance.workflowRunId"),
      workflowRunAttempt: positive(
        workflowRunAttempt,
        "provenance.workflowRunAttempt",
      ),
      manifestDigest: digest(manifestDigest, "provenance.manifestDigest"),
      sourceRegistryDigest: digest(
        sourceRegistryDigest,
        "provenance.sourceRegistryDigest",
      ),
      challenge: text(challenge, "provenance.challenge"),
    },
    "cc.graph.production-expected-identity/v1",
  );
}

export function normalizeGraphProductionCutoverEvidence(
  input,
  {
    manifest = loadGraphRuntimeSurfaceManifest(),
    expectedCommitSha = undefined,
    expectedRepository = undefined,
    expectedEnvironment = undefined,
    expectedWorkflow = GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
    expectedWorkflowRunId = undefined,
    expectedWorkflowRunAttempt = undefined,
    expectedRegistryDigest = undefined,
    expectedChallenge = undefined,
    jobsInventory = undefined,
    clock = Date.now,
  } = {},
) {
  if (input?.schema !== GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_EVIDENCE_INVALID",
      `evidence schema must be ${GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA}`,
    );
  }
  const commitSha = commit(input?.commitSha);
  if (expectedCommitSha && commitSha !== commit(expectedCommitSha)) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_SHA_MISMATCH",
      "production cutover evidence does not match the expected commit",
    );
  }
  const manifestContract =
    assertGraphProductionRuntimeSurfaceManifest(manifest);
  const manifestDigest = digest(input?.manifestDigest, "manifestDigest");
  if (manifestDigest !== manifestContract.manifestDigest) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_MANIFEST_CONTRACT_MISMATCH",
      "production evidence does not bind the frozen five-surface manifest",
    );
  }
  const provenance = {
    repository: text(input?.provenance?.repository, "provenance.repository"),
    workflow: text(input?.provenance?.workflow, "provenance.workflow"),
    ref: text(input?.provenance?.ref, "provenance.ref"),
    environment: text(input?.provenance?.environment, "provenance.environment"),
    workflowRunId: positive(
      input?.provenance?.workflowRunId,
      "provenance.workflowRunId",
    ),
    workflowRunAttempt: positive(
      input?.provenance?.workflowRunAttempt,
      "provenance.workflowRunAttempt",
    ),
    manifestDigest: digest(
      input?.provenance?.manifestDigest,
      "provenance.manifestDigest",
    ),
    sourceRegistryDigest: digest(
      input?.provenance?.sourceRegistryDigest,
      "provenance.sourceRegistryDigest",
    ),
    challenge: text(input?.provenance?.challenge, "provenance.challenge"),
    expectedIdentityBinding: digest(
      input?.provenance?.expectedIdentityBinding,
      "provenance.expectedIdentityBinding",
    ),
  };
  const expectedIdentityBinding = graphProductionExpectedIdentityBinding({
    commitSha,
    ...provenance,
  });
  if (
    (expectedRepository && provenance.repository !== expectedRepository) ||
    provenance.workflow !== GRAPH_PRODUCTION_EVIDENCE_WORKFLOW ||
    provenance.ref !== GRAPH_PRODUCTION_EVIDENCE_REF ||
    provenance.environment !== GRAPH_PRODUCTION_EVIDENCE_ENVIRONMENT ||
    (expectedWorkflow && provenance.workflow !== expectedWorkflow) ||
    (expectedEnvironment && provenance.environment !== expectedEnvironment) ||
    (expectedWorkflowRunId !== undefined &&
      provenance.workflowRunId !== Number(expectedWorkflowRunId)) ||
    (expectedWorkflowRunAttempt !== undefined &&
      provenance.workflowRunAttempt !== Number(expectedWorkflowRunAttempt)) ||
    provenance.manifestDigest !== manifestDigest ||
    (expectedRegistryDigest &&
      provenance.sourceRegistryDigest !== expectedRegistryDigest) ||
    (expectedChallenge && provenance.challenge !== expectedChallenge) ||
    provenance.expectedIdentityBinding !== expectedIdentityBinding
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_PROVENANCE_MISMATCH",
      "production evidence provenance does not match the protected producer",
      {
        expectedRepository,
        expectedWorkflow,
        expectedEnvironment,
        expectedWorkflowRunId:
          expectedWorkflowRunId === undefined
            ? undefined
            : Number(expectedWorkflowRunId),
        expectedWorkflowRunAttempt:
          expectedWorkflowRunAttempt === undefined
            ? undefined
            : Number(expectedWorkflowRunAttempt),
        actual: provenance,
      },
    );
  }
  if (!jobsInventory) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVENTORY_REQUIRED",
      "production evidence verification requires the complete current-attempt Actions job inventory",
    );
  }
  const sourceBundle = normalizeGraphProductionSourceBundle(
    {
      registry: input?.sourceRegistry,
      fragments: input?.sourceFragments,
    },
    {
      manifest,
      expectedCommitSha: commitSha,
      expectedRepository: provenance.repository,
      expectedRegistryDigest:
        expectedRegistryDigest || provenance.sourceRegistryDigest,
      expectedWorkflowRunId: provenance.workflowRunId,
      expectedWorkflowRunAttempt: provenance.workflowRunAttempt,
      expectedChallenge: provenance.challenge,
      jobsInventory,
      clock,
    },
  );
  const allEntries = manifestEntries(manifest);
  const durable = allEntries.filter(
    ({ entry }) => entry.cutoverStrategy !== "disabled",
  );
  const disabled = allEntries.filter(
    ({ entry }) => entry.cutoverStrategy === "disabled",
  );
  const providedEntries = indexedEvidence(input?.entries, "entries");
  const providedDisabled = indexedEvidence(
    input?.disabledEntries,
    "disabledEntries",
  );
  exactMembers(
    [...providedEntries.keys()],
    durable.map(({ surface, entry }) => `${surface.originSurface}/${entry.id}`),
    "CC_GRAPH_PRODUCTION_ENTRY_COVERAGE_INCOMPLETE",
    "production cutover evidence must cover every non-disabled entry",
  );
  exactMembers(
    [...providedDisabled.keys()],
    disabled.map(
      ({ surface, entry }) => `${surface.originSurface}/${entry.id}`,
    ),
    "CC_GRAPH_PRODUCTION_DISABLED_COVERAGE_INCOMPLETE",
    "production cutover evidence must cover every disabled entry",
  );
  const entries = durable
    .map((expected) =>
      normalizeEntry(
        providedEntries.get(
          `${expected.surface.originSurface}/${expected.entry.id}`,
        ),
        expected,
        commitSha,
      ),
    )
    .sort((left, right) =>
      compareCanonicalText(
        `${left.surface}/${left.entryId}`,
        `${right.surface}/${right.entryId}`,
      ),
    );
  const disabledEntries = disabled
    .map((expected) =>
      normalizeDisabledEntry(
        providedDisabled.get(
          `${expected.surface.originSurface}/${expected.entry.id}`,
        ),
        expected,
        commitSha,
      ),
    )
    .sort((left, right) =>
      compareCanonicalText(
        `${left.surface}/${left.entryId}`,
        `${right.surface}/${right.entryId}`,
      ),
    );
  if (
    canonicalGraphJson(entries) !== canonicalGraphJson(sourceBundle.entries) ||
    canonicalGraphJson(disabledEntries) !==
      canonicalGraphJson(sourceBundle.disabledEntries)
  ) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_SOURCE_DERIVATION_MISMATCH",
      "aggregate entries do not exactly match values derived from signed raw source receipts",
    );
  }
  const observedAt = timestamp(input?.observedAt, "observedAt");
  const latestSignedCollection = Math.max(
    ...sourceBundle.fragments.flatMap((fragment) =>
      fragment.receipts.map((receipt) =>
        Date.parse(receipt.payload.collectorEndedAt),
      ),
    ),
  );
  if (observedAt.milliseconds !== latestSignedCollection) {
    throw evidenceError(
      "CC_GRAPH_PRODUCTION_OBSERVATION_INVALID",
      "aggregate observedAt must equal the latest signed collector completion",
    );
  }
  const normalized = {
    schema: GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA,
    commitSha,
    manifestDigest,
    observedAt: observedAt.value,
    provenance,
    sourceRegistry: sourceBundle.registry,
    sourceFragments: sourceBundle.fragments,
    entries,
    disabledEntries,
  };
  normalized.evidenceDigest = verifyDigest(
    input,
    normalized,
    "cc.graph.production-cutover-evidence/v1",
  );
  return Object.freeze(normalized);
}

export function createGraphProductionCutoverReceipt(input, options = {}) {
  const evidence = normalizeGraphProductionCutoverEvidence(input, options);
  const observationSources = [
    ...evidence.entries.flatMap((entry) => entry.observationSources),
    ...evidence.disabledEntries.flatMap((entry) => entry.observationSources),
  ];
  const surfaceNames = new Set([
    ...evidence.entries.map((entry) => entry.surface),
    ...evidence.disabledEntries.map((entry) => entry.surface),
  ]);
  const receipt = {
    schema: GRAPH_PRODUCTION_CUTOVER_RECEIPT_SCHEMA,
    commitSha: evidence.commitSha,
    evidenceDigest: evidence.evidenceDigest,
    status: "passed",
    surfaceCount: surfaceNames.size,
    durableEntryCount: evidence.entries.length,
    migratedEntryCount: evidence.entries.filter(
      (entry) => entry.cutoverStrategy === "migrate",
    ).length,
    retiredEntryCount: evidence.entries.filter(
      (entry) => entry.cutoverStrategy === "retire",
    ).length,
    disabledEntryCount: evidence.disabledEntries.length,
    projectionDimensionCount: GRAPH_REQUIRED_SHADOW_DIMENSIONS.length,
    rollbackDrillCount:
      evidence.entries.length * GRAPH_REQUIRED_ROLLBACK_DRILLS.length,
    legacyMutationCount: evidence.entries.reduce(
      (total, entry) => total + entry.legacyReadOnly.mutationProbes.length,
      0,
    ),
    observationSourceCount: observationSources.length,
    distinctObservationSourceCount: new Set(
      observationSources.map((source) => source.identityDigest),
    ).size,
    minimumObservationWindowMs: {
      shadow: GRAPH_MINIMUM_SHADOW_OBSERVATION_MS,
      canary: GRAPH_MINIMUM_CANARY_OBSERVATION_MS,
      retirement: GRAPH_MINIMUM_RETIREMENT_OBSERVATION_MS,
      legacyWriter: GRAPH_MINIMUM_LEGACY_WRITER_OBSERVATION_MS,
    },
    provenance: clone(evidence.provenance),
  };
  receipt.receiptDigest = graphDigest(
    receipt,
    "cc.graph.production-cutover-receipt/v1",
  );
  return Object.freeze(receipt);
}
