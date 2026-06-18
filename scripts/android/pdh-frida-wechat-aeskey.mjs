#!/usr/bin/env node
/**
 * pdh-frida-wechat-aeskey.mjs — Capture WeChat WCDB raw AES keys via frida (fallback
 * key-acquisition for pdh-wechat-decrypt.mjs when no candidate passphrase matches).
 *
 * Why: WeChat 8.x WCDB does NOT call the exported sqlite3_key. Its 32-byte AES key
 * passes through `aes_v8_set_encrypt_key` in libWCDB.so. This hooks it and dumps every
 * unique key seen → a JSON the decryptor consumes via --raw-keys-file.
 *
 * Prereqs (one-time):
 *   1. `npm i frida` somewhere; pass its node_modules via --frida-path or FRIDA_PATH
 *      (default tries C:/fridatools/node_modules then repo node_modules).
 *   2. matching frida-server pushed + running as ROOT on the device, SELinux permissive:
 *        adb push frida-server /data/local/tmp/frida-server
 *        adb shell su -c 'setenforce 0; nohup /data/local/tmp/frida-server -D >/dev/null 2>&1 &'
 *      (CRITICAL: must run as root — verify `ps -A -o USER,NAME | grep frida` shows root.
 *       A backgrounded `&` inside `su -c '…'` can drop it to shell uid → all attaches fail.)
 *
 * Usage:
 *   node scripts/android/pdh-frida-wechat-aeskey.mjs --serial <serial> [--seconds 90] \
 *        [--out raw-keys.json]
 *   # then open WeChat + browse several chats during the capture window, then:
 *   node scripts/android/pdh-wechat-decrypt.mjs --serial <serial> --out-dir ~/pdh-data/wx \
 *        --raw-keys-file raw-keys.json --ingest
 *
 * Note: aes_v8 keys are per-DB; the decryptor brute-forces all of them against
 * EnMicroMsg.db. EnMicroMsg's connection opens at login, so its key is only re-seen
 * when WeChat opens a NEW connection — browsing many chats / search increases the odds.
 * The PASSPHRASE path (saved 7-char key) is preferred when known; this is the fallback.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SERIAL = val('--serial');
const SECONDS = parseInt(val('--seconds', '90'), 10);
const OUT = val('--out', 'wechat-raw-keys.json');
const fridaPath = val('--frida-path', process.env.FRIDA_PATH);

function loadFrida() {
  const cands = [fridaPath, 'C:/fridatools/node_modules', path.resolve('node_modules')].filter(Boolean);
  for (const c of cands) { try { return require(require('path').join(c, 'frida')); } catch {} }
  try { return require('frida'); } catch {}
  throw new Error('frida node binding not found. `npm i frida` and pass --frida-path <dir>/node_modules');
}
const frida = loadFrida();

const AGENT = `
"use strict";
(function(){
  var mods=["libWCDB.so","libwcdb.so"];
  function hex(buf){var b=new Uint8Array(buf),o="";for(var i=0;i<b.length;i++){var h=b[i].toString(16);if(h.length<2)h="0"+h;o+=h;}return o;}
  var seen={};
  function hook(){
    var addr=null,mn=null;
    for(var i=0;i<mods.length;i++){try{var m=Process.findModuleByName(mods[i]);if(m){var a=m.findExportByName("aes_v8_set_encrypt_key");if(a){addr=a;mn=mods[i];break;}}}catch(e){}}
    if(!addr){try{addr=Module.findGlobalExportByName("aes_v8_set_encrypt_key");}catch(e){}}
    if(!addr)return false;
    Interceptor.attach(addr,{onEnter:function(args){try{var bits=args[1].toInt32();if(bits!==128&&bits!==192&&bits!==256)return;var k=hex(args[0].readByteArray(bits/8));if(seen[k])return;seen[k]=1;send({kind:"key",bits:bits,key:k});}catch(e){}}});
    send({kind:"hooked",module:mn}); return true;
  }
  if(!hook()){send({kind:"waiting"});var t=0;var iv=setInterval(function(){if(hook()||++t>60)clearInterval(iv);},1000);}
})();
`;

const pid = parseInt(execFileSync('adb', ['-s', SERIAL, 'shell', 'su', '-c', 'pidof com.tencent.mm'], { encoding: 'utf8' }).trim().split(/\s+/)[0], 10);
const dev = await frida.getUsbDevice({ timeout: 5000 });
console.log('attaching to WeChat pid', pid);
const session = await dev.attach(pid);
const script = await session.createScript(AGENT);
const keys = [];
script.message.connect((m) => {
  if (m.type === 'send') { const pl = m.payload; if (pl.kind === 'key') { keys.push(pl.key); console.log('aes key#' + keys.length, pl.key); } else console.log('[agent]', JSON.stringify(pl)); }
  else console.log('[err]', m.description);
});
await script.load();
console.log(`hooked aes_v8_set_encrypt_key — open WeChat + browse several chats now (${SECONDS}s)...`);
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) await new Promise((r) => setTimeout(r, 1000));
fs.writeFileSync(OUT, JSON.stringify([...new Set(keys)], null, 0));
console.log(`saved ${new Set(keys).size} unique raw keys -> ${OUT}`);
console.log(`next: node scripts/android/pdh-wechat-decrypt.mjs --serial ${SERIAL} --out-dir ~/pdh-data/wx --raw-keys-file ${OUT} --ingest`);
try { await session.detach(); } catch {}
process.exit(0);
