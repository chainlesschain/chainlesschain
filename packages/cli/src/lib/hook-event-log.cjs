"use strict";

/**
 * hook-event-log — a persistent, hash-chained, replay-safe log of the hook
 * delivery envelopes produced by the unified event bus ([[hook-event-bus.cjs]]).
 *
 * The event bus already stamps every settings-hook delivery with a stable
 * `event_id` (see [[settings-hook-events.cjs]] `withDeliveryId`), but until now
 * the full envelope was discarded — so there was nothing to look up when a user
 * wants `cc hook replay <event-id>`. This store persists each envelope to a
 * tamper-evident JSONL log so the replay command has a real source.
 *
 * Design:
 * - OPT-IN: recording only happens when `CC_HOOK_EVENT_LOG` is enabled, so the
 *   default hook-firing path is byte-for-byte unchanged (no new IO per turn).
 * - Hash chain: each line is `{envelope, prevHash, hash}` where
 *   `hash = sha256(prevHash + stableStringify(envelope))`. Editing / deleting /
 *   reordering any recorded line breaks the chain (mirrors the session
 *   transcript integrity design), which `verifyHookEventChain` detects.
 * - Size guard: the log rotates to `<file>.1` once it exceeds MAX_LOG_BYTES so
 *   an always-on session can't grow it without bound.
 * - Pure over injected IO (`_deps.fs` / `_deps.os`) so it is fully unit-testable
 *   without touching the real home directory.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { stableStringify } = require("./hook-event-bus.cjs");

const _deps = { fs, os };

/** Cap the always-on log at 5 MiB, then rotate to `<file>.1`. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** Default log location: `~/.chainlesschain/hook-events.jsonl`. */
function hookEventLogPath(homedir) {
  const home = homedir || _deps.os.homedir();
  return path.join(home, ".chainlesschain", "hook-events.jsonl");
}

/** Recording is opt-in — `CC_HOOK_EVENT_LOG=1` (or `true`) turns it on. */
function isHookEventLogEnabled(env = process.env) {
  const v = String(env.CC_HOOK_EVENT_LOG || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Hash one envelope against the previous chain hash (deterministic). */
function computeChainHash(prevHash, envelope) {
  return crypto
    .createHash("sha256")
    .update(`${prevHash || "genesis"}\n${stableStringify(envelope)}`, "utf-8")
    .digest("hex");
}

/** The hash the NEXT record must chain from (last parseable line's `hash`). */
function latestChainHash(text) {
  const lines = String(text || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    try {
      const rec = JSON.parse(lines[i]);
      return typeof rec?.hash === "string" ? rec.hash : null;
    } catch {
      // half-written tail line — chain from the previous intact record
      continue;
    }
  }
  return null;
}

/**
 * Append a hook envelope to the chained log. Best-effort: never throws — a
 * failure to record must not break the turn that fired the hook.
 *
 * @param {object} envelope   a full envelope from buildHookEnvelope
 * @param {object} [opts]     { filePath, homedir }
 * @returns {{ok:boolean, event_id?:string, hash?:string, reason?:string}}
 */
function appendHookEvent(envelope, { filePath, homedir } = {}) {
  if (!envelope || typeof envelope !== "object" || !envelope.event_id) {
    return { ok: false, reason: "invalid envelope (no event_id)" };
  }
  const f = _deps.fs;
  const fp = filePath || hookEventLogPath(homedir);
  try {
    const dir = path.dirname(fp);
    if (!f.existsSync(dir)) f.mkdirSync(dir, { recursive: true });
    let prevHash = null;
    if (f.existsSync(fp)) {
      let rotated = false;
      try {
        if (f.statSync(fp).size > MAX_LOG_BYTES) {
          f.renameSync(fp, `${fp}.1`);
          rotated = true;
        }
      } catch {
        /* stat/rename best-effort */
      }
      if (!rotated) prevHash = latestChainHash(f.readFileSync(fp, "utf-8"));
    }
    const hash = computeChainHash(prevHash, envelope);
    const line = `${JSON.stringify({ envelope, prevHash, hash })}\n`;
    f.appendFileSync(fp, line, "utf-8");
    return { ok: true, event_id: envelope.event_id, hash };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Read every recorded record (skips malformed / half-written lines). */
function readHookEventRecords({ filePath, homedir } = {}) {
  const f = _deps.fs;
  const fp = filePath || hookEventLogPath(homedir);
  if (!f.existsSync(fp)) return [];
  const out = [];
  for (const line of f.readFileSync(fp, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip malformed / partial line */
    }
  }
  return out;
}

/**
 * Look up the envelope for a delivery id. The LATEST matching record wins (an
 * event_id can recur across processes; the most recent delivery is what a user
 * replaying "the last one" means).
 */
function findHookEvent(eventId, { filePath, homedir } = {}) {
  if (!eventId) return null;
  const records = readHookEventRecords({ filePath, homedir });
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]?.envelope?.event_id === eventId) return records[i].envelope;
  }
  return null;
}

/** The most recent `limit` envelopes (newest last), for `cc hook events-log`. */
function listHookEvents({ limit = 20, filePath, homedir } = {}) {
  const records = readHookEventRecords({ filePath, homedir });
  const n = Math.max(0, Number(limit) || 0);
  return records.slice(n ? -n : 0).map((r) => r.envelope);
}

/**
 * Recompute the chain and report the first break, if any.
 * @returns {{ok:boolean, length:number, brokenAt:number, reason?:string}}
 */
function verifyHookEventChain({ filePath, homedir } = {}) {
  const records = readHookEventRecords({ filePath, homedir });
  let prev = null;
  for (let i = 0; i < records.length; i++) {
    const { envelope, prevHash, hash } = records[i] || {};
    if ((prevHash ?? null) !== prev) {
      return {
        ok: false,
        length: records.length,
        brokenAt: i,
        reason: "prevHash does not match the previous record's hash",
      };
    }
    const expect = computeChainHash(prev, envelope);
    if (expect !== hash) {
      return {
        ok: false,
        length: records.length,
        brokenAt: i,
        reason: "record hash does not match its envelope (tampered)",
      };
    }
    prev = hash;
  }
  return { ok: true, length: records.length, brokenAt: -1 };
}

module.exports = {
  MAX_LOG_BYTES,
  hookEventLogPath,
  isHookEventLogEnabled,
  computeChainHash,
  latestChainHash,
  appendHookEvent,
  readHookEventRecords,
  findHookEvent,
  listHookEvents,
  verifyHookEventChain,
  _deps,
};
