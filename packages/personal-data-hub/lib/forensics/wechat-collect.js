'use strict';
/**
 * wechat-collect — on-device-ready WeChat (EnMicroMsg.db) decrypt + parse.
 *
 * Pure Node (crypto + a caller-provided better-sqlite3 ctor) — NO frida. Same
 * model as qq-nt-collect.js: derived key (`MD5(IMEI+uin)[:7]`) → SQLCipher
 * (page-level AES-256-CBC) → parse message/rcontact/chatroom → vault events.
 * The bundle-shipped core behind `cc hub collect-wechat`; the Magisk daemon
 * stages EnMicroMsg.db + uins (+ IMEI candidates) and this decrypts on-device.
 * Extracted from scripts/android/pdh-wechat-decrypt.mjs (byte-identical crypto;
 * verified WeChat 8.0.74 on chopin).
 *
 * IMEI on Android 13 is often unreadable → pass a SAVED 7-char key (once found
 * it never changes for an account) or a frida raw key as a fallback candidate.
 */
const crypto = require('crypto');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const CONFIGS = [
  { name: 'sc1', pageSize: 1024, reserve: 16, hmac: 0, kdf: 4000, algo: 'sha1' },
  { name: 'sc2', pageSize: 1024, reserve: 48, hmac: 20, kdf: 4000, algo: 'sha1' },
  { name: 'sc3', pageSize: 1024, reserve: 48, hmac: 20, kdf: 64000, algo: 'sha1' },
  { name: 'sc4', pageSize: 4096, reserve: 80, hmac: 64, kdf: 256000, algo: 'sha512' },
];

function decPage(page, key, cfg, isP1) {
  const reserveOff = cfg.pageSize - cfg.reserve;
  const ct = page.subarray(isP1 ? 16 : 0, reserveOff);
  const reserved = page.subarray(reserveOff, cfg.pageSize);
  const iv = cfg.hmac ? reserved.subarray(cfg.hmac, cfg.hmac + 16) : reserved.subarray(0, 16);
  if (iv.length < 16) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    return null;
  }
}
const validP1 = (pt) => pt && pt.length > 8 && pt[5] === 64 && pt[6] === 32 && pt[7] === 32;

/** key = MD5(IMEI+uin)[:7] over candidate imeis × uins, plus any saved/raw keys. */
function computeKeyCandidates(imeis, uins, savedKeys) {
  const set = new Set((savedKeys || []).filter(Boolean));
  for (const im of imeis || []) for (const u of uins || []) set.add(md5(String(im) + String(u)).slice(0, 7));
  return [...set];
}

/**
 * Brute passphrases × configs (+ raw 32-byte keys), then decrypt all pages.
 * @returns {{decrypted: Buffer, cfg: string, pass?: string}|null}
 */
function deriveAndDecrypt(raw, passphrases, rawKeys) {
  if (!raw || raw.length < 1024) return null;
  const salt = raw.subarray(0, 16);
  let hit = null;
  for (const cfg of CONFIGS) {
    for (const p of passphrases || []) {
      const k = crypto.pbkdf2Sync(Buffer.from(p, 'utf8'), salt, cfg.kdf, 32, cfg.algo === 'sha512' ? 'sha512' : 'sha1');
      if (validP1(decPage(raw.subarray(0, cfg.pageSize), k, cfg, true))) { hit = { key: k, cfg, pass: p }; break; }
    }
    if (hit) break;
    for (const rk of rawKeys || []) {
      const kb = Buffer.isBuffer(rk) ? rk : Buffer.from(rk, 'hex');
      if (kb.length === 32 && validP1(decPage(raw.subarray(0, cfg.pageSize), kb, cfg, true))) { hit = { key: kb, cfg }; break; }
    }
    if (hit) break;
  }
  if (!hit) return null;
  const { key, cfg } = hit;
  const n = Math.floor(raw.length / cfg.pageSize);
  const out = [];
  for (let i = 0; i < n; i++) {
    const page = raw.subarray(i * cfg.pageSize, (i + 1) * cfg.pageSize);
    const pt = decPage(page, key, cfg, i === 0);
    const full = Buffer.alloc(cfg.pageSize);
    if (i === 0) { Buffer.from('SQLite format 3\0').copy(full, 0); if (pt) pt.copy(full, 16); } else if (pt) pt.copy(full, 0);
    out.push(full);
  }
  return { decrypted: Buffer.concat(out), cfg: cfg.name, pass: hit.pass };
}

