import { describe, expect, it } from "vitest";
import {
  GraphRuntimeAdapterRegistry,
  assertGraphKernelCutover,
  assertRuntimeTerminalSuccess,
  compareGraphRuntimeShadow,
} from "../../src/lib/graph-kernel/adapters.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const surfaces = ["cli_team", "cowork", "scheduler", "desktop", "browser"];

function claims(surface, overrides = {}) {
  return {
    surface,
    execution: "real",
    persistence: surface === "browser" ? "non_durable" : "durable",
    isolated: true,
    terminalEvidence: true,
    authorityModes:
      surface === "browser"
        ? ["legacy", "shadow"]
        : ["legacy", "shadow", "canonical"],
    featureGated: surface === "browser",
    ...overrides,
  };
}

function projection(surface, events) {
  return {
    surface,
    status: "succeeded",
    terminalEvidence: {
      status: "succeeded",
      eventDigest: DIGEST,
      outputDigest: DIGEST,
      testReceiptIds: ["test-1"],
    },
    artifacts: [{ id: "artifact-1", digest: DIGEST }],
    events,
  };
}

describe("Graph runtime adapter migration contracts", () => {
  it("publishes claims for every legacy surface while fencing browser durability", () => {
    const registry = new GraphRuntimeAdapterRegistry();
    for (const surface of surfaces) {
      registry.register({ runtimeClaims: () => claims(surface) });
    }
    expect(
      registry
        .listClaims()
        .map((item) => item.surface)
        .sort(),
    ).toEqual([...surfaces].sort());
    expect(() =>
      new GraphRuntimeAdapterRegistry().register({
        runtimeClaims: () =>
          claims("browser", {
            persistence: "durable",
            restartHydration: false,
            featureGated: false,
          }),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_ADAPTER_CLAIMS_INVALID" }),
    );
  });

  it("binds authority per logical run instead of globally per surface", () => {
    const registry = new GraphRuntimeAdapterRegistry();
    registry.register({
      runtimeClaims: () => claims("cli_team"),
    });
    registry.register({
      runtimeClaims: () => claims("cowork"),
    });
    const lease = {
      logicalRunId: "run-1",
      authorityMode: "canonical",
      authorityGeneration: 1,
      writerId: "writer-cli",
      writerLeaseId: "lease-cli",
      writerLeaseExpiresAt: "2030-01-01T00:00:00.000Z",
      eventHead: null,
      projectionVersion: 1,
    };
    expect(registry.bindRunAuthority("cli_team", lease)).toMatchObject({
      logicalRunId: "run-1",
      originSurface: "cli_team",
      authoritySource: "graph_kernel",
    });
    expect(
      registry.bindRunAuthority("cowork", {
        ...lease,
        logicalRunId: "run-2",
        writerId: "writer-cowork",
        writerLeaseId: "lease-cowork",
      }),
    ).toMatchObject({ logicalRunId: "run-2", originSurface: "cowork" });
    expect(() =>
      registry.bindRunAuthority("cowork", {
        ...lease,
        writerId: "writer-cowork",
        writerLeaseId: "lease-cowork",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_MULTIPLE_AUTHORITATIVE_WRITERS",
      }),
    );
  });

  it("does not let static claims or a non-durable browser acquire authority", () => {
    expect(() =>
      new GraphRuntimeAdapterRegistry().register({
        runtimeClaims: () => claims("cli_team", { authoritative: true }),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_ADAPTER_CLAIMS_INVALID" }),
    );
    const registry = new GraphRuntimeAdapterRegistry();
    registry.register({
      runtimeClaims: () => claims("browser"),
    });
    expect(() =>
      registry.bindRunAuthority("browser", {
        logicalRunId: "browser-run",
        authorityMode: "canonical",
        authorityGeneration: 1,
        writerId: "browser-writer",
        writerLeaseId: "browser-lease",
        writerLeaseExpiresAt: "2030-01-01T00:00:00.000Z",
        eventHead: null,
        projectionVersion: 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_AUTHORITY_MODE_UNSUPPORTED",
      }),
    );
  });

  it.each(surfaces)(
    "finds causal equivalence for %s despite event reordering",
    (surface) => {
      const first = {
        type: "item.completed",
        itemId: "item-1",
        causationId: "turn-1",
        status: "completed",
      };
      const second = {
        type: "turn.completed",
        itemId: null,
        causationId: "item-1",
        status: "completed",
      };
      const report = compareGraphRuntimeShadow(
        projection(surface, [first, second]),
        projection(surface, [second, first]),
      );
      expect(report).toMatchObject({
        surface,
        equivalent: true,
        terminalEquivalent: true,
        causalEquivalent: true,
      });
    },
  );

  it("rejects phantom success and blocks cutover until rollback and writer cleanup", () => {
    expect(() =>
      assertRuntimeTerminalSuccess({
        status: "succeeded",
        terminalEvidence: { status: "succeeded", eventDigest: DIGEST },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_TERMINAL_EVIDENCE_REQUIRED" }),
    );
    const reports = surfaces.map((surface) =>
      compareGraphRuntimeShadow(
        projection(surface, []),
        projection(surface, []),
      ),
    );
    expect(() =>
      assertGraphKernelCutover(reports, {
        rollbackVerified: true,
        legacyWriteEntrypoints: ["workflow.complete"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_LEGACY_WRITERS_REMAIN" }),
    );
    expect(
      assertGraphKernelCutover(reports, {
        rollbackVerified: true,
        legacyWriteEntrypoints: [],
      }),
    ).toMatchObject({ ready: true });
  });
});
