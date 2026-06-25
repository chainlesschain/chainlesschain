/**
 * openDiff "close the diff tab = reject" — closing the review tab is how most
 * reviewers say no; the blocked tool call must unblock immediately as
 * `rejected` instead of waiting for someone to also dismiss the lingering
 * notification toast (previously the only path back was the button prompt's
 * undefined → reject fail-safe).
 *
 * Drives the REAL createVscodeEditorFacade with a fake `vscode` object, so it
 * runs headless in CI (lives in the CLI suite like the other vscode-ext tests).
 */
import { describe, it, expect } from "vitest";

import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

/**
 * Minimal fake of the `vscode` API surface openDiff touches. The message
 * prompt is a controllable deferred; tab-close events are fired manually.
 */
function fakeVscode({ tabGroups = true } = {}) {
  const tabListeners = [];
  const disposes = { count: 0 };
  const message = deferred();
  let untitledCounter = 0;
  const untitledDocs = [];

  const v = {
    Uri: {
      file: (p) => ({ fsPath: p, toString: () => "file://" + p }),
    },
    workspace: {
      openTextDocument: async (arg) => {
        if (arg && typeof arg === "object" && "content" in arg) {
          const content = arg.content;
          const id = `untitled:Untitled-${++untitledCounter}`; // stable per doc
          const doc = {
            uri: { toString: () => id },
            getText: () => content,
            positionAt: (n) => n,
            save: async () => {},
          };
          untitledDocs.push(doc);
          return doc;
        }
        // disk doc (applyTextToFile path)
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
      showInformationMessage: () => message.promise,
      showQuickPick: async () => null,
      ...(tabGroups
        ? {
            tabGroups: {
              onDidChangeTabs: (fn) => {
                tabListeners.push(fn);
                return {
                  dispose: () => {
                    disposes.count++;
                  },
                };
              },
            },
          }
        : {}),
    },
    WorkspaceEdit: class {
      replace() {}
    },
    Range: class {},
  };
  return {
    vscode: v,
    message,
    disposes,
    untitledDocs,
    fireTabClose: (modifiedUriString) => {
      for (const fn of tabListeners) {
        fn({
          closed: [
            { input: { modified: { toString: () => modifiedUriString } } },
          ],
        });
      }
    },
  };
}

describe("openDiff: closing the diff tab rejects immediately", () => {
  it("resolves rejected (+closedDiff) when the review tab is closed", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "new" });
    await tick(); // let openDiff register the tab watcher

    expect(fx.untitledDocs).toHaveLength(1); // the right (proposal) pane
    fx.fireTabClose(fx.untitledDocs[0].uri.toString());

    await expect(p).resolves.toMatchObject({
      outcome: "rejected",
      path: "/ws/a.js",
      closedDiff: true,
    });
    expect(fx.disposes.count).toBe(1); // watcher cleaned up
  });

  it("ignores unrelated tab closures", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "new" });
    await tick();

    fx.fireTabClose("untitled:SomeOtherTab");
    let settled = false;
    p.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false); // still blocked on the reviewer

    fx.fireTabClose(fx.untitledDocs[0].uri.toString());
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
  });

  it("Accept still wins and disposes the watcher", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "proposal" });
    await tick();

    fx.message.resolve("Accept");
    await expect(p).resolves.toMatchObject({
      outcome: "accepted",
      finalText: "proposal",
    });
    expect(fx.disposes.count).toBe(1);

    // A tab close arriving after the decision is a no-op (single settle).
    fx.fireTabClose(fx.untitledDocs[0].uri.toString());
    await tick();
    await expect(p).resolves.toMatchObject({ outcome: "accepted" });
  });

  it("late button click after a tab close is ignored (fail-safe)", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "new" });
    await tick();

    fx.fireTabClose(fx.untitledDocs[0].uri.toString());
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });

    // The toast lingers in the notification center — a later Accept click
    // must NOT apply anything (the call already returned rejected).
    fx.message.resolve("Accept");
    await tick();
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
  });

  it("hosts without tabGroups keep the button-only behavior", async () => {
    const fx = fakeVscode({ tabGroups: false });
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "new" });
    await tick();

    fx.message.resolve("Reject");
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
  });

  it("dismissed prompt (undefined) still rejects — fail-safe unchanged", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "new" });
    await tick();

    fx.message.resolve(undefined);
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
    expect(fx.disposes.count).toBe(1);
  });
});

/**
 * A BUTTON decision (Accept / Reject / Pick hunks / Request changes) leaves the
 * diff tab open — over a multi-edit session those stale tabs pile up (Claude-Code
 * ships closeAllDiffTabs for exactly this). openDiff now closes the tab whose
 * modified pane is the proposal once the decision is fully handled. Needs a fake
 * that models open tabs + tabGroups.all/close (the minimal fake above only has
 * onDidChangeTabs, so the guarded helper is a no-op there).
 */
