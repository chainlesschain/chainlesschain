/**
 * "Fix with ChainlessChain" diagnostics quick-fix (Claude Code IDE parity).
 *
 * Layers: the pure prompt formatter (file `@ref` + severity-labelled bullets,
 * cap + truncate), the CodeActionProvider (one QuickFix only when a range
 * carries diagnostics, serializable command payload), the no-args fallback
 * that scopes the active editor's problems to the cursor/selection, and the
 * provider seam (`seedInput` reveals the panel and queues/flushes like
 * insertReference).
 */
import { describe, it, expect, vi } from "vitest";

import {
  formatFixPrompt,
  buildFixActionTitle,
  formatDiagnosticLine,
  hasFixableDiagnostics,
  diagnosticCode,
} from "../../../vscode-extension/src/chat/fix-with-cc.js";
import {
  mapVscodeDiagnostics,
  createFixCodeActionProvider,
  collectActiveDiagnostics,
  FIX_COMMAND,
} from "../../../vscode-extension/src/code-actions.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

describe("formatFixPrompt", () => {
  it("references the file as @path and lists 1-based, severity-labelled problems", () => {
    const out = formatFixPrompt({
      relPath: "src/app.ts",
      diagnostics: [
        {
          message: "Cannot find name 'foo'.",
          severity: 0,
          line: 12,
          source: "ts",
          code: 2304,
        },
      ],
    });
    expect(out).toContain("Fix the following problem in @src/app.ts");
    expect(out).toContain(
      "- [Error] line 13: Cannot find name 'foo'. (ts 2304)",
    );
    expect(out.endsWith("\n")).toBe(true);
  });

  it("pluralizes and normalizes Windows paths", () => {
    const out = formatFixPrompt({
      relPath: "src\\a.ts",
      diagnostics: [
        { message: "a", severity: 0, line: 0 },
        { message: "b", severity: 1, line: 4 },
      ],
    });
    expect(out).toContain("Fix the following problems in @src/a.ts");
    expect(out).toContain("- [Error] line 1: a");
    expect(out).toContain("- [Warning] line 5: b");
  });

  it("caps at 10 diagnostics and notes how many were omitted", () => {
    const diags = Array.from({ length: 13 }, (_, i) => ({
      message: "m" + i,
      severity: 0,
      line: i,
    }));
    const out = formatFixPrompt({ relPath: "x.ts", diagnostics: diags });
    expect((out.match(/^- \[Error\]/gm) || []).length).toBe(10);
    expect(out).toContain("…and 3 more");
  });

  it("falls back to 'this file' with no path and returns '' for no diagnostics", () => {
    expect(
      formatFixPrompt({
        diagnostics: [{ message: "x", severity: 0, line: 0 }],
      }),
    ).toContain("in this file");
    expect(formatFixPrompt({ relPath: "x.ts", diagnostics: [] })).toBe("");
    expect(formatFixPrompt({})).toBe("");
  });

  it("collapses multi-line messages and truncates very long ones", () => {
    const line = formatDiagnosticLine({
      message: "line one\n   line two\t\tthree",
      severity: 1,
      line: 0,
    });
    expect(line).toBe("- [Warning] line 1: line one line two three");
    const long = formatDiagnosticLine({
      message: "x".repeat(500),
      severity: 0,
      line: 0,
    });
    expect(long.length).toBeLessThan(330);
    expect(long.endsWith("…")).toBe(true);
  });

  it("renders { value } code objects and omits the parens when no source/code", () => {
    expect(diagnosticCode({ value: "no-unused-vars" })).toBe("no-unused-vars");
    expect(
      formatDiagnosticLine({
        message: "x",
        severity: 0,
        line: 0,
        code: { value: "E1" },
      }),
    ).toBe("- [Error] line 1: x (E1)");
    expect(formatDiagnosticLine({ message: "x", severity: 2, line: 2 })).toBe(
      "- [Info] line 3: x",
    );
  });
});

describe("title + fixable predicate", () => {
  it("titles singular vs counted", () => {
    expect(buildFixActionTitle([{}])).toBe("Fix with ChainlessChain");
    expect(buildFixActionTitle([{}, {}, {}])).toBe(
      "Fix 3 problems with ChainlessChain",
    );
  });
  it("hasFixableDiagnostics", () => {
    expect(hasFixableDiagnostics([{}])).toBe(true);
    expect(hasFixableDiagnostics([])).toBe(false);
    expect(hasFixableDiagnostics(null)).toBe(false);
  });
});

describe("mapVscodeDiagnostics", () => {
  it("flattens vscode Diagnostic shape to plain serializable objects", () => {
    const plain = mapVscodeDiagnostics([
      {
        message: "boom",
        severity: 1,
        source: "eslint",
        code: "no-undef",
        range: { start: { line: 7 } },
      },
      { message: 42 }, // defensive: missing fields
    ]);
    expect(plain[0]).toEqual({
      message: "boom",
      severity: 1,
      line: 7,
      source: "eslint",
      code: "no-undef",
    });
    expect(plain[1]).toEqual({
      message: "42",
      severity: 0,
      line: 0,
      source: undefined,
      code: undefined,
    });
  });
});

