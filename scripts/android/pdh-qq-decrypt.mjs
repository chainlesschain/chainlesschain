#!/usr/bin/env node
/**
 * pdh-qq-decrypt.mjs — Reproducible QQ NT (nt_msg.db) decryption. Deterministic given
 * a captured raw AES key (32 bytes). Key acquisition = pdh-frida-qq-aeskey.mjs (PC).
 *
 * QQ NT 解密关键事实 (实测 2026-06-19, 账号 896075341, QQ NT 9.9.31):
 *   - nt_msg.db 头部有 **1024 字节明文头**(伪装 "SQLite header 3\0")→ 必须 SKIP 1024
 *     字节, 真正的 SQLCipher 库从 byte 1024 开始(salt 在 1024..1039)。
 *   - SQLCipher: page **4096** / **reserve 48** (IV16 + HMAC_SHA1=20 + pad) / **IV 在
 *     reserve 开头(offset 0)** / kdf_iter 4000 / AES-256-CBC。
 *     (PRAGMA key=口令时 kdf=PBKDF2_HMAC_SHA512; 这里直接用 frida 抓的 post-KDF AES key。)
 *   - key 由 frida hook QQ.exe 的 OpenSSL `EVP_CipherInit_ex`(arg3=32字节key) 抓; QQ 登录
 *     时建连才设 key, 故须 frida **spawn QQ + 登录瞬间** 抓(运行态读页缓存抓不到, 见 helper)。
 *   - 消息正文 40800/40900 为 protobuf 二进制, 需进一步解码(qq-pc adapter / sidecar)。
 *
 * Usage:
 *   node scripts/android/pdh-qq-decrypt.mjs --db "<...>/nt_qq/nt_db/nt_msg.db" \
 *        --raw-keys-file qq-keys.json --out-dir "C:/Users/<u>/Desktop/我的数据库"
 *   (raw-keys-file = JSON array of 64-hex keys from pdh-frida-qq-aeskey.mjs)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const DB = val('--db');
const OUT_DIR = val('--out-dir', path.dirname(DB || '.'));
if (!DB || !fs.existsSync(DB)) { console.error('need --db <nt_msg.db>'); process.exit(1); }

const keys = [];
const rkf = val('--raw-keys-file');
if (rkf && fs.existsSync(rkf)) for (const h of JSON.parse(fs.readFileSync(rkf, 'utf8'))) if (/^[0-9a-fA-F]{64}$/.test(h)) keys.push(Buffer.from(h, 'hex'));
for (const k of (val('--raw-key', '') || '').split(',')) if (/^[0-9a-fA-F]{64}$/.test(k.trim())) keys.push(Buffer.from(k.trim(), 'hex'));
if (!keys.length) { console.error('need --raw-keys-file or --raw-key (from pdh-frida-qq-aeskey.mjs)'); process.exit(1); }

const raw = fs.readFileSync(DB);
const SKIP = 1024;                                  // QQ NT plaintext header
const body = raw.subarray(SKIP);
// IV at reserve offset 0 (standard SQLCipher). HMAC_SHA1 → reserve 48; SHA512 → 80.
const CONFIGS = [
  { pageSize: 4096, reserve: 48 }, { pageSize: 4096, reserve: 80 }, { pageSize: 4096, reserve: 64 },
];
function decPage(page, key, cfg, isP1) {
  const reserveOff = cfg.pageSize - cfg.reserve;
  const ct = page.subarray(isP1 ? 16 : 0, reserveOff);
  const iv = page.subarray(reserveOff, reserveOff + 16);   // IV at start of reserve
  try { const d = crypto.createDecipheriv('aes-256-cbc', key, iv); d.setAutoPadding(false); return Buffer.concat([d.update(ct), d.final()]); } catch { return null; }
}
const validP1 = (pt) => pt && pt.length > 8 && pt[5] === 64 && pt[6] === 32 && pt[7] === 32;
function fullDecrypt(key, cfg) {
  const n = Math.floor(body.length / cfg.pageSize), out = [];
  for (let i = 0; i < n; i++) {
    const pt = decPage(body.subarray(i * cfg.pageSize, (i + 1) * cfg.pageSize), key, cfg, i === 0);
    const full = Buffer.alloc(cfg.pageSize);
    if (i === 0) { Buffer.from('SQLite format 3\0').copy(full, 0); if (pt) pt.copy(full, 16); } else if (pt) pt.copy(full, 0);
    out.push(full);
  }
  return Buffer.concat(out);
}
let hit = null;
for (const cfg of CONFIGS) for (let ki = 0; ki < keys.length; ki++) if (validP1(decPage(body.subarray(0, cfg.pageSize), keys[ki], cfg, true))) { hit = { cfg, key: keys[ki], ki }; break; }
if (!hit) { console.log('NO KEY MATCH — capture the login-time key via pdh-frida-qq-aeskey.mjs (spawn + login)'); process.exit(2); }
console.log(`MATCH key#${hit.ki + 1} page=${hit.cfg.pageSize} reserve=${hit.cfg.reserve} iv@0`);
const outPath = path.join(OUT_DIR, 'QQ_nt_msg_decrypted.db');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(outPath, fullDecrypt(hit.key, hit.cfg));
const db = new Database(outPath, { readonly: true });
const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
console.log('wrote', outPath, `(${t.length} tables)`);
for (const tb of ['c2c_msg_table', 'group_msg_table', 'recent_contact_v3_table']) if (t.includes(tb)) { try { console.log('  ' + tb + ':', db.prepare(`SELECT count(*) n FROM "${tb}"`).get().n); } catch {} }
db.close();
console.log('注: 消息正文 40800 为 protobuf, 需 qq-pc adapter/sidecar 解码为可读文本。');
