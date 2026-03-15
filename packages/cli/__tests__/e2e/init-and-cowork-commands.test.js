import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args, options = {}) {
  return execSync(`node ${bin} ${args}`, {
    encoding: "utf-8",
    timeout: 15000,
    stdio: "pipe",
    ...options,
  });
}

// ─── init command ───────────────────────────────────────

describe("E2E: init command", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-init-e2e-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("init --help", () => {
    it("shows init command help", () => {
      const result = run("init --help");
      expect(result).toContain("Initialize");
      expect(result).toContain("--template");
      expect(result).toContain("--yes");
      expect(result).toContain("--bare");
    });
  });

  describe("init --bare", () => {
    it("creates .chainlesschain/ directory structure", () => {
      run("init --bare", { cwd: tempDir });

      expect(existsSync(join(tempDir, ".chainlesschain"))).toBe(true);
      expect(existsSync(join(tempDir, ".chainlesschain", "config.json"))).toBe(
        true,
      );
      expect(existsSync(join(tempDir, ".chainlesschain", "rules.md"))).toBe(
        true,
      );
      expect(existsSync(join(tempDir, ".chainlesschain", "skills"))).toBe(true);
    });

    it("config.json has correct structure", () => {
      run("init --bare", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.name).toBeTruthy();
      expect(config.template).toBe("empty");
      expect(config.version).toBe("1.0.0");
      expect(config.createdAt).toBeTruthy();
    });

    it("rules.md contains content", () => {
      run("init --bare", { cwd: tempDir });

      const rules = readFileSync(
        join(tempDir, ".chainlesschain", "rules.md"),
        "utf-8",
      );
      expect(rules).toContain("Project Rules");
    });
  });

  describe("init --template", () => {
    it("creates code-project template", () => {
      run("init --template code-project --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("code-project");
    });

    it("creates data-science template", () => {
      run("init --template data-science --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("data-science");

      const rules = readFileSync(
        join(tempDir, ".chainlesschain", "rules.md"),
        "utf-8",
      );
      expect(rules).toContain("Data Handling");
    });

    it("creates devops template", () => {
      run("init --template devops --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("devops");
    });

    it("rejects unknown template", () => {
      expect(() => {
        run("init --template nonexistent --yes", { cwd: tempDir });
      }).toThrow();
    });
  });

  describe("init prevents re-initialization", () => {
    it("fails when .chainlesschain already exists", () => {
      run("init --bare", { cwd: tempDir });
      expect(() => {
        run("init --bare", { cwd: tempDir });
      }).toThrow();
    });
  });

  // ─── persona templates ───────────────────────────

  describe("init --template persona templates", () => {
    it("creates medical-triage template with persona in config", () => {
      run("init --template medical-triage --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("medical-triage");
      expect(config.persona).toBeDefined();
      expect(typeof config.persona.name).toBe("string");
      expect(config.persona.name.length).toBeGreaterThan(0);
      expect(typeof config.persona.role).toBe("string");
      expect(config.persona.role.length).toBeGreaterThan(0);
      expect(config.persona.behaviors).toBeInstanceOf(Array);
      expect(config.persona.behaviors.length).toBeGreaterThan(0);
      expect(config.persona.toolsPriority).toBeInstanceOf(Array);
      expect(config.persona.toolsDisabled).toBeInstanceOf(Array);
    });

    it("creates agriculture-expert template with persona", () => {
      run("init --template agriculture-expert --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("agriculture-expert");
      expect(config.persona).toBeDefined();
      expect(config.persona.name.length).toBeGreaterThan(0);
      expect(config.persona.role.length).toBeGreaterThan(0);
    });

    it("creates general-assistant template with persona", () => {
      run("init --template general-assistant --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("general-assistant");
      expect(config.persona).toBeDefined();
      expect(config.persona.name.length).toBeGreaterThan(0);
      expect(config.persona.role.length).toBeGreaterThan(0);
    });

    it("persona template creates auto-activated persona skill", () => {
      run("init --template medical-triage --yes", { cwd: tempDir });

      const skillDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "medical-triage-persona",
      );
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);

      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("category: persona");
      expect(skillMd).toContain("activation: auto");
      expect(skillMd).toContain("user-invocable: false");
      expect(skillMd).toContain("智能分诊助手");
    });

    it("empty template does NOT create persona", () => {
      run("init --bare", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.persona).toBeUndefined();
    });

    it("code-project template does NOT create persona", () => {
      run("init --template code-project --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.persona).toBeUndefined();
    });
  });
});

// ──��� persona command ────────────────────────────────

describe("E2E: persona command", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-persona-e2e-"));
    // Init a project first
    run("init --bare", { cwd: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("persona --help", () => {
    it("shows persona command help", () => {
      const result = run("persona --help");
      expect(result).toContain("Manage project AI persona");
      expect(result).toContain("show");
      expect(result).toContain("set");
      expect(result).toContain("reset");
    });
  });

  describe("persona show", () => {
    it("shows no persona for bare project", () => {
      const result = run("persona show", { cwd: tempDir });
      expect(result).toContain("No persona configured");
    });

    it("shows persona after set", () => {
      run('persona set --name "Test Bot" --role "You are a test helper"', {
        cwd: tempDir,
      });
      const result = run("persona show", { cwd: tempDir });
      expect(result).toContain("Test Bot");
      expect(result).toContain("You are a test helper");
    });
  });

  describe("persona set", () => {
    it("creates persona in config.json", () => {
      run('persona set --name "My Bot" --role "Helper"', { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.persona.name).toBe("My Bot");
      expect(config.persona.role).toBe("Helper");
    });

    it("sets toolsDisabled", () => {
      run("persona set --tools-disabled run_shell,run_code", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.persona.toolsDisabled).toEqual(["run_shell", "run_code"]);
    });
  });

  describe("persona reset", () => {
    it("removes persona from config", () => {
      run('persona set --name "Temp Bot"', { cwd: tempDir });
      run("persona reset", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.persona).toBeUndefined();
    });

    it("reports nothing to reset on bare project", () => {
      const result = run("persona reset", { cwd: tempDir });
      expect(result).toContain("Nothing to reset");
    });
  });
});

// ─── skill new subcommands ──────────────────────────────

describe("E2E: skill new subcommands", () => {
  describe("skill sources", () => {
    it("shows layer information", () => {
      const result = run("skill sources");
      expect(result).toContain("Skill Source Layers");
      expect(result).toContain("bundled");
      expect(result).toContain("marketplace");
      expect(result).toContain("managed");
      expect(result).toContain("workspace");
    });

    it("outputs JSON with --json", () => {
      const result = run("skill sources --json");
      const layers = JSON.parse(result);
      expect(Array.isArray(layers)).toBe(true);
      expect(layers.length).toBe(4);
      for (const layer of layers) {
        expect(layer).toHaveProperty("layer");
        expect(layer).toHaveProperty("path");
        expect(layer).toHaveProperty("exists");
        expect(layer).toHaveProperty("count");
      }
    });
  });

  describe("skill list with source filter", () => {
    it("filters by bundled source", () => {
      const result = run("skill list --source bundled --json");
      const jsonStr = result.substring(result.indexOf("["));
      const skills = JSON.parse(jsonStr);
      expect(skills.length).toBeGreaterThan(0);
      for (const skill of skills) {
        expect(skill.source).toBe("bundled");
      }
    });
  });

  describe("skill list shows source labels", () => {
    it("each skill in JSON has source field", () => {
      const result = run("skill list --json");
      const jsonStr = result.substring(result.indexOf("["));
      const skills = JSON.parse(jsonStr);
      for (const skill of skills) {
        expect(skill.source).toBeTruthy();
      }
    });
  });

  describe("skill add/remove", () => {
    let tempDir;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "cc-skilladd-e2e-"));
      // Init project first
      run("init --bare", { cwd: tempDir });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("skill add creates skill scaffold in project", () => {
      run("skill add my-test-skill", { cwd: tempDir });

      const skillDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "my-test-skill",
      );
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "handler.js"))).toBe(true);

      // Check SKILL.md content
      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("name: my-test-skill");
    });

    it("skill remove deletes the skill", () => {
      run("skill add delete-me", { cwd: tempDir });
      const skillDir = join(tempDir, ".chainlesschain", "skills", "delete-me");
      expect(existsSync(skillDir)).toBe(true);

      run("skill remove delete-me --force", { cwd: tempDir });
      expect(existsSync(skillDir)).toBe(false);
    });

    it("skill add fails for duplicate name", () => {
      run("skill add dupe-skill", { cwd: tempDir });
      expect(() => {
        run("skill add dupe-skill", { cwd: tempDir });
      }).toThrow();
    });
  });
});

