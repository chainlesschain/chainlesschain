/**
 * openMultiDiff facade (slice 2) — batch multi-file review driving the REAL
 * createVscodeEditorFacade with a fake `vscode`: opens vscode.changes, prompts
 * a decision, and writes the chosen files on accept. Also checks buildIdeTools
 * exposes the tool only when the facade supports it.
 */
import { describe, it, expect } from "vitest";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";

function fakeVscode({ choice, picks } = {}) {
  const writes = [];
  let untitled = 0;
  const changesCalls = [];
  const v = {
    Uri: {
      file: (p) => ({
        fsPath: p,
        scheme: "file",
        toString: () => "file://" + p,
      }),
    },
    workspace: {
      openTextDocument: async (arg) => {
        if (arg && typeof arg === "object" && "content" in arg) {
          const id = "untitled:U" + ++untitled;
          return {
            uri: { toString: () => id },
            getText: () => arg.content,
            positionAt: (n) => n,
            save: async () => {},
          };
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
    commands: {
      executeCommand: async (cmd, title, resources) => {
        if (cmd === "vscode.changes") changesCalls.push({ title, resources });
      },
    },
    window: {
      showInformationMessage: async () => choice,
      showQuickPick: async (items) =>
        typeof picks === "function" ? picks(items) : picks,
    },
    WorkspaceEdit: class {
      replace(uri, _range, text) {
        writes.push({ path: uri.fsPath, text });
      }
    },
    Range: class {},
  };
  return { vscode: v, writes, changesCalls };
}

const CHANGESET = [
  { path: "/ws/a.js", originalText: "1", modifiedText: "2" },
  { path: "/ws/b.js", originalText: "x\ny", modifiedText: "x\nY" },
  { path: "/ws/same.js", originalText: "k", modifiedText: "k" }, // no-op
];

describe("openMultiDiff facade", () => {
  it("opens vscode.changes for the changed files (skipping no-ops)", async () => {
    const fx = fakeVscode({ choice: "Reject" });
    const facade = createVscodeEditorFacade(fx.vscode);
    await facade.openMultiDiff({ files: CHANGESET, title: "T" });
    expect(fx.changesCalls).toHaveLength(1);
    expect(fx.changesCalls[0].title).toBe("T");
    expect(fx.changesCalls[0].resources).toHaveLength(2); // same.js dropped
  });

  it("Accept all writes every changed file", async () => {
    const fx = fakeVscode({ choice: "Accept all" });
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openMultiDiff({ files: CHANGESET });
    expect(res).toMatchObject({ outcome: "accepted", applied: 2, total: 2 });
    expect(fx.writes.map((w) => w.path).sort()).toEqual([
      "/ws/a.js",
      "/ws/b.js",
    ]);
  });

  it("Pick files… writes only the selected subset", async () => {
    const fx = fakeVscode({
      choice: "Pick files…",
      picks: (items) => items.filter((i) => i.path === "/ws/b.js"),
    });
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openMultiDiff({ files: CHANGESET });
    expect(res).toMatchObject({
      outcome: "accepted",
      applied: 1,
      files: ["/ws/b.js"],
    });
    expect(fx.writes.map((w) => w.path)).toEqual(["/ws/b.js"]);
  });

  it("Reject (and empty pick) writes nothing", async () => {
    const fx = fakeVscode({ choice: "Reject" });
    const facade = createVscodeEditorFacade(fx.vscode);
    expect(await facade.openMultiDiff({ files: CHANGESET })).toMatchObject({
      outcome: "rejected",
    });
    expect(fx.writes).toHaveLength(0);

    const fx2 = fakeVscode({ choice: "Pick files…", picks: [] });
    const facade2 = createVscodeEditorFacade(fx2.vscode);
    expect(await facade2.openMultiDiff({ files: CHANGESET })).toMatchObject({
      outcome: "rejected",
    });
    expect(fx2.writes).toHaveLength(0);
  });

  it("an all-no-op changeset is rejected without prompting", async () => {
    const fx = fakeVscode({ choice: "Accept all" });
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openMultiDiff({
      files: [{ path: "/ws/x", originalText: "a", modifiedText: "a" }],
    });
    expect(res).toMatchObject({ outcome: "rejected", reason: "no changes" });
    expect(fx.changesCalls).toHaveLength(0);
  });
});

describe("buildIdeTools exposes openMultiDiff conditionally", () => {
  it("present when the facade supports it; absent otherwise", () => {
    const withIt = buildIdeTools({
      getSelection: () => null,
      getDiagnostics: () => [],
      getOpenEditors: () => [],
      openDiff: () => ({}),
      openMultiDiff: () => ({}),
    });
    expect(withIt.map((t) => t.name)).toContain("openMultiDiff");

    const without = buildIdeTools({
      getSelection: () => null,
      getDiagnostics: () => [],
      getOpenEditors: () => [],
      openDiff: () => ({}),
    });
    expect(without.map((t) => t.name)).not.toContain("openMultiDiff");
  });
});
