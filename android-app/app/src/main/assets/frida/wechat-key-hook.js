/**
 * Phase 12.6.2 — Frida agent: WeChat SQLCipher key hook.
 *
 * This script runs INSIDE the WeChat process (com.tencent.mm) after
 * being injected by the FridaKeyProvider on the host. It hooks the
 * sqlite3_key family of symbols in libwcdb.so (WeChat's SQLCipher fork)
 * and sends the captured 32-byte key hex back to the host via Frida's
 * `send()` channel.
 *
 * Wire contract (host expects):
 *   { kind: "key", hex: "<lowercase hex>", source: "<symbol-name>" }
 *   { kind: "hooked", symbol: "<symbol>", module: "libwcdb.so" }
 *   { kind: "error", message: "<reason>" }
 *   { kind: "module-waiting", module: "libwcdb.so" }
 *
 * Design references:
 *   - Adapter_WeChat_SQLCipher.md §18.3 (agent script structure)
 *   - §18.6 (anti-detection — hook at module-load time)
 *
 * Notes on portability:
 *   - This file is loaded by the host as raw text and passed verbatim
 *     to `session.createScript(...)`. It MUST NOT use any node `require()`
 *     or host-only APIs. Frida injects its own runtime (Module,
 *     Interceptor, Process, send, etc.) at runtime.
 *   - Keep dependencies on host helpers (e.g. esbuild) zero. The whole
 *     agent is ≤ 120 LOC of plain JS — no compilation step needed.
 *
 * Android in-app collector reuse (Phase 12.10.4):
 *   This copy is byte-identical to packages/personal-data-hub/lib/adapters/
 *   wechat/frida-agent/wechat-key-hook.js — the desktop side. When the
 *   Android frida-inject binary lands (v0.2), it'll spawn this script
 *   verbatim via -s wechat-key-hook.js. The desktop side keeps the
 *   canonical version; this copy is shipped in the APK so the binary can
 *   reference it without network IO.
 *
 *   When you change the desktop version, re-mirror it to android-app/app/
 *   src/main/assets/frida/wechat-key-hook.js as a single edit — divergence
 *   between the two will surface as "host gets db NAME ptr" silent
 *   decrypt failure on whichever side is stale.
 */

/* eslint-disable */
/* global Module, Interceptor, Process, send, setTimeout, console */

"use strict";

