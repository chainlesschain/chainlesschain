"use strict";

/**
 * Libp2pTransport — real-network publish/subscribe over libp2p.
 *
 * Uses TCP transport + Noise encryption + Yamux multiplexing + a custom
 * protocol `/mtc/landmark/1.0.0` for landmark distribution. No gossipsub:
 * publisher dials each currently-connected peer and writes the landmark
 * over a one-shot length-prefixed stream. For the two-node scenario this
 * is sufficient; gossipsub-based topic routing is a future optimization
 * that can drop in without changing the LandmarkTransport interface.
 *
 * libp2p is ESM-only — we load it via dynamic import so this file remains
 * CommonJS like the rest of core-mtc. First-time `Libp2pTransport.create()`
 * pays a ~1s import cost; subsequent calls reuse the cached module.
 */

const { sha256, encodeHashStr } = require("../hash.js");
const { jcs } = require("../jcs.js");
const {
  validateNamespacePrefix,
  announcementFromLandmark,
  prefixMatches,
} = require("./types.js");

const PROTOCOL = "/mtc/landmark/1.0.0";

let _depsCache = null;

async function loadDeps() {
  if (_depsCache) return _depsCache;
  const [
    { createLibp2p },
    { tcp },
    { noise },
    { yamux },
    { identify },
    { multiaddr },
    { byteStream },
  ] = await Promise.all([
    import("libp2p"),
    import("@libp2p/tcp"),
    import("@libp2p/noise"),
    import("@chainsafe/libp2p-yamux"),
    import("@libp2p/identify"),
    import("@multiformats/multiaddr"),
    import("it-byte-stream"),
  ]);
  _depsCache = { createLibp2p, tcp, noise, yamux, identify, multiaddr, byteStream };
  return _depsCache;
}

class Libp2pTransport {
  /**
   * @param {object} options
   * @param {string} [options.listen] - listen multiaddr; default random TCP port on 127.0.0.1
   * @returns {Promise<Libp2pTransport>}
   */
  static async create(options) {
    const opts = options || {};
    const deps = await loadDeps();
    const listenAddr = opts.listen || "/ip4/127.0.0.1/tcp/0";
    const node = await deps.createLibp2p({
      addresses: { listen: [listenAddr] },
      transports: [deps.tcp()],
      streamMuxers: [deps.yamux()],
      connectionEncrypters: [deps.noise()],
      services: { identify: deps.identify() },
    });
    await node.start();
    return new Libp2pTransport(node, deps);
  }

  constructor(node, deps) {
    this._node = node;
    this._deps = deps;
    this._subs = []; // {prefix, handler}
    this._localContent = new Map(); // cid → landmark
    this._closed = false;

    // libp2p 3.x StreamHandler: (stream, connection) => void
    node.handle(PROTOCOL, async (stream) => {
      try {
        await this._onIncoming(stream);
      } catch (_err) {
        // Don't crash the listener on a malformed peer message
      }
    });
  }

  /** Multiaddr strings this node is listening on. */
  multiaddrs() {
    return this._node.getMultiaddrs().map((m) => m.toString());
  }

  /** Peer ID as string. */
  peerIdString() {
    return this._node.peerId.toString();
  }

  /** Dial a peer by multiaddr string (must include /p2p/<peerId>). */
  async connect(multiaddrStr) {
    if (this._closed) throw new Error("transport closed");
    const ma = this._deps.multiaddr(multiaddrStr);
    return this._node.dial(ma);
  }

  async publish(landmark) {
    if (this._closed) throw new Error("transport closed");
    const cid =
      "libp2p:" + encodeHashStr(sha256(jcs(landmark))).slice("sha256:".length);
    this._localContent.set(cid, landmark);
    const ann = announcementFromLandmark(landmark, cid);

    const messageObj = { type: "announce", announcement: ann, landmark };
    const msgBytes = new TextEncoder().encode(JSON.stringify(messageObj));

    // Use dialProtocol(peerId, protocol) — that returns a higher-level
    // stream with .write/.source. Raw conn.newStream() returns a yamux
    // internal stream that lacks the public stream API.
    const connections = this._node.getConnections();
    const peerSet = new Map();
    for (const conn of connections) {
      const key = conn.remotePeer.toString();
      if (!peerSet.has(key)) peerSet.set(key, conn.remotePeer);
    }

    const results = await Promise.allSettled(
      [...peerSet.values()].map(async (peerId) => {
        const stream = await this._node.dialProtocol(peerId, PROTOCOL);
        try {
          // libp2p 3.x MessageStream API: send returns false if backpressured.
          // For our small payloads we await drain just in case.
          const accepted = stream.send(msgBytes);
          if (!accepted) {
            await new Promise((resolve) => stream.addEventListener("drain", resolve, { once: true }));
          }
        } finally {
          if (typeof stream.close === "function") await stream.close();
        }
      }),
    );

    const failures = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r.reason && r.reason.message) || String(r.reason));

    return {
      ...ann,
      _delivered: results.filter((r) => r.status === "fulfilled").length,
      _failed: failures.length,
      _failures: failures,
    };
  }

  subscribe(prefix, handler) {
    if (this._closed) throw new Error("transport closed");
    validateNamespacePrefix(prefix);
    if (typeof handler !== "function") {
      throw new TypeError("subscribe: handler must be function");
    }
    const sub = { prefix, handler };
    this._subs.push(sub);
    return () => {
      const i = this._subs.indexOf(sub);
      if (i >= 0) this._subs.splice(i, 1);
    };
  }

  async fetch(cid) {
    if (this._closed) throw new Error("transport closed");
    if (this._localContent.has(cid)) {
      return this._localContent.get(cid);
    }
    const e = new Error(`CID not found locally: ${cid}`);
    e.code = "CID_NOT_FOUND";
    throw e;
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    await this._node.stop();
    this._subs = [];
    this._localContent.clear();
  }

  async _onIncoming(stream) {
    // MessageStream extends AsyncIterable<Uint8Array> in libp2p 3.x;
    // for-await reads chunks until the writer closes its end.
    const chunks = [];
    for await (const chunk of stream) {
      const u8 = chunk.subarray ? chunk.subarray() : chunk;
      chunks.push(u8);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    let msg;
    try {
      msg = JSON.parse(new TextDecoder().decode(buf));
    } catch (_err) {
      return;
    }
    if (msg.type !== "announce" || !msg.announcement) return;
    if (msg.landmark && msg.announcement.cid) {
      this._localContent.set(msg.announcement.cid, msg.landmark);
    }
    for (const sub of this._subs) {
      if (prefixMatches(sub.prefix, msg.announcement.namespace_prefix)) {
        try {
          sub.handler(msg.announcement);
        } catch (_err) {
          // swallow per-handler errors
        }
      }
    }
  }
}

module.exports = { Libp2pTransport, PROTOCOL };
