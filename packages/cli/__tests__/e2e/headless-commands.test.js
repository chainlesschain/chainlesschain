import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

describe("E2E: headless CLI commands", () => {
  describe("--help for new commands", () => {
    it("skill --help shows subcommands", () => {
      const result = run("skill --help");
      expect(result).toContain("list");
      expect(result).toContain("categories");
      expect(result).toContain("info");
      expect(result).toContain("search");
      expect(result).toContain("run");
    });

    it("db --help shows subcommands", () => {
      const result = run("db --help");
      expect(result).toContain("init");
      expect(result).toContain("info");
      expect(result).toContain("backup");
      expect(result).toContain("restore");
    });

    it("note --help shows subcommands", () => {
      const result = run("note --help");
      expect(result).toContain("add");
      expect(result).toContain("list");
      expect(result).toContain("show");
      expect(result).toContain("search");
      expect(result).toContain("delete");
      expect(result).toContain("history");
      expect(result).toContain("diff");
      expect(result).toContain("revert");
    });

    it("llm --help shows subcommands", () => {
      const result = run("llm --help");
      expect(result).toContain("models");
      expect(result).toContain("test");
    });

    it("ask --help shows options", () => {
      const result = run("ask --help");
      expect(result).toContain("question");
      expect(result).toContain("--model");
      expect(result).toContain("--provider");
      expect(result).toContain("--json");
    });

    it("chat --help shows options", () => {
      const result = run("chat --help");
      expect(result).toContain("--model");
      expect(result).toContain("--provider");
      expect(result).toContain("--agent");
    });

    it("agent --help shows options", () => {
      const result = run("agent --help");
      expect(result).toContain("--model");
      expect(result).toContain("--provider");
      expect(result).toContain("agentic AI session");
    });
  });

  describe("skill commands (no external deps)", () => {
    it("skill list --json returns valid JSON array", () => {
      const result = run("skill list --json");
      const jsonStr = result.substring(result.indexOf("["));
      const skills = JSON.parse(jsonStr);
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBe(138);
    });

    it("skill categories shows category breakdown", () => {
      const result = run("skill categories");
      expect(result).toContain("development");
      expect(result).toContain("skills");
    });

    it("skill info code-review --json returns valid JSON", () => {
      const result = run("skill info code-review --json");
      const info = JSON.parse(result);
      expect(info.id).toBe("code-review");
      expect(info.category).toBe("development");
      expect(info.hasHandler).toBe(true);
    });

    it("skill search translate finds results", () => {
      const result = run("skill search translate");
      expect(result).toContain("translate");
      expect(result).toContain("Search results");
    });

    it("skill search nonexistentxyz shows no results", () => {
      const result = run("skill search nonexistentxyz");
      expect(result).toContain("No skills matching");
    });
  });

  describe("main help includes all commands", () => {
    it("--help lists all 29 commands", () => {
      const result = run("--help");
      const expectedCommands = [
        "setup",
        "start",
        "stop",
        "status",
        "services",
        "config",
        "update",
        "doctor",
        "db",
        "note",
        "chat",
        "ask",
        "llm",
        "agent",
        "skill",
        // Phase 1 commands
        "search",
        "tokens",
        "memory",
        "session",
        // Phase 2 commands
        "import",
        "export",
        "git",
        // Phase 3 commands
        "mcp",
        "browse",
        "instinct",
        // Phase 4 commands
        "did",
        "encrypt",
        "auth",
        "audit",
      ];
      for (const cmd of expectedCommands) {
        expect(result).toContain(cmd);
      }
    });
  });

  describe("version output", () => {
    it("--version returns semver format", () => {
      const result = run("--version");
      expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
