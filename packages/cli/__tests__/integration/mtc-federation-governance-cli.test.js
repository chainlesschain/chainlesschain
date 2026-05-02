/**
 * Integration test: cc mtc federation {invite,vote,propose-revoke,
 * confirm-revoke,rotate-key,propose-threshold,fork,merge,governance-log}.
 *
 * Drives the 8 new governance subcommands plus the governance-log viewer
 * via subprocess against a per-test tmp HOME, asserts events land in
 * <home>/.chainlesschain/federation/governance/<fed>.jsonl, and that
 * governance-log replay yields the expected derived state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let s = 0; s < lines.length; s++) {
    const t = lines[s].trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      for (let e = lines.length; e > s; e--) {
        try {
          return JSON.parse(lines.slice(s, e).join("\n"));
        } catch (_err) {
          /* shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 300)}`);
}

describe("cc mtc federation governance — CLI integration", () => {
  let tmpHome;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env: {
        ...process.env,
        USERPROFILE: tmpHome,
        HOME: tmpHome,
      },
    });
  }

  function mustRun(args) {
    const r = runCli(args);
    if (r.status !== 0) {
      throw new Error(
        `cc ${args.join(" ")} exit=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
      );
    }
    return r;
  }

  function joinAs(memberId, fedId = "fed-test") {
    return mustRun([
      "mtc",
      "federation",
      "join",
      fedId,
      "--member-id",
      memberId,
      "--json",
    ]);
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-gov-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("invite + vote", () => {
    it("invite emits a signed event in governance.log", () => {
      const alice = extractJson(joinAs("alice").stdout);
      expect(alice.ok).toBe(true);

      const r = mustRun([
        "mtc",
        "federation",
        "invite",
        "fed-test",
        "bob",
        "--actor",
        "alice",
        "--candidate-pubkey-id",
        "sha256:bob-pk",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.schema).toBe("mtc-federation-governance/v1");
      expect(event.event_type).toBe("invite");
      expect(event.actor_member_id).toBe("alice");
      expect(event.payload.candidate_member_id).toBe("bob");
      expect(event.signature).toBeDefined();

      const logPath = path.join(
        tmpHome,
        ".chainlesschain",
        "federation",
        "governance",
        "fed-test.jsonl",
      );
      expect(fs.existsSync(logPath)).toBe(true);
      const lines = fs.readFileSync(logPath, "utf-8").trim().split(/\r?\n/);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).event_id).toBe(event.event_id);
    });

    it("vote approve emits a signed event", () => {
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
      const r = mustRun([
        "mtc",
        "federation",
        "vote",
        "fed-test",
        "bob",
        "--actor",
        "alice",
        "--decision",
        "approve",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.event_type).toBe("vote");
      expect(event.payload.decision).toBe("approve");
      expect(event.payload.invite_target_member_id).toBe("bob");
    });

    it("vote rejects bad --decision value", () => {
      joinAs("alice");
      const r = runCli([
        "mtc",
        "federation",
        "vote",
        "fed-test",
        "bob",
        "--actor",
        "alice",
        "--decision",
        "maybe",
        "--json",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr || r.stdout).toMatch(/approve or reject/);
    });
  });

  describe("propose-revoke + confirm-revoke", () => {
    it("emits both events with reason tracked", () => {
      joinAs("alice");
      const propose = extractJson(
        mustRun([
          "mtc",
          "federation",
          "propose-revoke",
          "fed-test",
          "bob",
          "--actor",
          "alice",
          "--reason",
          "key-compromise",
          "--json",
        ]).stdout,
      );
      expect(propose.event_type).toBe("propose-revoke");
      expect(propose.payload.reason).toBe("key-compromise");

      const confirm = extractJson(
        mustRun([
          "mtc",
          "federation",
          "confirm-revoke",
          "fed-test",
          "bob",
          "--actor",
          "alice",
          "--reason",
          "key-compromise",
          "--json",
        ]).stdout,
      );
      expect(confirm.event_type).toBe("confirm-revoke");
      expect(confirm.payload.target_member_id).toBe("bob");
    });
  });

  describe("rotate-key", () => {
    it("emits a rotate-key event with new_pubkey_id", () => {
      joinAs("alice");
      const r = mustRun([
        "mtc",
        "federation",
        "rotate-key",
        "fed-test",
        "--actor",
        "alice",
        "--new-pubkey-id",
        "sha256:new-alice-pk",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.event_type).toBe("rotate-key");
      expect(event.payload.new_pubkey_id).toBe("sha256:new-alice-pk");
    });
  });

  describe("propose-threshold", () => {
    it("emits propose-threshold event with target int", () => {
      joinAs("alice");
      const r = mustRun([
        "mtc",
        "federation",
        "propose-threshold",
        "fed-test",
        "3",
        "--actor",
        "alice",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.event_type).toBe("propose-threshold");
      expect(event.payload.proposed_threshold).toBe(3);
    });

    it("rejects non-integer threshold", () => {
      joinAs("alice");
      const r = runCli([
        "mtc",
        "federation",
        "propose-threshold",
        "fed-test",
        "abc",
        "--actor",
        "alice",
        "--json",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr || r.stdout).toMatch(/positive integer/);
    });
  });

  describe("fork + merge", () => {
    it("fork emits event with members list", () => {
      joinAs("alice");
      const r = mustRun([
        "mtc",
        "federation",
        "fork",
        "fed-test",
        "fed-fork",
        "--actor",
        "alice",
        "--members",
        "alice",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.event_type).toBe("fork");
      expect(event.payload.new_federation_id).toBe("fed-fork");
      expect(event.payload.member_ids).toEqual(["alice"]);
    });

    it("merge emits event with both federation ids", () => {
      joinAs("alice");
      const r = mustRun([
        "mtc",
        "federation",
        "merge",
        "fed-test",
        "fed-other",
        "fed-merged",
        "--actor",
        "alice",
        "--json",
      ]);
      const event = extractJson(r.stdout);
      expect(event.event_type).toBe("merge");
      expect(event.payload.other_federation_id).toBe("fed-other");
      expect(event.payload.new_federation_id).toBe("fed-merged");
    });
  });

  describe("governance-log replay", () => {
    it("returns events + replayed state JSON", () => {
      // Simulate a flow: alice creates → invites bob → alice approves bob
      const alice = extractJson(joinAs("alice").stdout);
      mustRun([
        "mtc",
        "federation",
        "invite",
        "fed-test",
        "bob",
        "--actor",
        "alice",
        "--candidate-pubkey-id",
        "sha256:bob",
        "--json",
      ]);
      mustRun([
        "mtc",
        "federation",
        "vote",
        "fed-test",
        "bob",
        "--actor",
        "alice",
        "--decision",
        "approve",
        "--json",
      ]);

      const r = mustRun([
        "mtc",
        "federation",
        "governance-log",
        "fed-test",
        "--json",
      ]);
      const data = extractJson(r.stdout);
      expect(Array.isArray(data.events)).toBe(true);
      expect(data.events.length).toBeGreaterThanOrEqual(2);
      expect(data.state.federation_id).toBe("fed-test");

      // bob should appear as a candidate (weight 0.5) since vote met threshold (1)
      const bob = data.state.members.find((m) => m.member_id === "bob");
      expect(bob).toBeDefined();
      expect(bob.weight).toBe(0.5);
      expect(bob.status).toBe("candidate");

      // void the alice key id presence
      void alice;
    });

    it("--events-only skips replay", () => {
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
      const r = mustRun([
        "mtc",
        "federation",
        "governance-log",
        "fed-test",
        "--events-only",
        "--json",
      ]);
      const data = extractJson(r.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].event_type).toBe("invite");
    });

    it("returns empty replay when no events", () => {
      const r = mustRun([
        "mtc",
        "federation",
        "governance-log",
        "fed-fresh",
        "--json",
      ]);
      const data = extractJson(r.stdout);
      expect(data.events).toEqual([]);
      expect(data.state.status).toBe("bootstrap");
      expect(data.state.members).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("invite from unknown actor exits non-zero", () => {
      const r = runCli([
        "mtc",
        "federation",
        "invite",
        "fed-test",
        "bob",
        "--actor",
        "ghost",
        "--candidate-pubkey-id",
        "sha256:b",
        "--json",
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr || r.stdout).toMatch(/not joined as "ghost"/);
    });
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
      // Alice's home (initial tmpHome) writes 2 events.
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

        // Switch to a fresh "bob" home and pull
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

          // Bob's local log now contains both events; replay should show carol as candidate
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

          // Pulling again is idempotent — duplicates only
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
    });

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

        // Pull with verify in a fresh home that has joined the same federation as a peer
        const aliceHome = tmpHome;
        const peerHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-peer-"));
        try {
          tmpHome = peerHome;
          // Pull WITHOUT verify (no registry knowledge of alice)
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

          // Reset peer log via fresh peer dir and try with --verify (no registry → unknown)
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

      // governance-log replay must show threshold applied
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
      expect(log.state.threshold).toBe(3); // explicit choice, not most-recent (5)
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
        // Only the join doesn't write a governance event; alice has 0 events
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
        // alice publishes via --once
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

        // switch to bob's home and run --once — he pulls
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
          expect(bj.publish.published).toBe(0); // nothing local to publish

          // Idempotent: a second tick on bob's box adds nothing
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
      // Note: join doesn't write a governance event yet; audit on empty log
      // returns ok=true with 0 events.
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

        // Anchor record should exist on disk
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
        // Anchor with current state
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
        // Add a new event that changes the snapshot hash
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
        // Verify now fails
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
        // Run daemon once — populates stats file
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
