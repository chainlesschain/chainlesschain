import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../src/repl/agent-repl.js"),
  "utf8",
);

describe("production agent REPL prompt interactions", () => {
  it("wires registry dispatch, idle keys, live suggestions, and vision chips", () => {
    expect(source).toContain("createPromptInteractionSurface({");
    expect(source).toContain("createSystemClipboardImageBinding()");
    expect(source).toContain(
      'Object.prototype.hasOwnProperty.call(\n    options,\n    "clipboardBinding",',
    );
    expect(source).toContain(
      "_promptInteractionSurface.dispatchSlash(trimmed)",
    );
    expect(source).toContain("_promptInteractions.handleKeypress(_str, k)");
    expect(source).toContain('readStringSetting("keybindingFlavor"');
    expect(source).toContain('_keybindingFlavor === "readline"');
    expect(source).toContain("isReadlineWordRuboutKey(_str, k)");
    expect(source).toContain("readlineWordRubout(rl.line, rl.cursor)");
    expect(source).toContain("guardedReadlineKeypress");
    expect(source).toContain(
      'process.stdin.prependListener("keypress", _replKeypressHandler)',
    );
    expect(source).toContain("_consumeReadlineKeypress(key)");
    expect(source).toContain(
      "getSuggestionContext: () => ({ messages: messages.slice() })",
    );
    expect(source).toContain("_promptInteractions.scheduleSuggestions({");
    expect(source).toContain("await suggestionRun.promise;");
    expect(source).toContain("_promptInteractions.takeClipboardImageChips()");
    expect(source).toContain("_promptInteractions.clearClipboardImageChips()");
    expect(source).toContain("mergeClipboardImageChips(");
    expect(source).toContain("resolveVisionLlm({");
    expect(source).toContain("_promptInteractions.dispose()");
  });
});
