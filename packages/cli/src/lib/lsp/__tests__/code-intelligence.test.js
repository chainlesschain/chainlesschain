/**
 * CodeIntelligence tests — result normalization + graceful degradation. Injects
 * a fake LSPManager so no server runs; asserts that raw LSP shapes (Location vs
 * LocationLink, DocumentSymbol vs SymbolInformation, WorkspaceEdit variants) are
 * flattened to 1-based `{file,line,col}` and that "no server" degrades cleanly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CodeIntelligence, _deps } from "../code-intelligence.js";

/** Fake manager: canned request results, or an "unavailable" verdict. */
function fakeManager({ requestResult, unavailable, diagnostics } = {}) {
  const client = {
    request: async () => requestResult,
    running: true,
  };
  return {
    projectRoot: "/proj",
    async ensureFor() {
      if (unavailable) return { unavailable: true, reason: unavailable };
      return {
        client,
        uri: "file:///proj/a.ts",
        languageId: "typescript",
        root: "/proj",
      };
    },
    async didChangeFile() {
      return this.ensureFor();
    },
    async waitForDiagnostics() {
      return diagnostics || [];
    },
    async disposeAll() {},
  };
}

let origRead;
beforeEach(() => {
  origRead = _deps.readFileSync;
  _deps.readFileSync = () => "const foo = 1;\nfoo();\n";
});
afterEach(() => {
  _deps.readFileSync = origRead;
});

describe("definition/references normalization", () => {
  it("normalizes a plain Location to 1-based with a snippet", async () => {
    const mgr = fakeManager({
      requestResult: [
        {
          uri: "file:///proj/a.ts",
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 9 },
          },
        },
      ],
    });
    const ci = new CodeIntelligence({ manager: mgr });
    const res = await ci.definition("a.ts", 2, 1);
    expect(res.available).toBe(true);
    expect(res.locations[0]).toMatchObject({
      file: expect.stringContaining("a.ts"),
      line: 1, // 0 → 1
      col: 7, // 6 → 7
      endLine: 1,
      endCol: 10,
    });
    expect(res.locations[0].snippet).toBe("const foo = 1;");
  });

  it("normalizes a LocationLink (targetUri/targetRange)", async () => {
    const mgr = fakeManager({
      requestResult: [
        {
          targetUri: "file:///proj/b.ts",
          targetSelectionRange: {
            start: { line: 4, character: 2 },
            end: { line: 4, character: 5 },
          },
        },
      ],
    });
    const ci = new CodeIntelligence({ manager: mgr });
    const res = await ci.definition("a.ts", 2, 1);
    expect(res.locations[0]).toMatchObject({ line: 5, col: 3 });
    expect(res.locations[0].file).toContain("b.ts");
  });
});

describe("graceful degradation", () => {
  it("returns available:false with a reason when no server is installed", async () => {
    const mgr = fakeManager({
      unavailable: "no language server installed for typescript",
    });
    const ci = new CodeIntelligence({ manager: mgr });
    const res = await ci.definition("a.ts", 1, 1);
    expect(res).toEqual({
      available: false,
      reason: "no language server installed for typescript",
    });
  });
});

describe("document symbols", () => {
  it("flattens hierarchical DocumentSymbols with container names", async () => {
    const mgr = fakeManager({
      requestResult: [
        {
          name: "MyClass",
          kind: 5, // class
          selectionRange: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 13 },
          },
          children: [
            {
              name: "method1",
              kind: 6,
              selectionRange: {
                start: { line: 1, character: 2 },
                end: { line: 1, character: 9 },
              },
            },
          ],
        },
      ],
    });
    const ci = new CodeIntelligence({ manager: mgr });
    const res = await ci.documentSymbols("a.ts");
    expect(res.symbols).toHaveLength(2);
    expect(res.symbols[0]).toMatchObject({
      name: "MyClass",
      kind: "class",
      line: 1,
    });
    expect(res.symbols[1]).toMatchObject({
      name: "method1",
      kind: "method",
      container: "MyClass",
      line: 2,
    });
  });
});

describe("diagnostics", () => {
  it("normalizes severity and position", async () => {
    const mgr = fakeManager({
      diagnostics: [
        {
          severity: 1,
          message: "Cannot find name 'x'.",
          range: {
            start: { line: 3, character: 4 },
            end: { line: 3, character: 5 },
          },
          code: 2304,
          source: "ts",
        },
      ],
    });
    const ci = new CodeIntelligence({ manager: mgr });
    const res = await ci.diagnostics("a.ts");
    expect(res.diagnostics[0]).toMatchObject({
      severity: "error",
      message: "Cannot find name 'x'.",
      line: 4,
      col: 5,
      code: "2304",
      source: "ts",
    });
  });
});

describe("rename preview", () => {
  it("flattens WorkspaceEdit.changes without applying", async () => {
    const mgr = fakeManager({
      requestResult: {
        changes: {
          "file:///proj/a.ts": [
            {
              range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 9 },
              },
              newText: "bar",
            },
          ],
        },
      },
    });
    const ci = new CodeIntelligence({ manager: mgr });
    const res = await ci.renamePreview("a.ts", 1, 7, "bar");
    expect(res.edits).toHaveLength(1);
    expect(res.edits[0].file).toContain("a.ts");
    expect(res.edits[0].edits[0]).toMatchObject({
      line: 1,
      col: 7,
      newText: "bar",
    });
  });

  it("flattens WorkspaceEdit.documentChanges", async () => {
    const mgr = fakeManager({
      requestResult: {
        documentChanges: [
          {
            textDocument: { uri: "file:///proj/c.ts", version: 2 },
            edits: [
              {
                range: {
                  start: { line: 9, character: 0 },
                  end: { line: 9, character: 3 },
                },
                newText: "baz",
              },
            ],
          },
        ],
      },
    });
    const ci = new CodeIntelligence({ manager: mgr });
    const res = await ci.renamePreview("a.ts", 1, 1, "baz");
    expect(res.edits[0].file).toContain("c.ts");
    expect(res.edits[0].edits[0]).toMatchObject({ line: 10, newText: "baz" });
  });
});
