#!/usr/bin/env node
/**
 * pdh-qq-contacts-ingest.mjs — Ingest QQ NT contacts (profile_info.db) + groups
 * (group_info.db) into the PDH vault as persons + topics.
 *
 * Decrypt those DBs first (same account key as nt_msg.db) — Android:
 *   pdh-qq-android-decrypt.mjs derivation per-DB; or pass already-decrypted DBs.
 *
 * Plaintext cols (QQ NT): profile_info_v6 → 1002=QQ号 20002=昵称 1000=uid;
 *   group_detail_info_ver1/group_list → 60001=群内部id 60007=群名 60004=群主QQ 60006=人数。
 *
 * Usage:
 *   node scripts/android/pdh-qq-contacts-ingest.mjs --profile <dec_profile_info.db> --group <dec_group_info.db>
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const argv = process.argv.slice(2);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const PROFILE = val('--profile'), GROUP = val('--group');

const wiring = await import(pathToFileURL(path.join(ROOT, 'packages/cli/src/lib/personal-data-hub-wiring.js')).href);
const hub = await wiring.getHub();
const vault = hub.registry.vault;
const vdb = vault.db || vault._db;
const now = Date.now();
const src = (adapter, originalId) => ({ adapter, adapterVersion: '0.1.0', originalId, capturedAt: now, capturedBy: 'sqlite' });

let persons = 0, topics = 0;
if (PROFILE) {
  const db = new Database(PROFILE, { readonly: true });
  const rows = db.prepare("SELECT [1000] uid,[1002] uin,[20002] nick FROM profile_info_v6").safeIntegers().all();
  db.close();
  const seen = new Set();
  const tx = vdb.transaction((b) => { for (const p of b) { try { vault.putPerson(p); persons++; } catch {} } });
  const batch = [];
  for (const r of rows) {
    const uin = String(typeof r.uin === 'bigint' ? r.uin : r.uin || '');
    if (!uin || uin === '0' || seen.has(uin)) continue; seen.add(uin);
    const nick = (typeof r.nick === 'string' ? r.nick.trim() : '') || `QQ${uin}`;
    const ids = { qq: uin }; if (typeof r.uid === 'string' && r.uid) ids.qqUid = r.uid;
    batch.push({ type: 'person', subtype: 'contact', id: `person-qq-${uin}`, names: [nick], identifiers: ids, source: src('qq-pc', `profile:${uin}`), ingestedAt: now });
  }
  for (let i = 0; i < batch.length; i += 1000) tx(batch.slice(i, i + 1000));
  console.log(`contacts: ${persons} persons (from ${rows.length} rows)`);
}
if (GROUP) {
  const db = new Database(GROUP, { readonly: true });
  let rows = [];
  try { rows = db.prepare("SELECT [60001] gid,[60007] name,[60004] owner,[60006] members FROM group_detail_info_ver1").safeIntegers().all(); }
  catch { try { rows = db.prepare("SELECT [60001] gid,[60007] name FROM group_list").safeIntegers().all(); } catch {} }
  db.close();
  const tx = vdb.transaction((b) => { for (const t of b) { try { vault.putTopic(t); topics++; } catch {} } });
  const batch = [];
  const seen = new Set();
  for (const r of rows) {
    const gid = String(typeof r.gid === 'bigint' ? r.gid : r.gid || '');
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!gid || !name || seen.has(gid)) continue; seen.add(gid);
    batch.push({ type: 'topic', id: `group-qq-${gid}`, name, source: src('qq-pc', `group:${gid}`), ingestedAt: now });
  }
  for (let i = 0; i < batch.length; i += 1000) tx(batch.slice(i, i + 1000));
  console.log(`groups: ${topics} topics (from ${rows.length} rows)`);
}
const s = vault.stats();
console.log(`[vault] persons=${s.persons} topics=${s.topics}`);
