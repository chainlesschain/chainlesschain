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
 */

/* eslint-disable */
/* global Module, Interceptor, Process, send, setTimeout */

"use strict";

(function () {
  var TARGET_MODULE = "libwcdb.so";
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

  function makeHook(symbolName) {
    return {
      onEnter: function (args) {
        if (fired) return;
        try {
          // sqlite3_key signature: int sqlite3_key(sqlite3 *db, const void *pKey, int nKey)
          // args[1] = key bytes, args[2] = key length
          var len = args[2].toInt32();
          if (len <= 0 || len > 256) {
            send({ kind: "error", message: "implausible key length " + len + " at " + symbolName });
            return;
          }
          var buf = args[1].readByteArray(len);
          var hex = bytesToHex(buf);
          if (!hex) {
            send({ kind: "error", message: "empty key buffer at " + symbolName });
            return;
          }
          fired = true;
          send({ kind: "key", hex: hex, source: symbolName });
        } catch (e) {
          send({ kind: "error", message: "hook exception at " + symbolName + ": " + (e && e.message ? e.message : String(e)) });
        }
      },
    };
  }

  function tryAttach() {
    var mod = Process.findModuleByName(TARGET_MODULE);
    if (!mod) return false;
    var attached = 0;
    for (var i = 0; i < SYMBOLS.length; i++) {
      var addr = Module.findExportByName(TARGET_MODULE, SYMBOLS[i]);
      if (!addr) continue;
      try {
        Interceptor.attach(addr, makeHook(SYMBOLS[i]));
        send({ kind: "hooked", symbol: SYMBOLS[i], module: TARGET_MODULE });
        attached++;
      } catch (e) {
        send({ kind: "error", message: "Interceptor.attach failed for " + SYMBOLS[i] + ": " + (e && e.message ? e.message : String(e)) });
      }
    }
    return attached > 0;
  }

  // Module-load polling — §18.6 #1 "hook at module-load time before
  // anti-detection thread runs". WeChat lazy-loads libwcdb when the
  // first DB opens, so we can't always find it at script start.
  if (!tryAttach()) {
    send({ kind: "module-waiting", module: TARGET_MODULE });
    var attempts = 0;
    var poll = function () {
      attempts++;
      if (tryAttach()) return;
      if (attempts >= 60) {
        // 60 attempts × 500ms = 30s ceiling, matches host timeoutMs
        send({ kind: "error", message: TARGET_MODULE + " did not load within 30s" });
        return;
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 500);
  }
})();
