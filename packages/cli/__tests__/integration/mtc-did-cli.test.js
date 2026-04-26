/**
 * Integration test: cc mtc batch-dids reads DIDs from local DB and produces
 * a real Ed25519-signed batch. Round-trips through cc mtc verify.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

/**
 * Extract a JSON object/array from text. Bootstrap logs to stdout
 * (e.g. "[AppConfig] …") so we cannot JSON.parse(stdout) directly.
 */
function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let startLine = 0; startLine < lines.length; startLine++) {
    const trimmed = lines[startLine].trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      for (let endLine = lines.length; endLine > startLine; endLine--) {
        try {
          return JSON.parse(lines.slice(startLine, endLine).join("\n"));
        } catch (_err) {
          // try shorter slice
        }
      }
    }
  }
  throw new Error(`Could not parse JSON from: ${text.slice(0, 300)}`);
}

describe("cc mtc batch-dids — DB integration", () => {
  let homeDir;
  let env;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env,
    });
  }

  beforeAll(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-did-"));
    env = { ...process.env, CHAINLESSCHAIN_HOME: homeDir };

    const r1 = runCli(["did", "create", "--name", "Alice", "--json"]);
    expect(r1.status, `seed alice: ${r1.stderr}`).toBe(0);
    const r2 = runCli(["did", "create", "--name", "Bob", "--json"]);
    expect(r2.status, `seed bob: ${r2.stderr}`).toBe(0);
  });

  afterAll(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("batches all DIDs from DB by default", () => {
    const outDir = path.join(homeDir, "out-all");
    const r = runCli([
      "mtc",
      "batch-dids",
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:zQ3shTest",
      "--out",
      outDir,
      "--json",
    ]);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const summary = extractJson(r.stdout);
    expect(summary.tree_size).toBe(2);
    expect(summary.subjects).toHaveLength(2);
    expect(summary.envelope_paths).toHaveLength(2);
    expect(fs.existsSync(path.join(outDir, "landmark.json"))).toBe(true);
  });

  it("verifies a batched DID envelope end-to-end", () => {
    const outDir = path.join(homeDir, "out-verify");
    const batch = runCli([
      "mtc",
      "batch-dids",
      "--namespace",
      "mtc/v1/did/000002",
      "--issuer",
      "mtca:cc:zQ3shTest",
      "--out",
      outDir,
      "--json",
    ]);
    expect(batch.status, `batch stderr: ${batch.stderr}`).toBe(0);
    const summary = extractJson(batch.stdout);

    const verify = runCli([
      "mtc",
      "verify",
      summary.envelope_paths[0],
      "--landmark",
      path.join(outDir, "landmark.json"),
      "--json",
    ]);
    expect(verify.status, `verify stderr: ${verify.stderr}`).toBe(0);
    const result = extractJson(verify.stdout);
    expect(result.ok).toBe(true);
    expect(result.leaf.kind).toBe("did-document");
    expect(result.leaf.subject).toMatch(/^did:chainless:/);
  });

  it("fails clearly when no DIDs match --did filter", () => {
    const r = runCli([
      "mtc",
      "batch-dids",
      "--namespace",
      "mtc/v1/did/000003",
      "--issuer",
      "mtca:cc:zQ3shTest",
      "--did",
      "did:chainless:NON_EXISTENT",
      "--out",
      path.join(homeDir, "out-nomatch"),
      "--json",
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/No matching DIDs/);
  });

  it("respects --did filter to batch only one identity", () => {
    const all = runCli([
      "mtc",
      "batch-dids",
      "--namespace",
      "mtc/v1/did/000004",
      "--issuer",
      "mtca:cc:zQ3shTest",
      "--out",
      path.join(homeDir, "out-temp"),
      "--json",
    ]);
    expect(all.status, `all stderr: ${all.stderr}`).toBe(0);
    const allSummary = extractJson(all.stdout);
    const oneDid = allSummary.subjects[0];

    const r = runCli([
      "mtc",
      "batch-dids",
      "--namespace",
      "mtc/v1/did/000005",
      "--issuer",
      "mtca:cc:zQ3shTest",
      "--did",
      oneDid,
      "--out",
      path.join(homeDir, "out-filtered"),
      "--json",
    ]);
    expect(r.status, `filtered stderr: ${r.stderr}`).toBe(0);
    const summary = extractJson(r.stdout);
    expect(summary.tree_size).toBe(1);
    expect(summary.subjects).toEqual([oneDid]);
  });
});
