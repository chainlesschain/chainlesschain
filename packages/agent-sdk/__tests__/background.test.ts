/**
 * Integration test: real net server on a local pipe speaking the
 * background-session protocol, exercised through attachBackgroundSession.
 */
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { attachBackgroundSession } from "../src/background.js";
import { createNdjsonDecoder, encodeNdjson } from "../src/ndjson.js";

const TOKEN = "test-token-123";

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
    await new Promise((r) => setTimeout(r, 150));
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
