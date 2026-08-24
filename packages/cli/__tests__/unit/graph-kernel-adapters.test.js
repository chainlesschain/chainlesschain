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
    authoritative: false,
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

  it("permits only one authoritative writer", () => {
    const registry = new GraphRuntimeAdapterRegistry();
    registry.register({
      runtimeClaims: () => claims("cli_team", { authoritative: true }),
    });
    expect(() =>
      registry.register({
        runtimeClaims: () => claims("cowork", { authoritative: true }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_MULTIPLE_AUTHORITATIVE_WRITERS",
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
