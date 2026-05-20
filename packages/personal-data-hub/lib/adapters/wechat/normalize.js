/**
 * Phase 12 v0.5 — WeChat row → UnifiedSchema mapping.
 *
 * Per `Adapter_WeChat_SQLCipher.md` §7. Pure function (DB row in → batch
 * out); orchestrated by WechatAdapter.normalize() during ingest.
 */

"use strict";

const { newId } = require("../../ids");
const { parseContent, isGroupTalker } = require("./content-parser");

const NAME = "wechat";
const VERSION = "0.5.0"; // Phase 12 v0.5 — frida-indep slice

/**
 * Map a single message row to a NormalizedBatch.
 *
 * @param {object} row    raw WeChat message row
 * @param {object} ctx    { contactByUsername, chatroomByName, accountUin }
 * @returns {NormalizedBatch}
 */
function normalizeMessage(row, ctx = {}) {
  if (!row || typeof row !== "object") {
    throw new Error("normalizeMessage: row required");
  }
  const parsed = parseContent(row);
  const isGroup = isGroupTalker(row.talker);
  const now = Date.now();
  const occurredAt = Number.isFinite(Number(row.createTime)) ? Number(row.createTime) : now;
  const isSend = Number(row.isSend) === 1;

  const accountUin = ctx.accountUin || "wechat-self";
  const selfId = `person-wechat-${accountUin}`;
  const peerWxid = row.talker;
  const peerId = peerWxid ? wxidToPersonId(peerWxid) : null;

  // Group senders use the prefix in parsed.structured.senderWxid; in
  // 1-on-1 chats actor = talker (inbound) or self (outbound).
  let actorId;
  if (isGroup) {
    const senderWxid = parsed.structured && parsed.structured.senderWxid;
    actorId = senderWxid ? wxidToPersonId(senderWxid) : (isSend ? selfId : peerId);
  } else {
    actorId = isSend ? selfId : peerId;
  }

  const participants = [];
  if (peerId) participants.push(peerId);
  participants.push(selfId);

  const eventId = newId();
  const source = {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: String(row.msgSvrId || row.msgId || `wechat-msg-${eventId}`),
    capturedAt: occurredAt,
    capturedBy: "sqlite",
  };

  // Subtype mapping per UnifiedSchema EVENT_SUBTYPES
  let subtype = "message";
  if (parsed.kind === "voipcall") subtype = "call";
  else if (parsed.kind === "system") subtype = "interaction";
  else if (parsed.kind === "redpacket") subtype = "redenvelope";
  else if (parsed.kind === "image" || parsed.kind === "video" || parsed.kind === "emoji" || parsed.kind === "voice") {
    subtype = "media";
  }
  else subtype = "message";

  const event = {
    id: eventId,
    type: "event",
    subtype,
    occurredAt,
    actor: actorId || selfId,
    participants: dedup(participants).filter(Boolean),
    content: {
      title: parsed.text.slice(0, 80) || "(无内容)",
      text: parsed.text,
    },
    ingestedAt: now,
    source,
    extra: {
      wechatType: Number(row.type),
      isSend,
      talker: row.talker,
      ...(isGroup ? { isGroup: true, chatroom: row.talker } : {}),
      ...parsed.structured,
    },
  };

  // Persons — talker / sender; merge-group keys via wxid
  const persons = [];
  if (peerId && peerId !== selfId) {
    persons.push({
      id: peerId,
      type: "person",
      subtype: isGroup ? "unknown" : "contact",
      names: [contactDisplayName(ctx.contactByUsername, row.talker)],
      identifiers: { wechatId: row.talker },
      ingestedAt: now,
      source,
      extra: { fromAdapter: NAME, wxid: row.talker },
    });
  }
  // For group messages, also add the sender as a person if known
  if (isGroup && parsed.structured && parsed.structured.senderWxid) {
    const senderId = wxidToPersonId(parsed.structured.senderWxid);
    if (senderId !== selfId && !persons.some((p) => p.id === senderId)) {
      persons.push({
        id: senderId,
        type: "person",
        subtype: "contact",
        names: [contactDisplayName(ctx.contactByUsername, parsed.structured.senderWxid)],
        identifiers: { wechatId: parsed.structured.senderWxid },
        ingestedAt: now,
        source,
        extra: { fromAdapter: NAME, wxid: parsed.structured.senderWxid },
      });
    }
  }

  // Topic — every group chat is a Topic (per design doc OQ-4 = C)
  const topics = [];
  if (isGroup) {
    const chatroomName = (ctx.chatroomByName && ctx.chatroomByName[row.talker])
      || row.talker.replace("@chatroom", "");
    topics.push({
      id: `topic-wechat-group-${row.talker}`,
      type: "topic",
      name: chatroomName,
      derivedFromEvents: [event.id],
      ingestedAt: now,
      source,
      extra: { wxid: row.talker, fromAdapter: NAME },
    });
    if (!event.extra.topicId) event.extra.topicId = topics[0].id;
  }

  return { events: [event], persons, places: [], items: [], topics };
}

/**
 * Map a contact row to a Person entity. Used for backfill — adapter
 * yields RawContact records via sync(); normalize() turns them into
 * persons.
 */
function normalizeContact(row, ctx = {}) {
  if (!row || !row.username) return { events: [], persons: [], places: [], items: [], topics: [] };
  const now = Date.now();
  const source = {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: `wechat-contact-${row.username}`,
    capturedAt: now,
    capturedBy: "sqlite",
  };
  const names = [row.conRemark, row.nickname, row.alias, row.username]
    .filter((n) => typeof n === "string" && n.length > 0);
  const subtype = guessContactSubtype(row);
  const person = {
    id: wxidToPersonId(row.username),
    type: "person",
    subtype,
    names: dedup(names),
    identifiers: { wechatId: row.username },
    ingestedAt: now,
    source,
    extra: { fromAdapter: NAME, wxid: row.username, wechatType: row.type },
  };
  return { events: [], persons: [person], places: [], items: [], topics: [] };
}

// ─── helpers ────────────────────────────────────────────────────────────

function wxidToPersonId(wxid) {
  if (!wxid) return null;
  // Stable id keyed off wxid (Phase 8 EntityResolver R1 will dedup
  // across adapters via the `wechatId` identifier).
  return `person-wechat-${wxid}`;
}

function dedup(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (x == null || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function contactDisplayName(byUsername, wxid) {
  if (byUsername && byUsername[wxid]) {
    const c = byUsername[wxid];
    return c.conRemark || c.nickname || c.alias || wxid;
  }
  return wxid;
}

function guessContactSubtype(row) {
  // rcontact.type bits: official accounts / group / regular contact /
  // black list. Detailed mapping in WeChat reverse-eng community —
  // for v0.5 we keep it simple: anything that's not the user's self is
  // "contact". Phase 12.6 will refine with full bit mapping.
  if (typeof row.username === "string" && row.username.endsWith("@chatroom")) {
    return "unknown"; // chat group, not a Person
  }
  return "contact";
}

module.exports = {
  normalizeMessage,
  normalizeContact,
  wxidToPersonId,
  NAME,
  VERSION,
};
