'use strict';
/**
 * qq-nt-collect — on-device-ready QQNT (nt_msg.db) decrypt + protobuf-parse.
 *
 * Pure Node (crypto + a caller-provided better-sqlite3 ctor) — NO frida, NO adb.
 * This is the bundle-shipped core behind `cc hub collect-qq`, which the Android
 * `CollectQqNativeTool` invokes after su-staging the encrypted DB + uid list. The
 * exact same logic runs on PC (USB pull) and on-device (app su-read).
 *
 * Method (key DERIVED, no frida): `key = MD5(MD5(uid) + rand)` → SQLCipher
 * PBKDF2-HMAC-SHA512/1 (iter 4000) → AES-256-CBC. `rand` is read from the 1024-byte
 * plaintext header; `uid` (QQNT `u_...`) is brute-forced from candidates — page 1
 * decrypting to a valid SQLite header identifies the self uid. (See
 * scripts/android/pdh-qq-android-decrypt.mjs for the standalone PC tool this was
 * extracted from; behaviour is byte-identical.)
 */
const crypto = require('crypto');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/** Read `rand` (protobuf field after "QQ_NT DB") from the plaintext header. */
function extractRand(raw) {
  const head = raw.subarray(0, 256).toString('latin1');
  const i = head.indexOf('QQ_NT DB');
  if (i < 0) return null;
  const m = head.slice(i + 8, i + 40).match(/[A-Za-z0-9]{6,12}/);
  return m ? m[0] : null;
}

/** Detect HMAC algo named in the header (informational). */
function headerHmac(raw) {
  return (/HMAC_SHA\d+/.exec(raw.subarray(0, 256).toString('latin1')) || [])[0] || null;
}

// decrypt one page slice. p1=true → page 1 (first 16 bytes = salt, skipped).
function decPage(page, encKey, reserve, ivOff, p1) {
  const ro = page.length - reserve;
  const ct = page.subarray(p1 ? 16 : 0, ro);
  const iv = page.subarray(ro + ivOff, ro + ivOff + 16);
  if (iv.length < 16) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    return null;
  }
}
const validHdr = (pt) => pt && pt.length > 8 && pt[5] === 64 && pt[6] === 32 && pt[7] === 32;
const CFG = [[4096, 48, 0], [4096, 80, 0], [4096, 48, 20]];

/**
 * Brute the key over uid candidates, then decrypt every page.
 * @returns {{decrypted: Buffer, uid: string, kdf: string}|null} null = no uid matched.
 */
function deriveAndDecrypt(raw, uids, rand) {
  if (!raw || raw.length <= 1024 || !rand || !uids || !uids.length) return null;
  const body = raw.subarray(1024);
  const salt = body.subarray(0, 16);
  let hit = null;
  for (const uid of uids) {
    const pass = md5(md5(uid) + rand);
    for (const algo of ['sha512', 'sha1']) {
      const ek = crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, 4000, 32, algo);
      for (const [pg, rs, iv] of CFG) {
        if (validHdr(decPage(body.subarray(0, pg), ek, rs, iv, true))) {
          hit = { uid, algo, page: pg, reserve: rs, ivOff: iv, ek };
          break;
        }
      }
      if (hit) break;
    }
    if (hit) break;
  }
  if (!hit) return null;
  const { ek, page, reserve, ivOff } = hit;
  const n = Math.floor(body.length / page);
  const out = [];
  for (let i = 0; i < n; i++) {
    const pt = decPage(body.subarray(i * page, (i + 1) * page), ek, reserve, ivOff, i === 0);
    const full = Buffer.alloc(page);
    if (i === 0) {
      Buffer.from('SQLite format 3\0').copy(full, 0);
      if (pt) pt.copy(full, 16);
    } else if (pt) {
      pt.copy(full, 0);
    }
    out.push(full);
  }
  return { decrypted: Buffer.concat(out), uid: hit.uid, kdf: hit.algo };
}

