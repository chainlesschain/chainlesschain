import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeVscode() {
  let decision;
  let untitled = 0;
  const prompts = [];
  const vscode = {
    Uri: {
      file: (filePath) => ({
        fsPath: filePath,
        scheme: "file",
        toString: () => `file://${filePath}`,
      }),
    },
    workspace: {
      textDocuments: [],
      openTextDocument: async (arg) => {
        if (arg && typeof arg === "object" && "content" in arg) {
          const text = arg.content;
          return {
            uri: { toString: () => `untitled:${++untitled}` },
            getText: () => text,
            positionAt: (offset) => offset,
            save: async () => true,
          };
        }
        return {
          uri: arg,
          getText: () => fs.readFileSync(arg.fsPath, "utf8"),
          positionAt: (offset) => offset,
          save: async () => true,
        };
      },
      applyEdit: async () => true,
    },
    commands: { executeCommand: async () => undefined },
    window: {
      showInformationMessage: (message, _options, ...actions) =>
        new Promise((resolve) => {
          prompts.push({ message, actions });
          decision = resolve;
        }),
      showQuickPick: async () => null,
    },
    WorkspaceEdit: class {
      replace() {}
    },
    Range: class {},
    l10n: { t: (value, ...args) => value.replace("{0}", args[0] ?? "") },
  };
  return {
    vscode,
    prompts,
    decide: (choice) => decision(choice),
  };
}

describe("openDiff lifecycle operations", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-diff-lifecycle-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes only after explicit acceptance and does not offer partial hunks", async () => {
    const source = path.join(dir, "delete-me.txt");
    fs.writeFileSync(source, "old", "utf8");
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const pending = facade.openDiff({
      path: source,
      originalText: "old",
      modifiedText: "",
      operation: "delete",
    });
    await tick();
    expect(fx.prompts[0].message).toContain("Delete");
    expect(fx.prompts[0].actions).not.toContain("Pick hunks…");
    fx.decide("Accept");

    const result = await pending;
    expect(result).toMatchObject({
      outcome: "accepted",
      operation: "delete",
    });
    expect(result).not.toHaveProperty("finalText");
    expect(fs.existsSync(source)).toBe(false);
  });

  it("renames without rewriting unchanged bytes", async () => {
    const source = path.join(dir, "old-name.txt");
    const target = path.join(dir, "new-name.txt");
    fs.writeFileSync(source, "same content", "utf8");
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const pending = facade.openDiff({
      path: source,
      targetPath: target,
      originalText: "same content",
      modifiedText: "same content",
      operation: "rename",
    });
    await tick();
    expect(fx.prompts[0].message).toContain(target);
    fx.decide("Accept");

    const result = await pending;
    expect(result).toMatchObject({
      outcome: "accepted",
      operation: "rename",
      targetPath: target,
    });
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("same content");
  });

  it("fails closed when a rename destination already exists", async () => {
    const source = path.join(dir, "source.txt");
    const target = path.join(dir, "target.txt");
    fs.writeFileSync(source, "source", "utf8");
    fs.writeFileSync(target, "target", "utf8");
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const pending = facade.openDiff({
      path: source,
      targetPath: target,
      originalText: "source",
      modifiedText: "source",
      operation: "rename",
    });
    await tick();
    fx.decide("Accept");

    const result = await pending;
    expect(result).toMatchObject({
      outcome: "rejected",
      operation: "rename",
    });
    expect(result.reason).toContain("already exists");
    expect(fs.readFileSync(source, "utf8")).toBe("source");
    expect(fs.readFileSync(target, "utf8")).toBe("target");
  });
});
