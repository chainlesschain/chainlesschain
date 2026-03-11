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

describe("E2E: Phase 3 commands", () => {
  // ── mcp ──

  describe("mcp --help", () => {
    it("shows mcp command help", () => {
      const result = run("mcp --help");
      expect(result).toContain("MCP server management");
    });

    it("lists subcommands", () => {
      const result = run("mcp --help");
      expect(result).toContain("servers");
      expect(result).toContain("add");
      expect(result).toContain("remove");
      expect(result).toContain("connect");
      expect(result).toContain("disconnect");
      expect(result).toContain("tools");
      expect(result).toContain("call");
    });
  });

  // ── browse ──

  describe("browse --help", () => {
    it("shows browse command help", () => {
      const result = run("browse --help");
      expect(result).toContain("browser automation");
    });

    it("lists subcommands", () => {
      const result = run("browse --help");
      expect(result).toContain("fetch");
      expect(result).toContain("scrape");
      expect(result).toContain("screenshot");
    });
  });

  // ── instinct ──

  describe("instinct --help", () => {
    it("shows instinct command help", () => {
      const result = run("instinct --help");
      expect(result).toContain("Instinct learning");
    });

    it("lists subcommands", () => {
      const result = run("instinct --help");
      expect(result).toContain("show");
      expect(result).toContain("categories");
      expect(result).toContain("prompt");
      expect(result).toContain("delete");
      expect(result).toContain("reset");
      expect(result).toContain("decay");
    });
  });

  // ── llm enhanced ──

  describe("llm --help (enhanced)", () => {
    it("shows new Phase 3 subcommands", () => {
      const result = run("llm --help");
      expect(result).toContain("providers");
      expect(result).toContain("add-provider");
      expect(result).toContain("switch");
    });
  });

  // ── Main help includes Phase 3 commands ──

  describe("main help includes Phase 3 commands", () => {
    it("--help lists mcp, browse, instinct", () => {
      const result = run("--help");
      expect(result).toContain("mcp");
      expect(result).toContain("browse");
      expect(result).toContain("instinct");
    });
  });

  // ── Updated command count ──

  describe("command count", () => {
    it("--help lists all 25 commands", () => {
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