describe("createFixCodeActionProvider", () => {
  function fakeVscode() {
    class CodeAction {
      constructor(title, kind) {
        this.title = title;
        this.kind = kind;
      }
    }
    return { CodeAction, CodeActionKind: { QuickFix: "quickfix" } };
  }

  it("returns one QuickFix carrying a serializable command payload", () => {
    const vscode = fakeVscode();
    const provider = createFixCodeActionProvider(vscode);
    const doc = { uri: "file:///x/app.ts" };
    const ctx = {
      diagnostics: [
        {
          message: "boom",
          severity: 0,
          range: { start: { line: 3 } },
          source: "ts",
          code: 1,
        },
      ],
    };
    const actions = provider.provideCodeActions(doc, {}, ctx);
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe("Fix with ChainlessChain");
    expect(actions[0].kind).toBe("quickfix");
    expect(actions[0].command.command).toBe(FIX_COMMAND);
    const payload = actions[0].command.arguments[0];
    expect(payload.uri).toBe("file:///x/app.ts");
    expect(payload.diagnostics[0]).toEqual({
      message: "boom",
      severity: 0,
      line: 3,
      source: "ts",
      code: 1,
    });
    // payload must survive a JSON round-trip (command args are serialized)
    expect(() => JSON.parse(JSON.stringify(payload))).not.toThrow();
  });

  it("offers nothing when the range has no diagnostics", () => {
    const provider = createFixCodeActionProvider(fakeVscode());
    expect(provider.provideCodeActions({}, {}, { diagnostics: [] })).toEqual(
      [],
    );
    expect(provider.provideCodeActions({}, {}, {})).toEqual([]);
  });
});

describe("collectActiveDiagnostics (no-args fallback)", () => {
  function vscodeWith({ selection, diagnostics }) {
    return {
      window: {
        activeTextEditor: {
          document: { uri: "file:///x/a.ts" },
          selection,
        },
      },
      languages: { getDiagnostics: () => diagnostics },
    };
  }
  const diag = (line) => ({
    message: "m" + line,
    severity: 0,
    range: { start: { line } },
  });

  it("scopes to a non-empty selection's line range", () => {
    const vscode = vscodeWith({
      selection: { isEmpty: false, start: { line: 2 }, end: { line: 5 } },
      diagnostics: [diag(0), diag(3), diag(9)],
    });
    const r = collectActiveDiagnostics(vscode);
    expect(r.uri).toBe("file:///x/a.ts");
    expect(r.diagnostics.map((d) => d.line)).toEqual([3]);
  });

  it("scopes to the cursor line for an empty selection, else falls back to all", () => {
    const onLine = collectActiveDiagnostics(
      vscodeWith({
        selection: { isEmpty: true, active: { line: 9 } },
        diagnostics: [diag(0), diag(9)],
      }),
    );
    expect(onLine.diagnostics.map((d) => d.line)).toEqual([9]);

    const noneOnLine = collectActiveDiagnostics(
      vscodeWith({
        selection: { isEmpty: true, active: { line: 100 } },
        diagnostics: [diag(0), diag(9)],
      }),
    );
    expect(noneOnLine.diagnostics.map((d) => d.line)).toEqual([0, 9]);
  });

  it("returns null with no editor or no problems", () => {
    expect(collectActiveDiagnostics({ window: {}, languages: {} })).toBeNull();
    expect(
      collectActiveDiagnostics(
        vscodeWith({
          selection: { isEmpty: true, active: { line: 0 } },
          diagnostics: [],
        }),
      ),
    ).toBeNull();
  });
});

describe("ChatViewProvider.seedInput", () => {
  it("reveals the panel and queues the prompt until the webview is ready", () => {
    const executeCommand = vi.fn();
    const provider = new ChatViewProvider({ commands: { executeCommand } }, {});
    provider.seedInput(
      "Fix the following problem in @a.ts:\n- [Error] line 1: x\n",
    );
    expect(executeCommand).toHaveBeenCalledWith("chainlesschainIdeChat.focus");
    expect(provider._pendingInsert).toContain("- [Error] line 1: x");
  });

  it("posts the seed immediately when the webview is already live", () => {
    const postMessage = vi.fn(() => Promise.resolve());
    const provider = new ChatViewProvider(
      { commands: { executeCommand: vi.fn() } },
      {},
    );
    provider.view = { webview: { postMessage } };
    provider._webviewReady = true;
    provider.seedInput("hello");
    expect(postMessage).toHaveBeenCalledWith({
      kind: "insertText",
      text: "hello",
    });
  });
});
