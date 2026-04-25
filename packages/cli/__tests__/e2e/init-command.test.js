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

  // ─── ai-media-creator template ───────────────────

  describe("init --template ai-media-creator", () => {
    it("creates ai-media-creator template with persona and media skills", () => {
      run("init --template ai-media-creator --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("ai-media-creator");
      expect(config.persona).toBeDefined();
      expect(config.persona.name).toBe("AI创作助手");
      expect(typeof config.persona.role).toBe("string");
      expect(config.persona.role.length).toBeGreaterThan(0);
      expect(config.persona.behaviors).toBeInstanceOf(Array);
      expect(config.persona.behaviors.length).toBeGreaterThan(0);
    });

    it("generates comfyui-image workspace skill with SKILL.md and handler.js", () => {
      run("init --template ai-media-creator --yes", { cwd: tempDir });

      const skillDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "comfyui-image",
      );
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "handler.js"))).toBe(true);

      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("name: comfyui-image");
      expect(skillMd).toContain("category: media");
      expect(skillMd).toContain("execution-mode: direct");
    });

    it("generates comfyui-video workspace skill with SKILL.md and handler.js", () => {
      run("init --template ai-media-creator --yes", { cwd: tempDir });

      const skillDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "comfyui-video",
      );
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "handler.js"))).toBe(true);

      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("name: comfyui-video");
      expect(skillMd).toContain("category: media");
      expect(skillMd).toContain("AnimateDiff");
    });

    it("generates audio-gen workspace skill with SKILL.md and handler.js", () => {
      run("init --template ai-media-creator --yes", { cwd: tempDir });

      const skillDir = join(tempDir, ".chainlesschain", "skills", "audio-gen");
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "handler.js"))).toBe(true);

      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("name: audio-gen");
      expect(skillMd).toContain("category: media");
      expect(skillMd).toContain("edge-tts");
    });

    it("creates workflows/ directory with README.md", () => {
      run("init --template ai-media-creator --yes", { cwd: tempDir });

      const workflowsDir = join(tempDir, "workflows");
      expect(existsSync(workflowsDir)).toBe(true);
      expect(existsSync(join(workflowsDir, "README.md"))).toBe(true);

      const readme = readFileSync(join(workflowsDir, "README.md"), "utf-8");
      expect(readme).toContain("ComfyUI");
      expect(readme).toContain("cli-anything");
    });

    it("creates ai-media-creator-persona auto-activated skill", () => {
      run("init --template ai-media-creator --yes", { cwd: tempDir });

      const personaDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "ai-media-creator-persona",
      );
      expect(existsSync(personaDir)).toBe(true);
      const skillMd = readFileSync(join(personaDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("category: persona");
      expect(skillMd).toContain("activation: auto");
      expect(skillMd).toContain("AI创作助手");
    });

    it("rules.md contains ComfyUI and cli-anything guidance", () => {
      run("init --template ai-media-creator --yes", { cwd: tempDir });

      const rules = readFileSync(
        join(tempDir, ".chainlesschain", "rules.md"),
        "utf-8",
      );
      expect(rules).toContain("ComfyUI");
      expect(rules).toContain("cli-anything");
      expect(rules).toContain("edge-tts");
    });
  });

  // ─── ai-doc-creator template ──────────────────────

  describe("init --template ai-doc-creator", () => {
    it("creates ai-doc-creator template with persona and doc skills", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const config = JSON.parse(
        readFileSync(join(tempDir, ".chainlesschain", "config.json"), "utf-8"),
      );
      expect(config.template).toBe("ai-doc-creator");
      expect(config.persona).toBeDefined();
      expect(config.persona.name).toBe("AI文档助手");
      expect(typeof config.persona.role).toBe("string");
      expect(config.persona.role).toContain("文档");
      expect(config.persona.behaviors).toBeInstanceOf(Array);
      expect(config.persona.behaviors.length).toBeGreaterThanOrEqual(3);
    });

    it("generates doc-generate workspace skill with SKILL.md and handler.js", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const skillDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "doc-generate",
      );
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "handler.js"))).toBe(true);

      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("name: doc-generate");
      expect(skillMd).toContain("category: document");
      expect(skillMd).toContain("execution-mode: direct");
      expect(skillMd).toContain("pandoc");
      expect(skillMd).toContain("soffice");
    });

    it("generates libre-convert workspace skill with SKILL.md and handler.js", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const skillDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "libre-convert",
      );
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "handler.js"))).toBe(true);

      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("name: libre-convert");
      expect(skillMd).toContain("category: document");
      expect(skillMd).toContain("cli-anything register soffice");
    });

    it("creates templates/ directory (not workflows/) with README.md", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const templatesDir = join(tempDir, "templates");
      expect(existsSync(templatesDir)).toBe(true);
      expect(existsSync(join(templatesDir, "README.md"))).toBe(true);
      // workflows/ should NOT be created
      expect(existsSync(join(tempDir, "workflows"))).toBe(false);

      const readme = readFileSync(join(templatesDir, "README.md"), "utf-8");
      expect(readme).toContain("doc-generate");
      expect(readme).toContain("libre-convert");
      expect(readme).toContain("cli-anything");
      expect(readme).toContain("pandoc");
    });

    it("creates ai-doc-creator-persona auto-activated skill", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const personaDir = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "ai-doc-creator-persona",
      );
      expect(existsSync(personaDir)).toBe(true);
      const skillMd = readFileSync(join(personaDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("category: persona");
      expect(skillMd).toContain("activation: auto");
      expect(skillMd).toContain("AI文档助手");
    });

    it("rules.md contains LibreOffice and cli-anything guidance", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const rules = readFileSync(
        join(tempDir, ".chainlesschain", "rules.md"),
        "utf-8",
      );
      expect(rules).toContain("LibreOffice");
      expect(rules).toContain("cli-anything");
      expect(rules).toContain("pandoc");
    });

    it("init output shows AI Doc Setup instructions", () => {
      const output = run("init --template ai-doc-creator --yes", {
        cwd: tempDir,
      });
      expect(output).toContain("doc-generate");
      expect(output).toContain("libre-convert");
    });

    it("generates doc-edit workspace skill with SKILL.md and handler.js", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const skillDir = join(tempDir, ".chainlesschain", "skills", "doc-edit");
      expect(existsSync(skillDir)).toBe(true);
      const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("name: doc-edit");
      expect(skillMd).toContain("input_file");
      expect(skillMd).toContain("instruction");
      expect(existsSync(join(skillDir, "handler.js"))).toBe(true);
    });

    it("doc-edit handler.js contains openpyxl (xlsx structure preservation marker)", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const handlerPath = join(
        tempDir,
        ".chainlesschain",
        "skills",
        "doc-edit",
        "handler.js",
      );
      const content = readFileSync(handlerPath, "utf-8");
      expect(content).toContain("openpyxl");
      expect(content).toContain("data_only=False");
    });

    it("doc-edit SKILL.md documents _edited output naming convention", () => {
      run("init --template ai-doc-creator --yes", { cwd: tempDir });

      const skillMd = readFileSync(
        join(tempDir, ".chainlesschain", "skills", "doc-edit", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("_edited");
    });
  });
});
