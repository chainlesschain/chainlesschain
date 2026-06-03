/**
 * Integration test: cc mtc batch with --alg slh-dsa-128f (FIPS 205 post-quantum)
 *
 * Confirms the opt-in PQC signing path produces a verifiable batch end-to-end:
 * sign with SLH-DSA, then verify via cc mtc verify (which uses a multi-alg
 * verifier that handles both Ed25519 and SLH-DSA based on the landmark's
 * trust anchors).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

function runCli(args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: "utf-8",
    timeout: 60_000, // SLH-DSA-128f sign is ~600ms — be generous
  });
}

describe("cc mtc --alg slh-dsa-128f — FIPS 205 post-quantum signing path", () => {
  let tmpDir;
  let inputPath;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-slh-"));
    inputPath = path.join(tmpDir, "leaves.json");
    const leaves = Array.from({ length: 4 }, (_, i) => ({
      kind: "did-document",
      content_hash: "sha256:" + Buffer.alloc(32, i).toString("base64url"),
      issued_at: "2026-05-01T10:00:00Z",
      subject: `did:cc:zQ3shSlhTest${i}`,
    }));
    fs.writeFileSync(inputPath, JSON.stringify(leaves, null, 2), "utf-8");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--alg slh-dsa-128f produces an SLH-DSA-signed landmark + verifiable envelopes", () => {
    const outDir = path.join(tmpDir, "out-slh");
    const r = runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:slh-cli-test",
      "--alg",
      "slh-dsa-128f",
      "--out",
      outDir,
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const summary = JSON.parse(r.stdout);
    expect(summary.ok).toBe(true);
    expect(summary.tree_size).toBe(4);

    const landmark = JSON.parse(
      fs.readFileSync(path.join(outDir, "landmark.json"), "utf-8"),
    );
    expect(landmark.snapshots[0].signature.alg).toBe("SLH-DSA-SHA2-128F");
    expect(landmark.trust_anchors[0].alg).toBe("SLH-DSA-SHA2-128F");
    expect(landmark.trust_anchors[0].pubkey_jwk.kty).toBe("PQK");

    // Signature should be ~17 KB → base64url ~22.7 KB string
    const sigStr = landmark.snapshots[0].signature.sig;
    const sigBytes = Buffer.from(sigStr, "base64url");
    expect(sigBytes.length).toBe(17088);

    // Verify path: cc mtc verify must accept the SLH-DSA envelope (multi-alg dispatcher)
    const verifyR = runCli([
      "mtc",
      "verify",
      path.join(outDir, "envelope-000000.json"),
      "--landmark",
      path.join(outDir, "landmark.json"),
      "--json",
    ]);
    expect(verifyR.status, verifyR.stderr).toBe(0);
    const verifyResult = JSON.parse(verifyR.stdout);
    expect(verifyResult.ok).toBe(true);
  });

  it("rejects unknown --alg with a clear error", () => {
    const outDir = path.join(tmpDir, "out-bad-alg");
    const r = runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000999",
      "--issuer",
      "mtca:cc:bad",
      "--alg",
      "unknown-alg",
      "--out",
      outDir,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/Unknown --alg|supported/i);
  });

  it("--secret-key-file with SLH-DSA persists the 64-byte key for reuse", () => {
    const keyFile = path.join(tmpDir, "slh-key.hex");
    const outDir1 = path.join(tmpDir, "out-slh-1");
    const outDir2 = path.join(tmpDir, "out-slh-2");

    // First run: generates and saves the key
    const r1 = runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000010",
      "--issuer",
      "mtca:cc:slh-persist",
      "--alg",
      "slh-dsa-128f",
      "--secret-key-file",
      keyFile,
      "--out",
      outDir1,
      "--json",
    ]);
    expect(r1.status, r1.stderr).toBe(0);
    expect(fs.existsSync(keyFile)).toBe(true);
    const keyHex = fs.readFileSync(keyFile, "utf-8").trim();
    expect(keyHex.length).toBe(128); // 64 bytes = 128 hex chars

    // Second run: reuses the key — same trust anchor pubkey_id
    const r2 = runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000011",
      "--issuer",
      "mtca:cc:slh-persist",
      "--alg",
      "slh-dsa-128f",
      "--secret-key-file",
      keyFile,
      "--out",
      outDir2,
      "--json",
    ]);
    expect(r2.status, r2.stderr).toBe(0);

    const lm1 = JSON.parse(
      fs.readFileSync(path.join(outDir1, "landmark.json"), "utf-8"),
    );
    const lm2 = JSON.parse(
      fs.readFileSync(path.join(outDir2, "landmark.json"), "utf-8"),
    );
    expect(lm1.trust_anchors[0].pubkey_id).toBe(lm2.trust_anchors[0].pubkey_id);
  });
});
