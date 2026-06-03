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

describe("E2E: Phase 7 — EvoMap Federation + DAO Governance commands", () => {
  describe("evomap federation --help", () => {
    it("shows federation subcommands", () => {
      const result = run("evomap federation --help");
      expect(result.toLowerCase()).toContain("federation");
      expect(result).toContain("list-hubs");
      expect(result).toContain("sync");
      expect(result).toContain("pressure");
      expect(result).toContain("recombine");
      expect(result).toContain("lineage");
    });
  });

  describe("evomap gov --help", () => {
    it("shows governance subcommands", () => {
      const result = run("evomap gov --help");
      expect(result.toLowerCase()).toContain("gov");
      expect(result).toContain("ownership-register");
      expect(result).toContain("ownership-trace");
      expect(result).toContain("propose");
      expect(result).toContain("vote");
      expect(result).toContain("dashboard");
    });
  });

  describe("evomap federation list-hubs --help", () => {
    it("shows list-hubs options", () => {
      const result = run("evomap federation list-hubs --help");
      expect(result.toLowerCase()).toContain("hub");
    });
  });

  describe("evomap federation sync --help", () => {
    it("shows sync options", () => {
      const result = run("evomap federation sync --help");
      expect(result).toContain("hub-id");
    });
  });

  describe("evomap gov propose --help", () => {
    it("shows propose options", () => {
      const result = run("evomap gov propose --help");
      expect(result).toContain("title");
    });
  });

  describe("dao --help", () => {
    it("shows dao command help", () => {
      const result = run("dao --help");
      expect(result.toLowerCase()).toContain("dao");
      expect(result).toContain("propose");
      expect(result).toContain("vote");
      expect(result).toContain("delegate");
      expect(result).toContain("execute");
      expect(result).toContain("treasury");
      expect(result).toContain("allocate");
      expect(result).toContain("stats");
      expect(result).toContain("configure");
    });
  });

  describe("dao propose --help", () => {
    it("shows propose options", () => {
      const result = run("dao propose --help");
      expect(result).toContain("title");
      expect(result).toContain("--description");
      expect(result).toContain("--proposer");
    });
  });

  describe("dao vote --help", () => {
    it("shows vote options", () => {
      const result = run("dao vote --help");
      expect(result).toContain("proposal-id");
      expect(result).toContain("direction");
    });
  });

  describe("dao delegate --help", () => {
    it("shows delegate options", () => {
      const result = run("dao delegate --help");
      expect(result).toContain("delegator");
      expect(result).toContain("delegate-to");
    });
  });

  describe("dao treasury --help", () => {
    it("shows treasury options", () => {
      const result = run("dao treasury --help");
      expect(result).toContain("--json");
    });
  });

  describe("dao stats --help", () => {
    it("shows stats options", () => {
      const result = run("dao stats --help");
      expect(result).toContain("--json");
    });
  });

  describe("dao configure --help", () => {
    it("shows configure options", () => {
      const result = run("dao configure --help");
      expect(result).toContain("--quorum");
      expect(result).toContain("--voting-period");
    });
  });
});

describe("E2E: Phase 7 — module imports", () => {
  describe("evomap-federation module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/evomap-federation.js");
      expect(mod.ensureEvoMapFederationTables).toBeDefined();
      expect(mod.listFederatedHubs).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureEvoMapFederationTables).toBe("function");
      expect(typeof mod.listFederatedHubs).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("evomap-governance module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/evomap-governance.js");
      expect(mod.ensureEvoMapGovernanceTables).toBeDefined();
      expect(mod.registerOwnership).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureEvoMapGovernanceTables).toBe("function");
      expect(typeof mod.registerOwnership).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });

  describe("dao-governance module", () => {
    it("is importable and has expected exports", async () => {
      const mod = await import("../../src/lib/dao-governance.js");
      expect(mod.ensureDAOv2Tables).toBeDefined();
      expect(mod.propose).toBeDefined();
      expect(mod.vote).toBeDefined();
      expect(mod._resetState).toBeDefined();
      expect(typeof mod.ensureDAOv2Tables).toBe("function");
      expect(typeof mod.propose).toBe("function");
      expect(typeof mod.vote).toBe("function");
      expect(typeof mod._resetState).toBe("function");
    });
  });
});
