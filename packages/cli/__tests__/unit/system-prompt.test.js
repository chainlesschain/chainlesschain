/**
 * Unit tests for system-prompt overrides (--system-prompt / --append-system-prompt).
 * Filesystem access is injected so @file resolution never touches real disk.
 */

import { describe, it, expect, vi } from "vitest";
import path from "path";
import {
  resolvePromptText,
  composeSystemPrompt,
} from "../../src/runtime/system-prompt.js";

// Replace the project-memory loader with a deterministic sentinel block so the
// INJECTION POSITION can be asserted without coupling to the cc.md/CLAUDE.md
// file-discovery internals. Purely additive: every other test in this file
// leaves projectMemory unset (default-off under vitest) or false, so the loader
// is never invoked there and this mock is invisible to them.
vi.mock("../../src/lib/project-instructions.js", () => ({
  loadProjectInstructionsBlock: vi.fn(() => "MEMORY-BLOCK"),
}));

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

  it("projectMemory:true injects the block AFTER base but BEFORE append + style", () => {
    // Security-relevant contract: project memory (cc.md/CLAUDE.md — authored by
    // a possibly-cloned/untrusted repo) must NOT come after the user's explicit
    // --append-system-prompt or output-style. Later text gets the LLM's "last
    // word", so the user's own instructions must always follow the repo memory.
    expect(
      composeSystemPrompt("BASE", {
        projectMemory: true,
        appendSystemPrompt: "EXTRA",
        outputStyle: "STYLE",
      }),
    ).toBe("BASE\n\nMEMORY-BLOCK\n\nEXTRA\n\nSTYLE");
  });

  it("projectMemory:true block follows an override too (override → memory)", () => {
    expect(
      composeSystemPrompt("BASE", {
        systemPrompt: "OVERRIDE",
        projectMemory: true,
      }),
    ).toBe("OVERRIDE\n\nMEMORY-BLOCK");
  });

  it("projectMemory:true block stands alone when base/override are empty", () => {
    expect(composeSystemPrompt("", { projectMemory: true })).toBe(
      "MEMORY-BLOCK",
    );
  });
});