describe("openDiff: a button decision closes the now-stale diff tab", () => {
  function fakeVscodeWithTabs() {
    const message = deferred();
    let untitledCounter = 0;
    const untitledDocs = [];
    const tabs = []; // currently-open editor tabs
    const closed = []; // tabs passed to tabGroups.close
    const v = {
      Uri: { file: (p) => ({ fsPath: p, toString: () => "file://" + p }) },
      workspace: {
        openTextDocument: async (arg) => {
          if (arg && typeof arg === "object" && "content" in arg) {
            const id = `untitled:Untitled-${++untitledCounter}`;
            const doc = {
              uri: { toString: () => id },
              getText: () => arg.content,
              positionAt: (n) => n,
              save: async () => {},
            };
            untitledDocs.push(doc);
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
      commands: {
        executeCommand: async (cmd, _left, right) => {
          // Model `vscode.diff` opening a tab whose modified pane is the proposal.
          if (cmd === "vscode.diff") tabs.push({ input: { modified: right } });
        },
      },
      window: {
        showInformationMessage: () => message.promise,
        showQuickPick: async () => null,
        tabGroups: {
          onDidChangeTabs: () => ({ dispose: () => {} }),
          get all() {
            return [{ tabs: tabs.slice() }];
          },
          close: async (tab) => {
            closed.push(tab);
            const i = tabs.indexOf(tab);
            if (i >= 0) tabs.splice(i, 1);
          },
        },
      },
      WorkspaceEdit: class {
        replace() {}
      },
      Range: class {},
    };
    return { vscode: v, message, untitledDocs, tabs, closed };
  }

  it("Accept closes the diff tab whose modified pane is the proposal", async () => {
    const fx = fakeVscodeWithTabs();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "proposal" });
    await tick();
    expect(fx.tabs).toHaveLength(1); // the diff tab is open

    fx.message.resolve("Accept");
    await expect(p).resolves.toMatchObject({
      outcome: "accepted",
      finalText: "proposal",
    });
    expect(fx.closed).toHaveLength(1); // the now-stale diff tab was closed
    expect(fx.tabs).toHaveLength(0);
  });

  it("Reject (button) also closes the diff tab", async () => {
    const fx = fakeVscodeWithTabs();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "x" });
    await tick();

    fx.message.resolve("Reject");
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
    expect(fx.closed).toHaveLength(1);
    expect(fx.tabs).toHaveLength(0);
  });
});

/**
 * Keybinding-driven decisions: the Accept/Reject commands (bound to
 * Cmd/Ctrl+Enter / Cmd/Ctrl+Shift+Backspace, scoped to chainlesschainDiffActive)
 * settle the diff openDiff is blocking on without a notification button. openDiff
 * exposes facade.acceptActiveDiff()/rejectActiveDiff() and toggles the
 * chainlesschainDiffActive context key while a review is open.
 */
function fakeVscodeForKeys() {
  const message = deferred(); // never resolved → only the keybinding settles it
  let untitledCounter = 0;
  const ctx = []; // setContext(chainlesschainDiffActive, bool) calls, in order
  const v = {
    Uri: { file: (p) => ({ fsPath: p, toString: () => "file://" + p }) },
    workspace: {
      openTextDocument: async (arg) => {
        if (arg && typeof arg === "object" && "content" in arg) {
          const id = `untitled:Untitled-${++untitledCounter}`;
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
      executeCommand: async (cmd, key, value) => {
        if (cmd === "setContext" && key === "chainlesschainDiffActive") {
          ctx.push(value);
        }
      },
    },
    window: {
      showInformationMessage: () => message.promise,
      showQuickPick: async () => null,
      tabGroups: { onDidChangeTabs: () => ({ dispose: () => {} }) },
    },
    WorkspaceEdit: class {
      replace() {}
    },
    Range: class {},
  };
  return { vscode: v, ctx };
}

describe("openDiff: keybinding-driven accept / reject", () => {
  it("acceptActiveDiff settles the open review as accepted", async () => {
    const fx = fakeVscodeForKeys();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "proposal" });
    await tick();
    expect(fx.ctx).toEqual([true]); // context turned on while the review is open

    expect(facade.acceptActiveDiff()).toBe(true);
    await expect(p).resolves.toMatchObject({
      outcome: "accepted",
      finalText: "proposal",
    });
    expect(fx.ctx).toEqual([true, false]); // turned back off when it settled
  });

  it("rejectActiveDiff settles the open review as rejected", async () => {
    const fx = fakeVscodeForKeys();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "x" });
    await tick();

    expect(facade.rejectActiveDiff()).toBe(true);
    await expect(p).resolves.toMatchObject({ outcome: "rejected" });
    expect(fx.ctx).toEqual([true, false]);
  });

  it("accept/reject are no-ops (return false) when no review is open", async () => {
    const fx = fakeVscodeForKeys();
    const facade = createVscodeEditorFacade(fx.vscode);
    expect(facade.acceptActiveDiff()).toBe(false);
    expect(facade.rejectActiveDiff()).toBe(false);
    expect(fx.ctx).toEqual([]); // never toggled the context key
  });

  it("a second keybinding press after settle is ignored (single decision)", async () => {
    const fx = fakeVscodeForKeys();
    const facade = createVscodeEditorFacade(fx.vscode);
    const p = facade.openDiff({ path: "/ws/a.js", modifiedText: "y" });
    await tick();

    expect(facade.acceptActiveDiff()).toBe(true);
    await expect(p).resolves.toMatchObject({ outcome: "accepted" });
    // The review is already gone — a late press does nothing.
    expect(facade.rejectActiveDiff()).toBe(false);
  });
});