// ─── cowork command ─────────────────────────────────────

describe("E2E: cowork command", () => {
  describe("cowork --help", () => {
    it("shows cowork command help", () => {
      const result = run("cowork --help");
      expect(result).toContain("Multi-agent");
      expect(result).toContain("debate");
      expect(result).toContain("compare");
      expect(result).toContain("analyze");
      expect(result).toContain("status");
    });
  });

  describe("cowork status", () => {
    it("shows available commands", () => {
      const result = run("cowork status");
      expect(result).toContain("Cowork Status");
      expect(result).toContain("cowork debate");
      expect(result).toContain("cowork compare");
      expect(result).toContain("cowork analyze");
    });
  });

  describe("cowork debate --help", () => {
    it("shows debate subcommand options", () => {
      const result = run("cowork debate --help");
      expect(result).toContain("--perspectives");
      expect(result).toContain("--provider");
      expect(result).toContain("--model");
      expect(result).toContain("--json");
    });
  });

  describe("cowork compare --help", () => {
    it("shows compare subcommand options", () => {
      const result = run("cowork compare --help");
      expect(result).toContain("--variants");
      expect(result).toContain("--criteria");
      expect(result).toContain("--provider");
      expect(result).toContain("--json");
    });
  });

  describe("cowork analyze --help", () => {
    it("shows analyze subcommand options", () => {
      const result = run("cowork analyze --help");
      expect(result).toContain("--type");
      expect(result).toContain("--provider");
      expect(result).toContain("--json");
    });
  });
});
