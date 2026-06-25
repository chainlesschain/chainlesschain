import { describe, it, expect, vi } from "vitest";
import { resolveSlashMacro } from "../../src/repl/slash-macro.js";

// Hermetic deps so we never touch the real .claude/commands filesystem.
function deps({ getCommand, expandCommand } = {}) {
  return {
    getCommand: getCommand || vi.fn(() => null),
    expandCommand:
      expandCommand || vi.fn(() => ({ prompt: "EXPANDED", warnings: [] })),
  };
}

describe("resolveSlashMacro", () => {
  it("passes plain (non-slash) text through unchanged", async () => {
    const d = deps();
    const r = await resolveSlashMacro("hello there", { deps: d });
    expect(r).toEqual({
      matched: false,
      promptText: "hello there",
      warnings: [],
    });
    expect(d.getCommand).not.toHaveBeenCalled();
  });

  it("leaves an unknown /command verbatim so paths like /etc/hosts reach the LLM", async () => {
    const d = deps({ getCommand: vi.fn(() => null) });
    const r = await resolveSlashMacro("/etc/hosts please", {
      deps: d,
      cwd: "/proj",
    });
    expect(r.matched).toBe(false);
    expect(r.promptText).toBe("/etc/hosts please");
    // head is the first whitespace-delimited token — the whole path, so the
    // lookup misses and the line is preserved verbatim.
    expect(d.getCommand).toHaveBeenCalledWith("etc/hosts", "/proj");
  });

  it("treats a lone slash as non-macro (no empty command lookup)", async () => {
    const d = deps();
    const r = await resolveSlashMacro("/", { deps: d });
    expect(r.matched).toBe(false);
    expect(d.getCommand).not.toHaveBeenCalled();
  });

  it("expands a matched macro and forwards its args (sans empties)", async () => {
    const macro = { name: "review", scope: "project" };
    const d = deps({
      getCommand: vi.fn(() => macro),
      expandCommand: vi.fn(() => ({ prompt: "do review", warnings: ["w1"] })),
    });
    const r = await resolveSlashMacro("/review  a   b ", {
      deps: d,
      cwd: "/proj",
    });
    expect(d.getCommand).toHaveBeenCalledWith("review", "/proj");
    expect(d.expandCommand).toHaveBeenCalledWith(macro, ["a", "b"], {
      cwd: "/proj",
    });
    expect(r).toMatchObject({
      matched: true,
      promptText: "do review",
      warnings: ["w1"],
      name: "review",
      scope: "project",
      model: null,
      allowedTools: null,
    });
  });

  it("surfaces the matched command's frontmatter (model / allowedTools)", async () => {
    const macro = {
      name: "deploy",
      scope: "user",
      model: "opus",
      allowedTools: "Bash(git*)",
    };
    const d = deps({ getCommand: vi.fn(() => macro) });
    const r = await resolveSlashMacro("/deploy", { deps: d });
    expect(r.model).toBe("opus");
    expect(r.allowedTools).toBe("Bash(git*)");
  });

  it("coerces null / undefined input to a non-match", async () => {
    const d = deps();
    expect((await resolveSlashMacro(null, { deps: d })).matched).toBe(false);
    expect((await resolveSlashMacro(undefined, { deps: d })).promptText).toBe(
      "",
    );
  });
});
