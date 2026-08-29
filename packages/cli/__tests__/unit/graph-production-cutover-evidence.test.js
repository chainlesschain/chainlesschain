import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { graphDigest } from "../../src/lib/graph-kernel/compiler.js";
import {
  GRAPH_ENTRY_WRITER_OBSERVATION_SCHEMA,
  GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA,
  GRAPH_REQUIRED_CUTOVER_STAGES,
  GRAPH_REQUIRED_ROLLBACK_DRILLS,
  GRAPH_REQUIRED_SHADOW_DIMENSIONS,
  createGraphProductionCutoverReceipt,
  graphProductionCutoverEvidenceDigest,
  normalizeGraphProductionCutoverEvidence,
} from "../../src/lib/graph-kernel/production-cutover-evidence.js";
import {
  graphRuntimeEntryManifestDigest,
  loadGraphRuntimeSurfaceManifest,
} from "../../src/lib/graph-kernel/runtime-surface-manifest.js";
import {
  GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA,
  GRAPH_RETIREMENT_EVIDENCE_SCHEMA,
  graphLegacyWriterObservationDigest,
  graphRetirementEvidenceDigest,
} from "../../src/lib/graph-kernel/retirement-evidence.js";

const COMMIT = "a".repeat(40);
const DIGEST = (character = "0") => `sha256:${character.repeat(64)}`;
const manifest = loadGraphRuntimeSurfaceManifest();

function proof(value, domain) {
  return {
    ...value,
    evidenceDigest: graphDigest(value, domain),
  };
}

function mutationProbes(entry, character = "8") {
  return [...entry.mutationFunctions].sort().map((mutationFunction) => ({
    mutationFunction,
    attemptCount: 3,
    blockedCount: 3,
    successCount: 0,
    errorCode: entry.id.startsWith("desktop-")
      ? "CC_DESKTOP_LEGACY_RUNTIME_READ_ONLY"
      : "CC_CLI_LEGACY_RUNTIME_READ_ONLY",
    evidenceDigest: DIGEST(character),
  }));
}

function shadowEvidence() {
  return {
    startedAt: "2030-01-01T00:00:00.000Z",
    endedAt: "2030-01-01T00:30:00.000Z",
    durationMs: 1_800_000,
    runCount: 12,
    divergenceCount: 0,
    unknownEffectCount: 0,
    realEffectInvocationCount: 0,
    comparisons: [...GRAPH_REQUIRED_SHADOW_DIMENSIONS]
      .sort()
      .map((dimension) => ({
        dimension,
        status: "equivalent",
        sampleCount: 12,
        evidenceDigest: DIGEST("1"),
      })),
    evidenceDigest: DIGEST("2"),
  };
}

function canaryEvidence() {
  return {
    startedAt: "2030-01-01T00:30:00.000Z",
    endedAt: "2030-01-01T01:30:00.000Z",
    durationMs: 3_600_000,
    internalRunCount: 3,
    optInRunCount: 3,
    defaultRunCount: 6,
    failureCount: 0,
    reconciliationCount: 0,
    platformJourneys: ["linux", "macos", "windows"].map((platform) => ({
      platform,
      commitSha: COMMIT,
      status: "passed",
      evidenceDigest: DIGEST("3"),
    })),
    evidenceDigest: DIGEST("4"),
  };
}

function rollbackEvidence() {
  return {
    drills: [...GRAPH_REQUIRED_ROLLBACK_DRILLS].sort().map((transition) => ({
      transition,
      status: "passed",
      activeDispatchCount: 0,
      rpoLossCount: 0,
      duplicateEffectCount: 0,
      existingCanonicalRunsRetained: transition !== "shadow_to_legacy",
      evidenceDigest: DIGEST("5"),
    })),
    evidenceDigest: DIGEST("6"),
  };
}

function migratedWriterObservation(surface, entry, manifestDigest) {
  const unsigned = {
    schema: GRAPH_ENTRY_WRITER_OBSERVATION_SCHEMA,
    surface: surface.originSurface,
    entryId: entry.id,
    rolloutKey: entry.rolloutKey,
    manifestDigest,
    commitSha: COMMIT,
    startedAt: "2030-01-01T02:01:00.000Z",
    endedAt: "2030-01-01T03:01:00.000Z",
    durationMs: 3_600_000,
    observationSampleCount: 12,
    activeLegacyRunCount: 0,
    legacyMutationSuccessCount: 0,
    writerObservations: [...entry.writerFiles].sort().map((writerFile) => ({
      writerFile,
      observationSampleCount: 12,
      mutationSuccessCount: 0,
      evidenceDigest: DIGEST("7"),
    })),
    mutationProbes: mutationProbes(entry),
  };
  return proof(unsigned, "cc.graph.entry-writer-observation/v1");
}

