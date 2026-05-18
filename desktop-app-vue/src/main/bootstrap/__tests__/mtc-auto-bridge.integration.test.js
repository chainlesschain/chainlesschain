/**
 * mtcAutoBridge integration test (extracted wireMtcAutoBridge function).
 *
 * Validates the contract:
 *   - on peer:connected → sendMessage(peer, mtc:advertise envelope) with our
 *     MTC peerId + multiaddrs
 *   - on mtc:peer-advertise → mtcFedMgr.connectPeer(first reachable maddr)
 *   - mtcFedMgr not initialized → both paths no-op (Phase A still works)
 *   - empty multiaddrs / null payload → no dial attempt
 *   - sequential fallback: try each maddr until success, swallow per-addr errs
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import EventEmitter from "events";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const { wireMtcAutoBridge } = require("../social-initializer.js");

function createP2pManagerMock() {
  const ee = new EventEmitter();
  ee.sendMessage = vi.fn().mockResolvedValue({ success: true });
  return ee;
}

function createMtcFedMock(opts = {}) {
  return {
    isInitialized: vi.fn().mockReturnValue(opts.initialized !== false),
    peerIdString: vi.fn().mockReturnValue(opts.peerId || "12D3KooWMtcSelf"),
    multiaddrs: vi
      .fn()
      .mockReturnValue(
        opts.multiaddrs || ["/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWMtcSelf"],
      ),
    connectPeer: vi.fn().mockResolvedValue(undefined),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("wireMtcAutoBridge", () => {
  let p2p;
  let mtcFed;

  beforeEach(() => {
    p2p = createP2pManagerMock();
    mtcFed = createMtcFedMock();
  });

  describe("setup", () => {
    it("returns null + does NOT wire when p2pManager is missing", () => {
      const result = wireMtcAutoBridge(null, mtcFed);
      expect(result).toBeNull();
    });

    it("returns null + does NOT wire when mtcFederationManager is missing", () => {
      const result = wireMtcAutoBridge(p2p, null);
      expect(result).toBeNull();
    });

    it("returns {wired:true} on happy path", () => {
      const result = wireMtcAutoBridge(p2p, mtcFed);
      expect(result).toEqual({ wired: true });
    });
  });

  describe("outbound: peer:connected → mtc:advertise", () => {
    beforeEach(() => {
      wireMtcAutoBridge(p2p, mtcFed);
    });

    it("sends mtc:advertise envelope to the new peer", async () => {
      p2p.emit("peer:connected", { peerId: "12D3KooWPeerB" });
      await sleep(0);
      expect(p2p.sendMessage).toHaveBeenCalledWith(
        "12D3KooWPeerB",
        expect.objectContaining({
          type: "mtc:advertise",
          peerId: "12D3KooWMtcSelf",
          multiaddrs: ["/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWMtcSelf"],
        }),
      );
    });

    it("skips advertise when mtcFedMgr.isInitialized() returns false", async () => {
      mtcFed.isInitialized.mockReturnValue(false);
      p2p.emit("peer:connected", { peerId: "peerC" });
      await sleep(0);
      expect(p2p.sendMessage).not.toHaveBeenCalled();
    });

    it("skips advertise when MTC peerId is missing", async () => {
      mtcFed.peerIdString.mockReturnValue(null);
      p2p.emit("peer:connected", { peerId: "peerD" });
      await sleep(0);
      expect(p2p.sendMessage).not.toHaveBeenCalled();
    });

    it("skips advertise when multiaddrs is empty", async () => {
      mtcFed.multiaddrs.mockReturnValue([]);
      p2p.emit("peer:connected", { peerId: "peerE" });
      await sleep(0);
      expect(p2p.sendMessage).not.toHaveBeenCalled();
    });

    it("sendMessage rejection does not crash the listener", async () => {
      p2p.sendMessage.mockRejectedValue(new Error("dial failed"));
      // Should not throw
      p2p.emit("peer:connected", { peerId: "peerF" });
      await sleep(20);
      // Test passes if no unhandled rejection bubbled
      expect(p2p.sendMessage).toHaveBeenCalledOnce();
    });
  });

  describe("inbound: mtc:peer-advertise → connectPeer", () => {
    beforeEach(() => {
      wireMtcAutoBridge(p2p, mtcFed);
    });

    it("dials the first multiaddr on success", async () => {
      p2p.emit("mtc:peer-advertise", {
        peerId: "12D3KooWMtcRemote",
        multiaddrs: [
          "/ip4/192.168.1.10/tcp/9100/p2p/12D3KooWMtcRemote",
          "/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWMtcRemote",
        ],
      });
      await sleep(20);
      expect(mtcFed.connectPeer).toHaveBeenCalledOnce();
      expect(mtcFed.connectPeer).toHaveBeenCalledWith(
        "/ip4/192.168.1.10/tcp/9100/p2p/12D3KooWMtcRemote",
      );
    });

    it("falls through to second maddr when first fails", async () => {
      mtcFed.connectPeer
        .mockRejectedValueOnce(new Error("ENETUNREACH"))
        .mockResolvedValueOnce(undefined);

      p2p.emit("mtc:peer-advertise", {
        peerId: "12D3KooWMtcRemote",
        multiaddrs: [
          "/ip6/::1/tcp/9100/p2p/12D3KooWMtcRemote",
          "/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWMtcRemote",
        ],
      });
      await sleep(20);
      expect(mtcFed.connectPeer).toHaveBeenCalledTimes(2);
      expect(mtcFed.connectPeer.mock.calls[1][0]).toBe(
        "/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWMtcRemote",
      );
    });

    it("all maddrs failing does not crash", async () => {
      mtcFed.connectPeer.mockRejectedValue(new Error("unreachable"));
      p2p.emit("mtc:peer-advertise", {
        peerId: "ghost",
        multiaddrs: ["/ip4/x/tcp/1/p2p/ghost"],
      });
      await sleep(20);
      expect(mtcFed.connectPeer).toHaveBeenCalledOnce();
    });

    it("skips dial when mtcFedMgr.isInitialized() returns false", async () => {
      mtcFed.isInitialized.mockReturnValue(false);
      p2p.emit("mtc:peer-advertise", {
        peerId: "peerG",
        multiaddrs: ["/ip4/127.0.0.1/tcp/9100/p2p/peerG"],
      });
      await sleep(20);
      expect(mtcFed.connectPeer).not.toHaveBeenCalled();
    });

    it("skips dial on empty multiaddrs payload", async () => {
      p2p.emit("mtc:peer-advertise", { peerId: "peerH", multiaddrs: [] });
      await sleep(20);
      expect(mtcFed.connectPeer).not.toHaveBeenCalled();
    });

    it("skips dial on missing multiaddrs (null/undefined)", async () => {
      p2p.emit("mtc:peer-advertise", { peerId: "peerI" });
      await sleep(20);
      expect(mtcFed.connectPeer).not.toHaveBeenCalled();
    });
  });

  describe("bidirectionality", () => {
    it("both ends advertise + dial = full mesh seed", async () => {
      // Two manager instances, mutually wired
      const aP2p = createP2pManagerMock();
      const aMtc = createMtcFedMock({
        peerId: "12D3KooWA",
        multiaddrs: ["/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWA"],
      });
      const bP2p = createP2pManagerMock();
      const bMtc = createMtcFedMock({
        peerId: "12D3KooWB",
        multiaddrs: ["/ip4/127.0.0.1/tcp/9101/p2p/12D3KooWB"],
      });

      wireMtcAutoBridge(aP2p, aMtc);
      wireMtcAutoBridge(bP2p, bMtc);

      // Simulate libp2p connection: both sides see peer:connected
      aP2p.emit("peer:connected", { peerId: "12D3KooWB" });
      bP2p.emit("peer:connected", { peerId: "12D3KooWA" });
      await sleep(0);

      // Both sent advertise
      expect(aP2p.sendMessage).toHaveBeenCalledWith(
        "12D3KooWB",
        expect.objectContaining({ type: "mtc:advertise", peerId: "12D3KooWA" }),
      );
      expect(bP2p.sendMessage).toHaveBeenCalledWith(
        "12D3KooWA",
        expect.objectContaining({ type: "mtc:advertise", peerId: "12D3KooWB" }),
      );

      // Pretend the wire delivered the advertise to the other side
      aP2p.emit("mtc:peer-advertise", {
        peerId: "12D3KooWB",
        multiaddrs: ["/ip4/127.0.0.1/tcp/9101/p2p/12D3KooWB"],
      });
      bP2p.emit("mtc:peer-advertise", {
        peerId: "12D3KooWA",
        multiaddrs: ["/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWA"],
      });
      await sleep(20);

      expect(aMtc.connectPeer).toHaveBeenCalledWith(
        "/ip4/127.0.0.1/tcp/9101/p2p/12D3KooWB",
      );
      expect(bMtc.connectPeer).toHaveBeenCalledWith(
        "/ip4/127.0.0.1/tcp/9100/p2p/12D3KooWA",
      );
    });
  });
});
