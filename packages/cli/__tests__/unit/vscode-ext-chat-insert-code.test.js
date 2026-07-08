/**
 * Code-block "Insert at Cursor" (Copilot-Chat parity): the webview's Insert
 * button posts {type:"insertCode", code} and the host splices the snippet
 * into the active editor at the caret (replacing a non-empty selection).
 * Headless — mock vscode host, no webview.
 */
import { describe, it, expect, vi } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

function makeEditor({ empty = true } = {}) {
  const calls = { insert: [], replace: [] };
  const editor = {
    selection: { isEmpty: empty, active: { line: 1, character: 2 } },
    edit: vi.fn((cb) => {
      cb({
        insert: (pos, text) => calls.insert.push([pos, text]),
        replace: (sel, text) => calls.replace.push([sel, text]),
      });
      return Promise.resolve(true);
    }),
  };
  return { editor, calls };
}

function makeProvider(windowShape = {}) {
  const posted = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: windowShape,
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: () => ({ running: true }) },
    state: { get: () => null, update: () => {} },
    getBridgeEnv: () => ({}),
  });
  provider.view = {
    webview: { postMessage: (m) => (posted.push(m), Promise.resolve()) },
  };
  return { provider, posted };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("chat panel — insertCode (Insert at Cursor)", () => {
  it("inserts at the caret when the selection is empty", async () => {
    const { editor, calls } = makeEditor({ empty: true });
    const { provider } = makeProvider({ activeTextEditor: editor });
    provider._handleMessage({ type: "insertCode", code: "const x = 1;\n" });
    await tick();
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(calls.insert).toEqual([
      [{ line: 1, character: 2 }, "const x = 1;\n"],
    ]);
    expect(calls.replace).toEqual([]);
  });

  it("replaces a non-empty selection", async () => {
    const { editor, calls } = makeEditor({ empty: false });
    const { provider } = makeProvider({ activeTextEditor: editor });
    provider._handleMessage({ type: "insertCode", code: "new()" });
    await tick();
    expect(calls.replace).toEqual([[editor.selection, "new()"]]);
    expect(calls.insert).toEqual([]);
  });

  it("falls back to the first visible editor when none is active (webview focus)", async () => {
    const { editor, calls } = makeEditor({ empty: true });
    const { provider } = makeProvider({
      activeTextEditor: undefined,
      visibleTextEditors: [editor],
    });
    provider._handleMessage({ type: "insertCode", code: "x" });
    await tick();
    expect(calls.insert.length).toBe(1);
  });

  it("hints in the panel when no editor is open", async () => {
    const { provider, posted } = makeProvider({});
    provider._handleMessage({ type: "insertCode", code: "x" });
    await tick();
    expect(posted.find((p) => p.kind === "info")?.text).toMatch(/no editor/);
  });

  it("surfaces a rejected edit (read-only editor) instead of failing silently", async () => {
    const editor = {
      selection: { isEmpty: true, active: { line: 0, character: 0 } },
      edit: vi.fn(() => Promise.resolve(false)),
    };
    const { provider, posted } = makeProvider({ activeTextEditor: editor });
    provider._handleMessage({ type: "insertCode", code: "x" });
    await tick();
    expect(posted.find((p) => p.kind === "info")?.text).toMatch(
      /insert failed/,
    );
  });

  it("ignores an empty snippet", async () => {
    const { editor } = makeEditor();
    const { provider } = makeProvider({ activeTextEditor: editor });
    provider._handleMessage({ type: "insertCode", code: "" });
    await tick();
    expect(editor.edit).not.toHaveBeenCalled();
  });
});
