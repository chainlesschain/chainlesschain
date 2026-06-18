#!/usr/bin/env node
/**
 * pdh-frida-qq-aeskey.mjs — Capture PC QQ NT nt_msg.db AES key via frida (Windows).
 *
 * QQ NT 的 SQLCipher 走 OpenSSL `EVP_CipherInit_ex`(crypto.dll, arg3=32字节AES key)。
 * key 仅在**登录建连**时设一次(运行态读页缓存抓不到; QQ 登录会重建进程)，故必须
 * **frida spawn QQ.exe + 登录瞬间**抓。DB 进程可能拒绝 frida 注入(反调试) → 脚本轮询所有
 * QQ.exe 子进程逐个 hook，能 hook 上的渲染/工具进程里的 EVP 也会经手 DB key(实测命中)。
 *
 * Prereq: `npm i frida` (本机在 C:\fridatools); 传 --frida-path <dir>/node_modules 或 FRIDA_PATH。
 *
 * Usage:
 *   node scripts/android/pdh-frida-qq-aeskey.mjs --out qq-keys.json [--seconds 180]
 *   # 杀掉现有 QQ → 本脚本 spawn QQ.exe → 你登录 → 抓到 key 写 qq-keys.json
 *   # 然后:
 *   node scripts/android/pdh-qq-decrypt.mjs --db "<...>/nt_db/nt_msg.db" \
 *        --raw-keys-file qq-keys.json --out-dir "C:/Users/<u>/Desktop/我的数据库"
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const OUT = val('--out', 'qq-keys.json');
const SECONDS = parseInt(val('--seconds', '180'), 10);
const EXE = val('--exe', 'C\\:\\Program Files\\Tencent\\QQNT\\QQ.exe'.replace('C\\:', 'C:'));
const fridaPath = val('--frida-path', process.env.FRIDA_PATH);
function loadFrida() { for (const c of [fridaPath, 'C:/fridatools/node_modules', path.resolve('node_modules')].filter(Boolean)) { try { return require(path.join(c, 'frida')); } catch {} } return require('frida'); }
const frida = loadFrida();

const AGENT = `
"use strict";
(function(){
  function hex(p,n){try{var b=new Uint8Array(p.readByteArray(n)),o='';for(var i=0;i<b.length;i++){var h=b[i].toString(16);if(h.length<2)h='0'+h;o+=h;}return o;}catch(e){return null;}}
  var seen={};
  ['EVP_CipherInit_ex','EVP_EncryptInit_ex','EVP_DecryptInit_ex'].forEach(function(fn){
    var a=null; try{var cm=Process.findModuleByName('crypto.dll'); if(cm)a=cm.findExportByName(fn);}catch(e){}
    if(!a){try{a=Module.findGlobalExportByName(fn);}catch(e){}}
    if(!a) return;
    Interceptor.attach(a,{onEnter:function(args){try{var kp=args[3];if(kp.isNull())return;var k=hex(kp,32);if(!k||/^0+$/.test(k))return;if(seen[k])return;seen[k]=1;send({kind:'key',key:k});}catch(e){}}});
  });
})();
`;
const dev = await frida.getLocalDevice();
const keys = []; const hooked = new Set();
async function hookPid(pid) {
  if (hooked.has(pid)) return; hooked.add(pid);
  try {
    const s = await dev.attach(pid);
    const sc = await s.createScript(AGENT);
    sc.message.connect((m) => { if (m.type === 'send' && m.payload.kind === 'key' && !keys.includes(m.payload.key)) { keys.push(m.payload.key); console.log(`key#${keys.length} [pid${pid}]`, m.payload.key); } });
    await sc.load();
  } catch { /* anti-frida process — skip */ }
}
try { execSync('powershell -NoProfile -Command "Get-Process QQ -ErrorAction SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch {}
await new Promise((r) => setTimeout(r, 1500));
console.log('spawning QQ.exe — LOG IN when it appears...');
const pid = await dev.spawn([EXE]);
await hookPid(pid);
await dev.resume(pid);
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  await new Promise((r) => setTimeout(r, 2000));
  try { for (const p of (await dev.enumerateProcesses()).filter((x) => /^QQ\.exe$/i.test(x.name))) if (!hooked.has(p.pid)) await hookPid(p.pid); } catch {}
}
fs.writeFileSync(OUT, JSON.stringify([...new Set(keys)]));
console.log(`saved ${new Set(keys).size} keys -> ${OUT}`);
process.exit(0);
