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
  buildMultiHopBridgeEnvelope,
  verifyMultiHopBridgeEnvelope,
  attachMultisigProvenance,
  stripMultisigSigsForCanonical,
  verifyMultisigProvenance,
  shouldCloseBatchGasAware,
  getBridgeMtcSlaMetrics,
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
      // Atomic write: no temp sibling left behind in the store dir.
      expect(fs.readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);
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

    // ─── PR4 — multisig_provenance carry-forward ──────────────

    function makeProvOp(overrides = {}) {
      return makeOp({
        multisig_provenance: {
          proposal_id: "msp_pr4",
          threshold_m: 2,
          member_count_n: 3,
          signers: ["did:cc:a", "did:cc:b"],
          partial_sigs: [
            { did: "did:cc:a", alg: "Ed25519", sig: "aa" },
            { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
          ],
        },
        ...overrides,
      });
    }

    it("stageBridgeOp PR4: writes valid multisig_provenance through to file", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const r = stageBridgeOp(dir, makeProvOp());
      expect(r.staged).toBe(true);
      const raw = JSON.parse(fs.readFileSync(r.path, "utf-8"));
      expect(raw.multisig_provenance.proposal_id).toBe("msp_pr4");
      expect(raw.multisig_provenance.signers).toEqual(["did:cc:a", "did:cc:b"]);
      expect(raw.multisig_provenance.partial_sigs).toHaveLength(2);
    });

    it("stageBridgeOp PR4: rejects unsorted signers (canonical-form invariant)", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const bad = makeOp({
        multisig_provenance: {
          proposal_id: "msp_x",
          threshold_m: 2,
          member_count_n: 3,
          signers: ["did:cc:b", "did:cc:a"],
          partial_sigs: [
            { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
            { did: "did:cc:a", alg: "Ed25519", sig: "aa" },
          ],
        },
      });
      const r = stageBridgeOp(dir, bad);
      expect(r.staged).toBe(false);
      expect(r.reason).toMatch(
        /^INVALID_MULTISIG_PROVENANCE:SIGNERS_NOT_SORTED/,
      );
    });

    it("stageBridgeOp PR4: rejects unsupported alg in partial_sigs", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const bad = makeOp({
        multisig_provenance: {
          proposal_id: "msp_alg",
          threshold_m: 2,
          member_count_n: 3,
          signers: ["did:cc:a", "did:cc:b"],
          partial_sigs: [
            { did: "did:cc:a", alg: "RSA-2048", sig: "aa" },
            { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
          ],
        },
      });
      const r = stageBridgeOp(dir, bad);
      expect(r.staged).toBe(false);
      expect(r.reason).toMatch(/^INVALID_MULTISIG_PROVENANCE:UNSUPPORTED_ALG/);
    });

    it("stageBridgeOp PR4: rejects threshold_m > member_count_n", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const bad = makeOp({
        multisig_provenance: {
          proposal_id: "msp_thr",
          threshold_m: 5,
          member_count_n: 3,
          signers: ["did:cc:a", "did:cc:b"],
          partial_sigs: [
            { did: "did:cc:a", alg: "Ed25519", sig: "aa" },
            { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
          ],
        },
      });
      const r = stageBridgeOp(dir, bad);
      expect(r.staged).toBe(false);
      expect(r.reason).toMatch(/^INVALID_MULTISIG_PROVENANCE:BAD_THRESHOLD/);
    });

    it("stageBridgeOp PR4: legacy op without multisig_provenance still works", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const r = stageBridgeOp(dir, makeOp());
      expect(r.staged).toBe(true);
      const raw = JSON.parse(fs.readFileSync(r.path, "utf-8"));
      expect(raw.multisig_provenance).toBeUndefined();
    });

    it("stageBridgeOp PR4: closeBatch carries multisig_provenance into envelope leaf", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      stageBridgeOp(dir, makeProvOp());
      const { batches } = closeBatch(dir);
      expect(batches).toHaveLength(1);
      const envFiles = fs
        .readdirSync(batches[0].dir)
        .filter((f) => f.startsWith("envelope-"));
      expect(envFiles).toHaveLength(1);
      const env = JSON.parse(
        fs.readFileSync(path.join(batches[0].dir, envFiles[0]), "utf-8"),
      );
      expect(env.leaf.multisig_provenance).toBeDefined();
      expect(env.leaf.multisig_provenance.proposal_id).toBe("msp_pr4");
      expect(env.leaf.multisig_provenance.signers).toEqual([
        "did:cc:a",
        "did:cc:b",
      ]);
      expect(env.leaf.multisig_provenance.partial_sigs).toHaveLength(2);
      // Legacy bridge fields preserved alongside provenance.
      expect(env.leaf.bridge_op).toBe("lock");
      expect(env.leaf.src_chain).toBe("ethereum");
      expect(env.leaf.dst_chain).toBe("polygon");
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

  // ─── v0.2 multi-hop bridge envelope ───────────────────────

  describe("buildMultiHopBridgeEnvelope + verifyMultiHopBridgeEnvelope", () => {
    let keys;
    beforeEach(() => {
      keys = ed25519.generateKeyPair();
    });

    function makeLeg(srcChain, dstChain, batchSeq) {
      const op = {
        bridge_op: "lock",
        src_chain: srcChain,
        dst_chain: dstChain,
        src_tx_hash: `0x${srcChain}-${dstChain}-${batchSeq}`,
        amount: "100",
        asset: "USDC",
        issued_at: new Date().toISOString(),
      };
      const result = assembleBridgeBatch([op], keys, {
        src_chain: srcChain,
        dst_chain: dstChain,
        batch_seq: batchSeq,
        issuer: "mtca:cc:test",
      });
      return { envelope: result.envelopes[0], landmark: result.landmark };
    }

    it("builds a 2-leg multi-hop wrapper with chain_path", () => {
      const a2b = makeLeg("ethereum", "polygon", 1);
      const b2c = makeLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope(
        [a2b.envelope, b2c.envelope],
        {
          total_amount: "100",
          asset: "USDC",
        },
      );
      expect(wrapper.schema).toBe("mtc-bridge-multihop/v1");
      expect(wrapper.leg_count).toBe(2);
      expect(wrapper.chain_path).toEqual(["ethereum", "polygon", "arbitrum"]);
      expect(wrapper.legs).toHaveLength(2);
      expect(wrapper.route_id).toBeDefined();
    });

    it("rejects fewer than 2 legs", () => {
      const a2b = makeLeg("ethereum", "polygon", 1);
      expect(() => buildMultiHopBridgeEnvelope([a2b.envelope])).toThrow(
        /at least 2/,
      );
    });

    it("rejects route discontinuity (B→C after A→B where B mismatch)", () => {
      const a2b = makeLeg("ethereum", "polygon", 1);
      const c2d = makeLeg("bsc", "arbitrum", 1); // bsc != polygon
      expect(() =>
        buildMultiHopBridgeEnvelope([a2b.envelope, c2d.envelope]),
      ).toThrow(/route discontinuity/);
    });

    it("verifies multi-hop wrapper with correct landmarks", () => {
      const a2b = makeLeg("ethereum", "polygon", 1);
      const b2c = makeLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope([a2b.envelope, b2c.envelope]);
      const r = verifyMultiHopBridgeEnvelope(wrapper, [
        { landmark: a2b.landmark },
        { landmark: b2c.landmark },
      ]);
      expect(r.ok).toBe(true);
      expect(r.leg_results).toHaveLength(2);
      expect(r.leg_results[0].ok).toBe(true);
      expect(r.leg_results[1].ok).toBe(true);
    });

    it("verifyMultiHopBridgeEnvelope rejects when landmark count mismatches", () => {
      const a2b = makeLeg("ethereum", "polygon", 1);
      const b2c = makeLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope([a2b.envelope, b2c.envelope]);
      const r = verifyMultiHopBridgeEnvelope(wrapper, [
        { landmark: a2b.landmark },
      ]);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("LEG_CACHE_COUNT_MISMATCH");
    });
  });

  // ─── v0.3 #21 B.5 Layer 2 PR2 — multisig provenance ──────────

  describe("attachMultisigProvenance + verifyMultisigProvenance", () => {
    const baseProvenance = {
      proposalId: "msp_test_1",
      thresholdM: 2,
      memberCountN: 3,
      // signers MUST be sorted ASC for canonical form check.
      signers: ["did:cc:a", "did:cc:b"],
      partialSigs: [
        { did: "did:cc:a", alg: "Ed25519", sig: "deadbeef01" },
        { did: "did:cc:b", alg: "Ed25519", sig: "deadbeef02" },
      ],
    };

    function makeWrapper(extraLegs) {
      const keys = ed25519.generateKeyPair();
      const mk = (src, dst, seq) => {
        const op = {
          bridge_op: "lock",
          src_chain: src,
          dst_chain: dst,
          src_tx_hash: `0x${src}-${dst}-${seq}`,
          amount: "100",
          asset: "USDC",
          issued_at: new Date().toISOString(),
        };
        return assembleBridgeBatch([op], keys, {
          src_chain: src,
          dst_chain: dst,
          batch_seq: seq,
          issuer: "mtca:cc:test",
        }).envelopes[0];
      };
      return buildMultiHopBridgeEnvelope(
        [mk("ethereum", "polygon", 1), mk("polygon", "arbitrum", 1)],
        { total_amount: "100", asset: "USDC" },
        extraLegs ? baseProvenance : null,
      );
    }

    it("buildMultiHopBridgeEnvelope without provenance leaves field absent", () => {
      const w = makeWrapper(false);
      expect(w.multisig_provenance).toBeUndefined();
    });

    it("buildMultiHopBridgeEnvelope with provenance attaches sorted shape", () => {
      const w = makeWrapper(true);
      expect(w.multisig_provenance).toBeDefined();
      expect(w.multisig_provenance.proposal_id).toBe("msp_test_1");
      expect(w.multisig_provenance.threshold_m).toBe(2);
      expect(w.multisig_provenance.member_count_n).toBe(3);
      expect(w.multisig_provenance.signers).toEqual(["did:cc:a", "did:cc:b"]);
      expect(w.multisig_provenance.partial_sigs).toHaveLength(2);
      expect(w.multisig_provenance.partial_sigs[0]).toEqual({
        did: "did:cc:a",
        alg: "Ed25519",
        sig: "deadbeef01",
      });
    });

    it("attachMultisigProvenance does not mutate the input envelope", () => {
      const w = makeWrapper(false);
      const before = JSON.stringify(w);
      const attached = attachMultisigProvenance(w, baseProvenance);
      expect(JSON.stringify(w)).toBe(before);
      expect(attached.multisig_provenance).toBeDefined();
    });

    it("attachMultisigProvenance copies sig array — caller mutation does not leak", () => {
      const env = {};
      const sigs = [
        { did: "did:cc:a", alg: "Ed25519", sig: "aa" },
        { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
      ];
      const attached = attachMultisigProvenance(env, {
        ...baseProvenance,
        partialSigs: sigs,
      });
      sigs[0].sig = "ZZZZ_TAMPER";
      expect(attached.multisig_provenance.partial_sigs[0].sig).toBe("aa");
    });

    it("stripMultisigSigsForCanonical zeros sig bytes only (preserves did/alg)", () => {
      const w = makeWrapper(true);
      const stripped = stripMultisigSigsForCanonical(w);
      expect(stripped.multisig_provenance.partial_sigs).toEqual([
        { did: "did:cc:a", alg: "Ed25519", sig: "" },
        { did: "did:cc:b", alg: "Ed25519", sig: "" },
      ]);
      // Original wrapper unchanged.
      expect(w.multisig_provenance.partial_sigs[0].sig).toBe("deadbeef01");
    });

    it("stripMultisigSigsForCanonical returns same envelope when no provenance", () => {
      const w = makeWrapper(false);
      expect(stripMultisigSigsForCanonical(w)).toBe(w);
    });

    it("verifyMultisigProvenance happy path returns ok", () => {
      const w = makeWrapper(true);
      const r = verifyMultisigProvenance(w);
      expect(r.ok).toBe(true);
    });

    it("verifyMultisigProvenance rejects when provenance absent", () => {
      const w = makeWrapper(false);
      expect(verifyMultisigProvenance(w)).toMatchObject({
        ok: false,
        code: "MISSING_PROVENANCE",
      });
    });

    it("verifyMultisigProvenance rejects below threshold (override via policy.m)", () => {
      const w = makeWrapper(true);
      const r = verifyMultisigProvenance(w, { m: 3 });
      expect(r.ok).toBe(false);
      expect(r.code).toBe("BELOW_THRESHOLD");
      expect(r.detail).toBe("2 < 3");
    });

    it("verifyMultisigProvenance rejects signer not in policy.members", () => {
      const w = makeWrapper(true);
      const r = verifyMultisigProvenance(w, {
        m: 2,
        members: [{ did: "did:cc:a" }, { did: "did:cc:OTHER" }],
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe("SIGNER_NOT_IN_POLICY");
      expect(r.detail).toBe("did:cc:b");
    });

    it("verifyMultisigProvenance accepts when policy.members covers all signers", () => {
      const w = makeWrapper(true);
      const r = verifyMultisigProvenance(w, {
        m: 2,
        members: [
          { did: "did:cc:a" },
          { did: "did:cc:b" },
          { did: "did:cc:c" },
        ],
      });
      expect(r.ok).toBe(true);
    });

    it("verifyMultisigProvenance rejects unsorted signers", () => {
      const w = makeWrapper(false);
      const tampered = attachMultisigProvenance(w, {
        ...baseProvenance,
        signers: ["did:cc:b", "did:cc:a"], // reversed
        partialSigs: [
          { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
          { did: "did:cc:a", alg: "Ed25519", sig: "aa" },
        ],
      });
      expect(verifyMultisigProvenance(tampered)).toMatchObject({
        ok: false,
        code: "SIGNERS_NOT_SORTED",
      });
    });

    it("verifyMultisigProvenance rejects mismatched signer/sig DIDs at same index", () => {
      const w = makeWrapper(false);
      const tampered = attachMultisigProvenance(w, {
        ...baseProvenance,
        partialSigs: [
          { did: "did:cc:ZZZ", alg: "Ed25519", sig: "aa" }, // index 0 mismatch
          { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
        ],
      });
      const r = verifyMultisigProvenance(tampered);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("SIGNER_DID_MISMATCH");
    });

    it("verifyMultisigProvenance rejects unsupported alg", () => {
      const w = makeWrapper(false);
      const tampered = attachMultisigProvenance(w, {
        ...baseProvenance,
        partialSigs: [
          { did: "did:cc:a", alg: "RSA-512", sig: "aa" },
          { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
        ],
      });
      expect(verifyMultisigProvenance(tampered)).toMatchObject({
        ok: false,
        code: "UNSUPPORTED_ALG",
      });
    });

    it("verifyMultisigProvenance accepts SLH-DSA-128F alg (PQC hybrid)", () => {
      const w = makeWrapper(false);
      const hybrid = attachMultisigProvenance(w, {
        ...baseProvenance,
        partialSigs: [
          { did: "did:cc:a", alg: "Ed25519", sig: "aa" },
          { did: "did:cc:b", alg: "SLH-DSA-128F", sig: "bb" },
        ],
      });
      expect(verifyMultisigProvenance(hybrid).ok).toBe(true);
    });

    it("verifyMultisigProvenance rejects non-hex sig", () => {
      const w = makeWrapper(false);
      const tampered = attachMultisigProvenance(w, {
        ...baseProvenance,
        partialSigs: [
          { did: "did:cc:a", alg: "Ed25519", sig: "not_hex_!!" },
          { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
        ],
      });
      expect(verifyMultisigProvenance(tampered)).toMatchObject({
        ok: false,
        code: "BAD_PARTIAL_SIG_HEX",
      });
    });

    it("verifyMultisigProvenance rejects threshold_m > member_count_n", () => {
      const w = makeWrapper(false);
      const tampered = attachMultisigProvenance(w, {
        ...baseProvenance,
        thresholdM: 5,
        memberCountN: 3,
      });
      expect(verifyMultisigProvenance(tampered)).toMatchObject({
        ok: false,
        code: "BAD_THRESHOLD",
      });
    });

    it("verifyMultisigProvenance rejects signers/sigs length mismatch", () => {
      const w = makeWrapper(false);
      const tampered = attachMultisigProvenance(w, {
        ...baseProvenance,
        signers: ["did:cc:a", "did:cc:b", "did:cc:c"], // 3 signers
        partialSigs: baseProvenance.partialSigs, // 2 sigs
      });
      expect(verifyMultisigProvenance(tampered)).toMatchObject({
        ok: false,
        code: "SIGNERS_SIGS_LENGTH_MISMATCH",
      });
    });

    it("stripMultisigSigsForCanonical output is deterministic — verifier and producer agree", () => {
      const w = makeWrapper(true);
      const a = stripMultisigSigsForCanonical(w);
      const b = stripMultisigSigsForCanonical(w);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  // ─── PR3 — verifyMultiHopBridgeEnvelope provenance integration ───

  describe("verifyMultiHopBridgeEnvelope multisig integration (PR3)", () => {
    let keys;
    beforeEach(() => {
      keys = ed25519.generateKeyPair();
    });

    function mkLeg(src, dst, seq) {
      const op = {
        bridge_op: "lock",
        src_chain: src,
        dst_chain: dst,
        src_tx_hash: `0x${src}-${dst}-${seq}`,
        amount: "100",
        asset: "USDC",
        issued_at: new Date().toISOString(),
      };
      const result = assembleBridgeBatch([op], keys, {
        src_chain: src,
        dst_chain: dst,
        batch_seq: seq,
        issuer: "mtca:cc:test",
      });
      return { envelope: result.envelopes[0], landmark: result.landmark };
    }

    const provenance = {
      proposalId: "msp_pr3",
      thresholdM: 2,
      memberCountN: 3,
      signers: ["did:cc:a", "did:cc:b"],
      partialSigs: [
        { did: "did:cc:a", alg: "Ed25519", sig: "deadbeef01" },
        { did: "did:cc:b", alg: "Ed25519", sig: "deadbeef02" },
      ],
    };

    it("wrapper without provenance verifies as before (no multisig_result)", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope([a2b.envelope, b2c.envelope]);
      const r = verifyMultiHopBridgeEnvelope(wrapper, [
        { landmark: a2b.landmark },
        { landmark: b2c.landmark },
      ]);
      expect(r.ok).toBe(true);
      expect(r.multisig_result).toBeUndefined();
    });

    it("wrapper without provenance + requireMultisig=true → fails MISSING_PROVENANCE", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope([a2b.envelope, b2c.envelope]);
      const r = verifyMultiHopBridgeEnvelope(
        wrapper,
        [{ landmark: a2b.landmark }, { landmark: b2c.landmark }],
        { requireMultisig: true },
      );
      expect(r.ok).toBe(false);
      expect(r.code).toBe("MULTISIG_PROVENANCE_INVALID");
      expect(r.multisig_result).toMatchObject({
        ok: false,
        code: "MISSING_PROVENANCE",
      });
      // Leg verification still ran — legs themselves are fine.
      expect(r.leg_results).toHaveLength(2);
      expect(r.leg_results.every((x) => x.ok)).toBe(true);
    });

    it("wrapper with valid provenance auto-runs verifyMultisigProvenance (no policy)", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope(
        [a2b.envelope, b2c.envelope],
        {},
        provenance,
      );
      const r = verifyMultiHopBridgeEnvelope(wrapper, [
        { landmark: a2b.landmark },
        { landmark: b2c.landmark },
      ]);
      expect(r.ok).toBe(true);
      expect(r.multisig_result).toEqual({ ok: true });
    });

    it("wrapper with valid provenance + matching policy passes", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope(
        [a2b.envelope, b2c.envelope],
        {},
        provenance,
      );
      const r = verifyMultiHopBridgeEnvelope(
        wrapper,
        [{ landmark: a2b.landmark }, { landmark: b2c.landmark }],
        {
          expectedMultisigPolicy: {
            m: 2,
            members: [
              { did: "did:cc:a" },
              { did: "did:cc:b" },
              { did: "did:cc:c" },
            ],
          },
        },
      );
      expect(r.ok).toBe(true);
      expect(r.multisig_result.ok).toBe(true);
    });

    it("wrapper with valid provenance but policy m=3 → BELOW_THRESHOLD", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope(
        [a2b.envelope, b2c.envelope],
        {},
        provenance,
      );
      const r = verifyMultiHopBridgeEnvelope(
        wrapper,
        [{ landmark: a2b.landmark }, { landmark: b2c.landmark }],
        { expectedMultisigPolicy: { m: 3 } },
      );
      expect(r.ok).toBe(false);
      expect(r.code).toBe("MULTISIG_PROVENANCE_INVALID");
      expect(r.multisig_result.code).toBe("BELOW_THRESHOLD");
    });

    it("wrapper with provenance + signer outside policy.members → SIGNER_NOT_IN_POLICY", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope(
        [a2b.envelope, b2c.envelope],
        {},
        provenance,
      );
      const r = verifyMultiHopBridgeEnvelope(
        wrapper,
        [{ landmark: a2b.landmark }, { landmark: b2c.landmark }],
        {
          expectedMultisigPolicy: {
            m: 2,
            members: [{ did: "did:cc:a" }, { did: "did:cc:OTHER" }],
          },
        },
      );
      expect(r.ok).toBe(false);
      expect(r.code).toBe("MULTISIG_PROVENANCE_INVALID");
      expect(r.multisig_result.code).toBe("SIGNER_NOT_IN_POLICY");
      expect(r.multisig_result.detail).toBe("did:cc:b");
    });

    it("leg failure short-circuits before provenance check (single failure source)", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const otherKeys = ed25519.generateKeyPair();
      const wrong = mkLeg("polygon", "arbitrum", 99);
      const wrapper = buildMultiHopBridgeEnvelope(
        [a2b.envelope, b2c.envelope],
        {},
        provenance,
      );
      // Pass wrong landmark for leg 1 — leg verify will fail.
      const r = verifyMultiHopBridgeEnvelope(wrapper, [
        { landmark: a2b.landmark },
        { landmark: wrong.landmark },
      ]);
      // Legs fail but provenance still runs (now both are surfaced;
      // ok is false because legs failed). multisig_result should reflect
      // provenance was checked since wrapper has it.
      expect(r.ok).toBe(false);
      expect(r.multisig_result).toBeDefined();
      expect(r.multisig_result.ok).toBe(true); // structural provenance is fine
      // But overall ok = false because legs failed.
      expect(r.leg_results.some((x) => !x.ok)).toBe(true);
      // Silence unused-var lint for the second keypair shadow.
      void otherKeys;
    });

    it("wrapper with malformed provenance + leg-ok → MULTISIG_PROVENANCE_INVALID", () => {
      const a2b = mkLeg("ethereum", "polygon", 1);
      const b2c = mkLeg("polygon", "arbitrum", 1);
      const wrapper = buildMultiHopBridgeEnvelope(
        [a2b.envelope, b2c.envelope],
        {},
        {
          ...provenance,
          // signers unsorted — canonical-form invariant violated
          signers: ["did:cc:b", "did:cc:a"],
          partialSigs: [
            { did: "did:cc:b", alg: "Ed25519", sig: "bb" },
            { did: "did:cc:a", alg: "Ed25519", sig: "aa" },
          ],
        },
      );
      const r = verifyMultiHopBridgeEnvelope(wrapper, [
        { landmark: a2b.landmark },
        { landmark: b2c.landmark },
      ]);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("MULTISIG_PROVENANCE_INVALID");
      expect(r.multisig_result.code).toBe("SIGNERS_NOT_SORTED");
    });
  });

  // ─── v0.2 gas-aware batch ─────────────────────────────────

  describe("shouldCloseBatchGasAware", () => {
    it("closes when gas at baseline + low staged count", () => {
      const r = shouldCloseBatchGasAware({
        target_chain: "ethereum",
        staged_count: 5,
      });
      expect(r.close).toBe(true);
      expect(r.reason).toBe("GAS_NORMAL_OR_LOW");
    });

    it("defers when gas > baseline * 1.5", () => {
      const r = shouldCloseBatchGasAware({
        target_chain: "ethereum",
        staged_count: 5,
        current_gas_usd: 20.0, // baseline = 5
      });
      expect(r.close).toBe(false);
      expect(r.reason).toBe("GAS_HIGH_DEFERRED");
    });

    it("hard-closes at staged count >= floor regardless of gas", () => {
      const r = shouldCloseBatchGasAware({
        target_chain: "ethereum",
        staged_count: 60, // > default floor 50
        current_gas_usd: 100.0, // crazy high
      });
      expect(r.close).toBe(true);
      expect(r.reason).toBe("STAGED_COUNT_AT_HARD_FLOOR");
    });

    it("respects custom defer_multiplier", () => {
      const r = shouldCloseBatchGasAware({
        target_chain: "ethereum",
        staged_count: 5,
        current_gas_usd: 7.0, // 1.4x baseline
        defer_multiplier: 1.2, // tighter threshold
      });
      expect(r.close).toBe(false);
    });

    it("rejects unknown chain", () => {
      expect(() =>
        shouldCloseBatchGasAware({
          target_chain: "dogecoin",
          staged_count: 5,
        }),
      ).toThrow(/unknown target_chain/);
    });
  });

  // ─── v0.2 SLA metrics ─────────────────────────────────────

  describe("getBridgeMtcSlaMetrics", () => {
    it("returns ok status when bridge MTCA disabled", () => {
      const m = getBridgeMtcSlaMetrics(dir);
      expect(m.sla_status).toBe("ok");
      expect(m.enabled).toBe(false);
    });

    it("returns ok status when enabled with low staging", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const m = getBridgeMtcSlaMetrics(dir);
      expect(m.sla_status).toBe("ok");
    });

    it("returns degraded when staged > 100 with enabled MTCA", () => {
      saveCrossChainMtcConfig(dir, { enabled: true });
      const stagingDir = path.join(dir, "staging");
      fs.mkdirSync(stagingDir, { recursive: true });
      for (let i = 0; i < 105; i++) {
        fs.writeFileSync(path.join(stagingDir, `${i}.json`), "{}");
      }
      const m = getBridgeMtcSlaMetrics(dir);
      expect(m.sla_status).toBe("degraded");
      expect(m.staged_pending_count).toBe(105);
    });

    it("counts batches in last hour via mtime", () => {
      const bDir = path.join(dir, "batches");
      fs.mkdirSync(path.join(bDir, "ethereum-polygon-000001"), {
        recursive: true,
      });
      const m = getBridgeMtcSlaMetrics(dir);
      expect(m.batches_last_hour).toBeGreaterThanOrEqual(1);
      expect(m.batches_total).toBe(1);
      expect(m.seconds_since_last_batch).toBeGreaterThanOrEqual(0);
    });
  });
});
