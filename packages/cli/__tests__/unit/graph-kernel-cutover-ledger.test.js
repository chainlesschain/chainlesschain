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

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const COMMIT = "a".repeat(40);
const STORES = ["DesktopGraphRunRegistry", "GraphEventStore"];

function platformEvidence(commitSha = COMMIT) {
  return GRAPH_CUTOVER_REQUIRED_PLATFORMS.map((platform) => ({
    platform,
    commitSha,
    passed: true,
  }));
}

function evidence(from, to) {
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
        eventSeq: state.eventSeq,
        eventHead: state.eventHead,
        stores: [...STORES].sort(),
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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
        ...evidence("canary", "canonical"),
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
        ...evidence("canary", "canonical"),
        platformEvidence: mixed,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_SHA_MISMATCH" }),
    );
    expect(ledger.recover("cowork", "cli-cowork").stage).toBe("canary");
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
      evidence("canary", "canonical"),
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
