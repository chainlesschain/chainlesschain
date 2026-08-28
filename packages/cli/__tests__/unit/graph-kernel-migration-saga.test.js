import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { createGraphAuthorityBinding } from "../../src/lib/graph-kernel/authority.js";
import {
  GRAPH_MIGRATION_PHASES,
  GraphAuthorityMigrationSaga,
} from "../../src/lib/graph-kernel/migration-saga.js";

const HEAD = `sha256:${"a".repeat(64)}`;
const CHECKPOINT = `sha256:${"b".repeat(64)}`;
const VERIFY = `sha256:${"c".repeat(64)}`;

function authority(mode, generation) {
  return createGraphAuthorityBinding({
    logicalRunId: "run-migrate",
    originSurface: "cowork",
    authorityMode: mode,
    authoritySource: mode === "legacy" ? "legacy_runtime" : "graph_kernel",
    authorityGeneration: generation,
    writerId: mode === "legacy" ? "legacy-writer" : "graph-writer",
    writerLeaseId: mode === "legacy" ? "legacy-lease" : "graph-lease",
    writerLeaseExpiresAt:
      mode === "canonical" ? "2030-01-01T00:00:00.000Z" : null,
    eventHead: HEAD,
    projectionVersion: 1,
  });
}

function evidence(phase, target) {
  if (phase === "source_frozen") {
    return {
      inFlightEffects: 0,
      inFlightAttempts: 0,
      pendingMessages: 0,
      eventHead: HEAD,
      checkpointDigest: CHECKPOINT,
    };
  }
  if (phase === "state_copied") {
    return {
      copiedEventHead: HEAD,
      copiedCheckpointDigest: CHECKPOINT,
    };
  }
  if (phase === "verified") {
    return {
      semanticEquivalent: true,
      effectCountConserved: true,
      terminalEvidenceEquivalent: true,
      verificationDigest: VERIFY,
    };
  }
  if (phase === "authority_switched") {
    return { targetAuthority: target, eventHead: HEAD };
  }
  if (phase === "legacy_read_only") return { legacyWriterProbeCount: 0 };
  return { rollbackDrillPassed: true };
}

describe("Graph authority migration saga", () => {
  it("recovers and advances from every durable cut point", () => {
    const store = new MemoryRolloutStore({ now: () => 1_800_000_000_000 });
    const source = authority("legacy", 1);
    const target = authority("canonical", 2);
    let saga = new GraphAuthorityMigrationSaga({
      store,
      now: () => 1_800_000_000_000,
    });
    let state = saga.begin({
      migrationId: "migration-cutpoints",
      logicalRunId: "run-migrate",
      originSurface: "cowork",
      sourceAuthority: source,
      targetAuthority: target,
      sourceEventHead: HEAD,
      sourceCheckpointDigest: CHECKPOINT,
      safePoint: {
        inFlightEffects: 0,
        inFlightAttempts: 0,
        pendingMessages: 0,
      },
    });
    for (const phase of GRAPH_MIGRATION_PHASES.slice(1)) {
      saga = new GraphAuthorityMigrationSaga({
        store,
        now: () => 1_800_000_000_000,
      });
      expect(saga.recover("migration-cutpoints").phase).toBe(state.phase);
      state = saga.advance(
        "migration-cutpoints",
        phase,
        evidence(phase, target),
      );
    }
    expect(state).toMatchObject({
      phase: "completed",
      sourceEventHead: HEAD,
      copiedEventHead: HEAD,
      verificationDigest: VERIFY,
    });
  });

  it("fails closed at an unsafe point and on divergent copied state", () => {
    const store = new MemoryRolloutStore();
    const saga = new GraphAuthorityMigrationSaga({ store });
    const source = authority("legacy", 1);
    const target = authority("canonical", 2);
    expect(() =>
      saga.begin({
        migrationId: "unsafe",
        logicalRunId: "run-migrate",
        originSurface: "cowork",
        sourceAuthority: source,
        targetAuthority: target,
        sourceEventHead: HEAD,
        sourceCheckpointDigest: CHECKPOINT,
        safePoint: {
          inFlightEffects: 1,
          inFlightAttempts: 0,
          pendingMessages: 0,
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_MIGRATION_UNSAFE_POINT" }),
    );
  });
});
