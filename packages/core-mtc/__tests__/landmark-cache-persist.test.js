import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const {
  MerkleTree,
  encodeHashStr,
  sha256,
  leafHash,
  jcs,
  LandmarkCache,
  alwaysAcceptSignatureVerifier,
  SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK,
} = require("../lib/index.js");

function buildLandmark(rawLeaves, namespace = "mtc/v1/did/000777") {
  const issuer = "mtca:cc:zQ3shPersistTest";
  const leafHashes = rawLeaves.map((l) => leafHash(jcs(l)));
  const tree = new MerkleTree(leafHashes);
  const treeHead = {
    schema: SCHEMA_TREE_HEAD,
    namespace,
    tree_size: leafHashes.length,
    root_hash: encodeHashStr(tree.root()),
    issued_at: "2026-04-26T12:00:00Z",
    expires_at: "2026-05-03T12:00:00Z",
    issuer,
  };
  const treeHeadId = encodeHashStr(sha256(jcs(treeHead)));
  return {
    schema: SCHEMA_LANDMARK,
    namespace: namespace.split("/").slice(0, -1).join("/"),
    snapshots: [
      {
        tree_head: treeHead,
        tree_head_id: treeHeadId,
        signature: { alg: "TEST", issuer, sig: "x", pubkey_id: "sha256:y" },
      },
    ],
    trust_anchors: [{ issuer, alg: "TEST", pubkey_id: "sha256:y" }],
    published_at: "2026-04-26T12:00:00Z",
    publisher_signature: { alg: "TEST", key_id: "k", sig: "s" },
  };
}

describe("LandmarkCache disk persistence", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-cache-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingest writes snapshot file when persistDir set", () => {
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    const lm = buildLandmark([{ k: "a" }, { k: "b" }]);
    cache.ingest(lm);

    const nsDir = path.join(tmpDir, "mtc", "v1", "did", "000777");
    const files = fs.readdirSync(nsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^sha256_.*\.json$/);

    const onDisk = JSON.parse(fs.readFileSync(path.join(nsDir, files[0]), "utf-8"));
    expect(onDisk.tree_head.tree_size).toBe(2);
  });

  it("loadFromDisk restores snapshots into a fresh cache", () => {
    // First cache: write
    const c1 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    c1.ingest(buildLandmark([{ k: 1 }, { k: 2 }, { k: 3 }], "mtc/v1/did/000001"));
    c1.ingest(buildLandmark([{ k: 4 }, { k: 5 }], "mtc/v1/did/000002"));
    expect(c1.size()).toBe(2);

    // Second cache: load
    const c2 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    expect(c2.size()).toBe(0);
    const result = c2.loadFromDisk();
    expect(result.loaded).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(c2.size()).toBe(2);
    expect(c2.namespaces()).toEqual(
      expect.arrayContaining(["mtc/v1/did/000001", "mtc/v1/did/000002"]),
    );
  });

  it("loadFromDisk returns 0 when persistDir doesn't exist yet", () => {
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: path.join(tmpDir, "does-not-exist"),
    });
    const result = cache.loadFromDisk();
    expect(result.loaded).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it("loadFromDisk skips tampered files (signature verifier rejects)", () => {
    const c1 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    c1.ingest(buildLandmark([{ k: 1 }, { k: 2 }]));
    const nsDir = path.join(tmpDir, "mtc", "v1", "did", "000777");
    const files = fs.readdirSync(nsDir);
    const file = path.join(nsDir, files[0]);
    const snap = JSON.parse(fs.readFileSync(file, "utf-8"));
    snap.tree_head.tree_size = 999; // breaks tree_head_id
    fs.writeFileSync(file, JSON.stringify(snap), "utf-8");

    const c2 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    const result = c2.loadFromDisk();
    expect(result.loaded).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe("BAD_TREE_HEAD_ID");
    expect(c2.size()).toBe(0);
  });

  it("loadFromDisk skips files when sig verifier rejects (key changed)", () => {
    const c1 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    c1.ingest(buildLandmark([{ k: 1 }]));

    // Reload with stricter verifier that rejects
    const c2 = new LandmarkCache({
      signatureVerifier: () => false,
      persistDir: tmpDir,
    });
    const result = c2.loadFromDisk();
    expect(result.loaded).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe("BAD_TREE_HEAD_SIG");
  });

  it("loadFromDisk is idempotent", () => {
    const c1 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    c1.ingest(buildLandmark([{ k: 1 }, { k: 2 }]));

    const c2 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    c2.loadFromDisk();
    const sizeAfterFirstLoad = c2.size();
    c2.loadFromDisk();
    expect(c2.size()).toBe(sizeAfterFirstLoad); // duplicates ignored
  });

  it("ingest is idempotent on disk too (overwrites with same content)", () => {
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    const lm = buildLandmark([{ k: 1 }]);
    cache.ingest(lm);
    const nsDir = path.join(tmpDir, "mtc", "v1", "did", "000777");
    const file = fs.readdirSync(nsDir)[0];
    const mtime1 = fs.statSync(path.join(nsDir, file)).mtimeMs;
    // Re-ingest same landmark — already-cached snapshot is "duplicate" → no disk write
    cache.ingest(lm);
    const mtime2 = fs.statSync(path.join(nsDir, file)).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it("loadFromDisk before signatureVerifier throws when no verifier configured", () => {
    const cache = new LandmarkCache({ persistDir: tmpDir });
    // Write a snapshot first using a permissive cache
    const c1 = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
      persistDir: tmpDir,
    });
    c1.ingest(buildLandmark([{ k: 1 }]));

    // Now load with the no-verifier cache — should throw on first snapshot
    const result = cache.loadFromDisk();
    expect(result.loaded).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe("NO_SIGNATURE_VERIFIER");
  });
});
