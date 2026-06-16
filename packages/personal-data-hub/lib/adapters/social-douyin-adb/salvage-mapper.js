"use strict";
/*
 * Glue: leaf-salvaged records → parseImDb-shaped output.
 *
 * The leaf-page salvager (scripts/android/pdh-sqlite-leaf-salvage.js) emits raw
 * positional tuples {rowid, cols:[...]} (leaf pages carry no column names). This
 * maps them into the SAME shape `parseImDb` returns ({messages, contacts,
 * conversations}) so the existing DouyinAdapter.normalize path ingests them
 * unchanged — closing the loop: Method-B dump → salvage → THIS → PDH entities.
 *
 * Column order comes from the table's CREATE TABLE (see docs/internal/
 * pdh-app-db-schemas.md or grep the dump). Pass it explicitly for correctness;
 * `inferMsgColumns` offers a heuristic fallback (content=JSON/longest text,
 * created_time=epoch int) when the exact order is unknown.
 */
const { _internals } = require("./im-db-parser");
const { extractTextFromContent, normalizeEpochMs } = _internals;

function zip(cols, names) {
  const o = {};
  for (let i = 0; i < names.length; i++) o[names[i]] = cols[i];
  return o;
}

// Map msg-table salvaged records given the ordered column names.
function mapMsgRecords(records, columns) {
  const out = [];
  for (const r of records || []) {
    if (!r || !Array.isArray(r.cols)) continue;
    const row = zip(r.cols, columns);
    if (row.content == null && row.created_time == null) continue;
    const t = typeof row.created_time === "number" ? row.created_time
      : Number(row.created_time);
    out.push({
      senderUid: row.sender != null ? String(row.sender) : null,
      conversationId: row.conversation_id != null ? String(row.conversation_id) : null,
      createdTimeMs: normalizeEpochMs(Number.isFinite(t) ? t : 0),
      text: extractTextFromContent(row.content),
      readStatus: typeof row.read_status === "number" ? row.read_status : null,
      contentBlob: typeof row.content === "string" ? row.content : null,
    });
  }
  return out;
}

function mapParticipantRecords(records, columns) {
  const seen = new Set();
  const out = [];
  for (const r of records || []) {
    if (!r || !Array.isArray(r.cols)) continue;
    const row = zip(r.cols, columns);
    const uid = row.user_id != null ? String(row.user_id) : null;
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push({ uid, shortId: null, name: null, avatarUrl: null, followStatus: null, fromParticipant: true });
  }
  return out;
}

function mapConversationRecords(records, columns) {
  const out = [];
  for (const r of records || []) {
    if (!r || !Array.isArray(r.cols)) continue;
    const row = zip(r.cols, columns);
    if (row.conversation_id == null) continue;
    out.push({
      conversationId: String(row.conversation_id),
      conversationType: typeof row.type === "number" ? row.type : null,
      lastMsgTimeMs: normalizeEpochMs(Number(row.last_msg_create_time) || 0),
      stranger: typeof row.stranger === "number" ? row.stranger === 1 : null,
    });
  }
  return out;
}

/**
 * Heuristic: when the exact `msg` column order is unknown, guess content +
 * created_time positions from value shapes (content = a JSON-ish / longest
 * string; created_time = the largest plausible-epoch integer). Returns a column
 * name array usable with mapMsgRecords (unknown slots get c0,c1,...).
 */
function inferMsgColumns(records) {
  const sample = (records || []).find((r) => r && Array.isArray(r.cols) && r.cols.length >= 3);
  if (!sample) return [];
  const cols = sample.cols;
  const names = cols.map((_, i) => `c${i}`);
  let contentIdx = -1, contentScore = -1;
  let timeIdx = -1, timeVal = -1;
  for (let i = 0; i < cols.length; i++) {
    const v = cols[i];
    if (typeof v === "string") {
      const score = (v.trim().startsWith("{") ? 1e6 : 0) + v.length;
      if (score > contentScore) { contentScore = score; contentIdx = i; }
    } else if (typeof v === "number" && v > 1e9 && v > timeVal) {
      // largest epoch-ish int → created_time (ms/sec/us all > 1e9)
      timeVal = v; timeIdx = i;
    }
  }
  if (contentIdx >= 0) names[contentIdx] = "content";
  if (timeIdx >= 0 && timeIdx !== contentIdx) names[timeIdx] = "created_time";
  return names;
}

// One-shot: salvaged records (mixed) → parseImDb shape, given per-table columns.
function mapSalvaged({ msg, participant, conversation } = {}) {
  return {
    messages: msg ? mapMsgRecords(msg.records, msg.columns) : [],
    contacts: participant ? mapParticipantRecords(participant.records, participant.columns) : [],
    conversations: conversation ? mapConversationRecords(conversation.records, conversation.columns) : [],
  };
}

module.exports = {
  mapMsgRecords,
  mapParticipantRecords,
  mapConversationRecords,
  inferMsgColumns,
  mapSalvaged,
};
