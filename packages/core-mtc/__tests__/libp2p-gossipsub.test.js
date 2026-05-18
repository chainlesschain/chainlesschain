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
const { Libp2pTransport } = require("../lib/transports/libp2p.js");

const NS = "mtc/v1/did/000456";

function buildSignedFixture(namespace = NS) {
  const keys = ed25519.generateKeyPair();
  const issuer = "mtca:cc:zQ3shGossipTest";
  const rawLeaves = Array.from({ length: 4 }, (_, i) => ({
    kind: "did-document",
    content_hash: encodeHashStr(sha256(Buffer.from(`g${i}`))),
    issued_at: "2026-04-26T10:00:00Z",
    subject: `did:cc:zQ3shGossip${i}`,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("Libp2pTransport — gossipsub mode", () => {
  let nodeA;
  let nodeB;

  beforeAll(async () => {
    nodeA = await Libp2pTransport.create({ mode: "gossipsub" });
    nodeB = await Libp2pTransport.create({ mode: "gossipsub" });

    // Connect the two nodes so gossipsub can form a mesh
    const bAddrs = nodeB.multiaddrs();
    await nodeA.connect(bAddrs[0]);

    // Give libp2p identify + gossipsub mesh formation time
    await sleep(500);
  }, 30_000);

  afterAll(async () => {
    if (nodeA) await nodeA.close();
    if (nodeB) await nodeB.close();
  });

  it("reports gossipsub mode", () => {
    expect(nodeA.mode).toBe("gossipsub");
    expect(nodeB.mode).toBe("gossipsub");
  });

  it("publish() returns gossipsub-mode result shape", async () => {
    const fixture = buildSignedFixture();
    const TOPIC = "mtc/v1/did";
    nodeA.subscribe(TOPIC, () => {});
    nodeB.subscribe(TOPIC, () => {});

    // Mesh formation in 2-node testbeds is flaky (gossipsub D=6 default,
    // SUBSCRIBE RPC propagation timing). With floodPublish + D=1 the
    // publisher will still execute even with empty topic-subscribers; we
    // verify the result shape only here.
    const result = await nodeA.publish(fixture.landmark);
    expect(result._mode).toBe("gossipsub");
    expect(result.namespace).toBe(NS);
    expect(result.cid).toMatch(/^libp2p:/);
    expect(typeof result._delivered).toBe("number");
  }, 30_000);

  it("local fetch returns the just-published landmark by CID", async () => {
    const fixture = buildSignedFixture("mtc/v1/did/000789");
    const result = await nodeA.publish(fixture.landmark);
    const local = await nodeA.fetch(result.cid);
    expect(local).toEqual(fixture.landmark);
  }, 30_000);

  it("getPeers reports 1+ pubsub-capable peer after libp2p connect", () => {
    const aPeers = nodeA._node.services.pubsub.getPeers();
    expect(aPeers.length).toBeGreaterThanOrEqual(1);
  });

  it("subscribe registers topic at the gossipsub layer", () => {
    nodeA.subscribe("mtc/v1/audit", () => {});
    const topics = nodeA._node.services.pubsub.getTopics();
    expect(topics).toContain("mtc/v1/audit");
  });
});
