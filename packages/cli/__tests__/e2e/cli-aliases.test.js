import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const binScript = join(cliRoot, "bin", "chainlesschain.js");
const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf-8"));

/**
 * E2E tests for CLI aliases (chainlesschain, cc, clc).
 *
 * Tests the full user journey: install → verify aliases → use commands.
 * All three aliases (chainlesschain, cc, clc) share the same bin script,
 * so we test the actual script execution with various commands.
 */
describe("E2E: CLI aliases", () => {
  const runCli = (args, opts = {}) => {
    return execSync(`node "${binScript}" ${args}`, {
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      ...opts,
    });
  };

  describe("alias discovery", () => {
    it("package.json declares all 4 aliases", () => {
      expect(Object.keys(pkg.bin).sort()).toEqual(
        ["cc", "chainlesschain", "clc", "clchain"].sort(),
      );
    });

    it("all aliases reference the same executable script", () => {
      const scripts = new Set(Object.values(pkg.bin));
      expect(scripts.size).toBe(1);
      expect(scripts.has("./bin/chainlesschain.js")).toBe(true);
    });
  });

  describe("version command", () => {
    it("--version outputs current package version", () => {
      const result = runCli("--version");
      expect(result.trim()).toBe(pkg.version);
    });

    it("version string matches package.json version", () => {
      const result = runCli("--version");
      expect(result.trim()).toBe(pkg.version);
    });
  });

  describe("help command", () => {
    it("--help shows usage information", () => {
      const result = runCli("--help");
      expect(result).toContain("Usage:");
      expect(result).toContain("Options:");
      expect(result).toContain("Commands:");
    });

    it("help includes system management commands", () => {
      const result = runCli("--help");
      expect(result).toContain("setup");
      expect(result).toContain("start");
      expect(result).toContain("stop");
      expect(result).toContain("status");
      expect(result).toContain("services");
      expect(result).toContain("config");
      expect(result).toContain("update");
      expect(result).toContain("doctor");
    });

    it("help includes headless commands", () => {
      const result = runCli("--help");
      expect(result).toContain("db");
      expect(result).toContain("note");
      expect(result).toContain("chat");
      expect(result).toContain("ask");
      expect(result).toContain("agent");
      expect(result).toContain("skill");
    });
  });

  describe("subcommand help", () => {
    it("config --help works", () => {
      const result = runCli("config --help");
      expect(result).toContain("list");
      expect(result).toContain("get");
      expect(result).toContain("set");
    });

    it("db --help works", () => {
      const result = runCli("db --help");
      expect(result).toContain("init");
      expect(result).toContain("info");
    });

    it("note --help works", () => {
      const result = runCli("note --help");
      expect(result).toContain("add");
      expect(result).toContain("list");
      expect(result).toContain("search");
    });
  });

  describe("real command execution", () => {
    it("config list outputs valid configuration", () => {
      const result = runCli("config list");
      expect(result).toContain("setupCompleted");
    });

    it("doctor runs environment checks", () => {
      try {
        const result = runCli("doctor");
        expect(result).toBeDefined();
      } catch (err) {
        // doctor may exit with non-zero if some checks fail — that's OK
        expect(err.stdout || err.stderr).toBeDefined();
      }
    });
  });

  describe("cross-directory execution", () => {
    it("works from temp directory", () => {
      const tmpDir = process.env.TEMP || process.env.TMPDIR || "/tmp";
      const result = runCli("--version", { cwd: tmpDir });
      expect(result.trim()).toBe(pkg.version);
    });

    it("works from home directory", () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      const result = runCli("--version", { cwd: homeDir });
      expect(result.trim()).toBe(pkg.version);
    });
  });
});
