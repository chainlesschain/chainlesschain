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
        "fork",
        "merge",
        "governance-log",
      ]) {
        expect(r.stdout).toMatch(new RegExp(sub));
      }
    });
  });
});
