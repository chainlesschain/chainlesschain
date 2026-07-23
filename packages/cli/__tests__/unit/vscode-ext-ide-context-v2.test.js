import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildIdeContextV2,
  workspaceId,
} from "../../../vscode-extension/src/ide-context-v2.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

const fixturePath = fileURLToPath(
  new URL(
    "../../../vscode-extension/src/__fixtures__/ide-context-v2/cases.json",
    import.meta.url,
  ),
);
const cases = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

describe("cc-ide-context/v2 shared twin fixture", () => {
  for (const item of cases) {
    it(item.name, () => {
      expect(buildIdeContextV2(item.input)).toEqual(item.expected);
    });
  }

  it("workspaceId is order-independent and does not expose root paths", () => {
    const a = workspaceId(["C:\\private\\repo\\b", "C:\\private\\repo\\a"]);
    const b = workspaceId(["C:\\private\\repo\\a", "C:\\private\\repo\\b"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^ws-[a-f0-9]{16}$/);
    expect(a).not.toContain("private");
    expect(workspaceId(["/", "/"])).toBe("ws-8a5edab282632443");
  });
});

describe("IDE context v2 tool wiring", () => {
  function facade(metadata = true) {
    return {
      getSelection: async () => ({
        file: "/workspace/a.js",
        languageId: "javascript",
        selection: { start: { line: 1, character: 2 } },
        text: "x",
      }),
      getActiveFile: async () => ({
        file: "/workspace/a.js",
        languageId: "javascript",
        isDirty: true,
      }),
      getDiagnostics: async () => [{ file: "/workspace/a.js", message: "x" }],
      getOpenEditors: async () => [{ file: "/workspace/a.js", active: true }],
      openDiff: async () => ({ outcome: "rejected" }),
      ...(metadata
        ? {
            getContextMetadata: vi.fn(async ({ file, tool }) =>
              buildIdeContextV2({
                workspaceRoots: ["/workspace"],
                documentUri: file ? "file:///workspace/a.js" : null,
                documentVersion: file ? 9 : null,
                isDirty: file ? true : null,
                permissionSource: "workspace-trust:trusted",
                freshnessState: file ? "live-buffer" : "live-host",
                capturedAtMs: 0,
                tool,
              }),
            ),
          }
        : {}),
    };
  }

  it("adds the same envelope to all four core context reads", async () => {
    const editor = facade();
    const tools = Object.fromEntries(
      buildIdeTools(editor).map((tool) => [tool.name, tool]),
    );
    const selection = await tools.getSelection.handler({});
    const active = await tools.getActiveFile.handler({});
    const diagnostics = await tools.getDiagnostics.handler({
      path: "/workspace/a.js",
    });
    const editors = await tools.getOpenEditors.handler({});

    for (const result of [selection, active, diagnostics, editors]) {
      expect(result.context.schema).toBe("cc-ide-context/v2");
      expect(result.context.workspaceId).toBe("ws-c52ddf65534b7b46");
    }
    expect(selection.context).toMatchObject({
      documentUri: "file:///workspace/a.js",
      documentVersion: 9,
      isDirty: true,
    });
    expect(editors.context).toMatchObject({
      documentUri: null,
      documentVersion: null,
    });
    expect(editor.getContextMetadata).toHaveBeenCalledTimes(4);
  });

  it("keeps the legacy payload unchanged when metadata is unsupported", async () => {
    const selection = buildIdeTools(facade(false)).find(
      (tool) => tool.name === "getSelection",
    );
    expect(await selection.handler({})).not.toHaveProperty("context");
  });
});

describe("real VS Code facade metadata", () => {
  it("uses live document version, trust and an injected capture clock", async () => {
    const uri = {
      fsPath: "/workspace/a.js",
      toString: () => "file:///workspace/a.js",
    };
    const document = { uri, version: 12, isDirty: true };
    const vscode = {
      Uri: { file: (file) => ({ toString: () => `file://${file}` }) },
      commands: { executeCommand: vi.fn() },
      languages: {
        getDiagnostics: () => [
          [
            uri,
            [
              {
                severity: 0,
                message: "boom",
                range: { start: { line: 2, character: 3 } },
              },
            ],
          ],
        ],
      },
      window: {
        activeTextEditor: { document },
        visibleTextEditors: [{ document }],
      },
      workspace: {
        isTrusted: false,
        workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
        textDocuments: [document],
      },
    };
    const editor = createVscodeEditorFacade(vscode, { now: () => 1000 });
    const context = await editor.getContextMetadata({
      file: "/workspace/a.js",
      tool: "getActiveFile",
    });
    expect(context).toEqual({
      schema: "cc-ide-context/v2",
      workspaceId: "ws-c52ddf65534b7b46",
      documentUri: "file:///workspace/a.js",
      documentVersion: 12,
      isDirty: true,
      permissionSource: "workspace-trust:restricted",
      freshness: {
        state: "live-buffer",
        capturedAt: "1970-01-01T00:00:01.000Z",
      },
    });
    expect(await editor.getOpenEditors()).toEqual([
      expect.objectContaining({
        documentUri: "file:///workspace/a.js",
        documentVersion: 12,
        isDirty: true,
      }),
    ]);
    expect(await editor.getDiagnostics()).toEqual([
      expect.objectContaining({
        documentUri: "file:///workspace/a.js",
        documentVersion: 12,
        isDirty: true,
      }),
    ]);
  });
});
