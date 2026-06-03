import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args) {
  return execSync(`node ${bin} ${args}`, {
    encoding: "utf-8",
    timeout: 15000,
    stdio: "pipe",
  });
}

describe("E2E: Phase 2 commands", () => {
  // ── import ──

  describe("import --help", () => {
    it("shows import command help", () => {
      const result = run("import --help");
      expect(result).toContain("Import knowledge");
    });

    it("lists subcommands", () => {
      const result = run("import --help");
      expect(result).toContain("markdown");
      expect(result).toContain("evernote");
      expect(result).toContain("notion");
      expect(result).toContain("pdf");
    });
  });

  // ── export ──

  describe("export --help", () => {
    it("shows export command help", () => {
      const result = run("export --help");
      expect(result).toContain("Export knowledge");
    });

    it("lists subcommands", () => {
      const result = run("export --help");
      expect(result).toContain("markdown");
      expect(result).toContain("site");
    });
  });

  // ── git ──

  describe("git --help", () => {
    it("shows git command help", () => {
      const result = run("git --help");
      expect(result).toContain("Git integration");
    });

    it("lists subcommands", () => {
      const result = run("git --help");
      expect(result).toContain("status");
      expect(result).toContain("init");
      expect(result).toContain("auto-commit");
      expect(result).toContain("hooks");
      expect(result).toContain("history-analyze");
    });
  });

  // ── Main help includes Phase 2 commands ──

  describe("main help includes Phase 2 commands", () => {
    it("--help lists import, export, git", () => {
      const result = run("--help");
      expect(result).toContain("import");
      expect(result).toContain("export");
      expect(result).toContain("git");
    });
  });

  // ── Updated command count ──

  describe("command count", () => {
    it("--help lists all 25 commands (15 + 4 Phase1 + 3 Phase2 + 3 Phase3)", () => {
      const result = run("--help");
      const expectedCommands = [
        // Original 15
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
        // Phase 1
        "search",
        "tokens",
        "memory",
        "session",
        // Phase 2
        "import",
        "export",
        "git",
        // Phase 3
        "mcp",
        "browse",
        "instinct",
      ];
      for (const cmd of expectedCommands) {
        expect(result).toContain(cmd);
      }
    });
  });
});
