/**
 * E2E test: cross-chain bridge MTC integration (跨链桥设计 v0.1).
 *
 * Goes beyond unit/integration by:
 *   1. Spawning the real CLI for every step (multiple distinct processes)
 *   2. Verifying landmark/envelope files cryptographically with core-mtc
 *      directly — proves on-disk artifacts are spec-compliant and
 *      independently verifiable, not just internally self-consistent
 *   3. Tampering with envelopes to assert verification fails
 *   4. Driving the staging → mtc-batch → mtc-verify flow across processes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import mtcLib from "@chainlesschain/core-mtc";

const { LandmarkCache, alwaysAcceptSignatureVerifier } = mtcLib;

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args, { allowFail = false } = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  if (!allowFail && result.status !== 0) {
    throw new Error(
      `cc ${args.join(" ")} failed (exit ${result.status})\n` +
        `--- stdout ---\n${result.stdout}\n` +
        `--- stderr ---\n${result.stderr}`,
    );
  }
  return result;
}

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

describe("cc crosschain MTC — E2E", () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "cc-bridge-mtc-e2e-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function writeEnabledConfig() {
    const dir = join(tmpHome, "cross-chain-mtc");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify(
        {
          enabled: true,
          batch_interval_seconds: 60,
          alg: "ed25519",
          mode: "independent",
          issuer: "mtca:cc:bridge-e2e",
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  function writeStagedOp(overrides = {}) {
    writeEnabledConfig();
    const stagingDir = join(tmpHome, "cross-chain-mtc", "staging");
    mkdirSync(stagingDir, { recursive: true });
    const op = {
      bridge_op: "lock",
      src_chain: "ethereum",
      dst_chain: "polygon",
      src_tx_hash: `0x${Math.random().toString(16).slice(2, 10)}`,
      amount: "1000",
      asset: "USDC",
      issued_at: new Date().toISOString(),
      ...overrides,
    };
    const ts = new Date(op.issued_at)
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 17);
    const pair = [op.src_chain, op.dst_chain].sort().join("-");
    const tail = Math.random().toString(16).slice(2, 10);
    const file = join(stagingDir, `${ts}-${pair}-${tail}.json`);
    writeFileSync(file, JSON.stringify(op), "utf-8");
    return { file, op };
  }

  it("E2E: stage → batch → verify (cross-process) round-trip", () => {
    // Stage 3 ops across 2 chain-pairs
    writeStagedOp({ src_chain: "ethereum", dst_chain: "polygon" });
    writeStagedOp({ src_chain: "ethereum", dst_chain: "polygon" });
    writeStagedOp({ src_chain: "arbitrum", dst_chain: "bsc" });

    // Process 1: close batches
    const batchResult = extractJson(
      run(["crosschain", "mtc-batch", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    expect(batchResult.batches).toHaveLength(2);

    // Process 2: verify each envelope via separate cc process
    for (const b of batchResult.batches) {
      const envelopes = readdirSync(b.dir).filter((f) =>
        f.startsWith("envelope-"),
      );
      expect(envelopes.length).toBe(b.count);
      for (const e of envelopes) {
        const envPath = join(b.dir, e);
        const lmPath = join(b.dir, "landmark.json");
        const v = run(["crosschain", "mtc-verify", envPath, lmPath, "--json"]);
        const vJson = extractJson(v.stdout);
        expect(vJson.ok).toBe(true);
        expect(vJson.bridge_op).toBe("lock");
      }
    }
  });

  it("E2E: independently verifies on-disk landmark + envelope using core-mtc directly", () => {
    writeStagedOp();
    writeStagedOp();
    const batchResult = extractJson(
      run(["crosschain", "mtc-batch", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    const batch = batchResult.batches[0];

    const landmark = JSON.parse(
      readFileSync(join(batch.dir, "landmark.json"), "utf-8"),
    );
    const envelopes = readdirSync(batch.dir)
      .filter((f) => f.startsWith("envelope-"))
      .sort();
    expect(envelopes.length).toBe(2);

    // Spec-compliance check: landmark schema + namespace shape
    expect(landmark.schema).toBe("mtc-landmark/v1");
    expect(landmark.namespace).toBe("mtc/v1/bridge/ethereum-polygon");
    expect(landmark.snapshots).toHaveLength(1);
    expect(landmark.snapshots[0].tree_head.tree_size).toBe(2);

    // Independent verification using core-mtc verify (not the wrapper)
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    cache.ingest(landmark);

    for (const fileName of envelopes) {
      const env = JSON.parse(readFileSync(join(batch.dir, fileName), "utf-8"));
      const result = mtcLib.verify(env, cache);
      expect(result.ok).toBe(true);
    }
  });

  it("E2E: tampered envelope fails verification (cross-process)", () => {
    writeStagedOp();
    const batchResult = extractJson(
      run(["crosschain", "mtc-batch", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    const batch = batchResult.batches[0];
    const envPath = join(batch.dir, "envelope-0000.json");
    const lmPath = join(batch.dir, "landmark.json");

    // Tamper: change leaf amount
    const original = JSON.parse(readFileSync(envPath, "utf-8"));
    const tampered = {
      ...original,
      leaf: { ...original.leaf, amount: "999999" },
    };
    const tamperedPath = join(tmpHome, "tampered.json");
    writeFileSync(tamperedPath, JSON.stringify(tampered), "utf-8");

    const v = run(
      ["crosschain", "mtc-verify", tamperedPath, lmPath, "--json"],
      { allowFail: true },
    );
    expect(v.status).not.toBe(0);
    const vJson = extractJson(v.stdout);
    expect(vJson.ok).toBe(false);
  });

  it("E2E: trust-anchor add → list survives cross-process", () => {
    run([
      "crosschain",
      "mtc-trust-anchor",
      "add",
      "ethereum",
      "sha256:e2e-anchor-1",
      "--alg",
      "ed25519",
      "--issuer",
      "mtca:cc:e2e",
      "--config-dir",
      tmpHome,
      "--json",
    ]);
    run([
      "crosschain",
      "mtc-trust-anchor",
      "add",
      "polygon",
      "sha256:e2e-anchor-2",
      "--alg",
      "slh-dsa-128f",
      "--issuer",
      "mtca:cc:e2e-poly",
      "--config-dir",
      tmpHome,
      "--json",
    ]);

    // separate process: list and verify both anchors persisted
    const list = extractJson(
      run([
        "crosschain",
        "mtc-trust-anchor",
        "list",
        "--config-dir",
        tmpHome,
        "--json",
      ]).stdout,
    );
    expect(Object.keys(list).sort()).toEqual(["ethereum", "polygon"]);
    expect(list.ethereum[0].pubkey_id).toBe("sha256:e2e-anchor-1");
    expect(list.polygon[0].alg).toBe("slh-dsa-128f");
  });

  it("E2E: status reflects state after batch close", () => {
    writeStagedOp();
    writeStagedOp({ src_chain: "arbitrum", dst_chain: "bsc" });
    run(["crosschain", "mtc-batch", "--config-dir", tmpHome, "--json"]);

    const status = extractJson(
      run(["crosschain", "mtc-status", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    expect(status.staging.pending).toBe(0);
    expect(status.batches.total).toBe(2);
    expect(status.batches.latest).toMatch(/-000001$/);
  });

  it("E2E: per-pair seq advances across multiple batch closes", () => {
    writeStagedOp({ src_tx_hash: "0xa1" });
    const r1 = extractJson(
      run(["crosschain", "mtc-batch", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    expect(r1.batches[0].seq).toBe(1);

    writeStagedOp({ src_tx_hash: "0xa2" });
    const r2 = extractJson(
      run(["crosschain", "mtc-batch", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    expect(r2.batches[0].seq).toBe(2);
    expect(r2.batches[0].namespace).toMatch(/\/000002$/);
  });

  it("E2E: namespace lex-ordering preserved across both batch sides", () => {
    // Stage with reversed order — should still land on canonical pair
    writeStagedOp({
      src_chain: "polygon",
      dst_chain: "ethereum",
      src_tx_hash: "0xa",
    });
    const r = extractJson(
      run(["crosschain", "mtc-batch", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    // listStagedOps groups by sorted pair, so namespace = ethereum-polygon
    // even though staged op had polygon→ethereum. assembleBridgeBatch then
    // also lex-sorts (via bridgeNamespace), so the namespace is canonical.
    expect(r.batches[0].pair).toBe("ethereum-polygon");
    expect(r.batches[0].namespace).toBe(
      "mtc/v1/bridge/ethereum-polygon/000001",
    );
  });
});
