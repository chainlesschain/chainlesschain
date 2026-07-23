/**
 * openMultiDiff facade (slice 2) — batch multi-file review driving the REAL
 * createVscodeEditorFacade with a fake `vscode`: opens vscode.changes, prompts
 * a decision, and writes the chosen files on accept. Also checks buildIdeTools
 * exposes the tool only when the facade supports it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";

function fakeVscode({ choice, picks, applyEditResult = true } = {}) {
  const writes = [];
  let untitled = 0;
  const changesCalls = [];
  const messages = [];
  const v = {
    l10n: {
      t: (m, ...a) =>
        String(m).replace(/\{(\d+)\}/g, (x, i) =>
          a[i] != null ? String(a[i]) : x,
        ),
    },
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
      applyEdit: async () => applyEditResult,
    },
    commands: {
      executeCommand: async (cmd, title, resources) => {
        if (cmd === "vscode.changes") changesCalls.push({ title, resources });
      },
    },
    window: {
      showInformationMessage: async (message) => {
        messages.push(message);
        return choice;
      },
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
  return { vscode: v, writes, changesCalls, messages };
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

  it("applies a mixed create/delete/rename/mode-change batch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-multi-lifecycle-"));
    const removed = path.join(dir, "remove.txt");
    const source = path.join(dir, "old.txt");
    const target = path.join(dir, "new.txt");
    const created = path.join(dir, "created.txt");
    const modeFile = path.join(dir, "run.sh");
    fs.writeFileSync(removed, "remove");
    fs.writeFileSync(source, "move");
    fs.writeFileSync(modeFile, "echo ok");
    try {
      const fx = fakeVscode({
        choice: "Accept all",
        applyEditResult: false,
      });
      const facade = createVscodeEditorFacade(fx.vscode, {
        platform: "linux",
      });
      const res = await facade.openMultiDiff({
        files: [
          {
            path: removed,
            originalText: "remove",
            modifiedText: "",
            operation: "delete",
          },
          {
            path: source,
            targetPath: target,
            originalText: "move",
            modifiedText: "move",
            operation: "rename",
          },
          {
            path: created,
            originalText: "",
            modifiedText: "created",
            operation: "create",
          },
          {
            path: modeFile,
            originalText: "echo ok",
            modifiedText: "echo ok",
            operation: "mode-change",
            oldMode: "100644",
            newMode: "100755",
          },
        ],
      });
      expect(res).toMatchObject({
        outcome: "accepted",
        applied: 4,
        total: 4,
        appliedOperations: [
          { path: removed, operation: "delete" },
          { path: source, operation: "rename", targetPath: target },
          { path: created, operation: "create" },
          {
            path: modeFile,
            operation: "mode-change",
            oldMode: "100644",
            newMode: "100755",
          },
        ],
      });
      expect(fs.existsSync(removed)).toBe(false);
      expect(fs.existsSync(source)).toBe(false);
      expect(fs.readFileSync(target, "utf8")).toBe("move");
      expect(fs.readFileSync(created, "utf8")).toBe("created");
      expect(fx.messages[0]).toContain(`rename → ${target}`);
      expect(fx.messages[0]).toContain("mode 100644 → 100755");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a mixed lifecycle apply failure as partial without file content", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-multi-partial-"));
    const created = path.join(dir, "created.txt");
    const existing = path.join(dir, "existing.txt");
    fs.writeFileSync(existing, "keep");
    try {
      const fx = fakeVscode({ choice: "Accept all" });
      const facade = createVscodeEditorFacade(fx.vscode);
      const res = await facade.openMultiDiff({
        files: [
          {
            path: created,
            originalText: "",
            modifiedText: "new",
            operation: "create",
          },
          {
            path: existing,
            originalText: "keep",
            modifiedText: "do not overwrite",
            operation: "create",
          },
        ],
      });
      expect(res).toMatchObject({
        outcome: "partial",
        applied: 1,
        appliedOperations: [{ path: created, operation: "create" }],
        failedOperations: [{ path: existing, operation: "create" }],
      });
      expect(JSON.stringify(res.failedOperations)).not.toContain(
        "do not overwrite",
      );
      expect(fs.readFileSync(created, "utf8")).toBe("new");
      expect(fs.readFileSync(existing, "utf8")).toBe("keep");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports mode changes as unsupported on Windows without prompting", async () => {
    const fx = fakeVscode({ choice: "Accept all" });
    const facade = createVscodeEditorFacade(fx.vscode, { platform: "win32" });
    const res = await facade.openMultiDiff({
      files: [
        {
          path: "/ws/run.sh",
          originalText: "echo ok",
          modifiedText: "echo ok",
          operation: "mode-change",
          oldMode: "100644",
          newMode: "100755",
        },
      ],
    });
    expect(res).toMatchObject({
      outcome: "rejected",
      degraded: true,
      skippedUnsupported: ["/ws/run.sh"],
      degradation: {
        skipped: [
          {
            path: "/ws/run.sh",
            kind: "unsupported-operation",
          },
        ],
      },
    });
    expect(fx.changesCalls).toHaveLength(0);
  });
});

/**
 * Keybinding-driven decisions also work for the batch review: the same
 * Accept/Reject commands (chainlesschainDiffActive) settle openMultiDiff, with
 * keyboard Accept mapping to "Accept all" and Reject to "Reject".
 */
