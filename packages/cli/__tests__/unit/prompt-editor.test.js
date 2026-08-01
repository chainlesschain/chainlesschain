import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editPromptInExternalEditor,
  parsePromptEditorCommand,
  resolvePromptEditor,
} from "../../src/repl/prompt-editor.js";

const directories = [];

function makeTempRoot() {
  const directory = mkdtempSync(join(tmpdir(), "cc-editor-test-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("external prompt editor", () => {
  it("parses quoted editor argv without a shell", () => {
    expect(
      parsePromptEditorCommand('"C:\\Program Files\\Editor\\edit.exe" --wait'),
    ).toEqual(["C:\\Program Files\\Editor\\edit.exe", "--wait"]);
    expect(() => parsePromptEditorCommand('"unterminated')).toThrow(
      /unterminated quote/,
    );
  });

  it("uses the same EDITOR then VISUAL environment convention as config edit", () => {
    expect(
      resolvePromptEditor({ EDITOR: "code", VISUAL: "vim" }, "linux"),
    ).toEqual({ command: "code", source: "EDITOR" });
    expect(resolvePromptEditor({ VISUAL: "vim" }, "linux")).toEqual({
      command: "vim",
      source: "VISUAL",
    });
    expect(resolvePromptEditor({}, "win32").command).toBe("notepad");
  });

  it("reports an explicit empty editor as unavailable", () => {
    expect(editPromptInExternalEditor("draft", { editor: "" })).toEqual({
      ok: false,
      capability: "unavailable",
      reason: "No external editor command is configured.",
    });
  });

  it("round-trips through an owner-only temp file and returns edited content", () => {
    const root = makeTempRoot();
    let promptPath;
    const spawnSync = vi.fn((command, args, options) => {
      promptPath = args.at(-1);
      expect(command).toBe("editor");
      expect(args.slice(0, -1)).toEqual(["--wait"]);
      expect(options).toMatchObject({
        shell: false,
        origin: "repl:prompt-editor",
        scope: "editor",
      });
      writeFileSync(promptPath, "edited 中文\n", "utf8");
      return { status: 0 };
    });

    const result = editPromptInExternalEditor("original", {
      editor: "editor --wait",
      deps: {
        tmpdir: () => root,
        spawnSync,
        ensurePrivateDirectory: () => {},
        ensurePrivateFile: () => {},
      },
    });

    expect(result).toMatchObject({
      ok: true,
      content: "edited 中文",
      changed: true,
      editor: "editor",
    });
    expect(existsSync(promptPath)).toBe(false);
  });

  it("reports a truthful capability fallback when launch fails", () => {
    const root = makeTempRoot();
    const result = editPromptInExternalEditor("draft", {
      editor: "missing-editor",
      deps: {
        tmpdir: () => root,
        spawnSync: () => ({ error: new Error("ENOENT") }),
        ensurePrivateDirectory: () => {},
        ensurePrivateFile: () => {},
      },
    });
    expect(result).toMatchObject({
      ok: false,
      capability: "unavailable",
      editor: "missing-editor",
    });
    expect(result.reason).toContain("ENOENT");
  });

  it("treats a missing spawn result as unavailable", () => {
    const root = makeTempRoot();
    const result = editPromptInExternalEditor("draft", {
      editor: "editor",
      deps: {
        tmpdir: () => root,
        spawnSync: () => undefined,
        ensurePrivateDirectory: () => {},
        ensurePrivateFile: () => {},
      },
    });
    expect(result).toMatchObject({
      ok: false,
      capability: "unavailable",
    });
  });

  it("refuses an editor-replaced symbolic link", () => {
    const root = makeTempRoot();
    const result = editPromptInExternalEditor("draft", {
      editor: "editor",
      deps: {
        tmpdir: () => root,
        spawnSync: () => ({ status: 0 }),
        lstatSync: () => ({ isSymbolicLink: () => true }),
        ensurePrivateDirectory: () => {},
        ensurePrivateFile: () => {},
      },
    });
    expect(result).toMatchObject({
      ok: false,
      capability: "failed",
      reason: expect.stringContaining("symbolic link"),
    });
  });
});
