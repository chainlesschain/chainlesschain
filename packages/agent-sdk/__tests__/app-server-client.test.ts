import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  AppServerClient,
  AppServerRpcError,
} from "../src/app-server-client.js";
import type { AppServerClientOptions } from "../src/app-server-client.js";

class FakeStdin extends EventEmitter {
  destroyed = false;
  written: string[] = [];

  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }

  end(): void {
    this.destroyed = true;
  }
}

class FakeChild extends EventEmitter {
  stdin = new FakeStdin();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createClient(options: AppServerClientOptions = {}) {
  const child = new FakeChild();
  const spawn = vi.fn(() => child);
  const client = new AppServerClient({
    cliPath: "cc",
    ...options,
    spawn: spawn as unknown as AppServerClientOptions["spawn"],
  });
  const push = (message: unknown) => {
    child.stdout.emit(
      "data",
      Buffer.from(`${JSON.stringify(message)}\n`, "utf8"),
    );
  };
  const written = () => child.stdin.written.map((line) => JSON.parse(line));
  return { child, client, spawn, push, written };
}

async function initialize(value: ReturnType<typeof createClient>) {
  const started = value.client.start();
  await flush();
  const request = value.written()[0];
  value.push({
    jsonrpc: "2.0",
    id: request.id,
    result: {
      protocolVersion: 1,
      minimumProtocolVersion: 1,
      features: ["thread_turn_item"],
    },
  });
  return started;
}

describe("AppServerClient", () => {
  it("settles initialization timeout even when stdin never drains", async () => {
    vi.useFakeTimers();
    try {
      const value = createClient({ requestTimeoutMs: 25 });
      vi.spyOn(value.child.stdin, "write").mockReturnValue(false);
      const started = value.client.start();
      const rejected = expect(started).rejects.toMatchObject({
        code: -32010,
        message: "App Server request timed out: initialize",
      });
      expect(value.child.stdin.listenerCount("drain")).toBe(1);
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(value.client.pendingRequestCount).toBe(0);
      expect(value.child.stdin.listenerCount("drain")).toBe(0);
      value.child.exitCode = 0;
      await value.client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a response while its write is backpressured and releases listeners", async () => {
    const value = createClient();
    await initialize(value);
    vi.spyOn(value.child.stdin, "write").mockReturnValue(false);
    const response = value.client.request("evolution/workbench/list", {});
    value.push({ jsonrpc: "2.0", id: "2", result: { total: 3 } });
    await expect(response).resolves.toEqual({ total: 3 });
    expect(value.child.stdin.listenerCount("drain")).toBe(0);
    expect(value.client.pendingRequestCount).toBe(0);
  });

  it.each(["process", "stdin", "protocol"])(
    "rejects pending reads immediately after a %s failure",
    async (source) => {
      const value = createClient();
      const errors = vi.fn();
      value.client.on("error", errors);
      await initialize(value);
      vi.spyOn(value.child.stdin, "write").mockReturnValue(false);
      const response = value.client.request("evolution/workbench/list", {});
      const rejected = expect(response).rejects.toBeInstanceOf(Error);
      if (source === "protocol") value.push({ broken: true });
      else
        (source === "stdin" ? value.child.stdin : value.child).emit(
          "error",
          new Error("broken transport"),
        );
      await rejected;
      expect(errors).toHaveBeenCalledOnce();
      expect(value.client.running).toBe(false);
      await expect(
        value.client.request("evolution/workbench/list", {}),
      ).rejects.toThrow("not running");
      expect(value.client.pendingRequestCount).toBe(0);
      expect(value.child.stdin.listenerCount("drain")).toBe(0);
    },
  );

  it("cleans up its shutdown timer and rejects blocked reads before process exit", async () => {
    const value = createClient();
    await initialize(value);
    vi.useFakeTimers();
    try {
      const response = value.client.request("evolution/workbench/list", {});
      const rejected = expect(response).rejects.toThrow("connection closed");
      const closing = value.client.close();
      await rejected;
      value.child.exitCode = 0;
      value.child.emit("exit", 0);
      await closing;
      expect(vi.getTimerCount()).toBe(0);
      expect(value.child.listenerCount("exit")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closing releases a blocked request and ignores late events from the old child", async () => {
    const children = [new FakeChild(), new FakeChild()];
    let childIndex = 0;
    const client = new AppServerClient({
      spawn: (() =>
        children[childIndex++]) as unknown as AppServerClientOptions["spawn"],
    });
    const first = client.start();
    children[0].stdout.emit(
      "data",
      Buffer.from('{"jsonrpc":"2.0","id":"1","result":{}}\n'),
    );
    await first;
    vi.spyOn(children[0].stdin, "write").mockReturnValue(false);
    const request = client.request("evolution/workbench/list", {});
    const rejected = expect(request).rejects.toThrow("connection closed");
    children[0].exitCode = 0;
    await client.close();
    await rejected;
    expect(children[0].stdin.listenerCount("drain")).toBe(0);

    const second = client.start();
    children[0].emit("exit", 0);
    children[0].stdout.emit("data", Buffer.from('{"broken":true}\n'));
    children[0].emit("error", new Error("late error"));
    children[1].stdout.emit(
      "data",
      Buffer.from('{"jsonrpc":"2.0","id":"3","result":{"replacement":true}}\n'),
    );
    await expect(second).resolves.toEqual({ replacement: true });
    expect(client.running).toBe(true);
  });

  it("spawns the canonical stdio server and multiplexes responses and notifications", async () => {
    const value = createClient();
    const notification = vi.fn();
    value.client.on("notification", notification);

    await expect(initialize(value)).resolves.toMatchObject({
      protocolVersion: 1,
    });
    expect(value.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["serve", "--app-server"]),
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );

    const response = value.client.request("thread/start", {
      threadId: "thread-1",
    });
    await flush();
    const request = value.written().at(-1);
    value.push({
      jsonrpc: "2.0",
      method: "thread/updated",
      params: { thread: { id: "thread-1" } },
    });
    value.push({
      jsonrpc: "2.0",
      id: request.id,
      result: { thread: { id: "thread-1" } },
    });

    await expect(response).resolves.toEqual({ thread: { id: "thread-1" } });
    expect(notification).toHaveBeenCalledWith(
      expect.objectContaining({ method: "thread/updated" }),
    );
  });

  it("never sends an old server's delayed approval to a replacement connection", async () => {
    const children = [new FakeChild(), new FakeChild()];
    let childIndex = 0;
    let approve!: (value: { kind: string }) => void;
    const client = new AppServerClient({
      spawn: (() =>
        children[childIndex++]) as unknown as AppServerClientOptions["spawn"],
      onServerRequest: () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    });
    const first = client.start();
    children[0].stdout.emit(
      "data",
      Buffer.from('{"jsonrpc":"2.0","id":"1","result":{}}\n'),
    );
    await first;
    children[0].stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "server:approval",
          method: "approval/decide",
          params: { request: { id: "old" } },
        }) + "\n",
      ),
    );
    children[0].exitCode = 0;
    await client.close();
    const second = client.start();
    children[1].stdout.emit(
      "data",
      Buffer.from('{"jsonrpc":"2.0","id":"2","result":{}}\n'),
    );
    await second;
    approve({ kind: "accept" });
    await flush();
    expect(children[1].stdin.written.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ method: "initialize", id: "2" }),
    ]);
    expect(client.running).toBe(true);
  });

  it("selects the physical rollout adapter without changing the RPC client", async () => {
    const value = createClient({
      storageBackend: "sqlite",
      statePath: "C:/state/app-server.sqlite",
    });
    await initialize(value);
    expect(value.spawn.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "--app-server-store",
        "sqlite",
        "--app-server-state-path",
        "C:/state/app-server.sqlite",
      ]),
    );
  });

  it("rejects ambiguous rollout locations before spawning", async () => {
    const value = createClient({
      stateDirectory: "C:/state",
      statePath: "C:/state/app-server.sqlite",
    });
    await expect(value.client.start()).rejects.toThrow(
      "stateDirectory and statePath are mutually exclusive",
    );
    expect(value.spawn).not.toHaveBeenCalled();
  });

  it("fails closed for server approval requests without a handler", async () => {
    const value = createClient();
    await initialize(value);
    value.push({
      jsonrpc: "2.0",
      id: "server:approval-1",
      method: "approval/decide",
      params: { request: { id: "approval-1" } },
    });
    await flush();
    expect(value.written().at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "server:approval-1",
      result: {
        kind: "decline",
        reason: "No App Server request handler is configured",
      },
    });
  });

  it("cancels a bound question without a handler instead of forging approval", async () => {
    const value = createClient();
    await initialize(value);
    const binding = {
      sessionId: "thread-1",
      turnId: "turn-1",
      toolUseId: "tool-1",
      sequence: 1,
    };
    value.push({
      jsonrpc: "2.0",
      id: "server:question-1",
      method: "question/answer",
      params: { request: { id: "q-1", binding } },
    });
    await flush();
    expect(value.written().at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "server:question-1",
      result: { questionId: "q-1", binding, answer: null },
    });
  });

  it("bounds pending requests and propagates structured RPC errors", async () => {
    const value = createClient({ maxPendingRequests: 1 });
    await initialize(value);
    const first = value.client.request("thread/list", {});
    await expect(value.client.request("thread/list", {})).rejects.toEqual(
      expect.objectContaining<AppServerRpcError>({
        code: -32001,
      }),
    );
    const request = value.written().at(-1);
    value.push({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32000, message: "not initialized" },
    });
    await expect(first).rejects.toEqual(
      expect.objectContaining<AppServerRpcError>({
        code: -32000,
        message: "not initialized",
      }),
    );
  });

  it("can start a replacement transport after the server exits", async () => {
    const children: FakeChild[] = [];
    const spawn = vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
    const client = new AppServerClient({
      spawn: spawn as unknown as AppServerClientOptions["spawn"],
    });

    const firstStart = client.start();
    await flush();
    const firstRequest = JSON.parse(children[0].stdin.written[0]);
    children[0].stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ jsonrpc: "2.0", id: firstRequest.id, result: {} })}\n`,
      ),
    );
    await firstStart;
    children[0].exitCode = 1;
    children[0].emit("exit", 1);

    const secondStart = client.start();
    await flush();
    expect(spawn).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(children[1].stdin.written[0]);
    children[1].stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ jsonrpc: "2.0", id: secondRequest.id, result: {} })}\n`,
      ),
    );
    await expect(secondStart).resolves.toEqual({});
  });
});
