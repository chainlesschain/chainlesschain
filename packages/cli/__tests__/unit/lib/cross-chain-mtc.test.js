/**
 * Unit tests for cross-chain-mtc lib (跨链桥设计 v0.1).
 * Pure tmp-dir tests — no CLI subprocess, no DB.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getCrossChainMtcDir,
  loadCrossChainMtcConfig,
  saveCrossChainMtcConfig,
  bridgeNamespace,
  isBridgeNamespace,
  loadTrustAnchors,
  addTrustAnchor,
  listTrustAnchors,
  removeTrustAnchor,
  validateBridgeOp,
  assembleBridgeBatch,
  verifyBridgeEnvelope,
  getBridgeMtcStatus,
  stageBridgeOp,
  listStagedOps,
  closeBatch,
  _internal,
} from "../../../src/lib/cross-chain-mtc.js";
import mtcLib from "@chainlesschain/core-mtc";

const { LandmarkCache, ed25519, alwaysAcceptSignatureVerifier } = mtcLib;

describe("cross-chain-mtc lib", () => {
  let configDir;
  let dir;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bridge-mtc-"));
    dir = getCrossChainMtcDir(configDir);
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  // ─── path helpers ────────────────────────────────────────

  describe("getCrossChainMtcDir", () => {
    it("appends cross-chain-mtc segment", () => {
      expect(dir).toBe(path.join(configDir, "cross-chain-mtc"));
    });

    it("throws when configDir missing", () => {
      expect(() => getCrossChainMtcDir()).toThrow(/configDir required/);
    });
  });

  // ─── namespace ───────────────────────────────────────────

  describe("bridgeNamespace", () => {
    it("formats namespace lex-ordered with zero-padded seq", () => {
      expect(bridgeNamespace("polygon", "ethereum", 142)).toBe(
        "mtc/v1/bridge/ethereum-polygon/000142",
      );
    });

    it("orders chain pair lexicographically regardless of arg order", () => {
      const a = bridgeNamespace("ethereum", "polygon", 1);
      const b = bridgeNamespace("polygon", "ethereum", 1);
      expect(a).toBe(b);
    });

    it("supports all 5 chains", () => {
      for (const c of _internal.SUPPORTED_BRIDGE_CHAINS) {
        const other = c === "ethereum" ? "solana" : "ethereum";
        const ns = bridgeNamespace(c, other, 1);
        expect(isBridgeNamespace(ns)).toBe(true);
      }
    });

    it("rejects unsupported chain", () => {
      expect(() => bridgeNamespace("dogecoin", "ethereum", 1)).toThrow(
        /unsupported src chain/,
      );
      expect(() => bridgeNamespace("ethereum", "dogecoin", 1)).toThrow(
        /unsupported dst chain/,
      );
    });

    it("rejects same src/dst chain", () => {
      expect(() => bridgeNamespace("ethereum", "ethereum", 1)).toThrow(
        /must differ/,
      );
    });

    it("rejects non-positive batch seq", () => {
      expect(() => bridgeNamespace("ethereum", "polygon", 0)).toThrow();
      expect(() => bridgeNamespace("ethereum", "polygon", -5)).toThrow();
      expect(() => bridgeNamespace("ethereum", "polygon", "abc")).toThrow();
    });

    it("zero-pads to at least 6 digits", () => {
      expect(bridgeNamespace("ethereum", "polygon", 7)).toMatch(/\/000007$/);
      expect(bridgeNamespace("ethereum", "polygon", 1234567)).toMatch(
        /\/1234567$/,
      );
    });
  });

  describe("isBridgeNamespace", () => {
    it("accepts well-formed bridge namespaces", () => {
      expect(isBridgeNamespace("mtc/v1/bridge/ethereum-polygon/000001")).toBe(
        true,
      );
      expect(isBridgeNamespace("mtc/v1/bridge/arbitrum-bsc/999999")).toBe(true);
    });

    it("rejects non-bridge namespaces", () => {
      expect(isBridgeNamespace("mtc/v1/did/000001")).toBe(false);
      expect(isBridgeNamespace("mtc/v1/skill/000001")).toBe(false);
      expect(isBridgeNamespace("mtc/v1/audit/acme/000001")).toBe(false);
    });

    it("rejects malformed bridge namespaces", () => {
      expect(isBridgeNamespace("mtc/v1/bridge/ethpolygon/000001")).toBe(false);
      expect(isBridgeNamespace("mtc/v1/bridge/ethereum-polygon/12")).toBe(
        false,
      );
      expect(isBridgeNamespace("")).toBe(false);
      expect(isBridgeNamespace(null)).toBe(false);
    });
  });

  // ─── config ──────────────────────────────────────────────

  describe("config", () => {
    it("returns defaults when no config file exists", () => {
      const cfg = loadCrossChainMtcConfig(dir);
      expect(cfg.enabled).toBe(false);
      expect(cfg.batch_interval_seconds).toBe(60);
      expect(cfg.alg).toBe("ed25519");
      expect(cfg.mode).toBe("independent");
    });

    it("persists patches and merges with defaults", () => {
      const updated = saveCrossChainMtcConfig(dir, {
        enabled: true,
        mode: "federated",
      });
      expect(updated.enabled).toBe(true);
      expect(updated.mode).toBe("federated");
      expect(updated.alg).toBe("ed25519"); // unchanged

      const reloaded = loadCrossChainMtcConfig(dir);
      expect(reloaded.enabled).toBe(true);
      expect(reloaded.mode).toBe("federated");
    });

    it("rejects invalid mode", () => {
      expect(() => saveCrossChainMtcConfig(dir, { mode: "bogus" })).toThrow(
        /mode must be/,
      );
    });

    it("rejects invalid alg", () => {
      expect(() => saveCrossChainMtcConfig(dir, { alg: "rsa" })).toThrow(
        /alg must be/,
      );
    });

    it("rejects non-boolean enabled", () => {
      expect(() => saveCrossChainMtcConfig(dir, { enabled: "yes" })).toThrow(
        /enabled must be boolean/,
      );
    });

    it("rejects non-positive batch_interval_seconds", () => {
      expect(() =>
        saveCrossChainMtcConfig(dir, { batch_interval_seconds: 0 }),
      ).toThrow();
    });

    it("throws on malformed JSON", () => {
      saveCrossChainMtcConfig(dir, { enabled: false });
      fs.writeFileSync(path.join(dir, "config.json"), "not json", "utf-8");
      expect(() => loadCrossChainMtcConfig(dir)).toThrow(/malformed/);
    });
  });

  // ─── trust anchors ───────────────────────────────────────

  describe("trust anchors", () => {
    it("returns empty store when no file", () => {
      const store = loadTrustAnchors(dir);
      expect(store.schema).toBe("mtc-bridge-trust-anchors/v1");
      expect(store.anchors).toEqual({});
    });

    it("adds + lists trust anchor for chain", () => {
      const r = addTrustAnchor(dir, "ethereum", {
        pubkey_id: "sha256:abc123",
        alg: "ed25519",
        issuer: "mtca:cc:eth-bridge",
      });
      expect(r.added).toBe(true);
      expect(r.total_for_chain).toBe(1);

      const list = listTrustAnchors(dir, "ethereum");
      expect(list).toHaveLength(1);
      expect(list[0].pubkey_id).toBe("sha256:abc123");
      expect(list[0].added_at).toBeDefined();
    });

    it("dedupes by pubkey_id", () => {
      const anchor = {
        pubkey_id: "sha256:dup",
        alg: "ed25519",
        issuer: "mtca:cc:x",
      };
      const r1 = addTrustAnchor(dir, "ethereum", anchor);
      const r2 = addTrustAnchor(dir, "ethereum", anchor);
      expect(r1.added).toBe(true);
      expect(r2.added).toBe(false);
      expect(listTrustAnchors(dir, "ethereum")).toHaveLength(1);
    });

    it("supports multiple chains independently", () => {
      addTrustAnchor(dir, "ethereum", {
        pubkey_id: "sha256:eth",
        alg: "ed25519",
        issuer: "mtca:cc:eth",
      });
      addTrustAnchor(dir, "polygon", {
        pubkey_id: "sha256:poly",
        alg: "slh-dsa-128f",
        issuer: "mtca:cc:poly",
      });
      const all = listTrustAnchors(dir);
      expect(Object.keys(all).sort()).toEqual(["ethereum", "polygon"]);
      expect(all.ethereum).toHaveLength(1);
      expect(all.polygon).toHaveLength(1);
      expect(all.polygon[0].alg).toBe("slh-dsa-128f");
    });

    it("removes trust anchor by pubkey_id", () => {
      addTrustAnchor(dir, "bsc", {
        pubkey_id: "sha256:keep",
        alg: "ed25519",
        issuer: "mtca:cc:bsc",
      });
      addTrustAnchor(dir, "bsc", {
        pubkey_id: "sha256:drop",
        alg: "ed25519",
        issuer: "mtca:cc:bsc-2",
      });
      const r = removeTrustAnchor(dir, "bsc", "sha256:drop");
      expect(r.removed).toBe(true);
      expect(r.total_for_chain).toBe(1);
      expect(listTrustAnchors(dir, "bsc")[0].pubkey_id).toBe("sha256:keep");
    });

    it("removeTrustAnchor returns removed=false for missing key", () => {
      addTrustAnchor(dir, "solana", {
        pubkey_id: "sha256:sol",
        alg: "ed25519",
        issuer: "mtca:cc:sol",
      });
      const r = removeTrustAnchor(dir, "solana", "sha256:nope");
      expect(r.removed).toBe(false);
      expect(r.total_for_chain).toBe(1);
    });

    it("rejects unsupported chain", () => {
      expect(() =>
        addTrustAnchor(dir, "dogecoin", {
          pubkey_id: "x",
          alg: "ed25519",
          issuer: "y",
        }),
      ).toThrow(/unsupported chain/);
    });

    it("rejects invalid alg", () => {
      expect(() =>
        addTrustAnchor(dir, "ethereum", {
          pubkey_id: "x",
          alg: "rsa",
          issuer: "y",
        }),
      ).toThrow(/alg must be/);
    });

    it("rejects missing pubkey_id / issuer", () => {
      expect(() =>
        addTrustAnchor(dir, "ethereum", { alg: "ed25519", issuer: "y" }),
      ).toThrow(/pubkey_id required/);
      expect(() =>
        addTrustAnchor(dir, "ethereum", { pubkey_id: "x", alg: "ed25519" }),
      ).toThrow(/issuer required/);
    });

    it("throws on schema mismatch in stored file", () => {
      addTrustAnchor(dir, "ethereum", {
        pubkey_id: "x",
        alg: "ed25519",
        issuer: "y",
      });
      fs.writeFileSync(
        path.join(dir, "trust-anchors.json"),
        JSON.stringify({ schema: "wrong/v1", anchors: {} }),
        "utf-8",
      );
      expect(() => loadTrustAnchors(dir)).toThrow(/malformed/);
    });
  });

  // ─── validateBridgeOp ────────────────────────────────────

  describe("validateBridgeOp", () => {
    const ok = {
      bridge_op: "lock",
      src_chain: "ethereum",
      dst_chain: "polygon",
      issued_at: new Date().toISOString(),
    };

    it("accepts a well-formed op", () => {
      expect(validateBridgeOp(ok)).toBe(true);
    });

    it("rejects unknown bridge_op", () => {
      expect(() =>
        validateBridgeOp({ ...ok, bridge_op: "frobnicate" }),
      ).toThrow(/bridge_op must be/);
    });

    it("rejects same src/dst chain", () => {
      expect(() => validateBridgeOp({ ...ok, dst_chain: "ethereum" })).toThrow(
        /must differ/,
      );
    });

    it("rejects unsupported chain", () => {
      expect(() => validateBridgeOp({ ...ok, src_chain: "doge" })).toThrow(
        /unsupported src_chain/,
      );
    });

    it("rejects missing issued_at", () => {
      const { issued_at: _x, ...rest } = ok;
      expect(() => validateBridgeOp(rest)).toThrow(/issued_at/);
    });
  });

  // ─── assembleBridgeBatch + verify round-trip ────────────

  describe("assembleBridgeBatch + verifyBridgeEnvelope", () => {
    let keys;

    beforeEach(() => {
      keys = ed25519.generateKeyPair();
    });

    function makeOps(n = 3) {
      return Array.from({ length: n }, (_, i) => ({
        bridge_op: "lock",
        src_chain: "ethereum",
        dst_chain: "polygon",
        src_tx_hash: `0xabc${i}`,
        amount: String(1000 * (i + 1)),
        asset: "USDC",
        issued_at: new Date().toISOString(),
      }));
    }

    it("assembles a batch with bridge namespace", () => {
      const result = assembleBridgeBatch(makeOps(2), keys, {
        src_chain: "ethereum",
        dst_chain: "polygon",
        batch_seq: 7,
        issuer: "mtca:cc:bridge-test",
      });
      expect(result.namespace).toBe("mtc/v1/bridge/ethereum-polygon/000007");
      expect(result.envelopes).toHaveLength(2);
      expect(result.landmark.snapshots).toHaveLength(1);
    });

    it("validates each op (rejects bad batch entry)", () => {
      const bad = [...makeOps(1), { bridge_op: "evil" }];
      expect(() =>
        assembleBridgeBatch(bad, keys, {
          src_chain: "ethereum",
          dst_chain: "polygon",
          batch_seq: 1,
          issuer: "x",
        }),
      ).toThrow(/bridge_op must be/);
    });

    it("rejects empty bridgeOps", () => {
      expect(() =>
        assembleBridgeBatch([], keys, {
          src_chain: "ethereum",
          dst_chain: "polygon",
          batch_seq: 1,
          issuer: "x",
        }),
      ).toThrow(/non-empty/);
    });

    it("round-trips: envelopes verify against landmark", () => {
      const result = assembleBridgeBatch(makeOps(3), keys, {
        src_chain: "ethereum",
        dst_chain: "polygon",
        batch_seq: 1,
        issuer: "mtca:cc:bridge-test",
      });
      const cache = new LandmarkCache({
        signatureVerifier: alwaysAcceptSignatureVerifier,
      });
      cache.ingest(result.landmark);

      for (const env of result.envelopes) {
        const v = verifyBridgeEnvelope(env, cache);
        expect(v.ok).toBe(true);
        expect(v.bridge_op).toBe("lock");
      }
    });

    it("verifyBridgeEnvelope rejects non-bridge namespace", () => {
      const fake = {
        schema: "mtc-envelope/v1",
        namespace: "mtc/v1/did/000001",
        tree_head_id: "sha256:x",
        leaf: {},
        inclusion_proof: { leaf_index: 0, tree_size: 1, audit_path: [] },
      };
      const cache = new LandmarkCache({
        signatureVerifier: alwaysAcceptSignatureVerifier,
      });
      const v = verifyBridgeEnvelope(fake, cache);
      expect(v.ok).toBe(false);
      expect(v.code).toBe("BAD_BRIDGE_NAMESPACE");
    });

    it("verifyBridgeEnvelope rejects bad leaf shape", () => {
      const result = assembleBridgeBatch(makeOps(1), keys, {
        src_chain: "ethereum",
        dst_chain: "polygon",
        batch_seq: 1,
        issuer: "mtca:cc:bridge-test",
      });
      const env = { ...result.envelopes[0], leaf: { bridge_op: "evil" } };
      const cache = new LandmarkCache({
        signatureVerifier: alwaysAcceptSignatureVerifier,
      });
      cache.ingest(result.landmark);
      const v = verifyBridgeEnvelope(env, cache);
      expect(v.ok).toBe(false);
      expect(v.code).toBe("BAD_BRIDGE_LEAF");
    });

    it("verifyBridgeEnvelope rejects unknown schema", () => {
      const cache = new LandmarkCache({
        signatureVerifier: alwaysAcceptSignatureVerifier,
      });
      const v = verifyBridgeEnvelope(
        { schema: "wrong/v1", namespace: "mtc/v1/bridge/ethereum-polygon/1" },
        cache,
      );
      expect(v.ok).toBe(false);
      expect(v.code).toBe("UNKNOWN_SCHEMA");
    });

    it("verifyBridgeEnvelope rejects null/non-object", () => {
      const cache = new LandmarkCache({
        signatureVerifier: alwaysAcceptSignatureVerifier,
      });
      expect(verifyBridgeEnvelope(null, cache).code).toBe("BAD_ENVELOPE");
      expect(verifyBridgeEnvelope("string", cache).code).toBe("BAD_ENVELOPE");
    });
  });

  // ─── status ──────────────────────────────────────────────

  describe("getBridgeMtcStatus", () => {
    it("reports defaults on fresh dir", () => {
      const s = getBridgeMtcStatus(dir);
      expect(s.enabled).toBe(false);
      expect(s.mode).toBe("independent");
      expect(s.alg).toBe("ed25519");
      expect(s.trust_anchors.total).toBe(0);
      expect(s.trust_anchors.chain_count).toBe(0);
      expect(s.batches.total).toBe(0);
      expect(s.batches.latest).toBeNull();
    });

    it("reflects config + trust anchor changes", () => {
      saveCrossChainMtcConfig(dir, { enabled: true, mode: "federated" });
      addTrustAnchor(dir, "ethereum", {
        pubkey_id: "sha256:eth",
        alg: "ed25519",
        issuer: "mtca:cc:eth",
      });
      addTrustAnchor(dir, "polygon", {
        pubkey_id: "sha256:poly",
        alg: "ed25519",
        issuer: "mtca:cc:poly",
      });

      const s = getBridgeMtcStatus(dir);
      expect(s.enabled).toBe(true);
      expect(s.mode).toBe("federated");
      expect(s.trust_anchors.total).toBe(2);
      expect(s.trust_anchors.chain_count).toBe(2);
      expect(s.trust_anchors.by_chain.ethereum).toBe(1);
      expect(s.trust_anchors.by_chain.polygon).toBe(1);
    });

    it("counts batches on disk and reports latest", () => {
      const batchDir = path.join(dir, "batches");
      fs.mkdirSync(batchDir, { recursive: true });
      fs.mkdirSync(path.join(batchDir, "000001"));
      fs.mkdirSync(path.join(batchDir, "000003"));
      fs.mkdirSync(path.join(batchDir, "000002"));

      const s = getBridgeMtcStatus(dir);
      expect(s.batches.total).toBe(3);
      expect(s.batches.latest).toBe("000003");
    });

    it("reports staging.pending count", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      stageBridgeOp(dir, {
        bridge_op: "lock",
        src_chain: "ethereum",
        dst_chain: "polygon",
        src_tx_hash: "0x1",
        amount: "1",
        asset: "USDC",
        issued_at: new Date().toISOString(),
      });
      const s = getBridgeMtcStatus(dir);
      expect(s.staging.pending).toBe(1);
    });
  });

  // ─── staging + closeBatch ────────────────────────────────

  describe("staging + closeBatch", () => {
    function makeOp(overrides = {}) {
      return {
        bridge_op: "lock",
        src_chain: "ethereum",
        dst_chain: "polygon",
        src_tx_hash: "0xaaa",
        amount: "1000",
        asset: "USDC",
        issued_at: new Date().toISOString(),
        ...overrides,
      };
    }

    it("stageBridgeOp respects requireEnabled=true gate by default", () => {
      const r = stageBridgeOp(dir, makeOp());
      expect(r.staged).toBe(false);
      expect(r.reason).toBe("DISABLED");
    });

    it("stageBridgeOp writes a file when enabled", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const r = stageBridgeOp(dir, makeOp());
      expect(r.staged).toBe(true);
      expect(fs.existsSync(r.path)).toBe(true);
    });

    it("stageBridgeOp dedupes by content (same op twice → one file)", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const op = makeOp();
      const r1 = stageBridgeOp(dir, op);
      const r2 = stageBridgeOp(dir, op);
      expect(r1.staged).toBe(true);
      expect(r2.staged).toBe(false);
      expect(r2.reason).toBe("ALREADY_STAGED");
    });

    it("stageBridgeOp with requireEnabled=false ignores gate", () => {
      const r = stageBridgeOp(dir, makeOp(), { requireEnabled: false });
      expect(r.staged).toBe(true);
    });

    it("stageBridgeOp validates op (rejects bad bridge_op)", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      expect(() => stageBridgeOp(dir, makeOp({ bridge_op: "evil" }))).toThrow(
        /bridge_op must be/,
      );
    });

    it("listStagedOps groups by chain-pair (lex-ordered)", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      stageBridgeOp(
        dir,
        makeOp({
          src_chain: "polygon",
          dst_chain: "ethereum",
          src_tx_hash: "0x1",
        }),
      );
      stageBridgeOp(
        dir,
        makeOp({
          src_chain: "ethereum",
          dst_chain: "polygon",
          src_tx_hash: "0x2",
        }),
      );
      stageBridgeOp(
        dir,
        makeOp({ src_chain: "arbitrum", dst_chain: "bsc", src_tx_hash: "0x3" }),
      );
      const groups = listStagedOps(dir);
      expect(Object.keys(groups).sort()).toEqual([
        "arbitrum-bsc",
        "ethereum-polygon",
      ]);
      expect(groups["ethereum-polygon"]).toHaveLength(2);
      expect(groups["arbitrum-bsc"]).toHaveLength(1);
    });

    it("closeBatch returns NO_STAGED_OPS when staging empty", () => {
      const r = closeBatch(dir);
      expect(r.batches).toHaveLength(0);
      expect(r.skipped.reason).toBe("NO_STAGED_OPS");
    });

    it("closeBatch closes one batch per chain-pair, removes staging", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      stageBridgeOp(dir, makeOp({ src_tx_hash: "0xaaa" }));
      stageBridgeOp(dir, makeOp({ src_tx_hash: "0xbbb" }));
      stageBridgeOp(
        dir,
        makeOp({
          src_chain: "arbitrum",
          dst_chain: "bsc",
          src_tx_hash: "0xccc",
        }),
      );

      const r = closeBatch(dir);
      expect(r.skipped).toBeNull();
      expect(r.batches).toHaveLength(2);
      const ethPoly = r.batches.find((b) => b.pair === "ethereum-polygon");
      const arbBsc = r.batches.find((b) => b.pair === "arbitrum-bsc");
      expect(ethPoly.count).toBe(2);
      expect(arbBsc.count).toBe(1);
      expect(ethPoly.namespace).toBe("mtc/v1/bridge/ethereum-polygon/000001");

      // staging cleared
      expect(listStagedOps(dir)).toEqual({});

      // landmark + envelopes on disk
      expect(fs.existsSync(path.join(ethPoly.dir, "landmark.json"))).toBe(true);
      expect(fs.existsSync(path.join(ethPoly.dir, "envelope-0000.json"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(ethPoly.dir, "envelope-0001.json"))).toBe(
        true,
      );
    });

    it("closeBatch advances per-pair seq across calls", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      stageBridgeOp(dir, makeOp({ src_tx_hash: "0x1" }));
      const r1 = closeBatch(dir);
      stageBridgeOp(dir, makeOp({ src_tx_hash: "0x2" }));
      const r2 = closeBatch(dir);
      expect(r1.batches[0].seq).toBe(1);
      expect(r2.batches[0].seq).toBe(2);
      expect(r2.batches[0].namespace).toMatch(/\/000002$/);
    });

    it("closeBatch produces verifiable envelopes", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      stageBridgeOp(dir, makeOp({ src_tx_hash: "0xaaa" }));
      stageBridgeOp(dir, makeOp({ src_tx_hash: "0xbbb" }));
      const r = closeBatch(dir);
      const batch = r.batches[0];
      const landmark = JSON.parse(
        fs.readFileSync(path.join(batch.dir, "landmark.json"), "utf-8"),
      );
      const env = JSON.parse(
        fs.readFileSync(path.join(batch.dir, "envelope-0000.json"), "utf-8"),
      );
      const cache = new LandmarkCache({
        signatureVerifier: alwaysAcceptSignatureVerifier,
      });
      cache.ingest(landmark);
      const v = verifyBridgeEnvelope(env, cache);
      expect(v.ok).toBe(true);
      expect(v.bridge_op).toBe("lock");
    });
  });
});
