import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CcAppServer } from "../../src/lib/app-server/server.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import {
  APP_SERVER_PROTOCOL_VERSION,
  JSON_RPC_ERROR,
  validateApprovalDecision,
  validateAppServerMessage,
} from "../../src/lib/app-server/protocol.js";
import {
  BoundedAsyncQueue,
  QueueOverloadedError,
} from "../../src/lib/app-server/bounded-queue.js";

function request(id, method, params = {}) {
  return { jsonrpc: "2.0", id, method, params };
}

function initialize(id = 1) {
  return request(id, "initialize", {
    protocolVersion: APP_SERVER_PROTOCOL_VERSION,
    minimumProtocolVersion: 1,
    client: { name: "test-client", version: "1.0.0" },
    features: ["thread_turn_item", "structured_approval"],
  });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

it("enforces item and byte caps while preserving async waiter delivery", async () => {
  const queue = new BoundedAsyncQueue({ maxItems: 2, maxBytes: 3 });
  const waiting = queue.next();
  queue.push("a");
  await expect(waiting).resolves.toEqual({ value: "a", done: false });
  expect(queue.snapshot()).toMatchObject({ queuedItems: 0, queuedBytes: 0 });

  queue.push("ab");
  queue.push("c");
  expect(() => queue.push("d")).toThrow(QueueOverloadedError);
  expect(queue.shift()).toBe("ab");
  expect(queue.snapshot()).toMatchObject({ queuedItems: 1, queuedBytes: 1 });
  expect(() => queue.push("abc")).toThrow(QueueOverloadedError);
  queue.close();
});

describe("CC App Server", () => {
  it("replaces client Graph evolution options with the trusted host ingress", async () => {
    const clientIngress = { source: "client" };
    const trustedIngress = { source: "host" };
    let turnOptions;
    const server = new CcAppServer({
      send: async () => {},
      store: new MemoryRolloutStore(),
      kernel: {
        startTurn: vi.fn(async ({ options }) => {
          turnOptions = options;
          return { result: "done", usage: { turns: 1 } };
        }),
        close: vi.fn(async () => {}),
      },
    });

    try {
      await expect(
        server._executeGraphNode({
          runId: "graph-trusted-ingress",
          nodeId: "implement",
          attempt: { id: "attempt-1" },
          input: {
            prompt: "execute",
            options: { model: "test-model", evolutionIngress: clientIngress },
          },
          signal: new AbortController().signal,
          evolutionIngress: trustedIngress,
        }),
      ).resolves.toMatchObject({ status: "succeeded" });
      expect(turnOptions).toEqual({
        model: "test-model",
        evolutionIngress: trustedIngress,
      });
    } finally {
      await server.close();
    }
  });

  it("dispatches all fixed Context/Memory methods and emits lifecycle notifications", async () => {
    const messages = [];
    const sha = `sha256:${"a".repeat(64)}`;
    const record = {
      schemaVersion: 1,
      memoryId: "memory-1",
      scope: "user",
      scopeId: "local-user",
      category: "fact",
      content: "canonical memory",
      provenance: { source: "test", observedAt: "2026-08-29T00:00:00.000Z" },
      evidenceRefs: [{ store: "test", id: "evidence-1" }],
      confidence: 0.8,
      importance: 0.7,
      tags: [],
      sensitivity: "personal",
      allowedSinks: ["*"],
      state: "active",
      retentionPolicy: { mode: "durable" },
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      accessCount: 0,
      revision: 1,
      digest: sha,
    };
    const plan = {
      schema: "chainlesschain.context-plan/v1",
      schemaVersion: 1,
      digest: sha,
      selected: [],
      selectedItemIds: [],
      dropped: [],
      inputBudget: 896,
      selectedTokens: 0,
    };
    const compactReceipt = {
      schema: "chainlesschain.context-compaction/v1",
      schemaVersion: 1,
      operationId: "compact-1",
      sessionId: "session-1",
      status: "committed",
      contextPlanDigest: sha,
      memoryRevision: 1,
      digest: sha,
    };
    const mutation = {
      record,
      event: { type: "memory.activated" },
      receipt: { digest: sha },
    };
    const deletion = {
      schema: "chainlesschain.memory-deletion-receipt/v1",
      schemaVersion: 1,
      requestId: "delete-1",
      subject: "local-user",
      selector: "memory:memory-1",
      scope: "user",
      scopeId: "local-user",
      memoryId: "memory-1",
      fence: "fence-1",
      authority: "test",
      status: "purged",
      revision: 3,
      recordState: "purged",
      recordDigest: sha,
      stores: [],
      startedAt: "2026-08-29T00:00:00.000Z",
      completedAt: "2026-08-29T00:00:01.000Z",
      digest: sha,
    };
    const recall = {
      query: "canonical",
      sink: "test",
      tokenBudget: 100,
      usedTokens: 0,
      totalCandidates: 0,
      results: [],
      digest: sha,
      memoryRevision: 1,
    };
    const contextKernel = {
      planContext: vi.fn(async () => plan),
      compactContext: vi.fn(async () => compactReceipt),
      recallMemory: vi.fn(async () => recall),
      proposeMemory: vi.fn(async () => mutation),
      decideMemory: vi.fn(async () => mutation),
      deleteMemory: vi.fn(async () => deletion),
      reconcile: vi.fn(async () => deletion),
    };
    const server = new CcAppServer({
      store: new MemoryRolloutStore(),
      kernel: { close: vi.fn() },
      send: async (message) => messages.push(message),
      contextMemoryRuntimeFactory: () => ({ kernel: contextKernel }),
    });
    await server.receive(initialize());
    const item = {
      schemaVersion: 1,
      itemId: "item-1",
      kind: "message",
      scope: "session",
      scopeId: "session-1",
      sourceRef: { store: "test", id: "source-1" },
      provenance: { source: "test", observedAt: "2026-08-29T00:00:00.000Z" },
      trust: "user",
      sensitivity: "personal",
      allowedSinks: ["test"],
      tokenEstimate: 1,
      priority: 1,
      pinned: false,
      createdAt: "2026-08-29T00:00:00.000Z",
      digest: sha,
      content: "hello",
    };
    const planRequest = {
      modelWindowTokens: 1024,
      reservedOutputTokens: 128,
      items: [item],
      sink: "test",
      scopeAdmissions: [{ scope: "session", scopeId: "session-1" }],
      policyVersion: "policy-1",
      modelProfile: "model-1",
      sessionHead: "head-1",
      memoryRevision: 1,
    };
    const proposal = {
      scope: "user",
      scopeId: "local-user",
      category: "fact",
      content: "canonical memory",
      provenance: { source: "test", observedAt: "2026-08-29T00:00:00.000Z" },
      evidenceRefs: [{ store: "test", id: "evidence-1" }],
      confidence: 0.8,
      importance: 0.7,
      sensitivity: "personal",
      allowedSinks: ["*"],
      retentionPolicy: { mode: "durable" },
      activate: true,
    };
    const requests = [
      request(10, "context/plan", planRequest),
      request(11, "context/compact", {
        operationId: "compact-1",
        sessionId: "session-1",
        modelWindowTokens: 1024,
        reservedOutputTokens: 128,
        sink: "test",
        scopeAdmissions: [{ scope: "session", scopeId: "session-1" }],
        policyVersion: "policy-1",
        modelProfile: "model-1",
      }),
      request(12, "memory/recall", {
        query: "canonical",
        sink: "test",
        scopeAdmissions: [{ scope: "user", scopeId: "local-user" }],
      }),
      request(13, "memory/propose", proposal),
      request(14, "memory/decide", {
        memoryId: "memory-1",
        type: "reinforce",
        expectedRevision: 1,
      }),
      request(15, "memory/delete", {
        requestId: "delete-1",
        subject: "local-user",
        scope: "user",
        scopeId: "local-user",
        selector: "memory:memory-1",
        memoryId: "memory-1",
        expectedRevision: 2,
        fence: "fence-1",
        authority: "test",
      }),
      request(16, "memory/reconcile", { operationId: "delete-1" }),
    ];
    for (const rpc of requests) {
      const response = await server.receive(rpc);
      expect(response.error).toBeUndefined();
    }
    expect(contextKernel.planContext).toHaveBeenCalledOnce();
    expect(contextKernel.compactContext).toHaveBeenCalledOnce();
    expect(contextKernel.recallMemory).toHaveBeenCalledOnce();
    expect(contextKernel.proposeMemory).toHaveBeenCalledOnce();
    expect(contextKernel.decideMemory).toHaveBeenCalledOnce();
    expect(contextKernel.deleteMemory).toHaveBeenCalledOnce();
    expect(contextKernel.reconcile).toHaveBeenCalledOnce();
    expect(
      messages
        .filter((message) => message.method === "context/event")
        .map((message) => message.params.type),
    ).toEqual([
      "context.plan.created",
      "context.compaction.started",
      "context.compaction.committed",
    ]);
    expect(
      messages
        .filter((message) => message.method === "memory/event")
        .map((message) => message.params.type),
    ).toEqual([
      "memory.recalled",
      "memory.activated",
      "memory.activated",
      "memory.purged",
      "memory.purged",
    ]);
    await server.close();
  });

  it("exposes fixed canonical Graph compile/run/status/history capabilities", async () => {
    const messages = [];
    const kernel = {
      async startTurn({ input }) {
        return {
          type: "result",
          subtype: "success",
          is_error: false,
          result: `completed: ${input}`,
        };
      },
      close: vi.fn(),
    };
    const server = new CcAppServer({
      store: new MemoryRolloutStore(),
      kernel,
      send: async (message) => messages.push(message),
    });
    const graph = {
      schemaVersion: 1,
      id: "desktop-team",
      revision: 1,
      nodes: [
        {
          id: "task-1",
          kind: "task",
          dependsOn: [],
          inputs: [],
          outputs: [],
          effectClass: "workspace_write",
          idempotencyKey: "desktop-task-1-v1",
          workspaceIsolation: "declared_scope",
          writeSet: ["src/**"],
        },
      ],
      edges: [],
      loops: [],
      subgraphCalls: [],
      budget: { turns: 2 },
      allowedCapabilities: [],
    };
    const initialized = await server.receive(initialize());
    expect(initialized.result.graphRuntime).toMatchObject({
      originSurface: "desktop",
      execution: "real",
      persistence: "durable",
      authorityModes: ["shadow", "canonical"],
    });
    const compiled = await server.receive(
      request(2, "graph/compile", { definition: graph }),
    );
    expect(compiled.result).toMatchObject({
      definitionId: "desktop-team",
      topologicalOrder: ["task-1"],
      revisionDigest: expect.stringMatching(/^sha256:/),
    });
    const run = await server.receive(
      request(3, "graph/run", {
        definition: graph,
        runId: "desktop-team-run",
        inputs: { "task-1": { prompt: "implement approved task" } },
        waitForCompletion: true,
      }),
    );
    expect(run.result).toMatchObject({
      status: "succeeded",
      originSurface: "desktop",
      authoritySource: "graph_kernel",
      eventHead: expect.stringMatching(/^sha256:/),
    });
    const status = await server.receive(
      request(4, "graph/status", { runId: "desktop-team-run" }),
    );
    expect(status.result.status).toBe("succeeded");
    const history = await server.receive(
      request(5, "graph/history", {
        runId: "desktop-team-run",
        limit: 100,
        snapshotLimit: 20,
      }),
    );
    expect(history.result).toMatchObject({
      schema: "chainlesschain.graph-debug-history/v1",
      runId: "desktop-team-run",
      hasMore: false,
      current: {
        schema: "chainlesschain.graph-trace-projection/v1",
        status: "succeeded",
        runId: "desktop-team-run",
      },
    });
    expect(history.result.events.length).toBeGreaterThan(0);
    expect(history.result.snapshots.length).toBeGreaterThan(1);
    expect(history.result.diffs.length).toBe(
      history.result.snapshots.length - 1,
    );
    expect(messages.some((message) => message.method === "graph/event")).toBe(
      true,
    );
    await server.close();
  });

  it("round-trips distinct actors through a durable quorum HumanTask", async () => {
    const messages = [];
    const server = new CcAppServer({
      store: new MemoryRolloutStore(),
      kernel: { close: vi.fn() },
      send: async (message) => messages.push(message),
    });
    const graph = {
      schemaVersion: 1,
      id: "desktop-human-review",
      revision: 1,
      nodes: [
        {
          id: "review",
          kind: "human",
          dependsOn: [],
          inputs: [],
          outputs: [],
          effectClass: "none",
          join: "quorum",
          quorum: 2,
        },
      ],
      edges: [],
      loops: [],
      subgraphCalls: [],
      budget: { turns: 1 },
      allowedCapabilities: [],
    };
    await server.receive(initialize());
    const runPromise = server.receive(
      request(2, "graph/run", {
        definition: graph,
        runId: "desktop-human-review-run",
        inputs: { review: { prompt: "Publish exact release SHA" } },
        waitForCompletion: true,
      }),
    );

    for (const [index, actorId] of [
      "did:chainless:reviewer-1",
      "did:chainless:reviewer-2",
    ].entries()) {
      await waitFor(
        () =>
          messages.filter((message) => message.method === "humanTask/decide")
            .length > index,
      );
      const prompt = messages.filter(
        (message) => message.method === "humanTask/decide",
      )[index];
      expect(prompt.params.task).toMatchObject({
        runId: "desktop-human-review-run",
        nodeId: "review",
        status: "open",
        quorum: 2,
        separationOfDuties: true,
        operation: { prompt: "Publish exact release SHA" },
      });
      await server.receive({
        jsonrpc: "2.0",
        id: prompt.id,
        result: {
          humanTaskId: prompt.params.task.id,
          runId: prompt.params.task.runId,
          revisionDigest: prompt.params.task.revisionDigest,
          operationDigest: prompt.params.task.operationDigest,
          nonce: prompt.params.task.nonce,
          actorId,
          decision: { kind: "acceptOnce" },
        },
      });
    }

    await expect(runPromise).resolves.toMatchObject({
      result: { status: "succeeded" },
    });
    expect(
      messages.filter((message) => message.method === "humanTask/decide"),
    ).toHaveLength(2);
    expect(
      messages.filter(
        (message) =>
          message.method === "graph/event" &&
          message.params.type === "graph/human-task-decided",
      ),
    ).toHaveLength(2);
    await server.close();
  });

  it("validates ApprovalDecision from the canonical schema", () => {
    expect(validateApprovalDecision({ kind: "acceptOnce" }).ok).toBe(true);
    expect(
      validateApprovalDecision({
        kind: "acceptForTurn",
        permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
      }).ok,
    ).toBe(true);
    expect(
      validateApprovalDecision({ kind: "acceptOnce", unexpected: true }).ok,
    ).toBe(false);
    expect(validateApprovalDecision({ kind: "allowEverything" }).ok).toBe(
      false,
    );
  });

  it("matches the shared ApprovalDecision conformance fixture", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL(
          "../../../agent-protocol/test/fixtures/approval-decisions.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const fixture of fixtures) {
      expect(validateApprovalDecision(fixture.value).ok, fixture.name).toBe(
        fixture.valid,
      );
    }
  });

  it("negotiates, runs a real-kernel-shaped turn and persists canonical events", async () => {
    const messages = [];
    const kernel = {
      async startTurn({ emit }) {
        await emit({
          type: "stream_event",
          trace_id: "trace-1",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hello" },
          },
        });
        await emit({
          type: "tool_use",
          id: "tool-1",
          tool: "read_file",
          args: { path: "README.md" },
        });
        await emit({
          type: "tool_result",
          id: "tool-1",
          tool: "read_file",
          result: "ok",
          is_error: false,
        });
        return {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "hello",
        };
      },
      close: vi.fn(),
    };
    const store = new MemoryRolloutStore();
    const server = new CcAppServer({
      store,
      kernel,
      send: async (message) => messages.push(message),
      createId: (() => {
        let id = 0;
        return () => `id-${++id}`;
      })(),
    });

    const init = await server.receive(initialize());
    expect(init.result).toMatchObject({
      protocolVersion: 1,
      features: ["thread_turn_item", "structured_approval"],
      transports: ["stdio"],
    });
    const started = await server.receive(
      request(2, "thread/start", {
        threadId: "thread-1",
        title: "Test",
      }),
    );
    expect(started.result.thread.id).toBe("thread-1");
    const accepted = await server.receive(
      request(3, "turn/start", {
        threadId: "thread-1",
        turnId: "turn-1",
        input: [{ type: "text", text: "Say hello" }],
      }),
    );
    expect(accepted.result.turn.status).toBe("running");

    await waitFor(() =>
      messages.some(
        (message) =>
          message.method === "turn/completed" &&
          message.params.turn.id === "turn-1",
      ),
    );
    const terminal = messages.find(
      (message) => message.method === "turn/completed",
    );
    expect(terminal.params.turn).toMatchObject({
      status: "completed",
      terminalEvidence: {
        status: "succeeded",
        eventDigest: expect.stringMatching(/^sha256:/),
        outputDigest: expect.stringMatching(/^sha256:/),
      },
    });
    expect(
      messages.filter((message) => message.method === "item/delta"),
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message.method === "tool/requested"),
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message.method === "tool/result"),
    ).toHaveLength(1);
    expect(store.read("thread-1").map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "thread.started",
        "turn.started",
        "item.started",
        "item.delta",
        "tool.requested",
        "tool.result",
        "turn.completed",
      ]),
    );
    for (const message of messages) {
      expect(validateAppServerMessage(message).ok).toBe(true);
    }
    await server.close();
    expect(kernel.close).toHaveBeenCalledOnce();
  });

  it("round-trips a structured approval decision", async () => {
    const messages = [];
    let server;
    const kernel = {
      cwd: process.cwd(),
      async startTurn({ emit, requestApproval }) {
        const event = {
          type: "approval_request",
          id: "approval-1",
          tool: "run_shell",
          command: "npm test",
          risk: "high",
          rule: "shell-confirm",
          reason: "command execution",
          requested_permissions: [
            { capability: "tool:run_shell", scope: "npm test" },
          ],
        };
        await emit(event);
        const decisionPromise = requestApproval(event);
        await waitFor(() =>
          messages.some((message) => message.method === "approval/decide"),
        );
        const prompt = messages.find(
          (message) => message.method === "approval/decide",
        );
        await server.receive({
          jsonrpc: "2.0",
          id: prompt.id,
          result: { kind: "acceptOnce" },
        });
        const decision = await decisionPromise;
        expect(decision).toEqual({ kind: "acceptOnce" });
        await emit({
          type: "approval_resolved",
          id: "approval-1",
          approved: true,
          via: "user",
        });
        return {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "approved",
        };
      },
      close: vi.fn(),
    };
    server = new CcAppServer({
      store: new MemoryRolloutStore(),
      kernel,
      send: async (message) => messages.push(message),
    });
    await server.receive(initialize());
    await server.receive(
      request(2, "thread/start", { threadId: "thread-approval" }),
    );
    await server.receive(
      request(3, "turn/start", {
        threadId: "thread-approval",
        input: "run tests",
      }),
    );
    await waitFor(() =>
      messages.some((message) => message.method === "turn/completed"),
    );
    expect(
      messages.find((message) => message.method === "approval/requested").params
        .request,
    ).toMatchObject({
      id: "approval-1",
      requestedPermissions: [
        { capability: "tool:run_shell", scope: "npm test" },
      ],
      binding: {
        operationDigest: expect.stringMatching(/^sha256:/),
        policyDigest: expect.stringMatching(/^sha256:/),
        nonce: "approval-1",
      },
    });
    expect(
      messages.find((message) => message.method === "approval/resolved").params,
    ).toMatchObject({ approved: true, via: "user" });
    await server.close();
  });

  it("fails requests before initialize and validates protocol ranges", async () => {
    const messages = [];
    const server = new CcAppServer({
      store: new MemoryRolloutStore(),
      kernel: { close: vi.fn() },
      send: async (message) => messages.push(message),
    });
    const premature = await server.receive(request(1, "thread/list", {}));
    expect(premature.error.code).toBe(JSON_RPC_ERROR.NOT_INITIALIZED);
    const incompatible = await server.receive(
      request(2, "initialize", {
        protocolVersion: 99,
        minimumProtocolVersion: 99,
        client: { name: "future", version: "99" },
      }),
    );
    expect(incompatible.error.code).toBe(JSON_RPC_ERROR.INVALID_PARAMS);
    await server.close();
  });

  it("waits for physical interrupt settlement and fences late success", async () => {
    const messages = [];
    let release;
    const kernel = {
      startTurn: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                type: "result",
                subtype: "success",
                is_error: false,
                result: "late success",
              });
          }),
      ),
      interruptTurn: vi.fn(async () => {
        release();
        return true;
      }),
      close: vi.fn(),
    };
    const server = new CcAppServer({
      store: new MemoryRolloutStore(),
      kernel,
      send: async (message) => messages.push(message),
    });
    await server.receive(initialize());
    await server.receive(
      request(2, "thread/start", { threadId: "thread-cancel" }),
    );
    const started = await server.receive(
      request(3, "turn/start", {
        threadId: "thread-cancel",
        turnId: "turn-cancel",
        input: "keep working",
      }),
    );
    expect(started.result.turn.status).toBe("running");
    const interrupted = await server.receive(
      request(4, "turn/interrupt", {
        threadId: "thread-cancel",
        turnId: "turn-cancel",
      }),
    );
    expect(interrupted.result).toMatchObject({
      physicallySettled: true,
      turn: {
        status: "interrupted",
        terminalEvidence: { status: "cancelled" },
      },
    });
    expect(
      messages.find((message) => message.method === "turn/completed").params
        .turn.status,
    ).toBe("interrupted");
    await server.close();
  });
});
