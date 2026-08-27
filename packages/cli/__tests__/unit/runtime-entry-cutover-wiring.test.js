import { describe, expect, it, vi } from "vitest";
import { distributedGraphAuthorityMode } from "../../src/commands/team-distributed.js";
import { teamGraphAuthorityMode } from "../../src/commands/team.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { GraphCutoverAuthorityResolver } from "../../src/lib/graph-kernel/cutover-authority-resolver.js";
import { GraphCutoverLedger } from "../../src/lib/graph-kernel/cutover-ledger.js";
import { loadGraphRuntimeSurfaceManifest } from "../../src/lib/graph-kernel/runtime-surface-manifest.js";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;

describe("runtime entry cutover wiring", () => {
  it("routes a new local Team run with its stable run key", () => {
    const resolver = vi.fn(() => ({ mode: "canonical" }));
    expect(
      teamGraphAuthorityMode(
        { exec: true },
        { CHAINLESSCHAIN_GRAPH_CLI_TEAM: "legacy" },
        { runKey: "team:stable-run", optIn: true, resolver },
      ),
    ).toBe("canonical");
    expect(resolver).toHaveBeenCalledWith({
      runKey: "team:stable-run",
      optIn: true,
    });
  });

  it("routes only distributed queue creation and preserves pinned authority", () => {
    const resolver = vi.fn(() => ({ mode: "shadow" }));
    expect(
      distributedGraphAuthorityMode(
        "legacy",
        {},
        { runKey: "queue-run-1", resolver },
      ),
    ).toBe("shadow");
    expect(resolver).toHaveBeenCalledWith({
      runKey: "queue-run-1",
      optIn: false,
    });
    expect(
      distributedGraphAuthorityMode(
        "canonical",
        {},
        {
          resolveCutover: false,
        },
      ),
    ).toBe("canonical");
    expect(
      distributedGraphAuthorityMode(
        "shadow",
        {},
        {
          resolveCutover: false,
        },
      ),
    ).toBe("shadow");
  });

  it("drills every managed entry through shadow, opt-in canary, and rollback", () => {
    const manifest = loadGraphRuntimeSurfaceManifest();
    const ledger = new GraphCutoverLedger({
      store: new MemoryRolloutStore({ now: () => 1_800_000_000_000 }),
      now: () => 1_800_000_000_000,
    });
    const entries = manifest.surfaces
      .filter((surface) => surface.durability === "durable")
      .flatMap((surface) =>
        surface.entries.map((entry) => ({
          surface: surface.originSurface,
          entryId: entry.id,
          cutoverStrategy: entry.cutoverStrategy,
          stores:
            entry.cutoverStrategy === "migrate"
              ? [...entry.storeDispositions.migrate].sort()
              : [],
        })),
      );

    expect(entries).toHaveLength(9);
    expect(
      entries.filter((entry) => entry.cutoverStrategy === "migrate"),
    ).toHaveLength(7);
    expect(
      entries.filter((entry) => entry.cutoverStrategy === "retire"),
    ).toHaveLength(2);
    for (const entry of entries) {
      const resolver = new GraphCutoverAuthorityResolver({
        ...entry,
        ledger,
        manifest,
      });
      let state = resolver.begin();
      expect(state).toMatchObject({
        stage: "legacy",
        stores: entry.stores,
        cutoverStrategy: entry.cutoverStrategy,
      });

      state = ledger.transition(entry.surface, entry.entryId, "shadow", {
        inventoryDigest: resolver.manifestDigest,
        unknownWriterCount: 0,
        shadowEffectInvocationCount: 0,
      });
      expect(
        resolver.resolve({ runKey: `${entry.entryId}:run` }),
      ).toMatchObject({
        mode: "shadow",
        eventHead: state.eventHead,
      });

      state = ledger.transition(entry.surface, entry.entryId, "canary", {
        shadowReportDigest: DIGEST("a"),
        shadowRunCount: 1,
        divergenceCount: 0,
        unknownEffectCount: 0,
        shadowEffectInvocationCount: 0,
        canaryPercent: 1,
        optInOnly: true,
      });
      expect(
        resolver.resolve({ runKey: `${entry.entryId}:run`, optIn: false }).mode,
      ).toBe("shadow");
      expect(
        resolver.resolve({ runKey: `${entry.entryId}:run`, optIn: true }).mode,
      ).toBe("canonical");

      state = ledger.transition(entry.surface, entry.entryId, "shadow", {
        incidentDigest: DIGEST("b"),
        activeDispatchCount: 0,
        existingCanonicalRunsRetained: true,
      });
      expect(state).toMatchObject({ stage: "shadow", rollbackCount: 1 });
      expect(resolver.resolve({ runKey: `${entry.entryId}:run` }).mode).toBe(
        "shadow",
      );
    }
  });
});
