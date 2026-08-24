import { describe, expect, it, vi } from "vitest";
import { CcAppServer } from "../../src/lib/app-server/server.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import {
  APP_SERVER_PROTOCOL_VERSION,
  JSON_RPC_ERROR,
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