// ── protobuf message-body → readable text (from pdh-qq-ingest.mjs) ──────────
function readVarint(buf, p) {
  let shift = 0, r = 0n;
  while (p < buf.length) {
    const b = buf[p++];
    r |= BigInt(b & 0x7f) << BigInt(shift);
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [r, p];
}
function* fields(buf) {
  let p = 0;
  while (p < buf.length) {
    let tag;[tag, p] = readVarint(buf, p); tag = Number(tag);
    const wire = tag & 7;
    if (wire === 0) { let v;[v, p] = readVarint(buf, p); } else if (wire === 2) {
      let len;[len, p] = readVarint(buf, p); len = Number(len);
      const data = buf.subarray(p, p + len); p += len; yield data;
    } else if (wire === 5) p += 4; else if (wire === 1) p += 8; else return;
  }
}
const readable = (s) => s && /[一-鿿　-ヿA-Za-z0-9]/.test(s) && !/[�]/.test(s) &&
  [...s].every((c) => c.charCodeAt(0) >= 32 || c === '\n');
function extractTexts(buf, depth, out) {
  if (depth > 6 || !buf || buf.length === 0) return;
  for (const data of fields(buf)) {
    if (!data || data.length === 0) continue;
    let s = null; try { s = data.toString('utf8'); } catch {}
    if (s && Buffer.from(s, 'utf8').equals(data) && readable(s) && s.length <= 1000 &&
      !/^https?:\/\/\S+$/.test(s)) out.push(s);
    if (data.length >= 2) extractTexts(data, depth + 1, out);
  }
}
function bodyText(blob) {
  if (!Buffer.isBuffer(blob)) return null;
  const out = []; extractTexts(blob, 0, out);
  const cjk = out.filter((t) => /[一-鿿]/.test(t)).sort((a, b) => b.length - a.length);
  return cjk[0] || out.sort((a, b) => b.length - a.length)[0] || null;
}

/**
 * Parse a DECRYPTED nt_msg.db into vault events (qq-pc adapter shape).
 * @param Database  a better-sqlite3 constructor (injected by the caller/bundle)
 * @param dbPath    path to the decrypted nt_msg.db
 * @param self      the user's own QQ number (attribution fallback)
 * @returns {Array} event objects ready for vault.putEvent
 */
function parseEvents(Database, dbPath, self) {
  const src = new Database(dbPath, { readonly: true });
  const events = [];
  const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
  const ingestTable = (table, isGroup) => {
    let rows;
    try {
      rows = src.prepare(
        `SELECT [40001] msgId,[40020] uid,[40011] type,[40033] sender,[40021] peer,` +
        `[40050] t,[40800] body FROM ${table}`,
      ).safeIntegers().all();
    } catch { return; }
    for (const r of rows) {
      const type = num(r.type);
      if (type === 5 || type === 9) continue; // grey-bar / system
      const text = bodyText(r.body);
      if (!text || !/[一-鿿A-Za-z0-9]/.test(text)) continue;
      // QQ service/gray-tip config messages (e.g. com.tencent.* push configs) —
      // not real chat; drop so the vault holds conversation, not service noise.
      if (text.includes('com.tencent.') || text.includes('public desc')) continue;
      const msgId = typeof r.msgId === 'bigint' ? r.msgId.toString() : String(r.msgId);
      const sender = String(num(r.sender) || '');
      const peer = String(num(r.peer) || '');
      const occurredAt = num(r.t) * 1000;
      if (!occurredAt) continue;
      const actor = sender ? `person-qq-${sender}` : `person-qq-${self}`;
      const participants = [actor];
      participants.push(isGroup ? `group-qq-${peer}` : `person-qq-${peer}`);
      events.push({
        type: 'event', subtype: 'message', id: `qq:${table}:${msgId}`,
        occurredAt, actor, participants,
        content: { text: isGroup ? `[群${peer}] ${text}` : text },
        topics: isGroup ? [`group-qq-${peer}`] : undefined,
        source: {
          adapter: 'qq-pc', adapterVersion: '0.1.0', originalId: `${table}:${msgId}`,
          capturedAt: occurredAt, capturedBy: 'sqlite',
        },
        ingestedAt: Date.now(),
      });
    }
  };
  try {
    ingestTable('c2c_msg_table', false);
    ingestTable('group_msg_table', true);
  } finally {
    src.close();
  }
  return events;
}

module.exports = { extractRand, headerHmac, deriveAndDecrypt, bodyText, parseEvents };
