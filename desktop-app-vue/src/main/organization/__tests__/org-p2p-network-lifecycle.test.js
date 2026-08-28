import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { OrgP2PNetwork } = require("../org-p2p-network.js");

class FakePubSub extends EventTarget {
  constructor() {
    super();
    this.subscribe = vi.fn().mockResolvedValue(undefined);
    this.unsubscribe = vi.fn().mockResolvedValue(undefined);
    this.publish = vi.fn().mockResolvedValue(undefined);
  }

  dispatchMessage(detail) {
    const event = new Event("message");
    Object.defineProperty(event, "detail", { value: detail });
    this.dispatchEvent(event);
  }
}

function createNetwork(pubsub = new FakePubSub()) {
  const p2pManager = { node: { services: { pubsub } } };
  const didManager = {
    getCurrentDID: vi.fn().mockResolvedValue("did:local"),
    getDefaultIdentity: vi
      .fn()
      .mockResolvedValue({ did: "did:local", displayName: "Local" }),
  };
  return { network: new OrgP2PNetwork(p2pManager, didManager, {}), pubsub };
}

describe("OrgP2PNetwork lifecycle", () => {
  it("owns and detaches the exact pubsub message listener", async () => {
    const { network, pubsub } = createNetwork();
    const addSpy = vi.spyOn(pubsub, "addEventListener");
    const removeSpy = vi.spyOn(pubsub, "removeEventListener");
    network.handleTopicMessage = vi.fn().mockResolvedValue(undefined);

    await network.subscribeTopic("org-1", "topic-1");
    await network.subscribeTopic("org-1", "topic-1");
    expect(pubsub.subscribe).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledTimes(1);
    const listener = addSpy.mock.calls[0][1];

    pubsub.dispatchMessage({ topic: "topic-1", data: new Uint8Array() });
    await Promise.resolve();
    expect(network.handleTopicMessage).toHaveBeenCalledTimes(1);

    await network.unsubscribeTopic("org-1", { broadcastOffline: false });
    expect(removeSpy).toHaveBeenCalledWith("message", listener);
    expect(pubsub.unsubscribe).toHaveBeenCalledWith("topic-1");
    pubsub.dispatchMessage({ topic: "topic-1", data: new Uint8Array() });
    await Promise.resolve();
    expect(network.handleTopicMessage).toHaveBeenCalledTimes(1);
  });

  it("cleans subscriptions and both per-organization timers idempotently", async () => {
    const { network, pubsub } = createNetwork();
    await network.initialize("org-1");
    expect(network.heartbeatIntervals.size).toBe(1);
    expect(network.discoveryIntervals.size).toBe(1);

    await network.cleanup();
    await network.cleanup();
    expect(network.orgSubscriptions.size).toBe(0);
    expect(network.heartbeatIntervals.size).toBe(0);
    expect(network.discoveryIntervals.size).toBe(0);
    expect(pubsub.unsubscribe).toHaveBeenCalledTimes(1);
    await expect(network.initialize("org-2")).rejects.toThrow(/已关闭/);
  });
});
