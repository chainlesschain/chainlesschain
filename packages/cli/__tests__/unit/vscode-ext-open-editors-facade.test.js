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
        documentUri: "file:///ws/a.js",
        documentVersion: null,
        active: true,
        languageId: "javascript",
        isDirty: true,
      },
      {
        file: "/ws/b.ts",
        documentUri: "file:///ws/b.ts",
        documentVersion: null,
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

/**
 * getOpenEditors should enumerate ALL open tabs (including background ones, not
 * just the split-visible editors) — matching the JetBrains panel's getOpenFiles
 * and Claude-Code IDE. When tabGroups is available it is the primary source; a
 * tab only carries its uri, so languageId / isDirty come from the matching open
 * document. Older hosts (no tabGroups) fall back to visibleTextEditors.
 */
function doc({ path, languageId = "javascript", isDirty = false }) {
  return {
    uri: { fsPath: path, toString: () => "file://" + path },
    languageId,
    isDirty,
  };
}

function textTab(path) {
  return { input: { uri: { fsPath: path, toString: () => "file://" + path } } };
}

function fakeVscodeTabs({ tabs = [], docs = [], active = null } = {}) {
  return {
    window: {
      activeTextEditor: active ? { document: active } : null,
      tabGroups: { all: [{ tabs }] },
    },
    workspace: { textDocuments: docs },
  };
}

describe("facade getOpenEditors: enumerates all open tabs (not just visible)", () => {
  it("returns every open text tab, with languageId/isDirty from its document", async () => {
    const dA = doc({ path: "/ws/a.js", isDirty: true });
    const dB = doc({
      path: "/ws/b.ts",
      languageId: "typescript",
      isDirty: false,
    });
    // c.md is open in a background tab whose document is also loaded.
    const dC = doc({
      path: "/ws/c.md",
      languageId: "markdown",
      isDirty: false,
    });
    const facade = createVscodeEditorFacade(
      fakeVscodeTabs({
        tabs: [textTab("/ws/a.js"), textTab("/ws/b.ts"), textTab("/ws/c.md")],
        docs: [dA, dB, dC],
        active: dB,
      }),
    );

    const eds = await facade.getOpenEditors();
    expect(eds.map((e) => e.file)).toEqual([
      "/ws/a.js",
      "/ws/b.ts",
      "/ws/c.md",
    ]);
    expect(eds.find((e) => e.file === "/ws/b.ts")).toMatchObject({
      active: true,
      languageId: "typescript",
      isDirty: false,
    });
    expect(eds.find((e) => e.file === "/ws/a.js")).toMatchObject({
      isDirty: true,
    });
  });

  it("skips non-text tabs (diff / webview — no input.uri)", async () => {
    const dA = doc({ path: "/ws/a.js" });
    const diffTab = { input: { modified: {}, original: {} } }; // no .uri
    const facade = createVscodeEditorFacade(
      fakeVscodeTabs({ tabs: [textTab("/ws/a.js"), diffTab], docs: [dA] }),
    );
    const eds = await facade.getOpenEditors();
    expect(eds.map((e) => e.file)).toEqual(["/ws/a.js"]);
  });

  it("a tab whose document isn't loaded still lists the file (isDirty false)", async () => {
    const facade = createVscodeEditorFacade(
      fakeVscodeTabs({ tabs: [textTab("/ws/lazy.js")], docs: [] }),
    );
    const [only] = await facade.getOpenEditors();
    expect(only).toMatchObject({ file: "/ws/lazy.js", isDirty: false });
    expect(only.languageId).toBeUndefined();
  });
});
