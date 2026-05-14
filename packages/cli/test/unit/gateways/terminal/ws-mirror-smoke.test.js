/**
 * cc ui mirror smoke — proves that the terminal.* WS topics work through
 * the cc-ui-side WS gateway by attaching the handlers to a real
 * `ChainlessChainWSServer` using the shared `attachTopicHandlers` helper
 * (the same helper that desktop web-shell uses). node-pty is mocked so
 * no native binding is required.
 *
 * Equivalent of desktop's
 * `desktop-app-vue/tests/integration/terminal-ws-smoke.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { ChainlessChainWSServer } from "../../../../src/gateways/ws/ws-server.js";
import { attachTopicHandlers } from "../../../../src/gateways/ws/topic-handler-attachment.js";
import { PtyManager } from "../../../../src/gateways/terminal/PtyManager.js";
import { createTerminalHandlers } from "../../../../src/gateways/terminal/terminal-handlers.js";

function makeFakeNodePty() {
  const spawned = [];
  let active = null;
  return {
    mod: {
      spawn() {
        const proc = {
          pid: 5151 + spawned.length,
          writes: [],
          resizes: [],
          killed: false,
          write(s) {
            this.writes.push(s);
          },
          resize(c, r) {
            this.resizes.push({ c, r });
          },
          kill() {
            this.killed = true;
          },
          onData(cb) {
            this.__dataCb = cb;
          },
          onExit(cb) {
            this.__exitCb = cb;
          },
        };
        spawned.push(proc);
        active = proc;
        return proc;
      },
    },
    getSpawned: () => spawned,
    getActive: () => active,
  };
}

async function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForFrame(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const onMsg = (raw) => {
      let f;
      try {
        f = JSON.parse(raw.toString("utf-8"));
      } catch {
        return;
      }
      seen.push(f);
      const match =
        typeof predicate === "function" ? predicate(f) : f.type === predicate;
      if (match) {
        ws.off("message", onMsg);
        clearTimeout(t);
        resolve(f);
      }
    };
    const t = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error(`waitForFrame timeout. saw=${JSON.stringify(seen)}`));
    }, timeoutMs);
    ws.on("message", onMsg);
  });
}

describe("cc ui mirror: terminal.* WS round-trip", () => {
  let server, wsClient, fakePty, ptyManager;

  beforeEach(async () => {
    fakePty = makeFakeNodePty();
    ptyManager = new PtyManager({
      _deps: { loadNodePty: () => fakePty.mod },
    });
    const broadcastRef = { current: null };
    const terminal = createTerminalHandlers({
      ptyManager,
      broadcast: (f) => broadcastRef.current?.(f),
    });

    server = new ChainlessChainWSServer({
      port: 0,
      host: "127.0.0.1",
      token: null,
    });
    server.on("error", () => {});
    await server.start();
    const attached = attachTopicHandlers(server, {
      handlers: terminal.handlers,
    });
    broadcastRef.current = attached.broadcast;
    terminal.attachServerEvents();

    wsClient = await openWs(`ws://${server.host}:${server.port}/`);
  });

  afterEach(async () => {
    try {
      wsClient?.close();
    } catch {
      /* ignore */
    }
    try {
      ptyManager.shutdown();
    } catch {
      /* ignore */
    }
    await server?.stop();
  });

  it("terminal.create returns sessionId and pid through cc ui WS path", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh", cols: 80, rows: 24 },
      }),
    );
    const f = await waitForFrame(wsClient, "terminal.create.result");
    expect(f.ok).toBe(true);
    expect(f.result.sessionId).toBeTruthy();
    expect(f.result.pid).toBe(5151);
    expect(fakePty.getSpawned()).toHaveLength(1);
  });

  it("stdin → stdout push round-trip through cc ui WS", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh" },
      }),
    );
    const created = await waitForFrame(wsClient, "terminal.create.result");
    const sessionId = created.result.sessionId;

    const data = Buffer.from("ls\r", "utf-8").toString("base64");
    wsClient.send(
      JSON.stringify({
        id: "r2",
        type: "terminal.stdin",
        payload: { sessionId, data },
      }),
    );
    await waitForFrame(wsClient, "terminal.stdin.result");
    expect(fakePty.getActive().writes).toEqual(["ls\r"]);

    // Simulate fake pty emitting data → broadcast → client
    fakePty.getActive().__dataCb("a/  b/  c/\r\n");
    const stdout = await waitForFrame(wsClient, "terminal.stdout");
    expect(Buffer.from(stdout.payload.data, "base64").toString("utf-8")).toBe(
      "a/  b/  c/\r\n",
    );
  });

  it("native CLI ping still works after attachTopicHandlers wraps dispatcher", async () => {
    // Sanity check — wrapping must NOT shadow CLI's native routes (auth/ping/execute).
    wsClient.send(JSON.stringify({ id: "p1", type: "ping" }));
    const f = await waitForFrame(wsClient, (m) => m.id === "p1");
    // Server responds with type === 'pong' for ping requests
    expect(f.type === "pong" || f.ok !== false).toBe(true);
  });
});
