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
