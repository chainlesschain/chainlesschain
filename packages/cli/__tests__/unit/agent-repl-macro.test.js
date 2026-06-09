import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSlashMacro } from "../../src/repl/slash-macro.js";

// Unit tests for the REPL's user-command-macro wire (slash-macro.js). The
// interactive line handler in agent-repl.js calls resolveSlashMacro for every
// line, so this covers the exact resolution path: pass-through vs expansion.
describe("resolveSlashMacro (REPL macro wire)", () => {
  let cwd;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "repl-macro-"));
    mkdirSync(join(cwd, ".claude", "commands", "git"), { recursive: true });
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const write = (rel, body) =>
    writeFileSync(join(cwd, ".claude", "commands", rel), body, "utf-8");

  it("passes plain (non-slash) input through unchanged", async () => {
    const r = await resolveSlashMacro("just chatting here", { cwd });
    expect(r.matched).toBe(false);
    expect(r.promptText).toBe("just chatting here");
  });

  it("leaves an unknown /command untouched so it still reaches the LLM", async () => {
    const r = await resolveSlashMacro("/etc/hosts is what?", { cwd });
    expect(r.matched).toBe(false);
    expect(r.promptText).toBe("/etc/hosts is what?");
  });

  it("expands a matching macro with $ARGUMENTS and positional $1/$2", async () => {
    write(
      "greet.md",
      "---\ndescription: Greet\n---\nHi $1 and $2 -- all: $ARGUMENTS",
    );
    const r = await resolveSlashMacro("/greet alice bob", { cwd });
    expect(r.matched).toBe(true);
    expect(r.name).toBe("greet");
    expect(r.scope).toBe("project");
    expect(r.promptText).toBe("Hi alice and bob -- all: alice bob");
  });

  it("resolves colon-namespaced macros (git/commit.md -> /git:commit)", async () => {
    write("git/commit.md", "Commit: $ARGUMENTS");
    const r = await resolveSlashMacro("/git:commit fix the parser", { cwd });
    expect(r.matched).toBe(true);
    expect(r.name).toBe("git:commit");
    expect(r.promptText).toBe("Commit: fix the parser");
  });

  it("collapses repeated whitespace between positional args", async () => {
    write("p.md", "[$1][$2][$3]");
    const r = await resolveSlashMacro("/p   a    b c", { cwd });
    expect(r.matched).toBe(true);
    expect(r.promptText).toBe("[a][b][c]");
  });

  it("treats a bare slash (no name) as no macro", async () => {
    const r = await resolveSlashMacro("/   ", { cwd });
    expect(r.matched).toBe(false);
    expect(r.promptText).toBe("/");
  });

  it("surfaces expand warnings (e.g. missing @file) on a match", async () => {
    write("ref.md", "see @does-not-exist.txt");
    const r = await resolveSlashMacro("/ref", { cwd });
    expect(r.matched).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("uses injected deps (hermetic — no filesystem touched)", async () => {
    const seen = [];
    const deps = {
      getCommand: (name) => {
        seen.push(name);
        return { name, scope: "personal", body: "ignored" };
      },
      expandCommand: (macro, args) => ({
        prompt: `expanded:${macro.name}:${args.join(",")}`,
        warnings: ["w1"],
      }),
    };
    const r = await resolveSlashMacro("/foo x y", { cwd, deps });
    expect(seen).toEqual(["foo"]);
    expect(r).toMatchObject({
      matched: true,
      name: "foo",
      scope: "personal",
      promptText: "expanded:foo:x,y",
      warnings: ["w1"],
    });
  });
});
