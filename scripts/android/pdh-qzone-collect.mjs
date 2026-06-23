#!/usr/bin/env node
/**
 * pdh-qzone-collect.mjs — collect QQ空间 (Qzone 说说/feed) into the PDH vault.
 *
 * Qzone has NO local browsable DB (the QQNT databases only cache per-contact
 * "latest feed" preview snippets), so this is the API path: the Qzone
 * emotion_cgi_msglist_v6 endpoint, authed with the account's qzone-domain
 * `p_skey` + `uin` and a `g_tk` token derived from p_skey.
 *
 * Cookie source (either):
 *   --cookie "uin=o0..; p_skey=..; skey=.."   paste from a browser logged into
 *                                             user.qzone.qq.com (DevTools → any
 *                                             qzone request → Cookie header), or
 *   --serial <serial>                         pull from the rooted device's QQ
 *                                             in-app WebView cookie store — but
 *                                             only works if the Qzone/"好友动态"
 *                                             tab was opened in QQ at least once
 *                                             (that's when the qzone p_skey is
 *                                             cached). Base .qq.com skey alone is
 *                                             rejected ("请先登录空间").
 *
 * Usage:
 *   node scripts/android/pdh-qzone-collect.mjs --serial <serial> [--ingest] [--max 200]
 *   node scripts/android/pdh-qzone-collect.mjs --cookie "<cookie>" --uin <uin> [--ingest]
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
const COOKIE_ARG = val('--cookie');
const DO_INGEST = has('--ingest');
const MAX = Number(val('--max', '500'));
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';

const SELF_ID = 'person-qq-self';
const SRC = (originalId, at) => ({ adapter: 'qzone', adapterVersion: '0.1.0', originalId, capturedAt: at || Date.now(), capturedBy: 'api' });
function gtk(s) { let h = 5381; for (let i = 0; i < s.length; i++) h += (h << 5) + s.charCodeAt(i); return h & 0x7fffffff; }

// ── cookie acquisition ─────────────────────────────────────────────────────
function adb(args) { try { return execFileSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 }); } catch (e) { if (e.stdout != null) return e.stdout; throw e; } }
function pullQqWebviewCookies() {
  const stores = ['app_webview_tool', 'app_webview_com_tencent_mobileqq'];
  const cookies = {};
  const tmpDir = path.join(os.tmpdir(), 'pdh-qzone');
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const s of stores) {
    const b64 = adb(['shell', 'su', '-c', `base64 /data/data/com.tencent.mobileqq/${s}/Default/Cookies 2>/dev/null | tr -d '\\r\\n'`]).trim();
    if (!b64) continue;
    const dbp = path.join(tmpDir, `${s}.db`);
    fs.writeFileSync(dbp, Buffer.from(b64, 'base64'));
    let db; try { db = new Database(dbp, { readonly: true }); } catch { continue; }
    try {
      for (const r of db.prepare("SELECT host_key,name,value FROM cookies WHERE host_key LIKE '%qq.com%' OR host_key LIKE '%qzone%'").all()) {
        // prefer qzone-domain p_skey; keep uin/skey/p_uin
        if (r.name === 'p_skey' && /qzone/.test(r.host_key)) cookies.p_skey = r.value;
        else if (r.name === 'p_skey' && !cookies.p_skey) cookies.p_skey = r.value;
        else if (['uin', 'skey', 'p_uin', 'pt4_token'].includes(r.name) && !cookies[r.name]) cookies[r.name] = r.value;
      }
    } finally { db.close(); }
  }
  return cookies;
}
function parseCookieStr(s) { const o = {}; for (const part of s.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim(); } return o; }

// ── feed parsing (pure) ────────────────────────────────────────────────────
// emotion_cgi_msglist_v6 returns _Callback({...}); msglist[] holds 说说.
function parseQzoneFeed(text, uin) {
  let body = text.trim();
  const m = body.match(/^_Callback\(([\s\S]*)\);?\s*$/);
  if (m) body = m[1];
  let json; try { json = JSON.parse(body); } catch { return { code: -1, events: [], raw: body.slice(0, 200) }; }
  if (json.code !== undefined && json.code !== 0) return { code: json.code, message: json.message, events: [] };
  const list = (json.msglist || (json.result && json.result.msglist) || []);
  const events = [];
  for (const it of list) {
    const tid = it.tid || it.t1_tid || it.cellid;
    const occurredAt = (Number(it.created_time) || 0) * 1000;
    if (!tid || !occurredAt) continue;
    const text2 = (it.content || it.summary || '').replace(/\s+/g, ' ').trim();
    const pics = Array.isArray(it.pic) ? it.pic.length : 0;
    if (!text2 && !pics) continue;
    const title = (text2 || `[图片] 我的说说`).slice(0, 80);
    events.push({
      type: 'event', subtype: 'post', id: `qzone:${tid}`,
      occurredAt, actor: SELF_ID, participants: [SELF_ID],
      content: { title, text: text2 || undefined },
      source: SRC(`qzone-${tid}`, occurredAt),
      extra: { kind: 'qzone-shuoshuo', tid, mediaCount: pics, cmtnum: it.cmtnum || 0, secret: !!it.secret },
      ingestedAt: Date.now(),
    });
  }
  return { code: 0, events, total: json.total != null ? json.total : (json.result && json.result.total) };
}

export { gtk, parseQzoneFeed, SELF_ID };

async function fetchMsglist(uin, ck, pos, num) {
  const pskey = ck.p_skey || ck.skey;
  const g = gtk(pskey);
  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${uin}&hostUin=${uin}&num=${num}&pos=${pos}&format=json&g_tk=${g}&need_private_comment=1`;
  const cookie = Object.entries(ck).map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(url, { headers: { Cookie: cookie, Referer: `https://user.qzone.qq.com/${uin}`, 'User-Agent': UA } });
  return parseQzoneFeed(await res.text(), uin);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) (async () => {
  let ck, uin;
  if (COOKIE_ARG) { ck = parseCookieStr(COOKIE_ARG); uin = (val('--uin') || (ck.uin || '').replace(/\D/g, '')); }
  else if (SERIAL) { ck = pullQqWebviewCookies(); uin = (ck.uin || '').replace(/\D/g, '') || (ck.p_uin || '').replace(/\D/g, ''); console.log('[device cookies] keys:', Object.keys(ck).join(','), 'uin=' + uin, 'p_skey=' + (ck.p_skey ? 'YES' : 'NO')); }
  else { console.error('need --serial <serial> or --cookie "<cookie>"'); process.exit(1); }
  if (!uin) { console.error('could not determine uin'); process.exit(1); }
  if (!ck.p_skey && !ck.skey) { console.error('no p_skey/skey in cookies'); process.exit(1); }

  const all = [];
  for (let pos = 0; pos < MAX; pos += 20) {
    const r = await fetchMsglist(uin, ck, pos, 20);
    if (r.code !== 0) { console.log(`[pos ${pos}] API code=${r.code} ${r.message || ''} ${r.raw || ''}`); break; }
    if (!r.events.length) { console.log(`[pos ${pos}] no more`); break; }
    all.push(...r.events);
    console.log(`[pos ${pos}] +${r.events.length} (total so far ${all.length}${r.total != null ? '/' + r.total : ''})`);
    if (r.total != null && all.length >= r.total) break;
  }
  console.log(`\n[summary] QQ空间说说: ${all.length} posts`);
  for (const e of all.slice(0, 5)) console.log('  -', new Date(e.occurredAt).toISOString().slice(0, 10), '|', e.content.title.slice(0, 40));

  if (DO_INGEST && all.length) {
    const wiring = await import(pathToFileURL(path.join(ROOT, 'packages/cli/src/lib/personal-data-hub-wiring.js')).href);
    const hub = await wiring.getHub();
    const vault = hub.registry.vault;
    try { vault.putPerson({ type: 'person', subtype: 'contact', id: SELF_ID, names: ['我(QQ空间)'], source: SRC(SELF_ID), ingestedAt: Date.now() }); } catch { /* dup */ }
    let ok = 0; for (const e of all) { try { vault.putEvent(e); ok++; } catch { /* dup */ } }
    console.log(`  → ingested ${ok} events into vault`);
  } else if (all.length) {
    console.log('  (dry run — pass --ingest to write to vault)');
  }
})();
