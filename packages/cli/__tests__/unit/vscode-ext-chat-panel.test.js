/**
 * Chat panel (gap #7 P0) — verified WITHOUT a VS Code host:
 *   1. chat-events: NDJSON → UI-message mapping (delta tracking, dedupe of
 *      the final result text, error shapes).
 *   2. agent-session: child lifecycle + NDJSON marshaling with a fake child
 *      (chunk-boundary splits, raw lines, stderr, exit, spawn failure).
 *   3. a REAL node child speaking the protocol over real pipes.
 * The webview HTML builder gets a CSP/nonce smoke check.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
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
    // Extended-thinking reasoning delta → a separate "thinking" UI message.
    expect(
      mapAgentEvent(
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "thinking_delta", thinking: "let me reason…" },
          },
        },
        st,
      ),
    ).toEqual({ kind: "thinking", text: "let me reason…" });
    expect(
      mapAgentEvent(
        { type: "tool_use", tool: "read_file", args: { path: "a.js" } },
        st,
      ),
    ).toEqual({ kind: "tool", tool: "read_file", summary: "a.js" });
    expect(
      mapAgentEvent({ type: "tool_result", tool: "x", is_error: true }, st),
    ).toEqual({ kind: "tool_done", tool: "x", isError: true, note: null });
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

  it("wires /compact to a compact control message (Claude-Code IDE parity)", () => {
    const html = buildChatHtml({ cspSource: "vscode-resource:", nonce: "N1" });
    // The SLASH map posts a compact control message …
    expect(html).toContain('"/compact"');
    expect(html).toContain('type: "compact"');
    // … and /compact is advertised in the /help one-liner + autocomplete catalog.
    expect(html).toMatch(/\/stop[^\n]*\/compact/); // listed right after /stop
    expect(html).toContain("compact the conversation history");
  });
});

describe("resolveChatLlm — panel uses the user's cc config provider (bug fix)", () => {
  let resolveChatLlm;
  beforeAll(async () => {
    ({ resolveChatLlm } =
      await import("../../../vscode-extension/src/chat/chat-events.js"));
  });

  it("a non-empty panel override wins (provider + model)", () => {
    const out = resolveChatLlm(
      { provider: " anthropic ", model: " opus " },
      () => ({ provider: "volcengine", model: "doubao" }),
    );
    expect(out).toEqual({ provider: "anthropic", model: "opus" });
  });

  it("falls back to the cc config provider/model when the override is empty", () => {
    const out = resolveChatLlm({ provider: "", model: "" }, () => ({
      provider: "volcengine",
      model: "doubao-seed-1-6",
    }));
    // THE FIX: empty override → pin the user's configured provider explicitly,
    // so the panel can't drift to a stale ambient default (the anthropic-401 bug).
    expect(out).toEqual({ provider: "volcengine", model: "doubao-seed-1-6" });
  });

  it("keeps an explicit panel model even when provider falls back", () => {
    const out = resolveChatLlm({ provider: "", model: "my-model" }, () => ({
      provider: "volcengine",
      model: "doubao",
    }));
    expect(out).toEqual({ provider: "volcengine", model: "my-model" });
  });

  it("returns empty (let the CLI decide) when neither override nor config has a provider", () => {
    expect(resolveChatLlm({ provider: "", model: "" }, () => ({}))).toEqual({
      provider: "",
      model: "",
    });
  });
});

describe("mapAgentEvent — compaction (manual /compact result)", () => {
  it("renders the compaction stats as an info line", () => {
    const st = createTurnState();
    expect(
      mapAgentEvent({ type: "compaction", stats: { saved: 1234 } }, st),
    ).toMatchObject({ kind: "info", text: "compacted: saved 1234 tokens" });
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

describe("session picker (P1)", async () => {
  const { parseSessionList, listSessions } =
    await import("../../../vscode-extension/src/chat/session-list.js");
  it("parses cc session list --json tolerantly", () => {
    const out = JSON.stringify([
      { id: "s1", title: "fix bug", updated_at: "2026-06-11", _store: "jsonl" },
      { id: "s2", _store: "db" },
      { title: "no id — dropped" },
    ]);
    expect(parseSessionList(out)).toEqual([
      { id: "s1", title: "fix bug", updatedAt: "2026-06-11", store: "agent" },
      { id: "s2", title: "", updatedAt: null, store: "chat" },
    ]);
    expect(parseSessionList("not json")).toEqual([]);
    expect(parseSessionList(JSON.stringify({ nope: 1 }))).toEqual([]);
  });

  it("listSessions spawns the CLI and resolves [] on failure", async () => {
    const calls = [];
    const fakeExec = (cmd, args, opts, cb) => {
      calls.push({ cmd, args });
      cb(null, JSON.stringify([{ id: "s9", _store: "jsonl" }]));
    };
    const items = await listSessions({
      command: "cc",
      limit: 5,
      deps: { execFile: fakeExec },
    });
    expect(calls[0].args).toEqual(["session", "list", "--json", "-n", "5"]);
    expect(items[0].id).toBe("s9");
    const failed = await listSessions({
      deps: { execFile: (c, a, o, cb) => cb(new Error("no cc")) },
    });
    expect(failed).toEqual([]);
  });

  it("webview wires /sessions and /resume to the picker", async () => {
    const { buildChatHtml: htmlP } =
      await import("../../../vscode-extension/src/chat/chat-html.js");
    const page = htmlP({ cspSource: "x:", nonce: "N" });
    expect(page).toContain('"/sessions"');
    expect(page).toContain('"/resume"');
    expect(page).toContain("pickSession");
  });
});

describe("webview script integrity (regression: template-literal escapes)", async () => {
  it("the generated inline script PARSES — listeners can actually attach", async () => {
    // 0.9.0/0.10.0 shipped a dead panel: a "\n" inside the page's template
    // literal became a REAL newline in the generated script, breaking a
    // string literal → load-time SyntaxError → Send did nothing. Substring
    // smoke tests can't catch that; parsing the extracted script does.
    const { buildChatHtml: htmlI } =
      await import("../../../vscode-extension/src/chat/chat-html.js");
    const page = htmlI({ cspSource: "x:", nonce: "N" });
    const m = /<script nonce="N">([\s\S]*?)<\/script>/.exec(page);
    expect(m).toBeTruthy();
    expect(() => new Function(m[1])).not.toThrow();
  });
});

describe("IME composition guard (CJK Esc/Enter regression)", async () => {
  it("Esc dismissing an IME candidate window does not interrupt the turn", async () => {
    // Claude Code 2.1.178 fixed the same bug for VS Code: a CJK user pressing
    // Esc to close the IME candidate window also cancelled the running turn.
    // We guard the document-level Esc→interrupt with a composition flag +
    // event.isComposing/keyCode 229; Enter confirming a candidate must not send.
    const { buildChatHtml: htmlIme } =
      await import("../../../vscode-extension/src/chat/chat-html.js");
    const page = htmlIme({ cspSource: "x:", nonce: "N" });
    // The page has several nonce'd <script> blocks (md-lite, at-mention, …);
    // the handler markers live only in the main one — assert against the page.
    expect(page).toContain("compositionstart");
    expect(page).toContain("compositionend");
    expect(page).toContain("imeComposing");
    // the interrupt path bails while composing
    expect(page).toMatch(
      /imeComposing\s*\|\|\s*e\.isComposing\s*\|\|\s*e\.keyCode === 229/,
    );
    // Enter submit is likewise gated on not-composing
    expect(page).toMatch(
      /!imeComposing\s*&&\s*!e\.isComposing\s*&&\s*e\.keyCode !== 229/,
    );
    // and the main handler script still parses (regression: template escapes)
    const blocks = [
      ...page.matchAll(/<script nonce="N">([\s\S]*?)<\/script>/g),
    ];
    const main = blocks
      .map((b) => b[1])
      .find((s) => s.includes("imeComposing"));
    expect(main).toBeTruthy();
    expect(() => new Function(main)).not.toThrow();
  });
});

describe("LLM config wizard plumbing (onboarding)", async () => {
  const llmCfg = await import("../../../vscode-extension/src/llm-config.js");

  it("presets cover the CLI's built-in providers with sane defaults", () => {
    const ids = llmCfg.PROVIDER_PRESETS.map((p) => p.id);
    for (const id of [
      "ollama",
      "volcengine",
      "anthropic",
      "openai",
      "deepseek",
      "dashscope",
      "kimi",
      "gemini",
      "mistral",
      "minimax",
    ]) {
      expect(ids).toContain(id);
    }
    for (const p of llmCfg.PROVIDER_PRESETS) {
      expect(p.baseUrl).toMatch(/^https?:\/\//);
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
    expect(
      llmCfg.PROVIDER_PRESETS.find((p) => p.id === "ollama").needsKey,
    ).toBe(false);
  });

  it("buildConfigSetArgs emits one cc config set per answered field", () => {
    expect(
      llmCfg.buildConfigSetArgs({
        provider: "volcengine",
        model: "m",
        apiKey: "k",
        baseUrl: "https://x",
      }),
    ).toEqual([
      ["config", "set", "llm.provider", "volcengine"],
      ["config", "set", "llm.model", "m"],
      ["config", "set", "llm.baseUrl", "https://x"],
      ["config", "set", "llm.apiKey", "k"],
    ]);
    expect(llmCfg.buildConfigSetArgs({ provider: "ollama" })).toEqual([
      ["config", "set", "llm.provider", "ollama"],
    ]);
  });

  it("buildConfigSetArgs writes llm.visionModel only when provided", () => {
    expect(
      llmCfg.buildConfigSetArgs({
        provider: "volcengine",
        model: "doubao-seed-1-6",
        visionModel: "doubao-seed-1-6-vision-250815",
      }),
    ).toEqual([
      ["config", "set", "llm.provider", "volcengine"],
      ["config", "set", "llm.model", "doubao-seed-1-6"],
      ["config", "set", "llm.visionModel", "doubao-seed-1-6-vision-250815"],
    ]);
    // blank vision model → omitted (reuse text model / CLI default)
    expect(
      llmCfg.buildConfigSetArgs({ provider: "ollama", visionModel: "" }),
    ).toEqual([["config", "set", "llm.provider", "ollama"]]);
  });

  it("suggestVisionModel: matches the CLI default vision model for volcengine, blank otherwise", () => {
    // Must equal the CLI's DEFAULT_VISION_MODEL (image-input.js) so the IDE
    // prefill is what `cc agent --image` would actually use.
    expect(llmCfg.suggestVisionModel("volcengine")).toBe(
      "doubao-seed-2-0-lite-260215",
    );
    expect(llmCfg.suggestVisionModel("ollama")).toBe("");
    expect(llmCfg.suggestVisionModel("anthropic")).toBe("");
  });

  it("suggestVisionModel stays in sync with the CLI's DEFAULT_VISION_MODEL (drift guard)", async () => {
    const { DEFAULT_VISION_MODEL } =
      await import("../../src/lib/image-input.js");
    expect(llmCfg.suggestVisionModel("volcengine")).toBe(DEFAULT_VISION_MODEL);
  });

  it("looksLikeLlmConfigError: catches bare 401/403/unauthorized (setup-card trigger)", () => {
    // The original bug class — these must surface the setup card even without
    // the literal "api key" text the old regex required.
    expect(llmCfg.looksLikeLlmConfigError("Anthropic error: 401")).toBe(true);
    expect(llmCfg.looksLikeLlmConfigError("403 Forbidden")).toBe(true);
    expect(llmCfg.looksLikeLlmConfigError("Unauthorized")).toBe(true);
    expect(llmCfg.looksLikeLlmConfigError("authentication failed")).toBe(true);
    expect(llmCfg.looksLikeLlmConfigError("ANTHROPIC_API_KEY required")).toBe(
      true,
    );
    // not an auth/config problem
    expect(llmCfg.looksLikeLlmConfigError("network timeout")).toBe(false);
    expect(llmCfg.looksLikeLlmConfigError("")).toBe(false);
    expect(llmCfg.looksLikeLlmConfigError(null)).toBe(false);
  });

  it("setVisionModel: writes llm.visionModel, blank clears, unsafe rejected", async () => {
    const calls = [];
    const deps = {
      execFile: (c, a, o, cb) => {
        calls.push(a);
        cb(null, "");
      },
    };
    // a value → cc config set llm.visionModel <value>
    const ok = await llmCfg.setVisionModel({
      visionModel: "doubao-seed-1-6-vision-250815",
      deps,
    });
    expect(ok.ok).toBe(true);
    expect(calls.at(-1)).toEqual([
      "config",
      "set",
      "llm.visionModel",
      "doubao-seed-1-6-vision-250815",
    ]);
    // blank → still writes (clears to empty string)
    await llmCfg.setVisionModel({ visionModel: "", deps });
    expect(calls.at(-1)).toEqual(["config", "set", "llm.visionModel", ""]);
    // unsafe value → rejected without spawning
    const bad = await llmCfg.setVisionModel({
      visionModel: "a b",
      deps: {
        execFile: () => {
          throw new Error("must not spawn");
        },
      },
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/不安全字符/);
  });

  it("getConfiguredVisionModel parses output and maps unset to null", async () => {
    const mk = (out, err) => ({
      execFile: (c, a, o, cb) => cb(err || null, out || ""),
    });
    expect(
      await llmCfg.getConfiguredVisionModel({
        deps: mk("llm.visionModel = doubao-vision"),
      }),
    ).toBe("doubao-vision");
    expect(
      await llmCfg.getConfiguredVisionModel({ deps: mk("undefined") }),
    ).toBe(null);
    expect(
      await llmCfg.getConfiguredVisionModel({
        deps: mk("", new Error("cli missing")),
      }),
    ).toBe(null);
  });

  it("getConfiguredModel/getConfiguredBaseUrl parse output and map unset to null (wizard pre-fill)", async () => {
    const mk = (out, err) => ({
      execFile: (c, a, o, cb) => cb(err || null, out || ""),
    });
    expect(
      await llmCfg.getConfiguredModel({ deps: mk("llm.model = doubao-x") }),
    ).toBe("doubao-x");
    expect(await llmCfg.getConfiguredModel({ deps: mk("undefined") })).toBe(
      null,
    );
    expect(
      await llmCfg.getConfiguredBaseUrl({ deps: mk("https://ark.example/v3") }),
    ).toBe("https://ark.example/v3");
    expect(
      await llmCfg.getConfiguredBaseUrl({ deps: mk("", new Error("no cc")) }),
    ).toBe(null);
  });

  it("hasConfiguredApiKey: true when a key is stored, false when unset / cli missing", async () => {
    const mk = (out, err) => ({
      execFile: (c, a, o, cb) => cb(err || null, out || ""),
    });
    // present (value never surfaced — only presence matters)
    expect(await llmCfg.hasConfiguredApiKey({ deps: mk("sk-abc123") })).toBe(
      true,
    );
    expect(await llmCfg.hasConfiguredApiKey({ deps: mk("undefined") })).toBe(
      false,
    );
    expect(await llmCfg.hasConfiguredApiKey({ deps: mk("") })).toBe(false);
    expect(
      await llmCfg.hasConfiguredApiKey({ deps: mk("", new Error("no cc")) }),
    ).toBe(false);
  });

  it("blank apiKey KEEPS the existing key (the '更新后又要重配key' fix)", () => {
    // The wizard passes apiKey:"" when the user leaves it blank to keep the
    // stored key; buildConfigSetArgs must NOT emit llm.apiKey so cc never
    // overwrites it with empty. Model/baseUrl still update.
    expect(
      llmCfg.buildConfigSetArgs({
        provider: "volcengine",
        model: "doubao-seed-1-6-251015",
        apiKey: "",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      }),
    ).toEqual([
      ["config", "set", "llm.provider", "volcengine"],
      ["config", "set", "llm.model", "doubao-seed-1-6-251015"],
      [
        "config",
        "set",
        "llm.baseUrl",
        "https://ark.cn-beijing.volces.com/api/v3",
      ],
    ]);
  });

  it("rejects shell-unsafe values before writing", async () => {
    expect(llmCfg.hasUnsafeShellChars("ok-key_123/=+")).toBe(false);
    expect(llmCfg.hasUnsafeShellChars("has space")).toBe(true);
    expect(llmCfg.hasUnsafeShellChars("a&b")).toBe(true);
    const r = await llmCfg.applyLlmConfig({
      answers: { apiKey: "bad key" },
      deps: {
        execFile: () => {
          throw new Error("must not spawn");
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/不安全字符/);
  });

  it("getConfiguredProvider parses both output styles and maps unset to null", async () => {
    const mk = (out, err) => ({
      execFile: (c, a, o, cb) => cb(err || null, out || ""),
    });
    expect(
      await llmCfg.getConfiguredProvider({
        deps: mk("llm.provider = volcengine\n"),
      }),
    ).toBe("volcengine");
    expect(await llmCfg.getConfiguredProvider({ deps: mk("ollama\n") })).toBe(
      "ollama",
    );
    expect(
      await llmCfg.getConfiguredProvider({ deps: mk("undefined\n") }),
    ).toBe(null);
    expect(
      await llmCfg.getConfiguredProvider({ deps: mk("", new Error("no cc")) }),
    ).toBe(null);
  });

  it("applyLlmConfig runs the set sequence and fail-fasts; testLlm summarizes", async () => {
    const calls = [];
    const ok = await llmCfg.applyLlmConfig({
      answers: { provider: "deepseek", model: "deepseek-chat" },
      deps: {
        execFile: (c, a, o, cb) => {
          calls.push(a.join(" "));
          cb(null, "Set");
        },
      },
    });
    expect(ok.ok).toBe(true);
    expect(calls).toEqual([
      "config set llm.provider deepseek",
      "config set llm.model deepseek-chat",
    ]);
    const failed = await llmCfg.applyLlmConfig({
      answers: { provider: "x" },
      deps: { execFile: (c, a, o, cb) => cb(new Error("boom")) },
    });
    expect(failed.ok).toBe(false);
    const t = await llmCfg.testLlm({
      deps: { execFile: (c, a, o, cb) => cb(null, "line1\nconnect ok\n") },
    });
    expect(t).toMatchObject({ ok: true });
    expect(t.detail).toContain("connect ok");
  });

  it("webview renders the setup card and wires the configure button", async () => {
    const { buildChatHtml: htmlC } =
      await import("../../../vscode-extension/src/chat/chat-html.js");
    const page = htmlC({ cspSource: "x:", nonce: "N" });
    expect(page).toContain('case "setup"');
    expect(page).toContain("configureLlm");
    // integrity: the script must still PARSE after this addition
    const m = /<script nonce="N">([\s\S]*?)<\/script>/.exec(page);
    expect(() => new Function(m[1])).not.toThrow();
  });
});
