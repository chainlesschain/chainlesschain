/**
 * Explicit @selection / @diagnostics at-mentions (Claude-Code parity).
 *
 * Covers the pure scanner (findIdeMentions), the two formatters, and the
 * expandIdeMentions orchestrator against a fake resolved-MCP IDE bundle.
 */
import { describe, it, expect } from "vitest";
import {
  findIdeMentions,
  formatSelectionMention,
  formatDiagnosticsMention,
  formatTerminalMention,
  expandIdeMentions,
} from "../../src/lib/ide-context.js";

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

const DIAGNOSTICS = [
  {
    file: "C:/proj/src/app.js",
    severity: "error",
    message: "Cannot find name 'foo'.",
    line: 4,
    source: "ts",
  },
  {
    file: "C:/proj/src/app.js",
    severity: "warning",
    message: "'x' is declared but never used.",
    line: 7,
    source: "ts",
  },
  // Filtered out — not error/warning.
  { file: "C:/proj/src/app.js", severity: "hint", message: "noise", line: 1 },
];

/** Resolved-MCP bundle with the IDE bridge connected (selection+diagnostics). */
function fakeIdeMcp({ selection = SELECTION, diagnostics = DIAGNOSTICS } = {}) {
  return {
    mcpClient: {
      callTool: async (server, tool) => {
        if (tool === "getSelection") return txt(selection);
        if (tool === "getDiagnostics") return txt({ diagnostics });
        return txt(null);
      },
    },
    externalToolExecutors: {
      mcp__ide__getSelection: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getSelection",
      },
      mcp__ide__getDiagnostics: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getDiagnostics",
      },
    },
  };
}

describe("findIdeMentions", () => {
  it("finds @selection and @diagnostics at word boundaries", () => {
    expect(findIdeMentions("explain @selection please")).toEqual(["selection"]);
    expect(findIdeMentions("fix @diagnostics now")).toEqual(["diagnostics"]);
    expect(findIdeMentions("(@selection) and [@diagnostics]")).toEqual([
      "selection",
      "diagnostics",
    ]);
  });

  it("dedupes and preserves first-seen order", () => {
    expect(
      findIdeMentions("@diagnostics then @selection then @diagnostics"),
    ).toEqual(["diagnostics", "selection"]);
  });

  it("does not match glued/email-like or unknown tokens", () => {
    expect(findIdeMentions("user@selection.com")).toEqual([]);
    expect(findIdeMentions("foo@diagnostics")).toEqual([]);
    expect(findIdeMentions("@selections @diag")).toEqual([]);
    expect(findIdeMentions("no mentions here")).toEqual([]);
  });

  it("tolerates non-string input", () => {
    expect(findIdeMentions(null)).toEqual([]);
    expect(findIdeMentions(undefined)).toEqual([]);
  });
});

describe("formatSelectionMention", () => {
  it("renders file + 1-based line range + text", () => {
    const b = formatSelectionMention(SELECTION);
    expect(b).toContain("<ide-selection");
    expect(b).toContain("C:/proj/src/app.js:10-12"); // 0-based 9..11 → 10..12
    expect(b).toContain("return a + b;");
    expect(b).toContain("</ide-selection>");
  });

  it("returns null for empty/missing selection text", () => {
    expect(formatSelectionMention(null)).toBeNull();
    expect(formatSelectionMention({ text: "" })).toBeNull();
    expect(formatSelectionMention({ file: "x.js" })).toBeNull();
  });

  it("truncates oversized selections", () => {
    const big = { file: "x.js", text: "y".repeat(5000) };
    const b = formatSelectionMention(big);
    expect(b).toContain("(selection truncated)");
    expect(b.length).toBeLessThan(5000);
  });
});

describe("formatDiagnosticsMention", () => {
  it("keeps only error/warning and renders 1-based lines", () => {
    const b = formatDiagnosticsMention({ diagnostics: DIAGNOSTICS });
    expect(b).toContain("<ide-diagnostics");
    expect(b).toContain(
      "[error] C:/proj/src/app.js:5 Cannot find name 'foo'. (ts)",
    );
    expect(b).toContain("[warning] C:/proj/src/app.js:8");
    expect(b).not.toContain("noise"); // hint filtered out
  });

  it("returns null when there are no error/warning diagnostics", () => {
    expect(formatDiagnosticsMention({ diagnostics: [] })).toBeNull();
    expect(
      formatDiagnosticsMention({
        diagnostics: [{ severity: "hint", message: "x" }],
      }),
    ).toBeNull();
    expect(formatDiagnosticsMention(null)).toBeNull();
  });

  it("caps and reports overflow", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      file: "a.js",
      severity: "error",
      message: "e" + i,
      line: i,
    }));
    const b = formatDiagnosticsMention({ diagnostics: many });
    expect(b).toContain("(+30 more)"); // 80 - 50 cap
  });
});

