import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPL_KEYBINDING_FLAVOR,
  isReadlineWordRuboutKey,
  keypressToChord,
  matchReplKeybinding,
  normalizeKeyChord,
  readlineWordRubout,
  REPL_KEYBINDINGS_JSON_SCHEMA,
  resolveReplKeybindingFlavor,
  validateReplKeybindings,
} from "../../src/repl/repl-keybindings.js";

describe("REPL keybinding flavors", () => {
  it("defaults invalid or missing values to classic", () => {
    expect(resolveReplKeybindingFlavor()).toEqual({
      flavor: DEFAULT_REPL_KEYBINDING_FLAVOR,
      error: null,
    });
    expect(resolveReplKeybindingFlavor("unknown")).toMatchObject({
      flavor: "classic",
      error: expect.stringContaining("classic or readline"),
    });
  });

  it("accepts classic and readline case-insensitively", () => {
    expect(resolveReplKeybindingFlavor("classic")).toEqual({
      flavor: "classic",
      error: null,
    });
    expect(resolveReplKeybindingFlavor(" ReadLine ")).toEqual({
      flavor: "readline",
      error: null,
    });
  });

  it("recognizes only an unmodified Ctrl+W chord", () => {
    expect(isReadlineWordRuboutKey("\u0017", { name: "w", ctrl: true })).toBe(
      true,
    );
    expect(isReadlineWordRuboutKey("w", { name: "w", ctrl: true })).toBe(true);
    expect(
      isReadlineWordRuboutKey("w", { name: "w", ctrl: true, shift: true }),
    ).toBe(false);
    expect(isReadlineWordRuboutKey("w", { name: "w" })).toBe(false);
  });

  it("deletes a full path token to the previous whitespace boundary", () => {
    expect(readlineWordRubout("open src/lib/file.js", 20)).toEqual({
      line: "open ",
      cursor: 5,
      changed: true,
    });
  });

  it("removes trailing whitespace plus the previous token and preserves suffixes", () => {
    expect(readlineWordRubout("alpha beta   ", 13)).toEqual({
      line: "alpha ",
      cursor: 6,
      changed: true,
    });
    expect(readlineWordRubout("run path/to/file --flag", 16)).toEqual({
      line: "run  --flag",
      cursor: 4,
      changed: true,
    });
    expect(readlineWordRubout("unchanged", 0)).toEqual({
      line: "unchanged",
      cursor: 0,
      changed: false,
    });
  });
});

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
