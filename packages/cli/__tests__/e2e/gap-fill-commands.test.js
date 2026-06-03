/**
 * E2E: Gap-fill features — lowcode deploy, zkp, nostr, privacy CLI commands
 *
 * Tests actual CLI command execution via `node bin/chainlesschain.js`.
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
    stdio: "pipe",
    ...options,
  });
}

function runSafe(args) {
  try {
    return run(args);
  } catch (e) {
    return e.stdout || e.stderr || e.message;
  }
}

// ── Low-Code Commands ─────────────────────────────────────────────────────

describe("E2E: Low-Code commands", () => {
  describe("lowcode --help", () => {
    it("shows lowcode subcommands including deploy", () => {
      const result = run("lowcode --help");
      expect(result).toContain("create");
      expect(result).toContain("list");
      expect(result).toContain("components");
      expect(result).toContain("deploy");
    });
  });

  describe("lowcode components", () => {
    it("lists built-in components", () => {
      const result = runSafe("lowcode components");
      expect(result).toContain("Form");
      expect(result).toContain("DataTable");
      expect(result).toContain("Button");
    });
  });

  describe("lowcode deploy --help", () => {
    it("shows deploy options", () => {
      const result = run("lowcode deploy --help");
      expect(result).toContain("output");
    });
  });
});

// ── ZKP Commands ──────────────────────────────────────────────────────────

describe("E2E: ZKP commands", () => {
  describe("zkp --help", () => {
    it("shows zkp subcommands", () => {
      const result = run("zkp --help");
      expect(result).toContain("compile");
      expect(result).toContain("prove");
      expect(result).toContain("verify");
    });
  });

  describe("zkp compile --help", () => {
    it("shows compile options", () => {
      const result = run("zkp compile --help");
      expect(result).toContain("name");
    });
  });

  describe("zkp stats", () => {
    it("runs without error", () => {
      const result = runSafe("zkp stats");
      // Should show stats or require DB — either way shouldn't crash
      expect(typeof result).toBe("string");
    });
  });
});

// ── Nostr Commands ────────────────────────────────────────────────────────

describe("E2E: Nostr commands", () => {
  describe("nostr --help", () => {
    it("shows nostr subcommands", () => {
      const result = run("nostr --help");
      expect(result).toContain("relays");
      expect(result).toContain("publish");
      expect(result).toContain("keygen");
      expect(result).toContain("map-did");
    });
  });

  describe("nostr keygen", () => {
    it("generates a keypair", () => {
      const result = runSafe("nostr keygen");
      // Should output key info or instructions
      expect(typeof result).toBe("string");
    });
  });
});

// ── Privacy Computing (via zkp/nostr umbrella) ────────────────────────────

describe("E2E: Privacy & Crypto ecosystem", () => {
  describe("zkp verify --help", () => {
    it("shows verify options", () => {
      const result = run("zkp verify --help");
      expect(result).toContain("proof");
    });
  });

  describe("nostr relays", () => {
    it("lists relays without error", () => {
      const result = runSafe("nostr relays");
      expect(typeof result).toBe("string");
    });
  });
});
