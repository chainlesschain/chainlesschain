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

describe("E2E: Phase 5 commands", () => {
  // ── p2p ──

  describe("p2p --help", () => {
    it("shows p2p command help", () => {
      const result = run("p2p --help");
      expect(result.toLowerCase()).toContain("peer-to-peer");
    });

    it("lists subcommands", () => {
      const result = run("p2p --help");
      expect(result).toContain("status");
      expect(result).toContain("peers");
      expect(result).toContain("send");
      expect(result).toContain("inbox");
      expect(result).toContain("pair");
      expect(result).toContain("devices");
      expect(result).toContain("unpair");
    });
  });

  // ── sync ──

  describe("sync --help", () => {
    it("shows sync command help", () => {
      const result = run("sync --help");
      expect(result).toContain("synchronization");
    });

    it("lists subcommands", () => {
      const result = run("sync --help");
      expect(result).toContain("status");
      expect(result).toContain("push");
      expect(result).toContain("pull");
      expect(result).toContain("conflicts");
      expect(result).toContain("resolve");
      expect(result).toContain("log");
      expect(result).toContain("clear");
    });
  });

  // ── wallet ──

  describe("wallet --help", () => {
    it("shows wallet command help", () => {
      const result = run("wallet --help");
      expect(result).toContain("wallet");
    });

    it("lists subcommands", () => {
      const result = run("wallet --help");
      expect(result).toContain("create");
      expect(result).toContain("list");
      expect(result).toContain("balance");
      expect(result).toContain("set-default");
      expect(result).toContain("delete");
      expect(result).toContain("asset");
      expect(result).toContain("assets");
      expect(result).toContain("transfer");
      expect(result).toContain("history");
      expect(result).toContain("summary");
    });
  });

  // ── org ──

  describe("org --help", () => {
    it("shows org command help", () => {
      const result = run("org --help");
      expect(result).toContain("Organization");
    });

    it("lists subcommands", () => {
      const result = run("org --help");
      expect(result).toContain("create");
      expect(result).toContain("list");
      expect(result).toContain("show");
      expect(result).toContain("delete");
      expect(result).toContain("invite");
      expect(result).toContain("members");
      expect(result).toContain("team-create");
      expect(result).toContain("teams");
      expect(result).toContain("approval-submit");
      expect(result).toContain("approvals");
      expect(result).toContain("approve");
      expect(result).toContain("reject");
    });
  });

  // ── plugin ──

  describe("plugin --help", () => {
    it("shows plugin command help", () => {
      const result = run("plugin --help");
      expect(result).toContain("Plugin");
    });

    it("lists subcommands", () => {
      const result = run("plugin --help");
      expect(result).toContain("list");
      expect(result).toContain("install");
      expect(result).toContain("remove");
      expect(result).toContain("enable");
      expect(result).toContain("disable");
      expect(result).toContain("update");
      expect(result).toContain("info");
      expect(result).toContain("search");
      expect(result).toContain("registry");
      expect(result).toContain("summary");
    });
  });
});
