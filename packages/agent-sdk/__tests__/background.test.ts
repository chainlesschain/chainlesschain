/**
 * Integration test: real net server on a local pipe speaking the
 * background-session protocol, exercised through attachBackgroundSession.
 */
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachBackgroundSession,
  readBackgroundAgentState,
} from "../src/background.js";
import { createNdjsonDecoder, encodeNdjson } from "../src/ndjson.js";

const TOKEN = "test-token-123";

describe("readBackgroundAgentState", () => {
  it("reads a valid background agent id and rejects path traversal", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-sdk-state-"));
    const file = join(dir, "bg-1.json");
    writeFileSync(file, JSON.stringify({ id: "bg-1", status: "running" }));
    try {
      expect(readBackgroundAgentState("bg-1", dir)).toMatchObject({
        id: "bg-1",
        status: "running",
      });
      for (const id of [
        "../outside",
        "..\\outside",
        "bg-1/../../outside",
        "other",
      ]) {
        expect(() => readBackgroundAgentState(id, dir)).toThrow(
          "Invalid background agent id",
        );
      }
    } finally {
      unlinkSync(file);
      rmdirSync(dir);
    }
  });
});

it("rejects an invalid attach id through its Promise API", async () => {
  await expect(
    attachBackgroundSession({ id: "../outside" }),
  ).rejects.toThrow("Invalid background agent id");
});

function pipePath(name: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\cc-sdk-test-${name}-${process.pid}`;
  }
  return join(tmpdir(), `cc-sdk-test-${name}-${process.pid}.sock`);
}

function startFakeWorker(path: string): Promise<{
  server: net.Server;
  sockets: Set<net.Socket>;
  received: unknown[];
}> {
  const sockets = new Set<net.Socket>();
  const received: unknown[] = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let authed = false;
    socket.on(
      "data",
      createNdjsonDecoder<Record<string, unknown>>((message) => {
        received.push(message);
        if (!authed) {
          if (message.type === "hello" && message.token === TOKEN) {
            authed = true;
            socket.write(
              encodeNdjson({ type: "hello", id: "bg-1", phase: "idle" }),
            );
          } else {
            socket.destroy();
          }
          return;
        }
        if (message.type === "prompt") {
          socket.write(encodeNdjson({ type: "accepted", queued: 1 }));
          socket.write(
            encodeNdjson({ type: "turn-started", turn: 2, prompt: message.text }),
          );
        }
        if (message.type === "status") {
          socket.write(encodeNdjson({ type: "status", phase: "running" }));
        }
      }),
    );
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve({ server, sockets, received }));
  });
}

describe("attachBackgroundSession", () => {
  const servers: net.Server[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise((done) => server.close(done));
    }
  });

  it("authenticates, receives hello, sends prompts, gets events", async () => {
    const path = pipePath("ok");
    const { server, received } = await startFakeWorker(path);
    servers.push(server);

    const events: unknown[] = [];
    const handle = await attachBackgroundSession({
      pipePath: path,
      token: TOKEN,
      onEvent: (event) => events.push(event),
    });
    expect(handle.hello).toEqual(
      expect.objectContaining({ type: "hello", id: "bg-1" }),
    );

    handle.prompt("continue the task");
    await vi.waitFor(() => {
      expect(received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "prompt", text: "continue the task" }),
        ]),
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "accepted", queued: 1 }),
          expect.objectContaining({ type: "turn-started", turn: 2 }),
        ]),
      );
    });

    const binding = {
      backgroundAgentId: "bg-1",
      sessionId: "session-1",
      turnId: "turn-1",
      toolUseId: "tool-1",
      sequence: 1,
    };
    handle.answerInteraction("question-1", binding, "yes");
    await vi.waitFor(() => {
      expect(received).toEqual(
        expect.arrayContaining([
          {
            type: "interaction_response",
            requestId: "question-1",
            binding,
            answer: "yes",
          },
        ]),
      );
    });
    handle.detach();
  });

  it("rejects on a wrong token (server destroys the socket)", async () => {
    const path = pipePath("bad");
    const { server } = await startFakeWorker(path);
    servers.push(server);

    await expect(
      attachBackgroundSession({
        pipePath: path,
        token: "wrong",
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/closed during handshake|timed out/);
  });

  it("rejects a hello for a different background agent", async () => {
    const path = pipePath("wrong-id");
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.write(encodeNdjson({ type: "hello", id: "bg-other" }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));

    try {
      await expect(
        attachBackgroundSession({
          id: "bg-expected",
          pipePath: path,
          token: TOKEN,
          timeoutMs: 2000,
        }),
      ).rejects.toThrow("session transport hello has a different agent id");
    } finally {
      for (const socket of sockets) socket.destroy();
    }
  });

  it.each([
    [
      "status",
      encodeNdjson({ type: "status", phase: "running" }),
      "frame before hello",
    ],
    ["null", "null\n", "invalid frame"],
  ])("rejects a %s frame before hello", async (name, frame, error) => {
    const path = pipePath(`unexpected-${name}`);
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.write(`${frame}${encodeNdjson({ type: "hello", id: "bg-1" })}`);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));

    try {
      await expect(
        attachBackgroundSession({
          pipePath: path,
          token: TOKEN,
          timeoutMs: 2000,
        }),
      ).rejects.toThrow(error);
    } finally {
      for (const socket of sockets) socket.destroy();
    }
  });

  it("rejects a malformed frame before a later hello in the same write", async () => {
    const path = pipePath("malformed");
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.write(
        `not-json\n${encodeNdjson({ type: "hello", id: "bg-1" })}`,
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));

    const onClose = vi.fn();
    try {
      await expect(
        attachBackgroundSession({
          pipePath: path,
          token: TOKEN,
          timeoutMs: 2000,
          onClose,
        }),
      ).rejects.toThrow("session transport sent invalid NDJSON");
    } finally {
      for (const socket of sockets) socket.destroy();
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes an attached connection on a malformed frame", async () => {
    const path = pipePath("malformed-attached");
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.write(
        `${encodeNdjson({ type: "hello", id: "bg-1" })}not-json\n${encodeNdjson({ type: "status", phase: "running" })}`,
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));

    const events: unknown[] = [];
    let notifyClose: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      notifyClose = resolve;
    });
    try {
      const handle = await attachBackgroundSession({
        pipePath: path,
        token: TOKEN,
        timeoutMs: 2000,
        onEvent: (event) => events.push(event),
        onClose: () => notifyClose?.(),
      });
      expect(handle.hello).toMatchObject({ type: "hello", id: "bg-1" });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("attached transport did not close")),
          2000,
        );
        closed.then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      expect(events).toEqual([]);
    } finally {
      for (const socket of sockets) socket.destroy();
    }
  });

  it("times out when the server never answers hello", async () => {
    const path = pipePath("silent");
    const silentSockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      // Accept and stay silent — track the socket so cleanup can destroy
      // it; otherwise afterEach's server.close() waits on it forever.
      silentSockets.add(socket);
      socket.on("close", () => silentSockets.delete(socket));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));

    await expect(
      attachBackgroundSession({
        pipePath: path,
        token: TOKEN,
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/timed out/);
    for (const socket of silentSockets) socket.destroy();
  });
});
