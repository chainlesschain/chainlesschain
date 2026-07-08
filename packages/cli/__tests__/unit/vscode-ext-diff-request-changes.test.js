/**
 * openDiff "Request changes…" — inline review (Claude-Code parity). Instead of
 * accept/reject, the reviewer annotates the diff with line-anchored notes; the
 * facade returns `{ outcome:"changes-requested", comments, reviewedText }` so
 * the agent revises and re-proposes. Empty input ends the review; a review
 * with zero notes degrades to a plain reject (fail-safe, nothing written).
 *
 * Drives the REAL createVscodeEditorFacade with a fake `vscode`, headless in CI.
 */
import { describe, it, expect } from "vitest";

import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

const tick = () => new Promise((r) => setImmediate(r));

/**
 * Fake `vscode` covering the "Request changes…" path: a message prompt that
 * resolves to that button, a queue of showInputBox answers, and one visible
 * right-pane editor whose selection anchors the comments.
 */
function fakeVscode({ inputs = [], selection } = {}) {
  let untitledCounter = 0;
  const untitledDocs = [];
  const inputQueue = [...inputs];
  const visibleTextEditors = [];

  const v = {
    l10n: {
      t: (m, ...a) =>
        String(m).replace(/\{(\d+)\}/g, (x, i) =>
          a[i] != null ? String(a[i]) : x,
        ),
    },
    Uri: { file: (p) => ({ fsPath: p, toString: () => "file://" + p }) },
    workspace: {
      openTextDocument: async (arg) => {
        if (arg && typeof arg === "object" && "content" in arg) {
          const content = arg.content;
          const id = `untitled:Untitled-${++untitledCounter}`;
          const lines = String(content).split("\n");
          const doc = {
            uri: { toString: () => id },
            getText: () => content,
            positionAt: (n) => n,
            lineAt: (n) => ({ text: lines[n] ?? "" }),
            save: async () => {},
          };
          untitledDocs.push(doc);
          // The right (proposal) pane is the second untitled doc; expose it as
          // a visible editor with the requested selection so comments anchor.
          if (untitledCounter >= 1 && selection) {
            visibleTextEditors.push({
              document: doc,
              selection,
            });
          }
          return doc;
        }
        return {
          uri: arg,
          getText: () => "",
          positionAt: (n) => n,
          save: async () => {},
        };
      },
      applyEdit: async () => true,
    },
    commands: { executeCommand: async () => {} },
    window: {
      showInformationMessage: async () => "Request changes…",
      showQuickPick: async () => null,
      showInputBox: async () =>
        inputQueue.length ? inputQueue.shift() : undefined,
      get visibleTextEditors() {
        return visibleTextEditors;
      },
      tabGroups: { onDidChangeTabs: () => ({ dispose() {} }) },
    },
    WorkspaceEdit: class {
      replace() {}
    },
    Range: class {},
  };
  return { vscode: v, untitledDocs };
}

describe("openDiff: Request changes… collects line-anchored review notes", () => {
  it("returns changes-requested with anchored comments and the reviewed text", async () => {
    const fx = fakeVscode({
      inputs: ["use const here", "extract a helper", ""], // empty ends review
      selection: { start: { line: 4 }, end: { line: 4 } },
    });
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openDiff({
      path: "/ws/a.js",
      modifiedText: "line0\nline1\nline2\nline3\nlet x = 1",
    });
    await tick();
    expect(res.outcome).toBe("changes-requested");
    expect(res.path).toBe("/ws/a.js");
    expect(res.reviewedText).toBe("line0\nline1\nline2\nline3\nlet x = 1");
    expect(res.comments).toEqual([
      { line: 4, endLine: 4, lineText: "let x = 1", note: "use const here" },
      { line: 4, endLine: 4, lineText: "let x = 1", note: "extract a helper" },
    ]);
  });

  it("a review with no notes degrades to reject (nothing written)", async () => {
    const fx = fakeVscode({ inputs: [""] }); // immediately empty → no comments
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openDiff({ path: "/ws/a.js", modifiedText: "x" });
    await tick();
    expect(res).toMatchObject({ outcome: "rejected", path: "/ws/a.js" });
  });

  it("works without a selection anchor — a general comment still rides back", async () => {
    const fx = fakeVscode({ inputs: ["rename this variable", ""] }); // no selection
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openDiff({ path: "/ws/a.js", modifiedText: "x" });
    await tick();
    expect(res.outcome).toBe("changes-requested");
    expect(res.comments).toEqual([{ note: "rename this variable" }]);
  });
});
