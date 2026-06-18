#!/usr/bin/env node
/**
 * pdh-wechat-decrypt.mjs — Reproducible Android WeChat (EnMicroMsg.db) decryption + PDH ingest.
 *
 * What it does (one command):
 *   1. adb-pull EnMicroMsg.db for every logged-in MicroMsg account on a rooted device.
 *   2. Collect candidate 7-char keys: --key/--keys-file + computed MD5(IMEI+uin)[:7]
 *      (uin auto-read from shared_prefs; IMEI candidates incl. empty/androidId/saved).
 *   3. Brute candidate keys × SQLCipher configs (1/2/3/4) with pure Node crypto
 *      (page-level AES-256-CBC, no bs3mc — bs3mc's pragma path is unreliable here).
 *   4. Write decrypted plaintext EnMicroMsg_decrypted.db to --out-dir.
 *   5. (--ingest) feed messages+contacts into the PDH vault (search/RAG/KG).
 *
 * Background (2026-06-19, verified on chopin/M2104K10AC, WeChat 8.0.74, account e1d7e7a2…):
 *   - WeChat key = MD5(IMEI+uin)[:7] (7 lowercase hex chars), e.g. "7361a23".
 *   - On Android 13 IMEI is usually unreadable → MD5 compute fails → use a SAVED key
 *     (once found it never changes for that account) or capture via frida (see
 *     pdh-frida-wechat-aeskey.mjs + the runbook). WeChat 8.x WCDB does NOT call the
 *     exported sqlite3_key; its AES key passes through aes_v8_set_encrypt_key.
 *   - Working config for 8.0.74 = SQLCipher1: page 1024 / reserve 16 / NO HMAC /
 *     kdf_iter 4000 / SHA1 / AES-256-CBC; page-1 first 16 bytes = salt (plaintext).
 *
 * Usage:
 *   node scripts/android/pdh-wechat-decrypt.mjs --serial <serial> --out-dir ~/pdh-data/wx \
 *        [--key 7361a23] [--keys-file keys.txt] [--raw-key <64hex>] [--ingest]
 *   --no-pull --db <path>   decrypt an already-pulled EnMicroMsg.db instead of adb-pull.
 *
 * Honest status: key ACQUISITION on a fresh account may need frida (see runbook §Key).
 * The brute+decrypt+ingest below is deterministic once a candidate key is supplied.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));

// ---- args ----
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SERIAL = val('--serial');
const OUT_DIR = (val('--out-dir', path.join(os.homedir(), 'pdh-data/wx'))).replace(/^~/, os.homedir());
const DO_PULL = !has('--no-pull');
const DO_INGEST = has('--ingest');
const EXPLICIT_DB = val('--db');
const SAVED_KEYS_FILE = path.join(os.homedir(), '.pdh-wechat-keys.json'); // persisted successes

function adb(args, { binary = false } = {}) {
  const full = SERIAL ? ['-s', SERIAL, ...args] : args;
  const opts = binary ? { maxBuffer: 1 << 30 } : { encoding: 'utf8', maxBuffer: 1 << 30 };
  try { return execFileSync('adb', full, opts); }
  catch (e) { if (e.stdout != null) return e.stdout; throw e; } // shell exit-code != failure when stdout present
}
function suScript(body) {
  const tmp = `/data/local/tmp/_pdhwx_${Math.abs(hashStr(body))}.sh`;
  const local = path.join(os.tmpdir(), path.basename(tmp));
  fs.writeFileSync(local, body.replace(/\r/g, ''));
  adb(['push', local, tmp]);
  const out = adb(['shell', 'su', '-c', `sh ${tmp}`]);
  adb(['shell', 'su', '-c', `rm -f ${tmp}`]);
  return out;
}
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// ---- 1. discover accounts + pull EnMicroMsg.db ----
fs.mkdirSync(OUT_DIR, { recursive: true });
const dbFiles = [];
if (EXPLICIT_DB) {
  dbFiles.push({ account: path.basename(path.dirname(EXPLICIT_DB)), path: EXPLICIT_DB });
} else if (DO_PULL) {
  if (!SERIAL) { console.error('need --serial (or --no-pull --db <path>)'); process.exit(1); }
  console.log('[1] pulling EnMicroMsg.db for all accounts...');
  const list = suScript(`
ls -d /data/data/com.tencent.mm/MicroMsg/*/ 2>/dev/null | while read d; do
  [ -f "$d/EnMicroMsg.db" ] && echo "$(basename $d)"
