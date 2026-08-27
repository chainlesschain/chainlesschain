import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GraphRunAuthorityRegistry,
  assertGraphAuthorityWriter,
  assertGraphCutoverTransition,
  createGraphAuthorityBinding,
} from "../../src/lib/graph-kernel/authority.js";
import {
  discoverUnclassifiedRuntimeWriters,
  loadGraphRuntimeSurfaceManifest,
  validateGraphRuntimeSurfaceManifest,
} from "../../src/lib/graph-kernel/runtime-surface-manifest.js";
import { compileGraphDefinition } from "../../src/lib/graph-kernel/compiler.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import {
  GRAPH_CUTOVER_LEDGER_SCHEMA,
  GRAPH_CUTOVER_REQUIRED_PLATFORMS,
} from "../../src/lib/graph-kernel/cutover-ledger.js";

const EXPIRY = "2030-01-01T00:00:00.000Z";
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");

function binding(overrides = {}) {
  return createGraphAuthorityBinding({
    logicalRunId: "run-1",
    originSurface: "cli_team",
    authorityMode: "canonical",
    authoritySource: "graph_kernel",
    authorityGeneration: 1,
    writerId: "writer-1",
    writerLeaseId: "lease-1",
    writerLeaseExpiresAt: EXPIRY,
    eventHead: null,
    projectionVersion: 1,
    ...overrides,
  });
}

