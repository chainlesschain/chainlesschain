"use strict";

/**
 * Phase 2a (Douyin C 路径 — 2026-05-25): IM-db parse result → snapshot JSON.
 *
 * Takes the `{messages, contacts}` shape from im-db-parser.js and produces
 * a snapshot matching the existing `social-douyin` adapter's
 * SNAPSHOT_SCHEMA_VERSION=1 contract — so we reuse the adapter's snapshot
 * mode (`_syncViaSnapshot`) instead of opening a second adapter.
 *
 * Mirrors social-bilibili-adb/snapshot-builder.js. Single-source-of-truth
 * for the adapter; we feed it via different upstreams.
 *
 * Snapshot schema (matches social-douyin/index.js:SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": {
 *       "secUid": null,             // C 路径不调 X-Bogus profile, 不知 secUid
 *       "shortId": null,
 *       "displayName": ""
 *     },
 *     "events": [
 *       { "kind": "message", "id": "msg-<conv>-<time>", "capturedAt": <ms>,
 *         "senderUid": "...", "conversationId": "...",
 *         "text": "...", "readStatus": 0/1, "contentBlob": "..." },
 *       { "kind": "contact", "id": "contact-<uid>", "capturedAt": <ms>,
 *         "uid": "...", "shortId": "...", "name": "...",
 *         "avatarUrl": "...", "followStatus": 0/1/2 }
 *     ]
 *   }
 *
 * Note: Douyin IM doesn't have a "this is me" marker — the db includes
 * messages where `senderUid === <db-filename-uid>` (sent by self) and
 * `senderUid !== <db-filename-uid>` (received). Both go into the snapshot;
 * the consumer (e.g. PDH search) can filter by senderUid if needed.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Build an in-memory snapshot from parsed IM db rows. Pure function — no
 * disk IO.
 *
 * @param {{
 *   uid: string,
 *   messages?: Array,
 *   contacts?: Array,
 *   snapshottedAt?: number,
 *   displayName?: string,
 * }} input
 * @returns {{schemaVersion: number, snapshottedAt: number, account: object, events: Array}}
 */
function buildSnapshot(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("buildSnapshot: input must be an object");
  }
  const uid = input.uid;
  if (typeof uid !== "string" || uid.length === 0) {
    throw new TypeError("buildSnapshot: input.uid must be a non-empty string");
  }
  const snapshottedAt =
    Number.isFinite(input.snapshottedAt) && input.snapshottedAt > 0
      ? input.snapshottedAt
      : Date.now();
  const account = {
    // secUid / shortId unknown via pure-db extraction (those live in the
    // app's webview cookies / passport endpoint). Leave null so consumers
    // know not to use them as canonical IDs.
    secUid: null,
    shortId: uid, // Douyin numeric uid is the shortId equivalent
    displayName:
      typeof input.displayName === "string" ? input.displayName : "",
  };
  const events = [];

  // messages
  const messages = Array.isArray(input.messages) ? input.messages : [];
  messages.forEach((m, idx) => {
    if (!m || typeof m !== "object") return;
    const capturedAt =
      typeof m.createdTimeMs === "number" && m.createdTimeMs > 0
        ? m.createdTimeMs
        : snapshottedAt;
    // ID strategy: conversationId + createdTime is a stable composite
    // key (both required by Douyin's IM protocol). Fallback to senderUid
    // + time for very old rows that pre-date conversation_id.
    const idPart =
      m.conversationId && m.createdTimeMs
        ? `${m.conversationId}-${m.createdTimeMs}`
        : m.senderUid && m.createdTimeMs
          ? `${m.senderUid}-${m.createdTimeMs}`
          : `msg-${idx}`;
    events.push({
      kind: "message",
      id: `msg-${idPart}`,
      capturedAt,
      senderUid: m.senderUid || null,
      conversationId: m.conversationId || null,
      text: m.text || null,
      readStatus: typeof m.readStatus === "number" ? m.readStatus : null,
      contentBlob: m.contentBlob || null,
    });
  });

  // contacts
  const contacts = Array.isArray(input.contacts) ? input.contacts : [];
  contacts.forEach((c, idx) => {
    if (!c || typeof c !== "object") return;
    events.push({
      kind: "contact",
      id: c.uid ? `contact-${c.uid}` : `contact-${idx}`,
      capturedAt: snapshottedAt, // SIMPLE_USER has no per-row timestamp
      uid: c.uid || null,
      shortId: c.shortId || null,
      name: c.name || null,
      avatarUrl: c.avatarUrl || null,
      followStatus:
        typeof c.followStatus === "number" ? c.followStatus : null,
    });
  });

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshottedAt,
    account,
    events,
  };
}

/**
 * Write a snapshot to disk as JSON. Default destination is
 * `<os.tmpdir()>/cc-douyin-snapshot-<uuid>.json`. Returns the absolute
 * path. Caller is responsible for cleanup.
 */
function writeSnapshotJson(snapshot, opts = {}) {
  const dir = opts.dir || os.tmpdir();
  const fileName =
    opts.fileName || `cc-douyin-snapshot-${crypto.randomUUID()}.json`;
  if (fileName.includes("/") || fileName.includes("\\")) {
    throw new Error(
      "writeSnapshotJson: opts.fileName must be a basename, not a path",
    );
  }
  const full = path.join(dir, fileName);
  fs.writeFileSync(full, JSON.stringify(snapshot), "utf-8");
  return full;
}

/**
 * Best-effort delete of a snapshot file. Used in finally blocks; never
 * throws.
 */
function cleanupSnapshotJson(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_e) {
    // ignore
  }
}

module.exports = {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
};
