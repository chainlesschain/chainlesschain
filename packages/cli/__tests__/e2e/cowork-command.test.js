import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { testHome } from "./_helpers/cli-e2e.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

// Isolated CHAINLESSCHAIN_HOME so every spawned `cc` opens its own bootstrap DB
// rather than contending on the shared %APPDATA% one. Without this, the
// DB-recovery path leaks "[AppConfig]/[DatabaseManager]" onto stdout under load
// and intermittently corrupts these `--help` output assertions.
const h = testHome("cowork");
afterAll(() => h.cleanup());

function run(args, options = {}) {
  return execSync(`node ${bin} ${args}`, {
    encoding: "utf-8",
    timeout: 30000,
    stdio: "pipe",
    env: h.env(),
    ...options,
  });
}

describe("E2E: cowork command", () => {
  describe("cowork --help", () => {
    it("shows cowork command help", () => {
      const result = run("cowork --help");
      expect(result).toContain("Multi-agent");
      expect(result).toContain("debate");
      expect(result).toContain("compare");
      expect(result).toContain("analyze");
      expect(result).toContain("status");
    });
  });

  describe("cowork status", () => {
    it("shows available commands", () => {
      const result = run("cowork status");
      expect(result).toContain("Cowork Status");
      expect(result).toContain("cowork debate");
      expect(result).toContain("cowork compare");
      expect(result).toContain("cowork analyze");
    });
  });

  describe("cowork debate --help", () => {
    it("shows debate subcommand options", () => {
      const result = run("cowork debate --help");
      expect(result).toContain("--perspectives");
      expect(result).toContain("--provider");
      expect(result).toContain("--model");
      expect(result).toContain("--json");
    });
  });

  describe("cowork compare --help", () => {
    it("shows compare subcommand options", () => {
      const result = run("cowork compare --help");
      expect(result).toContain("--variants");
      expect(result).toContain("--criteria");
      expect(result).toContain("--provider");
      expect(result).toContain("--json");
    });
  });

  describe("cowork analyze --help", () => {
    it("shows analyze subcommand options", () => {
      const result = run("cowork analyze --help");
      expect(result).toContain("--type");
      expect(result).toContain("--provider");
      expect(result).toContain("--json");
    });
  });
});
