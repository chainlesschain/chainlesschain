import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { test } from "vitest";
import { MCPClient, ServerState } from "../../src/harness/mcp-client.js";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { WebSocketServer, WebSocket } = require("ws");
const SERVER = "delayed-resource";
const URI = "fixture:///pending";
const CANARY = "PRIVATE_ABORT_REASON";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, label);
    await pause(5);
  }
}

function entryFor(kind) {
  return {
    config: { longRunning: true, requestTimeoutMs: 0 },
    state: ServerState.CONNECTED,
    transportKind: kind,
    tools: [],
    resources: [],
    _pending: new Map(),
    _httpDiscardStopping: false,
  };
}

async function exercise(client, entry, messages, afterAbort = async () => {}) {
  const controller = new AbortController();
  let reconnects = 0;
  client.setReconnector(SERVER, async () => {
    reconnects++;
  });
  const pending = client.readResource(SERVER, URI, {
    signal: controller.signal,
  });
  // Observe rejection before triggering cancellation to detect an accidental
  // success without creating an unhandled rejected promise.
  const settled = pending.then(
    () => ({ succeeded: true }),
    (error) => ({ error }),
  );
  await waitFor(
    () => messages.some((m) => m.method === "resources/read"),
    "peer did not receive resource read",
  );
  const request = messages.find((m) => m.method === "resources/read");
  assert.equal(request.params.uri, URI);
  controller.abort(CANARY);
  let deadline;
  const outcome = await Promise.race([
    settled,
    new Promise((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error("resource abort did not settle")),
        1500,
      );
    }),
  ]).finally(() => clearTimeout(deadline));
  assert.equal(outcome.succeeded, undefined);
  assert.equal(outcome.error.code, "CC_MCP_REQUEST_ABORTED");
  assert.equal(outcome.error.dispatched, true);
  assert.ok(!outcome.error.message.includes(CANARY));
  await waitFor(
    () => messages.some((m) => m.method === "notifications/cancelled"),
    "peer did not receive cancellation",
  );
  await afterAbort(request);
  await pause(30);
  assert.equal(messages.filter((m) => m.method === "resources/read").length, 1);
  const notifications = messages.filter(
    (m) => m.method === "notifications/cancelled",
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].params.requestId, request.id);
  assert.ok(!JSON.stringify(notifications).includes(CANARY));
  assert.equal(entry._pending.size, 0);
  assert.equal(entry._httpRequestControllers?.size || 0, 0);
  assert.equal(reconnects, 0);
}

for (const responseMode of ["no-headers", "partial-sse"]) {
  test(
    `real HTTP delayed resource cancellation: ${responseMode}`,
    { timeout: 10000 },
    async () => {
      const client = new MCPClient();
      const messages = [];
      let pendingResponse;
      let resourceClosed = false;
      const server = createServer((request, response) => {
        let input = "";
        request.on("data", (chunk) => {
          input += chunk;
        });
        request.on("end", () => {
          const message = JSON.parse(input);
          messages.push(message);
          if (message.method === "resources/read") {
            pendingResponse = response;
            response.on("close", () => {
              resourceClosed = true;
            });
            if (responseMode === "partial-sse") {
              response.writeHead(200, { "Content-Type": "text/event-stream" });
              response.write(": peer is working\n\n");
            }
          } else {
            response.writeHead(202);
            response.end();
          }
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const url = `http://127.0.0.1:${server.address().port}/mcp`;
      const entry = {
        ...entryFor("http"),
        httpHeaders: {},
        httpSessionId: null,
        httpUrl: url,
        protocolVersion: "2025-11-25",
        _httpMessageStream: null,
        _httpRequestControllers: new Set(),
        _httpDiscardControllers: new Set(),
        _disconnectPromise: null,
      };
      entry.config.url = url;
      client.servers.set(SERVER, entry);
      try {
        await exercise(client, entry, messages, async (request) => {
          await waitFor(
            () => resourceClosed,
            "resource response remained open after caller abort",
          );
          // The peer attempts a success after observing the caller's cancellation.
          pendingResponse.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: { contents: [{ uri: URI, text: "LATE_SUCCESS" }] },
            }),
          );
        });
      } finally {
        await client.disconnectAll();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
}

test(
  "real WebSocket resource cancellation ignores the peer's late success",
  { timeout: 10000 },
  async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const messages = [];
    server.on("connection", (peer) =>
      peer.on("message", (wire) => {
        const message = JSON.parse(String(wire));
        messages.push(message);
        if (message.method === "notifications/cancelled")
          peer.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.params.requestId,
              result: { contents: [{ uri: URI, text: "LATE_SUCCESS" }] },
            }),
          );
      }),
    );
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    await once(socket, "open");
    const client = new MCPClient();
    const entry = { ...entryFor("ws"), socket, process: null };
    let lateResponses = 0;
    socket.on("message", (wire) => {
      client._handleMessage(SERVER, JSON.parse(String(wire)));
      lateResponses++;
    });
    client.servers.set(SERVER, entry);
    try {
      await exercise(client, entry, messages, () =>
        waitFor(
          () => lateResponses === 1,
          "late WebSocket result not observed",
        ),
      );
    } finally {
      await client.disconnectAll();
      for (const peer of server.clients) peer.terminate();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "real stdio resource cancellation settles while peer returns a late success",
  { timeout: 10000 },
  async () => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import readline from "node:readline";
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      process.stderr.write(JSON.stringify(message) + "\\n");
      if (message.method === "notifications/cancelled") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.params.requestId, result: { contents: [{ uri: "fixture:///pending", text: "LATE_SUCCESS" }] } }) + "\\n");
      }
    });
  `,
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const messages = [];
    const client = new MCPClient();
    const entry = { ...entryFor("stdio"), process: child, socket: null };
    client.servers.set(SERVER, entry);
    let out = "",
      err = "",
      lateResponses = 0;
    child.stdout.on("data", (chunk) => {
      out += chunk;
      let newline;
      while ((newline = out.indexOf("\n")) >= 0) {
        client._handleMessage(SERVER, JSON.parse(out.slice(0, newline)));
        lateResponses++;
        out = out.slice(newline + 1);
      }
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
      let newline;
      while ((newline = err.indexOf("\n")) >= 0) {
        messages.push(JSON.parse(err.slice(0, newline)));
        err = err.slice(newline + 1);
      }
    });
    try {
      await exercise(client, entry, messages, () =>
        waitFor(() => lateResponses === 1, "late stdio result not observed"),
      );
    } finally {
      // The fixture has no descendants. Keep ownership of its explicit spawn;
      // this probe does not claim production process-broker coverage.
      child.stdin.end();
      if (child.exitCode === null) {
        child.kill();
        await once(child, "exit");
      }
      client.servers.delete(SERVER);
    }
  },
);
