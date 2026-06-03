/**
 * Phase 1 smoke test for the Plan A remote-terminal pipeline.
 *
 * Boots the real `ws-cli-loader` + `terminal-handlers` with a faked
 * node-pty (no native binding required). Opens a real WS client against
 * the loader's bound port and verifies the end-to-end envelope round-trip:
 *
 *   1. WS auth (token disabled — server.token = null)
 *   2. `terminal.create` → `terminal.create.result` with sessionId
 *   3. `terminal.stdin` → pty.write captured
 *   4. Server emits `terminal.stdout` push frame after we trigger the
 *      fake pty's onData callback
 *   5. `terminal.close` → server emits `terminal.exit` after we trigger
 *      fake exit
 *
 * Equivalent of "user opens DevTools console and pastes ws commands"
 * milestone, but automated + repeatable. No node-pty install, no
 * Electron, no browser.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { startWsCliBackend } from "../../src/main/web-shell/ws-cli-loader.js";
import terminalHandlersPkg from "../../src/main/web-shell/handlers/terminal-handlers.js";
import ptyManagerPkg from "../../src/main/terminal/PtyManager.js";

const { createTerminalHandlers } = terminalHandlersPkg;
const { PtyManager } = ptyManagerPkg;

function makeFakeNodePty() {
  /** @type {{ data?: (s:string)=>void, exit?: (e:any)=>void } | null} */
  let activeHandlers = null;
  const spawned = [];
  return {
    mod: {
      spawn(cmd, args, opts) {
        const proc = {
          pid: 4242 + spawned.length,
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
        // Track most-recent for test triggers; multi-session tests can
        // index into `getSpawned()` directly.
        activeHandlers = proc;
        return proc;
      },
    },
    getSpawned: () => spawned,
    getActive: () => activeHandlers,
  };
}

// Open a WS connection and resolve once the handshake/auth completes.
// `cli-ws-server` requires an auth frame when token != null; we run with
// token=null so dispatch is open immediately.
async function openWsClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

// Wait for a frame whose `type` matches the predicate (string equality or
// function). Times out after 2s with a clear message including all frames
// the client has seen — invaluable when the dispatcher silently rewrites
// the topic.
function waitForFrame(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const onMsg = (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString("utf-8"));
      } catch {
        return; // ignore unparsable frames
      }
      seen.push(frame);
      const match =
        typeof predicate === "function"
          ? predicate(frame)
          : frame.type === predicate;
      if (match) {
        ws.off("message", onMsg);
        clearTimeout(t);
        resolve(frame);
      }
    };
    const t = setTimeout(() => {
      ws.off("message", onMsg);
      reject(
        new Error(
          `waitForFrame timeout (${timeoutMs}ms). predicate=${String(
            predicate,
          )}. saw=${JSON.stringify(seen)}`,
        ),
      );
    }, timeoutMs);
    ws.on("message", onMsg);
  });
}

