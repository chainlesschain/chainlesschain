/**
 * project-instructions — cc.md / CLAUDE.md project-memory loader.
 *
 * Real temp directories (no fs mocking — the lib's deps seam defaults are
 * exercised as-is); every test passes an explicit `home` so a developer's
 * actual ~/.claude/CLAUDE.md never leaks into assertions.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  findProjectRoot,
  findInstructionFiles,
  collectImportTokens,
  loadProjectInstructions,
  renderProjectInstructionsBlock,
  loadProjectInstructionsBlock,
  parseRuleFrontmatter,
  ruleApplies,
} from "../../src/lib/project-instructions.js";
import { composeSystemPrompt } from "../../src/runtime/system-prompt.js";

let tmp;
let home;

function write(rel, content) {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-projmem-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-projmem-home-"));
});

afterEach(() => {
  for (const dir of [tmp, home]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("findProjectRoot", () => {
  it("finds the dir containing .git walking up", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "repo", "a", "b"), { recursive: true });
    expect(findProjectRoot(path.join(tmp, "repo", "a", "b"))).toBe(
      path.join(tmp, "repo"),
    );
  });

  it("returns null outside a repo", () => {
    fs.mkdirSync(path.join(tmp, "plain"), { recursive: true });
    expect(findProjectRoot(path.join(tmp, "plain"))).toBeNull();
  });
});

describe("findInstructionFiles", () => {
  it("orders user → root → deeper, local right after its project file", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    const userFile = path.join(home, ".chainlesschain", "cc.md");
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, "user", "utf-8");
    write("repo/cc.md", "root");
    write("repo/sub/CLAUDE.md", "sub");
    write("repo/sub/cc.local.md", "sub local");

    const found = findInstructionFiles({
      cwd: path.join(tmp, "repo", "sub"),
      home,
    });
    expect(found.map((f) => [path.basename(f.path), f.scope])).toEqual([
      ["cc.md", "user"],
      ["cc.md", "project"],
      ["CLAUDE.md", "project"],
      ["cc.local.md", "local"],
    ]);
  });

  it("prefers cc.md over CLAUDE.md over AGENTS.md in the same dir", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/AGENTS.md", "agents");
    write("repo/CLAUDE.md", "claude");
    let found = findInstructionFiles({ cwd: path.join(tmp, "repo"), home });
    expect(path.basename(found[0].path)).toBe("CLAUDE.md");

    write("repo/cc.md", "cc");
    found = findInstructionFiles({ cwd: path.join(tmp, "repo"), home });
    expect(path.basename(found[0].path)).toBe("cc.md");
  });

  it("falls back to AGENTS.md when no cc.md/CLAUDE.md", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/AGENTS.md", "agents");
    const found = findInstructionFiles({ cwd: path.join(tmp, "repo"), home });
    expect(found.map((f) => path.basename(f.path))).toEqual(["AGENTS.md"]);
  });

  it("uses ~/.claude/CLAUDE.md as user-scope fallback", () => {
    const legacy = path.join(home, ".claude", "CLAUDE.md");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "legacy user", "utf-8");
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    const found = findInstructionFiles({ cwd: path.join(tmp, "repo"), home });
    expect(found).toEqual([{ path: legacy, scope: "user" }]);
  });

  it("includes .chainlesschain/rules.md (template-scaffold rules) in the chain", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "memory");
    write("repo/.chainlesschain/rules.md", "scaffold rules");
    const found = findInstructionFiles({ cwd: path.join(tmp, "repo"), home });
    expect(found.map((f) => [path.basename(f.path), f.scope])).toEqual([
      ["cc.md", "project"],
      ["rules.md", "rules"],
    ]);
  });

  it("returns [] when nothing exists", () => {
    fs.mkdirSync(path.join(tmp, "empty"), { recursive: true });
    expect(findInstructionFiles({ cwd: path.join(tmp, "empty"), home })).toEqual(
      [],
    );
  });
});

describe("collectImportTokens", () => {
  it("collects @tokens outside code fences only", () => {
    const text = [
      "See @docs/extra.md for details.",
      "```",
      "@inside/fence.md",
      "```",
      "and (@second.md) too",
    ].join("\n");
    expect(collectImportTokens(text)).toEqual(["docs/extra.md", "second.md"]);
  });

  it("skips emails and mid-word @", () => {
    expect(collectImportTokens("mail me at foo@bar.com")).toEqual([]);
  });
});

describe("loadProjectInstructions", () => {
  it("expands imports relative to the importing file, with cycle guard", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "root file\n@docs/a.md");
    write("repo/docs/a.md", "doc a\n@./b.md");
    write("repo/docs/b.md", "doc b\n@../cc.md"); // cycle back to root

    const loaded = loadProjectInstructions({
      cwd: path.join(tmp, "repo"),
      home,
    });
    expect(loaded.files.map((f) => path.basename(f.path))).toEqual([
      "cc.md",
      "a.md",
      "b.md",
    ]);
    expect(loaded.files[1].scope).toBe("import");
    expect(loaded.warnings).toEqual([]);
  });

  it("ignores decorative @tokens that are not files (npm scopes)", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "use @chainlesschain/personal-data-hub for sync");
    const loaded = loadProjectInstructions({
      cwd: path.join(tmp, "repo"),
      home,
    });
    expect(loaded.files).toHaveLength(1);
    expect(loaded.warnings).toEqual([]);
  });

  it("truncates oversized files and flags them", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "x".repeat(100));
    const loaded = loadProjectInstructions({
      cwd: path.join(tmp, "repo"),
      home,
      maxFileBytes: 10,
    });
    expect(loaded.files[0].truncated).toBe(true);
    expect(loaded.files[0].content).toBe("x".repeat(10));
    expect(loaded.files[0].bytes).toBe(100);
  });

  it("stops at the total-bytes budget with a warning", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "a".repeat(50) + "\n@big.md");
    write("repo/big.md", "b".repeat(50));
    const loaded = loadProjectInstructions({
      cwd: path.join(tmp, "repo"),
      home,
      maxTotalBytes: 40,
    });
    expect(loaded.files).toHaveLength(1);
    expect(loaded.warnings.join(" ")).toMatch(/budget/);
  });
});

describe("path-scoped rules (.claude/rules)", () => {
  it("parseRuleFrontmatter handles dash-lists, inline values and no frontmatter", () => {
    const fm = parseRuleFrontmatter(
      '---\npaths:\n  - "desktop-app-vue/**"\n  - packages/cli/**\n---\n# Body here',
    );
    expect(fm.globs).toEqual(["desktop-app-vue/**", "packages/cli/**"]);
    expect(fm.body).toBe("# Body here");
    expect(parseRuleFrontmatter('---\nglobs: "backend/**"\n---\nX').globs).toEqual(
      ["backend/**"],
    );
    expect(parseRuleFrontmatter("plain body").globs).toEqual([]);
  });

  it("ruleApplies uses prefix-overlap semantics", () => {
    expect(ruleApplies([], "anything")).toBe(true);
    expect(ruleApplies(["packages/cli/**"], "")).toBe(true); // at root
    expect(ruleApplies(["packages/cli/**"], "packages/cli")).toBe(true);
    expect(ruleApplies(["packages/cli/**"], "packages/cli/src")).toBe(true);
    expect(ruleApplies(["packages/cli/**"], "packages")).toBe(true); // above
    expect(ruleApplies(["packages/cli/**"], "desktop-app-vue")).toBe(false);
    expect(ruleApplies(["**/*.test.js"], "anywhere/deep")).toBe(true); // prefixless
  });

  it("loads matching rules with frontmatter stripped, skips out-of-scope ones", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "root memory");
    write(
      "repo/.claude/rules/cli.md",
      '---\npaths:\n  - "packages/cli/**"\n---\nCLI RULE BODY',
    );
    write(
      "repo/.claude/rules/desktop.md",
      '---\npaths:\n  - "desktop-app-vue/**"\n---\nDESKTOP RULE BODY',
    );
    write("repo/.claude/rules/always.md", "ALWAYS RULE");
    fs.mkdirSync(path.join(tmp, "repo", "packages", "cli"), {
      recursive: true,
    });

    const loaded = loadProjectInstructions({
      cwd: path.join(tmp, "repo", "packages", "cli"),
      home,
    });
    const all = loaded.files.map((f) => f.content).join("\n");
    expect(all).toContain("CLI RULE BODY");
    expect(all).not.toContain("paths:"); // frontmatter stripped
    expect(all).toContain("ALWAYS RULE");
    expect(all).not.toContain("DESKTOP RULE BODY");

    // at the project root, every rule is in play
    const atRoot = loadProjectInstructions({ cwd: path.join(tmp, "repo"), home });
    expect(atRoot.files.map((f) => f.content).join("\n")).toContain(
      "DESKTOP RULE BODY",
    );
  });
});