(function () {
  // Dual-emit: send() reaches SDK hosts (Python `script.on('message')` and
  // Node SDK) reliably, but frida-inject CLI's behavior around send()
  // messages varies across versions (some forward as `[send] {json}` to
  // stdout, some silently swallow). console.log() ALWAYS lands on stdout,
  // so the Android in-app collector parses stdout line-by-line for any JSON
  // line containing `"kind":"key"`. Hosts that prefer send() ignore the
  // console.log duplicate.
  //
  // Format on stdout (one JSON object per line):
  //   {"kind":"key","hex":"<lowercase hex>","source":"sqlite3_key_v2", ...}
  //   {"kind":"hooked","symbol":"sqlite3_key_v2","module":"libWCDB.so"}
  //   {"kind":"error","message":"..."}
  function emit(obj) {
    try { send(obj); } catch (_e) { /* SDK host may not exist */ }
    try { console.log(JSON.stringify(obj)); } catch (_e) { /* never */ }
  }
  // sjqz-verified module name is `libWCDB.so` (uppercase); some WeChat
  // builds ship lowercase. Try both — first match wins, no extra cost
  // because Process.findModuleByName is a cheap lookup.
  var TARGET_MODULES = ["libWCDB.so", "libwcdb.so"];
  // Primary symbol per §18.3. Add fallbacks below — version drift will
  // shift the export name; host treats first hit as authoritative.
  var SYMBOLS = [
    "sqlite3_key",
    "sqlite3_key_v2",
    "wcdb_setkey",
    "WCDBKeyDerive",
    // C++-mangled symbols (Itanium ABI) — rare but seen in WCDB 1.x
    "_ZN4WCDB8Database13setCipherKeyERKNSt6__ndk112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE",
  ];

  function bytesToHex(buf) {
    if (!buf || buf.byteLength === 0) return "";
    var bytes = new Uint8Array(buf);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i].toString(16);
      if (b.length < 2) b = "0" + b;
      out += b;
    }
    return out;
  }

  // Track which symbol fired first; only emit the first key event so
  // the host detaches quickly (anti-detection §18.6 #4).
  var fired = false;

  // Sig-aware arg index map. The host treats the first 'key' event as
  // authoritative, so picking the wrong index for v2 = host gets the
  // database NAME pointer (e.g. "main") and DB opens fail silently.
  //   sqlite3_key(sqlite3 *db, const void *pKey, int nKey)
  //     args[0]=db,            args[1]=key, args[2]=len
  //   sqlite3_key_v2(sqlite3 *db, const char *zDbName, const void *pKey, int nKey)
  //     args[0]=db, args[1]=name, args[2]=key, args[3]=len
  //   wcdb_setkey / WCDBKeyDerive: unknown sig — assume sqlite3_key shape
  //   Mangled C++: WCDB::Database::setCipherKey(*this, const std::string&)
  //     args[0]=this, args[1]=&string (length needs .size()) — not handled
  //     here; emit error so the host falls back to MD5 path.
  function argIndicesFor(symbolName) {
    if (symbolName === "sqlite3_key_v2") {
      return { key: 2, len: 3, sig: "v2" };
    }
    if (symbolName.indexOf("_ZN4WCDB") === 0) {
      return { key: -1, len: -1, sig: "mangled-cpp" };
    }
    return { key: 1, len: 2, sig: "v1" };
  }

  // sjqz extract_wechat_key.py uses Memory.readCString(args[1]) for the
  // key — meaning some WeChat builds pass the key as a NUL-terminated
  // 64-char ASCII hex string. Other builds (and the original SQLCipher
  // contract) pass 32 raw bytes. We can disambiguate by `len`:
  //   - len === 32 → raw 32-byte key → readByteArray + bytesToHex
  //   - len === 64 → ASCII hex string → readCString
  //   - anything else → emit error, host falls back to MD5 path
  function makeHook(symbolName) {
    var idx = argIndicesFor(symbolName);
    return {
      onEnter: function (args) {
        if (fired) return;
        if (idx.key < 0) {
          emit({
            kind: "error",
            message:
              "unsupported symbol signature: " +
              symbolName +
              " — host should fall back to MD5(IMEI+UIN) key path",
          });
          return;
        }
        try {
          var len = args[idx.len].toInt32();
          if (len <= 0 || len > 256) {
            emit({
              kind: "error",
              message:
                "implausible key length " + len + " at " + symbolName,
            });
            return;
          }
          var hex;
          var format;
          if (len === 64) {
            // ASCII hex string (sjqz-verified path on WeChat 7.x/8.0 libWCDB)
            var s = Memory.readCString(args[idx.key], len);
            if (!s || s.length === 0) {
              emit({
                kind: "error",
                message: "readCString returned empty at " + symbolName,
              });
              return;
            }
            hex = s.toLowerCase();
            format = "ascii-hex";
          } else if (len === 32) {
            // Raw 32-byte key — convert to 64-char hex
            var buf = args[idx.key].readByteArray(len);
            hex = bytesToHex(buf);
            format = "raw-bytes";
          } else {
            // Ambiguous length — could be either. Emit both interpretations
            // and let the host try each against the DB until one succeeds.
            var bufAmb = args[idx.key].readByteArray(len);
            var hexFromBytes = bytesToHex(bufAmb);
            var hexFromString = null;
            try {
              var sAmb = Memory.readCString(args[idx.key], len);
              if (sAmb) hexFromString = sAmb.toLowerCase();
            } catch (_e) {
              // readCString may fault on non-NUL-terminated bytes; ignore.
            }
            fired = true;
            emit({
              kind: "key",
              hex: hexFromBytes,
              alt: hexFromString,
              source: symbolName,
              sig: idx.sig,
              format: "ambiguous",
              length: len,
            });
            return;
          }
          if (!hex) {
            emit({
              kind: "error",
              message: "empty key buffer at " + symbolName,
            });
            return;
          }
          fired = true;
          emit({
            kind: "key",
            hex: hex,
            source: symbolName,
            sig: idx.sig,
            format: format,
            length: len,
          });
        } catch (e) {
          emit({
            kind: "error",
            message:
              "hook exception at " +
              symbolName +
              ": " +
              (e && e.message ? e.message : String(e)),
          });
        }
      },
    };
  }

  function tryAttachOnModule(moduleName) {
    var mod = Process.findModuleByName(moduleName);
    if (!mod) return false;
    var attached = 0;
    for (var i = 0; i < SYMBOLS.length; i++) {
      var addr = Module.findExportByName(moduleName, SYMBOLS[i]);
      if (!addr) continue;
      try {
        Interceptor.attach(addr, makeHook(SYMBOLS[i]));
        emit({ kind: "hooked", symbol: SYMBOLS[i], module: moduleName });
        attached++;
      } catch (e) {
        emit({
          kind: "error",
          message:
            "Interceptor.attach failed for " +
            SYMBOLS[i] +
            ": " +
            (e && e.message ? e.message : String(e)),
        });
      }
    }
    return attached > 0;
  }

  function tryAttach() {
    for (var i = 0; i < TARGET_MODULES.length; i++) {
      if (tryAttachOnModule(TARGET_MODULES[i])) {
        return true;
      }
    }
    return false;
  }

  // Module-load polling — §18.6 #1 "hook at module-load time before
  // anti-detection thread runs". WeChat lazy-loads libWCDB when the
  // first DB opens, so we can't always find it at script start.
  if (!tryAttach()) {
    emit({ kind: "module-waiting", module: TARGET_MODULES.join("|") });
    var attempts = 0;
    var poll = function () {
      attempts++;
      if (tryAttach()) return;
      if (attempts >= 60) {
        // 60 attempts × 500ms = 30s ceiling, matches host timeoutMs
        emit({
          kind: "error",
          message:
            TARGET_MODULES.join("|") + " did not load within 30s",
        });
        return;
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 500);
  }
})();
