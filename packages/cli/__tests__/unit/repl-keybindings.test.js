import { describe, expect, it } from "vitest";
import {
  keypressToChord,
  matchReplKeybinding,
  normalizeKeyChord,
  REPL_KEYBINDINGS_JSON_SCHEMA,
  validateReplKeybindings,
} from "../../src/repl/repl-keybindings.js";

describe("REPL custom keybindings", () => {
  it("normalizes aliases and modifier order", () => {
    expect(normalizeKeyChord("Shift+Control+G")).toBe("ctrl+shift+g");
    expect(normalizeKeyChord("Option+P")).toBe("alt+p");
    expect(normalizeKeyChord("meta+f2")).toBe("alt+f2");
    expect(() => normalizeKeyChord("command+f2")).toThrow(/multiple keys/);
  });

  it("rejects unsafe terminal chords and malformed entries", () => {
    expect(() => normalizeKeyChord("ctrl+c")).toThrow(/reserved/);
    expect(() => normalizeKeyChord("shift+tab")).toThrow(/reserved/);
    expect(() => normalizeKeyChord("ctrl+alt")).toThrow(/no key/);
    expect(() => normalizeKeyChord("ctrl+a+b")).toThrow(/multiple keys/);
    expect(() => normalizeKeyChord("ctrl+wheelup")).toThrow(/unsupported/);
  });

  it("merges defaults, supports disabling, and reports collisions", () => {
    const result = validateReplKeybindings({
      "prompt.edit": ["alt+e"],
      "prompt.stash": null,
      "prompt.pop": "alt+e",
    });
    expect(result.valid).toBe(false);
    expect(result.actionBindings["prompt.edit"]).toEqual(["alt+e"]);
    expect(result.actionBindings["prompt.stash"]).toEqual([]);
    expect(result.errors).toContain(
      "key chord alt+e is assigned to both prompt.edit and prompt.pop",
    );
  });

  it("maps Node keypress descriptors to actions", () => {
    const compiled = validateReplKeybindings({
      "prompt.edit": "ctrl+shift+e",
      "prompt.stash": [],
      "prompt.pop": [],
      "session.recap": [],
      "suggestions.toggle": [],
    });
    expect(keypressToChord("e", { name: "e", ctrl: true, shift: true })).toBe(
      "ctrl+shift+e",
    );
    expect(
      matchReplKeybinding(compiled, "e", {
        name: "e",
        ctrl: true,
        shift: true,
      }),
    ).toBe("prompt.edit");
    expect(matchReplKeybinding(compiled, "x", { name: "x" })).toBeNull();
  });

  it("exports a closed JSON schema for supported actions", () => {
    expect(REPL_KEYBINDINGS_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(REPL_KEYBINDINGS_JSON_SCHEMA.properties)).toEqual([
      "prompt.edit",
      "prompt.stash",
      "prompt.pop",
      "session.recap",
      "suggestions.toggle",
    ]);
  });

  it("accepts a full settings object without treating unrelated keys as actions", () => {
    const result = validateReplKeybindings({
      permissions: { allow: [] },
      hooks: {},
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.bindings.get("ctrl+g")).toBe("prompt.edit");
  });
});
