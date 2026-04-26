import { describe, it, expect, beforeAll, afterAll } from "vitest";

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
const { Libp2pTransport, PROTOCOL } = require("../lib/transports/libp2p.js");

const NS = "mtc/v1/did/000123";

function buildSignedFixture(namespace = NS) {
  const keys = ed25519.generateKeyPair();
  const issuer = "mtca:cc:zQ3shLibp2pTest";
  const rawLeaves = Array.from({ length: 4 }, (_, i) => ({
    kind: "did-document",
    content_hash: encodeHashStr(sha256(Buffer.from(`x${i}`))),
    issued_at: "2026-04-26T10:00:00Z",
    subject: `did:cc:zQ3shLibp2p${i}`,
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("Libp2pTransport — real network", () => {
  let nodeA;
  let nodeB;

  beforeAll(async () => {
    nodeA = await Libp2pTransport.create();
    nodeB = await Libp2pTransport.create();
  }, 30_000);

  afterAll(async () => {
    if (nodeA) await nodeA.close();
    if (nodeB) await nodeB.close();
  });

  it("registers the /mtc/landmark/1.0.0 protocol", () => {
    expect(PROTOCOL).toBe("/mtc/landmark/1.0.0");
    expect(nodeA.peerIdString()).toMatch(/^12D3KooW|^Qm/);
  });

  it("each node listens on at least one TCP multiaddr", () => {
    const aAddrs = nodeA.multiaddrs();
    const bAddrs = nodeB.multiaddrs();
    expect(aAddrs.length).toBeGreaterThan(0);
    expect(bAddrs.length).toBeGreaterThan(0);
    expect(aAddrs[0]).toMatch(/\/ip4\/127\.0\.0\.1\/tcp\/\d+\/p2p\//);
  });

  it("two nodes connect + publish + subscribe + fetch + verify", async () => {
    const fixture = buildSignedFixture();

    // B subscribes BEFORE A connects + publishes
    const received = [];
    nodeB.subscribe("mtc/v1/did", (ann) => received.push(ann));

    // A connects to B
    const bAddrs = nodeB.multiaddrs();
    expect(bAddrs.length).toBeGreaterThan(0);
    await nodeA.connect(bAddrs[0]);

    // Wait briefly for connection + protocol identification
    await sleep(150);

    // Sanity check — connection must be established before publish
    expect(nodeA._node.getConnections().length).toBeGreaterThan(0);

    // A publishes — broadcasts to all connected peers (just B)
    const result = await nodeA.publish(fixture.landmark);
    expect(result._delivered).toBeGreaterThanOrEqual(1);
    expect(result.namespace).toBe(NS);

    // Wait for async delivery on B
    await sleep(150);

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].namespace).toBe(NS);
    expect(received[0].cid).toMatch(/^libp2p:/);

    // B can fetch the landmark locally (it was embedded in announce)
    const landmarkOnB = await nodeB.fetch(received[0].cid);
    expect(landmarkOnB).toEqual(fixture.landmark);

    // B ingests + verifies envelopes
    const cacheB = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(fixture.landmark),
    });
    cacheB.ingest(landmarkOnB);
    expect(cacheB.size()).toBe(1);

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
      const r = verify(envelope, cacheB, {
        now: Date.parse("2026-04-26T13:00:00Z"),
      });
      expect(r.ok, `envelope ${i}: ${r.code}`).toBe(true);
    }
  }, 30_000);

  it("subscriber filters by namespace prefix", async () => {
    const did = [];
    const skill = [];
    const off1 = nodeB.subscribe("mtc/v1/did", (a) => did.push(a));
    const off2 = nodeB.subscribe("mtc/v1/skill", (a) => skill.push(a));

    await nodeA.publish(buildSignedFixture("mtc/v1/did/000200").landmark);
    await sleep(100);
    await nodeA.publish(buildSignedFixture("mtc/v1/skill/000200").landmark);
    await sleep(100);

    expect(did.some((a) => a.namespace.startsWith("mtc/v1/did/"))).toBe(true);
    expect(skill.some((a) => a.namespace.startsWith("mtc/v1/skill/"))).toBe(
      true,
    );

    off1();
    off2();
  }, 30_000);

  it("close stops new operations", async () => {
    const tmpNode = await Libp2pTransport.create();
    await tmpNode.close();
    await expect(
      tmpNode.publish(buildSignedFixture().landmark),
    ).rejects.toThrow(/closed/);
  }, 15_000);
});
