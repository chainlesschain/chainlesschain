#!/usr/bin/env node
/**
 * pdh-qzone-collect.mjs — PC-side runner for the QQ空间 (Qzone) collector.
 *
 * The collection CORE now lives in the shipped lib
 * (packages/personal-data-hub/lib/forensics/qzone-collect.js, also behind
 * `cc hub collect-qzone`). This script is the PC convenience wrapper: it adds a
 * rooted-device cookie pull + ingest into the local vault.
 *
 * Qzone has NO local browsable DB → API path: emotion_cgi_msglist_v6 (说说) +
 * get_msgb (留言板) + fcg_list_album_v3 (相册), authed with the qzone-domain
 * `p_skey` + `uin` + a `g_tk` derived from p_skey. The base `.qq.com` skey is
 * rejected ("请先登录空间").
 *
 * Cookie source (either):
 *   --cookie "uin=o0..; p_skey=.."   paste from a browser logged into
 *                                    user.qzone.qq.com (DevTools → Cookie header)
 *   --serial <serial>                pull from the rooted device's QQ in-app
 *                                    WebView store — only has a qzone p_skey if
 *                                    the 好友动态 H5 was opened in QQ (often it is
 *                                    not, since QQ's native feed keeps p_skey in
 *                                    memory; prefer --cookie for QQ空间).
 *
 * Usage:
 *   node scripts/android/pdh-qzone-collect.mjs --cookie "<cookie>" --uin <uin> [--what shuoshuo,msgb,album] [--ingest] [--max 1000]
 *   node scripts/android/pdh-qzone-collect.mjs --serial <serial> [--ingest]
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
const qz = require(path.join(ROOT, 'packages/personal-data-hub/lib/forensics/qzone-collect.js'));
const { gtk, parseCookieStr, parseQzoneFeed, parseGuestbook, parseAlbums, stripHtml, collectQzone, SELF_ID } = qz;
export { gtk, parseQzoneFeed, parseGuestbook, parseAlbums, stripHtml, SELF_ID };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

function adb(serial, args) { try { return execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 }); } catch (e) { if (e.stdout != null) return e.stdout; throw e; } }
// Pull the QQ in-app WebView cookie store(s) → { uin, p_skey, skey, p_uin, ... }.
function pullQqWebviewCookies(serial) {
  const stores = ['app_webview_tool', 'app_webview_com_tencent_mobileqq'];
  const cookies = {};
  const tmpDir = path.join(os.tmpdir(), 'pdh-qzone');
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const s of stores) {
    const b64 = adb(serial, ['shell', 'su', '-c', `base64 /data/data/com.tencent.mobileqq/${s}/Default/Cookies 2>/dev/null | tr -d '\\r\\n'`]).trim();
    if (!b64) continue;
    const dbp = path.join(tmpDir, `${s}.db`);
    fs.writeFileSync(dbp, Buffer.from(b64, 'base64'));
    let db; try { db = new Database(dbp, { readonly: true }); } catch { continue; }
    try {
      for (const r of db.prepare("SELECT host_key,name,value FROM cookies WHERE host_key LIKE '%qq.com%' OR host_key LIKE '%qzone%'").all()) {
        if (r.name === 'p_skey' && /qzone/.test(r.host_key)) cookies.p_skey = r.value;
        else if (r.name === 'p_skey' && !cookies.p_skey) cookies.p_skey = r.value;
        else if (['uin', 'skey', 'p_uin', 'pt4_token'].includes(r.name) && !cookies[r.name]) cookies[r.name] = r.value;
      }
    } finally { db.close(); }
  }
  return cookies;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) (async () => {
  const SERIAL = val('--serial');
  const COOKIE_ARG = val('--cookie');
  const DO_INGEST = has('--ingest');
  const what = (val('--what', 'shuoshuo,msgb,album')).split(',').map((s) => s.trim()).filter(Boolean);
  const max = Number(val('--max', '1000'));

  let cookie, uin = val('--uin');
  if (COOKIE_ARG) { cookie = COOKIE_ARG; }
  else if (SERIAL) { cookie = pullQqWebviewCookies(SERIAL); console.log('[device cookies] keys:', Object.keys(cookie).join(','), 'p_skey=' + (cookie.p_skey ? 'YES' : 'NO')); }
  else { console.error('need --serial <serial> or --cookie "<cookie>"'); process.exit(1); }

  const result = await collectQzone({ uin, cookie, what, max });
  if (!result.ok) { console.error('[qzone] ' + result.reason); process.exit(2); }
  console.log(`\n[summary] QQ空间: ${result.events.length} events`, JSON.stringify(result.counts), `(${what.join('+')})`);
  for (const e of result.events.slice(0, 6)) console.log('  -', new Date(e.occurredAt).toISOString().slice(0, 10), `[${e.extra.kind}]`, '|', e.content.title.slice(0, 44));

  if (DO_INGEST && result.events.length) {
    const wiring = await import(pathToFileURL(path.join(ROOT, 'packages/cli/src/lib/personal-data-hub-wiring.js')).href);
    const vault = (await wiring.getHub()).registry.vault;
    try { vault.putPerson({ type: 'person', subtype: 'contact', id: SELF_ID, names: ['我(QQ空间)'], source: { adapter: 'qzone', adapterVersion: '0.1.0', originalId: SELF_ID, capturedAt: Date.now(), capturedBy: 'api' }, ingestedAt: Date.now() }); } catch { /* dup */ }
    for (const p of result.persons) { try { vault.putPerson(p); } catch { /* dup */ } }
    let ok = 0; for (const e of result.events) { try { vault.putEvent(e); ok++; } catch { /* dup */ } }
    console.log(`  → ingested ${ok} events + ${result.persons.length} persons into vault`);
  } else if (result.events.length) {
    console.log('  (dry run — pass --ingest to write to vault)');
  }
})();