function retirementEvidence(surface, entry, manifestDigest) {
  const unsigned = {
    schema: GRAPH_RETIREMENT_EVIDENCE_SCHEMA,
    surface: surface.originSurface,
    entryId: entry.id,
    rolloutKey: entry.rolloutKey,
    manifestDigest,
    commitSha: COMMIT,
    startedAt: "2030-01-01T00:30:00.000Z",
    endedAt: "2030-01-01T01:30:00.000Z",
    durationMs: 3_600_000,
    observationSampleCount: 12,
    activeLegacyRunCount: 0,
    legacyMutationSuccessCount: 0,
    replacementJourneys: [...entry.replacementEntryIds]
      .sort()
      .flatMap((replacementEntryId) =>
        ["linux", "macos", "windows"].map((platform) => ({
          replacementEntryId,
          productEntrypoint: entry.replacementEntrypoint,
          platform,
          commitSha: COMMIT,
          status: "passed",
          evidenceDigest: DIGEST("9"),
        })),
      ),
    mutationProbes: mutationProbes(entry, "a"),
    historicalReadProbes: [...entry.historicalReadFunctions]
      .sort()
      .map((historicalReadFunction) => ({
        historicalReadFunction,
        status: "passed",
        readCount: 3,
        mutationAttemptCount: 0,
        evidenceDigest: DIGEST("b"),
      })),
  };
  return {
    ...unsigned,
    evidenceDigest: graphRetirementEvidenceDigest(unsigned),
  };
}

function retiredWriterObservation(surface, entry, manifestDigest) {
  const unsigned = {
    schema: GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA,
    surface: surface.originSurface,
    entryId: entry.id,
    rolloutKey: entry.rolloutKey,
    manifestDigest,
    commitSha: COMMIT,
    startedAt: "2030-01-01T02:01:00.000Z",
    endedAt: "2030-01-01T03:01:00.000Z",
    durationMs: 3_600_000,
    observationSampleCount: 12,
    activeLegacyRunCount: 0,
    legacyMutationSuccessCount: 0,
    writerObservations: [...entry.writerFiles].sort().map((writerFile) => ({
      writerFile,
      observationSampleCount: 12,
      mutationSuccessCount: 0,
      evidenceDigest: DIGEST("c"),
    })),
    mutationProbes: mutationProbes(entry, "d"),
  };
  return {
    ...unsigned,
    evidenceDigest: graphLegacyWriterObservationDigest(unsigned),
  };
}

function entryEvidence(surface, entry) {
  const manifestDigest = graphRuntimeEntryManifestDigest(
    manifest,
    surface.originSurface,
    entry.id,
  );
  const unsigned = {
    surface: surface.originSurface,
    entryId: entry.id,
    rolloutKey: entry.rolloutKey,
    cutoverStrategy: entry.cutoverStrategy,
    manifestDigest,
    commitSha: COMMIT,
    stageSequence: [...GRAPH_REQUIRED_CUTOVER_STAGES],
    shadow: shadowEvidence(),
    canary: canaryEvidence(),
    rollback: rollbackEvidence(),
    finalLedger: {
      stage: "legacy_read_only",
      canonicalCommitSha: COMMIT,
      canonicalActivatedAt: "2030-01-01T02:00:00.000Z",
      eventHead: DIGEST("e"),
      rollbackCount: 3,
      transitionCount: 10,
      evidenceDigest: DIGEST("f"),
    },
    legacyReadOnly:
      entry.cutoverStrategy === "retire"
        ? retiredWriterObservation(surface, entry, manifestDigest)
        : migratedWriterObservation(surface, entry, manifestDigest),
  };
  if (entry.cutoverStrategy === "retire") {
    unsigned.retirementEvidence = retirementEvidence(
      surface,
      entry,
      manifestDigest,
    );
  }
  return proof(unsigned, "cc.graph.production-cutover-entry/v1");
}

function disabledEvidence(surface, entry) {
  const unsigned = {
    surface: surface.originSurface,
    entryId: entry.id,
    rolloutKey: entry.rolloutKey,
    manifestDigest: graphRuntimeEntryManifestDigest(
      manifest,
      surface.originSurface,
      entry.id,
    ),
    commitSha: COMMIT,
    cutoverStrategy: "disabled",
    runtimeDurability: "non_durable",
    featureFlagDefault: "disabled",
    directEngineInvocationCount: 0,
    durableAuthorityClaimCount: 0,
  };
  return proof(unsigned, "cc.graph.production-disabled-entry/v1");
}