function fakeVscodePending() {
  const writes = [];
  let untitled = 0;
  const ctx = []; // setContext(chainlesschainDiffActive, bool) calls
  const v = {
    l10n: {
      t: (m, ...a) =>
        String(m).replace(/\{(\d+)\}/g, (x, i) =>
          a[i] != null ? String(a[i]) : x,
        ),
    },
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
          return {
            uri: { toString: () => "untitled:U" + ++untitled },
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
      executeCommand: async (cmd, key, value) => {
        if (cmd === "setContext" && key === "chainlesschainDiffActive") {
          ctx.push(value);
        }
      },
    },
    window: {
      // Never resolves → only the keybinding command settles the review.
      showInformationMessage: () => new Promise(() => {}),
      showQuickPick: async () => null,
    },
    WorkspaceEdit: class {
      replace(uri, _range, text) {
        writes.push({ path: uri.fsPath, text });
      }
    },
    Range: class {},
  };
  return { vscode: v, writes, ctx };
}

async function until(cond, max = 50) {
  for (let i = 0; i < max && !cond(); i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe("openMultiDiff: keybinding-driven accept / reject", () => {
  const CS = [{ path: "/ws/a.js", originalText: "1", modifiedText: "2" }];

  it("acceptActiveDiff applies all changes (maps to 'Accept all')", async () => {
    const fx = fakeVscodePending();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openMultiDiff({ files: CS });
    await until(() => fx.ctx.includes(true));
    expect(fx.ctx).toEqual([true]);

    expect(facade.acceptActiveDiff()).toBe(true);
    await expect(p).resolves.toMatchObject({ outcome: "accepted", applied: 1 });
    expect(fx.writes.map((w) => w.path)).toEqual(["/ws/a.js"]);
    expect(fx.ctx).toEqual([true, false]);
  });

  it("rejectActiveDiff writes nothing", async () => {
    const fx = fakeVscodePending();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openMultiDiff({ files: CS });
    await until(() => fx.ctx.includes(true));

    expect(facade.rejectActiveDiff()).toBe(true);
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
    expect(fx.writes).toHaveLength(0);
    expect(fx.ctx).toEqual([true, false]);
  });
});

describe("openMultiDiff closes its review tab after a button decision", () => {
  const CS = [{ path: "/ws/a.js", originalText: "1", modifiedText: "2" }];

  function fakeWithTabs(choice) {
    const closed = [];
    const activeTab = { id: "multi-diff-tab" };
    const base = fakeVscode({ choice });
    base.vscode.window.tabGroups = {
      activeTabGroup: { activeTab },
      close: async (tab) => {
        closed.push(tab);
      },
      // present but never fires → the CLOSED-by-user path isn't taken
      onDidChangeTabs: () => ({ dispose() {} }),
    };
    return { vscode: base.vscode, closed, activeTab };
  }

  it("closes the multi-diff tab on Accept all", async () => {
    const fx = fakeWithTabs("Accept all");
    const facade = createVscodeEditorFacade(fx.vscode);
    await facade.openMultiDiff({ files: CS });
    expect(fx.closed).toEqual([fx.activeTab]);
  });

  it("closes the multi-diff tab on Reject", async () => {
    const fx = fakeWithTabs("Reject");
    const facade = createVscodeEditorFacade(fx.vscode);
    await facade.openMultiDiff({ files: CS });
    expect(fx.closed).toEqual([fx.activeTab]);
  });
});

describe("openMultiDiff diff-apply-guard wiring", () => {
  it("drops binary entries from the reviewable set (they are never written)", async () => {
    const NUL = String.fromCharCode(0);
    const fx = fakeVscode({ choice: "Accept all" });
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openMultiDiff({
      files: [
        { path: "/ws/a.js", originalText: "1", modifiedText: "2" },
        {
          path: "/ws/logo.png",
          originalText: "x" + NUL,
          modifiedText: "y" + NUL,
        },
      ],
    });
    expect(res).toMatchObject({
      outcome: "accepted",
      applied: 1,
      skippedBinary: ["/ws/logo.png"],
    });
    expect(fx.writes.map((w) => w.path)).toEqual(["/ws/a.js"]);
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
    const multi = withIt.find((t) => t.name === "openMultiDiff");
    expect(
      multi.inputSchema.properties.files.items.properties.operation.enum,
    ).toEqual(["modify", "create", "delete", "rename", "mode-change"]);

    const without = buildIdeTools({
      getSelection: () => null,
      getDiagnostics: () => [],
      getOpenEditors: () => [],
      openDiff: () => ({}),
    });
    expect(without.map((t) => t.name)).not.toContain("openMultiDiff");
  });
});

/**
 * Closing the multi-diff tab rejects (parity with openDiff): the agent unblocks
 * immediately as rejected instead of waiting for the notification to also be
 * dismissed. The tab is captured by reference (activeTabGroup.activeTab).
 */
function fakeVscodeWithTab() {
  let untitled = 0;
  const closeListeners = [];
  const tab = { id: "multidiff-tab" }; // the captured multi-diff tab (by ref)
  const v = {
    l10n: {
      t: (m, ...a) =>
        String(m).replace(/\{(\d+)\}/g, (x, i) =>
          a[i] != null ? String(a[i]) : x,
        ),
    },
    Uri: {
      file: (p) => ({
        fsPath: p,
        scheme: "file",
        toString: () => "file://" + p,
      }),
    },
    workspace: {
      openTextDocument: async (arg) => ({
        uri: {
          toString: () =>
            arg && "content" in arg ? "untitled:U" + ++untitled : "f",
        },
        getText: () => (arg && arg.content) || "",
        positionAt: (n) => n,
        save: async () => {},
      }),
      applyEdit: async () => true,
    },
    commands: { executeCommand: async () => {} },
    window: {
      showInformationMessage: () => new Promise(() => {}), // only tab-close settles
      showQuickPick: async () => null,
      tabGroups: {
        activeTabGroup: { activeTab: tab },
        onDidChangeTabs: (cb) => {
          closeListeners.push(cb);
          return { dispose: () => {} };
        },
      },
    },
    WorkspaceEdit: class {
      replace() {}
    },
    Range: class {},
  };
  return {
    vscode: v,
    tab,
    listenerCount: () => closeListeners.length,
    fireClose: (t) => closeListeners.forEach((cb) => cb({ closed: [t] })),
  };
}

describe("openMultiDiff: closing the tab rejects", () => {
  const CS = [{ path: "/ws/a.js", originalText: "1", modifiedText: "2" }];

  it("resolves rejected (+closedDiff) when the captured tab closes", async () => {
    const fx = fakeVscodeWithTab();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openMultiDiff({ files: CS });
    await until(() => fx.listenerCount() > 0); // watcher registered

    fx.fireClose(fx.tab);
    await expect(p).resolves.toMatchObject({
      outcome: "rejected",
      closedDiff: true,
    });
  });

  it("ignores an unrelated tab closing", async () => {
    const fx = fakeVscodeWithTab();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openMultiDiff({ files: CS });
    await until(() => fx.listenerCount() > 0);

    fx.fireClose({ id: "some-other-tab" });
    let done = false;
    p.then(() => {
      done = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(done).toBe(false); // still blocked on the reviewer

    fx.fireClose(fx.tab); // the real one settles it
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
  });
});
