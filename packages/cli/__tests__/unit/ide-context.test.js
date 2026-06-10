/**
 * IDE live prompt context (Claude-Code at-submit selection sharing parity).
 *
 * Covers the pure module (src/lib/ide-context.js) and the headless-runner
 * wiring: when resolveAgentMcp yields an IDE bridge, the editor's selection /
 * open editors are appended to the in-flight user turn — and ONLY the
 * in-flight turn (persistence stays clean).
 */
import { describe, it, expect, vi } from "vitest";
import {
  ideContextEnabled,
  hasIdeContextTools,
  parseToolResultJson,
  collectIdeContext,
  formatIdeContext,
  appendTextToContent,
  buildIdePromptContext,
} from "../../src/lib/ide-context.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

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
