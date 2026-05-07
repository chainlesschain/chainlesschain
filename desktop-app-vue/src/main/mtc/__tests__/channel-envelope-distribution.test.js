/**
 * channel-envelope-distribution unit tests — wire B4-cross v1 cross-machine
 * envelope sharing on top of mocked mtcFederationManager + p2pManager + a
 * real ChannelEventBatcher (real fs in tmp dir).
 *
 * Covers:
 *   - initialize hooks batcher.onBatchClosed + p2p envelope-request /
 *     envelope-response listeners
 *   - subscribeCommunity uses the dedicated `<id>.envelopes-track` topic
 *   - publishLandmark fires automatically on closeBatch
 *   - inbound landmark cached via batcher.storeRemoteLandmark
 *   - requestEnvelope round-trip + response stored via storeRemoteEnvelope
 *   - request timeout resolves to null
 *   - inbound envelope-request is served from local batches
 *   - close tears down listeners + reject in-flight
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import EventEmitter from "events";
import fs from "fs";
import path from "path";
import os from "os";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  computeDIDFromPublicKey,
  signPayloadWithIdentity,
} = require("../../did/did-signer.js");
const { ChannelEventBatcher } = require("../channel-event-batch.js");
const {
  ChannelEnvelopeDistribution,
} = require("../channel-envelope-distribution.js");

function makeIdentity(keyPair) {
  return {
    did: computeDIDFromPublicKey(keyPair.publicKey),
    public_key_sign: naclUtil.encodeBase64(keyPair.publicKey),
    private_key_ref: JSON.stringify({
      sign: naclUtil.encodeBase64(keyPair.secretKey),
      encrypt: naclUtil.encodeBase64(new Uint8Array(32)),
    }),
  };
}

function makeSignedMessage(identity, overrides = {}) {
  const subset = {
    id: overrides.id || "msg-" + Math.random().toString(36).slice(2, 10),
    channel_id: overrides.channel_id || "ch-1",
    sender_did: identity.did,
    content: overrides.content || "hello",
    message_type: "text",
    reply_to: null,
    created_at: overrides.created_at || Date.now(),
  };
  const { sender_pubkey, signature } = signPayloadWithIdentity(
    subset,
    identity,
  );
  return {
    ...subset,
    is_pinned: 0,
    reactions: "{}",
    updated_at: subset.created_at,
    sender_pubkey,
    signature,
  };
}

function createMtcFedMock() {
  const subscribers = new Map(); // syntheticId → handler
  return {
    isInitialized: vi.fn().mockReturnValue(true),
    subscribeCommunity: vi.fn(async (syntheticId, handler) => {
      subscribers.set(syntheticId, handler);
    }),
    unsubscribeCommunity: vi.fn((syntheticId) => {
      subscribers.delete(syntheticId);
    }),
    publishCommunityEvent: vi.fn(async (syntheticId, payload) => {
      // Capture published landmarks so tests can assert
      return { recipients: 1, _topic: syntheticId, _payload: payload };
    }),
    _subscribers: subscribers,
    _fire(syntheticId, payload) {
      const h = subscribers.get(syntheticId);
      if (h) {
        h(payload);
      }
    },
  };
}

function createP2pMock() {
  const ee = new EventEmitter();
  ee.sendMessage = vi.fn().mockResolvedValue({ success: true });
  return ee;
}

describe("ChannelEnvelopeDistribution", () => {
  let tmpDir;
  let identity;
  let batcher;
  let mtcFed;
  let p2p;
  let dist;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ced-test-"));
    identity = makeIdentity(nacl.sign.keyPair());
    batcher = new ChannelEventBatcher({
      rootDir: tmpDir,
      getCurrentIdentity: () => identity,
      threshold: 100,
      autoTimer: false,
    });
    batcher.initialize();
    mtcFed = createMtcFedMock();
    p2p = createP2pMock();
    dist = new ChannelEnvelopeDistribution({
      mtcFederationManager: mtcFed,
      p2pManager: p2p,
      channelEventBatcher: batcher,
      requestTimeoutMs: 200,
    });
  });

  afterEach(async () => {
    try {
      await dist.close();
    } catch {
      /* ignore */
    }
    batcher.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tolerate Windows file locks */
    }
  });

  describe("constructor + initialize", () => {
    it("rejects missing deps", () => {
      expect(() => new ChannelEnvelopeDistribution({})).toThrow(
        /mtcFederationManager/,
      );
      expect(
        () => new ChannelEnvelopeDistribution({ mtcFederationManager: mtcFed }),
      ).toThrow(/p2pManager/);
      expect(
        () =>
          new ChannelEnvelopeDistribution({
            mtcFederationManager: mtcFed,
            p2pManager: p2p,
          }),
      ).toThrow(/channelEventBatcher/);
    });

    it("initialize is idempotent + close is idempotent", async () => {
      dist.initialize();
      dist.initialize();
      await dist.close();
      await dist.close();
      expect(true).toBe(true); // no throw
    });

    it("close tears down typed message listeners", async () => {
      dist.initialize();
      const before = p2p.listenerCount("mtc:envelope-request");
      expect(before).toBeGreaterThanOrEqual(1);
      await dist.close();
      expect(p2p.listenerCount("mtc:envelope-request")).toBe(before - 1);
    });
  });

  describe("auto-publish on closeBatch", () => {
    beforeEach(() => {
      dist.initialize();
    });

    it("publishes a landmark to the dedicated `<id>.envelopes-track` topic on close", async () => {
      batcher.enqueueEvent(
        "comm-pub",
        makeSignedMessage(identity, { id: "p-1" }),
      );
      const closed = batcher.closeBatch("comm-pub");
      // onBatchClosed fires synchronously; auto-publish is async but
      // we just need to flush microtasks.
      await new Promise((r) => setImmediate(r));

      expect(mtcFed.publishCommunityEvent).toHaveBeenCalledOnce();
      const [topicId, payload] = mtcFed.publishCommunityEvent.mock.calls[0];
      expect(topicId).toBe("comm-pub.envelopes-track");
      expect(payload).toMatchObject({
        type: "channel.landmark",
        communityId: "comm-pub",
        batchId: closed.batchId,
        treeHeadId: closed.treeHeadId,
      });
      expect(payload.landmark).toBeDefined();
      expect(payload.manifest).toBeDefined();
    });

    it("publish failure is non-fatal (batcher returns normally)", async () => {
      mtcFed.publishCommunityEvent.mockRejectedValueOnce(new Error("boom"));
      batcher.enqueueEvent(
        "comm-pf",
        makeSignedMessage(identity, { id: "pf-1" }),
      );
      const closed = batcher.closeBatch("comm-pf");
      expect(closed.skipped).toBe(false);
      await new Promise((r) => setImmediate(r));
      // Should not have thrown — test passing implies the catch worked
    });

    it("emits 'landmark:published' event with recipients count", async () => {
      const events = [];
      dist.on("landmark:published", (e) => events.push(e));
      batcher.enqueueEvent(
        "comm-emit",
        makeSignedMessage(identity, { id: "e-1" }),
      );
      batcher.closeBatch("comm-emit");
      await new Promise((r) => setImmediate(r));
      expect(events).toHaveLength(1);
      expect(events[0].recipients).toBe(1);
    });
  });

  describe("subscribeCommunity + inbound landmark caching", () => {
    beforeEach(() => {
      dist.initialize();
    });

    it("subscribes to the synthetic envelope topic", async () => {
      await dist.subscribeCommunity("comm-sub");
      expect(mtcFed.subscribeCommunity).toHaveBeenCalledWith(
        "comm-sub.envelopes-track",
        expect.any(Function),
      );
    });

    it("idempotent subscribe", async () => {
      await dist.subscribeCommunity("comm-sub");
      await dist.subscribeCommunity("comm-sub");
      expect(mtcFed.subscribeCommunity).toHaveBeenCalledOnce();
    });

    it("caches inbound landmark via batcher.storeRemoteLandmark", async () => {
      await dist.subscribeCommunity("comm-recv");

      const remoteLandmark = {
        snapshots: [{ tree_head_id: "sha256:remote-th-cache" }],
        trust_anchors: [],
      };
      mtcFed._fire("comm-recv.envelopes-track", {
        type: "channel.landmark",
        communityId: "comm-recv",
        batchId: "000007",
        treeHeadId: "sha256:remote-th-cache",
        landmark: remoteLandmark,
      });

      const cached = batcher.findRemoteLandmark(
        "comm-recv",
        "sha256:remote-th-cache",
      );
      expect(cached).toEqual(remoteLandmark);
    });

    it("emits 'landmark:received' for inbound landmarks", async () => {
      const events = [];
      dist.on("landmark:received", (e) => events.push(e));
      await dist.subscribeCommunity("comm-evt");
      mtcFed._fire("comm-evt.envelopes-track", {
        type: "channel.landmark",
        communityId: "comm-evt",
        batchId: "000001",
        treeHeadId: "sha256:abc-event",
        landmark: { snapshots: [{ tree_head_id: "sha256:abc-event" }] },
      });
      expect(events).toHaveLength(1);
      expect(events[0].treeHeadId).toBe("sha256:abc-event");
    });

    it("trust filter ON: caches landmark when issuer DID is a community member", async () => {
      // Re-init dist with a member-list provider
      await dist.close();
      dist = new ChannelEnvelopeDistribution({
        mtcFederationManager: mtcFed,
        p2pManager: p2p,
        channelEventBatcher: batcher,
        getCommunityMembers: async (cid) =>
          cid === "comm-trust" ? ["did:chainlesschain:alice123"] : [],
        requestTimeoutMs: 200,
      });
      dist.initialize();

      await dist.subscribeCommunity("comm-trust");
      mtcFed._fire("comm-trust.envelopes-track", {
        type: "channel.landmark",
        communityId: "comm-trust",
        batchId: "000001",
        treeHeadId: "sha256:trusted-th",
        landmark: {
          snapshots: [
            {
              tree_head_id: "sha256:trusted-th",
              signature: { issuer: "did-bound:did:chainlesschain:alice123" },
            },
          ],
        },
      });
      await new Promise((r) => setImmediate(r));

      const cached = batcher.findRemoteLandmark(
        "comm-trust",
        "sha256:trusted-th",
      );
      expect(cached).not.toBeNull();
    });

    it("trust filter ON: REJECTS landmark when issuer DID is NOT a member", async () => {
      await dist.close();
      const events = [];
      dist = new ChannelEnvelopeDistribution({
        mtcFederationManager: mtcFed,
        p2pManager: p2p,
        channelEventBatcher: batcher,
        getCommunityMembers: async () => ["did:chainlesschain:alice"],
        requestTimeoutMs: 200,
      });
      dist.on("landmark:rejected", (e) => events.push(e));
      dist.initialize();

      await dist.subscribeCommunity("comm-attack");
      mtcFed._fire("comm-attack.envelopes-track", {
        type: "channel.landmark",
        communityId: "comm-attack",
        batchId: "000001",
        treeHeadId: "sha256:imposter-th",
        landmark: {
          snapshots: [
            {
              tree_head_id: "sha256:imposter-th",
              signature: { issuer: "did-bound:did:chainlesschain:mallory" },
            },
          ],
        },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r)); // 2 microtasks for the await chain

      // Not cached
      expect(
        batcher.findRemoteLandmark("comm-attack", "sha256:imposter-th"),
      ).toBeNull();
      // Reject event emitted with reason + issuer
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        communityId: "comm-attack",
        treeHeadId: "sha256:imposter-th",
        issuer: "did:chainlesschain:mallory",
        reason: expect.stringMatching(/not a community member/),
      });
    });

    it("trust filter ON: rejects landmark with unextractable issuer DID", async () => {
      await dist.close();
      const events = [];
      dist = new ChannelEnvelopeDistribution({
        mtcFederationManager: mtcFed,
        p2pManager: p2p,
        channelEventBatcher: batcher,
        getCommunityMembers: async () => ["did:chainlesschain:alice"],
        requestTimeoutMs: 200,
      });
      dist.on("landmark:rejected", (e) => events.push(e));
      dist.initialize();

      await dist.subscribeCommunity("comm-bad");
      mtcFed._fire("comm-bad.envelopes-track", {
        type: "channel.landmark",
        communityId: "comm-bad",
        batchId: "000001",
        treeHeadId: "sha256:no-issuer",
        landmark: { snapshots: [{ tree_head_id: "sha256:no-issuer" }] }, // no signature
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(events).toHaveLength(1);
      expect(events[0].reason).toMatch(/issuer DID not extractable/);
    });

    it("trust filter ON: rejects landmark when getCommunityMembers throws", async () => {
      await dist.close();
      const events = [];
      dist = new ChannelEnvelopeDistribution({
        mtcFederationManager: mtcFed,
        p2pManager: p2p,
        channelEventBatcher: batcher,
        getCommunityMembers: async () => {
          throw new Error("DB unavailable");
        },
        requestTimeoutMs: 200,
      });
      dist.on("landmark:rejected", (e) => events.push(e));
      dist.initialize();

      await dist.subscribeCommunity("comm-dberr");
      mtcFed._fire("comm-dberr.envelopes-track", {
        type: "channel.landmark",
        communityId: "comm-dberr",
        batchId: "000001",
        treeHeadId: "sha256:db-err-th",
        landmark: {
          snapshots: [
            {
              tree_head_id: "sha256:db-err-th",
              signature: { issuer: "did-bound:did:chainlesschain:anyone" },
            },
          ],
        },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(events).toHaveLength(1);
      expect(events[0].reason).toMatch(/membership lookup failed/);
    });

    it("trust filter OFF (no callback): caches without DID validation (v1 default)", async () => {
      // dist (created in outer beforeEach) has no getCommunityMembers
      await dist.subscribeCommunity("comm-permissive");
      mtcFed._fire("comm-permissive.envelopes-track", {
        type: "channel.landmark",
        communityId: "comm-permissive",
        batchId: "000001",
        treeHeadId: "sha256:permissive-th",
        landmark: {
          snapshots: [
            {
              tree_head_id: "sha256:permissive-th",
              signature: { issuer: "did-bound:did:chainlesschain:anyone" },
            },
          ],
        },
      });
      await new Promise((r) => setImmediate(r));
      const cached = batcher.findRemoteLandmark(
        "comm-permissive",
        "sha256:permissive-th",
      );
      expect(cached).not.toBeNull();
    });

    it("extractIssuerDID strips did-bound: prefix", () => {
      const did = ChannelEnvelopeDistribution.extractIssuerDID({
        snapshots: [
          { signature: { issuer: "did-bound:did:chainlesschain:abc" } },
        ],
      });
      expect(did).toBe("did:chainlesschain:abc");
    });

    it("extractIssuerDID accepts plain DID issuer (no prefix)", () => {
      const did = ChannelEnvelopeDistribution.extractIssuerDID({
        snapshots: [{ signature: { issuer: "did:chainlesschain:bare" } }],
      });
      expect(did).toBe("did:chainlesschain:bare");
    });

    it("extractIssuerDID returns null for malformed shapes", () => {
      expect(ChannelEnvelopeDistribution.extractIssuerDID(null)).toBeNull();
      expect(ChannelEnvelopeDistribution.extractIssuerDID({})).toBeNull();
      expect(
        ChannelEnvelopeDistribution.extractIssuerDID({ snapshots: [] }),
      ).toBeNull();
      expect(
        ChannelEnvelopeDistribution.extractIssuerDID({
          snapshots: [{ signature: {} }],
        }),
      ).toBeNull();
    });

    it("ignores non-landmark wire payloads", async () => {
      await dist.subscribeCommunity("comm-other");
      mtcFed._fire("comm-other.envelopes-track", {
        type: "channel_message",
        message: { id: "x" },
      });
      // Nothing should have been cached
      const dir = path.join(tmpDir, "comm-other", "remote-landmarks");
      expect(fs.existsSync(dir)).toBe(false);
    });

    it("unsubscribeCommunity tears down + idempotent", async () => {
      await dist.subscribeCommunity("comm-unsub");
      dist.unsubscribeCommunity("comm-unsub");
      dist.unsubscribeCommunity("comm-unsub"); // no throw
      expect(mtcFed.unsubscribeCommunity).toHaveBeenCalledWith(
        "comm-unsub.envelopes-track",
      );
    });
  });

  describe("requestEnvelope round-trip", () => {
    beforeEach(() => {
      dist.initialize();
    });

    it("sends typed mtc:envelope-request to the peer", async () => {
      const promise = dist.requestEnvelope("peerA", "comm-req", "msg-req-1");
      // Don't await yet — just verify the request was sent
      await new Promise((r) => setImmediate(r));
      expect(p2p.sendMessage).toHaveBeenCalledOnce();
      const [peerId, msg] = p2p.sendMessage.mock.calls[0];
      expect(peerId).toBe("peerA");
      expect(msg.type).toBe("mtc:envelope-request");
      expect(msg.communityId).toBe("comm-req");
      expect(msg.messageId).toBe("msg-req-1");
      expect(msg.requestId).toMatch(/^req-\d+-\d+$/);
      // Cancel the in-flight by triggering a not-found response so afterEach close doesn't reject
      p2p.emit("mtc:envelope-response", {
        requestId: msg.requestId,
        found: false,
      });
      const result = await promise;
      expect(result).toBeNull();
    });

    it("resolves with envelope when response arrives + caches it locally", async () => {
      const promise = dist.requestEnvelope(
        "peerB",
        "comm-cache",
        "msg-cache-1",
      );
      await new Promise((r) => setImmediate(r));
      const requestId = p2p.sendMessage.mock.calls[0][1].requestId;

      const fakeEnv = {
        schema: "envelope/v1",
        tree_head_id: "sha256:cached-env",
        leaf: { message_id: "msg-cache-1" },
        inclusion_proof: { leaf_index: 0 },
      };
      p2p.emit("mtc:envelope-response", {
        requestId,
        communityId: "comm-cache",
        messageId: "msg-cache-1",
        found: true,
        envelope: fakeEnv,
      });

      const got = await promise;
      expect(got).toEqual(fakeEnv);

      // Verify it was cached for next-time fast lookup
      const cachedFile = path.join(
        tmpDir,
        "comm-cache",
        "remote-envelopes",
        "msg-cache-1.json",
      );
      expect(fs.existsSync(cachedFile)).toBe(true);
    });

    it("resolves null on found:false response", async () => {
      const promise = dist.requestEnvelope("peerC", "comm-nf", "msg-nf-1");
      await new Promise((r) => setImmediate(r));
      const requestId = p2p.sendMessage.mock.calls[0][1].requestId;
      p2p.emit("mtc:envelope-response", {
        requestId,
        communityId: "comm-nf",
        messageId: "msg-nf-1",
        found: false,
      });
      const result = await promise;
      expect(result).toBeNull();
    });

    it("times out to null after requestTimeoutMs", async () => {
      const promise = dist.requestEnvelope("ghost-peer", "comm-to", "msg-to-1");
      // Don't fire any response — wait for timeout
      const result = await promise;
      expect(result).toBeNull();
    });

    it("ignores stale responses with unknown requestId", async () => {
      // Should not crash — just no-op
      p2p.emit("mtc:envelope-response", {
        requestId: "never-issued",
        found: true,
        envelope: { schema: "envelope/v1" },
      });
      // Test passes if no throw
      expect(true).toBe(true);
    });

    it("close rejects in-flight requests", async () => {
      const promise = dist.requestEnvelope(
        "peerD",
        "comm-close",
        "msg-close-1",
      );
      await new Promise((r) => setImmediate(r));
      await dist.close();
      await expect(promise).rejects.toThrow(/closed/);
    });
  });

  describe("inbound envelope-request: respond from local batches", () => {
    beforeEach(() => {
      dist.initialize();
    });

    it("responds with the envelope when locally available", async () => {
      // Stage + close a batch so we have an envelope to serve
      batcher.enqueueEvent(
        "comm-serve",
        makeSignedMessage(identity, { id: "served-1" }),
      );
      batcher.closeBatch("comm-serve");

      // Simulate inbound request from peer
      p2p.emit("mtc:envelope-request", {
        requestId: "ext-req-1",
        communityId: "comm-serve",
        messageId: "served-1",
        fromPeerId: "remote-peer",
      });

      await new Promise((r) => setImmediate(r));

      // Should have replied — find the response sendMessage call
      const respCall = p2p.sendMessage.mock.calls.find(
        ([, m]) => m.type === "mtc:envelope-response",
      );
      expect(respCall).toBeDefined();
      expect(respCall[0]).toBe("remote-peer");
      expect(respCall[1].requestId).toBe("ext-req-1");
      expect(respCall[1].found).toBe(true);
      expect(respCall[1].envelope).toBeDefined();
      expect(respCall[1].envelope.leaf.message_id).toBe("served-1");
    });

    it("responds with found:false when message not found locally", async () => {
      p2p.emit("mtc:envelope-request", {
        requestId: "ext-req-2",
        communityId: "comm-empty",
        messageId: "ghost-msg",
        fromPeerId: "remote-peer",
      });
      await new Promise((r) => setImmediate(r));
      const respCall = p2p.sendMessage.mock.calls.find(
        ([, m]) => m.type === "mtc:envelope-response",
      );
      expect(respCall[1].found).toBe(false);
      expect(respCall[1].envelope).toBeUndefined();
    });

    it("ignores malformed inbound requests (missing requestId/peer)", async () => {
      p2p.emit("mtc:envelope-request", { communityId: "x" }); // no requestId
      p2p.emit("mtc:envelope-request", {
        requestId: "x",
        communityId: "x",
        messageId: "x",
      }); // no fromPeerId
      await new Promise((r) => setImmediate(r));
      // No sendMessage calls at all
      expect(p2p.sendMessage).not.toHaveBeenCalled();
    });
  });
});
