/**
 * applyTextToFile fail-safe — vscode.workspace.applyEdit resolves FALSE (no
 * throw) when an edit is rejected (read-only doc, stale ranges). The old code
 * ignored the boolean and "saved" the unchanged document, so openDiff
 * reported `accepted` while the disk never changed. Now a false applyEdit
 * forces the direct fs write fallback, exercised here through a REAL accept
 * flow onto a real temp file.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

const tick = () => new Promise((r) => setImmediate(r));

function fakeVscode({ applyEditResult }) {
  let untitledCounter = 0;
  let message;
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
          getText: () => "old",
          positionAt: (n) => n,
          save: async () => {},
        };
      },
      applyEdit: async () => applyEditResult,
    },
    commands: { executeCommand: async () => {} },
    window: {
      showInformationMessage: () =>
        new Promise((resolve) => {
          message = { resolve };
        }),
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
  v.__decide = (choice) => message.resolve(choice);
  return v;
}

describe("applyTextToFile applyEdit-rejection fallback", () => {
  it("accepted diff still lands on disk when applyEdit resolves false", async () => {
    const file = path.join(os.tmpdir(), `cc-apply-fallback-${Date.now()}.txt`);
    fs.writeFileSync(file, "old", "utf8");
    try {
      const v = fakeVscode({ applyEditResult: false });
      const facade = createVscodeEditorFacade(v);
      const p = facade.openDiff({ path: file, modifiedText: "NEW CONTENT" });
      await tick();
      v.__decide("Accept");
      const res = await p;
      expect(res).toMatchObject({ outcome: "accepted" });
      // The whole point: "accepted" must mean the bytes are on disk.
      expect(fs.readFileSync(file, "utf8")).toBe("NEW CONTENT");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
