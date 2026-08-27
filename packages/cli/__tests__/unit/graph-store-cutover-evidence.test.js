import { describe, expect, it } from "vitest";
import {
  createGraphStoreCutoverEvidence,
  graphStoreCutoverCoverage,
  normalizeGraphStoreCutoverEvidence,
} from "../../src/lib/graph-kernel/store-cutover-evidence.js";
import { loadGraphRuntimeSurfaceManifest } from "../../src/lib/graph-kernel/runtime-surface-manifest.js";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;

function store(surface, entryId, store, character) {
  return {
    surface,
    entryId,
    store,
    cutpointDigest: DIGEST(character),
    recoveryReceiptDigest: DIGEST(character),
    rollbackDrillDigest: DIGEST(character),
    rpoLossCount: 0,
    recovered: true,
  };
}

function packagedEvidence(commitSha = "a".repeat(40)) {
  return createGraphStoreCutoverEvidence({
    source: "desktop_packaged_electron",
    commitSha,
    platform: "windows",
    stores: [
      store(
        "desktop",
        "desktop-workflow-manager",
        "desktop_graph_run_bindings",
        "a",
      ),
      store("desktop", "desktop-workflow-manager", "GraphEventStore", "b"),
      store(
        "desktop",
        "desktop-workflow-manager",
        "AppServerGraphRequestReceipt",
        "c",
      ),
      store(
        "desktop",
        "desktop-workflow-manager",
        "AppServerGraphExecutorReceipt",
        "d",
      ),
      store("desktop", "desktop-team", "GraphEventStore", "e"),
      store("desktop", "desktop-team", "AppServerGraphRequestReceipt", "f"),
      store("desktop", "desktop-team", "AppServerGraphExecutorReceipt", "1"),
      store(
        "desktop",
        "desktop-specialized-agents",
        "desktop_graph_run_bindings",
        "2",
      ),
      store("desktop", "desktop-specialized-agents", "GraphEventStore", "3"),
      store(
        "desktop",
        "desktop-specialized-agents",
        "AppServerGraphRequestReceipt",
        "4",
      ),
      store(
        "desktop",
        "desktop-specialized-agents",
        "AppServerGraphExecutorReceipt",
        "5",
      ),
    ],
    sourceReceipts: {
      writerCutpointDigest: DIGEST("1"),
      recoveryReceiptDigest: DIGEST("2"),
      rollbackReceiptDigest: DIGEST("3"),
    },
  });
}

describe("Graph store cutover evidence", () => {
  it("normalizes a real store receipt envelope and detects tampering", () => {
    const evidence = packagedEvidence();
    expect(normalizeGraphStoreCutoverEvidence(evidence)).toEqual(evidence);
    expect(() =>
      normalizeGraphStoreCutoverEvidence({
        ...evidence,
        stores: evidence.stores.map((entry, index) =>
          index === 0 ? { ...entry, rpoLossCount: 1 } : entry,
        ),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_STORE_EVIDENCE_RPO_FAILED" }),
    );
    expect(() =>
      normalizeGraphStoreCutoverEvidence({
        ...evidence,
        sourceReceipts: {
          ...evidence.sourceReceipts,
          recoveryReceiptDigest: DIGEST("9"),
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_STORE_EVIDENCE_TAMPERED" }),
    );
  });

  it("reports partial store coverage without promoting an incomplete entry", () => {
    const coverage = graphStoreCutoverCoverage(
      loadGraphRuntimeSurfaceManifest(),
      [packagedEvidence()],
    );
    expect(coverage).toMatchObject({
      evidenceRecordCount: 1,
      migratableEntryCount: 7,
      completeEntryCount: 0,
      storeSlotCount: 20,
      coveredStoreSlotCount: 11,
      missingStoreSlotCount: 9,
      completeStoreSlotCount: 0,
      incompletePlatformStoreSlotCount: 20,
      platformStoreSlotCount: 60,
      coveredPlatformStoreSlotCount: 11,
      missingPlatformStoreSlotCount: 49,
    });
    expect(
      coverage.entries.find((entry) => entry.entryId === "desktop-team"),
    ).toMatchObject({
      coveredStores: [
        "AppServerGraphExecutorReceipt",
        "AppServerGraphRequestReceipt",
        "GraphEventStore",
      ],
      missingStores: ["SessionStateManager"],
      complete: false,
    });
    expect(
      coverage.entries.find(
        (entry) => entry.entryId === "desktop-workflow-manager",
      ),
    ).toMatchObject({
      missingStores: [],
      incompletePlatformStores: [
        {
          store: "AppServerGraphExecutorReceipt",
          missingPlatforms: ["linux", "macos"],
        },
        {
          store: "AppServerGraphRequestReceipt",
          missingPlatforms: ["linux", "macos"],
        },
        {
          store: "GraphEventStore",
          missingPlatforms: ["linux", "macos"],
        },
        {
          store: "desktop_graph_run_bindings",
          missingPlatforms: ["linux", "macos"],
        },
      ],
      complete: false,
    });
  });

  it("requires every store receipt on Linux, Windows, and macOS", () => {
    const manifest = loadGraphRuntimeSurfaceManifest();
    const stores = manifest.surfaces
      .flatMap((surface) =>
        surface.entries.flatMap((entry) =>
          entry.storeDispositions.migrate.map((name) => ({
            surface: surface.originSurface,
            entryId: entry.id,
            name,
          })),
        ),
      )
      .map(({ surface, entryId, name }, index) =>
        store(surface, entryId, name, String((index % 9) + 1)),
      );
    const evidence = ["linux", "win32", "darwin"].map((platform) =>
      createGraphStoreCutoverEvidence({
        source: `all_stores_${platform}`,
        commitSha: "c".repeat(40),
        platform,
        stores,
        sourceReceipts: { journey: DIGEST("f") },
      }),
    );
    const coverage = graphStoreCutoverCoverage(manifest, evidence);
    expect(coverage).toMatchObject({
      requiredPlatforms: ["linux", "macos", "windows"],
      completeEntryCount: 7,
      completeStoreSlotCount: 20,
      incompletePlatformStoreSlotCount: 0,
      platformStoreSlotCount: 60,
      coveredPlatformStoreSlotCount: 60,
      missingPlatformStoreSlotCount: 0,
    });
  });

  it("refuses to aggregate store receipts from different commits", () => {
    expect(() =>
      graphStoreCutoverCoverage(loadGraphRuntimeSurfaceManifest(), [
        packagedEvidence("a".repeat(40)),
        packagedEvidence("b".repeat(40)),
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_STORE_EVIDENCE_SHA_MISMATCH" }),
    );
  });
});
