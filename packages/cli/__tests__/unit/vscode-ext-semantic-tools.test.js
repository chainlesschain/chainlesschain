/**
 * Semantic navigation IDE tools (gap #7): getHover / goToDefinition /
 * findReferences / renamePreview / getCallHierarchy / getSymbolInfo /
 * getProjectModel. Pure semantic-tools.js logic verified with a fake `lsp`
 * facade (validation, 1-based↔0-based conversion, caps, hover flattening,
 * workspace-relative uris), plus the buildIdeTools gating and the real
 * vscode-facade `lsp` adapter driven by a fake `vscode`.
 */
import { describe, it, expect, vi } from "vitest";

import {
  buildSemanticTools,
  flattenHoverContents,
  toWorkspaceRelative,
  MAX_HOVER_CHARS,
  MAX_REFERENCES,
  MAX_CALL_NODES,
} from "../../../vscode-extension/src/semantic-tools.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

const SEMANTIC_NAMES = [
  "findReferences",
  "getCallHierarchy",
  "getHover",
  "getProjectModel",
  "getSymbolInfo",
  "goToDefinition",
  "renamePreview",
];

const baseFacade = () => ({
  getSelection: async () => null,
  getDiagnostics: async () => [],
  getOpenEditors: async () => [],
  openDiff: async (args) => ({ outcome: "rejected", path: args.path }),
});

const fakeLsp = (overrides = {}) => ({
  hover: async () => [],
  definition: async () => [],
  references: async () => [],
  prepareCallHierarchy: async () => [],
  incomingCalls: async () => [],
  outgoingCalls: async () => [],
  documentSymbols: async () => [],
  workspaceRoots: async () => [{ name: "ws", path: "/ws" }],
  openEditorLanguages: async () => [],
  listFiles: async () => [],
  ...overrides,
});

const tool = (lsp, name) =>
  buildSemanticTools(lsp).find((t) => t.name === name);

const loc = (fsPath, sl, sc, el, ec) => ({
  uri: { fsPath },
  range: {
    start: { line: sl, character: sc },
    end: { line: el, character: ec },
  },
});

describe("buildIdeTools — conditional semantic tools", () => {
  it("facade WITHOUT lsp exposes none of the semantic tools", () => {
    const names = buildIdeTools(baseFacade()).map((t) => t.name);
    for (const n of SEMANTIC_NAMES) expect(names).not.toContain(n);
    expect(names).toHaveLength(5); // the untouched core set
  });

  it("facade WITH lsp exposes all 7, each with a position schema", () => {
    const tools = buildIdeTools({ ...baseFacade(), lsp: fakeLsp() });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of SEMANTIC_NAMES) expect(byName[n]).toBeDefined();
    expect(tools).toHaveLength(5 + SEMANTIC_NAMES.length);
    // Position tools require path/line/column; getProjectModel does not.
    expect(byName.getHover.inputSchema.required).toEqual([
      "path",
      "line",
      "column",
    ]);
    expect(byName.getProjectModel.inputSchema.required).toBeUndefined();
    // The 1-based convention is documented on every position input.
    expect(
      byName.goToDefinition.inputSchema.properties.line.description,
    ).toMatch(/1-based/);
  });

  it("attaches cc-ide-context/v2 to every semantic result through the editor facade", async () => {
    const getContextMetadata = vi.fn(async ({ file, tool }) => ({
      schema: "cc-ide-context/v2",
      workspaceId: "ws-fixture",
      documentUri: file ? `file://${file}` : null,
      documentVersion: file ? 17 : null,
      isDirty: file ? true : null,
      permissionSource: "workspace-trust:trusted",
      freshness: {
        state: file ? "live-buffer" : "live-host",
        capturedAt: "2026-07-23T00:00:00.000Z",
      },
      tool,
    }));
    const tools = buildIdeTools({
      ...baseFacade(),
      lsp: fakeLsp(),
      getContextMetadata,
    });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const position = { path: "/ws/src/a.ts", line: 3, column: 4 };

    for (const name of SEMANTIC_NAMES) {
      const result = await byName[name].handler(
        name === "getProjectModel" ? {} : position,
      );
      expect(result.context).toMatchObject({
        schema: "cc-ide-context/v2",
        workspaceId: "ws-fixture",
        documentUri:
          name === "getProjectModel" ? null : "file:///ws/src/a.ts",
        tool: name,
      });
    }
    expect(getContextMetadata).toHaveBeenCalledTimes(SEMANTIC_NAMES.length);
    expect(getContextMetadata).toHaveBeenCalledWith({
      file: null,
      tool: "getProjectModel",
    });
  });

  it("preserves legacy semantic payloads when context probing fails", async () => {
    const legacy = tool(fakeLsp(), "goToDefinition");
    const withBrokenContext = buildSemanticTools(fakeLsp(), async () => {
      throw new Error("host metadata unavailable");
    }).find((t) => t.name === "goToDefinition");
    const args = { path: "/ws/a.ts", line: 1, column: 1 };

    expect(await withBrokenContext.handler(args)).toEqual(
      await legacy.handler(args),
    );
  });
});