function compiledGraph() {
  return compileGraphDefinition({
    schemaVersion: 1,
    id: "authority-test",
    revision: 1,
    nodes: [
      {
        id: "only",
        kind: "task",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass: "none",
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: 2 },
    allowedCapabilities: [],
  });
}

describe("GraphRun authority and writer inventory", () => {
  it("publishes a complete machine-readable five-surface inventory", () => {
    const manifest = loadGraphRuntimeSurfaceManifest();
    expect(validateGraphRuntimeSurfaceManifest(manifest)).toMatchObject({
      valid: true,
      surfaceCount: 5,
      entryCount: 23,
      migratableEntryCount: 7,
      retirementEntryCount: 13,
      disabledEntryCount: 3,
      errors: [],
    });
    expect(discoverUnclassifiedRuntimeWriters(manifest)).toEqual([]);
    expect(manifest.cutoverPolicy).toEqual({
      ledgerSchema: GRAPH_CUTOVER_LEDGER_SCHEMA,
      scope: "entry",
      requiredPlatforms: [...GRAPH_CUTOVER_REQUIRED_PLATFORMS],
      existingCanonicalRunRollback: "retain_authority",
    });
    const entries = manifest.surfaces.flatMap((surface) => surface.entries);
    expect(new Set(entries.map((entry) => entry.rolloutKey)).size).toBe(23);
    expect(
      entries.find((entry) => entry.id === "desktop-specialized-agents"),
    ).toMatchObject({
      runtimeDurability: "durable",
      cutoverStrategy: "migrate",
      stores: expect.arrayContaining([
        "agent_task_history",
        "desktop_graph_run_bindings",
        "GraphEventStore",
      ]),
      recoveryEntrypoints: expect.arrayContaining([
        "agents:get-task-status",
        "agents:cancel-task",
        "agents:reconcile-task",
      ]),
    });
    expect(
      entries
        .filter((entry) => entry.cutoverStrategy === "retire")
        .map((entry) => entry.id),
    ).toEqual([
      "cli-legacy-autonomous",
      "cli-legacy-orchestrate",
      "desktop-legacy-ai-engine",
      "desktop-autonomous-agent",
      "desktop-legacy-cowork-team",
      "desktop-long-running-task",
      "desktop-dev-pipeline",
      "desktop-autonomous-ops",
      "desktop-hybrid-executor",
      "desktop-p2p-agent",
      "desktop-legacy-multi-agent",
      "desktop-legacy-workflow",
      "desktop-skill-workflow",
    ]);
    for (const entry of entries.filter(
      (candidate) => candidate.cutoverStrategy === "retire",
    )) {
      expect(entry).toMatchObject({
        replacementEntrypoint: expect.any(String),
        replacementAuthoritySource: "graph_kernel",
        retiredStoreAccess: "historical_read_only",
      });
      expect(entry.replacementEntrypoint.trim()).not.toBe("");
      const writerSource = entry.writerFiles
        .map((file) =>
          fs.readFileSync(path.resolve(REPOSITORY_ROOT, file), "utf8"),
        )
        .join("\n");
      for (const mutationFunction of entry.mutationFunctions) {
        expect(writerSource, `${entry.id}/${mutationFunction}`).toContain(
          `"${mutationFunction}"`,
        );
      }
    }
    for (const entry of entries.filter(
      (candidate) => candidate.cutoverStrategy === "disabled",
    )) {
      const writerSource = entry.writerFiles
        .map((file) =>
          fs.readFileSync(path.resolve(REPOSITORY_ROOT, file), "utf8"),
        )
        .join("\n");
      for (const mutationFunction of entry.mutationFunctions) {
        expect(writerSource, `${entry.id}/${mutationFunction}`).toContain(
          `"${mutationFunction}"`,
        );
      }
    }
    expect(manifest.discovery.classifiedNonWriters).toEqual([
      expect.objectContaining({
        classification: "canonical_agent_kernel_adapter",
        files: expect.arrayContaining([
          "packages/cli/src/gateways/ws/ws-agent-handler.js",
          "packages/cli/src/gateways/ws/session-protocol.js",
        ]),
      }),
      expect.objectContaining({
        classification: "tool_free_advisor",
        files: ["packages/cli/src/lib/advisor-runtime.js"],
      }),
      expect.objectContaining({
        classification: "durable_event_transport",
        files: ["packages/cli/src/lib/event-runtime-host.js"],
      }),
    ]);
    expect(
      entries.find((entry) => entry.id === "desktop-autonomous-agent"),
    ).toMatchObject({
      runtimeDurability: "durable",
      cutoverStrategy: "retire",
      recoveryEntrypoints: [],
      storeDispositions: {
        migrate: [],
        retire: expect.arrayContaining([
          "autonomous_goals",
          "autonomous_task_queue",
        ]),
      },
    });
    expect(
      entries.find((entry) => entry.id === "desktop-workflow-manager"),
    ).toMatchObject({
      stores: expect.arrayContaining([
        "desktop_graph_run_bindings",
        "GraphEventStore",
      ]),
      recoveryEntrypoints: expect.arrayContaining([
        "workflow:get-status",
        "workflow:cancel",
        "workflow:reconcile",
      ]),
    });
    expect(entries.find((entry) => entry.id === "desktop-team")).toMatchObject({
      stores: expect.arrayContaining([
        "SessionStateManager",
        "SubRuntimePool",
        "GraphEventStore",
      ]),
      storeDispositions: {
        migrate: expect.arrayContaining([
          "SessionStateManager",
          "GraphEventStore",
        ]),
        retire: ["SubRuntimePool"],
        rebuild: [],
        disabled: [],
      },
    });
  });

  it("fences a second writer in the same generation and stale replacement", () => {
    const registry = new GraphRunAuthorityRegistry({
      now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    });
    registry.bind(binding());
    expect(() =>
      registry.bind(
        binding({ writerId: "writer-2", writerLeaseId: "lease-2" }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_MULTIPLE_AUTHORITATIVE_WRITERS",
      }),
    );
    expect(() =>
      registry.bind(
        binding({
          authorityGeneration: 2,
          writerId: "writer-2",
          writerLeaseId: "lease-2",
          eventHead: `sha256:${"a".repeat(64)}`,
        }),
        { replace: true },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_EVENT_HEAD_CONFLICT" }),
    );
  });

  it("requires an exact live lease and advances the event head atomically", () => {
    const registry = new GraphRunAuthorityRegistry({
      now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    });
    registry.bind(binding());
    const writer = {
      authoritySource: "graph_kernel",
      authorityGeneration: 1,
      writerId: "writer-1",
      writerLeaseId: "lease-1",
    };
    const nextHead = `sha256:${"b".repeat(64)}`;
    expect(
      registry.advanceEventHead("run-1", writer, {
        expectedEventHead: null,
        eventHead: nextHead,
      }),
    ).toMatchObject({ eventHead: nextHead });
    expect(() =>
      registry.advanceEventHead("run-1", writer, {
        expectedEventHead: null,
        eventHead: `sha256:${"c".repeat(64)}`,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_EVENT_HEAD_CONFLICT" }),
    );
    expect(() =>
      assertGraphAuthorityWriter(
        binding({ writerLeaseExpiresAt: "2020-01-01T00:00:00.000Z" }),
        writer,
        { now: Date.parse("2029-01-01T00:00:00.000Z") },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_WRITER_LEASE_EXPIRED" }),
    );
  });

  it("forces the rollout through shadow and canary while allowing rollback", () => {
    expect(assertGraphCutoverTransition("legacy", "shadow")).toBe("shadow");
    expect(assertGraphCutoverTransition("shadow", "canary")).toBe("canary");
    expect(assertGraphCutoverTransition("canary", "canonical")).toBe(
      "canonical",
    );
    expect(assertGraphCutoverTransition("canonical", "canary")).toBe("canary");
    expect(() =>
      assertGraphCutoverTransition("legacy", "canonical"),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_TRANSITION_INVALID" }),
    );
  });

  it("persists authority identity and atomically fences the superseded writer", () => {
    const now = () => Date.parse("2029-01-01T00:00:00.000Z");
    const rolloutStore = new MemoryRolloutStore({ now });
    const eventStore = new GraphEventStore({ rolloutStore });
    const first = new GraphKernel({
      eventStore,
      now,
      writerId: "writer-1",
      writerLeaseId: "lease-1",
      authorityGeneration: 1,
    });
    const started = first.startRun(compiledGraph(), {
      runId: "run-fenced",
      originSurface: "cli_team",
    });
    expect(started).toMatchObject({
      authoritySource: "graph_kernel",
      authorityMode: "canonical",
      authorityGeneration: 1,
      writerId: "writer-1",
      projectionVersion: 1,
    });
    expect(started.eventHead).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const second = new GraphKernel({
      eventStore,
      now,
      writerId: "writer-2",
      writerLeaseId: "lease-2",
      authorityGeneration: 2,
    });
    expect(() => second.recoverRun("run-fenced")).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_STALE_WRITER" }),
    );
    const recovered = second.recoverRun("run-fenced", {
      authority: binding({
        logicalRunId: "run-fenced",
        authorityGeneration: 2,
        writerId: "writer-2",
        writerLeaseId: "lease-2",
        eventHead: started.eventHead,
      }),
    });
    expect(recovered).toMatchObject({
      authorityGeneration: 2,
      writerId: "writer-2",
    });
    expect(second.events("run-fenced").at(-1).type).toBe(
      "run.authority_transferred",
    );
    expect(() => first.sealRun("run-fenced")).toThrowError(
      expect.objectContaining({ code: "CC_ROLLOUT_HEAD_CONFLICT" }),
    );
  });
});
