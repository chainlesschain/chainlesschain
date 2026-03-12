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

describe("E2E: Phase 8 — Enterprise commands", () => {
  // ── Compliance ──

  describe("compliance --help", () => {
    it("shows compliance subcommands", () => {
      const result = run("compliance --help");
      expect(result).toContain("evidence");
      expect(result).toContain("report");
      expect(result).toContain("classify");
      expect(result).toContain("scan");
      expect(result).toContain("policies");
      expect(result).toContain("check-access");
    });
  });

  describe("compliance evidence --help", () => {
    it("shows evidence options", () => {
      const result = run("compliance evidence --help");
      expect(result).toContain("framework");
    });
  });

  // ── DLP ──

  describe("dlp --help", () => {
    it("shows dlp subcommands", () => {
      const result = run("dlp --help");
      expect(result).toContain("scan");
      expect(result).toContain("incidents");
      expect(result).toContain("resolve");
      expect(result).toContain("stats");
      expect(result).toContain("policy");
    });
  });

  describe("dlp scan --help", () => {
    it("shows scan options", () => {
      const result = run("dlp scan --help");
      expect(result).toContain("content");
    });
  });

  // ── SIEM ──

  describe("siem --help", () => {
    it("shows siem subcommands", () => {
      const result = run("siem --help");
      expect(result).toContain("targets");
      expect(result).toContain("add-target");
      expect(result).toContain("export");
      expect(result).toContain("stats");
    });
  });

  describe("siem add-target --help", () => {
    it("shows add-target options", () => {
      const result = run("siem add-target --help");
      expect(result).toContain("type");
      expect(result).toContain("url");
    });
  });

  // ── PQC ──

  describe("pqc --help", () => {
    it("shows pqc subcommands", () => {
      const result = run("pqc --help");
      expect(result).toContain("keys");
      expect(result).toContain("generate");
      expect(result).toContain("migration-status");
      expect(result).toContain("migrate");
    });
  });

  describe("pqc generate --help", () => {
    it("shows generate options", () => {
      const result = run("pqc generate --help");
      expect(result).toContain("algorithm");
    });
  });

  // ── Nostr ──

  describe("nostr --help", () => {
    it("shows nostr subcommands", () => {
      const result = run("nostr --help");
      expect(result).toContain("relays");
      expect(result).toContain("add-relay");
      expect(result).toContain("publish");
      expect(result).toContain("events");
      expect(result).toContain("keygen");
      expect(result).toContain("map-did");
    });
  });

  describe("nostr publish --help", () => {
    it("shows publish options", () => {
      const result = run("nostr publish --help");
      expect(result).toContain("content");
    });
  });

  // ── Matrix ──

  describe("matrix --help", () => {
    it("shows matrix subcommands", () => {
      const result = run("matrix --help");
      expect(result).toContain("login");
      expect(result).toContain("rooms");
      expect(result).toContain("send");
      expect(result).toContain("messages");
      expect(result).toContain("join");
    });
  });

  describe("matrix send --help", () => {
    it("shows send options", () => {
      const result = run("matrix send --help");
      expect(result).toContain("room-id");
      expect(result).toContain("message");
    });
  });

  // ── SCIM ──

  describe("scim --help", () => {
    it("shows scim subcommands", () => {
      const result = run("scim --help");
      expect(result).toContain("users");
      expect(result).toContain("connectors");
      expect(result).toContain("sync");
      expect(result).toContain("status");
    });
  });

  describe("scim users --help", () => {
    it("shows users subcommands", () => {
      const result = run("scim users --help");
      expect(result).toContain("list");
      expect(result).toContain("create");
      expect(result).toContain("get");
      expect(result).toContain("delete");
    });
  });

  // ── Terraform ──

  describe("terraform --help", () => {
    it("shows terraform subcommands", () => {
      const result = run("terraform --help");
      expect(result).toContain("workspaces");
      expect(result).toContain("create");
      expect(result).toContain("plan");
      expect(result).toContain("runs");
    });
  });

  describe("terraform create --help", () => {
    it("shows create options", () => {
      const result = run("terraform create --help");
      expect(result).toContain("name");
    });
  });

  // ── Hardening ──

  describe("hardening --help", () => {
    it("shows hardening subcommands", () => {
      const result = run("hardening --help");
      expect(result).toContain("baseline");
      expect(result).toContain("audit");
    });
  });

  describe("hardening baseline --help", () => {
    it("shows baseline subcommands", () => {
      const result = run("hardening baseline --help");
      expect(result).toContain("collect");
      expect(result).toContain("compare");
      expect(result).toContain("list");
    });
  });

  describe("hardening audit --help", () => {
    it("shows audit subcommands", () => {
      const result = run("hardening audit --help");
      expect(result).toContain("run");
      expect(result).toContain("reports");
      expect(result).toContain("report");
    });
  });

  // ── Social ──

  describe("social --help", () => {
    it("shows social subcommands", () => {
      const result = run("social --help");
      expect(result).toContain("contact");
      expect(result).toContain("friend");
      expect(result).toContain("post");
      expect(result).toContain("chat");
      expect(result).toContain("stats");
    });
  });

  describe("social contact --help", () => {
    it("shows contact subcommands", () => {
      const result = run("social contact --help");
      expect(result).toContain("add");
      expect(result).toContain("list");
      expect(result).toContain("delete");
      expect(result).toContain("show");
    });
  });

  describe("social friend --help", () => {
    it("shows friend subcommands", () => {
      const result = run("social friend --help");
      expect(result).toContain("add");
      expect(result).toContain("list");
      expect(result).toContain("remove");
      expect(result).toContain("pending");
    });
  });

  describe("social post --help", () => {
    it("shows post subcommands", () => {
      const result = run("social post --help");
      expect(result).toContain("publish");
      expect(result).toContain("list");
      expect(result).toContain("like");
    });
  });

  describe("social chat --help", () => {
    it("shows chat subcommands", () => {
      const result = run("social chat --help");
      expect(result).toContain("send");
      expect(result).toContain("messages");
      expect(result).toContain("threads");
    });
  });
});

describe("E2E: Phase 8 — module imports", () => {
  describe("compliance-manager module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/compliance-manager.js");
      expect(mod.ensureComplianceTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureComplianceTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("dlp-engine module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/dlp-engine.js");
      expect(mod.ensureDLPTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureDLPTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("siem-exporter module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/siem-exporter.js");
      expect(mod.ensureSIEMTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureSIEMTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("pqc-manager module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/pqc-manager.js");
      expect(mod.ensurePQCTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensurePQCTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("nostr-bridge module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/nostr-bridge.js");
      expect(mod.ensureNostrTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureNostrTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("matrix-bridge module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/matrix-bridge.js");
      expect(mod.ensureMatrixTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureMatrixTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("scim-manager module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/scim-manager.js");
      expect(mod.ensureSCIMTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureSCIMTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("terraform-manager module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/terraform-manager.js");
      expect(mod.ensureTerraformTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureTerraformTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("hardening-manager module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/hardening-manager.js");
      expect(mod.ensureHardeningTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureHardeningTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("social-manager module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/social-manager.js");
      expect(mod.ensureSocialTables).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureSocialTables).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });
});
