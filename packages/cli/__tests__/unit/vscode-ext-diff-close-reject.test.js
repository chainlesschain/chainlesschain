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
