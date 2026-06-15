/**
 * IDE live prompt context (Claude-Code at-submit selection sharing parity).
 *
 * Covers the pure module (src/lib/ide-context.js) and the headless-runner
 * wiring: when resolveAgentMcp yields an IDE bridge, the editor's selection /
 * open editors are appended to the in-flight user turn — and ONLY the
 * in-flight turn (persistence stays clean).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ideContextEnabled,
  ideTerminalEnabled,
  hasIdeContextTools,
  hasIdeTerminalTool,
  parseToolResultJson,
  collectIdeContext,
  formatIdeContext,
  appendTextToContent,
  buildIdePromptContext,
  hasIdeDiagnosticsTool,
  collectIdeDiagnostics,
  formatIdeDiagnostics,
} from "../../src/lib/ide-context.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { executeTool } from "../../src/runtime/agent-core.js";

const txt = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

const SELECTION = {
  file: "C:/proj/src/app.js",
  languageId: "javascript",
  selection: {
    start: { line: 9, character: 0 },
    end: { line: 11, character: 4 },
  },
  text: "function add(a, b) {\n  return a + b;\n}",
};

const EDITORS = [
  { file: "C:/proj/src/app.js", active: true, languageId: "javascript" },
  { file: "C:/proj/README.md", active: false },
];

/** A resolved-MCP bundle shaped like resolveAgentMcp's output with an IDE. */
function fakeIdeMcp({
  selection = SELECTION,
  editors = EDITORS,
  callTool,
} = {}) {
  const calls = [];
  return {
    mcpClient: {
      callTool:
        callTool ||
        (async (server, tool) => {
          calls.push(`${server}/${tool}`);
          if (tool === "getSelection") return txt(selection);
          if (tool === "getOpenEditors") return txt({ editors });
          return txt(null);
        }),
      disconnectAll: async () => {},
    },
    extraToolDefinitions: [],
    externalToolExecutors: {
      mcp__ide__getSelection: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getSelection",
      },
      mcp__ide__getOpenEditors: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getOpenEditors",
      },
    },
    externalToolDescriptors: {},
    connected: [{ server: "ide", tools: 4 }],
    calls,
  };
}

describe("ideContextEnabled", () => {
  it("defaults on", () => {
    expect(ideContextEnabled({})).toBe(true);
    expect(ideContextEnabled({ CC_IDE_CONTEXT: "1" })).toBe(true);
  });
  it("is disabled by 0/false/off", () => {
    expect(ideContextEnabled({ CC_IDE_CONTEXT: "0" })).toBe(false);
    expect(ideContextEnabled({ CC_IDE_CONTEXT: "false" })).toBe(false);
    expect(ideContextEnabled({ CC_IDE_CONTEXT: "OFF" })).toBe(false);
  });
});

describe("parseToolResultJson", () => {
  it("parses the first text block as JSON", () => {
    expect(parseToolResultJson(txt({ a: 1 }))).toEqual({ a: 1 });
    expect(parseToolResultJson(txt(null))).toBe(null);
  });
  it("returns null for isError / malformed results", () => {
    expect(parseToolResultJson(null)).toBe(null);
    expect(
      parseToolResultJson({
        isError: true,
        content: [{ type: "text", text: "{}" }],
      }),
    ).toBe(null);
    expect(parseToolResultJson({ content: [] })).toBe(null);
    expect(
      parseToolResultJson({ content: [{ type: "text", text: "not json" }] }),
    ).toBe(null);
  });
});

describe("hasIdeContextTools", () => {
  it("true only with a live client and the ide selection executor", () => {
    expect(hasIdeContextTools(fakeIdeMcp())).toBe(true);
    expect(hasIdeContextTools(null)).toBe(false);
    expect(
      hasIdeContextTools({
        mcpClient: { callTool: () => {} },
        externalToolExecutors: { mcp__other__x: { kind: "mcp" } },
      }),
    ).toBe(false);
    const noClient = fakeIdeMcp();
    noClient.mcpClient = null;
    expect(hasIdeContextTools(noClient)).toBe(false);
  });
});