describe("input validation (1-based line/column)", () => {
  it.each([
    [{}, /requires `path`/],
    [{ path: "/ws/a.js", column: 1 }, /`line`/],
    [{ path: "/ws/a.js", line: 0, column: 1 }, /`line`.*1-based/],
    [{ path: "/ws/a.js", line: 1.5, column: 1 }, /`line`/],
    [{ path: "/ws/a.js", line: 1 }, /`column`/],
    [{ path: "/ws/a.js", line: 1, column: 0 }, /`column`.*1-based/],
  ])("getHover rejects %j", async (args, re) => {
    await expect(tool(fakeLsp(), "getHover").handler(args)).rejects.toThrow(re);
  });

  it("every position tool validates before touching the lsp", async () => {
    const spyLsp = fakeLsp({
      references: vi.fn(async () => []),
      prepareCallHierarchy: vi.fn(async () => []),
    });
    for (const name of [
      "goToDefinition",
      "findReferences",
      "renamePreview",
      "getCallHierarchy",
      "getSymbolInfo",
    ]) {
      await expect(tool(spyLsp, name).handler({ path: "" })).rejects.toThrow(
        /requires `path`/,
      );
    }
    expect(spyLsp.references).not.toHaveBeenCalled();
    expect(spyLsp.prepareCallHierarchy).not.toHaveBeenCalled();
  });
});

describe("1-based input → 0-based lsp, 1-based output ranges", () => {
  it("converts the tool position to a 0-based lsp position", async () => {
    let seen = null;
    const lsp = fakeLsp({
      hover: async (target) => {
        seen = target;
        return [];
      },
    });
    await tool(lsp, "getHover").handler({
      path: "/ws/src/a.js",
      line: 10,
      column: 5,
    });
    expect(seen).toEqual({ path: "/ws/src/a.js", line: 9, character: 4 });
  });

  it("goToDefinition returns 1-based ranges and relative uris", async () => {
    const lsp = fakeLsp({
      definition: async () => [loc("/ws/src/a.js", 2, 4, 2, 9)],
    });
    const res = await tool(lsp, "goToDefinition").handler({
      path: "/ws/src/b.js",
      line: 1,
      column: 1,
    });
    expect(res).toEqual({
      definitions: [
        {
          uri: "src/a.js",
          range: { startLine: 3, startCol: 5, endLine: 3, endCol: 10 },
        },
      ],
      total: 1,
    });
  });

  it("handles LocationLink results (targetUri + targetSelectionRange)", async () => {
    const lsp = fakeLsp({
      definition: async () => [
        {
          targetUri: { fsPath: "/ws/lib/c.ts" },
          targetRange: {
            start: { line: 0, character: 0 },
            end: { line: 40, character: 1 },
          },
          targetSelectionRange: {
            start: { line: 4, character: 9 },
            end: { line: 4, character: 14 },
          },
        },
      ],
    });
    const res = await tool(lsp, "goToDefinition").handler({
      path: "/ws/src/b.js",
      line: 1,
      column: 1,
    });
    // The precise selection range wins over the whole symbol body.
    expect(res.definitions[0]).toEqual({
      uri: "lib/c.ts",
      range: { startLine: 5, startCol: 10, endLine: 5, endCol: 15 },
    });
  });
});

