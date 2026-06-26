/**
 * Unit tests for system-prompt overrides (--system-prompt / --append-system-prompt).
 * Filesystem access is injected so @file resolution never touches real disk.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import {
  resolvePromptText,
  composeSystemPrompt,
} from "../../src/runtime/system-prompt.js";

const cwd = process.cwd();

function fakeFs(files) {
  const map = new Map(
    Object.entries(files).map(([rel, content]) => [
      path.resolve(cwd, rel),
      content,
    ]),
  );
  return {
    readFileSync(abs) {
      if (!map.has(abs)) {
        const err = new Error(`ENOENT: ${abs}`);
        err.code = "ENOENT";
        throw err;
      }
      return map.get(abs);
    },
  };
}

describe("resolvePromptText", () => {
  it("returns null for null/undefined", () => {
    expect(resolvePromptText(null)).toBeNull();
    expect(resolvePromptText(undefined)).toBeNull();
  });

  it("returns a literal string unchanged", () => {
    expect(resolvePromptText("be terse")).toBe("be terse");
  });

  it("reads file contents for an @path", () => {
    const out = resolvePromptText("@prompts/persona.md", {
      cwd,
      deps: { fs: fakeFs({ "prompts/persona.md": "You are a pirate." }) },
    });
    expect(out).toBe("You are a pirate.");
  });

  it("falls back to literal when the @path is unreadable", () => {
    const out = resolvePromptText("@nope.md", {
      cwd,
      deps: { fs: fakeFs({}) },
    });
    expect(out).toBe("@nope.md");
  });
});

describe("composeSystemPrompt", () => {
  it("returns the base when no override/append", () => {
    expect(composeSystemPrompt("BASE")).toBe("BASE");
  });

  it("replaces the base with a truthy override", () => {
    expect(composeSystemPrompt("BASE", { systemPrompt: "OVERRIDE" })).toBe(
      "OVERRIDE",
    );
  });

  it("ignores an empty override (keeps base)", () => {
    expect(composeSystemPrompt("BASE", { systemPrompt: "" })).toBe("BASE");
  });

  it("appends after the base with a blank-line separator", () => {
    expect(composeSystemPrompt("BASE", { appendSystemPrompt: "EXTRA" })).toBe(
      "BASE\n\nEXTRA",
    );
  });

  it("appends after an override when both are given", () => {
    expect(
      composeSystemPrompt("BASE", {
        systemPrompt: "OVERRIDE",
        appendSystemPrompt: "EXTRA",
      }),
    ).toBe("OVERRIDE\n\nEXTRA");
  });

  it("uses append alone when base is empty", () => {
    expect(composeSystemPrompt("", { appendSystemPrompt: "EXTRA" })).toBe(
      "EXTRA",
    );
  });

  it("appends an output-style persona after the base", () => {
    expect(composeSystemPrompt("BASE", { outputStyle: "STYLE" })).toBe(
      "BASE\n\nSTYLE",
    );
  });

  it("orders output-style LAST — after both override and append", () => {
    // Documented contract: base/override → (project memory) → append → style.
    expect(
      composeSystemPrompt("BASE", {
        systemPrompt: "OVERRIDE",
        appendSystemPrompt: "EXTRA",
        outputStyle: "STYLE",
      }),
    ).toBe("OVERRIDE\n\nEXTRA\n\nSTYLE");
  });

  it("output-style alone when base is empty", () => {
    expect(composeSystemPrompt("", { outputStyle: "STYLE" })).toBe("STYLE");
  });

  it("explicit projectMemory:false injects no block (stays pure)", () => {
    expect(
      composeSystemPrompt("BASE", {
        appendSystemPrompt: "EXTRA",
        projectMemory: false,
      }),
    ).toBe("BASE\n\nEXTRA");
  });
});
