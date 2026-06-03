"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sha256, encodeHashStr } = require("../hash.js");
const { jcs } = require("../jcs.js");
const {
  validateNamespacePrefix,
  announcementFromLandmark,
  prefixMatches,
} = require("./types.js");

/**
 * FilesystemTransport — drop-zone directory pattern.
 *
 * Layout under `dropZone`:
 *   content/<cid>.json              — landmark content (publish writes; fetch reads)
 *   announcements/<timestamp>-<seq>.json — announcement log (publish appends)
 *
 * Subscribers poll the announcements/ directory at `pollIntervalMs` (default 1s)
 * and replay each announcement once. The transport keeps a per-instance
 * "seen" set so handlers fire exactly once per (subscription, announcement).
 *
 * Use cases: local LAN sync (NFS / shared folder), USB stick distribution,
 * air-gapped onboarding, Phase 1 dev/test without libp2p.
 */
class FilesystemTransport {
  /**
   * @param {object} options
   * @param {string} options.dropZone - root directory; created if missing
   * @param {number} [options.pollIntervalMs] - default 1000
   */
  constructor(options) {
    const opts = options || {};
    if (typeof opts.dropZone !== "string" || !opts.dropZone) {
      throw new TypeError("FilesystemTransport: dropZone is required");
    }
    this._dropZone = opts.dropZone;
    this._pollMs = opts.pollIntervalMs || 1000;
    this._contentDir = path.join(this._dropZone, "content");
    this._annDir = path.join(this._dropZone, "announcements");
    fs.mkdirSync(this._contentDir, { recursive: true });
    fs.mkdirSync(this._annDir, { recursive: true });
    this._subscriptions = []; // {prefix, handler, seen: Set<filename>}
    this._pollTimer = null;
    this._closed = false;
  }

  async publish(landmark) {
    if (this._closed) throw new Error("transport closed");
    const cid = "fs:" + encodeHashStr(sha256(jcs(landmark))).slice(7);
    const contentPath = path.join(this._contentDir, `${cid.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    fs.writeFileSync(contentPath, JSON.stringify(landmark, null, 2), "utf-8");

    const ann = announcementFromLandmark(landmark, cid);
    const annName = `${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}.json`;
    const annPath = path.join(this._annDir, annName);
    fs.writeFileSync(annPath, JSON.stringify(ann, null, 2), "utf-8");
    return ann;
  }

  subscribe(prefix, onAnnouncement) {
    if (this._closed) throw new Error("transport closed");
    validateNamespacePrefix(prefix);
    if (typeof onAnnouncement !== "function") {
      throw new TypeError("subscribe: onAnnouncement must be function");
    }
    const sub = { prefix, handler: onAnnouncement, seen: new Set() };
    this._subscriptions.push(sub);

    // Replay existing announcements once on subscribe
    this._scanAnnouncements(sub);

    // Start poll timer if not already running
    if (!this._pollTimer && this._pollMs > 0) {
      this._pollTimer = setInterval(() => this._pollAll(), this._pollMs);
      // Don't keep the event loop alive
      if (this._pollTimer.unref) this._pollTimer.unref();
    }

    return () => {
      const idx = this._subscriptions.indexOf(sub);
      if (idx >= 0) this._subscriptions.splice(idx, 1);
    };
  }

  /** Manually drain pending announcements (useful for tests, avoids polling delay). */
  drain() {
    for (const sub of this._subscriptions) this._scanAnnouncements(sub);
  }

  _pollAll() {
    if (this._closed) return;
    for (const sub of this._subscriptions) this._scanAnnouncements(sub);
  }

  _scanAnnouncements(sub) {
    let files;
    try {
      files = fs.readdirSync(this._annDir);
    } catch (_err) {
      return;
    }
    files.sort(); // process in lexicographic order (timestamp prefix → chronological)
    for (const name of files) {
      if (sub.seen.has(name)) continue;
      sub.seen.add(name);
      let ann;
      try {
        ann = JSON.parse(fs.readFileSync(path.join(this._annDir, name), "utf-8"));
      } catch (_err) {
        continue;
      }
      if (!ann || typeof ann.namespace_prefix !== "string") continue;
      if (prefixMatches(sub.prefix, ann.namespace_prefix)) {
        try {
          sub.handler(ann);
        } catch (_err) {
          // swallow per-handler errors
        }
      }
    }
  }

  async fetch(cid) {
    if (this._closed) throw new Error("transport closed");
    const file = path.join(
      this._contentDir,
      `${cid.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`,
    );
    if (!fs.existsSync(file)) {
      const e = new Error(`CID not found: ${cid}`);
      e.code = "CID_NOT_FOUND";
      throw e;
    }
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  close() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._subscriptions = [];
    this._closed = true;
  }
}

module.exports = { FilesystemTransport };