describe("collectIdeContext", () => {
  it("collects selection + open editors", async () => {
    const mcp = fakeIdeMcp();
    const ctx = await collectIdeContext(mcp, { env: {} });
    expect(ctx.selection.file).toBe("C:/proj/src/app.js");
    expect(ctx.openEditors).toHaveLength(2);
    expect(mcp.calls).toContain("ide/getSelection");
    expect(mcp.calls).toContain("ide/getOpenEditors");
  });

  it("returns null when disabled, no IDE tools, or nothing useful", async () => {
    expect(
      await collectIdeContext(fakeIdeMcp(), { env: { CC_IDE_CONTEXT: "0" } }),
    ).toBe(null);
    expect(await collectIdeContext(null, { env: {} })).toBe(null);
    expect(
      await collectIdeContext(fakeIdeMcp({ selection: null, editors: [] }), {
        env: {},
      }),
    ).toBe(null);
  });

  it("times out a hung IDE without blocking the turn", async () => {
    const mcp = fakeIdeMcp({ callTool: () => new Promise(() => {}) });
    const t0 = Date.now();
    const ctx = await collectIdeContext(mcp, { env: {}, timeoutMs: 30 });
    expect(ctx).toBe(null);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("swallows a rejecting callTool", async () => {
    const mcp = fakeIdeMcp({
      callTool: async () => {
        throw new Error("boom");
      },
    });
    expect(await collectIdeContext(mcp, { env: {} })).toBe(null);
  });
});

describe("formatIdeContext", () => {
  it("renders active file, open editors, and a 1-based selection range", () => {
    const s = formatIdeContext({ selection: SELECTION, openEditors: EDITORS });
    expect(s).toContain("<ide-context>");
    expect(s).toContain("Active file: C:/proj/src/app.js");
    expect(s).toContain("C:/proj/src/app.js (active)");
    expect(s).toContain("C:/proj/README.md");
    expect(s).toContain("Selected text in C:/proj/src/app.js:10-12:");
    expect(s).toContain("return a + b;");
    expect(s).toContain("</ide-context>");
  });

  it("truncates a huge selection", () => {
    const big = { ...SELECTION, text: "x".repeat(5000) };
    const s = formatIdeContext({ selection: big, openEditors: [] });
    expect(s).toContain("...(selection truncated)");
    expect(s.length).toBeLessThan(3000);
  });

  it("renders editors-only and selection-file-only shapes", () => {
    const edsOnly = formatIdeContext({ selection: null, openEditors: EDITORS });
    expect(edsOnly).toContain("Open editors:");
    const cursorOnly = formatIdeContext({
      selection: { file: "C:/proj/a.js", text: "" },
      openEditors: [],
    });
    expect(cursorOnly).toContain("Active file: C:/proj/a.js");
  });

  it("returns null when there is nothing to say", () => {
    expect(formatIdeContext(null)).toBe(null);
    expect(formatIdeContext({ selection: null, openEditors: [] })).toBe(null);
  });
});

describe("appendTextToContent", () => {
  it("appends to strings and multimodal arrays", () => {
    expect(appendTextToContent("hi", "ctx")).toBe("hi\n\nctx");
    expect(appendTextToContent("", "ctx")).toBe("ctx");
    const parts = [
      { type: "text", text: "hi" },
      { type: "image_url", image_url: {} },
    ];
    const out = appendTextToContent(parts, "ctx");
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ type: "text", text: "ctx" });
    expect(parts).toHaveLength(2); // original untouched
  });
  it("is a no-op without extra", () => {
    expect(appendTextToContent("hi", null)).toBe("hi");
  });
});

describe("buildIdePromptContext", () => {
  it("collects and formats in one call", async () => {
    const s = await buildIdePromptContext(fakeIdeMcp(), { env: {} });
    expect(s).toContain("<ide-context>");
    expect(s).toContain("return a + b;");
  });
  it("never throws", async () => {
    const mcp = fakeIdeMcp({
      callTool: () => {
        throw new Error("sync boom");
      },
    });
    expect(await buildIdePromptContext(mcp, { env: {} })).toBe(null);
  });
});

