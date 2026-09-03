import { createHash } from "node:crypto";

import { verifyEvolutionWorkbenchMetricsSnapshot } from "./evolution-workbench-metrics.js";
import { isEvolutionWorkbenchMetricsLedgerAdapter } from "./evolution-workbench-metrics-ledger-adapter.js";

export const SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA =
  "chainlesschain.skill-outcome-index-authority/v1";
export const MAX_SKILL_OUTCOME_INDEX_SOURCES = 128;
export const MAX_SKILL_OUTCOME_INDEX_VERSIONS = 10_000;

const LEDGER_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bounded(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  );
}

function unavailable(
  message,
  code = "CC_SKILL_OUTCOME_INDEX_AUTHORITY_UNAVAILABLE",
) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function verifyLedgerAuthority(value, found) {
  if (
    value?.schema !== "chainlesschain.evolution-ledger-verification/v2" ||
    value.status !== "verified" ||
    value.authenticated !== true ||
    value.durable !== true ||
    !bounded(value.ledgerId) ||
    !LEDGER_DIGEST.test(value.identityDigest || "") ||
    (value.headDigest !== null &&
      !LEDGER_DIGEST.test(value.headDigest || "")) ||
    (found && value.headDigest === null) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !Number.isSafeInteger(value.eventCount) ||
    value.eventCount < 0 ||
    value.sequence !== value.eventCount ||
    !bounded(value.witnessId) ||
    !Number.isSafeInteger(value.witnessGeneration) ||
    value.witnessGeneration < 0 ||
    !LEDGER_DIGEST.test(value.witnessDigest || "")
  ) {
    throw unavailable("Skill outcome index ledger authority is invalid");
  }
  return value;
}

function inspectSource(adapter) {
  const loaded = adapter.loadOutcomeSnapshot();
  const descriptor = loaded?.descriptor;
  if (
    !descriptor ||
    !bounded(descriptor.tenantId) ||
    !bounded(descriptor.evolutionRunId) ||
    !bounded(descriptor.skillName) ||
    loaded.authenticated !== true ||
    loaded.durable !== true ||
    typeof loaded.found !== "boolean"
  ) {
    throw unavailable("Skill outcome index source is invalid");
  }
  const ledger = verifyLedgerAuthority(loaded.ledgerAuthority, loaded.found);
  if (!loaded.found) {
    return Object.freeze({
      descriptor,
      ledger,
      snapshot: null,
    });
  }
  const snapshot = verifyEvolutionWorkbenchMetricsSnapshot(
    loaded.snapshot,
    descriptor,
  );
  if (
    snapshot.outcomeHistoryComplete !== true &&
    snapshot.versions.length !== 0
  ) {
    throw unavailable(
      "Skill outcome index requires a complete outcome backfill",
      "CC_SKILL_OUTCOME_INDEX_BACKFILL_REQUIRED",
    );
  }
  return Object.freeze({ descriptor, ledger, snapshot });
}

