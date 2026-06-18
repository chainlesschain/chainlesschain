#!/usr/bin/env node
/**
 * pdh-qq-android-decrypt.mjs — Reproducible Android QQ NT (nt_msg.db) decryption.
 * **No frida** — the key is DERIVED: key = MD5(MD5(uid) + rand).
 *
 * 实测 2026-06-19, chopin, QQ NT, 账号 896075341：group_msg 466 / c2c 7 解密。
 *
 * 关键事实（qq-win-db-key Android 教程 + 实测修正）：
 *   - nt_msg.db 头 1024 字节明文头；`rand` = "QQ_NT DB" 后的可读串(protobuf field2，~8 chars)；
 *     头里还写了 HMAC 算法(HMAC_SHA1/SHA512/SHA256)。
 *   - **key = MD5( MD5(uid) + rand )** 的 32-hex 串作 SQLCipher 口令 → PBKDF2_HMAC_SHA512
 *     (iter 4000) → AES 子密钥；SKIP 1024 / page 4096 / reserve 48(HMAC_SHA1) / IV 在 reserve 开头。
 *   - **坑：nt_qq_<hash> 目录名的 hash ≠ MD5(uid)**(实测不符)！必须用**真实 uid**。uid 不在
 *     固定位置 → 从 QQ 全量数据 `strings | grep u_` 收集候选(实测 417 个)，逐个套公式暴力，
 *     page1 解出有效 SQLite header 即命中(self uid)。
 *
 * Usage:
 *   node scripts/android/pdh-qq-android-decrypt.mjs --serial <serial> \
 *        --out-dir "C:/Users/<u>/Desktop/我的数据库" [--ingest --self <qq>]
 *   --no-pull --db <nt_msg.db> --uids <uids.txt> --rand <rand>   离线模式
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SERIAL = val('--serial');
const OUT_DIR = (val('--out-dir', path.join(os.homedir(), 'pdh-data/andqq'))).replace(/^~/, os.homedir());
const DO_PULL = !has('--no-pull');
const adb = (a) => { try { return execFileSync('adb', SERIAL ? ['-s', SERIAL, ...a] : a, { encoding: 'utf8', maxBuffer: 1 << 30 }); } catch (e) { return e.stdout ?? ''; } };
const su = (cmd) => { const t = `/data/local/tmp/_qqa_${Math.random().toString(36).slice(2, 8)}.sh`; const l = path.join(os.tmpdir(), path.basename(t)); fs.writeFileSync(l, cmd.replace(/\r/g, '') + '\n'); adb(['push', l, t]); const o = adb(['shell', 'su', '-c', `sh ${t}`]); adb(['shell', 'su', '-c', `rm -f ${t}`]); return o; };

fs.mkdirSync(OUT_DIR, { recursive: true });
let dbPath = val('--db'), uids = [], rand = val('--rand');
if (DO_PULL) {
  if (!SERIAL) { console.error('need --serial'); process.exit(1); }
  console.log('[1] pulling nt_msg.db + uid candidates...');
  su(`D=$(find /data/data/com.tencent.mobileqq/databases/nt_db -name nt_msg.db | head -1); cat "$D" > /data/local/tmp/_qqand.db; chown shell:shell /data/local/tmp/_qqand.db; chmod 666 /data/local/tmp/_qqand.db`);
  dbPath = path.join(OUT_DIR, 'nt_msg.db');
  adb(['pull', '/data/local/tmp/_qqand.db', dbPath]);
  adb(['shell', 'su', '-c', 'rm -f /data/local/tmp/_qqand.db']);
  const uidOut = su(`find /data/data/com.tencent.mobileqq -type f 2>/dev/null | while read f; do strings -a "$f" 2>/dev/null; done | grep -oE 'u_[A-Za-z0-9_-]{15,30}' | sort -u`);
  uids = uidOut.split(/\s+/).filter((u) => /^u_/.test(u));
  console.log(`    pulled DB (${fs.statSync(dbPath).size}B) + ${uids.length} uid candidates`);
} else {
  if (!dbPath) { console.error('--no-pull needs --db'); process.exit(1); }
  const uf = val('--uids'); if (uf && fs.existsSync(uf)) uids = fs.readFileSync(uf, 'utf8').split(/\s+/).filter((u) => /^u_/.test(u));
}
const raw = fs.readFileSync(dbPath);
// extract rand from header (string after "QQ_NT DB")
if (!rand) {
  const head = raw.subarray(0, 256).toString('latin1');
  const i = head.indexOf('QQ_NT DB');
  const m = head.slice(i + 8, i + 40).match(/[A-Za-z0-9]{6,12}/);
  rand = m ? m[0] : null;
}
console.log('[2] rand =', rand, '| uids =', uids.length, '| hmac in header:', /HMAC_SHA\d+/.exec(raw.subarray(0, 256).toString('latin1'))?.[0]);
if (!rand || !uids.length) { console.error('missing rand or uids'); process.exit(1); }

const body = raw.subarray(1024), salt = body.subarray(0, 16);
// decrypt one page slice. p1=true → page 1 (first 16 bytes are salt, skipped).
const dec = (page, encKey, reserve, ivOff, p1) => { const ro = page.length - reserve; const ct = page.subarray(p1 ? 16 : 0, ro); const iv = page.subarray(ro + ivOff, ro + ivOff + 16); if (iv.length < 16) return null; try { const d = crypto.createDecipheriv('aes-256-cbc', encKey, iv); d.setAutoPadding(false); return Buffer.concat([d.update(ct), d.final()]); } catch { return null; } };
const valid = (pt) => pt && pt.length > 8 && pt[5] === 64 && pt[6] === 32 && pt[7] === 32;
const CFG = [[4096, 48, 0], [4096, 80, 0], [4096, 48, 20]];
let hit = null;
console.log('[3] brute key = MD5(MD5(uid)+rand) over uids...');
for (const uid of uids) {
  const pass = md5(md5(uid) + rand);
  for (const algo of ['sha512', 'sha1']) { const ek = crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, 4000, 32, algo); for (const [pg, rs, iv] of CFG) if (valid(dec(body.subarray(0, pg), ek, rs, iv, true))) { hit = { uid, algo, page: pg, reserve: rs, ivOff: iv, ek }; break; } if (hit) break; }
  if (hit) break;
}
if (!hit) { console.log('NO MATCH — uid not among candidates or formula changed'); process.exit(2); }
console.log(`    MATCH uid=${hit.uid} kdf=${hit.algo} page=${hit.page} reserve=${hit.reserve} iv@${hit.ivOff}`);
const { ek, page, reserve, ivOff } = hit;
const n = Math.floor(body.length / page), out = [];
for (let i = 0; i < n; i++) { const pt = dec(body.subarray(i * page, (i + 1) * page), ek, reserve, ivOff, i === 0); const full = Buffer.alloc(page); if (i === 0) { Buffer.from('SQLite format 3\0').copy(full, 0); if (pt) pt.copy(full, 16); } else if (pt) pt.copy(full, 0); out.push(full); }
const outPath = path.join(OUT_DIR, 'QQ_android_nt_msg_decrypted.db');
fs.writeFileSync(outPath, Buffer.concat(out));
const db = new Database(outPath, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
console.log('[4] wrote', outPath, `(${tables.length} tables)`);
for (const t of ['c2c_msg_table', 'group_msg_table']) if (tables.includes(t)) { try { console.log('   ', t, db.prepare(`SELECT count(*) n FROM "${t}"`).get().n); } catch {} }
db.close();
if (has('--ingest')) {
  const ing = pathToFileURL(path.join(ROOT, 'scripts/android/pdh-qq-ingest.mjs')).href;
  console.log('[5] ingest → run: node scripts/android/pdh-qq-ingest.mjs --db "' + outPath + '" --self ' + (val('--self', '<qq>')));
}
