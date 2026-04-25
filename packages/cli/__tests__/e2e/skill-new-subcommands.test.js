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
