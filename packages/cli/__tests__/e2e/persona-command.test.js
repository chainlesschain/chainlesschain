import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
