import { graphDigest } from "./compiler.js";

export const GRAPH_RETIREMENT_EVIDENCE_SCHEMA =
  "chainlesschain.graph-retirement-qualification/v1";
export const GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA =
  "chainlesschain.graph-legacy-writer-observation/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const ERROR_CODE = /^CC_[A-Z0-9_]{2,120}$/u;

function evidenceError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphRetirementEvidenceError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function text(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 1024) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID",
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
      "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID",
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
      "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID",
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
      "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID",
      `${field} must be a positive safe integer`,
      { field, value },
    );
  }
  return normalized;
}

function zero(value, field) {
  if (Number(value) !== 0) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_GATE_FAILED",
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
      "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID",
      `${field} must be a canonical ISO timestamp`,
      { field },
    );
  }
  return { value: normalized, milliseconds };
}

function uniqueSortedStrings(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_CONTRACT_INVALID",
      `${field} must be ${allowEmpty ? "an" : "a non-empty"} array`,
      { field },
    );
  }
  const normalized = value.map((entry, index) =>
    text(entry, `${field}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_CONTRACT_INVALID",
      `${field} must not contain duplicates`,
      { field },
    );
  }
  return normalized.sort();
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

function compareCanonicalText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function normalizeGraphRetirementContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_CONTRACT_REQUIRED",
      "retired entries require a manifest-bound retirement contract",
    );
  }
  return Object.freeze({
    rolloutKey: text(value.rolloutKey, "retirementContract.rolloutKey"),
    replacementEntrypoint: text(
      value.replacementEntrypoint,
      "retirementContract.replacementEntrypoint",
    ),
    replacementEntryIds: uniqueSortedStrings(
      value.replacementEntryIds,
      "retirementContract.replacementEntryIds",
    ),
    historicalReadFunctions: uniqueSortedStrings(
      value.historicalReadFunctions,
      "retirementContract.historicalReadFunctions",
    ),
    mutationFunctions: uniqueSortedStrings(
      value.mutationFunctions,
      "retirementContract.mutationFunctions",
    ),
    writerFiles: uniqueSortedStrings(
      value.writerFiles,
      "retirementContract.writerFiles",
    ),
  });
}

export function graphRetirementEvidenceDigest(value) {
  const unsigned = clone(value);
  delete unsigned.evidenceDigest;
  return graphDigest(unsigned, "cc.graph.retirement-qualification/v1");
}

export function graphLegacyWriterObservationDigest(value) {
  const unsigned = clone(value);
  delete unsigned.evidenceDigest;
  return graphDigest(unsigned, "cc.graph.legacy-writer-observation/v1");
}

function evidenceIdentity(
  input,
  { schema, surface, entryId, manifestDigest, commitSha, contract },
) {
  if (input?.schema !== schema) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID",
      `evidence schema must be ${schema}`,
    );
  }
  const normalized = {
    schema,
    surface: text(input.surface, "surface"),
    entryId: text(input.entryId, "entryId"),
    rolloutKey: text(input.rolloutKey, "rolloutKey"),
    manifestDigest: digest(input.manifestDigest, "manifestDigest"),
    commitSha: commit(input.commitSha),
  };
  if (
    normalized.surface !== surface ||
    normalized.entryId !== entryId ||
    normalized.rolloutKey !== contract.rolloutKey ||
    normalized.manifestDigest !== manifestDigest ||
    normalized.commitSha !== commitSha
  ) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_BINDING_MISMATCH",
      "retirement evidence does not match the ledger entry, manifest, or commit",
      {
        expected: {
          surface,
          entryId,
          rolloutKey: contract.rolloutKey,
          manifestDigest,
          commitSha,
        },
        actual: normalized,
      },
    );
  }
  return normalized;
}

function observationWindow(input, { notBefore } = {}) {
  const started = timestamp(input.startedAt, "startedAt");
  const ended = timestamp(input.endedAt, "endedAt");
  if (ended.milliseconds <= started.milliseconds) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_OBSERVATION_INVALID",
      "retirement observation must end after it starts",
    );
  }
  if (notBefore && started.milliseconds < Date.parse(notBefore)) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_OBSERVATION_INVALID",
      "legacy writer observation cannot start before canonical authority",
      { notBefore, startedAt: started.value },
    );
  }
  return {
    startedAt: started.value,
    endedAt: ended.value,
    durationMs: ended.milliseconds - started.milliseconds,
    observationSampleCount: positive(
      input.observationSampleCount,
      "observationSampleCount",
    ),
  };
}

function normalizeMutationProbes(value, contract) {
  if (!Array.isArray(value)) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_MUTATION_COVERAGE_INCOMPLETE",
      "retirement evidence requires mutation probes",
    );
  }
  const normalized = value.map((entry, index) => {
    const mutationFunction = text(
      entry?.mutationFunction,
      `mutationProbes[${index}].mutationFunction`,
    );
    const attemptCount = positive(
      entry?.attemptCount,
      `mutationProbes[${index}].attemptCount`,
    );
    const blockedCount = positive(
      entry?.blockedCount,
      `mutationProbes[${index}].blockedCount`,
    );
    const successCount = zero(
      entry?.successCount,
      `mutationProbes[${index}].successCount`,
    );
    const errorCode = String(entry?.errorCode || "");
    if (!ERROR_CODE.test(errorCode)) {
      throw evidenceError(
        "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID",
        `mutationProbes[${index}].errorCode must be a stable CC_* code`,
      );
    }
    if (blockedCount !== attemptCount) {
      throw evidenceError(
        "CC_GRAPH_RETIREMENT_GATE_FAILED",
        `${mutationFunction} must block every mutation attempt`,
        { mutationFunction, attemptCount, blockedCount },
      );
    }
    return {
      mutationFunction,
      attemptCount,
      blockedCount,
      successCount,
      errorCode,
      evidenceDigest: digest(
        entry?.evidenceDigest,
        `mutationProbes[${index}].evidenceDigest`,
      ),
    };
  });
  normalized.sort((left, right) =>
    compareCanonicalText(left.mutationFunction, right.mutationFunction),
  );
  const actual = normalized.map((entry) => entry.mutationFunction);
  if (
    new Set(actual).size !== actual.length ||
    !sameMembers(actual, contract.mutationFunctions)
  ) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_MUTATION_COVERAGE_INCOMPLETE",
      "mutation probes must cover every retired mutation exactly once",
      { expected: contract.mutationFunctions, actual },
    );
  }
  return normalized;
}

function normalizeReplacementJourneys(value, contract, platforms, commitSha) {
  if (!Array.isArray(value)) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_REPLACEMENT_COVERAGE_INCOMPLETE",
      "retirement evidence requires replacement product journeys",
    );
  }
  const normalized = value.map((entry, index) => {
    const replacementEntryId = text(
      entry?.replacementEntryId,
      `replacementJourneys[${index}].replacementEntryId`,
    );
    const platform = String(entry?.platform || "").toLowerCase();
    const journeyCommit = commit(
      entry?.commitSha,
      `replacementJourneys[${index}].commitSha`,
    );
    if (
      !platforms.includes(platform) ||
      journeyCommit !== commitSha ||
      entry?.status !== "passed" ||
      entry?.productEntrypoint !== contract.replacementEntrypoint
    ) {
      throw evidenceError(
        "CC_GRAPH_RETIREMENT_REPLACEMENT_JOURNEY_FAILED",
        "replacement journey must pass through the declared product entrypoint on the exact commit",
        { replacementEntryId, platform },
      );
    }
    return {
      replacementEntryId,
      productEntrypoint: contract.replacementEntrypoint,
      platform,
      commitSha: journeyCommit,
      status: "passed",
      evidenceDigest: digest(
        entry?.evidenceDigest,
        `replacementJourneys[${index}].evidenceDigest`,
      ),
    };
  });
  normalized.sort((left, right) =>
    compareCanonicalText(
      `${left.replacementEntryId}:${left.platform}`,
      `${right.replacementEntryId}:${right.platform}`,
    ),
  );
  const actual = normalized.map(
    (entry) => `${entry.replacementEntryId}:${entry.platform}`,
  );
  const expected = contract.replacementEntryIds
    .flatMap((replacementEntryId) =>
      platforms.map((platform) => `${replacementEntryId}:${platform}`),
    )
    .sort();
  if (
    new Set(actual).size !== actual.length ||
    !sameMembers(actual, expected)
  ) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_REPLACEMENT_COVERAGE_INCOMPLETE",
      "replacement journeys must cover every declared replacement on every required platform",
      { expected, actual },
    );
  }
  return normalized;
}

function normalizeHistoricalReadProbes(value, contract) {
  if (!Array.isArray(value)) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_HISTORICAL_READ_COVERAGE_INCOMPLETE",
      "retirement evidence requires historical read probes",
    );
  }
  const normalized = value.map((entry, index) => {
    const historicalReadFunction = text(
      entry?.historicalReadFunction,
      `historicalReadProbes[${index}].historicalReadFunction`,
    );
    if (entry?.status !== "passed") {
      throw evidenceError(
        "CC_GRAPH_RETIREMENT_HISTORICAL_READ_FAILED",
        `${historicalReadFunction} did not pass its historical read probe`,
      );
    }
    return {
      historicalReadFunction,
      status: "passed",
      readCount: positive(
        entry?.readCount,
        `historicalReadProbes[${index}].readCount`,
      ),
      mutationAttemptCount: zero(
        entry?.mutationAttemptCount,
        `historicalReadProbes[${index}].mutationAttemptCount`,
      ),
      evidenceDigest: digest(
        entry?.evidenceDigest,
        `historicalReadProbes[${index}].evidenceDigest`,
      ),
    };
  });
  normalized.sort((left, right) =>
    compareCanonicalText(
      left.historicalReadFunction,
      right.historicalReadFunction,
    ),
  );
  const actual = normalized.map((entry) => entry.historicalReadFunction);
  if (
    new Set(actual).size !== actual.length ||
    !sameMembers(actual, contract.historicalReadFunctions)
  ) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_HISTORICAL_READ_COVERAGE_INCOMPLETE",
      "historical read probes must cover every declared read function exactly once",
      { expected: contract.historicalReadFunctions, actual },
    );
  }
  return normalized;
}

function verifyEvidenceDigest(input, normalized, digestFunction) {
  const supplied = digest(input?.evidenceDigest, "evidenceDigest");
  const expected = digestFunction(normalized);
  if (supplied !== expected) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_EVIDENCE_DIGEST_MISMATCH",
      "retirement evidence digest does not match its normalized contents",
      { expectedEvidenceDigest: expected, actualEvidenceDigest: supplied },
    );
  }
  return supplied;
}

export function normalizeGraphRetirementEvidence(
  input,
  {
    surface,
    entryId,
    manifestDigest,
    commitSha,
    contract: contractInput,
    requiredPlatforms,
  },
) {
  const contract = normalizeGraphRetirementContract(contractInput);
  const platforms = uniqueSortedStrings(
    requiredPlatforms,
    "requiredPlatforms",
  ).map((platform) => platform.toLowerCase());
  const normalized = {
    ...evidenceIdentity(input, {
      schema: GRAPH_RETIREMENT_EVIDENCE_SCHEMA,
      surface,
      entryId,
      manifestDigest,
      commitSha,
      contract,
    }),
    ...observationWindow(input),
    activeLegacyRunCount: zero(
      input?.activeLegacyRunCount,
      "activeLegacyRunCount",
    ),
    legacyMutationSuccessCount: zero(
      input?.legacyMutationSuccessCount,
      "legacyMutationSuccessCount",
    ),
    replacementJourneys: normalizeReplacementJourneys(
      input?.replacementJourneys,
      contract,
      platforms,
      commitSha,
    ),
    mutationProbes: normalizeMutationProbes(input?.mutationProbes, contract),
    historicalReadProbes: normalizeHistoricalReadProbes(
      input?.historicalReadProbes,
      contract,
    ),
  };
  normalized.evidenceDigest = verifyEvidenceDigest(
    input,
    normalized,
    graphRetirementEvidenceDigest,
  );
  return Object.freeze(normalized);
}

export function normalizeGraphLegacyWriterObservation(
  input,
  {
    surface,
    entryId,
    manifestDigest,
    commitSha,
    contract: contractInput,
    notBefore,
  },
) {
  const contract = normalizeGraphRetirementContract(contractInput);
  const writerObservations = Array.isArray(input?.writerObservations)
    ? input.writerObservations.map((entry, index) => ({
        writerFile: text(
          entry?.writerFile,
          `writerObservations[${index}].writerFile`,
        ),
        observationSampleCount: positive(
          entry?.observationSampleCount,
          `writerObservations[${index}].observationSampleCount`,
        ),
        mutationSuccessCount: zero(
          entry?.mutationSuccessCount,
          `writerObservations[${index}].mutationSuccessCount`,
        ),
        evidenceDigest: digest(
          entry?.evidenceDigest,
          `writerObservations[${index}].evidenceDigest`,
        ),
      }))
    : [];
  writerObservations.sort((left, right) =>
    compareCanonicalText(left.writerFile, right.writerFile),
  );
  const actualWriterFiles = writerObservations.map((entry) => entry.writerFile);
  if (
    new Set(actualWriterFiles).size !== actualWriterFiles.length ||
    !sameMembers(actualWriterFiles, contract.writerFiles)
  ) {
    throw evidenceError(
      "CC_GRAPH_RETIREMENT_WRITER_COVERAGE_INCOMPLETE",
      "legacy writer observations must cover every declared writer file exactly once",
      { expected: contract.writerFiles, actual: actualWriterFiles },
    );
  }
  const normalized = {
    ...evidenceIdentity(input, {
      schema: GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA,
      surface,
      entryId,
      manifestDigest,
      commitSha,
      contract,
    }),
    ...observationWindow(input, { notBefore }),
    activeLegacyRunCount: zero(
      input?.activeLegacyRunCount,
      "activeLegacyRunCount",
    ),
    legacyMutationSuccessCount: zero(
      input?.legacyMutationSuccessCount,
      "legacyMutationSuccessCount",
    ),
    writerObservations,
    mutationProbes: normalizeMutationProbes(input?.mutationProbes, contract),
  };
  normalized.evidenceDigest = verifyEvidenceDigest(
    input,
    normalized,
    graphLegacyWriterObservationDigest,
  );
  return Object.freeze(normalized);
}
