import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STASH_FILE_BYTES,
  parsePromptStashCommand,
  PromptStash,
  runPromptStashCommand,
} from "../../src/repl/prompt-stash.js";

const directories = [];

function makeStash(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "cc-stash-test-"));
  directories.push(directory);
  return new PromptStash({
    filePath: join(directory, "stash.json"),
    now: options.now || (() => 1234),
    uuid: options.uuid || (() => "12345678-abcd-ef00-0000-000000000000"),
    maxEntries: options.maxEntries,
    deps: {
      ensurePrivateDirectory: () => {},
      ensurePrivateFile: () => {},
    },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("prompt stash", () => {
  it("persists prompts and pops them in LIFO order", () => {
    let now = 100;
    let serial = 0;
    const stash = makeStash({
      now: () => ++now,
      uuid: () => `${String(++serial).padStart(8, "0")}-rest`,
    });
    stash.stash("first prompt");
    stash.stash("second\nprompt");

    const reopened = new PromptStash({
      filePath: stash.filePath,
      deps: {
        ensurePrivateDirectory: () => {},
        ensurePrivateFile: () => {},
      },
    });
    expect(reopened.list().map((entry) => entry.text)).toEqual([
      "second\nprompt",
      "first prompt",
    ]);
    expect(reopened.pop()?.text).toBe("second\nprompt");
    expect(reopened.pop()?.text).toBe("first prompt");
    expect(reopened.pop()).toBeNull();
  });

  it("creates the state directory before acquiring its file lock", () => {
    const root = mkdtempSync(join(tmpdir(), "cc-stash-parent-test-"));
    directories.push(root);
    const stash = new PromptStash({
      filePath: join(root, "missing", "state", "stash.json"),
      deps: {
        ensurePrivateDirectory: (directory) =>
          mkdirSync(directory, { recursive: true }),
        ensurePrivateFile: () => {},
      },
    });
    expect(stash.stash("first prompt").text).toBe("first prompt");
    expect(stash.list()).toHaveLength(1);
  });

  it("caps retained entries and clears them", () => {
    const stash = makeStash({ maxEntries: 2 });
    stash.stash("one");
    stash.stash("two");
    stash.stash("three");
    expect(stash.list().map((entry) => entry.text)).toEqual(["three", "two"]);
    expect(stash.clear()).toBe(2);
    expect(stash.list()).toEqual([]);
  });

  it("refuses malformed state instead of overwriting it", () => {
    const stash = makeStash();
    writeFileSync(stash.filePath, "{bad", "utf8");
    expect(() => stash.stash("do not overwrite")).toThrow(
      /prompt stash is malformed/,
    );
    expect(readFileSync(stash.filePath, "utf8")).toBe("{bad");
  });

  it("rejects an oversized state file before reading it", () => {
    const readFile = vi.fn();
    const stash = new PromptStash({
      filePath: "oversized-stash.json",
      deps: {
        existsSync: () => true,
        lstatSync: () => ({
          isSymbolicLink: () => false,
          size: MAX_STASH_FILE_BYTES + 1,
        }),
        readFileSync: readFile,
        ensurePrivateFile: () => {},
      },
    });
    expect(() => stash.list()).toThrow(/exceeds/);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("supports stash/list/pop/clear command semantics", () => {
    const stash = makeStash();
    expect(parsePromptStashCommand("list")).toEqual({ action: "list" });
    expect(parsePromptStashCommand("", "draft text")).toEqual({
      action: "stash",
      prompt: "draft text",
    });
    expect(runPromptStashCommand("add draft text", { stash }).ok).toBe(true);
    const listed = runPromptStashCommand("list", { stash });
    expect(listed.message).toContain("draft text");
    const popped = runPromptStashCommand("pop", { stash });
    expect(popped.prompt).toBe("draft text");
    expect(runPromptStashCommand("clear", { stash }).count).toBe(0);
  });
});
