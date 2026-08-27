import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";
import {
  TeamGraphRuntimeAdapter,
  compileTeamGraphDefinition,
} from "../../src/lib/agent-team/team-graph-runtime-adapter.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";

const OUTPUT_DIGEST = `sha256:${"a".repeat(64)}`;

class AfterAppendFaultStore {
  constructor(inner) {
    this.inner = inner;
    this.faultType = null;
  }

  arm(type) {
    this.faultType = type;
  }

  start(...args) {
    return this.inner.start(...args);
  }

  append(...args) {
    const event = this.inner.append(...args);
    if (args[1] === this.faultType) {
      this.faultType = null;
      const error = new Error(`crash after durable ${args[1]}`);
      error.code = "TEST_CRASH_AFTER_DURABLE_APPEND";
      throw error;
    }
    return event;
  }

  read(...args) {
    return this.inner.read(...args);
  }
}

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

  it("uses the Graph ready frontier instead of the legacy registry frontier", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const runtime = adapter(now);
    runtime.open({
      registry: source,
      runId: "team:canonical-ready",
      executionMode: "agent",
      teammates: 1,
    });

    expect(runtime.nextReadyTaskKey()).toBe("build");
    expect(
      source.acquire("build", {
        holder: "legacy-only-writer",
        ttlMs: 60_000,
      }).ok,
    ).toBe(true);
    expect(source.nextClaimable()).toBeNull();
    expect(runtime.nextReadyTaskKey()).toBe("build");
    expect(runtime.nextReadyTaskKey({ excludeKeys: new Set(["build"]) })).toBe(
      null,
    );
  });

  it("repairs the legacy task after a committed effect receipt cutpoint", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const durable = new GraphEventStore({
      rolloutStore: new MemoryRolloutStore({ now }),
    });
    const faultStore = new AfterAppendFaultStore(durable);
    const first = new TeamGraphRuntimeAdapter({
      eventStore: faultStore,
      now,
      createId: () => "effect-cutpoint-first",
    });
    first.open({
      registry: source,
      runId: "team:effect-receipt-cutpoint",
      executionMode: "agent",
      teammates: 1,
    });
    const lease = source.acquire("build", {
      holder: "teammate-1",
      ttlMs: 60_000,
    }).lease;
    first.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: source.getTask("build"),
      lease,
    });
    faultStore.arm("effect.settled");
    expect(() =>
      first.settleTask({
        key: "build",
        task: source.getTask("build"),
        status: "completed",
        result: { terminalEvidence: { outputDigest: OUTPUT_DIGEST } },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_CRASH_AFTER_DURABLE_APPEND" }),
    );
    expect(source.getTask("build").status).toBe("in_progress");

    const recovered = new TeamGraphRuntimeAdapter({
      eventStore: durable,
      now,
      createId: () => "effect-cutpoint-recovered",
    });
    recovered.open({
      registry: source,
      runId: "team:effect-receipt-cutpoint",
      executionMode: "agent",
      teammates: 1,
    });
    expect(source.getTask("build")).toMatchObject({
      status: "completed",
      lease: null,
      metadata: {
        canonicalGraphProjection: expect.objectContaining({
          graphStatus: "succeeded",
          authorityGeneration: 2,
        }),
      },
    });
    expect(recovered.nextReadyTaskKey()).toBe("test");
    expect(
      recovered.events().filter((event) => event.type === "effect.settled"),
    ).toHaveLength(1);
  });

  it("reclaims an older-generation assignment that never began an effect", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const eventStore = new GraphEventStore({
      rolloutStore: new MemoryRolloutStore({ now }),
    });
    let id = 0;
    const createId = () => `recovery-${++id}`;
    const first = new TeamGraphRuntimeAdapter({ eventStore, now, createId });
    first.open({
      registry: source,
      runId: "team:recover-assignment",
      executionMode: "agent",
      teammates: 1,
    });
    first.kernel.assignNode(
      first.runId,
      first.taskToNode.get("build"),
      "teammate-1",
      {
        attemptId: "crashed-before-effect",
        leaseId: "crashed-lease",
      },
    );

    const recovered = new TeamGraphRuntimeAdapter({
      eventStore,
      now,
      createId,
    });
    const projection = recovered.open({
      registry: source,
      runId: "team:recover-assignment",
      executionMode: "agent",
      teammates: 1,
    });

    expect(projection.attempts).toContainEqual(
      expect.objectContaining({
        id: "crashed-before-effect",
        status: "expired",
        participationStatus: "lost",
      }),
    );
    expect(recovered.nextReadyTaskKey()).toBe("build");
    expect(recovered.events().map((event) => event.type)).toContain(
      "assignment.reclaimed",
    );
  });

  it("makes Graph authoritative for Team message admission and ACK", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const runtime = adapter(now);
    runtime.open({
      registry: source,
      runId: "team:canonical-message",
      executionMode: "agent",
      teammates: 2,
    });
    const lease = source.acquire("build", {
      holder: "teammate-1",
      ttlMs: 60_000,
    }).lease;
    runtime.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: source.getTask("build"),
      lease,
    });
    const mailbox = new TeamMailbox({
      now,
      recipients: ["coordinator", "teammate-1", "teammate-2"],
    });
    const authoritative = runtime.bindMailbox(mailbox);
    const message = authoritative.send({
      from: "teammate-1",
      to: "teammate-2",
      subject: "review",
      body: { commit: "abc123" },
      idempotencyKey: "review-v1",
      senderAttempt: { taskKey: "build" },
    });

    expect(message.idempotencyKey).toMatch(/^team-mail:/u);
    expect(runtime.kernel.collaborationState(runtime.runId).messages).toEqual([
      expect.objectContaining({
        status: "delivered",
        toAgentId: "teammate-2",
        payload: expect.objectContaining({
          schema: "chainlesschain.team-graph-mailbox/v1",
          originalIdempotencyKey: "review-v1",
        }),
      }),
    ]);
    expect(
      authoritative.receive("teammate-2", { markRead: true }),
    ).toHaveLength(1);
    const acknowledged = authoritative.acknowledge("teammate-2", {
      messageIds: [message.id],
      consumerKey: "review-consumer",
      status: "processed",
    });
    expect(acknowledged.receipts[0].status).toBe("processed");
    expect(
      runtime.kernel.collaborationState(runtime.runId).messageConsumers,
    ).toEqual([
      expect.objectContaining({
        agentId: "teammate-2",
        consumerKey: "review-consumer",
      }),
    ]);
    expect(() =>
      authoritative.acknowledge("teammate-2", {
        messageIds: [message.id],
        consumerKey: "forged-second-consumer",
        status: "processed",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_MESSAGE_CONSUMER_CONFLICT" }),
    );
  });

  it("repairs a mailbox projection after Graph admission won the crash race", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const runtime = adapter(now);
    runtime.open({
      registry: source,
      runId: "team:message-projection-recovery",
      executionMode: "agent",
      teammates: 1,
    });
    const mailbox = new TeamMailbox({
      now,
      recipients: ["coordinator", "teammate-1"],
    });
    const originalSend = mailbox.send.bind(mailbox);
    const authoritative = runtime.bindMailbox(mailbox);
    mailbox.send = () => {
      throw new Error("crash after Graph admission");
    };

    expect(() =>
      authoritative.send({
        from: "coordinator",
        to: "teammate-1",
        body: "resume this",
      }),
    ).toThrow("crash after Graph admission");
    expect(mailbox.log()).toEqual([]);
    expect(runtime.kernel.collaborationState(runtime.runId).messages).toEqual([
      expect.objectContaining({ status: "admitted" }),
    ]);

    mailbox.send = originalSend;
    runtime.bindMailbox(mailbox);
    expect(mailbox.log()).toEqual([
      expect.objectContaining({ body: "resume this" }),
    ]);
    expect(runtime.kernel.collaborationState(runtime.runId).messages).toEqual([
      expect.objectContaining({ status: "delivered" }),
    ]);
  });

  it("transfers task and in-flight effect custody through Graph before legacy", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const runtime = adapter(now);
    runtime.open({
      registry: source,
      runId: "team:canonical-handoff",
      executionMode: "agent",
      teammates: 2,
    });
    const authoritative = runtime.bindRegistry(source);
    const sourceLease = authoritative.acquire("build", {
      holder: "teammate-1",
      ttlMs: 60_000,
    }).lease;
    runtime.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: authoritative.getTask("build"),
      lease: sourceLease,
    });
    const offered = authoritative.offerHandoff("build", {
      handoffId: "handoff-build-review",
      holder: "teammate-1",
      leaseId: sourceLease.leaseId,
      toHolder: "teammate-2",
      revisionDigest: runtime.status().revisionDigest,
      authorityDigest: runtime.status().authorityDigest,
      artifactIds: ["legacy-review-context"],
      preconditions: { tests: "pending" },
      ttlMs: 60_000,
    });
    expect(offered.ok).toBe(true);
    expect(
      authoritative.acceptHandoff("handoff-build-review", {
        holder: "teammate-2",
        recipientAttempt: { holder: "teammate-2" },
      }).ok,
    ).toBe(true);
    const committed = authoritative.commitHandoff("handoff-build-review", {
      holder: "teammate-1",
      leaseId: sourceLease.leaseId,
      ttlMs: 60_000,
    });
    expect(committed).toMatchObject({
      ok: true,
      lease: { holder: "teammate-2" },
    });
    expect(
      authoritative.complete("build", {
        holder: "teammate-1",
        leaseId: sourceLease.leaseId,
        result: "stale",
      }),
    ).toMatchObject({ ok: false });

    runtime.beforeTask({
      key: "build",
      holder: "teammate-2",
      task: authoritative.getTask("build"),
      lease: committed.lease,
    });
    runtime.settleTask({
      key: "build",
      task: authoritative.getTask("build"),
      status: "completed",
      result: { terminalEvidence: { outputDigest: OUTPUT_DIGEST } },
    });
    expect(
      authoritative.complete("build", {
        holder: "teammate-2",
        leaseId: committed.lease.leaseId,
        result: { outputDigest: OUTPUT_DIGEST },
      }).ok,
    ).toBe(true);
    expect(runtime.kernel.collaborationState(runtime.runId).handoffs).toEqual([
      expect.objectContaining({
        id: "handoff-build-review",
        status: "committed",
        toAgentId: "teammate-2",
      }),
    ]);
    expect(runtime.status().attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "teammate-1",
          participationStatus: "handed_off",
        }),
        expect.objectContaining({
          agentId: "teammate-2",
          participationStatus: "accepted_winner",
        }),
      ]),
    );
  });

  it("repairs committed handoff custody when Graph wins the cutpoint", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const eventStore = new GraphEventStore({
      rolloutStore: new MemoryRolloutStore({ now }),
    });
    const first = new TeamGraphRuntimeAdapter({
      eventStore,
      now,
      createId: () => "handoff-cutpoint-first",
    });
    first.open({
      registry: source,
      runId: "team:handoff-commit-cutpoint",
      executionMode: "dry-run",
      teammates: 2,
    });
    const authoritative = first.bindRegistry(source);
    const sourceLease = authoritative.acquire("build", {
      holder: "teammate-1",
      ttlMs: 60_000,
    }).lease;
    first.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: authoritative.getTask("build"),
      lease: sourceLease,
    });
    expect(
      authoritative.offerHandoff("build", {
        handoffId: "handoff-cutpoint",
        holder: "teammate-1",
        leaseId: sourceLease.leaseId,
        toHolder: "teammate-2",
        preconditions: { review: "required" },
        summary: "continue after review",
        ttlMs: 60_000,
      }).ok,
    ).toBe(true);
    expect(
      authoritative.acceptHandoff("handoff-cutpoint", {
        holder: "teammate-2",
      }).ok,
    ).toBe(true);
    const originalCommit = source.commitHandoff.bind(source);
    source.commitHandoff = () => {
      throw new Error("crash after Graph handoff commit");
    };
    expect(() =>
      authoritative.commitHandoff("handoff-cutpoint", {
        holder: "teammate-1",
        leaseId: sourceLease.leaseId,
        ttlMs: 60_000,
      }),
    ).toThrow("crash after Graph handoff commit");
    expect(source.findHandoff("handoff-cutpoint").handoff.status).toBe(
      "accepted",
    );
    source.commitHandoff = originalCommit;

    const recovered = new TeamGraphRuntimeAdapter({
      eventStore,
      now,
      createId: () => "handoff-cutpoint-recovered",
    });
    recovered.open({
      registry: source,
      runId: "team:handoff-commit-cutpoint",
      executionMode: "dry-run",
      teammates: 2,
    });
    recovered.bindRegistry(source);
    expect(source.findHandoff("handoff-cutpoint")).toMatchObject({
      key: "build",
      handoff: {
        status: "committed",
        toHolder: "teammate-2",
        preconditions: { review: "required" },
        summary: "continue after review",
      },
    });
    expect(source.pendingCommittedHandoffs()).toEqual([
      expect.objectContaining({
        key: "build",
        handoff: expect.objectContaining({ id: "handoff-cutpoint" }),
        lease: expect.objectContaining({ holder: "teammate-2" }),
      }),
    ]);
  });

  it("keeps the Graph open for authoritative dynamic follow-up tasks", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const runtime = adapter(now);
    expect(
      runtime.open({
        registry: source,
        runId: "team:dynamic-followup",
        executionMode: "agent",
        teammates: 1,
        dynamic: true,
      }).phase,
    ).toBe("open");
    const authoritative = runtime.bindRegistry(source);
    const buildLease = authoritative.acquire("build", {
      holder: "teammate-1",
      ttlMs: 60_000,
    }).lease;
    runtime.beforeTask({
      key: "build",
      holder: "teammate-1",
      task: authoritative.getTask("build"),
      lease: buildLease,
    });
    runtime.settleTask({
      key: "build",
      task: authoritative.getTask("build"),
      status: "completed",
      result: { terminalEvidence: { outputDigest: OUTPUT_DIGEST } },
    });
    authoritative.complete("build", {
      holder: "teammate-1",
      leaseId: buildLease.leaseId,
      result: "done",
    });

    expect(
      authoritative.addTask({
        key: "team_followup:1:teammate-1:1",
        title: "Follow up",
        dependsOn: ["build"],
        priority: "high",
        metadata: {
          prompt: "Continue",
          retrySafe: true,
          scopePaths: ["src/followup"],
          teamFollowup: {
            messageId: 1,
            recipient: "teammate-1",
            sessionTaskKey: "build",
          },
        },
      }).ok,
    ).toBe(true);
    expect(runtime.nextReadyTaskKey()).toBe("team_followup:1:teammate-1:1");
    expect(runtime.status()).toMatchObject({
      phase: "open",
      graphRevision: 2,
    });
    expect(runtime.events().map((event) => event.type)).toContain(
      "graph.revised",
    );
  });

  it("repairs a dynamic legacy task projection after Graph append", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const eventStore = new GraphEventStore({
      rolloutStore: new MemoryRolloutStore({ now }),
    });
    let sequence = 0;
    const createId = () => `dynamic-recovery-${++sequence}`;
    const first = new TeamGraphRuntimeAdapter({ eventStore, now, createId });
    first.open({
      registry: source,
      runId: "team:dynamic-projection-recovery",
      executionMode: "dry-run",
      teammates: 1,
      dynamic: true,
    });
    const authoritative = first.bindRegistry(source);
    const originalAddTask = source.addTask.bind(source);
    source.addTask = () => {
      throw new Error("crash after Graph append");
    };
    expect(() =>
      authoritative.addTask({
        key: "team_followup:recover",
        title: "Recovered follow-up",
        dependsOn: ["build"],
        priority: "high",
        metadata: { prompt: "Resume" },
      }),
    ).toThrow("crash after Graph append");
    expect(source.getTask("team_followup:recover")).toBeNull();
    source.addTask = originalAddTask;

    const recovered = new TeamGraphRuntimeAdapter({
      eventStore,
      now,
      createId,
    });
    expect(
      recovered.open({
        registry: source,
        runId: "team:dynamic-projection-recovery",
        executionMode: "dry-run",
        teammates: 1,
        dynamic: true,
      }),
    ).toMatchObject({ phase: "open", graphRevision: 2 });
    expect(source.getTask("team_followup:recover")).toMatchObject({
      title: "Recovered follow-up",
      dependsOn: ["build"],
    });
    expect(recovered.nextReadyTaskKey()).toBe("build");
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

  it("uses a durable distributed receipt to reconcile a writer crash", () => {
    const now = () => 1_800_000_000_000;
    const source = registry(now);
    const eventStore = new GraphEventStore({
      rolloutStore: new MemoryRolloutStore({ now }),
    });
    const first = new TeamGraphRuntimeAdapter({
      eventStore,
      now,
      createId: () => "distributed-receipt-first",
    });
    first.open({
      registry: source,
      runId: "team:distributed-receipt-recovery",
      executionMode: "shell-worktree",
      worktree: true,
      teammates: 1,
    });
    const lease = source.acquire("build", {
      holder: "worker-1:teammate-1",
      ttlMs: 60_000,
    }).lease;
    first.beforeTask({
      key: "build",
      holder: "worker-1:teammate-1",
      task: source.getTask("build"),
      lease,
    });

    const recovered = new TeamGraphRuntimeAdapter({
      eventStore,
      now,
      createId: () => "distributed-receipt-recovered",
    });
    expect(
      recovered.open({
        registry: source,
        runId: "team:distributed-receipt-recovery",
        executionMode: "shell-worktree",
        worktree: true,
        teammates: 1,
        recoveryReceipts: new Map([
          [
            "build",
            {
              status: "completed",
              decision: "committed",
              receiptDigest: OUTPUT_DIGEST,
              terminalEvidence: { outputDigest: OUTPUT_DIGEST },
              auditDecisionId: "distributed-result-build",
            },
          ],
        ]),
      }),
    ).toMatchObject({ status: "running" });
    expect(source.getTask("build")).toMatchObject({
      status: "completed",
      metadata: {
        canonicalGraphProjection: expect.objectContaining({
          authorityGeneration: 2,
          graphStatus: "succeeded",
        }),
      },
    });
    expect(recovered.status().nodes).toContainEqual(
      expect.objectContaining({ nodeId: "build", status: "succeeded" }),
    );
    expect(
      recovered.events().filter((event) => event.type === "effect.reconciled"),
    ).toHaveLength(1);
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
