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
    { gossipsub },
  ] = await Promise.all([
    import("libp2p"),
    import("@libp2p/tcp"),
    import("@libp2p/noise"),
    import("@chainsafe/libp2p-yamux"),
    import("@libp2p/identify"),
    import("@multiformats/multiaddr"),
    import("it-byte-stream"),
    import("@chainsafe/libp2p-gossipsub"),
  ]);
  _depsCache = {
    createLibp2p,
    tcp,
    noise,
    yamux,
    identify,
    multiaddr,
    byteStream,
    gossipsub,
  };
  return _depsCache;
}

class Libp2pTransport {
  /**
   * @param {object} [options]
   * @param {string} [options.listen] - listen multiaddr; default random TCP port on 127.0.0.1
   * @param {"direct"|"gossipsub"} [options.mode] - default "direct" (dial each peer);
   *   "gossipsub" uses libp2p pubsub topics for true gossip routing
   * @returns {Promise<Libp2pTransport>}
   */
  static async create(options) {
    const opts = options || {};
    const mode = opts.mode === "gossipsub" ? "gossipsub" : "direct";
    const deps = await loadDeps();
    const listenAddr = opts.listen || "/ip4/127.0.0.1/tcp/0";
    const services = { identify: deps.identify() };
    if (mode === "gossipsub") {
      // D=1, Dlo=1 lets meshes form even in tiny networks (2 peers).
      // floodPublish=true makes the publisher forward to ALL known topic
      // subscribers (not just mesh peers) — important for low-density nets
      // and avoids mesh-formation timing flakes.
      // allowPublishToZeroTopicPeers permits publish() to run even if the
      // mesh is empty.
      services.pubsub = deps.gossipsub({
        allowPublishToZeroTopicPeers: true,
        floodPublish: true,
        D: opts.gossipD ?? 1,
        Dlo: opts.gossipDlo ?? 1,
        Dhi: opts.gossipDhi ?? 12,
      });
    }
    const node = await deps.createLibp2p({
      addresses: { listen: [listenAddr] },
      transports: [deps.tcp()],
      streamMuxers: [deps.yamux()],
      connectionEncrypters: [deps.noise()],
      services,
    });
    await node.start();
    return new Libp2pTransport(node, deps, mode);
  }

  constructor(node, deps, mode) {
    this._node = node;
    this._deps = deps;
    this._mode = mode || "direct";
    this._subs = []; // {prefix, handler}
    this._subscribedTopics = new Set(); // gossipsub topics we've joined
    this._localContent = new Map(); // cid → landmark
    this._closed = false;

    if (this._mode === "direct") {
      // libp2p 3.x StreamHandler: (stream, connection) => void
      node.handle(PROTOCOL, async (stream) => {
        try {
          await this._onIncoming(stream);
        } catch (_err) {
          // Don't crash the listener on a malformed peer message
        }
      });
    } else {
      // gossipsub mode: route messages by topic
      const pubsub = node.services.pubsub;
      pubsub.addEventListener("message", (evt) => {
        const { topic, data } = evt.detail;
        if (!this._subscribedTopics.has(topic)) return;
        this._handleGossipMessage(topic, data);
      });
    }
  }

  get mode() {
    return this._mode;
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

    if (this._mode === "gossipsub") {
      const topic = ann.namespace_prefix;
      const pubsub = this._node.services.pubsub;
      // Ensure publisher has joined the topic so peers form a mesh on it
      if (!this._subscribedTopics.has(topic)) {
        pubsub.subscribe(topic);
        this._subscribedTopics.add(topic);
      }
      const result = await pubsub.publish(topic, msgBytes);
      const recipients = result && Array.isArray(result.recipients)
        ? result.recipients.length
        : 0;
      return { ...ann, _delivered: recipients, _failed: 0, _mode: "gossipsub" };
    }

    // Direct mode: dial each currently-connected peer, write on a one-shot
    // protocol stream, close. No topic routing — broadcast to everyone.
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
          const accepted = stream.send(msgBytes);
          if (!accepted) {
            await new Promise((resolve) =>
              stream.addEventListener("drain", resolve, { once: true }),
            );
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
      _mode: "direct",
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

    // gossipsub: also subscribe at the libp2p layer using prefix as topic
    if (this._mode === "gossipsub" && !this._subscribedTopics.has(prefix)) {
      this._node.services.pubsub.subscribe(prefix);
      this._subscribedTopics.add(prefix);
    }

    return () => {
      const i = this._subs.indexOf(sub);
      if (i >= 0) this._subs.splice(i, 1);
      // We deliberately don't unsubscribe at the gossipsub layer — other
      // local subscribers might be using the same topic. Topic stays joined
      // until close().
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
    // direct-mode protocol handler: read all chunks until writer closes,
    // then dispatch to subscribers. MessageStream extends AsyncIterable.
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
    this._dispatchPayload(buf);
  }

  _handleGossipMessage(_topic, data) {
    const buf = data.subarray ? data.subarray() : data;
    this._dispatchPayload(buf);
  }

  _dispatchPayload(buf) {
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
