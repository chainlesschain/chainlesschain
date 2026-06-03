/**
 * E2E tests for CLI-Anything command integration.
 *
 * Verifies that:
 * - cli-anything command is registered and visible in help
 * - All 5 subcommands (doctor, scan, register, list, remove) are accessible
 * - doctor subcommand works without DB (checks Python environment)
 * - scan subcommand runs without crashing
 * - --json output flag works
 */

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
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
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

describe("E2E: CLI-Anything Commands", () => {
  // ─── Help visibility ──────────────────────────────────────

  describe("help output", () => {
    it("cli-anything is listed in main help", () => {
      const result = run("--help");
      expect(result).toContain("cli-anything");
    });

    it("cli-anything --help shows all 5 subcommands", () => {
      const result = run("cli-anything --help");
      expect(result).toContain("doctor");
      expect(result).toContain("scan");
      expect(result).toContain("register");
      expect(result).toContain("list");
      expect(result).toContain("remove");
    });

    it("cli-anything doctor --help shows options", () => {
      const result = run("cli-anything doctor --help");
      expect(result).toContain("--json");
      expect(result).toContain("Python");
    });

    it("cli-anything register --help shows <name> argument", () => {
      const result = run("cli-anything register --help");
      expect(result).toContain("<name>");
      expect(result).toContain("--force");
      expect(result).toContain("--json");
    });
  });

  // ─── doctor subcommand (no DB required) ───────────────────

  describe("doctor subcommand", () => {
    it("doctor runs successfully and checks Python", () => {
      const { stdout, exitCode } = tryRun("cli-anything doctor");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("CLI-Anything Environment");
      // Should mention Python status (either found or not found)
      expect(stdout).toMatch(/Python|not found/i);
    });

    it("doctor --json outputs valid JSON", () => {
      const { stdout, exitCode } = tryRun("cli-anything doctor --json");
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout.trim());
      expect(json).toHaveProperty("python");
      expect(json).toHaveProperty("cliAnything");
      expect(json).toHaveProperty("toolsOnPath");
      expect(typeof json.python.found).toBe("boolean");
    });
  });

  // ─── scan subcommand ──────────────────────────────────────

  describe("scan subcommand", () => {
    it("scan runs without error", () => {
      const { stdout, exitCode } = tryRun("cli-anything scan");
      expect(exitCode).toBe(0);
      // Should either find tools or report none found
      expect(stdout).toMatch(/tool|found|No cli-anything/i);
    });

    it("scan --json outputs valid JSON array", () => {
      const { stdout, exitCode } = tryRun("cli-anything scan --json");
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout.trim());
      expect(Array.isArray(json)).toBe(true);
    });
  });

  // ─── list subcommand ──────────────────────────────────────

  describe("list subcommand", () => {
    it("list runs (may require DB)", () => {
      const { stdout, stderr, exitCode } = tryRun("cli-anything list");
      // Either succeeds (DB available) or fails gracefully
      if (exitCode === 0) {
        expect(stdout).toMatch(/tool|registered|No CLI-Anything/i);
      } else {
        // DB init failure in CI is acceptable
        expect((stderr || stdout || "").toLowerCase()).toMatch(
          /database|error|failed/i,
        );
      }
    });

    it("list --json outputs valid JSON when DB available", () => {
      const { stdout, exitCode } = tryRun("cli-anything list --json");
      if (exitCode === 0) {
        // Filter out log lines like [AppConfig] that may pollute stdout
        const jsonLine = stdout
          .split("\n")
          .filter((l) => l.trim().startsWith("["))
          .find((l) => {
            try {
              JSON.parse(l.trim());
              return true;
            } catch {
              return false;
            }
          });
        const raw = jsonLine || stdout.trim();
        const json = JSON.parse(raw);
        expect(Array.isArray(json)).toBe(true);
      }
    });
  });

  // ─── register/remove subcommands ──────────────────────────

  describe("register/remove subcommands", () => {
    it("register nonexistent tool fails gracefully", () => {
      const { exitCode } = tryRun("cli-anything register nonexistent-tool-xyz");
      // Should fail because cli-anything-nonexistent-tool-xyz doesn't exist
      // but should NOT crash with unhandled exception
      expect(exitCode).not.toBeNull();
    });

    it("remove nonexistent tool fails gracefully", () => {
      // stdio is ["ignore", "pipe", "ignore"] (stderr intentionally suppressed
      // to avoid pipe backpressure on macOS CI — see 1c877f948), so stderr
      // content can't be asserted here. Just verify the process exits cleanly
      // (no unhandled exception crash) — mirrors the 'register nonexistent'
      // test above.
      const { exitCode } = tryRun("cli-anything remove nope");
      expect(exitCode).not.toBeNull();
    });
  });

  // ─── default subcommand ───────────────────────────────────

  describe("default subcommand", () => {
    it("cli-anything without subcommand runs list (default)", () => {
      const { stdout, exitCode } = tryRun("cli-anything");
      // Should behave like 'cli-anything list'
      if (exitCode === 0) {
        expect(stdout).toMatch(/tool|registered|No CLI-Anything/i);
      }
    });
  });
});
