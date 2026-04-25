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