done
`).trim().split(/\s+/).filter(Boolean);
  for (const acc of list) {
    const remote = `/data/data/com.tencent.mm/MicroMsg/${acc}/EnMicroMsg.db`;
    suScript(`cat ${remote} > /data/local/tmp/_en_${acc}.db; chown shell:shell /data/local/tmp/_en_${acc}.db; chmod 666 /data/local/tmp/_en_${acc}.db`);
    const local = path.join(OUT_DIR, `En_${acc}.db`);
    adb(['pull', `/data/local/tmp/_en_${acc}.db`, local]);
    adb(['shell', 'su', '-c', `rm -f /data/local/tmp/_en_${acc}.db`]);
    dbFiles.push({ account: acc, path: local });
    console.log(`    pulled ${acc} (${fs.statSync(local).size} bytes)`);
  }
} else {
  console.error('--no-pull requires --db <path>'); process.exit(1);
}

// ---- 2. candidate keys ----
const passKeys = new Set();
for (const k of (val('--key', '') || '').split(',')) if (k.trim()) passKeys.add(k.trim());
const kf = val('--keys-file');
if (kf && fs.existsSync(kf)) for (const l of fs.readFileSync(kf, 'utf8').split(/\r?\n/)) if (l.trim()) passKeys.add(l.trim());
// saved successes
if (fs.existsSync(SAVED_KEYS_FILE)) { try { for (const k of JSON.parse(fs.readFileSync(SAVED_KEYS_FILE, 'utf8'))) passKeys.add(k); } catch {} }
// known sjqz candidates (MD5(IMEI+uin)[:7] previously seen — harmless to try)
['7361a23','8229bd0','73f14bb','583591f','b78b724','0e91c29','20ea60d','0109db6','72e5fdd','371f24e'].forEach(k=>passKeys.add(k));
// computed MD5(IMEI+uin)[:7]
let uins = [];
if (DO_PULL || EXPLICIT_DB && SERIAL) {
  try {
    const x = suScript(`grep -rohE '<int name="[^"]*uin[^"]*" value="-?[0-9]+"' /data/data/com.tencent.mm/shared_prefs/ 2>/dev/null | grep -oE '\\-?[0-9]+' | sort -u`);
    uins = x.trim().split(/\s+/).filter(Boolean);
    const aid = SERIAL ? adb(['shell', 'settings', 'get', 'secure', 'android_id']).trim() : '';
    const imeis = ['', '1234567890ABCDEF', '1234567890abcdef', aid, '0', '000000000000000'];
    for (const u of uins) for (const im of imeis) passKeys.add(md5(im + u).slice(0, 7));
  } catch {}
}
const rawKeys = (val('--raw-key', '') || '').split(',').map(s => s.trim()).filter(s => /^[0-9a-fA-F]{64}$/.test(s)).map(h => Buffer.from(h, 'hex'));
const rkf = val('--raw-keys-file');
if (rkf && fs.existsSync(rkf)) for (const h of JSON.parse(fs.readFileSync(rkf, 'utf8'))) if (/^[0-9a-fA-F]{64}$/.test(h)) rawKeys.push(Buffer.from(h, 'hex'));
console.log(`[2] candidates: ${passKeys.size} passphrases, ${rawKeys.length} raw keys, uins=[${uins.join(',')}]`);

// ---- 3. brute + decrypt (pure Node crypto) ----
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
  try { const d = crypto.createDecipheriv('aes-256-cbc', key, iv); d.setAutoPadding(false); return Buffer.concat([d.update(ct), d.final()]); } catch { return null; }
}
const validP1 = (pt) => pt && pt.length > 8 && pt[5] === 64 && pt[6] === 32 && pt[7] === 32;
function findKey(buf) {
  const salt = buf.subarray(0, 16);
  for (const cfg of CONFIGS) {
    for (const p of passKeys) { const k = crypto.pbkdf2Sync(Buffer.from(p, 'utf8'), salt, cfg.kdf, 32, cfg.algo === 'sha512' ? 'sha512' : 'sha1'); if (validP1(decPage(buf.subarray(0, cfg.pageSize), k, cfg, true))) return { mode: 'pass', pass: p, key: k, cfg }; }
    for (const rk of rawKeys) { if (validP1(decPage(buf.subarray(0, cfg.pageSize), rk, cfg, true))) return { mode: 'raw', key: rk, cfg }; }
  }
  return null;
}
function fullDecrypt(buf, key, cfg) {
  const n = Math.floor(buf.length / cfg.pageSize), out = [];
  for (let i = 0; i < n; i++) {
    const page = buf.subarray(i * cfg.pageSize, (i + 1) * cfg.pageSize);
    const pt = decPage(page, key, cfg, i === 0);
    const full = Buffer.alloc(cfg.pageSize);
    if (i === 0) { Buffer.from('SQLite format 3\0').copy(full, 0); if (pt) pt.copy(full, 16); } else if (pt) pt.copy(full, 0);
    out.push(full);
  }
  return Buffer.concat(out);
}

const decrypted = [];
for (const { account, path: p } of dbFiles) {
  const buf = fs.readFileSync(p);
  const hit = findKey(buf);
  if (!hit) { console.log(`[3] ${account}: NO KEY MATCH (supply --key / --raw-key from frida; see runbook)`); continue; }
  console.log(`[3] ${account}: MATCH ${hit.mode==='pass'?("pass "+hit.pass):"raw-key"} + ${hit.cfg.name}`);
  const outPath = path.join(OUT_DIR, `EnMicroMsg_decrypted_${account}.db`);
  fs.writeFileSync(outPath, fullDecrypt(buf, hit.key, hit.cfg));
  const db = new Database(outPath, { readonly: true });
  const tabs = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n;
  const msgs = (() => { try { return db.prepare('SELECT count(*) n FROM message').get().n; } catch { return 0; } })();
  const conts = (() => { try { return db.prepare('SELECT count(*) n FROM rcontact').get().n; } catch { return 0; } })();
  db.close();
  console.log(`    -> ${outPath}  (${tabs} tables, ${msgs} messages, ${conts} contacts)`);
  decrypted.push({ account, outPath, msgs });
  // persist the winning passphrase for instant next-time
  if (hit.mode === 'pass') { let saved = []; try { saved = JSON.parse(fs.readFileSync(SAVED_KEYS_FILE, 'utf8')); } catch {} if (!saved.includes(hit.pass)) { saved.push(hit.pass); fs.writeFileSync(SAVED_KEYS_FILE, JSON.stringify(saved)); } }
}

// ---- 4. optional ingest ----
if (DO_INGEST && decrypted.length) {
  console.log('[4] ingesting into PDH vault...');
  const wiring = await import(pathToFileURL(path.join(ROOT, 'packages/cli/src/lib/personal-data-hub-wiring.js')).href);
  const wechatMod = await import(pathToFileURL(path.join(ROOT, 'packages/personal-data-hub/lib/adapters/wechat/index.js')).href);
  const M = wechatMod.default || wechatMod;
  const normalizeMessage = M.normalizeWeChatMessage;
  const hub = await wiring.getHub();
  const vault = hub.registry.vault;
  for (const { account, outPath } of decrypted) {
    const src = new Database(outPath, { readonly: true });
    const contactByUsername = {};
    for (const c of src.prepare("SELECT username, nickname, conRemark FROM rcontact WHERE nickname IS NOT NULL").all()) contactByUsername[c.username] = { nickname: c.nickname, conRemark: c.conRemark };
    const rows = src.prepare('SELECT msgId, msgSvrId, talker, content, type, createTime, isSend FROM message').all();
    src.close();
    const before = vault.stats().events;
    const ctx = { accountUin: account, contactByUsername };
    const db = vault.db || vault._db;
    const tx = db.transaction((b) => { for (const ev of b) { try { vault.putEvent(ev); } catch {} } });
    let batch = [];
    for (const row of rows) { let r; try { r = normalizeMessage(row, ctx); } catch { continue; } for (const ev of (r.events || [])) { batch.push(ev); if (batch.length >= 2000) tx(batch.splice(0)); } }
    if (batch.length) tx(batch.splice(0));
    console.log(`    ${account}: events ${before}→${vault.stats().events}`);
  }
}
console.log('[done]');
