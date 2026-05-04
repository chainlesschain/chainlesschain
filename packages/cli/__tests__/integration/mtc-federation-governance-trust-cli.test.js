/**
 * Integration test: cc mtc federation v0.3 trust + audit + on-chain
 * anchor + --help wiring + governance-sync-stats.
 *
 * Split from the original mtc-federation-governance-cli.test.js — see
 * mtc-federation-governance-core-cli.test.js header for context (issue #4).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractJson,
  makeCliRunner,
} from "./_helpers/mtc-federation-cli-helpers.js";

describe("cc mtc federation governance — trust + on-chain anchor + help", () => {
  let tmpHome;
  const { runCli, mustRun, joinAs } = makeCliRunner(() => tmpHome);

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-gov-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("v0.3 cross-federation trust + audit", () => {
    it("cross-trust-create writes a v1 anchor JSON", () => {
      const r = mustRun([
        "mtc",
        "federation",
        "cross-trust-create",
        "host-fed",
        "trusted-fed",
        "--threshold",
        "1",
        "--member",
        "alice:sha256:a-pk",
        "--member",
        "bob:sha256:b-pk",
        "--json",
      ]);
      const anchor = extractJson(r.stdout);
      expect(anchor.schema).toBe("mtc-cross-federation-trust-anchor/v1");
      expect(anchor.host_federation_id).toBe("host-fed");
      expect(anchor.trusted_federation_id).toBe("trusted-fed");
      expect(anchor.member_roster_snapshot).toHaveLength(2);
      expect(anchor.threshold).toBe(1);
    });

    it("cross-trust-create rejects same host + trusted federation id", () => {
      const r = runCli([
        "mtc",
        "federation",
        "cross-trust-create",
        "same",
        "same",
        "--threshold",
        "1",
        "--member",
        "x:sha256:x",
        "--json",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr || r.stdout).toMatch(/must differ/);
    });

    it("cross-trust-validate accepts a freshly-created anchor", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cross-trust-"));
      try {
        const out = path.join(dir, "anchor.json");
        mustRun([
          "mtc",
          "federation",
          "cross-trust-create",
          "h",
          "t",
          "--threshold",
          "1",
          "--member",
          "alice:sha256:a",
          "--out",
          out,
        ]);
        const r = mustRun([
          "mtc",
          "federation",
          "cross-trust-validate",
          out,
          "--json",
        ]);
        const j = extractJson(r.stdout);
        expect(j.ok).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("cross-trust-validate flags expired anchor with non-zero exit", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cross-trust-exp-"));
      try {
        const anchor = {
          schema: "mtc-cross-federation-trust-anchor/v1",
          host_federation_id: "h",
          trusted_federation_id: "t",
          member_roster_snapshot: [
            { member_id: "a", pubkey_id: "sha256:a", alg: "ed25519" },
          ],
          threshold: 1,
          accepted_kinds: ["did"],
          pinned_at: "2020-01-01T00:00:00Z",
          expires_at: "2020-04-01T00:00:00Z",
          notes: null,
        };
        const out = path.join(dir, "expired.json");
        fs.writeFileSync(out, JSON.stringify(anchor));
        const r = runCli([
          "mtc",
          "federation",
          "cross-trust-validate",
          out,
          "--json",
        ]);
        expect(r.status).not.toBe(0);
        const j = extractJson(r.stdout);
        expect(j.code).toBe("EXPIRED");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("audit reports clean log with ok=true", () => {
      joinAs("alice");
      const r = mustRun(["mtc", "federation", "audit", "fed-test", "--json"]);
      const j = extractJson(r.stdout);
      expect(j.ok).toBe(true);
      expect(j.events_count).toBe(0);
    });

    it("audit --summary surface", () => {
      joinAs("alice");
      const r = mustRun([
        "mtc",
        "federation",
        "audit",
        "fed-test",
        "--summary",
      ]);
      expect(r.stdout).toMatch(/✓ fed-test/);
    });
  });

  describe("v0.3 #2 on-chain governance anchor (Q-COMP-3 unlocked)", () => {
    it("governance-anchor publishes a snapshot record to the chain store", () => {
      joinAs("alice");
      const chainStore = fs.mkdtempSync(path.join(os.tmpdir(), "chain-store-"));
      try {
        const r = mustRun([
          "mtc",
          "federation",
          "governance-anchor",
          "fed-test",
          "--actor",
          "alice",
          "--chain-store",
          chainStore,
          "--chain-name",
          "test-consortium",
          "--json",
        ]);
        const j = extractJson(r.stdout);
        expect(j.anchored).toBe(true);
        expect(j.snapshot_hash).toBeDefined();
        expect(j.tx_hash).toMatch(/^fs:fed-test:1$/);
        expect(j.block_height).toBe(1);
        expect(j.chain_name).toBe("test-consortium");

        const anchorDir = path.join(
          chainStore,
          "governance-anchors",
          "fed-test",
        );
        expect(fs.existsSync(anchorDir)).toBe(true);
        expect(fs.readdirSync(anchorDir).length).toBe(1);
      } finally {
        fs.rmSync(chainStore, { recursive: true, force: true });
      }
    });

    it("governance-verify-anchor passes for unmodified log", () => {
      joinAs("alice");
      const chainStore = fs.mkdtempSync(
        path.join(os.tmpdir(), "chain-store-v-"),
      );
      try {
        mustRun([
          "mtc",
          "federation",
          "governance-anchor",
          "fed-test",
          "--actor",
          "alice",
          "--chain-store",
          chainStore,
          "--json",
        ]);
        const v = mustRun([
          "mtc",
          "federation",
          "governance-verify-anchor",
          "fed-test",
          "--chain-store",
          chainStore,
          "--json",
        ]);
        const j = extractJson(v.stdout);
        expect(j.ok).toBe(true);
        expect(j.expected_hash).toBe(j.actual_hash);
      } finally {
        fs.rmSync(chainStore, { recursive: true, force: true });
      }
    });

    it("governance-verify-anchor flags HASH_MISMATCH after new event added post-anchor", () => {
      joinAs("alice");
      const chainStore = fs.mkdtempSync(
        path.join(os.tmpdir(), "chain-store-d-"),
      );
      try {
        mustRun([
          "mtc",
          "federation",
          "governance-anchor",
          "fed-test",
          "--actor",
          "alice",
          "--chain-store",
          chainStore,
          "--json",
        ]);
        mustRun([
          "mtc",
          "federation",
          "invite",
          "fed-test",
          "bob",
          "--actor",
          "alice",
          "--candidate-pubkey-id",
          "sha256:b",
          "--json",
        ]);
        const v = runCli([
          "mtc",
          "federation",
          "governance-verify-anchor",
          "fed-test",
          "--chain-store",
          chainStore,
          "--json",
        ]);
        expect(v.status).not.toBe(0);
        const j = extractJson(v.stdout);
        expect(j.ok).toBe(false);
        expect(j.code).toBe("HASH_MISMATCH");
        expect(j.drift.events_count_diff).toBeGreaterThan(0);
      } finally {
        fs.rmSync(chainStore, { recursive: true, force: true });
      }
    });

    it("governance-verify-anchor flags NO_ANCHOR_ON_CHAIN for a fed never anchored", () => {
      const chainStore = fs.mkdtempSync(
        path.join(os.tmpdir(), "chain-store-e-"),
      );
      try {
        const r = runCli([
          "mtc",
          "federation",
          "governance-verify-anchor",
          "fed-never",
          "--chain-store",
          chainStore,
          "--json",
        ]);
        expect(r.status).not.toBe(0);
        const j = extractJson(r.stdout);
        expect(j.code).toBe("NO_ANCHOR_ON_CHAIN");
      } finally {
        fs.rmSync(chainStore, { recursive: true, force: true });
      }
    });

    it("repeated anchoring increments block_height", () => {
      joinAs("alice");
      const chainStore = fs.mkdtempSync(
        path.join(os.tmpdir(), "chain-store-r-"),
      );
      try {
        const r1 = mustRun([
          "mtc",
          "federation",
          "governance-anchor",
          "fed-test",
          "--actor",
          "alice",
          "--chain-store",
          chainStore,
          "--json",
        ]);
        expect(extractJson(r1.stdout).block_height).toBe(1);
        const r2 = mustRun([
          "mtc",
          "federation",
          "governance-anchor",
          "fed-test",
          "--actor",
          "alice",
          "--chain-store",
          chainStore,
          "--json",
        ]);
        expect(extractJson(r2.stdout).block_height).toBe(2);
      } finally {
        fs.rmSync(chainStore, { recursive: true, force: true });
      }
    });
  });

  describe("--help wiring", () => {
    it("federation --help lists all 8 governance subcommands", () => {
      const r = mustRun(["mtc", "federation", "--help"]);
      for (const sub of [
        "invite",
        "vote",
        "propose-revoke",
        "confirm-revoke",
        "rotate-key",
        "propose-threshold",
        "confirm-threshold",
        "fork",
        "merge",
        "governance-log",
        "governance-publish",
        "governance-pull",
        "governance-sync-serve",
        "governance-sync-libp2p",
        "governance-sync-stats",
        "cross-trust-create",
        "cross-trust-validate",
        "audit",
        "governance-anchor",
        "governance-verify-anchor",
      ]) {
        expect(r.stdout).toMatch(new RegExp(sub));
      }
    });

    it("governance-sync-stats reports defaults when no daemon has run", () => {
      const r = mustRun([
        "mtc",
        "federation",
        "governance-sync-stats",
        "fed-fresh",
        "--json",
      ]);
      const j = extractJson(r.stdout);
      expect(j.available).toBe(false);
      expect(j.federation_id).toBe("fed-fresh");
    });

    it("governance-sync-stats reflects daemon ticks", () => {
      joinAs("alice");
      const dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "fed-stats-"));
      try {
        mustRun([
          "mtc",
          "federation",
          "governance-sync-serve",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--once",
          "--json",
        ]);
        const r = mustRun([
          "mtc",
          "federation",
          "governance-sync-stats",
          "fed-test",
          "--json",
        ]);
        const j = extractJson(r.stdout);
        expect(j.federation_id).toBe("fed-test");
        expect(j.mode).toBe("filesystem");
        expect(j.last_tick_at).toBeDefined();
        expect(j.publish).toBeDefined();
        expect(j.pull).toBeDefined();
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
    });

    it("governance-sync-libp2p --help shows interval + verify + once flags", () => {
      const r = mustRun([
        "mtc",
        "federation",
        "governance-sync-libp2p",
        "--help",
      ]);
      expect(r.stdout).toMatch(/--listen/);
      expect(r.stdout).toMatch(/--connect/);
      expect(r.stdout).toMatch(/--interval/);
      expect(r.stdout).toMatch(/--verify/);
      expect(r.stdout).toMatch(/--once/);
    });
  });
});