describe("renderProjectInstructionsBlock", () => {
  it("returns '' for nothing loaded", () => {
    expect(renderProjectInstructionsBlock({ files: [] })).toBe("");
    expect(renderProjectInstructionsBlock(null)).toBe("");
  });

  it("renders file blocks with path + scope attrs", () => {
    const block = renderProjectInstructionsBlock({
      files: [
        {
          path: "C:\\x\\cc.md",
          scope: "project",
          content: "RULES",
          bytes: 5,
          truncated: false,
        },
      ],
    });
    expect(block).toContain("<project-instructions");
    expect(block).toContain('scope="project"');
    expect(block).toContain("RULES");
    expect(block).toContain("</project-instructions>");
  });
});

describe("composeSystemPrompt projectMemory wiring", () => {
  it("injects the block when projectMemory: true", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "ALWAYS USE TABS");
    const out = composeSystemPrompt("BASE", {
      projectMemory: true,
      cwd: path.join(tmp, "repo"),
      projectMemoryHome: home,
    });
    expect(out.startsWith("BASE\n\n<project-instructions")).toBe(true);
    expect(out).toContain("ALWAYS USE TABS");
  });

  it("keeps project memory before appendSystemPrompt and outputStyle", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "MEMORY");
    const out = composeSystemPrompt("BASE", {
      projectMemory: true,
      cwd: path.join(tmp, "repo"),
      projectMemoryHome: home,
      appendSystemPrompt: "EXTRA",
      outputStyle: "STYLE",
    });
    expect(out.indexOf("MEMORY")).toBeLessThan(out.indexOf("EXTRA"));
    expect(out.indexOf("EXTRA")).toBeLessThan(out.indexOf("STYLE"));
  });

  it("explicit true wins over CC_PROJECT_MEMORY=0", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "MEMORY");
    const prev = process.env.CC_PROJECT_MEMORY;
    process.env.CC_PROJECT_MEMORY = "0";
    try {
      const out = composeSystemPrompt("BASE", {
        projectMemory: true,
        cwd: path.join(tmp, "repo"),
        projectMemoryHome: home,
      });
      expect(out).toContain("MEMORY");
    } finally {
      if (prev === undefined) delete process.env.CC_PROJECT_MEMORY;
      else process.env.CC_PROJECT_MEMORY = prev;
    }
  });

  it("projectMemory: false suppresses the block", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    write("repo/cc.md", "MEMORY");
    const out = composeSystemPrompt("BASE", {
      projectMemory: false,
      cwd: path.join(tmp, "repo"),
      projectMemoryHome: home,
    });
    expect(out).toBe("BASE");
  });

  it("implicit default stays pure under vitest (legacy contract)", () => {
    // process.env.VITEST is set by the runner — no block without explicit opt.
    expect(composeSystemPrompt("BASE", {})).toBe("BASE");
  });

  it("loadProjectInstructionsBlock returns '' when nothing exists", () => {
    fs.mkdirSync(path.join(tmp, "empty"), { recursive: true });
    expect(
      loadProjectInstructionsBlock({ cwd: path.join(tmp, "empty"), home }),
    ).toBe("");
  });
});
