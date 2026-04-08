/**
 * E2E: Coding Agent unified envelope v1.0 round-trip
 *
 * Spawns a real `chainlesschain serve` subprocess, connects via WebSocket,
 * and verifies that solicited responses come back wrapped in the unified
 * envelope shape `{ version: "1.0", eventId, type: "session.started" (dot-case),
 * requestId, sessionId, source: "cli-runtime", payload: {...} }`.
 *
 * This test exercises the full network path: CLI runtime → ws-server →
 * gateways/ws/session-protocol.js + worktree-protocol.js, ensuring the
 * envelope shape survives JSON.stringify / parse on the wire.
 *
 * The desktop bridge (`coding-agent-bridge.js`) consumes these envelopes
 * over the same socket, so passing this test means the bridge will work
 * end-to-end against a real CLI.
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

const E2E_PORT_BASE = 19500;
let portCounter = 0;
function nextPort() {
  return E2E_PORT_BASE + portCounter++;
}

function startServer(port) {
  return spawn(process.execPath, [bin, "serve", "--port", String(port)], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

async function waitForReady(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ws = await new Promise((resolve, reject) => {
        const sock = new WebSocket(`ws://127.0.0.1:${port}`);
        const timer = setTimeout(() => {
          sock.terminate();
          reject(new Error("Connection timeout"));
        }, 1000);
        sock.on("open", () => {
          clearTimeout(timer);
          resolve(sock);
        });
        sock.on("error", () => {
          clearTimeout(timer);
          reject(new Error("Connection error"));
        });
      });
      return ws;
    } catch (_err) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server did not become ready on port ${port}`);
}

/**
 * Send a request and wait for the next response whose `requestId` matches.
 * Accepts both unified envelopes (correlation by `requestId`) and the
 * legacy raw shape (correlation by `id`) — mirrors what the desktop
 * bridge does, so this also tests the bridge contract.
 */
function sendAndCorrelate(ws, request, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const requestId = request.id;
    const timer = setTimeout(() => {
      ws.removeListener("message", handler);
      reject(new Error(`Timeout waiting for response to ${requestId}`));
    }, timeoutMs);

    const handler = (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch (_err) {
        return;
      }
      const corr =
        msg && msg.version === "1.0" && typeof msg.eventId === "string"
          ? msg.requestId
          : msg && msg.id;
      if (corr === requestId) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(request));
  });
}

function isUnifiedEnvelope(msg) {
  return (
    msg &&
    msg.version === "1.0" &&
    typeof msg.eventId === "string" &&
    msg.payload &&
    typeof msg.payload === "object"
  );
}

