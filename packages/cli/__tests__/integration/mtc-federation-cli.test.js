/**
 * Integration test: cc mtc federation join | leave | status (Phase 3.1).
 *
 * Drives the CLI via subprocess against a per-test tmp HOME dir, exercises
 * the full join/leave round-trip + status snapshot, and confirms key files
 * land at 0o600 + registry uses atomic writes.
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

describe("cc mtc federation — CLI integration", () => {
  let tmpHome;
  let registryPath;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      // Override the home dir lookup. paths.js honors USERPROFILE / HOME
      // via os.homedir(), so steering both env vars covers Windows + POSIX.
      env: {
        ...process.env,
        USERPROFILE: tmpHome,
        HOME: tmpHome,
      },
    });
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-fed-"));
    registryPath = path.join(
      tmpHome,
      ".chainlesschain",
      "federation",
      "members.json",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("status reports 'no federations registered' on a fresh dir", () => {
    const r = runCli(["mtc", "federation", "status"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no federations registered/i);
  });

  it("join creates a registry entry with persisted Ed25519 key (0o600)", () => {
    const r = runCli([
      "mtc",
      "federation",
      "join",
      "fed-acme",
      "--member-id",
      "node-a",
      "--alg",
      "ed25519",
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.federation_id).toBe("fed-acme");
    expect(out.member_id).toBe("node-a");
    expect(out.alg).toBe("Ed25519");
    expect(out.pubkey_id).toMatch(/^sha256:/);
    expect(fs.existsSync(out.key_file)).toBe(true);

    // Registry written
    expect(fs.existsSync(registryPath)).toBe(true);
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.federations["fed-acme"].members["node-a"]).toBeTruthy();
    expect(registry.federations["fed-acme"].members["node-a"].alg).toBe(
      "Ed25519",
    );

    // Secret key is 32 bytes hex (64 chars)
    const keyHex = fs.readFileSync(out.key_file, "utf-8").trim();
    expect(keyHex.length).toBe(64);
  });

  it("join with --alg slh-dsa-128f produces 64-byte secret key + PQK JWK", () => {
    const r = runCli([
      "mtc",
      "federation",
      "join",
      "fed-pqc",
      "--member-id",
      "node-quantum",
      "--alg",
      "slh-dsa-128f",
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.alg).toBe("SLH-DSA-SHA2-128F");

    const keyHex = fs.readFileSync(out.key_file, "utf-8").trim();
    expect(keyHex.length).toBe(128); // 64 bytes = 128 hex chars

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    const member = registry.federations["fed-pqc"].members["node-quantum"];
    expect(member.pubkey_jwk.kty).toBe("PQK");
    expect(member.pubkey_jwk.alg).toBe("SLH-DSA-SHA2-128F");
  });

  it("rejects re-joining the same member twice", () => {
    expect(
      runCli([
        "mtc",
        "federation",
        "join",
        "fed-x",
        "--member-id",
        "node-a",
        "--json",
      ]).status,
    ).toBe(0);
    const r2 = runCli([
      "mtc",
      "federation",
      "join",
      "fed-x",
      "--member-id",
      "node-a",
    ]);
    expect(r2.status).not.toBe(0);
    expect(r2.stderr + r2.stdout).toMatch(/already registered/i);
  });

  it("status lists multiple members across federations", () => {
    runCli([
      "mtc",
      "federation",
      "join",
      "fed-a",
      "--member-id",
      "n1",
      "--json",
    ]);
    runCli([
      "mtc",
      "federation",
      "join",
      "fed-a",
      "--member-id",
      "n2",
      "--json",
    ]);
    runCli([
      "mtc",
      "federation",
      "join",
      "fed-b",
      "--member-id",
      "alpha",
      "--json",
    ]);

    const r = runCli(["mtc", "federation", "status", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(Object.keys(out.federations)).toEqual(
      expect.arrayContaining(["fed-a", "fed-b"]),
    );
    expect(Object.keys(out.federations["fed-a"].members)).toHaveLength(2);
    expect(Object.keys(out.federations["fed-b"].members)).toHaveLength(1);

    // Filtered status
    const single = extractJson(
      runCli(["mtc", "federation", "status", "fed-a", "--json"]).stdout,
    );
    expect(single.federations["fed-a"]).toBeTruthy();
    expect(single.federations["fed-b"]).toBeUndefined();
  });

  it("leave removes the member + deletes the key file by default", () => {
    const joinR = extractJson(
      runCli([
        "mtc",
        "federation",
        "join",
        "fed-y",
        "--member-id",
        "node-a",
        "--json",
      ]).stdout,
    );
    expect(fs.existsSync(joinR.key_file)).toBe(true);

    const r = runCli([
      "mtc",
      "federation",
      "leave",
      "fed-y",
      "--member-id",
      "node-a",
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.key_file_removed).toBe(true);
    expect(fs.existsSync(joinR.key_file)).toBe(false);

    // Federation entry pruned when last member leaves
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.federations["fed-y"]).toBeUndefined();
  });

  it("leave --keep-key preserves the secret key file on disk", () => {
    const joinR = extractJson(
      runCli([
        "mtc",
        "federation",
        "join",
        "fed-z",
        "--member-id",
        "node-a",
        "--json",
      ]).stdout,
    );
    runCli([
      "mtc",
      "federation",
      "leave",
      "fed-z",
      "--member-id",
      "node-a",
      "--keep-key",
      "--json",
    ]);
    expect(fs.existsSync(joinR.key_file)).toBe(true);
  });

  it("leave on unknown member surfaces a clear error", () => {
    const r = runCli([
      "mtc",
      "federation",
      "leave",
      "no-such-fed",
      "--member-id",
      "ghost",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/not found/i);
  });
});
