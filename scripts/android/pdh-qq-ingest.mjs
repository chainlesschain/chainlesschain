#!/usr/bin/env node
/**
 * pdh-qq-ingest.mjs — Ingest a decrypted QQ NT DB (QQ_nt_msg_decrypted.db) into the PDH
 * vault. Decodes the protobuf message body (col 40800) to readable text in pure Node
 * (no python sidecar) and writes message events (searchable via `cc hub search`).
 *
 * Usage:
 *   node scripts/android/pdh-qq-ingest.mjs --db "<...>/QQ_nt_msg_decrypted.db" --self <yourQQ>
 *
 * Cols (QQ NT): 40001=msgId 40011=type 40033=sender(QQ) 40021=peer/group 40050=time(s)
 *   40800=body(protobuf). Text element string lives nested in the protobuf → recursive
 *   string-extract + CJK heuristic. type 2=normal msg; 5/9=system grey-bar (skipped).
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const DB = val('--db');
const SELF = val('--self', 'self');
if (!DB) { console.error('need --db <QQ_nt_msg_decrypted.db>'); process.exit(1); }

// ---- protobuf string extractor ----
function readVarint(buf, p) { let shift = 0, r = 0n; while (p < buf.length) { const b = buf[p++]; r |= BigInt(b & 0x7f) << BigInt(shift); if (!(b & 0x80)) break; shift += 7; } return [r, p]; }
function* fields(buf) {
  let p = 0;
  while (p < buf.length) {
    let tag; [tag, p] = readVarint(buf, p); tag = Number(tag);
    const wire = tag & 7;
    if (wire === 0) { let v;[v, p] = readVarint(buf, p); }
    else if (wire === 2) { let len;[len, p] = readVarint(buf, p); len = Number(len); const data = buf.subarray(p, p + len); p += len; yield data; }
    else if (wire === 5) p += 4; else if (wire === 1) p += 8; else return;
  }
}
const readable = (s) => s && /[一-鿿　-ヿA-Za-z0-9]/.test(s) && !/[�]/.test(s) && [...s].every((c) => c.charCodeAt(0) >= 32 || c === '\n');
function extractTexts(buf, depth, out) {
  if (depth > 6 || !buf || buf.length === 0) return;
  for (const data of fields(buf)) {
    if (!data || data.length === 0) continue;
    let s = null; try { s = data.toString('utf8'); } catch {}
    if (s && Buffer.from(s, 'utf8').equals(data) && readable(s) && s.length <= 1000 && !/^https?:\/\/\S+$/.test(s)) out.push(s);
    if (data.length >= 2) extractTexts(data, depth + 1, out);
  }
}
function bodyText(blob) {
  if (!Buffer.isBuffer(blob)) return null;
  const out = []; extractTexts(blob, 0, out);
  const cjk = out.filter((t) => /[一-鿿]/.test(t)).sort((a, b) => b.length - a.length);
  return (cjk[0] || out.sort((a, b) => b.length - a.length)[0] || null);
}

const src = new Database(DB, { readonly: true });
const wiring = await import(pathToFileURL(path.join(ROOT, 'packages/cli/src/lib/personal-data-hub-wiring.js')).href);
const hub = await wiring.getHub();
const vault = hub.registry.vault;
const vdb = vault.db || vault._db;
const before = vault.stats().events;

function ingestTable(table, isGroup) {
  let rows; try { rows = src.prepare(`SELECT [40001] msgId,[40020] uid,[40011] type,[40033] sender,[40021] peer,[40050] t,[40800] body FROM ${table}`).safeIntegers().all(); } catch { return 0; }
  const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
  const events = [];
  for (const r of rows) {
    const type = num(r.type);
    if (type === 5 || type === 9) continue;              // grey-bar / system
    const text = bodyText(r.body);
    if (!text || !/[一-鿿A-Za-z0-9]/.test(text)) continue;
    const msgId = (typeof r.msgId === 'bigint' ? r.msgId.toString() : String(r.msgId));  // 40001 = per-msg snowflake, unique (40020 is sender uid → not unique)
    const uid = msgId;
    const sender = String(num(r.sender) || '');
    const peer = String(num(r.peer) || '');
    const occurredAt = num(r.t) * 1000;
    if (!occurredAt) continue;
    const actor = sender ? `person-qq-${sender}` : `person-qq-${SELF}`;
    const participants = [actor];
    if (isGroup) participants.push(`group-qq-${peer}`); else participants.push(`person-qq-${peer}`);
    events.push({
      type: 'event', subtype: 'message', id: `qq:${table}:${uid}`,
      occurredAt, actor, participants,
      content: { text: isGroup ? `[群${peer}] ${text}` : text },
      topics: isGroup ? [`group-qq-${peer}`] : undefined,
      source: { adapter: 'qq-pc', adapterVersion: '0.1.0', originalId: `${table}:${uid}`, capturedAt: occurredAt, capturedBy: 'sqlite' },
      ingestedAt: Date.now(),
    });
  }
  const tx = vdb.transaction((b) => { let ok = 0; for (const ev of b) { try { vault.putEvent(ev); ok++; } catch {} } return ok; });
  let total = 0; for (let i = 0; i < events.length; i += 2000) total += tx(events.slice(i, i + 2000));
  console.log(`  ${table}: ${total} events (from ${rows.length} rows)`);
  return total;
}
console.log('[ingest] QQ messages (protobuf-decoded)...');
ingestTable('c2c_msg_table', false);
ingestTable('group_msg_table', true);
src.close();
console.log(`[vault] events ${before}→${vault.stats().events} (+${vault.stats().events - before})`);
