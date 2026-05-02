/**
 * Integration test: cc crosschain mtc-* (跨链桥设计 v0.1).
 * Drives the CLI via subprocess and asserts:
 *   - mtc-status defaults + JSON shape
 *   - mtc-trust-anchor add/list/remove round-trip
 *   - mtc-envelope generates a parseable result and feeds mtc-verify
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
          /* try shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 300)}`);
}

describe("cc crosschain mtc-* — CLI integration", () => {
  let tmpHome;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bridge-mtc-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("mtc-status", () => {
    it("reports defaults on a fresh dir", () => {
      const r = runCli([
        "crosschain",
        "mtc-status",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const json = extractJson(r.stdout);
      expect(json.enabled).toBe(false);
      expect(json.mode).toBe("independent");
      expect(json.alg).toBe("ed25519");
      expect(json.batch_interval_seconds).toBe(60);
      expect(json.trust_anchors.total).toBe(0);
      expect(json.batches.total).toBe(0);
    });

    it("text output includes opt-in hint when disabled", () => {
      const r = runCli(["crosschain", "mtc-status", "--config-dir", tmpHome]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/opt-in/);
      expect(r.stdout).toMatch(/Mode:\s+independent/);
    });
  });

  describe("mtc-trust-anchor", () => {
    it("add → list → remove round-trip", () => {
      // add
      const add = runCli([
        "crosschain",
        "mtc-trust-anchor",
        "add",
        "ethereum",
        "sha256:abc123",
        "--alg",
        "ed25519",
        "--issuer",
        "mtca:cc:eth-bridge",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(add.status).toBe(0);
      const addJson = extractJson(add.stdout);
      expect(addJson.added).toBe(true);
      expect(addJson.total_for_chain).toBe(1);

      // list
      const list = runCli([
        "crosschain",
        "mtc-trust-anchor",
        "list",
        "ethereum",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(list.status).toBe(0);
      const listJson = extractJson(list.stdout);
      expect(listJson).toHaveLength(1);
      expect(listJson[0].pubkey_id).toBe("sha256:abc123");
      expect(listJson[0].alg).toBe("ed25519");

      // dedupe on second add
      const addAgain = runCli([
        "crosschain",
        "mtc-trust-anchor",
        "add",
        "ethereum",
        "sha256:abc123",
        "--alg",
        "ed25519",
        "--issuer",
        "mtca:cc:eth-bridge",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(extractJson(addAgain.stdout).added).toBe(false);

      // remove
      const rm = runCli([
        "crosschain",
        "mtc-trust-anchor",
        "remove",
        "ethereum",
        "sha256:abc123",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(rm.status).toBe(0);
      const rmJson = extractJson(rm.stdout);
      expect(rmJson.removed).toBe(true);
      expect(rmJson.total_for_chain).toBe(0);
    });

    it("list with no chain shows all chains", () => {
      runCli([
        "crosschain",
        "mtc-trust-anchor",
        "add",
        "ethereum",
        "sha256:eth",
        "--alg",
        "ed25519",
        "--issuer",
        "mtca:cc:eth",
        "--config-dir",
        tmpHome,
      ]);
      runCli([
        "crosschain",
        "mtc-trust-anchor",
        "add",
        "polygon",
        "sha256:poly",
        "--alg",
        "slh-dsa-128f",
        "--issuer",
        "mtca:cc:poly",
        "--config-dir",
        tmpHome,
      ]);
      const all = runCli([
        "crosschain",
        "mtc-trust-anchor",
        "list",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(all.status).toBe(0);
      const allJson = extractJson(all.stdout);
      expect(Object.keys(allJson).sort()).toEqual(["ethereum", "polygon"]);
      expect(allJson.polygon[0].alg).toBe("slh-dsa-128f");
    });

    it("rejects unsupported chain", () => {
      const r = runCli([
        "crosschain",
        "mtc-trust-anchor",
        "add",
        "dogecoin",
        "sha256:x",
        "--alg",
        "ed25519",
        "--issuer",
        "y",
        "--config-dir",
        tmpHome,
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr || r.stdout).toMatch(/unsupported chain/);
    });
  });

  describe("mtc-envelope + mtc-verify round-trip", () => {
    it("generates an envelope that round-trip verifies against its landmark", () => {
      const opsFile = path.join(tmpHome, "ops.json");
      const ops = [
        {
          bridge_op: "lock",
          src_chain: "ethereum",
          dst_chain: "polygon",
          src_tx_hash: "0xaaa",
          amount: "1000",
          asset: "USDC",
          issued_at: new Date().toISOString(),
        },
        {
          bridge_op: "lock",
          src_chain: "ethereum",
          dst_chain: "polygon",
          src_tx_hash: "0xbbb",
          amount: "2000",
          asset: "USDC",
          issued_at: new Date().toISOString(),
        },
      ];
      fs.writeFileSync(opsFile, JSON.stringify(ops));

      const env = runCli([
        "crosschain",
        "mtc-envelope",
        "--input",
        opsFile,
        "--src-chain",
        "ethereum",
        "--dst-chain",
        "polygon",
        "--batch-seq",
        "42",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(env.status).toBe(0);
      const result = extractJson(env.stdout);
      expect(result.namespace).toBe("mtc/v1/bridge/ethereum-polygon/000042");
      expect(result.envelopes).toHaveLength(2);

      // Persist envelope + landmark to disk and verify
      const envPath = path.join(tmpHome, "envelope-0.json");
      const lmPath = path.join(tmpHome, "landmark.json");
      fs.writeFileSync(envPath, JSON.stringify(result.envelopes[0]));
      fs.writeFileSync(lmPath, JSON.stringify(result.landmark));

      const verify = runCli([
        "crosschain",
        "mtc-verify",
        envPath,
        lmPath,
        "--json",
      ]);
      expect(verify.status).toBe(0);
      const v = extractJson(verify.stdout);
      expect(v.ok).toBe(true);
      expect(v.bridge_op).toBe("lock");
    });

    it("mtc-verify exits non-zero on tampered envelope", () => {
      const opsFile = path.join(tmpHome, "ops.json");
      fs.writeFileSync(
        opsFile,
        JSON.stringify([
          {
            bridge_op: "lock",
            src_chain: "ethereum",
            dst_chain: "polygon",
            src_tx_hash: "0x1",
            amount: "1",
            asset: "USDC",
            issued_at: new Date().toISOString(),
          },
        ]),
      );
      const env = runCli([
        "crosschain",
        "mtc-envelope",
        "--input",
        opsFile,
        "--src-chain",
        "ethereum",
        "--dst-chain",
        "polygon",
        "--batch-seq",
        "1",
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      const result = extractJson(env.stdout);
      // Tamper: change leaf amount
      const tampered = {
        ...result.envelopes[0],
        leaf: { ...result.envelopes[0].leaf, amount: "999999" },
      };
      const envPath = path.join(tmpHome, "tampered.json");
      const lmPath = path.join(tmpHome, "landmark.json");
      fs.writeFileSync(envPath, JSON.stringify(tampered));
      fs.writeFileSync(lmPath, JSON.stringify(result.landmark));

      const v = runCli(["crosschain", "mtc-verify", envPath, lmPath, "--json"]);
      expect(v.status).not.toBe(0);
      const vJson = extractJson(v.stdout);
      expect(vJson.ok).toBe(false);
    });
  });

  describe("--help wiring", () => {
    it("crosschain --help lists mtc-* subcommands", () => {
      const r = runCli(["crosschain", "--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/mtc-status/);
      expect(r.stdout).toMatch(/mtc-envelope/);
      expect(r.stdout).toMatch(/mtc-verify/);
      expect(r.stdout).toMatch(/mtc-trust-anchor/);
    });
  });
});