export function buildSkillOutcomeIndexAuthority(
  { adapters, maxSources = MAX_SKILL_OUTCOME_INDEX_SOURCES } = {},
  dependencies = {},
) {
  const isAdapter =
    dependencies.isMetricsLedgerAdapter ||
    isEvolutionWorkbenchMetricsLedgerAdapter;
  if (
    !Array.isArray(adapters) ||
    adapters.length < 1 ||
    !Number.isSafeInteger(maxSources) ||
    maxSources < 1 ||
    maxSources > MAX_SKILL_OUTCOME_INDEX_SOURCES ||
    adapters.length > maxSources ||
    typeof isAdapter !== "function" ||
    adapters.some(
      (adapter) =>
        !isAdapter(adapter) ||
        typeof adapter?.loadOutcomeSnapshot !== "function",
    )
  ) {
    throw new TypeError(
      "Skill outcome index adapters are invalid or unbounded",
    );
  }

  const sources = adapters.map(inspectSource);
  const sourceIds = new Set();
  let versionCount = 0;
  let outcomeSampleCount = 0;
  const totals = new Map();
  for (const source of sources) {
    const sourceId = [
      source.descriptor.tenantId,
      source.descriptor.evolutionRunId,
      source.descriptor.skillName,
    ].join("\0");
    if (sourceIds.has(sourceId)) {
      throw unavailable("Skill outcome index contains a duplicate source");
    }
    sourceIds.add(sourceId);
    if (!source.snapshot) continue;
    versionCount += source.snapshot.versions.length;
    if (versionCount > MAX_SKILL_OUTCOME_INDEX_VERSIONS) {
      throw unavailable(
        "Skill outcome index version capacity exceeded",
        "CC_SKILL_OUTCOME_INDEX_CAPACITY",
      );
    }
    for (const version of source.snapshot.versions) {
      if (
        !Number.isSafeInteger(version.outcomeReceiptCount) ||
        !Number.isSafeInteger(version.outcomeCompleted) ||
        !Number.isSafeInteger(version.userCorrectionCount)
      ) {
        throw unavailable("Skill outcome index version is not outcome-aware");
      }
      if (version.outcomeReceiptCount === 0) continue;
      const total = totals.get(version.contentDigest) || {
        samples: 0,
        successes: 0,
        corrections: 0,
      };
      total.samples += version.outcomeReceiptCount;
      total.successes += version.outcomeCompleted;
      total.corrections += version.userCorrectionCount;
      if (
        !Number.isSafeInteger(total.samples) ||
        !Number.isSafeInteger(total.successes) ||
        !Number.isSafeInteger(total.corrections)
      ) {
        throw unavailable(
          "Skill outcome index aggregate capacity exceeded",
          "CC_SKILL_OUTCOME_INDEX_CAPACITY",
        );
      }
      totals.set(version.contentDigest, total);
      outcomeSampleCount += version.outcomeReceiptCount;
      if (!Number.isSafeInteger(outcomeSampleCount)) {
        throw unavailable(
          "Skill outcome index sample capacity exceeded",
          "CC_SKILL_OUTCOME_INDEX_CAPACITY",
        );
      }
    }
  }

  const metrics = Object.fromEntries(
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([contentDigest, total]) => [
        contentDigest,
        Object.freeze({
          samples: total.samples,
          successRate: total.successes / total.samples,
          correctionRate: total.corrections / total.samples,
        }),
      ]),
  );
  const sourceProjection = sources
    .map(({ descriptor, ledger, snapshot }) => ({
      tenantId: descriptor.tenantId,
      evolutionRunId: descriptor.evolutionRunId,
      skillName: descriptor.skillName,
      snapshotDigest: snapshot?.snapshotDigest || null,
      ledgerId: ledger.ledgerId,
      identityDigest: ledger.identityDigest,
      headDigest: ledger.headDigest,
      eventCount: ledger.eventCount,
      witnessId: ledger.witnessId,
      witnessGeneration: ledger.witnessGeneration,
      witnessDigest: ledger.witnessDigest,
    }))
    .sort(
      (left, right) =>
        left.tenantId.localeCompare(right.tenantId) ||
        left.evolutionRunId.localeCompare(right.evolutionRunId) ||
        left.skillName.localeCompare(right.skillName),
    );
  const sourceDigest = sha256(
    `${SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA}\0${canonical(sourceProjection)}`,
  );
  return Object.freeze({
    schema: SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
    status: "verified-indexed",
    metrics: Object.freeze(metrics),
    evidence: Object.freeze({
      schema: SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
      status: "verified-indexed",
      sourceDigest,
      sourceCount: sources.length,
      snapshotCount: sources.filter(({ snapshot }) => snapshot !== null).length,
      versionCount,
      outcomeSampleCount,
      maxSources,
      maxVersions: MAX_SKILL_OUTCOME_INDEX_VERSIONS,
      antiRollbackWitness: true,
    }),
  });
}

export function unavailableSkillOutcomeIndexAuthority(error) {
  return Object.freeze({
    schema: SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
    status: "unavailable",
    metrics: null,
    evidence: Object.freeze({
      schema: SKILL_OUTCOME_INDEX_AUTHORITY_SCHEMA,
      status: "unavailable",
      code:
        typeof error?.code === "string" &&
        error.code.startsWith("CC_SKILL_OUTCOME_INDEX_")
          ? error.code
          : "CC_SKILL_OUTCOME_INDEX_AUTHORITY_UNAVAILABLE",
      antiRollbackWitness: false,
    }),
  });
}