describe("workspace-relative uri mapping", () => {
  it("relativizes under a root (posix and windows separators)", () => {
    expect(toWorkspaceRelative("/ws/src/a.js", [{ path: "/ws" }])).toBe(
      "src/a.js",
    );
    expect(
      toWorkspaceRelative("C:\\proj\\src\\b.js", [{ path: "C:\\proj" }]),
    ).toBe("src/b.js");
    expect(toWorkspaceRelative("/ws", [{ path: "/ws" }])).toBe(".");
  });

  it("leaves paths outside every root unchanged (no sibling-prefix match)", () => {
    expect(toWorkspaceRelative("/elsewhere/x.js", [{ path: "/ws" }])).toBe(
      "/elsewhere/x.js",
    );
    // "/ws-other" must NOT be treated as inside "/ws".
    expect(toWorkspaceRelative("/ws-other/x.js", [{ path: "/ws" }])).toBe(
      "/ws-other/x.js",
    );
  });
});

describe("getHover content normalization", () => {
  it("flattens MarkdownString / plain string / MarkedString forms", () => {
    const text = flattenHoverContents([
      { contents: [{ value: "**bold docs**" }, "plain tail"] },
      { contents: { language: "ts", value: "function f(): void" } },
    ]);
    expect(text).toContain("**bold docs**");
    expect(text).toContain("plain tail");
    expect(text).toContain("```ts\nfunction f(): void\n```");
  });

  it("truncates at 8k chars", () => {
    const text = flattenHoverContents([
      { contents: [{ value: "x".repeat(MAX_HOVER_CHARS + 1000) }] },
    ]);
    expect(text).toHaveLength(MAX_HOVER_CHARS);
  });

  it("returns hover:null when the provider has nothing", async () => {
    const lsp = fakeLsp({ hover: async () => [{ contents: ["", null] }] });
    const res = await tool(lsp, "getHover").handler({
      path: "/ws/a.js",
      line: 1,
      column: 1,
    });
    expect(res.hover).toBeNull();
    expect(res).toMatchObject({ uri: "a.js", line: 1, column: 1 });
  });
});

describe("findReferences cap", () => {
  const manyRefs = (n) =>
    Array.from({ length: n }, (_, i) => loc(`/ws/f${i % 7}.js`, i, 0, i, 4));

  it("caps at the 200 default and reports total + truncated", async () => {
    const lsp = fakeLsp({ references: async () => manyRefs(250) });
    const res = await tool(lsp, "findReferences").handler({
      path: "/ws/a.js",
      line: 1,
      column: 1,
    });
    expect(res.references).toHaveLength(MAX_REFERENCES);
    expect(res.total).toBe(250);
    expect(res.truncated).toBe(true);
  });

  it("a user limit can only LOWER the cap", async () => {
    const lsp = fakeLsp({ references: async () => manyRefs(250) });
    const low = await tool(lsp, "findReferences").handler({
      path: "/ws/a.js",
      line: 1,
      column: 1,
      limit: 10,
    });
    expect(low.references).toHaveLength(10);
    const high = await tool(lsp, "findReferences").handler({
      path: "/ws/a.js",
      line: 1,
      column: 1,
      limit: 9999,
    });
    expect(high.references).toHaveLength(MAX_REFERENCES);
  });
});

