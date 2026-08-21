/**
 * Session transport for interactive attach — real pipe/socket round-trips:
 * token auth, prompt queueing, broadcast, detach accounting, and the NDJSON
 * carry-buffer framing (a chunk boundary must never split a message).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  BACKGROUND_SESSION_BACKLOG_LIMITS,
  connectBackgroundSession,
  createBoundedSocketWriter,
  createNdjsonReader,
  startBackgroundSessionServer,
  transportPipePath,
} from "../../src/lib/background-session-transport.js";

class BackpressuredSocket extends EventEmitter {
  constructor(writeResults = []) {
    super();
    this.destroyed = false;
    this.writableLength = 0;
    this.writes = [];
    this.writeResults = [...writeResults];
  }

  write(payload) {
    this.writes.push(payload);
    this.writableLength += Buffer.byteLength(payload, "utf8");
    return this.writeResults.length > 0 ? this.writeResults.shift() : true;
  }

  removeListener(event, listener) {
    return super.removeListener(event, listener);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}

describe("createNdjsonReader", () => {
  it("reassembles messages split across chunk boundaries", () => {
    const seen = [];
    const feed = createNdjsonReader((m) => seen.push(m));
    feed('{"type":"a"');
    feed(',"n":1}\n{"type":"b"}\n{"ty');
    feed('pe":"c"}\n');
    expect(seen).toEqual([{ type: "a", n: 1 }, { type: "b" }, { type: "c" }]);
  });

  it("tolerates CRLF and blank lines, reports bad JSON without dying", () => {
    const seen = [];
    const errors = [];
    const feed = createNdjsonReader(
      (m) => seen.push(m),
      (e) => errors.push(e),
    );
    feed('{"type":"a"}\r\n\r\nnot-json\n{"type":"b"}\n');
    expect(seen).toEqual([{ type: "a" }, { type: "b" }]);
    expect(errors).toHaveLength(1);
  });
});

describe("createBoundedSocketWriter", () => {
  it("queues after backpressure and flushes in order on drain", () => {
    const socket = new BackpressuredSocket([false, true, true]);
    const writer = createBoundedSocketWriter(socket, {
      messages: 4,
      bytes: 4096,
    });

    expect(writer.write({ sequence: 1 })).toBe(true);
    expect(writer.write({ sequence: 2 })).toBe(true);
    expect(writer.write({ sequence: 3 })).toBe(true);
    expect(writer.state()).toMatchObject({
      queuedMessages: 2,
      waitingForDrain: true,
      overflowed: false,
    });

    socket.writableLength = 0;
    socket.emit("drain");
    expect(socket.writes.map((line) => JSON.parse(line).sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(writer.state()).toMatchObject({
      queuedMessages: 0,
      queuedBytes: 0,
      waitingForDrain: false,
    });
  });

  it("disconnects a slow consumer at the message cap", () => {
    const socket = new BackpressuredSocket([false]);
    const onOverflow = vi.fn();
    const writer = createBoundedSocketWriter(socket, {
      messages: 2,
      bytes: 4096,
      onOverflow,
    });

    expect(writer.write({ sequence: 1 })).toBe(true);
    expect(writer.write({ sequence: 2 })).toBe(true);
    expect(writer.write({ sequence: 3 })).toBe(true);
    expect(writer.write({ sequence: 4 })).toBe(false);
    expect(socket.destroyed).toBe(true);
    expect(onOverflow).toHaveBeenCalledOnce();
    expect(writer.state()).toMatchObject({ overflowed: true, closed: true });
  });

  it("counts native and application buffers against the byte cap", () => {
    const socket = new BackpressuredSocket([false]);
    const writer = createBoundedSocketWriter(socket, {
      messages: BACKGROUND_SESSION_BACKLOG_LIMITS.messages,
      bytes: 1024,
    });

    expect(writer.write({ body: "x".repeat(700) })).toBe(true);
    expect(writer.write({ body: "y".repeat(400) })).toBe(false);
    expect(socket.destroyed).toBe(true);
    expect(writer.state().overflowed).toBe(true);
  });
});

describe("background session transport", () => {
  let dir;
  let servers;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-bg-transport-"));
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) {
      await server.close().catch(() => {});
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function uniqueId() {
    return `bg-${Date.now()}-${randomBytes(4).toString("hex")}`;
  }

  async function startServer(overrides = {}) {
    const id = uniqueId();
    const token = "tok-secret";
    const prompts = [];
    const clientCounts = [];
    const server = await startBackgroundSessionServer({
      id,
      dir,
      token,
      getStatus: () => ({ id, phase: "turn", turn: 1, interactive: true }),
      onPrompt: (text) => {
        prompts.push(text);
        return { queued: prompts.length };
      },
      onClientChange: (count) => clientCounts.push(count),
      ...overrides,
    });
    servers.push(server);
    return { id, token, server, prompts, clientCounts };
  }

  it("authenticates with the token and answers hello with status", async () => {
    const { token, server } = await startServer();
    const conn = await connectBackgroundSession({
      pipePath: server.pipePath,
      token,
    });
    expect(conn.hello).toMatchObject({
      type: "hello",
      phase: "turn",
      interactive: true,
    });
    expect(server.clientCount()).toBe(1);
    conn.close();
  });

  it("rejects a wrong token", async () => {
    const { server } = await startServer();
    await expect(
      connectBackgroundSession({
        pipePath: server.pipePath,
        token: "wrong",
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
    expect(server.clientCount()).toBe(0);
  });

  it("queues prompts, relays onPrompt errors, and answers status", async () => {
    const { token, server, prompts } = await startServer({
      onPrompt: (text) => {
        if (text === "boom") throw new Error("no follow-up support");
        prompts.push(text);
        return { queued: prompts.length };
      },
    });
    const events = [];
    const conn = await connectBackgroundSession({
      pipePath: server.pipePath,
      token,
      onEvent: (m) => events.push(m),
    });

    conn.send({ type: "prompt", text: "  do the thing  " });
    conn.send({ type: "prompt", text: "boom" });
    conn.send({ type: "prompt", text: "" });
    conn.send({ type: "status" });
    await vi.waitFor(() => {
      expect(events).toHaveLength(4);
    });
    expect(prompts).toEqual(["do the thing"]);
    expect(events[0]).toMatchObject({ type: "accepted", queued: 1 });
    expect(events[1]).toMatchObject({
      type: "error",
      message: "no follow-up support",
    });
    expect(events[2]).toMatchObject({ type: "error" });
    expect(events[3]).toMatchObject({ type: "status", phase: "turn" });
    conn.close();
  });

  it("broadcasts worker events to attached clients and tracks detach", async () => {
    const { token, server, clientCounts } = await startServer();
    const events = [];
    const conn = await connectBackgroundSession({
      pipePath: server.pipePath,
      token,
      onEvent: (m) => events.push(m),
    });
    server.broadcast({ type: "turn-started", turn: 2, prompt: "next" });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "turn-started",
        turn: 2,
        prompt: "next",
      });
    });

    conn.close();
    await vi.waitFor(() => {
      expect(server.clientCount()).toBe(0);
    });
    expect(clientCounts).toContain(1);
    expect(clientCounts).toContain(0);
  });

  it("uses a named pipe on Windows and a socket file elsewhere", () => {
    const path = transportPipePath("bg-x", "/tmp/dir");
    if (process.platform === "win32") {
      expect(path).toBe("\\\\.\\pipe\\cc-bg-bg-x");
    } else {
      expect(path).toBe("/tmp/dir/bg-x.sock");
    }
  });

  it("hashes long POSIX attach endpoints before Darwin can truncate them", () => {
    const directory = `/private/var/folders/${"nested/".repeat(12)}background-agents`;
    const options = { platform: "darwin", tempDirectory: "/tmp", uid: 501 };
    const first = transportPipePath(
      "bg-1786854302136-5be605",
      directory,
      options,
    );
    const second = transportPipePath(
      "bg-1786854302136-5be606",
      directory,
      options,
    );
    const otherRoot = transportPipePath(
      "bg-1786854302136-5be605",
      `${directory}-other`,
      options,
    );

    expect(first).toMatch(/^\/tmp\/cc-bgs-[a-f0-9]{24}\/[a-f0-9]{32}\.sock$/u);
    expect(Buffer.byteLength(first, "utf8")).toBeLessThanOrEqual(103);
    expect(new Set([first, second, otherRoot]).size).toBe(3);
    expect(transportPipePath("bg-short", "/tmp/agents", options)).toBe(
      "/tmp/agents/bg-short.sock",
    );
  });
});