describe("runAgentHeadless — IDE context wiring", () => {
  const baseDeps = (over = {}) => {
    const out = [];
    const err = [];
    return {
      out,
      err,
      deps: {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => ({
          setSessionPolicy() {},
          setConfirmer() {},
          decide: async () => ({ decision: "allow", via: "t", policy: "t" }),
        }),
        writeOut: (s) => out.push(s),
        writeErr: (s) => err.push(s),
        sessionExists: () => false,
        startSession: () => {},
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendTokenUsage: () => {},
        getLastSessionId: () => null,
        ...over,
      },
    };
  };

  it("appends <ide-context> to the in-flight user turn but not persistence", async () => {
    let seenMessages = null;
    const persisted = [];
    const { deps } = baseDeps({
      resolveAgentMcp: async () => fakeIdeMcp(),
      appendUserMessage: (_sid, content) => persisted.push(content),
      chatFn: vi.fn(async (messages) => {
        seenMessages = messages;
        return { message: { role: "assistant", content: "done" } };
      }),
    });
    const r = await runAgentHeadless(
      { prompt: "explain this", sessionId: "s-ide-ctx", expandFileRefs: false },
      deps,
    );
    expect(r.exitCode).toBe(0);
    const userMsg = seenMessages.find((m) => m.role === "user");
    expect(userMsg.content).toContain("explain this");
    expect(userMsg.content).toContain("<ide-context>");
    expect(userMsg.content).toContain("return a + b;");
    // Ephemeral: the persisted user turn carries no editor snapshot.
    expect(persisted.join("\n")).not.toContain("<ide-context>");
  });

  it("injects nothing when no IDE bridge resolved", async () => {
    let seenMessages = null;
    const { deps } = baseDeps({
      resolveAgentMcp: async () => null,
      chatFn: vi.fn(async (messages) => {
        seenMessages = messages;
        return { message: { role: "assistant", content: "done" } };
      }),
    });
    await runAgentHeadless(
      { prompt: "hello", sessionId: "s-no-ide", expandFileRefs: false },
      deps,
    );
    const userMsg = seenMessages.find((m) => m.role === "user");
    expect(userMsg.content).not.toContain("<ide-context>");
  });

  it("honors a deps.buildIdePromptContext override (seam)", async () => {
    let seenMessages = null;
    const { deps } = baseDeps({
      resolveAgentMcp: async () => fakeIdeMcp(),
      buildIdePromptContext: async () => "<ide-context>STUB</ide-context>",
      chatFn: vi.fn(async (messages) => {
        seenMessages = messages;
        return { message: { role: "assistant", content: "done" } };
      }),
    });
    await runAgentHeadless(
      { prompt: "hi", sessionId: "s-ide-seam", expandFileRefs: false },
      deps,
    );
    const userMsg = seenMessages.find((m) => m.role === "user");
    expect(userMsg.content).toContain("STUB");
  });
});

// ─── Post-edit diagnostics feedback ─────────────────────────────────────────

const DIAGS = [
  {
    file: "C:/proj/src/app.js",
    severity: "error",
    message: "Unexpected token",
    line: 4,
    character: 2,
    source: "ts",
  },
  {
    file: "C:/proj/src/app.js",
    severity: "warning",
    message: "unused var",
    line: 9,
    character: 0,
    source: "eslint",
  },
  {
    file: "C:/proj/src/app.js",
    severity: "info",
    message: "ignore me",
    line: 1,
    character: 0,
  },
];

function fakeDiagMcp({ diagnostics = DIAGS, callTool } = {}) {
  const calls = [];
  return {
    mcpClient: {
      callTool:
        callTool ||
        (async (server, tool, args) => {
          calls.push({ server, tool, args });
          return txt({ diagnostics });
        }),
    },
    externalToolExecutors: {
      mcp__ide__getDiagnostics: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getDiagnostics",
      },
    },
    calls,
  };
}

describe("hasIdeDiagnosticsTool", () => {
  it("requires a client and the ide diagnostics executor", () => {
    expect(hasIdeDiagnosticsTool(fakeDiagMcp())).toBe(true);
    expect(hasIdeDiagnosticsTool(null)).toBe(false);
    expect(hasIdeDiagnosticsTool(fakeIdeMcp())).toBe(false); // no diag tool
  });
});

