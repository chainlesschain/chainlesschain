// @vitest-environment node
//
// Real libp2p needs the Node TCP socket + native Buffer prototype chain.
// jsdom (this repo's default env) shims globals in ways that break libp2p's
// Uint8Array instanceof checks inside its TCP receive path, producing
// "Could not append value, must be an Uint8Array or a Uint8ArrayList".
// The directive above pins THIS file to the node env without touching
// the project-wide default.

/**
 * Gossip protocol end-to-end test (real libp2p)
 *
 * This is the smoking-gun test for the broken-receive-path fix:
 *
 *   1. Spin up two minimal libp2p nodes (TCP + noise + yamux + identify)
 *   2. Wire each into a P2PManager *shell* (no DB, no NAT, no signal driver)
 *      and a GossipProtocol layered on top
 *   3. Connect A → B
 *   4. Both subscribe to community "c1"; gossip:subscribe wire messages
 *      announce membership in BOTH directions
 *   5. A.broadcast(c1, payload)  →  forward()  →  sendMessage  →
 *      B's stream handler  →  decodeWireMessage (JSON-line)  →
 *      dispatchTypedMessage  →  emit('gossip:message')  →
 *      B's gossipProtocol.handleIncomingMessage  →
 *      emit('message:received') on B's gossip instance
 *   6. Assert B saw the payload with matching id + communityId + payload
 *
 * Skipped when libp2p deps fail to load (e.g., minimal CI without native bits).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const P2PManager = require("../p2p-manager");
const { GossipProtocol } = require("../../social/gossip-protocol.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createMinimalNode() {
  const { createLibp2p } = await import("libp2p");
  const { tcp } = await import("@libp2p/tcp");
  const { noise } = await import("@libp2p/noise");
  const { yamux } = await import("@chainsafe/libp2p-yamux");
  const { identify } = await import("@libp2p/identify");

  return createLibp2p({
    addresses: { listen: ["/ip4/127.0.0.1/tcp/0"] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  });
}

function attachManager(node) {
  // P2PManager constructor doesn't dial libp2p — it just sets fields.
  // We bypass start() and inject a pre-built node, mirroring what
  // start() would do at the end of init.
  const mgr = new P2PManager();
  mgr.node = node;
  mgr.peerId = node.peerId.toString();
  mgr.localPeerId = node.peerId.toString();
  mgr.initialized = true;
  // wire up the protocol handler (the path we fixed)
  mgr.registerMessageHandler();
  return mgr;
}

describe("P2P gossip end-to-end (real libp2p, 2 nodes)", () => {
  let nodeA;
  let nodeB;
  let mgrA;
  let mgrB;
  let gossipA;
  let gossipB;

  beforeAll(async () => {
    nodeA = await createMinimalNode();
    nodeB = await createMinimalNode();

    mgrA = attachManager(nodeA);
    mgrB = attachManager(nodeB);

    gossipA = new GossipProtocol(mgrA, { fanout: 1 });
    gossipB = new GossipProtocol(mgrB, { fanout: 1 });
    await gossipA.initialize();
    await gossipB.initialize();
  }, 30_000);

  afterAll(async () => {
    try {
      await gossipA?.close();
      await gossipB?.close();
    } catch {
      /* ignore */
    }
    try {
      await nodeA?.stop();
      await nodeB?.stop();
    } catch {
      /* ignore */
    }
  });

  it("A and B each get a non-loopback multiaddr", () => {
    const aAddrs = nodeA.getMultiaddrs().map((a) => a.toString());
    const bAddrs = nodeB.getMultiaddrs().map((a) => a.toString());
    expect(aAddrs.length).toBeGreaterThan(0);
    expect(bAddrs.length).toBeGreaterThan(0);
    expect(aAddrs[0]).toMatch(/\/ip4\/127\.0\.0\.1\/tcp\/\d+\/p2p\//);
  }, 10_000);

  it("A → B sendMessage round-trip emits message:typed on the receiver", async () => {
    const { multiaddr } = await import("@multiformats/multiaddr");
    const bAddr = nodeB.getMultiaddrs()[0];
    await nodeA.dial(multiaddr(bAddr.toString()));
    await sleep(200);

    const received = [];
    mgrB.on("message:typed", (m) => received.push(m));

    await mgrA.sendMessage(nodeB.peerId.toString(), {
      type: "knowledge:sync-request",
      payload: { since: 0 },
    });
    await sleep(200);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "knowledge:sync-request",
      payload: { since: 0 },
    });
  }, 15_000);

  it("A.broadcast(community) is received by B's gossip layer", async () => {
    // Both subscribe AFTER connect so the gossip:subscribe wire messages
    // can flow in both directions and populate peerSubscriptions.
    const communityId = "comm-e2e-1";

    const bReceived = [];
    gossipB.on("message:received", (m) => bReceived.push(m));

    gossipA.subscribe(communityId);
    gossipB.subscribe(communityId);

    // Wait for gossip:subscribe round-trip
    await sleep(300);

    // Both ends should now know the other is subscribed
    expect(gossipA.getSubscribedPeers(communityId)).toContain(
      nodeB.peerId.toString(),
    );
    expect(gossipB.getSubscribedPeers(communityId)).toContain(
      nodeA.peerId.toString(),
    );

    // A broadcasts a channel message
    const result = await gossipA.broadcast(communityId, {
      type: "channel_message",
      channelId: "ch-1",
      message: { id: "m-1", body: "hello from A" },
    });
    expect(result.success).toBe(true);
    expect(result.peersReached).toBeGreaterThanOrEqual(1);

    // Wait for delivery + B's handleIncomingMessage to fire
    await sleep(300);

    expect(bReceived.length).toBeGreaterThanOrEqual(1);
    const got = bReceived[0];
    expect(got.communityId).toBe(communityId);
    expect(got.payload).toMatchObject({
      type: "channel_message",
      channelId: "ch-1",
      message: { id: "m-1", body: "hello from A" },
    });
    expect(got.sender).toBe(nodeA.peerId.toString());
  }, 20_000);
});
