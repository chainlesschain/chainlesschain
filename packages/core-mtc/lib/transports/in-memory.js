"use strict";

const { sha256, encodeHashStr } = require("../hash.js");
const { jcs } = require("../jcs.js");
const {
  validateNamespacePrefix,
  announcementFromLandmark,
  prefixMatches,
} = require("./types.js");

/**
 * InMemoryBroker — shared state for InMemoryTransport instances that
 * want to talk to each other within a single process.
 *
 * Use case: tests, single-process multi-tenant scenarios. NOT for
 * cross-process distribution.
 */
class InMemoryBroker {
  constructor() {
    this._content = new Map(); // cid → landmark JSON object
    this._subscribers = new Set(); // {prefix, handler}
  }

  put(landmark) {
    const cid = "ipfs:" + encodeHashStr(sha256(jcs(landmark))).slice(7);
    this._content.set(cid, landmark);
    return cid;
  }

  get(cid) {
    return this._content.get(cid) || null;
  }

  announce(announcement) {
    for (const sub of this._subscribers) {
      if (prefixMatches(sub.prefix, announcement.namespace_prefix)) {
        // Deliver async to mimic real-world pub/sub but stay deterministic
        try {
          sub.handler(announcement);
        } catch (_err) {
          // swallow — one bad subscriber shouldn't break others
        }
      }
    }
  }

  addSubscriber(prefix, handler) {
    const sub = { prefix, handler };
    this._subscribers.add(sub);
    return () => this._subscribers.delete(sub);
  }

  contentSize() {
    return this._content.size;
  }

  subscriberCount() {
    return this._subscribers.size;
  }

  reset() {
    this._content.clear();
    this._subscribers.clear();
  }
}

/**
 * InMemoryTransport — connects to a shared broker.
 *
 * Two transport instances pointing at the same broker can publish/subscribe
 * to each other. Drop-in for tests that exercise the data flow without
 * touching the network.
 */
class InMemoryTransport {
  /**
   * @param {InMemoryBroker} broker - shared broker (create once per scenario)
   */
  constructor(broker) {
    if (!(broker instanceof InMemoryBroker)) {
      throw new TypeError("InMemoryTransport: broker must be InMemoryBroker");
    }
    this._broker = broker;
    this._unsubs = [];
    this._closed = false;
  }

  async publish(landmark) {
    if (this._closed) throw new Error("transport closed");
    const cid = this._broker.put(landmark);
    const ann = announcementFromLandmark(landmark, cid);
    this._broker.announce(ann);
    return ann;
  }

  /**
   * @param {string} prefix - mtc/v1/<kind>[/<scope>]
   * @param {(announcement) => void} onAnnouncement
   * @returns {() => void} unsubscribe
   */
  subscribe(prefix, onAnnouncement) {
    if (this._closed) throw new Error("transport closed");
    validateNamespacePrefix(prefix);
    if (typeof onAnnouncement !== "function") {
      throw new TypeError("subscribe: onAnnouncement must be function");
    }
    const unsub = this._broker.addSubscriber(prefix, onAnnouncement);
    this._unsubs.push(unsub);
    return unsub;
  }

  async fetch(cid) {
    if (this._closed) throw new Error("transport closed");
    const landmark = this._broker.get(cid);
    if (!landmark) {
      const e = new Error(`CID not found: ${cid}`);
      e.code = "CID_NOT_FOUND";
      throw e;
    }
    return landmark;
  }

  close() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
    this._closed = true;
  }
}

module.exports = { InMemoryBroker, InMemoryTransport };
