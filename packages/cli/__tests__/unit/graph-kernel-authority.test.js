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

const EXPIRY = "2030-01-01T00:00:00.000Z";

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
      entryCount: 11,
      errors: [],
    });
    expect(discoverUnclassifiedRuntimeWriters(manifest)).toEqual([]);
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