function completeEvidence() {
  const entries = [];
  const disabledEntries = [];
  for (const surface of manifest.surfaces) {
    for (const entry of surface.entries) {
      if (entry.cutoverStrategy === "disabled") {
        disabledEntries.push(disabledEvidence(surface, entry));
      } else {
        entries.push(entryEvidence(surface, entry));
      }
    }
  }
  entries.sort((left, right) =>
    `${left.surface}/${left.entryId}` < `${right.surface}/${right.entryId}`
      ? -1
      : 1,
  );
  disabledEntries.sort((left, right) =>
    `${left.surface}/${left.entryId}` < `${right.surface}/${right.entryId}`
      ? -1
      : 1,
  );
  const unsigned = {
    schema: GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA,
    commitSha: COMMIT,
    observedAt: "2030-01-01T04:00:00.000Z",
    provenance: {
      repository: "chainlesschain/chainlesschain",
      environment: "graph-kernel-production",
      workflowRunId: 1234,
      workflowRunAttempt: 1,
      oidcAttestationDigest: DIGEST("0"),
    },
    entries,
    disabledEntries,
  };
  return {
    ...unsigned,
    evidenceDigest: graphProductionCutoverEvidenceDigest(unsigned),
  };
}

describe("Graph production cutover evidence", () => {
  it("accepts only a complete five-surface production close bundle", () => {
    const evidence = completeEvidence();
    const normalized = normalizeGraphProductionCutoverEvidence(evidence, {
      manifest,
      expectedCommitSha: COMMIT,
    });
    expect(normalized.entries).toHaveLength(20);
    expect(normalized.disabledEntries).toHaveLength(3);
    expect(createGraphProductionCutoverReceipt(evidence, { manifest })).toEqual(
      expect.objectContaining({
        status: "passed",
        surfaceCount: 5,
        durableEntryCount: 20,
        migratedEntryCount: 7,
        retiredEntryCount: 13,
        disabledEntryCount: 3,
        projectionDimensionCount: 9,
        rollbackDrillCount: 60,
        legacyMutationCount: 382,
        receiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects a missing durable entry before accepting an aggregate digest", () => {
    const evidence = completeEvidence();
    evidence.entries.pop();
    expect(() =>
      normalizeGraphProductionCutoverEvidence(evidence, { manifest }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_ENTRY_COVERAGE_INCOMPLETE",
      }),
    );
  });

  it("rejects incomplete semantic shadow comparison", () => {
    const evidence = completeEvidence();
    evidence.entries[0].shadow.comparisons.pop();
    expect(() =>
      normalizeGraphProductionCutoverEvidence(evidence, { manifest }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SHADOW_COVERAGE_INCOMPLETE",
      }),
    );
  });

  it("rejects missing rollback boundaries and mixed-SHA canaries", () => {
    const missingRollback = completeEvidence();
    missingRollback.entries[0].rollback.drills.pop();
    expect(() =>
      normalizeGraphProductionCutoverEvidence(missingRollback, { manifest }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_ROLLBACK_COVERAGE_INCOMPLETE",
      }),
    );

    const mixedSha = completeEvidence();
    mixedSha.entries[0].canary.platformJourneys[0].commitSha = "b".repeat(40);
    expect(() =>
      normalizeGraphProductionCutoverEvidence(mixedSha, { manifest }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_CANARY_PLATFORM_FAILED",
      }),
    );
  });

  it("rejects a Browser entry that claims durable authority", () => {
    const evidence = completeEvidence();
    evidence.disabledEntries[0].durableAuthorityClaimCount = 1;
    expect(() =>
      normalizeGraphProductionCutoverEvidence(evidence, { manifest }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_PRODUCTION_GATE_FAILED" }),
    );
  });

  it("binds the bundle to the protected producer run", () => {
    const evidence = completeEvidence();
    expect(() =>
      normalizeGraphProductionCutoverEvidence(evidence, {
        manifest,
        expectedCommitSha: COMMIT,
        expectedRepository: "chainlesschain/chainlesschain",
        expectedEnvironment: "graph-kernel-production",
        expectedWorkflowRunId: 9999,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_PROVENANCE_MISMATCH",
      }),
    );
  });

  it("keeps the production close behind exact-SHA, environment, and attestation gates", () => {
    const workflow = fs.readFileSync(
      fileURLToPath(
        new URL(
          "../../../../.github/workflows/graph-kernel-production-cutover.yml",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(workflow).toContain("environment: graph-kernel-production-close");
    expect(workflow).toContain('"${CUTOVER_SHA}" != "${GITHUB_SHA}"');
    expect(workflow).toContain("run-id: ${{ inputs.evidence_run_id }}");
    expect(workflow).toContain("gh attestation verify");
    expect(workflow).toContain(
      "--expected-environment graph-kernel-production",
    );
    expect(workflow).toContain("--expected-run-id");
    expect(workflow).toContain("actions/attest-build-provenance@v3");
  });
});
