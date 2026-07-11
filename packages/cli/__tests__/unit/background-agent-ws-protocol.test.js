/**
 * bg-* WS protocol — the web-panel/IDE bridge onto the background-session
 * transport. List/view are read paths over the supervisor state dir; attach /
 * prompt / stop-turn / detach run against a REAL transport server so the
 * relay is exercised end-to-end (auth handshake, event push, log delta poll,
 * token never crossing the WS boundary).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  cleanupBgAttachments,
  handleBgAttach,
  handleBgDetach,
  handleBgList,
  handleBgPrompt,
  handleBgStopTurn,
  handleBgView,
  sanitizeBackgroundSession,
} from "../../src/gateways/ws/background-agent-protocol.js";
import {
  _deps,
  logPath,
  writeBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";
import { startBackgroundSessionServer } from "../../src/lib/background-session-transport.js";

let dir;
let servers;
const originalReadStart = _deps.readProcessStartTimeMs;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-bg-ws-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = dir;
  servers = [];
  // Hermetic pid-identity probe (Gap 1): null → fail-open, so fixtures using
  // pid: process.pid with synthetic startedAt values keep legacy semantics
  // without shelling out to wmic/ps.
  _deps.readProcessStartTimeMs = () => null;
});

afterEach(async () => {
  for (const server of servers) await server.close().catch(() => {});
  delete process.env.CC_BACKGROUND_AGENTS_DIR;
  _deps.readProcessStartTimeMs = originalReadStart;
  rmSync(dir, { recursive: true, force: true });
});

function fakeServer() {
  const client = {};
  const server = {
    sent: [],
    clients: new Map([["c1", client]]),
    _send(ws, payload) {
      this.sent.push(payload);
    },
  };
  return { server, client };
}

async function startWorkerTransport({ token = "tok", onPrompt, onStop } = {}) {
  const bgId = `bg-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const transport = await startBackgroundSessionServer({
    id: bgId,
    dir,
    token,
    getStatus: () => ({ id: bgId, phase: "turn", turn: 1, interactive: true }),
    onPrompt: onPrompt || (() => ({ queued: 1 })),
    onStop: onStop || (() => {}),
  });
  servers.push(transport);
  writeBackgroundAgentState({
    id: bgId,
    status: "running",
    pid: process.pid,
    workerPid: process.pid,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    transport: { pipe: transport.pipePath, token },
  });
  return { bgId, transport };
}

describe("sanitizeBackgroundSession", () => {
  it("strips the takeover token and exposes interactive instead", () => {
    const out = sanitizeBackgroundSession({
      id: "bg-1",
      status: "running",
      transport: { pipe: "p", token: "SECRET" },
    });
    expect(out).toEqual({ id: "bg-1", status: "running", interactive: true });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(
      sanitizeBackgroundSession({ id: "bg-2", status: "completed" })
        .interactive,
    ).toBe(false);
  });
});

describe("bg-list / bg-view", () => {
  it("lists sessions without leaking tokens", async () => {
    writeBackgroundAgentState({
      id: "bg-list-a",
      status: "running",
      pid: process.pid,
      startedAt: 2,
      heartbeatAt: Date.now(),
      transport: { pipe: "\\\\.\\pipe\\x", token: "SECRET" },
    });
    const { server } = fakeServer();
    await handleBgList(server, "1", {}, {});
    expect(server.sent[0].type).toBe("bg-list");
    expect(server.sent[0].sessions[0].interactive).toBe(true);
    expect(JSON.stringify(server.sent)).not.toContain("SECRET");
  });

  it("bg-view returns state + log tail and errors on unknown id", async () => {
    writeBackgroundAgentState({
      id: "bg-view-a",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    writeFileSync(logPath("bg-view-a"), "one\ntwo\n");
    const { server } = fakeServer();
    await handleBgView(server, "1", {}, { bgId: "bg-view-a", lines: 2 });
    expect(server.sent[0]).toMatchObject({ type: "bg-view" });
    expect(server.sent[0].log).toBe("two\n");

    await handleBgView(server, "2", {}, { bgId: "bg-nope-x" });
    expect(server.sent[1]).toMatchObject({
      type: "error",
      code: "BG_NOT_FOUND",
    });
  });
});

describe("bg-attach relay", () => {
  it("attaches, relays prompts/stop, pushes worker events and log deltas", async () => {
    const prompts = [];
    let stopped = 0;
    const { bgId, transport } = await startWorkerTransport({
      onPrompt: (text) => {
        prompts.push(text);
        return { queued: prompts.length };
      },
      onStop: () => {
        stopped++;
      },
    });
    writeFileSync(logPath(bgId), "initial line\n");

    const { server, client } = fakeServer();
    await handleBgAttach(server, "c1", "1", {}, { bgId });
    const attachReply = server.sent.find((m) => m.type === "bg-attach");
    expect(attachReply).toMatchObject({ bgId, hello: { interactive: true } });
    expect(attachReply.log).toContain("initial line");
    expect(JSON.stringify(server.sent)).not.toContain("tok");

    // prompt + stop-turn flow through the live pipe to the worker callbacks
    await handleBgPrompt(server, "c1", "2", {}, { bgId, text: "next task" });
    await handleBgStopTurn(server, "c1", "3", {}, { bgId });
    await vi.waitFor(() => {
      expect(prompts).toEqual(["next task"]);
      expect(stopped).toBe(1);
    });

    // worker broadcast reaches the WS client as a bg-event push
    transport.broadcast({ type: "turn-started", turn: 2, prompt: "next task" });
    await vi.waitFor(() => {
      expect(
        server.sent.some(
          (m) => m.type === "bg-event" && m.event.type === "turn-started",
        ),
      ).toBe(true);
    });

    // log growth is pushed as bg-log deltas
    appendFileSync(logPath(bgId), "turn two output\n");
    await vi.waitFor(
      () => {
        expect(
          server.sent.some(
            (m) => m.type === "bg-log" && m.chunk.includes("turn two output"),
          ),
        ).toBe(true);
      },
      { timeout: 3000 },
    );

    // re-attach is idempotent; detach drops the relay on the worker side too
    await handleBgAttach(server, "c1", "4", {}, { bgId });
    expect(server.sent.find((m) => m.reattached)).toBeTruthy();
    await handleBgDetach(server, "c1", "5", {}, { bgId });
    expect(server.sent.find((m) => m.type === "bg-detach").dropped).toBe(true);
    await vi.waitFor(() => {
      expect(transport.clientCount()).toBe(0);
    });
    expect(client._bgAttachments.size).toBe(0);
  });

  it("rejects prompt/stop-turn without an attachment and attach on dead sessions", async () => {
    writeBackgroundAgentState({
      id: "bg-dead-a",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    const { server } = fakeServer();
    await handleBgAttach(server, "c1", "1", {}, { bgId: "bg-dead-a" });
    expect(server.sent[0]).toMatchObject({
      type: "error",
      code: "BG_NOT_INTERACTIVE",
    });
    await handleBgPrompt(
      server,
      "c1",
      "2",
      {},
      { bgId: "bg-dead-a", text: "x" },
    );
    expect(server.sent[1]).toMatchObject({
      type: "error",
      code: "BG_NOT_ATTACHED",
    });
    await handleBgStopTurn(server, "c1", "3", {}, { bgId: "bg-dead-a" });
    expect(server.sent[2]).toMatchObject({
      type: "error",
      code: "BG_NOT_ATTACHED",
    });
  });

  it("cleanupBgAttachments tears down every relay on client disconnect", async () => {
    const { bgId, transport } = await startWorkerTransport();
    const { server, client } = fakeServer();
    await handleBgAttach(server, "c1", "1", {}, { bgId });
    expect(client._bgAttachments.size).toBe(1);
    cleanupBgAttachments(client);
    expect(client._bgAttachments.size).toBe(0);
    await vi.waitFor(() => {
      expect(transport.clientCount()).toBe(0);
    });
  });
});

describe("bg-rename / bg-resume", () => {
  it("renames a session and returns the sanitized state", async () => {
    writeBackgroundAgentState({
      id: "bg-ren-a",
      status: "running",
      pid: process.pid,
      startedAt: 1,
      heartbeatAt: Date.now(),
      title: "old",
      transport: { pipe: "p", token: "SECRET" },
    });
    const { handleBgRename } =
      await import("../../src/gateways/ws/background-agent-protocol.js");
    const { server } = fakeServer();
    await handleBgRename(server, "1", {}, { bgId: "bg-ren-a", title: " new " });
    expect(server.sent[0]).toMatchObject({
      type: "bg-rename",
      session: { title: "new", interactive: true },
    });
    expect(JSON.stringify(server.sent)).not.toContain("SECRET");
  });

  it("resumes a finished session as a new background run", async () => {
    const supervisor =
      await import("../../src/lib/background-agent-supervisor.js");
    const originalSpawn = supervisor._deps.spawn;
    supervisor._deps.spawn = () => ({ pid: 4242, unref() {} });
    try {
      writeBackgroundAgentState({
        id: "bg-res-a",
        status: "failed",
        sessionId: "sess-9",
        cwd: process.cwd(),
        startedAt: 1,
        endedAt: 2,
      });
      const { handleBgResume } =
        await import("../../src/gateways/ws/background-agent-protocol.js");
      const { server } = fakeServer();
      await handleBgResume(
        server,
        "1",
        {},
        { bgId: "bg-res-a", text: "go on" },
      );
      expect(server.sent[0]).toMatchObject({
        type: "bg-resume",
        session: { sessionId: "sess-9", status: "running" },
      });

      // running sessions are refused
      writeBackgroundAgentState({
        id: "bg-res-live",
        status: "running",
        pid: process.pid,
        sessionId: "sess-live",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      });
      await handleBgResume(
        server,
        "2",
        {},
        { bgId: "bg-res-live", text: "again" },
      );
      expect(server.sent[1]).toMatchObject({
        type: "error",
        code: "BG_RESUME_FAILED",
      });
    } finally {
      supervisor._deps.spawn = originalSpawn;
    }
  });
});

describe("bg-* over the real WS server", () => {
  it("dispatches list/attach/prompt through the wire and pushes worker events", async () => {
    const prompts = [];
    const { bgId, transport } = await startWorkerTransport({
      onPrompt: (text) => {
        prompts.push(text);
        return { queued: prompts.length };
      },
    });

    const { ChainlessChainWSServer } =
      await import("../../src/gateways/ws/ws-server.js");
    const { default: WebSocket } = await import("ws");
    const port = 19000 + Math.floor(Math.random() * 2000);
    const wsServer = new ChainlessChainWSServer({ port });
    await wsServer.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames = [];
    socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const request = (payload) =>
      new Promise((resolve) => {
        const id = `req-${Math.random().toString(16).slice(2)}`;
        const check = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            socket.off("message", check);
            resolve(msg);
          }
        };
        socket.on("message", check);
        socket.send(JSON.stringify({ id, ...payload }));
      });

    try {
      const list = await request({ type: "bg-list", all: true });
      const row = list.sessions.find((s) => s.id === bgId);
      expect(row).toMatchObject({ interactive: true });

      const attach = await request({ type: "bg-attach", bgId });
      expect(attach).toMatchObject({ type: "bg-attach", bgId });
      expect(attach.hello.interactive).toBe(true);

      const prompt = await request({
        type: "bg-prompt",
        bgId,
        text: "wire prompt",
      });
      expect(prompt).toMatchObject({ type: "bg-prompt", sent: true });
      await vi.waitFor(() => {
        expect(prompts).toEqual(["wire prompt"]);
      });

      // worker → panel push path over the real socket
      transport.broadcast({ type: "idle", turn: 1 });
      await vi.waitFor(() => {
        expect(
          frames.some((f) => f.type === "bg-event" && f.event.type === "idle"),
        ).toBe(true);
      });
      // the takeover token never crosses the WS boundary
      expect(JSON.stringify(frames)).not.toContain("tok");

      // dropping the socket cleans the relay server-side
      socket.close();
      await vi.waitFor(() => {
        expect(transport.clientCount()).toBe(0);
      });
    } finally {
      try {
        socket.terminate();
      } catch {
        /* already closed */
      }
      await wsServer.stop?.();
    }
  }, 20000);
});
