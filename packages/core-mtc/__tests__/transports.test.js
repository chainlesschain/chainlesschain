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
  verify,
  TREE_HEAD_SIG_PREFIX,
  SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK,
  ed25519,
} = require("../lib/index.js");

const transports = require("../lib/transports/index.js");
const {
  InMemoryBroker,
  InMemoryTransport,
  FilesystemTransport,
  namespaceToPrefix,
  prefixMatches,
  validateNamespacePrefix,
} = transports;

const NS = "mtc/v1/did/000007";

function buildSignedFixture(namespace = NS) {
  const keys = ed25519.generateKeyPair();
  const issuer = "mtca:cc:zQ3shTransportTest";
  const rawLeaves = Array.from({ length: 4 }, (_, i) => ({
    kind: "did-document",
    content_hash: encodeHashStr(sha256(Buffer.from(`x${i}`))),
    issued_at: "2026-04-26T10:00:00Z",
    subject: `did:cc:zQ3shTransportTest${i}`,
    metadata: { version: "1.0.0", supersedes: null },
  }));
  const tree = new MerkleTree(rawLeaves.map((l) => leafHash(jcs(l))));
  const treeHead = {
    schema: SCHEMA_TREE_HEAD,
    namespace,
    tree_size: rawLeaves.length,
    root_hash: encodeHashStr(tree.root()),
    issued_at: "2026-04-26T12:00:00Z",
    expires_at: "2026-05-03T12:00:00Z",
    issuer,
  };
  const canonical = jcs(treeHead);
  const treeHeadId = encodeHashStr(sha256(canonical));
  const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, canonical]);
  const signature = ed25519.signTreeHead(signingInput, {
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    issuer,
  });
  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: namespace.split("/").slice(0, -1).join("/"),
    snapshots: [{ tree_head: treeHead, tree_head_id: treeHeadId, signature }],
    trust_anchors: [ed25519.trustAnchorEntry(keys.publicKey, issuer)],
    published_at: "2026-04-26T12:00:00Z",
    publisher_signature: { alg: "Ed25519", key_id: "k", sig: "s" },
  };
  return { keys, rawLeaves, tree, landmark, treeHeadId, namespace };
}

describe("transport helpers", () => {
  it("namespaceToPrefix strips the trailing batch-seq", () => {
    expect(namespaceToPrefix("mtc/v1/did/000142")).toBe("mtc/v1/did");
    expect(namespaceToPrefix("mtc/v1/audit/acme/000007")).toBe("mtc/v1/audit/acme");
  });

  it("prefixMatches handles equal / broader / mismatched", () => {
    expect(prefixMatches("mtc/v1/did", "mtc/v1/did")).toBe(true);
    expect(prefixMatches("mtc/v1/did", "mtc/v1/audit")).toBe(false);
    expect(prefixMatches("mtc/v1/audit", "mtc/v1/audit/acme")).toBe(true);
    expect(prefixMatches("mtc/v1/audit/acme", "mtc/v1/audit/globex")).toBe(false);
  });

  it("validateNamespacePrefix rejects malformed inputs", () => {
    expect(() => validateNamespacePrefix("mtc/v1/did/000001")).toThrow();
    expect(() => validateNamespacePrefix("mtc/v2/did")).toThrow();
    expect(() => validateNamespacePrefix("did")).toThrow();
    expect(() => validateNamespacePrefix("")).toThrow();
  });
});

describe("InMemoryTransport", () => {
  it("publish + subscribe delivers announcement to matching prefix", () => {
    const broker = new InMemoryBroker();
    const t = new InMemoryTransport(broker);
    const events = [];
    t.subscribe("mtc/v1/did", (ann) => events.push(ann));
    const fixture = buildSignedFixture();
    t.publish(fixture.landmark);
    expect(events).toHaveLength(1);
    expect(events[0].namespace).toBe(NS);
    expect(events[0].cid).toMatch(/^ipfs:/);
    t.close();
  });

  it("subscribe with non-matching prefix doesn't receive", () => {
    const broker = new InMemoryBroker();
    const t = new InMemoryTransport(broker);
    const events = [];
    t.subscribe("mtc/v1/skill", (ann) => events.push(ann));
    t.publish(buildSignedFixture().landmark);
    expect(events).toHaveLength(0);
    t.close();
  });

  it("fetch returns the published landmark by CID", async () => {
    const broker = new InMemoryBroker();
    const t = new InMemoryTransport(broker);
    const fixture = buildSignedFixture();
    const ann = await t.publish(fixture.landmark);
    const fetched = await t.fetch(ann.cid);
    expect(fetched).toEqual(fixture.landmark);
    t.close();
  });

  it("fetch unknown CID throws CID_NOT_FOUND", async () => {
    const broker = new InMemoryBroker();
    const t = new InMemoryTransport(broker);
    await expect(t.fetch("ipfs:nonexistent")).rejects.toThrow(/CID_NOT_FOUND|CID not found/);
    t.close();
  });

  it("close stops new operations", async () => {
    const broker = new InMemoryBroker();
    const t = new InMemoryTransport(broker);
    t.close();
    await expect(t.publish(buildSignedFixture().landmark)).rejects.toThrow(/closed/);
  });
});

