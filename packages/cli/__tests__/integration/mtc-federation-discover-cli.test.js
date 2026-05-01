/**
 * Integration test: cc mtc federation discover (Phase 3.3 — service discovery).
 *
 * Uses --once mode + a shared filesystem drop-zone to simulate two
 * separate nodes (separate HOME dirs → separate registries → different
 * pubkeys) finding each other through the shared dir.
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

describe("cc mtc federation discover — filesystem drop-zone", () => {
  let nodeAHome;
  let nodeBHome;
  let dropZone;

  function runCli(args, homeDir) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, USERPROFILE: homeDir, HOME: homeDir },
    });
  }

  beforeEach(() => {
    nodeAHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-disc-A-"));
    nodeBHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-disc-B-"));
    dropZone = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fed-disc-zone-"));
  });

  afterEach(() => {
    fs.rmSync(nodeAHome, { recursive: true, force: true });
    fs.rmSync(nodeBHome, { recursive: true, force: true });
    fs.rmSync(dropZone, { recursive: true, force: true });
  });

  it("listen-only --once on empty drop-zone returns empty member list", () => {
    const r = runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-empty",
        "--drop-zone",
        dropZone,
        "--once",
        "--json",
      ],
      nodeAHome,
    );
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.federation_id).toBe("fed-empty");
    expect(out.members).toEqual([]);
    expect(out.self_announce_file).toBeNull();
  });

  it("publishes self-announce when --member-id is set + joined", () => {
    runCli(
      [
        "mtc",
        "federation",
        "join",
        "fed-pub",
        "--member-id",
        "alice",
        "--json",
      ],
      nodeAHome,
    );
    const r = runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-pub",
        "--drop-zone",
        dropZone,
        "--member-id",
        "alice",
        "--once",
        "--json",
      ],
      nodeAHome,
    );
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.self_announce_file).toBeTruthy();
    expect(fs.existsSync(out.self_announce_file)).toBe(true);
    const ann = JSON.parse(fs.readFileSync(out.self_announce_file, "utf-8"));
    expect(ann.schema).toBe("mtc-federation-announce/v1");
    expect(ann.member_id).toBe("alice");
    expect(ann.signature).toBeDefined();
    // Self-scan picks up own announce
    expect(out.members).toHaveLength(1);
    expect(out.members[0].member_id).toBe("alice");
  });

  it("two separate nodes discover each other via shared drop-zone", () => {
    // Node A joins + announces
    runCli(
      ["mtc", "federation", "join", "fed-x", "--member-id", "alice", "--json"],
      nodeAHome,
    );
    runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-x",
        "--drop-zone",
        dropZone,
        "--member-id",
        "alice",
        "--once",
        "--json",
      ],
      nodeAHome,
    );

    // Node B (separate HOME) joins + announces. Note: A's announce already in dropZone.
    runCli(
      ["mtc", "federation", "join", "fed-x", "--member-id", "bob", "--json"],
      nodeBHome,
    );
    const r = runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-x",
        "--drop-zone",
        dropZone,
        "--member-id",
        "bob",
        "--once",
        "--json",
      ],
      nodeBHome,
    );
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    // Bob sees both alice (from A's prior run) + himself
    expect(out.members.map((m) => m.member_id).sort()).toEqual([
      "alice",
      "bob",
    ]);
    // Each member has the right alg + a real pubkey_id
    for (const m of out.members) {
      expect(m.alg).toBe("Ed25519");
      expect(m.pubkey_id).toMatch(/^sha256:/);
    }
  });

  it("supports SLH-DSA federation members in discovery", () => {
    runCli(
      [
        "mtc",
        "federation",
        "join",
        "fed-pqc",
        "--member-id",
        "pqc-node",
        "--alg",
        "slh-dsa-128f",
        "--json",
      ],
      nodeAHome,
    );
    const r = runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-pqc",
        "--drop-zone",
        dropZone,
        "--member-id",
        "pqc-node",
        "--once",
        "--json",
      ],
      nodeAHome,
    );
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.members[0].alg).toBe("SLH-DSA-SHA2-128F");
  });

  it("rejects --member-id when not joined to that federation", () => {
    const r = runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-not-joined",
        "--drop-zone",
        dropZone,
        "--member-id",
        "ghost",
        "--once",
      ],
      nodeAHome,
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/not joined/i);
  });

  it("scans pre-existing announces in the drop-zone (listen-only mode)", () => {
    // Node A publishes
    runCli(
      [
        "mtc",
        "federation",
        "join",
        "fed-listen",
        "--member-id",
        "publisher",
        "--json",
      ],
      nodeAHome,
    );
    runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-listen",
        "--drop-zone",
        dropZone,
        "--member-id",
        "publisher",
        "--once",
        "--json",
      ],
      nodeAHome,
    );
    // Node B listens (no member-id, no self-announce) — should still see publisher
    const r = runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-listen",
        "--drop-zone",
        dropZone,
        "--once",
        "--json",
      ],
      nodeBHome,
    );
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.self_announce_file).toBeNull();
    expect(out.members.map((m) => m.member_id)).toEqual(["publisher"]);
  });

  it("rejects tampered announces dropped into the zone manually", () => {
    // Plant a bogus announce file
    const dir = path.join(dropZone, "federation-announces", "fed-bogus");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "bogus.json"),
      JSON.stringify({
        schema: "mtc-federation-announce/v1",
        federation_id: "fed-bogus",
        member_id: "fake",
      }),
    );

    const r = runCli(
      [
        "mtc",
        "federation",
        "discover",
        "fed-bogus",
        "--drop-zone",
        dropZone,
        "--once",
        "--json",
      ],
      nodeAHome,
    );
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.scan.rejected).toBe(1);
    expect(out.members).toEqual([]);
  });
});
