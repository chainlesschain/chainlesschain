/**
 * Lean / entry-only project memory (`CC_PROJECT_MEMORY=lean`, IDE chat default).
 *
 * Contract:
 *   full  → cc.md/CLAUDE.md ENTRY + CLAUDE.local.md + .claude/rules/* + rules.md
 *   lean  → ENTRY file ONLY (local + .claude/rules + rules.md all shed)
 *   off   → nothing (legacy `--no-project-memory`)
 *   env=0 → legacy: instruction block off, but rules.md still KEPT (unchanged)
 *
 * All exercised against a real temp project so the file-discovery + render path
 * is the same one `cc agent` runs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { findInstructionFiles } from "../../src/lib/project-instructions.js";
import { buildSystemPrompt } from "../../src/runtime/agent-core.js";
import { composeSystemPrompt } from "../../src/runtime/system-prompt.js";

let proj;

beforeEach(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), "cc-lean-"));
  fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
  fs.writeFileSync(path.join(proj, "CLAUDE.md"), "ENTRY-MARKER", "utf-8");
  fs.writeFileSync(
    path.join(proj, "CLAUDE.local.md"),
    "LOCAL-STATUS-MARKER",
    "utf-8",
  );
  fs.mkdirSync(path.join(proj, ".claude", "rules"), { recursive: true });
  fs.writeFileSync(
    path.join(proj, ".claude", "rules", "style.md"),
    "PATH-RULE-MARKER",
    "utf-8",
  );
  fs.mkdirSync(path.join(proj, ".chainlesschain"), { recursive: true });
  // buildSystemPrompt locates rules.md via findProjectRoot, which keys on
  // .chainlesschain/config.json (not .git) — the fixture needs it present.
  fs.writeFileSync(
    path.join(proj, ".chainlesschain", "config.json"),
    "{}",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(proj, ".chainlesschain", "rules.md"),
    "PROJECT-RULES-MARKER",
    "utf-8",
  );
});

afterEach(() => {
  delete process.env.CC_PROJECT_MEMORY;
  try {
    fs.rmSync(proj, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("findInstructionFiles — entryOnly", () => {
  it("full discovery includes project + local + rule scopes", () => {
    const scopes = findInstructionFiles({ cwd: proj }).map((f) => f.scope);
    expect(scopes).toContain("project");
    expect(scopes).toContain("local");
    expect(scopes).toContain("rule");
  });

  it("entryOnly keeps project entry, drops local + rule", () => {
    const files = findInstructionFiles({ cwd: proj, entryOnly: true });
    const scopes = files.map((f) => f.scope);
    expect(scopes).toContain("project");
    expect(scopes).not.toContain("local");
    expect(scopes).not.toContain("rule");
    // the surviving file is the CLAUDE.md entry
    expect(files.some((f) => f.path.endsWith("CLAUDE.md"))).toBe(true);
  });
});

describe("composeSystemPrompt — lean mode keeps the entry, sheds the rest", () => {
  const compose = (projectMemory) =>
    composeSystemPrompt(buildSystemPrompt(proj, { projectMemory }), {
      cwd: proj,
      projectMemory,
    });

  it("full (true): entry + local + rule + rules.md all present", () => {
    const s = compose(true);
    expect(s).toContain("ENTRY-MARKER");
    expect(s).toContain("LOCAL-STATUS-MARKER");
    expect(s).toContain("PATH-RULE-MARKER");
    expect(s).toContain("PROJECT-RULES-MARKER");
  });

  it('lean ("lean"): ONLY the entry survives', () => {
    const s = compose("lean");
    expect(s).toContain("ENTRY-MARKER");
    expect(s).not.toContain("LOCAL-STATUS-MARKER");
    expect(s).not.toContain("PATH-RULE-MARKER");
    expect(s).not.toContain("PROJECT-RULES-MARKER"); // rules.md shed too
  });

  it("off (false): nothing, entry included", () => {
    const s = compose(false);
    expect(s).not.toContain("ENTRY-MARKER");
    expect(s).not.toContain("PROJECT-RULES-MARKER");
  });

  it("env=lean drives lean for callers that thread no explicit value", () => {
    process.env.CC_PROJECT_MEMORY = "lean";
    // buildSystemPrompt reads the env for the rules.md decision; the block
    // itself is VITEST-suppressed in the *env-default* path, so assert the
    // rules.md shed (the part that is not suppressed) here.
    const s = buildSystemPrompt(proj, {});
    expect(s).not.toContain("PROJECT-RULES-MARKER");
  });

  it("env=0 legacy: block off but rules.md KEPT (unchanged contract)", () => {
    process.env.CC_PROJECT_MEMORY = "0";
    const s = buildSystemPrompt(proj, {});
    expect(s).toContain("PROJECT-RULES-MARKER");
  });
});