describe("FilesystemTransport", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-fs-transport-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("publish writes content + announcement files; fetch returns content", async () => {
    const t = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });
    const fixture = buildSignedFixture();
    const ann = await t.publish(fixture.landmark);
    expect(fs.readdirSync(path.join(tmpDir, "content"))).toHaveLength(1);
    expect(fs.readdirSync(path.join(tmpDir, "announcements"))).toHaveLength(1);
    const fetched = await t.fetch(ann.cid);
    expect(fetched).toEqual(fixture.landmark);
    t.close();
  });

  it("subscribe replays existing announcements on subscribe", async () => {
    const tA = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });
    await tA.publish(buildSignedFixture("mtc/v1/did/000001").landmark);
    await tA.publish(buildSignedFixture("mtc/v1/did/000002").landmark);
    tA.close();

    const tB = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });
    const events = [];
    tB.subscribe("mtc/v1/did", (a) => events.push(a));
    expect(events).toHaveLength(2);
    tB.close();
  });

  it("drain picks up announcements published after subscribe", async () => {
    const t = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });
    const events = [];
    t.subscribe("mtc/v1/did", (a) => events.push(a));
    expect(events).toHaveLength(0);

    await t.publish(buildSignedFixture("mtc/v1/did/000001").landmark);
    t.drain();
    expect(events).toHaveLength(1);

    await t.publish(buildSignedFixture("mtc/v1/did/000002").landmark);
    t.drain();
    expect(events).toHaveLength(2);
    t.close();
  });

  it("subscribe filters by namespace prefix", async () => {
    const t = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });
    const didEvents = [];
    const skillEvents = [];
    t.subscribe("mtc/v1/did", (a) => didEvents.push(a));
    t.subscribe("mtc/v1/skill", (a) => skillEvents.push(a));

    await t.publish(buildSignedFixture("mtc/v1/did/000001").landmark);
    await t.publish(buildSignedFixture("mtc/v1/skill/000001").landmark);
    t.drain();

    expect(didEvents).toHaveLength(1);
    expect(skillEvents).toHaveLength(1);
    expect(didEvents[0].namespace).toMatch(/^mtc\/v1\/did\//);
    expect(skillEvents[0].namespace).toMatch(/^mtc\/v1\/skill\//);
    t.close();
  });

  it("each subscriber sees each announcement exactly once", async () => {
    const t = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });
    const events = [];
    t.subscribe("mtc/v1/did", (a) => events.push(a));
    await t.publish(buildSignedFixture("mtc/v1/did/000001").landmark);
    t.drain();
    t.drain(); // second drain — nothing new
    t.drain();
    expect(events).toHaveLength(1);
    t.close();
  });
});

describe("Two-node end-to-end via transport", () => {
  it("InMemory: node A publishes signed batch → node B verifies envelope", async () => {
    const broker = new InMemoryBroker();
    const transportA = new InMemoryTransport(broker);
    const transportB = new InMemoryTransport(broker);

    // Node A: build + sign + publish
    const fixture = buildSignedFixture();
    const annA = await transportA.publish(fixture.landmark);

    // Node B: subscribe + fetch + ingest into local cache
    const cacheB = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(fixture.landmark),
    });
    const received = [];
    transportB.subscribe("mtc/v1/did", async (ann) => {
      const lm = await transportB.fetch(ann.cid);
      cacheB.ingest(lm);
      received.push(ann);
    });

    // Re-publish so subscriber sees it (subscribe was after the first publish)
    await transportA.publish(fixture.landmark);
    // Wait one microtask for in-memory async fetches to complete
    await new Promise((r) => setImmediate(r));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(cacheB.size()).toBe(1);

    // Now node B can verify any envelope from this batch
    for (let i = 0; i < fixture.rawLeaves.length; i++) {
      const proofPath = fixture.tree.prove(i);
      const envelope = {
        schema: SCHEMA_ENVELOPE,
        namespace: NS,
        tree_head_id: fixture.treeHeadId,
        leaf: fixture.rawLeaves[i],
        inclusion_proof: {
          leaf_index: i,
          tree_size: fixture.rawLeaves.length,
          audit_path: proofPath.map((b) => encodeHashStr(b)),
        },
      };
      const result = verify(envelope, cacheB, {
        now: Date.parse("2026-04-26T13:00:00Z"),
      });
      expect(result.ok, `envelope ${i}: ${result.code}`).toBe(true);
    }

    transportA.close();
    transportB.close();
    expect(annA.cid).toMatch(/^ipfs:/);
  });

  it("Filesystem: node A drops landmark → node B picks up + verifies envelope", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-fs-e2e-"));
    try {
      const transportA = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });
      const transportB = new FilesystemTransport({ dropZone: tmpDir, pollIntervalMs: 0 });

      // A publishes
      const fixture = buildSignedFixture();
      await transportA.publish(fixture.landmark);

      // B subscribes (replays existing announcements)
      const cacheB = new LandmarkCache({
        signatureVerifier: ed25519.makeVerifierFromLandmark(fixture.landmark),
      });
      const fetched = [];
      transportB.subscribe("mtc/v1/did", async (ann) => {
        const lm = await transportB.fetch(ann.cid);
        cacheB.ingest(lm);
        fetched.push(ann);
      });

      // Wait for subscribe-time replay's async fetches
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));

      expect(fetched.length).toBe(1);
      expect(cacheB.size()).toBe(1);

      // Verify all 4 envelopes
      for (let i = 0; i < fixture.rawLeaves.length; i++) {
        const proofPath = fixture.tree.prove(i);
        const envelope = {
          schema: SCHEMA_ENVELOPE,
          namespace: NS,
          tree_head_id: fixture.treeHeadId,
          leaf: fixture.rawLeaves[i],
          inclusion_proof: {
            leaf_index: i,
            tree_size: fixture.rawLeaves.length,
            audit_path: proofPath.map((b) => encodeHashStr(b)),
          },
        };
        const result = verify(envelope, cacheB, {
          now: Date.parse("2026-04-26T13:00:00Z"),
        });
        expect(result.ok, `envelope ${i}: ${result.code}`).toBe(true);
      }

      transportA.close();
      transportB.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
