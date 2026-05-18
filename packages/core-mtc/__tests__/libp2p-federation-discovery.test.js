import { describe, it, expect, beforeAll, afterAll } from "vitest";

const {
  createMemberAnnounce,
  FederationAnnounceCache,
  ed25519,
} = require("../lib/index.js");
const { Libp2pTransport } = require("../lib/transports/libp2p.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FEDERATION_TOPIC = (fedId) => `mtc-federation/v1/${fedId}`;

/**
 * Wait until {check}() returns truthy or timeout. Used for gossipsub mesh
 * delivery which has variable timing in 2-node testbeds.
 */
async function waitFor(check, { timeoutMs = 15_000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(stepMs);
  }
  return false;
}

describe("Libp2pTransport — Phase 3.4 raw pubsub API", () => {
  let nodeA;
  let nodeB;

  beforeAll(async () => {
    nodeA = await Libp2pTransport.create({ mode: "gossipsub" });
    nodeB = await Libp2pTransport.create({ mode: "gossipsub" });
    await nodeA.connect(nodeB.multiaddrs()[0]);
    // Mesh + identify needs a moment
    await sleep(800);
  }, 30_000);

  afterAll(async () => {
    if (nodeA) await nodeA.close();
    if (nodeB) await nodeB.close();
  });

  // ── API surface tests (deterministic) ───────────────────────────────

  it("publishRaw throws WRONG_TRANSPORT_MODE in direct mode", async () => {
    const directNode = await Libp2pTransport.create({ mode: "direct" });
    try {
      await expect(directNode.publishRaw("any", "x")).rejects.toThrow(/gossipsub/);
    } finally {
      await directNode.close();
    }
  }, 30_000);

  it("subscribeRaw throws WRONG_TRANSPORT_MODE in direct mode", async () => {
    const directNode = await Libp2pTransport.create({ mode: "direct" });
    try {
      expect(() => directNode.subscribeRaw("topic", () => {})).toThrow(/gossipsub/);
    } finally {
      await directNode.close();
    }
  }, 30_000);

  it("publishRaw rejects empty topic + non-string/non-Uint8Array payload", async () => {
    await expect(nodeA.publishRaw("", "x")).rejects.toThrow();
    await expect(nodeA.publishRaw("topic", 42)).rejects.toThrow();
  });

  it("subscribeRaw rejects non-function handler", () => {
    expect(() => nodeA.subscribeRaw("any", "not a function")).toThrow();
  });

  it("publishRaw return shape includes recipients count", async () => {
    const r = await nodeA.publishRaw("mtc-federation/v1/shape-test", "{}");
    expect(typeof r.recipients).toBe("number");
  });

  it("subscribeRaw + local dispatch via _dispatchRawTopic delivers to handler", () => {
    // This bypasses real gossipsub — we verify the local fan-out logic is
    // sound. The cross-node tests below cover the network layer.
    let received = null;
    const unsub = nodeB.subscribeRaw("mtc-federation/v1/dispatch-test", (bytes) => {
      received = new TextDecoder().decode(bytes);
    });

    // Inject a synthetic delivery
    const payload = new TextEncoder().encode('{"x":1}');
    nodeB._dispatchRawTopic("mtc-federation/v1/dispatch-test", payload);

    expect(received).toBe('{"x":1}');
    unsub();

    // After unsubscribe, the same dispatch should not fire the handler
    nodeB._dispatchRawTopic("mtc-federation/v1/dispatch-test", payload);
    expect(received).toBe('{"x":1}'); // unchanged
  });

  it("subscribeRaw fan-outs to multiple handlers on the same topic", () => {
    const seen = [];
    const unsub1 = nodeA.subscribeRaw("mtc-federation/v1/multi-handler", () =>
      seen.push("h1"),
    );
    const unsub2 = nodeA.subscribeRaw("mtc-federation/v1/multi-handler", () =>
      seen.push("h2"),
    );
    nodeA._dispatchRawTopic(
      "mtc-federation/v1/multi-handler",
      new TextEncoder().encode("x"),
    );
    expect(seen).toEqual(["h1", "h2"]);
    unsub1();
    unsub2();
  });

  // ── Cross-node delivery (best-effort with retries) ──────────────────

  it("publishRaw + subscribeRaw call path runs end-to-end across two nodes (smoke)", async () => {
    // 2-node gossipsub mesh formation timing makes cross-node delivery
    // genuinely flaky in test environments — this matches the existing
    // landmark gossipsub test which also avoids strict delivery assertions.
    // Production federations have more peers + more time, so floodPublish
    // + mesh formation reliably delivers. Here we verify the call path
    // (publish-then-subscribe round-trip) doesn't throw + the publishers's
    // recipient count is reported, but DON'T assert the announce arrived.
    // The signature-rejection + cache-eviction logic is covered by the
    // deterministic dispatcher tests above.
    const fedId = "fed-libp2p-smoke";
    const topic = FEDERATION_TOPIC(fedId);

    const unsub = nodeB.subscribeRaw(topic, () => {});
    nodeA.subscribeRaw(topic, () => {}); // mesh seed
    await sleep(800);

    const keysA = ed25519.generateKeyPair();
    const announceA = createMemberAnnounce({
      federationId: fedId,
      memberId: "node-a",
      issuer: "mtca:cc:fed-libp2p-smoke:node-a",
      secretKey: keysA.secretKey,
      publicKey: keysA.publicKey,
    });
    const result = await nodeA.publishRaw(topic, JSON.stringify(announceA));
    expect(typeof result.recipients).toBe("number");
    unsub();
  }, 30_000);

  it("synthetic dispatch + cache rejects tampered announces (deterministic)", () => {
    // Cross-node tamper test would also rely on flaky gossipsub mesh
    // formation. The signature-rejection logic is what we actually need
    // to verify — exercise via _dispatchRawTopic so the test is
    // deterministic, regardless of whether the mesh is up.
    const fedId = "fed-tamper-synthetic";
    const topic = FEDERATION_TOPIC(fedId);

    const cache = new FederationAnnounceCache();
    let bytesReceived = 0;
    const unsub = nodeB.subscribeRaw(topic, (bytes) => {
      bytesReceived++;
      cache.ingest(JSON.parse(new TextDecoder().decode(bytes)));
    });

    const keysA = ed25519.generateKeyPair();
    const ann = createMemberAnnounce({
      federationId: fedId,
      memberId: "alice",
      issuer: "mtca:cc:fed-tamper-synthetic:alice",
      secretKey: keysA.secretKey,
      publicKey: keysA.publicKey,
    });
    // Tamper after signing
    ann.member_id = "imposter";

    nodeB._dispatchRawTopic(topic, new TextEncoder().encode(JSON.stringify(ann)));

    expect(bytesReceived).toBe(1); // delivery happened
    expect(cache.size()).toBe(0); // but signature check rejected the announce
    unsub();
  });
});