describe("expandIdeMentions", () => {
  it("expands @selection into a block", async () => {
    const r = await expandIdeMentions("explain @selection", fakeIdeMcp());
    expect(r.expanded).toEqual(["selection"]);
    expect(r.block).toContain("<ide-selection");
    expect(r.block).toContain("return a + b;");
    expect(r.warnings).toEqual([]);
  });

  it("expands @diagnostics into a block", async () => {
    const r = await expandIdeMentions("fix @diagnostics", fakeIdeMcp());
    expect(r.expanded).toEqual(["diagnostics"]);
    expect(r.block).toContain("<ide-diagnostics");
    expect(r.warnings).toEqual([]);
  });

  it("expands both, joining blocks", async () => {
    const r = await expandIdeMentions(
      "review @selection against @diagnostics",
      fakeIdeMcp(),
    );
    expect(r.expanded).toEqual(["selection", "diagnostics"]);
    expect(r.block).toContain("<ide-selection");
    expect(r.block).toContain("<ide-diagnostics");
  });

  it("no-ops when there is no mention", async () => {
    const r = await expandIdeMentions("just a normal prompt", fakeIdeMcp());
    expect(r.block).toBeNull();
    expect(r.expanded).toEqual([]);
  });

  it("warns (not throws) when no IDE bridge is connected", async () => {
    const r = await expandIdeMentions("explain @selection", {});
    expect(r.block).toBeNull();
    expect(r.expanded).toEqual([]);
    expect(r.warnings[0]).toMatch(/no IDE bridge connected/);
  });

  it("warns when selection is empty / no problems reported", async () => {
    const mcp = fakeIdeMcp({ selection: { text: "" }, diagnostics: [] });
    const r = await expandIdeMentions("@selection @diagnostics", mcp);
    expect(r.block).toBeNull();
    expect(r.warnings).toContain(
      "@selection — no active selection (left as-is)",
    );
    expect(r.warnings).toContain(
      "@diagnostics — no problems reported (left as-is)",
    );
  });

  it("never throws when the IDE call rejects", async () => {
    const mcp = {
      mcpClient: {
        callTool: async () => {
          throw new Error("transport down");
        },
      },
      externalToolExecutors: {
        mcp__ide__getSelection: {
          kind: "mcp",
          serverName: "ide",
          toolName: "getSelection",
        },
      },
    };
    const r = await expandIdeMentions("explain @selection", mcp);
    expect(r.block).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ─── @terminal ──────────────────────────────────────────────────────────────

const TERMINALS = [
  { command: "npm test", exitCode: 0, output: "12 passed\n", terminal: "bash" },
  { command: "npm run build", exitCode: 1, output: "TS2322 boom", terminal: "bash" },
];

/** Bridge bundle that exposes the terminal-output tool. */
function fakeIdeMcpTerm({ terminals = TERMINALS } = {}) {
  const calls = [];
  return {
    mcpClient: {
      callTool: async (server, tool, args) => {
        calls.push({ tool, args });
        if (tool === "getTerminalOutput") return txt({ terminals });
        return txt(null);
      },
    },
    externalToolExecutors: {
      mcp__ide__getTerminalOutput: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getTerminalOutput",
      },
    },
    calls,
  };
}

describe("@terminal mention", () => {
  it("findIdeMentions recognizes @terminal at word boundaries", () => {
    expect(findIdeMentions("what failed? @terminal")).toEqual(["terminal"]);
    expect(findIdeMentions("@selection and @terminal")).toEqual([
      "selection",
      "terminal",
    ]);
    expect(findIdeMentions("user@terminal.com")).toEqual([]); // glued → no match
  });

  it("formatTerminalMention renders recent commands; null when empty", () => {
    const b = formatTerminalMention({ terminals: TERMINALS });
    expect(b).toContain("<ide-terminal");
    expect(b).toContain("$ npm test (exit 0)");
    expect(b).toContain("12 passed");
    expect(b).toContain("$ npm run build (exit 1)");
    expect(b).toContain("</ide-terminal>");
    expect(formatTerminalMention({ terminals: [] })).toBe(null);
    expect(formatTerminalMention(null)).toBe(null);
  });

  it("expandIdeMentions expands @terminal and requests more history (limit 5)", async () => {
    const mcp = fakeIdeMcpTerm();
    const r = await expandIdeMentions("what went wrong? @terminal", mcp);
    expect(r.expanded).toContain("terminal");
    expect(r.block).toContain("<ide-terminal");
    const call = mcp.calls.find((c) => c.tool === "getTerminalOutput");
    expect(call.args).toEqual({ limit: 5 });
  });

  it("warns (leaves as-is) when no terminal tool is connected", async () => {
    const noTermMcp = fakeIdeMcp(); // selection+diagnostics only
    const r = await expandIdeMentions("show @terminal", noTermMcp);
    expect(r.block).toBeNull();
    expect(r.expanded).not.toContain("terminal");
    expect(r.warnings.some((w) => w.includes("@terminal"))).toBe(true);
  });
});