describe("renamePreview (no mutation)", () => {
  it("aggregates per-file occurrence counts from references", async () => {
    const lsp = fakeLsp({
      references: async () => [
        loc("/ws/src/a.js", 1, 0, 1, 3),
        loc("/ws/src/a.js", 5, 2, 5, 5),
        loc("/ws/src/a.js", 9, 0, 9, 3),
        loc("/ws/src/b.js", 2, 0, 2, 3),
        loc("/elsewhere/c.js", 0, 0, 0, 3),
      ],
    });
    const res = await tool(lsp, "renamePreview").handler({
      path: "/ws/src/a.js",
      line: 2,
      column: 1,
      newName: "renamed",
    });
    expect(res.newName).toBe("renamed");
    expect(res.files).toEqual([
      { uri: "src/a.js", occurrences: 3 },
      { uri: "src/b.js", occurrences: 1 },
      { uri: "/elsewhere/c.js", occurrences: 1 },
    ]);
    expect(res.fileCount).toBe(3);
    expect(res.totalOccurrences).toBe(5);
    expect(res.truncated).toBe(false);
    expect(res.applied).toBe(false); // preview only — nothing renamed
  });
});

describe("getCallHierarchy", () => {
  const item = (name, file) => ({
    name,
    kind: 11, // function
    uri: { fsPath: file },
    range: { start: { line: 0, character: 0 }, end: { line: 9, character: 1 } },
    selectionRange: {
      start: { line: 0, character: 9 },
      end: { line: 0, character: 9 + name.length },
    },
  });

  it("returns one shaped level of callers + callees", async () => {
    const root = item("target", "/ws/src/t.js");
    const lsp = fakeLsp({
      prepareCallHierarchy: async () => [root],
      incomingCalls: async (i) => {
        expect(i).toBe(root); // the exact prepared instance must ride through
        return [
          {
            from: item("callerA", "/ws/src/a.js"),
            fromRanges: [
              {
                start: { line: 3, character: 2 },
                end: { line: 3, character: 8 },
              },
            ],
          },
        ];
      },
      outgoingCalls: async () => [
        {
          from: undefined,
          to: item("calleeB", "/ws/src/b.js"),
          fromRanges: [],
        },
      ],
    });
    const res = await tool(lsp, "getCallHierarchy").handler({
      path: "/ws/src/t.js",
      line: 1,
      column: 10,
    });
    expect(res.item).toEqual({
      name: "target",
      kind: "function",
      uri: "src/t.js",
      range: { startLine: 1, startCol: 10, endLine: 1, endCol: 16 },
    });
    expect(res.callers).toEqual([
      {
        name: "callerA",
        kind: "function",
        uri: "src/a.js",
        range: { startLine: 1, startCol: 10, endLine: 1, endCol: 17 },
        fromRanges: [{ startLine: 4, startCol: 3, endLine: 4, endCol: 9 }],
      },
    ]);
    expect(res.callees[0].name).toBe("calleeB");
    expect(res.truncated).toBe(false);
  });

  it("caps callers+callees at 100 combined nodes (callers fill first)", async () => {
    const many = (n, prefix) =>
      Array.from({ length: n }, (_, i) => ({
        from: item(`${prefix}${i}`, `/ws/${prefix}${i}.js`),
        to: item(`${prefix}${i}`, `/ws/${prefix}${i}.js`),
        fromRanges: [],
      }));
    const lsp = fakeLsp({
      prepareCallHierarchy: async () => [item("t", "/ws/t.js")],
      incomingCalls: async () => many(80, "in"),
      outgoingCalls: async () => many(80, "out"),
    });
    const res = await tool(lsp, "getCallHierarchy").handler({
      path: "/ws/t.js",
      line: 1,
      column: 1,
    });
    expect(res.callers).toHaveLength(80);
    expect(res.callees).toHaveLength(MAX_CALL_NODES - 80);
    expect(res.truncated).toBe(true);
  });

  it("no hierarchy item at the position → item:null, empty lists", async () => {
    const res = await tool(fakeLsp(), "getCallHierarchy").handler({
      path: "/ws/t.js",
      line: 1,
      column: 1,
    });
    expect(res).toEqual({
      item: null,
      callers: [],
      callees: [],
      truncated: false,
    });
  });
});