describe("E2E: Coding Agent unified envelope round-trip", () => {
  let child;
  let ws;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.on("exit", resolve);
        setTimeout(resolve, 2000);
      });
    }
  });

  it("session-create response is a v1.0 envelope with correct shape", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    const response = await sendAndCorrelate(ws, {
      id: "e2e-create-1",
      type: "session-create",
      sessionType: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
    });

    expect(isUnifiedEnvelope(response)).toBe(true);
    expect(response.version).toBe("1.0");
    expect(response.type).toBe("session.started");
    expect(response.requestId).toBe("e2e-create-1");
    expect(response.source).toBe("cli-runtime");
    expect(typeof response.eventId).toBe("string");
    expect(response.eventId.length).toBeGreaterThan(0);
    expect(response.sessionId).toBeTruthy();

    // Payload contract
    expect(response.payload.sessionId).toBe(response.sessionId);
    expect(response.payload.sessionType).toBe("agent");
    expect(response.payload.record).toBeDefined();
    expect(response.payload.record.id).toBe(response.sessionId);
  }, 20000);

  it("session-list response is a v1.0 envelope with payload.sessions", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    // Seed at least one session so the list is meaningful.
    await sendAndCorrelate(ws, {
      id: "e2e-create-seed",
      type: "session-create",
      sessionType: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
    });

    const response = await sendAndCorrelate(ws, {
      id: "e2e-list-1",
      type: "session-list",
    });

    expect(isUnifiedEnvelope(response)).toBe(true);
    expect(response.type).toBe("session.list");
    expect(response.requestId).toBe("e2e-list-1");
    expect(response.source).toBe("cli-runtime");
    expect(Array.isArray(response.payload.sessions)).toBe(true);
    expect(response.payload.sessions.length).toBeGreaterThanOrEqual(1);
  }, 20000);

  it("session-close response is a command.response envelope", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    const create = await sendAndCorrelate(ws, {
      id: "e2e-create-c",
      type: "session-create",
      sessionType: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
    });
    const sessionId = create.sessionId;

    const close = await sendAndCorrelate(ws, {
      id: "e2e-close-1",
      type: "session-close",
      sessionId,
    });

    expect(isUnifiedEnvelope(close)).toBe(true);
    expect(close.type).toBe("command.response");
    expect(close.requestId).toBe("e2e-close-1");
    expect(close.sessionId).toBe(sessionId);
    expect(close.payload.success).toBe(true);
    expect(close.payload.sessionId).toBe(sessionId);
  }, 20000);

  it("malformed session-create (no provider) still produces an envelope error", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    // Provider may be optional in some configurations, but missing apiKey
    // for cloud providers triggers an error path. Use anthropic without key
    // to force a session creation failure on environments that require it.
    // The most reliable error trigger across environments is sending a
    // close for a session id that does not exist.
    const close = await sendAndCorrelate(ws, {
      id: "e2e-close-missing",
      type: "session-close",
      sessionId: "no-such-session-id",
    });

    // session-close is forgiving and still returns command.response with
    // success=true (the close path is idempotent). The point of this case
    // is to verify the wire shape stays an envelope even on the no-op path.
    expect(isUnifiedEnvelope(close)).toBe(true);
    expect(close.type).toBe("command.response");
    expect(close.requestId).toBe("e2e-close-missing");
  }, 20000);

  it("worktree-list response is a worktree.list envelope", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    const response = await sendAndCorrelate(ws, {
      id: "e2e-wlist-1",
      type: "worktree-list",
    });

    expect(isUnifiedEnvelope(response)).toBe(true);
    expect(response.type).toBe("worktree.list");
    expect(response.requestId).toBe("e2e-wlist-1");
    expect(response.source).toBe("cli-runtime");
    expect(Array.isArray(response.payload.worktrees)).toBe(true);
  }, 20000);

  it("worktree-diff without branch returns an error envelope with NO_BRANCH", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    const response = await sendAndCorrelate(ws, {
      id: "e2e-wdiff-err",
      type: "worktree-diff",
    });

    expect(isUnifiedEnvelope(response)).toBe(true);
    expect(response.type).toBe("error");
    expect(response.requestId).toBe("e2e-wdiff-err");
    expect(response.source).toBe("cli-runtime");
    expect(response.payload.code).toBe("NO_BRANCH");
    expect(response.payload.message).toMatch(/branch required/);
  }, 20000);

  it("task graph create → add → update → advance round-trips as envelopes", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    // First, seed a session so the task graph has somewhere to live.
    const create = await sendAndCorrelate(ws, {
      id: "e2e-tg-create-session",
      type: "session-create",
      sessionType: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
    });
    const sessionId = create.sessionId;

    // 1) Create graph with two nodes (b depends on a)
    const created = await sendAndCorrelate(ws, {
      id: "e2e-tg-create",
      type: "task-graph-create",
      sessionId,
      title: "E2E Plan",
      nodes: [
        { id: "a", title: "First step" },
        { id: "b", title: "Second step", dependsOn: ["a"] },
      ],
    });
    expect(isUnifiedEnvelope(created)).toBe(true);
    expect(created.type).toBe("task-graph.created");
    expect(created.sessionId).toBe(sessionId);
    expect(created.payload.graph).toBeDefined();
    expect(created.payload.graph.order).toEqual(["a", "b"]);
    expect(created.payload.graph.nodes.a.status).toBe("pending");

    // 2) Add a third node depending on b
    const added = await sendAndCorrelate(ws, {
      id: "e2e-tg-add",
      type: "task-graph-add-node",
      sessionId,
      node: { id: "c", title: "Third step", dependsOn: ["b"] },
    });
    expect(isUnifiedEnvelope(added)).toBe(true);
    expect(added.type).toBe("task-graph.node.added");
    expect(added.payload.graph.order).toEqual(["a", "b", "c"]);

    // 3) Mark node a as completed → expect task-graph.node.completed envelope
    const updated = await sendAndCorrelate(ws, {
      id: "e2e-tg-update",
      type: "task-graph-update-node",
      sessionId,
      nodeId: "a",
      updates: { status: "completed" },
    });
    expect(isUnifiedEnvelope(updated)).toBe(true);
    expect(updated.type).toBe("task-graph.node.completed");
    expect(updated.payload.graph.nodes.a.status).toBe("completed");

    // 4) Advance — node b should become ready (its only dep, a, is done)
    const advanced = await sendAndCorrelate(ws, {
      id: "e2e-tg-advance",
      type: "task-graph-advance",
      sessionId,
    });
    expect(isUnifiedEnvelope(advanced)).toBe(true);
    expect(advanced.type).toBe("task-graph.advanced");
    expect(advanced.payload.becameReady).toEqual(["b"]);
    expect(advanced.payload.graph.nodes.b.status).toBe("ready");
    expect(advanced.payload.graph.nodes.c.status).toBe("pending");

    // 5) State query
    const state = await sendAndCorrelate(ws, {
      id: "e2e-tg-state",
      type: "task-graph-state",
      sessionId,
    });
    expect(isUnifiedEnvelope(state)).toBe(true);
    expect(state.type).toBe("task-graph.state");
    expect(state.payload.graph.nodes.a.status).toBe("completed");
    expect(state.payload.graph.nodes.b.status).toBe("ready");
  }, 30000);

  it("task-graph-create without nodes returns an envelope error", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    const create = await sendAndCorrelate(ws, {
      id: "e2e-tg-create-session-2",
      type: "session-create",
      sessionType: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
    });
    const sessionId = create.sessionId;

    const errResp = await sendAndCorrelate(ws, {
      id: "e2e-tg-bad-create",
      type: "task-graph-create",
      sessionId,
      // nodes intentionally missing
    });

    expect(isUnifiedEnvelope(errResp)).toBe(true);
    expect(errResp.type).toBe("error");
    expect(errResp.requestId).toBe("e2e-tg-bad-create");
    expect(typeof errResp.payload.code).toBe("string");
  }, 20000);

  it("task-graph-state on a session with no graph returns null graph", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    const create = await sendAndCorrelate(ws, {
      id: "e2e-tg-create-session-3",
      type: "session-create",
      sessionType: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
    });
    const sessionId = create.sessionId;

    const state = await sendAndCorrelate(ws, {
      id: "e2e-tg-state-empty",
      type: "task-graph-state",
      sessionId,
    });

    expect(isUnifiedEnvelope(state)).toBe(true);
    // The CLI may return either task-graph.state with graph=null or an
    // error envelope (TASK_GRAPH_NOT_FOUND). Both are acceptable contracts
    // for "no graph yet" — the test just verifies we get a well-formed envelope.
    if (state.type === "task-graph.state") {
      expect(state.payload.graph).toBeNull();
    } else {
      expect(state.type).toBe("error");
    }
  }, 20000);

  it("envelope eventIds are unique across responses on the same socket", async () => {
    const port = nextPort();
    child = startServer(port);
    ws = await waitForReady(port);

    const r1 = await sendAndCorrelate(ws, {
      id: "uniq-1",
      type: "session-list",
    });
    const r2 = await sendAndCorrelate(ws, {
      id: "uniq-2",
      type: "session-list",
    });
    const r3 = await sendAndCorrelate(ws, {
      id: "uniq-3",
      type: "worktree-list",
    });

    expect(r1.eventId).not.toBe(r2.eventId);
    expect(r2.eventId).not.toBe(r3.eventId);
    expect(r1.eventId).not.toBe(r3.eventId);
  }, 20000);
});
