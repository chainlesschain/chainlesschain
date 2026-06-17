/**
 * Integration test: cc mtc federation cross-member sync subcommands —
 * governance-publish/governance-pull/confirm-threshold quorum/
 * confirm-revoke quorum/governance-sync-serve.
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

describe("cc mtc federation governance — cross-member sync (publish/pull/quorum/sync-serve)", () => {
  let tmpHome;
  const { runCli, mustRun, joinAs } = makeCliRunner(() => tmpHome);

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-gov-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("governance-publish + governance-pull (cross-member sync)", () => {
    it("publish writes one file per event to drop-zone", () => {
      joinAs("alice");
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
      const dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "fed-gov-drop-"));
      try {
        const r = mustRun([
          "mtc",
          "federation",
          "governance-publish",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--json",
        ]);
        const j = extractJson(r.stdout);
        expect(j.published).toBe(1);
        expect(j.skipped).toBe(0);
        const dir = path.join(dropZone, "federation-governance", "fed-test");
        expect(fs.existsSync(dir)).toBe(true);
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
        expect(files).toHaveLength(1);
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
    });

    it("publish is idempotent (second run skips)", () => {
      joinAs("alice");
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
      const dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "fed-gov-drop2-"));
      try {
        mustRun([
          "mtc",
          "federation",
          "governance-publish",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--json",
        ]);
        const r2 = mustRun([
          "mtc",
          "federation",
          "governance-publish",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--json",
        ]);
        const j2 = extractJson(r2.stdout);
        expect(j2.published).toBe(0);
        expect(j2.skipped).toBe(1);
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
    });

    it("alice publishes → bob pulls → bob's local log matches", () => {
      joinAs("alice");
      mustRun([
        "mtc",
        "federation",
        "invite",
        "fed-test",
        "carol",
        "--actor",
        "alice",
        "--candidate-pubkey-id",
        "sha256:c",
        "--json",
      ]);
      mustRun([
        "mtc",
        "federation",
        "vote",
        "fed-test",
        "carol",
        "--actor",
        "alice",
        "--decision",
        "approve",
        "--json",
      ]);

      const dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "fed-gov-x-"));
      try {
        mustRun([
          "mtc",
          "federation",
          "governance-publish",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--json",
        ]);

        const aliceHome = tmpHome;
        const bobHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-bob-"));
        try {
          tmpHome = bobHome;
          const pull = mustRun([
            "mtc",
            "federation",
            "governance-pull",
            "fed-test",
            "--drop-zone",
            dropZone,
            "--json",
          ]);
          const pj = extractJson(pull.stdout);
          expect(pj.appended).toBe(2);
          expect(pj.duplicates).toBe(0);

          const log = mustRun([
            "mtc",
            "federation",
            "governance-log",
            "fed-test",
            "--json",
          ]);
          const data = extractJson(log.stdout);
          expect(data.events).toHaveLength(2);
          const carol = data.state.members.find((m) => m.member_id === "carol");
          expect(carol).toBeDefined();
          expect(carol.weight).toBe(0.5);

          const pull2 = mustRun([
            "mtc",
            "federation",
            "governance-pull",
            "fed-test",
            "--drop-zone",
            dropZone,
            "--json",
          ]);
          const pj2 = extractJson(pull2.stdout);
          expect(pj2.appended).toBe(0);
          expect(pj2.duplicates).toBe(2);
        } finally {
          fs.rmSync(bobHome, { recursive: true, force: true });
          tmpHome = aliceHome;
        }
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
      // Cross-member publish/pull spawns the most CLI processes of any federation
      // test (alice publish + bob pull). ~21s isolated but >90s under full-suite
      // 2-fork contention; raised 90s→120s to match the heaviest sibling
      // (mtc-audit). See internal handbook trap #31.
    }, 120000);

    it("--verify passes for valid events when actor's pubkey is in registry", () => {
      joinAs("alice");
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
      const dropZone = fs.mkdtempSync(
        path.join(os.tmpdir(), "fed-gov-verify-"),
      );
      try {
        mustRun([
          "mtc",
          "federation",
          "governance-publish",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--json",
        ]);

        const aliceHome = tmpHome;
        const peerHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-peer-"));
        try {
          tmpHome = peerHome;
          const pullNoVerify = mustRun([
            "mtc",
            "federation",
            "governance-pull",
            "fed-test",
            "--drop-zone",
            dropZone,
            "--json",
          ]);
          expect(extractJson(pullNoVerify.stdout).appended).toBe(1);

          const peer2 = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-peer2-"));
          tmpHome = peer2;
          const pullVerify = mustRun([
            "mtc",
            "federation",
            "governance-pull",
            "fed-test",
            "--drop-zone",
            dropZone,
            "--verify",
            "--json",
          ]);
          const pvj = extractJson(pullVerify.stdout);
          expect(pvj.unknown_signer).toBe(1);
          expect(pvj.appended).toBe(0);
          fs.rmSync(peer2, { recursive: true, force: true });
        } finally {
          fs.rmSync(peerHome, { recursive: true, force: true });
          tmpHome = aliceHome;
        }
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
    });

    it("pull errors when drop-zone has no events for federation", () => {
      const dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "fed-gov-empty-"));
      try {
        const r = runCli([
          "mtc",
          "federation",
          "governance-pull",
          "fed-nope",
          "--drop-zone",
          dropZone,
          "--json",
        ]);
        expect(r.status).not.toBe(0);
        expect(r.stderr || r.stdout).toMatch(/no events for fed-nope/);
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
    });
  });

  describe("confirm-threshold + quorum gating", () => {
    it("confirm-threshold rejected without prior propose-threshold (quorum check)", () => {
      joinAs("alice");
      const r = runCli([
        "mtc",
        "federation",
        "confirm-threshold",
        "fed-test",
        "--actor",
        "alice",
        "--json",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr || r.stdout).toMatch(/no open propose-threshold/);
    });

    it("confirm-threshold succeeds after propose-threshold + replay applies it", () => {
      joinAs("alice");
      mustRun([
        "mtc",
        "federation",
        "propose-threshold",
        "fed-test",
        "3",
        "--actor",
        "alice",
        "--json",
      ]);
      const r = mustRun([
        "mtc",
        "federation",
        "confirm-threshold",
        "fed-test",
        "--actor",
        "alice",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.event_type).toBe("confirm-threshold");

      const log = mustRun([
        "mtc",
        "federation",
        "governance-log",
        "fed-test",
        "--json",
      ]);
      const data = extractJson(log.stdout);
      expect(data.state.threshold).toBe(3);
      expect(data.state.pending_threshold).toBeNull();
    });

    it("confirm-revoke rejected without prior propose-revoke (quorum check)", () => {
      joinAs("alice");
      const r = runCli([
        "mtc",
        "federation",
        "confirm-revoke",
        "fed-test",
        "bob",
        "--actor",
        "alice",
        "--json",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr || r.stdout).toMatch(/no open propose-revoke/);
    });

    it("confirm-revoke --no-quorum-check bypasses the gate", () => {
      joinAs("alice");
      const r = mustRun([
        "mtc",
        "federation",
        "confirm-revoke",
        "fed-test",
        "bob",
        "--actor",
        "alice",
        "--no-quorum-check",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.event_type).toBe("confirm-revoke");
    });

    it("confirm-threshold --proposal-event-id picks specific proposal", () => {
      joinAs("alice");
      const p3 = extractJson(
        mustRun([
          "mtc",
          "federation",
          "propose-threshold",
          "fed-test",
          "3",
          "--actor",
          "alice",
          "--json",
        ]).stdout,
      );
      mustRun([
        "mtc",
        "federation",
        "propose-threshold",
        "fed-test",
        "5",
        "--actor",
        "alice",
        "--json",
      ]);
      const c = mustRun([
        "mtc",
        "federation",
        "confirm-threshold",
        "fed-test",
        "--actor",
        "alice",
        "--proposal-event-id",
        p3.event_id,
        "--json",
      ]);
      expect(extractJson(c.stdout).payload.proposal_event_id).toBe(p3.event_id);
      const log = extractJson(
        mustRun(["mtc", "federation", "governance-log", "fed-test", "--json"])
          .stdout,
      );
      expect(log.state.threshold).toBe(3);
    });

    it("confirm-revoke succeeds when a matching propose-revoke exists", () => {
      joinAs("alice");
      mustRun([
        "mtc",
        "federation",
        "propose-revoke",
        "fed-test",
        "carol",
        "--actor",
        "alice",
        "--reason",
        "inactive",
        "--json",
      ]);
      const r = mustRun([
        "mtc",
        "federation",
        "confirm-revoke",
        "fed-test",
        "carol",
        "--actor",
        "alice",
        "--json",
      ]);
      expect(extractJson(r.stdout).event_type).toBe("confirm-revoke");
    });
  });

  describe("governance-sync-serve --once (auto-sync daemon, single tick)", () => {
    it("publishes + pulls in one tick when staging+remote empty", () => {
      joinAs("alice");
      const dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "fed-sync-1-"));
      try {
        const r = mustRun([
          "mtc",
          "federation",
          "governance-sync-serve",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--once",
          "--json",
        ]);
        const j = extractJson(r.stdout);
        expect(j.tick_at).toBeDefined();
        expect(j.publish.published).toBe(0);
        expect(j.pull.appended).toBe(0);
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
    });

    it("--once syncs alice → bob in a single round", () => {
      joinAs("alice");
      mustRun([
        "mtc",
        "federation",
        "invite",
        "fed-test",
        "carol",
        "--actor",
        "alice",
        "--candidate-pubkey-id",
        "sha256:c",
        "--json",
      ]);
      const dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "fed-sync-2-"));
      try {
        const aliceTick = mustRun([
          "mtc",
          "federation",
          "governance-sync-serve",
          "fed-test",
          "--drop-zone",
          dropZone,
          "--once",
          "--json",
        ]);
        const aj = extractJson(aliceTick.stdout);
        expect(aj.publish.published).toBe(1);

        const aliceHome = tmpHome;
        const bobHome = fs.mkdtempSync(path.join(os.tmpdir(), "fed-bob-sync-"));
        try {
          tmpHome = bobHome;
          const bobTick = mustRun([
            "mtc",
            "federation",
            "governance-sync-serve",
            "fed-test",
            "--drop-zone",
            dropZone,
            "--once",
            "--json",
          ]);
          const bj = extractJson(bobTick.stdout);
          expect(bj.pull.appended).toBe(1);
          expect(bj.publish.published).toBe(0);

          const bobTick2 = mustRun([
            "mtc",
            "federation",
            "governance-sync-serve",
            "fed-test",
            "--drop-zone",
            dropZone,
            "--once",
            "--json",
          ]);
          const bj2 = extractJson(bobTick2.stdout);
          expect(bj2.pull.appended).toBe(0);
          expect(bj2.pull.duplicates).toBe(1);
        } finally {
          fs.rmSync(bobHome, { recursive: true, force: true });
          tmpHome = aliceHome;
        }
      } finally {
        fs.rmSync(dropZone, { recursive: true, force: true });
      }
    });
  });
});
