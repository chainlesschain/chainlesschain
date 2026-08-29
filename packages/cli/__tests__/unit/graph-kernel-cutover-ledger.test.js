import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JsonlRolloutStore,
  MemoryRolloutStore,
} from "../../src/lib/app-server/rollout-store.js";
import {
  GRAPH_CUTOVER_REQUIRED_PLATFORMS,
  GraphCutoverLedger,
} from "../../src/lib/graph-kernel/cutover-ledger.js";
import { graphStoreEvidenceDigest } from "../../src/lib/graph-kernel/store-cutover-evidence.js";
import {
  GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA,
  GRAPH_RETIREMENT_EVIDENCE_SCHEMA,
  graphLegacyWriterObservationDigest,
  graphRetirementEvidenceDigest,
} from "../../src/lib/graph-kernel/retirement-evidence.js";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const COMMIT = "a".repeat(40);
const STORES = ["DesktopGraphRunRegistry", "GraphEventStore"];
const RETIREMENT_CONTRACT = {
  rolloutKey: "desktop/desktop-legacy-workflow",
  replacementEntrypoint:
    "Desktop WorkflowManager through the fixed CC App Server Graph capability",
  replacementEntryIds: ["desktop-workflow-manager"],
  historicalReadFunctions: ["WorkflowEngine.getExecution"],
  mutationFunctions: ["WorkflowEngine.cancel", "WorkflowEngine.execute"],
  writerFiles: ["desktop/workflow-engine.js", "desktop/workflow-ipc.js"],
};

function platformEvidence(commitSha = COMMIT) {
  return GRAPH_CUTOVER_REQUIRED_PLATFORMS.map((platform) => ({
    platform,
    commitSha,
    passed: true,
  }));
}

function realJourneyPlatformEvidence(commitSha = COMMIT) {
  return GRAPH_CUTOVER_REQUIRED_PLATFORMS.map((platform) => ({
    schema: "chainlesschain.graph-agent-real-journey/v1",
    platform,
    commitSha,
    status: "passed",
    terminalEventDigest: DIGEST("f"),
    evidenceDigest: DIGEST("e"),
  }));
}

function storeCoverageEvidence(
  surface = "desktop",
  entryId = "desktop-specialized-agents",
  commitSha = COMMIT,
) {
  const platformCoverage = STORES.map((store) => ({
    store,
    coveredPlatforms: [...GRAPH_CUTOVER_REQUIRED_PLATFORMS].sort(),
    missingPlatforms: [],
    complete: true,
  }));
  const unsigned = {
    schema: "chainlesschain.graph-store-cutover-coverage/v1",
    commitSha,
    requiredPlatforms: [...GRAPH_CUTOVER_REQUIRED_PLATFORMS].sort(),
    entries: [
      {
        surface,
        entryId,
        stores: [...STORES].sort(),
        platformCoverage,
        complete: true,
      },
    ],
  };
  return { ...unsigned, evidenceDigest: graphStoreEvidenceDigest(unsigned) };
}

function mutationProbes() {
  return RETIREMENT_CONTRACT.mutationFunctions.map(
    (mutationFunction, index) => ({
      mutationFunction,
      attemptCount: 2,
      blockedCount: 2,
      successCount: 0,
      errorCode: "CC_DESKTOP_LEGACY_RUNTIME_READ_ONLY",
      evidenceDigest: DIGEST(String(index + 1)),
    }),
  );
}

function retirementEvidence(commitSha = COMMIT) {
  const unsigned = {
    schema: GRAPH_RETIREMENT_EVIDENCE_SCHEMA,
    surface: "desktop",
    entryId: "desktop-legacy-workflow",
    rolloutKey: RETIREMENT_CONTRACT.rolloutKey,
    manifestDigest: DIGEST("0"),
    commitSha,
    startedAt: "2030-01-01T00:00:00.000Z",
    endedAt: "2030-01-01T01:00:00.000Z",
    durationMs: 3_600_000,
    observationSampleCount: 24,
    activeLegacyRunCount: 0,
    legacyMutationSuccessCount: 0,
    replacementJourneys: GRAPH_CUTOVER_REQUIRED_PLATFORMS.map((platform) => ({
      replacementEntryId: "desktop-workflow-manager",
      productEntrypoint: RETIREMENT_CONTRACT.replacementEntrypoint,
      platform,
      commitSha,
      status: "passed",
      evidenceDigest: DIGEST(
        platform === "linux" ? "a" : platform === "macos" ? "b" : "c",
      ),
    })).sort((left, right) =>
      `${left.replacementEntryId}:${left.platform}`.localeCompare(
        `${right.replacementEntryId}:${right.platform}`,
      ),
    ),
    mutationProbes: mutationProbes(),
    historicalReadProbes: [
      {
        historicalReadFunction: "WorkflowEngine.getExecution",
        status: "passed",
        readCount: 2,
        mutationAttemptCount: 0,
        evidenceDigest: DIGEST("d"),
      },
    ],
  };
  return {
    ...unsigned,
    evidenceDigest: graphRetirementEvidenceDigest(unsigned),
  };
}

