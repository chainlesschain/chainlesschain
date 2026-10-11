import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertPortFree,
  waitForPortFree,
} from "../lib/verify01-diagnostic-port.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (server.listening)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
}

test("HTTP unready still waits for the listener to release the port", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(503, { Connection: "close" });
    response.end("shutting down");
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}`);
    assert.equal(response.status, 503);
    await response.text();
    let completed = false;
    const waiting = waitForPortFree({
      port,
      deadline: Date.now() + 2000,
      pollIntervalMs: 10,
    }).then(() => {
      completed = true;
    });
    await delay(100);
    assert.equal(completed, false);
    await close(server);
    await waiting;
    assert.equal(completed, true);
    await assertPortFree({ port });
  } finally {
    await close(server);
  }
});

test("persistent occupancy fails at the supplied deadline with EADDRINUSE", async () => {
  const server = net.createServer();
  const port = await listen(server);
  try {
    const deadline = Date.now() + 100;
    await assert.rejects(
      waitForPortFree({ port, deadline, pollIntervalMs: 10 }),
      (error) => {
        assert.equal(error.code, "EADDRINUSE");
        assert.equal(error.port, port);
        assert.ok(Date.now() >= deadline);
        return true;
      },
    );
    assert.equal(server.listening, true);
  } finally {
    await close(server);
  }
});

test("other listen errors fail without waiting for the shutdown deadline", async () => {
  const deadline = Date.now() + 60000;
  await assert.rejects(waitForPortFree({ port: -1, deadline }), {
    code: "ERR_SOCKET_BAD_PORT",
  });
  assert.ok(Date.now() < deadline);
});

test("missing or non-finite shutdown deadlines are rejected", async () => {
  for (const deadline of [undefined, NaN, Infinity, -Infinity])
    await assert.rejects(waitForPortFree({ port: 0, deadline }), {
      name: "TypeError",
      message: "A finite absolute shutdown deadline is required",
    });
});

test("an expired deadline cannot admit even a free port", async () => {
  await assert.rejects(waitForPortFree({ port: 0, deadline: Date.now() - 1 }), {
    code: "CC_DIAGNOSTIC_PORT_DEADLINE_EXCEEDED",
  });
});

test("invalid polling intervals are rejected", async () => {
  for (const pollIntervalMs of [0, -1, NaN, Infinity])
    await assert.rejects(
      waitForPortFree({
        port: 0,
        deadline: Date.now() + 60000,
        pollIntervalMs,
      }),
      { name: "TypeError" },
    );
});
