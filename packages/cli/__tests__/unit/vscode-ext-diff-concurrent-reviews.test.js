/**
 * Concurrent diff reviews (multi-tab chat) — openDiff used to keep ONE
 * `activeReview` slot: a second review clobbered the first, so settling the
 * newer one killed the `chainlesschainDiffActive` context key while the older
 * review was still open (keyboard dead), and the keys always acted on the
 * newest review even when the user was looking at the older diff tab.
 *
 * Now reviews live on a stack: the context key stays on while ANY review is
 * pending, and Accept/Reject prefer the review whose diff tab is focused.
 */
import { describe, it, expect } from "vitest";

import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

const tick = () => new Promise((r) => setImmediate(r));

function fakeVscode() {
  const contextValues = []; // chainlesschainDiffActive setContext history
  let untitledCounter = 0;

  const v = {
    Uri: { file: (p) => ({ fsPath: p, toString: () => "file://" + p }) },
    workspace: {
      openTextDocument: async (arg) => {
        if (arg && typeof arg === "object" && "content" in arg) {
          const content = arg.content;
          const id = `untitled:Untitled-${++untitledCounter}`;
          return {
            uri: { toString: () => id },
            getText: () => content,
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
          contextValues.push(value);
        }
      },
    },
    window: {
      // Reviews are settled by the keyboard in this test — the toast never
      // resolves on its own.
      showInformationMessage: () => new Promise(() => {}),
      tabGroups: { activeTabGroup: { activeTab: null } },
      // no onDidChangeTabs → tab-close watching off, buttons/keyboard only
    },
    Range: class {
      constructor(s, e) {
        this.start = s;
        this.end = e;
      }
    },
    WorkspaceEdit: class {
      replace() {}
    },
  };
  v.__contextValues = contextValues;
  return v;
}

describe("concurrent openDiff reviews", () => {
  it("keyboard reject settles the NEWEST review; the older one stays keyboard-live", async () => {
    const v = fakeVscode();
    const facade = createVscodeEditorFacade(v);
    const pA = facade.openDiff({ path: "/ws/a.js", modifiedText: "A2" });
    await tick();
    const pB = facade.openDiff({ path: "/ws/b.js", modifiedText: "B2" });
    await tick();

    expect(facade.rejectActiveDiff()).toBe(true); // → B (most recent)
    const b = await pB;
    expect(b).toMatchObject({ outcome: "rejected", path: "/ws/b.js" });

    // A's review must still be active: context key never dropped to false.
    expect(v.__contextValues.at(-1)).toBe(true);

    expect(facade.rejectActiveDiff()).toBe(true); // → A
    const a = await pA;
    expect(a).toMatchObject({ outcome: "rejected", path: "/ws/a.js" });
    expect(v.__contextValues.at(-1)).toBe(false); // now truly no review left
    expect(facade.rejectActiveDiff()).toBe(false);
  });

  it("keys act on the review whose diff tab is FOCUSED, not blindly the newest", async () => {
    const v = fakeVscode();
    const facade = createVscodeEditorFacade(v);
    const pA = facade.openDiff({ path: "/ws/a.js", modifiedText: "A2" });
    await tick();
    const pB = facade.openDiff({ path: "/ws/b.js", modifiedText: "B2" });
    await tick();

    // Focus A's diff tab (its right pane is the first untitled doc).
    v.window.tabGroups.activeTabGroup.activeTab = {
      input: { modified: { toString: () => "untitled:Untitled-1" } },
    };
    expect(facade.rejectActiveDiff()).toBe(true);
    const a = await pA;
    expect(a).toMatchObject({ outcome: "rejected", path: "/ws/a.js" });

    // B is untouched and still resolvable.
    v.window.tabGroups.activeTabGroup.activeTab = null;
    expect(facade.rejectActiveDiff()).toBe(true);
    const b = await pB;
    expect(b).toMatchObject({ outcome: "rejected", path: "/ws/b.js" });
  });
});
