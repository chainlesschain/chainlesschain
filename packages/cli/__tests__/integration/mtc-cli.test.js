/**
 * Integration test: cc mtc batch / verify / landmark inspect
 *
 * Exercises the CLI surface via subprocess spawn — catches module-loading,
 * Commander parsing, file IO, and exit-code issues that pure-lib tests miss.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
    ...opts,
  });
}

describe("cc mtc — CLI integration", () => {
  let tmpDir;
  let inputPath;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-test-"));
    inputPath = path.join(tmpDir, "leaves.json");
    const leaves = Array.from({ length: 8 }, (_, i) => ({
      kind: "did-document",
      content_hash: "sha256:" + Buffer.alloc(32, i).toString("base64url"),
      issued_at: "2026-04-26T10:00:00Z",
      subject: `did:cc:zQ3shTest${String(i).padStart(3, "0")}`,
      metadata: { version: "1.0.0", supersedes: null },
    }));
    fs.writeFileSync(inputPath, JSON.stringify(leaves, null, 2), "utf-8");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mtc --help lists the three subcommands", () => {
    const r = runCli(["mtc", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/batch/);
    expect(r.stdout).toMatch(/verify/);
    expect(r.stdout).toMatch(/landmark/);
  });

  it("mtc batch produces landmark.json + N envelope files", () => {
    const outDir = path.join(tmpDir, "out-batch");
    const r = runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:zQ3shCliTest",
      "--out",
      outDir,
      "--json",
    ]);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const summary = JSON.parse(r.stdout);
    expect(summary.ok).toBe(true);
    expect(summary.tree_size).toBe(8);
    expect(summary.tree_head_id).toMatch(/^sha256:/);
    expect(summary.root_hash).toMatch(/^sha256:/);
    expect(summary.envelope_paths).toHaveLength(8);

    expect(fs.existsSync(path.join(outDir, "landmark.json"))).toBe(true);
    for (let i = 0; i < 8; i++) {
      const envPath = path.join(
        outDir,
        `envelope-${String(i).padStart(6, "0")}.json`,
      );
      expect(fs.existsSync(envPath)).toBe(true);
    }
  });

  it("mtc verify accepts a valid envelope", () => {
    const outDir = path.join(tmpDir, "out-verify-ok");
    runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000002",
      "--issuer",
      "mtca:cc:zQ3shCliTest",
      "--out",
      outDir,
    ]);

    const r = runCli([
      "mtc",
      "verify",
      path.join(outDir, "envelope-000003.json"),
      "--landmark",
      path.join(outDir, "landmark.json"),
      "--json",
    ]);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.ok).toBe(true);
    expect(result.leaf.subject).toBe("did:cc:zQ3shTest003");
  });

  it("mtc verify rejects a tampered envelope with exit code 2", () => {
    const outDir = path.join(tmpDir, "out-verify-bad");
    runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000003",
      "--issuer",
      "mtca:cc:zQ3shCliTest",
      "--out",
      outDir,
    ]);

    const envPath = path.join(outDir, "envelope-000000.json");
    const env = JSON.parse(fs.readFileSync(envPath, "utf-8"));
    env.leaf.subject = "did:cc:zQ3shATTACKER";
    fs.writeFileSync(envPath, JSON.stringify(env, null, 2), "utf-8");

    const r = runCli([
      "mtc",
      "verify",
      envPath,
      "--landmark",
      path.join(outDir, "landmark.json"),
      "--json",
    ]);
    expect(r.status).toBe(2);
    const result = JSON.parse(r.stdout);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ROOT_MISMATCH");
  });

  it("mtc verify reports LANDMARK_EXPIRED with --now after expires_at", () => {
    const outDir = path.join(tmpDir, "out-verify-expired");
    runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000004",
      "--issuer",
      "mtca:cc:zQ3shCliTest",
      "--issued-at",
      "2026-01-01T00:00:00Z",
      "--expires-at",
      "2026-01-08T00:00:00Z",
      "--out",
      outDir,
    ]);

    const r = runCli([
      "mtc",
      "verify",
      path.join(outDir, "envelope-000000.json"),
      "--landmark",
      path.join(outDir, "landmark.json"),
      "--now",
      "2026-02-01T00:00:00Z",
      "--json",
    ]);
    expect(r.status).toBe(2);
    const result = JSON.parse(r.stdout);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("LANDMARK_EXPIRED");
  });

  it("mtc landmark inspect prints schema + snapshots", () => {
    const outDir = path.join(tmpDir, "out-inspect");
    runCli([
      "mtc",
      "batch",
      inputPath,
      "--namespace",
      "mtc/v1/did/000005",
      "--issuer",
      "mtca:cc:zQ3shCliTest",
      "--out",
      outDir,
    ]);

    const r = runCli([
      "mtc",
      "landmark",
      "inspect",
      path.join(outDir, "landmark.json"),
      "--json",
    ]);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const summary = JSON.parse(r.stdout);
    expect(summary.namespace_prefix).toBe("mtc/v1/did");
    expect(summary.snapshot_count).toBe(1);
    expect(summary.snapshots[0].tree_size).toBe(8);
    expect(summary.snapshots[0].issuer).toBe("mtca:cc:zQ3shCliTest");
  });

  it("mtc batch fails on empty input array", () => {
    const emptyInput = path.join(tmpDir, "empty.json");
    fs.writeFileSync(emptyInput, "[]", "utf-8");
    const r = runCli([
      "mtc",
      "batch",
      emptyInput,
      "--namespace",
      "mtc/v1/did/000099",
      "--issuer",
      "mtca:cc:zQ3shCliTest",
      "--out",
      path.join(tmpDir, "out-empty"),
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/non-empty/);
  });
});
