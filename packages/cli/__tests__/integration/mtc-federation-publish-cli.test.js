/**
 * Integration test: cc mtc batch / batch-skills with --federation flag (Phase 3.2).
 *
 * Verifies the federation publish path end-to-end:
 *   1. Join a federation with N members
 *   2. Run `cc mtc batch <input> --federation <id>` → multi-sig landmark
 *   3. Read landmark, assert snapshot.signatures has N entries + threshold = M
 *   4. cc mtc verify accepts the federated envelope (multi-alg dispatcher)
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

describe("cc mtc batch --federation — Phase 3.2 marketplace federation", () => {
  let tmpHome;
  let tmpDir;
  let leavesPath;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, USERPROFILE: tmpHome, HOME: tmpHome },
    });
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-fed-pub-home-"));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-fed-pub-out-"));
    leavesPath = path.join(tmpDir, "leaves.json");
    const leaves = Array.from({ length: 4 }, (_, i) => ({
      kind: "did-document",
      content_hash: "sha256:" + Buffer.alloc(32, i).toString("base64url"),
      issued_at: "2026-05-02T10:00:00Z",
      subject: `did:cc:zQ3fed${i}`,
    }));
    fs.writeFileSync(leavesPath, JSON.stringify(leaves, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("3-of-3 Ed25519 federation produces a verifiable landmark", () => {
    // Join 3 Ed25519 members
    for (const m of ["alice", "bob", "carol"]) {
      const r = runCli([
        "mtc",
        "federation",
        "join",
        "fed-marketplace",
        "--member-id",
        m,
        "--alg",
        "ed25519",
        "--json",
      ]);
      expect(r.status, r.stderr).toBe(0);
    }

    // Build a federated batch
    const outDir = path.join(tmpDir, "out-fed");
    const r = runCli([
      "mtc",
      "batch",
      leavesPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:fed-marketplace",
      "--federation",
      "fed-marketplace",
      "--out",
      outDir,
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const out = extractJson(r.stdout);
    expect(out.tree_size).toBe(4);

    // Inspect the landmark — should have 3 signatures + threshold 3 + 3 trust_anchors
    const landmark = JSON.parse(
      fs.readFileSync(path.join(outDir, "landmark.json"), "utf-8"),
    );
    expect(landmark.snapshots[0].signatures).toHaveLength(3);
    expect(landmark.snapshots[0].threshold).toBe(3);
    expect(landmark.snapshots[0].signature).toBeUndefined(); // federation mode skips single-sig field
    expect(landmark.trust_anchors).toHaveLength(3);

    // All 3 signatures should validate against trust_anchors
    for (let i = 0; i < 3; i++) {
      expect(landmark.snapshots[0].signatures[i].alg).toBe("Ed25519");
      expect(landmark.trust_anchors[i].alg).toBe("Ed25519");
    }

    // Verify command must accept the federated envelope
    const verifyR = runCli([
      "mtc",
      "verify",
      path.join(outDir, "envelope-000000.json"),
      "--landmark",
      path.join(outDir, "landmark.json"),
      "--json",
    ]);
    expect(verifyR.status, verifyR.stderr).toBe(0);
    expect(extractJson(verifyR.stdout).ok).toBe(true);
  });

  it("2-of-3 threshold accepts when one member's sig is tampered", () => {
    for (const m of ["a", "b", "c"]) {
      runCli([
        "mtc",
        "federation",
        "join",
        "fed-2of3",
        "--member-id",
        m,
        "--json",
      ]);
    }

    const outDir = path.join(tmpDir, "out-2of3");
    const r = runCli([
      "mtc",
      "batch",
      leavesPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:fed-2of3",
      "--federation",
      "fed-2of3",
      "--threshold",
      "2",
      "--out",
      outDir,
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);

    const landmarkPath = path.join(outDir, "landmark.json");
    const landmark = JSON.parse(fs.readFileSync(landmarkPath, "utf-8"));
    expect(landmark.snapshots[0].threshold).toBe(2);
    expect(landmark.snapshots[0].signatures).toHaveLength(3);

    // Tamper one signature — verify should still succeed (2 valid out of 3, threshold = 2)
    landmark.snapshots[0].signatures[0].sig = Buffer.alloc(64, 0).toString(
      "base64url",
    );
    fs.writeFileSync(landmarkPath, JSON.stringify(landmark, null, 2));

    const verifyR = runCli([
      "mtc",
      "verify",
      path.join(outDir, "envelope-000000.json"),
      "--landmark",
      landmarkPath,
      "--json",
    ]);
    expect(verifyR.status, verifyR.stderr).toBe(0);
    expect(extractJson(verifyR.stdout).ok).toBe(true);
  });

  it("mixed Ed25519 + SLH-DSA federation members produce a heterogeneous landmark", () => {
    runCli([
      "mtc",
      "federation",
      "join",
      "fed-mixed",
      "--member-id",
      "classical",
      "--alg",
      "ed25519",
      "--json",
    ]);
    runCli([
      "mtc",
      "federation",
      "join",
      "fed-mixed",
      "--member-id",
      "pqc",
      "--alg",
      "slh-dsa-128f",
      "--json",
    ]);

    const outDir = path.join(tmpDir, "out-mixed");
    const r = runCli([
      "mtc",
      "batch",
      leavesPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:fed-mixed",
      "--federation",
      "fed-mixed",
      "--out",
      outDir,
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);

    const landmark = JSON.parse(
      fs.readFileSync(path.join(outDir, "landmark.json"), "utf-8"),
    );
    const algs = landmark.snapshots[0].signatures.map((s) => s.alg).sort();
    expect(algs).toEqual(["Ed25519", "SLH-DSA-SHA2-128F"]);

    // The verify command's multi-alg dispatcher handles both
    const verifyR = runCli([
      "mtc",
      "verify",
      path.join(outDir, "envelope-000000.json"),
      "--landmark",
      path.join(outDir, "landmark.json"),
      "--json",
    ]);
    expect(verifyR.status, verifyR.stderr).toBe(0);
    expect(extractJson(verifyR.stdout).ok).toBe(true);
  });

  it("rejects --federation pointing at an unknown federation id", () => {
    const outDir = path.join(tmpDir, "out-bad-fed");
    const r = runCli([
      "mtc",
      "batch",
      leavesPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:fed-x",
      "--federation",
      "nonexistent-fed-id",
      "--out",
      outDir,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/unknown federation/i);
  });

  it("--threshold > N is rejected with a clear error", () => {
    runCli([
      "mtc",
      "federation",
      "join",
      "fed-small",
      "--member-id",
      "only",
      "--json",
    ]);
    const r = runCli([
      "mtc",
      "batch",
      leavesPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:fed-small",
      "--federation",
      "fed-small",
      "--threshold",
      "10",
      "--out",
      path.join(tmpDir, "out-bad-t"),
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/threshold/i);
  });
});