describe("collectIdeDiagnostics", () => {
  it("scopes to the file and keeps only errors/warnings", async () => {
    const mcp = fakeDiagMcp();
    const out = await collectIdeDiagnostics(mcp, "C:/proj/src/app.js", {
      env: {},
      settleMs: 0,
    });
    expect(out).toHaveLength(2); // info dropped
    expect(out[0].severity).toBe("error");
    expect(mcp.calls[0]).toMatchObject({
      server: "ide",
      tool: "getDiagnostics",
      args: { path: "C:/proj/src/app.js" },
    });
  });

  it("returns null for clean files, missing tool, disabled, no path", async () => {
    expect(
      await collectIdeDiagnostics(fakeDiagMcp({ diagnostics: [] }), "f.js", {
        env: {},
        settleMs: 0,
      }),
    ).toBe(null);
    expect(
      await collectIdeDiagnostics(fakeIdeMcp(), "f.js", {
        env: {},
        settleMs: 0,
      }),
    ).toBe(null);
    expect(
      await collectIdeDiagnostics(fakeDiagMcp(), "f.js", {
        env: { CC_IDE_CONTEXT: "0" },
        settleMs: 0,
      }),
    ).toBe(null);
    expect(
      await collectIdeDiagnostics(fakeDiagMcp(), "", { env: {}, settleMs: 0 }),
    ).toBe(null);
  });

  it("survives a hung or throwing IDE", async () => {
    expect(
      await collectIdeDiagnostics(
        fakeDiagMcp({ callTool: () => new Promise(() => {}) }),
        "f.js",
        { env: {}, settleMs: 0, timeoutMs: 30 },
      ),
    ).toBe(null);
    expect(
      await collectIdeDiagnostics(
        fakeDiagMcp({
          callTool: () => {
            throw new Error("boom");
          },
        }),
        "f.js",
        { env: {}, settleMs: 0 },
      ),
    ).toBe(null);
  });

  it("honors CC_IDE_DIAG_SETTLE_MS=0 from env", async () => {
    const t0 = Date.now();
    await collectIdeDiagnostics(fakeDiagMcp(), "f.js", {
      env: { CC_IDE_DIAG_SETTLE_MS: "0" },
    });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("formatIdeDiagnostics", () => {
  it("renders 1-based lines, source, and a cap", () => {
    const s = formatIdeDiagnostics(DIAGS.slice(0, 2));
    expect(s).toContain("2 problems");
    expect(s).toContain("[error] C:/proj/src/app.js:5 Unexpected token (ts)");
    expect(s).toContain("[warning] C:/proj/src/app.js:10 unused var (eslint)");
    const capped = formatIdeDiagnostics(
      Array.from({ length: 5 }, (_, i) => ({
        severity: "error",
        file: "f.js",
        message: `m${i}`,
        line: i,
      })),
      { cap: 2 },
    );
    expect(capped).toContain("(+3 more)");
  });
  it("returns null when empty", () => {
    expect(formatIdeDiagnostics(null)).toBe(null);
    expect(formatIdeDiagnostics([])).toBe(null);
  });
});

describe("executeTool — post-edit diagnostics wiring", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-idediag-"));
    process.env.CC_IDE_DIAG_SETTLE_MS = "0";
  });
  afterEach(() => {
    delete process.env.CC_IDE_DIAG_SETTLE_MS;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("attaches ideDiagnostics to a successful write_file", async () => {
    const mcp = fakeDiagMcp();
    const res = await executeTool(
      "write_file",
      { path: "out.js", content: "const x = ;" },
      {
        cwd: tmp,
        mcpClient: mcp.mcpClient,
        externalToolExecutors: mcp.externalToolExecutors,
      },
    );
    expect(res.success).toBe(true);
    expect(res.ideDiagnostics).toContain("IDE diagnostics after this edit");
    expect(res.ideDiagnostics).toContain("Unexpected token");
    // the IDE was asked about the file that was just written
    expect(mcp.calls[0].args.path).toBe(path.resolve(tmp, "out.js"));
  });

  it("stays silent without an IDE bridge or on clean diagnostics", async () => {
    const clean = fakeDiagMcp({ diagnostics: [] });
    const res = await executeTool(
      "write_file",
      { path: "ok.js", content: "const x = 1;" },
      {
        cwd: tmp,
        mcpClient: clean.mcpClient,
        externalToolExecutors: clean.externalToolExecutors,
      },
    );
    expect(res.success).toBe(true);
    expect(res.ideDiagnostics).toBeUndefined();

    const noIde = await executeTool(
      "write_file",
      { path: "ok2.js", content: "const x = 1;" },
      { cwd: tmp },
    );
    expect(noIde.success).toBe(true);
    expect(noIde.ideDiagnostics).toBeUndefined();
  });

  it("does not query the IDE for read-only tools", async () => {
    fs.writeFileSync(path.join(tmp, "r.txt"), "hi", "utf-8");
    const mcp = fakeDiagMcp();
    await executeTool(
      "read_file",
      { path: "r.txt" },
      {
        cwd: tmp,
        mcpClient: mcp.mcpClient,
        externalToolExecutors: mcp.externalToolExecutors,
      },
    );
    expect(mcp.calls).toHaveLength(0);
  });
});

describe("runAgentHeadlessStream — IDE context wiring", () => {
  it("re-shares <ide-context> on every turn's user message", async () => {
    const { runAgentHeadlessStream } =
      await import("../../src/runtime/headless-stream.js");
    const seen = [];
    const agentLoop = async function* (messages) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      seen.push(lastUser.content);
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    async function* input() {
      yield JSON.stringify({ type: "user", text: "turn-A" }) + "\n";
      yield JSON.stringify({ type: "user", text: "turn-B" }) + "\n";
    }
    await runAgentHeadlessStream(
      { expandFileRefs: false },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: () => {},
        writeErr: () => {},
        agentLoop,
        input: input(),
        resolveAgentMcp: async () => fakeIdeMcp(),
      },
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("turn-A");
    for (const content of seen) {
      expect(content).toContain("<ide-context>");
      expect(content).toContain("return a + b;");
    }
  });
});

// ─── at-submit terminal-context auto-injection ──────────────────────────────

const TERMINALS = [
  { command: "npm test", exitCode: 0, output: "12 passed\n", terminal: "bash" },
  { command: "npm run build", exitCode: 1, output: "TS2322 boom", terminal: "bash" },
];

/** A bridge bundle that also exposes the terminal tool. */
function fakeIdeMcpTerm({ terminals = TERMINALS, selection = null, editors = [] } = {}) {
  const calls = [];
  return {
    mcpClient: {
      callTool: async (server, tool, args) => {
        calls.push({ tool, args });
        if (tool === "getSelection") return txt(selection);
        if (tool === "getOpenEditors") return txt({ editors });
        if (tool === "getTerminalOutput") return txt({ terminals });
        return txt(null);
      },
    },
    externalToolExecutors: {
      mcp__ide__getSelection: { kind: "mcp", serverName: "ide", toolName: "getSelection" },
      mcp__ide__getOpenEditors: { kind: "mcp", serverName: "ide", toolName: "getOpenEditors" },
      mcp__ide__getTerminalOutput: { kind: "mcp", serverName: "ide", toolName: "getTerminalOutput" },
    },
    calls,
  };
}

describe("ideTerminalEnabled / hasIdeTerminalTool", () => {
  it("defaults on; off by 0/false/off; off when CC_IDE_CONTEXT is off", () => {
    expect(ideTerminalEnabled({})).toBe(true);
    expect(ideTerminalEnabled({ CC_IDE_TERMINAL: "0" })).toBe(false);
    expect(ideTerminalEnabled({ CC_IDE_TERMINAL: "off" })).toBe(false);
    expect(ideTerminalEnabled({ CC_IDE_CONTEXT: "0" })).toBe(false); // implied
  });
  it("detects the terminal executor", () => {
    expect(hasIdeTerminalTool(fakeIdeMcpTerm())).toBe(true);
    expect(hasIdeTerminalTool(fakeIdeMcp())).toBe(false); // no terminal tool
  });
});

describe("collectIdeContext — terminal output", () => {
  it("includes recent terminals and passes the limit when the tool is present", async () => {
    const mcp = fakeIdeMcpTerm({ editors: EDITORS });
    const ctx = await collectIdeContext(mcp, { env: {} });
    expect(ctx.terminals).toHaveLength(2);
    expect(ctx.terminals[1]).toMatchObject({ command: "npm run build", exitCode: 1 });
    const termCall = mcp.calls.find((c) => c.tool === "getTerminalOutput");
    expect(termCall.args).toEqual({ limit: 2 });
  });

  it("returns a terminal-only context (no selection/editors) without null-ing out", async () => {
    const ctx = await collectIdeContext(fakeIdeMcpTerm(), { env: {} });
    expect(ctx).not.toBe(null);
    expect(ctx.selection).toBe(null);
    expect(ctx.terminals).toHaveLength(2);
  });

  it("CC_IDE_TERMINAL=0 drops terminals but keeps editors", async () => {
    const mcp = fakeIdeMcpTerm({ editors: EDITORS });
    const ctx = await collectIdeContext(mcp, { env: { CC_IDE_TERMINAL: "0" } });
    expect(ctx.terminals).toBe(null);
    expect(ctx.openEditors).toHaveLength(2);
    expect(mcp.calls.some((c) => c.tool === "getTerminalOutput")).toBe(false);
  });
});

describe("formatIdeContext — terminal block", () => {
  it("renders recent commands with exit code and output", () => {
    const out = formatIdeContext({ selection: null, openEditors: null, terminals: TERMINALS });
    expect(out).toContain("Recent terminal commands:");
    expect(out).toContain("$ npm test (exit 0)");
    expect(out).toContain("12 passed");
    expect(out).toContain("$ npm run build (exit 1)");
    expect(out).toContain("TS2322 boom");
  });

  it("truncates long output to the tail", () => {
    const big = "X".repeat(50) + "ERR_AT_END";
    const out = formatIdeContext({
      terminals: [{ command: "noisy", exitCode: 1, output: "A".repeat(2000) + "ERR_AT_END" }],
    });
    expect(out).toContain("ERR_AT_END"); // tail kept
    expect(out).toContain("...(output truncated)");
    expect(big).toBeTruthy();
  });
});
