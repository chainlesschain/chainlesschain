import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import {
  TeamGraphRuntimeAdapter,
  compileTeamGraphDefinition,
} from "../../src/lib/agent-team/team-graph-runtime-adapter.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";

const OUTPUT_DIGEST = `sha256:${"a".repeat(64)}`;

function registry(now, { retrySafe = true } = {}) {
  const value = new TaskLeaseRegistry({
    now,
    maxAttempts: 2,
    leaseEpoch: "team-test",
  });
  value.addTasks([
    {
      key: "build",
      title: "Build",
      metadata: {
        scopePaths: ["src/build"],
        idempotencyKey: "build-v1",
        retrySafe,
      },
    },
    {
      key: "test",
      title: "Test",
      dependsOn: ["build"],
      metadata: {
        scopePaths: ["src/test"],
        idempotencyKey: "test-v1",
        retrySafe: true,
      },
    },
  ]);
  return value;
}

function adapter(now) {
  return new TeamGraphRuntimeAdapter({
    now,
    eventStore: new GraphEventStore({
      rolloutStore: new MemoryRolloutStore({ now }),
    }),
    createId: () => "adapter-id",
  });
}

describe("CLI Team canonical Graph runtime adapter", () => {
  it("records a shadow projection without claiming canonical authority", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const runtime = adapter(now);
    runtime.open({
      registry: source,
      runId: "team:shadow",
      executionMode: "agent",
      teammates: 1,
      authorityMode: "shadow",
    });
    runtime.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: source.getTask("build"),
      lease: { leaseId: "legacy-build", fencingToken: 1 },
    });
    runtime.settleTask({
      key: "build",
      task: source.getTask("build"),
      status: "completed",
      result: { terminalEvidence: { outputDigest: OUTPUT_DIGEST } },
    });
    expect(runtime.status()).toMatchObject({
      authorityMode: "shadow",
      authoritySource: "graph_kernel_shadow",
      originSurface: "cli_team",
    });
  });

  it("compiles the task registry into an evidence-bound GraphDefinition", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const graph = compileTeamGraphDefinition(source, {
      executionMode: "agent",
      worktree: false,
      budget: { maxTasks: 4, maxTokens: 1000 },
    });
    expect(graph.compiled.definition.nodes).toEqual([
      expect.objectContaining({
        id: "build",
        effectClass: "workspace_write",
        workspaceIsolation: "declared_scope",
        writeSet: ["src/build"],
        retryLimit: 1,
      }),
      expect.objectContaining({ id: "test", dependsOn: ["build"] }),
    ]);
    expect(graph.compiled.definition.budget).toEqual({
      turns: 4,
      tokens: 1000,
    });
  });

  it("settles canonical effects and attempts before legacy projection", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const runtime = adapter(now);
    runtime.open({
      registry: source,
      runId: "team:canonical-success",
      executionMode: "agent",
      worktree: true,
      teammates: 2,
      budget: { maxTasks: 4 },
    });
    runtime.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: source.getTask("build"),
      lease: { leaseId: "legacy-build", fencingToken: 1 },
    });
    runtime.settleTask({
      key: "build",
      task: source.getTask("build"),
      status: "completed",
      result: { terminalEvidence: { outputDigest: OUTPUT_DIGEST } },
    });
    runtime.beforeTask({
      key: "test",
      holder: "teammate-2",
      task: source.getTask("test"),
      lease: { leaseId: "legacy-test", fencingToken: 1 },
    });
    runtime.settleTask({
      key: "test",
      task: source.getTask("test"),
      status: "completed",
      result: { terminalEvidence: { outputDigest: OUTPUT_DIGEST } },
    });
    expect(runtime.status()).toMatchObject({
      status: "succeeded",
      authoritySource: "graph_kernel",
      originSurface: "cli_team",
      authorityGeneration: 1,
      projectionVersion: 1,
    });
    expect(runtime.events().map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "effect.started",
        "effect.settled",
        "assignment.settled",
      ]),
    );
  });

  it("routes a non-retry-safe effect failure to reconciliation", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now, { retrySafe: false });
    const runtime = adapter(now);
    runtime.open({
      registry: source,
      runId: "team:canonical-unknown",
      executionMode: "agent",
      worktree: false,
      teammates: 1,
    });
    runtime.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: source.getTask("build"),
      lease: { leaseId: "legacy-build", fencingToken: 1 },
    });
    runtime.settleTask({
      key: "build",
      task: source.getTask("build"),
      status: "failed",
      error: new Error("outcome unknown"),
    });
    expect(runtime.status()).toMatchObject({
      status: "reconciliation_required",
      reconciliationEffectIds: [expect.any(String)],
    });
  });

  it("requires an explicit migration saga before changing authority mode", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const eventStore = new GraphEventStore({
      rolloutStore: new MemoryRolloutStore({ now }),
    });
    new TeamGraphRuntimeAdapter({ eventStore, now }).open({
      registry: source,
      runId: "team:mode-change",
      executionMode: "dry-run",
      authorityMode: "shadow",
    });
    expect(() =>
      new TeamGraphRuntimeAdapter({ eventStore, now }).open({
        registry: source,
        runId: "team:mode-change",
        executionMode: "dry-run",
        authorityMode: "canonical",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_MIGRATION_REQUIRED" }),
    );
  });
});
