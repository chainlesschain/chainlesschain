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

describe("E2E: Phase 4 commands", () => {
  // ── did ──

  describe("did --help", () => {
    it("shows did command help", () => {
      const result = run("did --help");
      expect(result).toContain("DID");
      expect(result).toContain("identity");
    });

    it("lists subcommands", () => {
      const result = run("did --help");
      expect(result).toContain("create");
      expect(result).toContain("show");
      expect(result).toContain("list");
      expect(result).toContain("resolve");
      expect(result).toContain("sign");
      expect(result).toContain("verify");
      expect(result).toContain("export");
      expect(result).toContain("set-default");
      expect(result).toContain("delete");
    });
  });

  // ── encrypt ──

  describe("encrypt --help", () => {
    it("shows encrypt command help", () => {
      const result = run("encrypt --help");
      expect(result).toContain("encryption");
    });

    it("lists subcommands", () => {
      const result = run("encrypt --help");
      expect(result).toContain("file");
      expect(result).toContain("db");
      expect(result).toContain("info");
      expect(result).toContain("status");
    });
  });

  // ── decrypt ──

  describe("decrypt --help", () => {
    it("shows decrypt command help", () => {
      const result = run("decrypt --help");
      expect(result).toContain("Decrypt");
    });

    it("lists subcommands", () => {
      const result = run("decrypt --help");
      expect(result).toContain("file");
      expect(result).toContain("db");
    });
  });

  // ── auth ──

  describe("auth --help", () => {
    it("shows auth command help", () => {
      const result = run("auth --help");
      expect(result).toContain("RBAC");
    });

    it("lists subcommands", () => {
      const result = run("auth --help");
      expect(result).toContain("roles");
      expect(result).toContain("create-role");
      expect(result).toContain("delete-role");
      expect(result).toContain("grant");
      expect(result).toContain("revoke");
      expect(result).toContain("check");
      expect(result).toContain("permissions");
      expect(result).toContain("users");
      expect(result).toContain("scopes");
    });
  });

  describe("auth scopes", () => {
    it("lists available permission scopes", () => {
      const result = run("auth scopes");
      expect(result).toContain("note");
      expect(result).toContain("read");
      expect(result).toContain("write");
      expect(result).toContain("audit");
    });
  });

  // ── audit ──

  describe("audit --help", () => {
    it("shows audit command help", () => {
      const result = run("audit --help");
      expect(result).toContain("Audit");
    });

    it("lists subcommands", () => {
      const result = run("audit --help");
      expect(result).toContain("log");
      expect(result).toContain("search");
      expect(result).toContain("stats");
      expect(result).toContain("export");
      expect(result).toContain("purge");
      expect(result).toContain("types");
    });
  });

  describe("audit types", () => {
    it("lists event types and risk levels", () => {
      const result = run("audit types");
      expect(result).toContain("auth");
      expect(result).toContain("permission");
      expect(result).toContain("system");
      expect(result).toContain("low");
      expect(result).toContain("high");
      expect(result).toContain("critical");
    });
  });
});
