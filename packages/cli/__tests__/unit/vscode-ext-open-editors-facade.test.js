/**
 * getOpenEditors in the REAL facade — drives createVscodeEditorFacade with a
 * fake `vscode` whose visible editors carry isDirty, and asserts the tool payload
 * surfaces the unsaved-buffer flag (so the agent knows the on-disk copy is stale
 * before it reads the file — Claude-Code IDE checkDocumentDirty parity). Runs in
 * the CLI suite like the other vscode-ext facade tests.
 */
import { describe, it, expect } from "vitest";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";

function editor({ path, languageId = "javascript", isDirty = false }) {
  return {
    document: {
      uri: { fsPath: path, toString: () => "file://" + path },
      languageId,
      isDirty,
    },
  };
}

function fakeVscode({ visible = [], active = null } = {}) {
  return {
    window: {
      activeTextEditor: active,
      visibleTextEditors: visible,
    },
  };
}

describe("facade getOpenEditors: unsaved-buffer (isDirty) flag", () => {
  it("reports isDirty per editor and flags the active one", async () => {
    const a = editor({ path: "/ws/a.js", isDirty: true });
    const b = editor({
      path: "/ws/b.ts",
      languageId: "typescript",
      isDirty: false,
    });
    const facade = createVscodeEditorFacade(
      fakeVscode({ visible: [a, b], active: a }),
    );

    const eds = await facade.getOpenEditors();
    expect(eds).toEqual([
      {
        file: "/ws/a.js",
        active: true,
        languageId: "javascript",
        isDirty: true,
      },
      {
        file: "/ws/b.ts",
        active: false,
        languageId: "typescript",
        isDirty: false,
      },
    ]);
  });

  it("coerces a missing isDirty to a boolean false (older/odd hosts)", async () => {
    const e = {
      document: { uri: { fsPath: "/ws/x.js" }, languageId: "javascript" },
    };
    const facade = createVscodeEditorFacade(
      fakeVscode({ visible: [e], active: e }),
    );
    const [only] = await facade.getOpenEditors();
    expect(only.isDirty).toBe(false);
    expect(typeof only.isDirty).toBe("boolean");
  });

  it("flows through the getOpenEditors MCP tool payload", async () => {
    const a = editor({ path: "/ws/a.js", isDirty: true });
    const facade = createVscodeEditorFacade(
      fakeVscode({ visible: [a], active: a }),
    );
    const tools = buildIdeTools(facade);
    const tool = tools.find((t) => t.name === "getOpenEditors");
    expect(tool).toBeTruthy();
    // The description tells the agent what isDirty means.
    expect(tool.description).toMatch(/isDirty/);
    const out = await tool.handler({});
    expect(out.editors[0]).toMatchObject({ file: "/ws/a.js", isDirty: true });
  });
});