describe("getSymbolInfo (containing symbol chain)", () => {
  const range = (sl, sc, el, ec) => ({
    start: { line: sl, character: sc },
    end: { line: el, character: ec },
  });

  it("walks nested DocumentSymbols outermost → innermost", async () => {
    const lsp = fakeLsp({
      documentSymbols: async () => [
        {
          name: "MyClass",
          kind: 4,
          range: range(0, 0, 20, 1),
          selectionRange: range(0, 6, 0, 13),
          children: [
            {
              name: "myMethod",
              kind: 5,
              range: range(5, 2, 10, 3),
              selectionRange: range(5, 4, 5, 12),
              children: [],
            },
          ],
        },
      ],
    });
    // 1-based line 8 = 0-based line 7, inside myMethod inside MyClass.
    const res = await tool(lsp, "getSymbolInfo").handler({
      path: "/ws/src/a.ts",
      line: 8,
      column: 5,
    });
    expect(res.uri).toBe("src/a.ts");
    expect(res.chain.map((s) => `${s.kind} ${s.name}`)).toEqual([
      "class MyClass",
      "method myMethod",
    ]);
    expect(res.symbol).toEqual({
      name: "myMethod",
      kind: "method",
      range: { startLine: 6, startCol: 5, endLine: 6, endCol: 13 },
    });
  });

  it("handles the flat SymbolInformation shape (widest first)", async () => {
    const lsp = fakeLsp({
      documentSymbols: async () => [
        {
          name: "inner",
          kind: 11,
          location: { uri: { fsPath: "/ws/a.js" }, range: range(5, 0, 10, 1) },
        },
        {
          name: "Outer",
          kind: 4,
          location: { uri: { fsPath: "/ws/a.js" }, range: range(0, 0, 20, 1) },
        },
      ],
    });
    const res = await tool(lsp, "getSymbolInfo").handler({
      path: "/ws/a.js",
      line: 7,
      column: 1,
    });
    expect(res.chain.map((s) => s.name)).toEqual(["Outer", "inner"]);
  });

  it("position outside every symbol → empty chain, null symbol", async () => {
    const lsp = fakeLsp({
      documentSymbols: async () => [
        { name: "f", kind: 11, range: range(0, 0, 2, 1), children: [] },
      ],
    });
    const res = await tool(lsp, "getSymbolInfo").handler({
      path: "/ws/a.js",
      line: 50,
      column: 1,
    });
    expect(res.chain).toEqual([]);
    expect(res.symbol).toBeNull();
  });
});

describe("getProjectModel", () => {
  it("reports folders, open-editor languages, extension histogram", async () => {
    const lsp = fakeLsp({
      workspaceRoots: async () => [{ name: "ws", path: "/ws" }],
      openEditorLanguages: async () => [
        { file: "/ws/src/a.ts", languageId: "typescript" },
        { file: "/elsewhere/b.py", languageId: "python" },
      ],
      listFiles: async () => [
        "/ws/src/a.ts",
        "/ws/src/b.ts",
        "/ws/README.md",
        "/ws/Makefile",
      ],
    });
    const res = await tool(lsp, "getProjectModel").handler({});
    expect(res.workspaceFolders).toEqual([{ name: "ws", path: "/ws" }]);
    expect(res.openEditors).toEqual([
      { file: "src/a.ts", languageId: "typescript" },
      { file: "/elsewhere/b.py", languageId: "python" },
    ]);
    expect(res.filesByExtension).toEqual({
      ".ts": 2,
      ".md": 1,
      "(none)": 1,
    });
    expect(res.scannedFiles).toBe(4);
    expect(res.fileScanTruncated).toBe(false);
  });

  it("flags a scan that filled the cap as truncated", async () => {
    const lsp = fakeLsp({
      listFiles: async ({ max }) =>
        Array.from({ length: max }, (_, i) => `/ws/f${i}.js`),
    });
    const res = await tool(lsp, "getProjectModel").handler({ maxFiles: 3 });
    expect(res.scannedFiles).toBe(3);
    expect(res.fileScanTruncated).toBe(true);
  });
});

