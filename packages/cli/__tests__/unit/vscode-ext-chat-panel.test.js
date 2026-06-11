/**
 * Chat panel (gap #7 P0) — verified WITHOUT a VS Code host:
 *   1. chat-events: NDJSON → UI-message mapping (delta tracking, dedupe of
 *      the final result text, error shapes).
 *   2. agent-session: child lifecycle + NDJSON marshaling with a fake child
 *      (chunk-boundary splits, raw lines, stderr, exit, spawn failure).
 *   3. a REAL node child speaking the protocol over real pipes.
 * The webview HTML builder gets a CSP/nonce smoke check.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as realSpawn } from "node:child_process";

import {
  mapAgentEvent,
  createTurnState,
  summarizeToolArgs,
} from "../../../vscode-extension/src/chat/chat-events.js";
import { AgentChatSession } from "../../../vscode-extension/src/chat/agent-session.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

// ─── chat-events ─────────────────────────────────────────────────────────────

describe("mapAgentEvent", () => {
  it("maps init / delta / tool / tool_done / info", () => {
    const st = createTurnState();
    expect(
      mapAgentEvent(
        { type: "system", subtype: "init", model: "m", provider: "p" },
        st,
      ),
    ).toMatchObject({ kind: "init", model: "m", provider: "p" });
    expect(
      mapAgentEvent(
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hi" },
          },
        },
        st,
      ),
    ).toEqual({ kind: "delta", text: "hi" });
    expect(
      mapAgentEvent(
        { type: "tool_use", tool: "read_file", args: { path: "a.js" } },
        st,
      ),
    ).toEqual({ kind: "tool", tool: "read_file", summary: "a.js" });
    expect(
      mapAgentEvent({ type: "tool_result", tool: "x", is_error: true }, st),
    ).toEqual({ kind: "tool_done", tool: "x", isError: true });
    expect(
      mapAgentEvent({ type: "compaction", stats: { saved: 42 } }, st),
    ).toEqual({ kind: "info", text: "compacted: saved 42 tokens" });
  });

  it("suppresses the final result text after deltas streamed (no dupes)", () => {
    const st = createTurnState();
    mapAgentEvent(
      {
        type: "stream_event",
        event: { delta: { type: "text_delta", text: "answer" } },
      },
      st,
    );
    const end = mapAgentEvent(
      { type: "result", subtype: "success", result: "answer" },
      st,
    );
    expect(end).toMatchObject({ kind: "turn_end", isError: false, text: null });
    // next turn WITHOUT deltas keeps the result text
    const end2 = mapAgentEvent(
      { type: "result", subtype: "success", result: "plain" },
      st,
    );
    expect(end2.text).toBe("plain");
  });

  it("maps errors and stays silent on UI-irrelevant events", () => {
    const st = createTurnState();
    expect(
      mapAgentEvent(
        { type: "result", subtype: "error", is_error: true, error: "boom" },
        st,
      ),
    ).toMatchObject({ kind: "turn_end", isError: true, text: "boom" });
    expect(
      mapAgentEvent({ type: "session_error", error: "no cc" }, st),
    ).toEqual({ kind: "error", text: "no cc" });
    expect(mapAgentEvent({ type: "token_usage", usage: {} }, st)).toBe(null);
    expect(mapAgentEvent(null, st)).toBe(null);
  });

  it("summarizeToolArgs picks the salient arg and truncates", () => {
    expect(summarizeToolArgs({ path: "x.js" })).toBe("x.js");
    expect(summarizeToolArgs({ command: "ls -la" })).toBe("ls -la");
    expect(summarizeToolArgs({ code: "x".repeat(100) })).toMatch(/…$/);
    expect(summarizeToolArgs(null)).toBe("");
  });
});

// ─── agent-session (fake child) ──────────────────────────────────────────────

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdin.written = "";
  child.stdin.on("data", (c) => (child.stdin.written += c.toString()));
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
  });
  return child;
}

describe("AgentChatSession (fake child)", () => {
  it("spawns with the duplex protocol flags and parses chunk-split NDJSON", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child);
    const events = [];
    const s = new AgentChatSession({
      command: "cc",
      onEvent: (e) => events.push(e),
      deps: { spawn: spawnFn },
    }).start();

    expect(s.running).toBe(true);
    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe("cc");
    expect(args).toEqual(
      expect.arrayContaining([
        "agent",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ]),
    );

    // one event split across two chunks + one raw line
    child.stdout.write('{"type":"system","sub');
    child.stdout.write('type":"init"}\nnot json\n');
    await new Promise((r) => setImmediate(r));
    expect(events[0]).toEqual({ type: "system", subtype: "init" });
    expect(events[1]).toEqual({ type: "raw", text: "not json" });
  });

  it("send writes one NDJSON user event; refuses when not running", () => {
    const child = fakeChild();
    const s = new AgentChatSession({ deps: { spawn: () => child } }).start();
    expect(s.send("  hello world ")).toBe(true);
    expect(child.stdin.written).toBe(
      JSON.stringify({ type: "user", text: "  hello world " }) + "\n",
    );
    expect(s.send("   ")).toBe(false);
    s.stop();
    expect(s.send("after stop")).toBe(false);
    expect(child.kill).toHaveBeenCalled();
  });

  it("routes stderr lines and exit", async () => {
    const child = fakeChild();
    const errs = [];
    let exited = null;
    const s = new AgentChatSession({
      onStderr: (l) => errs.push(l),
      onExit: (e) => (exited = e),
      deps: { spawn: () => child },
    }).start();
    child.stderr.write("  mcp: ide (5 tools)\nError: x\n");
    await new Promise((r) => setImmediate(r));
    expect(errs).toEqual(["  mcp: ide (5 tools)", "Error: x"]);
    child.exitCode = 0;
    child.emit("close", 0, null);
    expect(exited).toMatchObject({ code: 0 });
    expect(s.running).toBe(false);
  });

  it("surfaces spawn failure as a session_error event", async () => {
    const child = fakeChild();
    const events = [];
    new AgentChatSession({
      onEvent: (e) => events.push(e),
      deps: { spawn: () => child },
    }).start();
    child.emit("error", new Error("ENOENT cc"));
    expect(events.pop()).toEqual({
      type: "session_error",
      error: "ENOENT cc",
    });
  });
});

// ─── agent-session (REAL node child over real pipes) ────────────────────────

describe("AgentChatSession (real child process)", () => {
  it("round-trips a user turn through a real protocol-speaking child", async () => {
    // A stand-in for `cc agent --input/output-format stream-json`: emits init,
    // then per stdin line emits a delta + a success result echoing the text.
    const SCRIPT = `
      process.stdout.write(JSON.stringify({type:"system",subtype:"init",model:"fake"})+"\\n");
      let buf="";
      process.stdin.on("data",(c)=>{ buf+=c;
        let i; while((i=buf.indexOf("\\n"))>=0){ const line=buf.slice(0,i); buf=buf.slice(i+1);
          const evt=JSON.parse(line);
          process.stdout.write(JSON.stringify({type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:"echo:"}}})+"\\n");
          process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"echo:"+evt.text})+"\\n");
        }});
      process.stdin.on("end",()=>process.exit(0));
    `;
    const events = [];
    let exited = null;
    const s = new AgentChatSession({
      onEvent: (e) => events.push(e),
      onExit: (e) => (exited = e),
      deps: { spawn: () => realSpawn(process.execPath, ["-e", SCRIPT]) },
    }).start();

    await vi.waitFor(() =>
      expect(events.some((e) => e.subtype === "init")).toBe(true),
    );
    expect(s.send("ping")).toBe(true);
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === "result")).toBe(true),
    );
    const result = events.find((e) => e.type === "result");
    expect(result.result).toBe("echo:ping");
    s.end(); // graceful: close stdin → child exits 0
    await vi.waitFor(() => expect(exited).not.toBe(null));
    expect(exited.code).toBe(0);
  }, 20000);
});

// ─── webview html smoke ──────────────────────────────────────────────────────

describe("buildChatHtml", () => {
  it("emits a CSP-locked page wired to the message vocabulary", () => {
    const html = buildChatHtml({ cspSource: "vscode-resource:", nonce: "N1" });
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-N1");
    expect(html).toContain("acquireVsCodeApi");
    for (const kind of ["delta", "tool", "turn_end", "exited", "error"]) {
      expect(html).toContain(`case "${kind}"`);
    }
  });
});

describe("buildSessionArgs (P1: model/provider settings)", async () => {
  const { buildSessionArgs } =
    await import("../../../vscode-extension/src/chat/chat-events.js");
  it("maps non-empty settings to CLI flags, skips blanks", () => {
    expect(
      buildSessionArgs({ provider: "volcengine", model: "doubao-x" }),
    ).toEqual(["--provider", "volcengine", "--model", "doubao-x"]);
    expect(buildSessionArgs({ provider: " ", model: "" })).toEqual([]);
    expect(buildSessionArgs({})).toEqual([]);
    expect(buildSessionArgs()).toEqual([]);
  });
});

describe("buildSessionArgs resume (P1: session resume)", async () => {
  const { buildSessionArgs } =
    await import("../../../vscode-extension/src/chat/chat-events.js");
  it("adds --resume for a stored session id, skips blanks/null", () => {
    expect(buildSessionArgs({ resume: "chat-ws-1" })).toEqual([
      "--resume",
      "chat-ws-1",
    ]);
    expect(buildSessionArgs({ resume: "" })).toEqual([]);
    expect(buildSessionArgs({ resume: null })).toEqual([]);
    expect(buildSessionArgs({ provider: "ollama", resume: "s1" })).toEqual([
      "--provider",
      "ollama",
      "--resume",
      "s1",
    ]);
  });
});

describe("plan-mode UI plumbing (P1)", async () => {
  const { mapAgentEvent: mapEvt, createTurnState: mkState } =
    await import("../../../vscode-extension/src/chat/chat-events.js");
  it("maps plan_update to the plan card message", () => {
    const st = mkState();
    const m = mapEvt(
      {
        type: "plan_update",
        active: true,
        state: "analyzing",
        items: [
          { title: "write_file: a.js", tool: "write_file", impact: "medium" },
        ],
        risk: { level: "medium", totalScore: 3 },
      },
      st,
    );
    expect(m).toMatchObject({
      kind: "plan",
      active: true,
      state: "analyzing",
      risk: { level: "medium" },
    });
    expect(m.items).toHaveLength(1);
    expect(
      mapEvt({ type: "plan_update", active: false, items: [] }, st),
    ).toMatchObject({ kind: "plan", active: false });
  });

  it("sendEvent writes arbitrary NDJSON controls (plan approve)", () => {
    const child = fakeChild();
    const s = new AgentChatSession({ deps: { spawn: () => child } }).start();
    expect(s.sendEvent({ type: "plan", action: "approve" })).toBe(true);
    expect(child.stdin.written).toBe(
      JSON.stringify({ type: "plan", action: "approve" }) + "\n",
    );
    s.stop();
    expect(s.sendEvent({ type: "plan", action: "enter" })).toBe(false);
  });

  it("chat html carries the plan card + controls", async () => {
    const { buildChatHtml: html } =
      await import("../../../vscode-extension/src/chat/chat-html.js");
    const page = html({ cspSource: "x:", nonce: "N" });
    expect(page).toContain('id="plan-toggle"');
    expect(page).toContain('id="planApprove"');
    expect(page).toContain('case "plan"');
  });
});

describe("approval routing plumbing (P1)", async () => {
  const { mapAgentEvent: mapA, createTurnState: mkA } =
    await import("../../../vscode-extension/src/chat/chat-events.js");
  it("maps approval_request and approval_resolved", () => {
    const st = mkA();
    expect(
      mapA(
        {
          type: "approval_request",
          id: "appr-1",
          tool: "run_shell",
          command: "npm test",
          risk: "medium",
        },
        st,
      ),
    ).toMatchObject({
      kind: "approval",
      id: "appr-1",
      tool: "run_shell",
      command: "npm test",
      risk: "medium",
    });
    expect(
      mapA(
        {
          type: "approval_resolved",
          id: "appr-1",
          approved: true,
          via: "user-approve",
        },
        st,
      ),
    ).toEqual({
      kind: "approval_done",
      id: "appr-1",
      approved: true,
      via: "user-approve",
    });
  });

  it("chat html renders approval cards and the panel forwards verdicts", async () => {
    const { buildChatHtml: htmlA } =
      await import("../../../vscode-extension/src/chat/chat-html.js");
    const page = htmlA({ cspSource: "x:", nonce: "N" });
    expect(page).toContain('case "approval"');
    expect(page).toContain('case "approval_done"');
    expect(page).toContain("Approve");
  });
});

describe("panel slash commands (P1)", async () => {
  it("the webview maps /commands to the existing controls", async () => {
    const { buildChatHtml: htmlS } =
      await import("../../../vscode-extension/src/chat/chat-html.js");
    const page = htmlS({ cspSource: "x:", nonce: "N" });
    for (const cmd of [
      '"/new"',
      '"/plan"',
      '"/approve"',
      '"/reject"',
      '"/stop"',
    ]) {
      expect(page).toContain(cmd);
    }
    expect(page).toContain("/help");
  });
});