function legacyWriterObservation({ notBefore, commitSha = COMMIT } = {}) {
  const startedAt = new Date(Date.parse(notBefore) + 1_000).toISOString();
  const endedAt = new Date(Date.parse(notBefore) + 3_601_000).toISOString();
  const unsigned = {
    schema: GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA,
    surface: "desktop",
    entryId: "desktop-legacy-workflow",
    rolloutKey: RETIREMENT_CONTRACT.rolloutKey,
    manifestDigest: DIGEST("0"),
    commitSha,
    startedAt,
    endedAt,
    durationMs: 3_600_000,
    observationSampleCount: 24,
    activeLegacyRunCount: 0,
    legacyMutationSuccessCount: 0,
    writerObservations: RETIREMENT_CONTRACT.writerFiles.map(
      (writerFile, index) => ({
        writerFile,
        observationSampleCount: 12,
        mutationSuccessCount: 0,
        evidenceDigest: DIGEST(index === 0 ? "e" : "f"),
      }),
    ),
    mutationProbes: mutationProbes(),
  };
  return {
    ...unsigned,
    evidenceDigest: graphLegacyWriterObservationDigest(unsigned),
  };
}

function evidence(from, to, entry = {}) {
  if (from === "legacy" && to === "shadow") {
    return {
      inventoryDigest: DIGEST("0"),
      unknownWriterCount: 0,
      shadowEffectInvocationCount: 0,
    };
  }
  if (from === "shadow" && to === "canary") {
    return {
      shadowReportDigest: DIGEST("2"),
      shadowRunCount: 25,
      divergenceCount: 0,
      unknownEffectCount: 0,
      shadowEffectInvocationCount: 0,
      canaryPercent: 10,
      optInOnly: true,
    };
  }
  if (from === "canary" && to === "canonical") {
    return {
      canaryReportDigest: DIGEST("3"),
      canaryRunCount: 10,
      canaryFailureCount: 0,
      reconciliationCount: 0,
      migrationCutpoints: STORES.map((store, index) => ({
        store,
        cutpointDigest: DIGEST(String(index + 4)),
        recoveryReceiptDigest: DIGEST(String(index + 6)),
        rollbackDrillDigest: DIGEST(String(index + 8)),
        rpoLossCount: 0,
        recovered: true,
      })),
      platformEvidence: platformEvidence(),
      storeCoverageEvidence: storeCoverageEvidence(
        entry.surface,
        entry.entryId,
      ),
    };
  }
  return {
    writerInventoryDigest: DIGEST("6"),
    legacyWriterProbeDigest: DIGEST("7"),
    legacyWriterProbeCount: 0,
  };
}