describe("Phase 1 smoke: terminal.* WS round-trip", () => {
  let ws, fakePty, ptyManager, terminal, server, wsClient;

  beforeEach(async () => {
    fakePty = makeFakeNodePty();
    ptyManager = new PtyManager({
      _deps: { loadNodePty: () => fakePty.mod },
    });
    const broadcastRef = { current: null };
    terminal = createTerminalHandlers({
      ptyManager,
      broadcast: (frame) => broadcastRef.current?.(frame),
    });
    server = await startWsCliBackend({
      host: "127.0.0.1",
      port: 0,
      token: null,
      handlers: terminal.handlers,
    });
    broadcastRef.current = server.broadcast;
    terminal.attachServerEvents();

    wsClient = await openWsClient(server.url);
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
    await server?.close();
  });

  it("terminal.create returns sessionId and pid", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh", cols: 80, rows: 24 },
      }),
    );
    const frame = await waitForFrame(wsClient, "terminal.create.result");
    expect(frame.ok).toBe(true);
    expect(frame.result.sessionId).toBeTruthy();
    expect(frame.result.pid).toBe(4242);
    expect(fakePty.getSpawned()).toHaveLength(1);
  });

  it("terminal.stdin (base64) reaches pty.write", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh" },
      }),
    );
    const created = await waitForFrame(wsClient, "terminal.create.result");
    const sessionId = created.result.sessionId;

    const data = Buffer.from("Get-Date\r", "utf-8").toString("base64");
    wsClient.send(
      JSON.stringify({
        id: "r2",
        type: "terminal.stdin",
        payload: { sessionId, data },
      }),
    );
    await waitForFrame(wsClient, "terminal.stdin.result");
    expect(fakePty.getActive().writes).toEqual(["Get-Date\r"]);
  });

  it("server pushes terminal.stdout when pty emits data", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh" },
      }),
    );
    const created = await waitForFrame(wsClient, "terminal.create.result");
    const sessionId = created.result.sessionId;

    // Trigger fake pty's onData → PtyManager 'stdout' event →
    // terminal-handlers attachServerEvents → ws.broadcast.
    fakePty.getActive().__dataCb("welcome to pwsh\r\n");

    const pushed = await waitForFrame(wsClient, "terminal.stdout");
    expect(pushed.payload.sessionId).toBe(sessionId);
    expect(Buffer.from(pushed.payload.data, "base64").toString("utf-8")).toBe(
      "welcome to pwsh\r\n",
    );
    expect(pushed.payload.seq).toBe(1);
  });

  it("terminal.close kills pty and server pushes terminal.exit", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh" },
      }),
    );
    const created = await waitForFrame(wsClient, "terminal.create.result");
    const sessionId = created.result.sessionId;

    wsClient.send(
      JSON.stringify({
        id: "r2",
        type: "terminal.close",
        payload: { sessionId },
      }),
    );
    await waitForFrame(wsClient, "terminal.close.result");
    expect(fakePty.getActive().killed).toBe(true);

    fakePty.getActive().__exitCb({ exitCode: 0, signal: null });
    const exit = await waitForFrame(wsClient, "terminal.exit");
    expect(exit.payload).toMatchObject({
      sessionId,
      exitCode: 0,
      signal: null,
    });
  });

  it("terminal.history returns base64 chunks with seq + truncated flag", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh" },
      }),
    );
    const created = await waitForFrame(wsClient, "terminal.create.result");
    const sessionId = created.result.sessionId;

    fakePty.getActive().__dataCb("chunk-1");
    fakePty.getActive().__dataCb("chunk-2");

    wsClient.send(
      JSON.stringify({
        id: "r2",
        type: "terminal.history",
        payload: { sessionId, fromSeq: 0 },
      }),
    );
    const res = await waitForFrame(wsClient, "terminal.history.result");
    expect(res.ok).toBe(true);
    expect(res.result.truncated).toBe(false);
    expect(res.result.chunks).toHaveLength(2);
    expect(
      Buffer.from(res.result.chunks[0].data, "base64").toString("utf-8"),
    ).toBe("chunk-1");
    expect(res.result.chunks[0].seq).toBe(1);
  });

  it("dangerous keyword stdin is blocked with dangerous_keyword_blocked", async () => {
    wsClient.send(
      JSON.stringify({
        id: "r1",
        type: "terminal.create",
        payload: { shell: "pwsh" },
      }),
    );
    const created = await waitForFrame(wsClient, "terminal.create.result");
    const sessionId = created.result.sessionId;

    const data = Buffer.from("rm -rf /\r", "utf-8").toString("base64");
    wsClient.send(
      JSON.stringify({
        id: "r2",
        type: "terminal.stdin",
        payload: { sessionId, data },
      }),
    );
    const res = await waitForFrame(wsClient, "terminal.stdin.result");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/dangerous_keyword_blocked/);
    expect(fakePty.getActive().writes).toHaveLength(0);
  });
});
