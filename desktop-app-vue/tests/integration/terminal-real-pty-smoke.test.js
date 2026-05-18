/**
 * Real-PTY smoke — actually spawns a shell on the host and verifies
 * the round-trip (stdin → real shell → stdout → ws push). Skipped when
 * node-pty's native binding isn't loadable (e.g. unsupported Node /
 * Electron ABI, missing prebuild).
 *
 * Distinct from `terminal-ws-smoke.test.js` which uses a fake node-pty.
 * This is the "is the binding actually wired?" sanity check; expect to
 * see a real prompt + a real echo of `echo` output.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { startWsCliBackend } from "../../src/main/web-shell/ws-cli-loader.js";
import terminalHandlersPkg from "../../src/main/web-shell/handlers/terminal-handlers.js";
import ptyManagerPkg from "../../src/main/terminal/PtyManager.js";

const { createTerminalHandlers } = terminalHandlersPkg;
const { PtyManager } = ptyManagerPkg;

let nodePtyAvailable = false;
let nodePtyLoadError = null;

try {
  // Lazy probe — never let module top-level throw.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("node-pty");
  nodePtyAvailable = true;
} catch (e) {
  nodePtyLoadError = e?.message || String(e);
}

async function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForFrame(ws, predicate, timeoutMs = 10000) {
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
      reject(
        new Error(
          `waitForFrame timeout. types seen: ${seen.map((s) => s.type).join(", ")}`,
        ),
      );
    }, timeoutMs);
    ws.on("message", onMsg);
  });
}

// Wait until at least one stdout frame's decoded data contains `needle`.
// Buffers and concatenates because real shells emit prompt+banner over
// multiple chunks. 10s timeout is generous to cover pwsh cold-start.
function waitForStdoutContaining(ws, sessionId, needle, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const seenChunks = [];
    let accumulated = "";
    const onMsg = (raw) => {
      let f;
      try {
        f = JSON.parse(raw.toString("utf-8"));
      } catch {
        return;
      }
      if (f.type !== "terminal.stdout") {
        return;
      }
      if (f.payload?.sessionId !== sessionId) {
        return;
      }
      const text = Buffer.from(f.payload.data, "base64").toString("utf-8");
      seenChunks.push(text);
      accumulated += text;
      if (accumulated.includes(needle)) {
        ws.off("message", onMsg);
        clearTimeout(t);
        resolve({ text: accumulated, chunks: seenChunks });
      }
    };
    const t = setTimeout(() => {
      ws.off("message", onMsg);
      reject(
        new Error(
          `Waiting for "${needle}" timed out after ${timeoutMs}ms. Accumulated:\n` +
            accumulated,
        ),
      );
    }, timeoutMs);
    ws.on("message", onMsg);
  });
}

describe.skipIf(!nodePtyAvailable)(
  "real PTY smoke (node-pty actually loads)",
  () => {
    let server, wsClient, ptyManager;

    beforeAll(() => {
      if (!nodePtyAvailable) {
        console.warn(
          "[real-pty smoke] node-pty unavailable:",
          nodePtyLoadError,
        );
      }
    });

    beforeEach(async () => {
      ptyManager = new PtyManager();
      const broadcastRef = { current: null };
      const terminal = createTerminalHandlers({
        ptyManager,
        broadcast: (f) => broadcastRef.current?.(f),
      });
      server = await startWsCliBackend({
        host: "127.0.0.1",
        port: 0,
        token: null,
        handlers: terminal.handlers,
      });
      broadcastRef.current = server.broadcast;
      terminal.attachServerEvents();
      wsClient = await openWs(server.url);
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

    it("spawns a real shell and echoes a stdin command's output", async () => {
      // Pick a shell that's reliably present on Windows + POSIX dev boxes.
      // cmd.exe is always present on Win; bash is the POSIX fallback.
      const shell = process.platform === "win32" ? "cmd" : "bash";
      wsClient.send(
        JSON.stringify({
          id: "r1",
          type: "terminal.create",
          payload: { shell, cols: 80, rows: 24 },
        }),
      );
      const created = await waitForFrame(
        wsClient,
        "terminal.create.result",
        15000,
      );
      expect(created.ok).toBe(true);
      expect(created.result.sessionId).toBeTruthy();
      expect(typeof created.result.pid).toBe("number");
      const sessionId = created.result.sessionId;

      // Wait for first prompt-ish output (most shells print something before
      // first stdin lands — banner, prompt, etc). 8s window for pwsh cold
      // start; cmd is faster.
      await new Promise((r) => setTimeout(r, 800));

      // Send a stdin command whose output we can match exactly.
      const probe = "PLAN_A_PROBE_42";
      const stdinPayload =
        shell === "cmd" ? `echo ${probe}\r\n` : `echo ${probe}\n`;
      wsClient.send(
        JSON.stringify({
          id: "r2",
          type: "terminal.stdin",
          payload: {
            sessionId,
            data: Buffer.from(stdinPayload, "utf-8").toString("base64"),
          },
        }),
      );

      const { text } = await waitForStdoutContaining(
        wsClient,
        sessionId,
        probe,
        10000,
      );
      expect(text).toContain(probe);

      // Clean up so the afterEach pty shutdown doesn't race with a still-
      // active shell. Best-effort exit cmd; close() will SIGKILL otherwise.
      const closeStdin = shell === "cmd" ? "exit\r\n" : "exit\n";
      wsClient.send(
        JSON.stringify({
          id: "r3",
          type: "terminal.stdin",
          payload: {
            sessionId,
            data: Buffer.from(closeStdin, "utf-8").toString("base64"),
          },
        }),
      );
      // Allow time for exit; afterEach will force shutdown anyway.
    }, 30000);
  },
);