describe("GraphCutoverLedger", () => {
  it("recovers the exact event head from a fresh durable store instance", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-graph-cutover-ledger-"),
    );
    try {
      let ledger = new GraphCutoverLedger({
        store: new JsonlRolloutStore({ directory }),
      });
      let state = ledger.begin({
        surface: "desktop",
        entryId: "desktop-workflow-manager",
        manifestDigest: DIGEST("0"),
        stores: STORES,
      });
      state = ledger.transition(
        "desktop",
        "desktop-workflow-manager",
        "shadow",
        evidence("legacy", "shadow"),
        { expectedEventHead: state.eventHead },
      );
      ledger = new GraphCutoverLedger({
        store: new JsonlRolloutStore({ directory }),
      });
      expect(
        ledger.recover("desktop", "desktop-workflow-manager"),
      ).toMatchObject({
        stage: "shadow",
        cutoverStrategy: "migrate",
        eventSeq: state.eventSeq,
        eventHead: state.eventHead,
        stores: [...STORES].sort(),
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retires process-local writers without inventing durable store migration", () => {
    const ledger = new GraphCutoverLedger({ store: new MemoryRolloutStore() });
    let state = ledger.begin({
      surface: "desktop",
      entryId: "desktop-legacy-workflow",
      manifestDigest: DIGEST("0"),
      stores: [],
      cutoverStrategy: "retire",
      retirementContract: RETIREMENT_CONTRACT,
    });
    state = ledger.transition(
      "desktop",
      "desktop-legacy-workflow",
      "shadow",
      evidence("legacy", "shadow"),
    );
    state = ledger.transition(
      "desktop",
      "desktop-legacy-workflow",
      "canary",
      evidence("shadow", "canary"),
    );
    expect(() =>
      ledger.transition(
        "desktop",
        "desktop-legacy-workflow",
        "canonical",
        evidence("canary", "canonical"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_RETIREMENT_EVIDENCE_INVALID" }),
    );
    const incompleteRetirementEvidence = retirementEvidence();
    incompleteRetirementEvidence.replacementJourneys.pop();
    incompleteRetirementEvidence.evidenceDigest = graphRetirementEvidenceDigest(
      incompleteRetirementEvidence,
    );
    expect(() =>
      ledger.transition("desktop", "desktop-legacy-workflow", "canonical", {
        canaryReportDigest: DIGEST("3"),
        canaryRunCount: 10,
        canaryFailureCount: 0,
        reconciliationCount: 0,
        retirementEvidence: incompleteRetirementEvidence,
        platformEvidence: platformEvidence(),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_RETIREMENT_REPLACEMENT_COVERAGE_INCOMPLETE",
      }),
    );
    state = ledger.transition(
      "desktop",
      "desktop-legacy-workflow",
      "canonical",
      {
        canaryReportDigest: DIGEST("3"),
        canaryRunCount: 10,
        canaryFailureCount: 0,
        reconciliationCount: 0,
        retirementEvidence: retirementEvidence(),
        platformEvidence: platformEvidence(),
      },
    );
    expect(state).toMatchObject({
      stage: "canonical",
      cutoverStrategy: "retire",
      stores: [],
      canonicalCommitSha: COMMIT,
    });
    const incompleteObservation = legacyWriterObservation({
      notBefore: state.updatedAt,
    });
    incompleteObservation.writerObservations.pop();
    incompleteObservation.evidenceDigest = graphLegacyWriterObservationDigest(
      incompleteObservation,
    );
    expect(() =>
      ledger.transition(
        "desktop",
        "desktop-legacy-workflow",
        "legacy_read_only",
        { legacyWriterObservation: incompleteObservation },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_RETIREMENT_WRITER_COVERAGE_INCOMPLETE",
      }),
    );
    state = ledger.transition(
      "desktop",
      "desktop-legacy-workflow",
      "legacy_read_only",
      {
        legacyWriterObservation: legacyWriterObservation({
          notBefore: state.updatedAt,
        }),
      },
    );
    expect(state.stage).toBe("legacy_read_only");
  });

  it("keeps disabled non-durable entries outside the rollout ladder", () => {
    const ledger = new GraphCutoverLedger({ store: new MemoryRolloutStore() });
    const state = ledger.begin({
      surface: "browser",
      entryId: "browser-workflow",
      manifestDigest: DIGEST("0"),
      stores: [],
      cutoverStrategy: "disabled",
    });
    expect(state).toMatchObject({
      stage: "legacy",
      cutoverStrategy: "disabled",
      stores: [],
    });
    expect(
      ledger.authorityMode("browser", "browser-workflow", {
        runKey: "disabled-run",
        optIn: true,
      }),
    ).toBe("legacy");
    expect(() =>
      ledger.transition(
        "browser",
        "browser-workflow",
        "shadow",
        evidence("legacy", "shadow"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_ENTRY_DISABLED" }),
    );
  });

  it("recovers every durable forward cut point through legacy read-only", () => {
    const store = new MemoryRolloutStore({ now: () => 1_800_000_000_000 });
    let ledger = new GraphCutoverLedger({
      store,
      now: () => 1_800_000_000_000,
    });
    let state = ledger.begin({
      surface: "desktop",
      entryId: "desktop-specialized-agents",
      manifestDigest: DIGEST("0"),
      stores: STORES,
    });
    for (const stage of ["shadow", "canary", "canonical", "legacy_read_only"]) {
      ledger = new GraphCutoverLedger({
        store,
        now: () => 1_800_000_000_000,
      });
      const recovered = ledger.recover("desktop", "desktop-specialized-agents");
      expect(recovered).toMatchObject({
        stage: state.stage,
        eventHead: state.eventHead,
      });
      state = ledger.transition(
        "desktop",
        "desktop-specialized-agents",
        stage,
        evidence(state.stage, stage),
        { expectedEventHead: state.eventHead },
      );
    }
    expect(state).toMatchObject({
      stage: "legacy_read_only",
      canaryPercent: 100,
      transitionCount: 4,
      rollbackCount: 0,
    });
    expect(state.lastEvidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("fails closed on shadow effects, divergence, and mixed platform SHAs", () => {
    const ledger = new GraphCutoverLedger({ store: new MemoryRolloutStore() });
    const initial = ledger.begin({
      surface: "cowork",
      entryId: "cli-cowork",
      manifestDigest: DIGEST("0"),
      stores: STORES,
    });
    expect(() =>
      ledger.transition("cowork", "cli-cowork", "shadow", {
        ...evidence("legacy", "shadow"),
        inventoryDigest: DIGEST("1"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_CUTOVER_MANIFEST_EVIDENCE_MISMATCH",
      }),
    );
    expect(() =>
      ledger.transition("cowork", "cli-cowork", "shadow", {
        ...evidence("legacy", "shadow"),
        shadowEffectInvocationCount: 1,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_GATE_FAILED" }),
    );
    expect(ledger.recover("cowork", "cli-cowork").eventHead).toBe(
      initial.eventHead,
    );
    ledger.transition(
      "cowork",
      "cli-cowork",
      "shadow",
      evidence("legacy", "shadow"),
    );
    expect(() =>
      ledger.transition("cowork", "cli-cowork", "canary", {
        ...evidence("shadow", "canary"),
        divergenceCount: 1,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_GATE_FAILED" }),
    );
    ledger.transition(
      "cowork",
      "cli-cowork",
      "canary",
      evidence("shadow", "canary"),
    );
    expect(() =>
      ledger.transition("cowork", "cli-cowork", "canonical", {
        ...evidence("canary", "canonical", {
          surface: "cowork",
          entryId: "cli-cowork",
        }),
        migrationCutpoints: evidence(
          "canary",
          "canonical",
        ).migrationCutpoints.slice(1),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_CUTOVER_MIGRATION_EVIDENCE_INCOMPLETE",
      }),
    );
    const mixed = platformEvidence();
    mixed[0].commitSha = "b".repeat(40);
    expect(() =>
      ledger.transition("cowork", "cli-cowork", "canonical", {
        ...evidence("canary", "canonical", {
          surface: "cowork",
          entryId: "cli-cowork",
        }),
        platformEvidence: mixed,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_SHA_MISMATCH" }),
    );
    expect(ledger.recover("cowork", "cli-cowork").stage).toBe("canary");
  });

  it("accepts the exact-SHA real journey evidence schema", () => {
    const ledger = new GraphCutoverLedger({ store: new MemoryRolloutStore() });
    ledger.begin({
      surface: "desktop",
      entryId: "desktop-team",
      manifestDigest: DIGEST("0"),
      stores: STORES,
    });
    ledger.transition(
      "desktop",
      "desktop-team",
      "shadow",
      evidence("legacy", "shadow"),
    );
    ledger.transition(
      "desktop",
      "desktop-team",
      "canary",
      evidence("shadow", "canary"),
    );
    const incomplete = realJourneyPlatformEvidence();
    incomplete[0].evidenceDigest = null;
    expect(() =>
      ledger.transition("desktop", "desktop-team", "canonical", {
        ...evidence("canary", "canonical", {
          surface: "desktop",
          entryId: "desktop-team",
        }),
        platformEvidence: incomplete,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_CUTOVER_PLATFORM_EVIDENCE_REQUIRED",
      }),
    );
    const incompleteStoreMatrix = storeCoverageEvidence(
      "desktop",
      "desktop-team",
    );
    incompleteStoreMatrix.entries[0].platformCoverage[0].missingPlatforms = [
      "linux",
    ];
    incompleteStoreMatrix.entries[0].platformCoverage[0].complete = false;
    delete incompleteStoreMatrix.evidenceDigest;
    incompleteStoreMatrix.evidenceDigest = graphStoreEvidenceDigest(
      incompleteStoreMatrix,
    );
    expect(() =>
      ledger.transition("desktop", "desktop-team", "canonical", {
        ...evidence("canary", "canonical", {
          surface: "desktop",
          entryId: "desktop-team",
        }),
        platformEvidence: realJourneyPlatformEvidence(),
        storeCoverageEvidence: incompleteStoreMatrix,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_CUTOVER_STORE_MATRIX_INCOMPLETE",
      }),
    );
    const canonical = ledger.transition(
      "desktop",
      "desktop-team",
      "canonical",
      {
        ...evidence("canary", "canonical", {
          surface: "desktop",
          entryId: "desktop-team",
        }),
        platformEvidence: realJourneyPlatformEvidence(),
      },
    );
    expect(canonical).toMatchObject({
      stage: "canonical",
      canaryPercent: 100,
    });
  });

  it("rolls new runs back without transferring existing canonical runs", () => {
    const ledger = new GraphCutoverLedger({ store: new MemoryRolloutStore() });
    let state = ledger.begin({
      surface: "scheduler",
      entryId: "cli-scheduler",
      manifestDigest: DIGEST("0"),
      stores: STORES,
    });
    state = ledger.transition(
      "scheduler",
      "cli-scheduler",
      "shadow",
      evidence("legacy", "shadow"),
    );
    state = ledger.transition(
      "scheduler",
      "cli-scheduler",
      "canary",
      evidence("shadow", "canary"),
    );
    expect(
      ledger.authorityMode("scheduler", "cli-scheduler", {
        runKey: "occurrence-opted-out",
      }),
    ).toBe("shadow");
    expect(
      ledger.authorityMode("scheduler", "cli-scheduler", {
        runKey: "occurrence-opted-in",
        optIn: true,
      }),
    ).toBe("canonical");
    expect(
      ["shadow", "canonical"].includes(
        ledger.authorityMode("scheduler", "cli-scheduler", {
          runKey: "occurrence-1",
        }),
      ),
    ).toBe(true);
    state = ledger.transition(
      "scheduler",
      "cli-scheduler",
      "canonical",
      evidence("canary", "canonical", {
        surface: "scheduler",
        entryId: "cli-scheduler",
      }),
    );
    expect(
      ledger.authorityMode("scheduler", "cli-scheduler", {
        runKey: "occurrence-1",
      }),
    ).toBe("canonical");
    expect(() =>
      ledger.transition("scheduler", "cli-scheduler", "canary", {
        incidentDigest: DIGEST("8"),
        activeDispatchCount: 0,
        existingCanonicalRunsRetained: false,
        canaryPercent: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_ROLLBACK_UNSAFE" }),
    );
    state = ledger.transition("scheduler", "cli-scheduler", "canary", {
      incidentDigest: DIGEST("8"),
      activeDispatchCount: 0,
      existingCanonicalRunsRetained: true,
      canaryPercent: 0,
    });
    expect(state).toMatchObject({
      stage: "canary",
      canaryPercent: 0,
      rollbackCount: 1,
    });
    expect(
      ledger.authorityMode("scheduler", "cli-scheduler", {
        runKey: "new-occurrence",
      }),
    ).toBe("shadow");
  });

  it("rejects a stale operator head after another process advances", () => {
    const store = new MemoryRolloutStore();
    const first = new GraphCutoverLedger({ store });
    const second = new GraphCutoverLedger({ store });
    const stale = first.begin({
      surface: "cli_team",
      entryId: "cli-team-local",
      manifestDigest: DIGEST("0"),
      stores: STORES,
    });
    first.transition(
      "cli_team",
      "cli-team-local",
      "shadow",
      evidence("legacy", "shadow"),
      { expectedEventHead: stale.eventHead },
    );
    expect(() =>
      second.transition(
        "cli_team",
        "cli-team-local",
        "shadow",
        evidence("legacy", "shadow"),
        { expectedEventHead: stale.eventHead },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_HEAD_CONFLICT" }),
    );
  });
});
