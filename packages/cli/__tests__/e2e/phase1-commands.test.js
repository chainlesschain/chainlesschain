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

function tryRun(args) {
  try {
    return { stdout: run(args), exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
}

describe("E2E: Phase 1 commands", () => {
  // ── search ──

  describe("search --help", () => {
    it("shows search command help", () => {
      const result = run("search --help");
      expect(result).toContain("query");
      expect(result).toContain("--mode");
      expect(result).toContain("--top-k");
    });

    it("shows mode options", () => {
      const result = run("search --help");
      expect(result).toContain("bm25");
    });
  });

  // ── tokens ──

  describe("tokens --help", () => {
    it("shows tokens command help", () => {
      const result = run("tokens --help");
      expect(result).toContain("token usage");
    });

    it("lists subcommands", () => {
      const result = run("tokens --help");
      expect(result).toContain("show");
      expect(result).toContain("breakdown");
      expect(result).toContain("recent");
      expect(result).toContain("cache");
    });
  });

  // ── memory ──

  describe("memory --help", () => {
    it("shows memory command help", () => {
      const result = run("memory --help");
      expect(result).toContain("memory");
    });

    it("lists subcommands", () => {
      const result = run("memory --help");
      expect(result).toContain("show");
      expect(result).toContain("add");
      expect(result).toContain("search");
      expect(result).toContain("delete");
      expect(result).toContain("daily");
      expect(result).toContain("file");
    });
  });

  // ── session ──

  describe("session --help", () => {
    it("shows session command help", () => {
      const result = run("session --help");
      expect(result).toContain("session");
    });

    it("lists subcommands", () => {
      const result = run("session --help");
      expect(result).toContain("list");
      expect(result).toContain("show");
      expect(result).toContain("resume");
      expect(result).toContain("export");
      expect(result).toContain("delete");
    });
  });

  // ── Main help includes Phase 1 commands ──

  describe("main help includes Phase 1 commands", () => {
    it("--help lists search, tokens, memory, session", () => {
      const result = run("--help");
      expect(result).toContain("search");
      expect(result).toContain("tokens");
      expect(result).toContain("memory");
      expect(result).toContain("session");
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
