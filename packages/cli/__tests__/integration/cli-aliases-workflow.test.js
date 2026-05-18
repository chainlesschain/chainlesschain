import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const binScript = join(cliRoot, "bin", "chainlesschain.js");

/**
 * Integration tests for CLI aliases (cc, clc).
 *
 * Verifies that the same bin script works correctly when invoked via
 * different aliases by simulating how npm links work — all aliases
 * point to the same script, so `node bin/chainlesschain.js` is the
 * canonical test method.
 */
describe("CLI aliases integration", () => {
  const runCli = (args) => {
    return execSync(`node "${binScript}" ${args}`, {
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  };

  describe("--version works for all alias entry points", () => {
    it("outputs a valid semver version", () => {
      const result = runCli("--version");
      expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("--help output is consistent", () => {
    it("shows all core commands", () => {
      const result = runCli("--help");
      expect(result).toContain("setup");
      expect(result).toContain("start");
      expect(result).toContain("stop");
      expect(result).toContain("status");
      expect(result).toContain("doctor");
      expect(result).toContain("agent");
      expect(result).toContain("chat");
    });
  });

  describe("subcommands work through the shared entry point", () => {
    it("config list works", () => {
      const result = runCli("config list");
      expect(result).toContain("setupCompleted");
    });

    it("skill list works", () => {
      const result = runCli("skill list");
      // skill list outputs bundled skills or empty list
      expect(typeof result).toBe("string");
    });

    it("llm providers works", () => {
      const result = runCli("llm providers");
      expect(result).toContain("ollama");
    });
  });

  describe("npm bin symlink simulation", () => {
    it("script is executable via node regardless of cwd", () => {
      // Simulate running from a different directory (like npm global bin)
      const result = execSync(`node "${binScript}" --version`, {
        encoding: "utf-8",
        timeout: 10000,
        cwd: process.env.TEMP || "/tmp",
      });
      expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
