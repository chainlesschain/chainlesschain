#!/usr/bin/env node
/**
 * pdh-social-feeds-collect.mjs — pull + ingest social "feed" data from a rooted
 * Android device into the PDH vault. All three sources are PLAINTEXT SQLite
 * (no SQLCipher, no signing), so this is a deterministic root-adb pull + parse:
 *
 *   1. 微信朋友圈  SnsMicroMsg.db (every logged-in MicroMsg account)  → EVENT(post)
 *   2. 头条 阅读   news_article.db (article cache + read_timestamp)    → EVENT(browse)
 *   3. 抖音 观看   video_record.db (record_* watch history, merged)    → EVENT(browse)
 *
 * SnsMicroMsg.db is plaintext (unlike EnMicroMsg.db) — header "SQLite format 3".
 * Reuses the shipped lib readers: forensics/wechat-collect.parseSnsEvents,
 * social-toutiao-adb/article-reader.articlesToVault,
 * social-douyin-adb/watch-history-reader.watchHistoryToVault.
 *
 * Usage:
 *   node scripts/android/pdh-social-feeds-collect.mjs --serial <serial> [--ingest]
 *     (without --ingest = dry run: pull + parse + count, do NOT touch the vault)
 *   --only wechat|toutiao|douyin   collect just one source
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SERIAL = val('--serial');
const DO_INGEST = has('--ingest');
const ONLY = val('--only');
const WORK = path.join(os.tmpdir(), 'pdh-feeds');
fs.mkdirSync(WORK, { recursive: true });
if (!SERIAL) { console.error('need --serial <device-serial>'); process.exit(1); }

function adb(args, { binary = false } = {}) {
  const opts = binary ? { maxBuffer: 1 << 30 } : { encoding: 'utf8', maxBuffer: 1 << 30 };
  try { return execFileSync('adb', ['-s', SERIAL, ...args], opts); }
  catch (e) { if (e.stdout != null) return e.stdout; throw e; }
}
const su = (cmd) => adb(['shell', 'su', '-c', cmd]);
function pull(remote, localName) {
  const tmp = `/data/local/tmp/_feed_${localName}`;
  su(`cat '${remote}' > ${tmp} 2>/dev/null; chmod 666 ${tmp} 2>/dev/null`);
  const local = path.join(WORK, localName);
  adb(['pull', tmp, local]);
  su(`rm -f ${tmp}`);
  if (!fs.existsSync(local) || fs.statSync(local).size === 0) return null;
  // sanity: must be a plaintext sqlite file
  const head = fs.readFileSync(local).subarray(0, 15).toString('latin1');
  return head.startsWith('SQLite format 3') ? local : null;
}

// vault (lazy — only when ingesting)
let vault = null;
async function getVault() {
  if (vault) return vault;
  const wiring = await import(pathToFileURL(path.join(ROOT, 'packages/cli/src/lib/personal-data-hub-wiring.js')).href);
  const hub = await wiring.getHub();
  vault = hub.registry.vault;
  return vault;
}
const want = (name) => !ONLY || ONLY === name;

const totals = { posts: 0, articles: 0, watches: 0 };

// ── 1. 微信朋友圈 ──────────────────────────────────────────────────────────
if (want('wechat')) {
  const { parseSnsEvents } = require(path.join(ROOT, 'packages/personal-data-hub/lib/forensics/wechat-collect.js'));
  console.log('\n[微信朋友圈] discovering accounts...');
  const accts = su('ls -d /data/data/com.tencent.mm/MicroMsg/*/ 2>/dev/null')
    .trim().split(/\s+/).filter(Boolean)
    .map((d) => d.replace(/\/$/, '').split('/').pop())
    .filter((a) => /^[0-9a-f]{32}$/.test(a));
  for (const acc of accts) {
    const remote = `/data/data/com.tencent.mm/MicroMsg/${acc}/SnsMicroMsg.db`;
    if (su(`[ -f '${remote}' ] && echo y || echo n`).trim() !== 'y') continue;
    const local = pull(remote, `Sns_${acc}.db`);
    if (!local) { console.log(`  ${acc}: pull failed / not plaintext`); continue; }
    const { events, persons } = parseSnsEvents(Database, local, {});
    console.log(`  ${acc}: ${events.length} posts, ${persons.length} persons`);
    if (DO_INGEST && events.length) {
      const v = await getVault();
      for (const p of persons) { try { v.putPerson(p); } catch { /* dup */ } }
      let ok = 0; for (const e of events) { try { v.putEvent(e); ok++; } catch { /* dup */ } }
      console.log(`     → ingested ${ok} events`);
    }
    totals.posts += events.length;
  }
}

// ── 2. 头条阅读 ────────────────────────────────────────────────────────────
if (want('toutiao')) {
  const reader = require(path.join(ROOT, 'packages/personal-data-hub/lib/adapters/social-toutiao-adb/article-reader.js'));
  console.log('\n[头条阅读] news_article.db...');
  const local = pull('/data/data/com.ss.android.article.news/databases/news_article.db', 'news_article.db');
  if (!local) console.log('  not found / not plaintext (头条 installed + opened?)');
  else {
    const { articles } = reader.readToutiaoArticles(local);
    const read = articles.filter((a) => a.readTimestamp > 0).length;
    console.log(`  ${articles.length} articles (${read} actually opened)`);
    if (DO_INGEST && articles.length) {
      const v = await getVault();
      const res = reader.articlesToVault(v, local);
      console.log(`     → ingested ${res.ingested} events`);
    }
    totals.articles += articles.length;
  }
}

// ── 3. 抖音观看 ────────────────────────────────────────────────────────────
if (want('douyin')) {
  const reader = require(path.join(ROOT, 'packages/personal-data-hub/lib/adapters/social-douyin-adb/watch-history-reader.js'));
  console.log('\n[抖音观看] video_record.db...');
  const local = pull('/data/data/com.ss.android.ugc.aweme/databases/video_record.db', 'video_record.db');
  if (!local) console.log('  not found / not plaintext (抖音 installed + watched?)');
  else {
    const { events } = reader.buildWatchHistoryEvents(local);
    console.log(`  ${events.length} watch records`);
    if (DO_INGEST && events.length) {
      const v = await getVault();
      const res = reader.watchHistoryToVault(v, local);
      console.log(`     → ingested ${res.ingested} events`);
    }
    totals.watches += events.length;
  }
}

console.log(`\n[summary] 朋友圈=${totals.posts} 头条=${totals.articles} 抖音=${totals.watches}  (${DO_INGEST ? 'INGESTED into vault' : 'dry run — pass --ingest to write'})`);