/**
 * Parse a DECRYPTED EnMicroMsg.db → vault events (wechat adapter shape).
 * @param Database better-sqlite3 ctor (injected). @param self the user's wxid.
 */
// Self is ALWAYS the stable canonical id (mirrors adapters/wechat/normalize.js)
// so analysis skills exclude it from contact rankings and it never fragments.
const SELF_ID = 'person-wechat-self';
const SRC = (originalId, at) => ({
  adapter: 'wechat', adapterVersion: '0.1.0',
  originalId: originalId || `wechat-${at || 0}`,
  capturedAt: at || Date.now(), capturedBy: 'sqlite',
});

/**
 * Parse a decrypted EnMicroMsg.db into a vault batch. Returns
 * `{ events, persons, topics }` so the on-device analysis skills get the rich
 * entity graph (named contacts → relations; group topics → interests; clean
 * titles → timeline) instead of bare message events. `self` is ignored — the
 * sender of an outbound message maps to the canonical SELF_ID.
 */
function parseEvents(Database, dbPath, _self) {
  const src = new Database(dbPath, { readonly: true });
  const events = [];
  const persons = new Map(); // id -> person record
  const topics = new Map(); // id -> topic record
  try {
    const nameOf = new Map();
    try {
      for (const r of src.prepare('SELECT username,nickname,conRemark FROM rcontact').all()) {
        nameOf.set(r.username, (r.conRemark && r.conRemark.trim()) || r.nickname || r.username);
      }
    } catch { /* contacts optional */ }
    const addPerson = (wxid) => {
      if (!wxid) return;
      const id = `person-wechat-${wxid}`;
      if (persons.has(id)) return;
      const nm = nameOf.get(wxid);
      // names[0] = display name (or wxid when unresolved); keep wxid as alias.
      const names = nm && nm !== wxid ? [nm, wxid] : [wxid];
      // Unique originalId per person — a shared originalId collapses every row
      // into one via the persons (adapter, originalId) unique constraint.
      persons.set(id, { type: 'person', subtype: 'contact', id, names, identifiers: { wechatId: wxid }, source: SRC(id), ingestedAt: Date.now() });
    };
    const rows = src.prepare(
      'SELECT msgId,type,isSend,createTime,talker,content FROM message ' +
      "WHERE type=1 ORDER BY createTime DESC LIMIT 5000",
    ).all();
    for (const r of rows) {
      const isGroup = /@chatroom$/.test(r.talker || '');
      let text = r.content || '';
      let senderWxid = r.isSend ? null : r.talker; // null = self (outbound)
      if (isGroup && !r.isSend) {
        const c = text.indexOf(':');
        if (c > 0) { senderWxid = text.slice(0, c); text = text.slice(c + 1).replace(/^\n/, '').trim(); }
      }
      if (!text || !/[一-鿿A-Za-z0-9]/.test(text)) continue;
      const occurredAt = Number(r.createTime) || 0; // already ms in WeChat
      if (!occurredAt) continue;
      const peer = String(r.talker || '');
      const actor = r.isSend ? SELF_ID : `person-wechat-${senderWxid || peer}`;
      if (!r.isSend) addPerson(senderWxid || peer);
      const participants = [actor];
      let topicId;
      if (isGroup) {
        topicId = `group-wechat-${peer}`;
        participants.push(topicId);
        if (!topics.has(topicId)) {
          topics.set(topicId, { type: 'topic', id: topicId, name: nameOf.get(peer) || peer.replace('@chatroom', ''), source: SRC(topicId), ingestedAt: Date.now() });
        }
      } else {
        addPerson(peer);
        participants.push(`person-wechat-${peer}`);
      }
      const title = text.replace(/\s+/g, ' ').trim().slice(0, 80);
      events.push({
        type: 'event', subtype: 'message', id: `wechat:${r.msgId}`,
        occurredAt, actor, participants,
        content: { title: title || '(无内容)', text: isGroup ? `[群${nameOf.get(peer) || peer}] ${text}` : text },
        topics: topicId ? [topicId] : undefined,
        source: SRC(String(r.msgId), occurredAt),
        extra: { isSend: !!r.isSend, talker: r.talker },
        ingestedAt: Date.now(),
      });
    }
    persons.set(SELF_ID, { type: 'person', subtype: 'contact', id: SELF_ID, names: ['我(微信)'], source: SRC(SELF_ID), ingestedAt: Date.now() });
  } finally {
    src.close();
  }
  return { events, persons: [...persons.values()], topics: [...topics.values()] };
}

module.exports = { computeKeyCandidates, deriveAndDecrypt, parseEvents };