describe("vscode-facade lsp adapter (fake vscode)", () => {
  function makeFakeVscode() {
    const executeCommand = vi.fn(async () => []);
    return {
      window: {},
      commands: { executeCommand },
      workspace: {
        openTextDocument: vi.fn(async (uri) => ({ uri })),
        workspaceFolders: [
          { name: "ws", uri: { fsPath: "/ws", scheme: "file" } },
        ],
        textDocuments: [
          {
            uri: { fsPath: "/ws/a.ts", scheme: "file" },
            languageId: "typescript",
          },
          { uri: { scheme: "untitled" }, languageId: "plaintext" },
        ],
        findFiles: vi.fn(async () => [{ fsPath: "/ws/a.ts" }]),
      },
      Uri: { file: (p) => ({ fsPath: p, scheme: "file" }) },
      Position: class {
        constructor(line, character) {
          this.line = line;
          this.character = character;
        }
      },
      _executeCommand: executeCommand,
    };
  }

  it("exposes lsp and dispatches hover with a 0-based Position", async () => {
    const fake = makeFakeVscode();
    const facade = createVscodeEditorFacade(fake);
    expect(facade.lsp).toBeTruthy();
    await facade.lsp.hover({ path: "/ws/a.ts", line: 9, character: 4 });
    const [cmd, uri, pos] = fake._executeCommand.mock.calls[0];
    expect(cmd).toBe("vscode.executeHoverProvider");
    expect(uri.fsPath).toBe("/ws/a.ts");
    expect(pos).toMatchObject({ line: 9, character: 4 });
  });

  it("routes each raw query to its execute-command", async () => {
    const fake = makeFakeVscode();
    const facade = createVscodeEditorFacade(fake);
    const pos = { path: "/ws/a.ts", line: 0, character: 0 };
    await facade.lsp.definition(pos);
    await facade.lsp.references(pos);
    await facade.lsp.prepareCallHierarchy(pos);
    const item = { name: "f" };
    await facade.lsp.incomingCalls(item);
    await facade.lsp.outgoingCalls(item);
    await facade.lsp.documentSymbols({ path: "/ws/a.ts" });
    const cmds = fake._executeCommand.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([
      "vscode.executeDefinitionProvider",
      "vscode.executeReferenceProvider",
      "vscode.prepareCallHierarchy",
      "vscode.provideIncomingCalls",
      "vscode.provideOutgoingCalls",
      "vscode.executeDocumentSymbolProvider",
    ]);
    // The prepared hierarchy item instance rides through untouched.
    expect(fake._executeCommand.mock.calls[3][1]).toBe(item);
  });

  it("workspaceRoots / openEditorLanguages / listFiles adapt workspace state", async () => {
    const fake = makeFakeVscode();
    const facade = createVscodeEditorFacade(fake);
    expect(await facade.lsp.workspaceRoots()).toEqual([
      { name: "ws", path: "/ws" },
    ]);
    // Non-file schemes (untitled buffers) are filtered out.
    expect(await facade.lsp.openEditorLanguages()).toEqual([
      { file: "/ws/a.ts", languageId: "typescript" },
    ]);
    expect(await facade.lsp.listFiles({ max: 7 })).toEqual(["/ws/a.ts"]);
    expect(fake.workspace.findFiles).toHaveBeenCalledWith(
      "**/*",
      expect.stringContaining("node_modules"),
      7,
    );
  });
});
