/**
 * cc init — default inventory mode (cc.md generation) + project-inventory lib.
 *
 * Default `cc init` now inventories the folder and writes cc.md; template
 * scaffolding only on explicit -t/--bare (web-panel always passes
 * `--template X --yes`, so its call site is unaffected).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import fs from "fs";
import os from "os";
import path from "path";

import {
  inventoryProject,
  renderMemoryFile,
  readmeSynopsis,
} from "../../src/lib/project-inventory.js";
import { registerInitCommand } from "../../src/commands/init.js";

let tmp;

function write(rel, content) {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

async function runInit(args) {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  await program.parseAsync(["node", "cc", "init", ...args]);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-init-inv-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("readmeSynopsis", () => {
  it("returns the first prose paragraph, skipping headings and badges", () => {
    const text = [
      "# Title",
      "![badge](x.svg)",
      "",
      "A decentralized AI system.",
      "Second sentence.",
      "",
      "More below.",
    ].join("\n");
    expect(readmeSynopsis(text)).toBe(
      "A decentralized AI system. Second sentence.",
    );
  });

  it("returns null for empty/heading-only files", () => {
    expect(readmeSynopsis("# Only title\n")).toBeNull();
    expect(readmeSynopsis(null)).toBeNull();
  });
});

describe("inventoryProject", () => {
  it("captures package manager, scripts, workspaces, languages and configs", () => {
    write(
      "package.json",
      JSON.stringify({
        name: "demo-app",
        description: "Demo",
        scripts: { dev: "vite", test: "vitest run" },
        workspaces: ["packages/*"],
      }),
    );
    write("package-lock.json", "{}");
    write("tsconfig.json", "{}");
    write("src/a.ts", "export {};");
    write("src/b.ts", "export {};");
    write("src/c.js", "module.exports = {};");
    write("README.md", "# demo\n\nDoes demo things.\n");
    fs.mkdirSync(path.join(tmp, ".github", "workflows"), { recursive: true });
    write(".github/workflows/ci.yml", "name: ci");

    const inv = inventoryProject(tmp);
    expect(inv.name).toBe("demo-app");
    expect(inv.packageManager).toBe("npm");
    expect(inv.workspaces).toEqual(["packages/*"]);
    expect(inv.scripts.map(([n]) => n)).toEqual(["dev", "test"]);
    expect(inv.configs).toContain("TypeScript");
    expect(inv.ciWorkflows).toBe(1);
    expect(inv.synopsis).toBe("Does demo things.");
    const langMap = Object.fromEntries(inv.languages);
    expect(langMap.TypeScript).toBe(2);
    expect(langMap.JavaScript).toBe(1);
  });

  it("skips node_modules and dot-dirs in the census", () => {
    write("node_modules/dep/index.js", "x");
    write(".hidden/file.js", "x");
    write("src/real.js", "x");
    const inv = inventoryProject(tmp);
    const langMap = Object.fromEntries(inv.languages);
    expect(langMap.JavaScript).toBe(1);
  });

  it("falls back to the folder name without package.json", () => {
    write("main.py", "print('hi')");
    const inv = inventoryProject(tmp);
    expect(inv.name).toBe(path.basename(tmp));
    expect(Object.fromEntries(inv.languages).Python).toBe(1);
  });
});

describe("renderMemoryFile", () => {
  it("renders overview, stack, commands and layout sections", () => {
    write(
      "package.json",
      JSON.stringify({
        name: "demo-app",
        scripts: { dev: "vite" },
      }),
    );
    write("package-lock.json", "{}");
    write("src/a.ts", "export {};");
    const md = renderMemoryFile(inventoryProject(tmp), {
      date: "2026-06-11",
    });
    expect(md).toContain("# demo-app — Project Memory");
    expect(md).toContain("2026-06-11");
    expect(md).toContain("`npm run dev` — `vite`");
    expect(md).toContain("TypeScript (1)");
    expect(md).toContain("## Conventions");
  });
});

describe("anti-shadowing: existing memory imported", () => {
  it("renderMemoryFile emits @-imports for existing CLAUDE.md/AGENTS.md", () => {
    write("CLAUDE.md", "# hand-maintained");
    write("package.json", JSON.stringify({ name: "shadow-test" }));
    const md = renderMemoryFile(inventoryProject(tmp));
    expect(md).toContain("## Existing project memory (imported)");
    expect(md).toContain("@CLAUDE.md");
  });

  it("generated cc.md + loader = both cc.md and CLAUDE.md content reach the agent", async () => {
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    write("CLAUDE.md", "HAND-MAINTAINED-RULE");
    write("package.json", JSON.stringify({ name: "roundtrip" }));
    await runInit(["--cwd", tmp]);
    const { loadProjectInstructions } = await import(
      "../../src/lib/project-instructions.js"
    );
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-init-home-"));
    try {
      const loaded = loadProjectInstructions({ cwd: tmp, home: emptyHome });
      const all = loaded.files.map((f) => f.content).join("\n");
      expect(all).toContain("roundtrip — Project Memory"); // cc.md itself
      expect(all).toContain("HAND-MAINTAINED-RULE"); // imported CLAUDE.md
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});

describe("cc init default (inventory mode)", () => {
  it("writes cc.md plus a minimal .chainlesschain/ (skills home)", async () => {
    write("package.json", JSON.stringify({ name: "inv-default" }));
    await runInit(["--cwd", tmp]);
    const target = path.join(tmp, "cc.md");
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toContain("inv-default");
    const cfg = JSON.parse(
      fs.readFileSync(path.join(tmp, ".chainlesschain", "config.json"), "utf-8"),
    );
    expect(cfg.template).toBe("none");
    expect(cfg.memoryFile).toBe("cc.md");
    expect(
      fs.statSync(path.join(tmp, ".chainlesschain", "skills")).isDirectory(),
    ).toBe(true);
    // no template rules.md in inventory mode — cc.md is the memory
    expect(fs.existsSync(path.join(tmp, ".chainlesschain", "rules.md"))).toBe(
      false,
    );
  });

  it("leaves an existing .chainlesschain/config.json untouched", async () => {
    write(".chainlesschain/config.json", JSON.stringify({ template: "code-project" }));
    write("package.json", JSON.stringify({ name: "inv-existing-cfg" }));
    await runInit(["--cwd", tmp, "--force"]);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(tmp, ".chainlesschain", "config.json"), "utf-8"),
    );
    expect(cfg.template).toBe("code-project");
    expect(fs.existsSync(path.join(tmp, "cc.md"))).toBe(true);
  });

  it("--force overwrites an existing cc.md", async () => {
    write("cc.md", "OLD CONTENT");
    write("package.json", JSON.stringify({ name: "inv-force" }));
    await runInit(["--cwd", tmp, "--force"]);
    const md = fs.readFileSync(path.join(tmp, "cc.md"), "utf-8");
    expect(md).not.toContain("OLD CONTENT");
    expect(md).toContain("inv-force");
  });

  it("--memory wins even when a template flag is present", async () => {
    write("package.json", JSON.stringify({ name: "inv-memory-wins" }));
    await runInit(["--cwd", tmp, "--memory", "-t", "empty", "--yes"]);
    expect(fs.existsSync(path.join(tmp, "cc.md"))).toBe(true);
    // inventory-mode minimal config, not the template scaffold (no rules.md)
    expect(fs.existsSync(path.join(tmp, ".chainlesschain", "rules.md"))).toBe(
      false,
    );
    const cfg = JSON.parse(
      fs.readFileSync(path.join(tmp, ".chainlesschain", "config.json"), "utf-8"),
    );
    expect(cfg.template).toBe("none");
  });
});

describe("cc init explicit template (scaffold mode preserved)", () => {
  it("-t empty --yes scaffolds .chainlesschain/ and writes no cc.md (web-panel call shape)", async () => {
    await runInit(["--template", "empty", "--yes", "--cwd", tmp]);
    expect(
      fs.existsSync(path.join(tmp, ".chainlesschain", "config.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmp, "cc.md"))).toBe(false);
  });

  it("--bare scaffolds too", async () => {
    await runInit(["--bare", "--cwd", tmp]);
    expect(
      fs.existsSync(path.join(tmp, ".chainlesschain", "config.json")),
    ).toBe(true);
  });
});
