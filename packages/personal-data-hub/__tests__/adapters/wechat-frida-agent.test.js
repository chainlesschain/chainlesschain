"use strict";

import { describe, it, expect, vi } from "vitest";

const { loadAgentScript, runAgentUnderMock } = require("../../lib/adapters/wechat/frida-agent/loader");

function hexToBuffer(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out.buffer;
}

/** Fake NativePointer — supports toInt32() (length) and readByteArray(len) (key bytes). */
function fakePtr(value) {
  return {
    _v: value,
    toInt32() { return typeof value === "number" ? value : 0; },
    readByteArray(len) {
      // value is a hex string for key bytes; len ignored beyond bounds
      if (typeof value !== "string") return new Uint8Array(0).buffer;
      const buf = hexToBuffer(value);
      // truncate to requested len if needed
      return new Uint8Array(buf, 0, Math.min(len, buf.byteLength)).buffer;
    },
  };
}

describe("frida-agent loader — script loading", () => {
  it("loadAgentScript returns non-empty JS text", () => {
    const src = loadAgentScript();
    expect(src.length).toBeGreaterThan(100);
    expect(src).toContain("libwcdb.so");
    expect(src).toContain("sqlite3_key");
  });
});

describe("frida-agent — sqlite3_key hook on module already loaded", () => {
  it("emits hooked + key on sqlite3_key onEnter", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) {
        attached[addr.symbol] = handlers;
      },
    };
    const Module = {
      findExportByName(mod, sym) {
        if (mod !== "libwcdb.so") return null;
        if (sym === "sqlite3_key") return { symbol: sym };
        return null; // only sqlite3_key resolves; others null
      },
    };
    const Process = {
      findModuleByName(mod) { return mod === "libwcdb.so" ? { name: mod } : null; },
    };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    // After load, "hooked" event already sent
    const hooked = send.mock.calls.find((c) => c[0].kind === "hooked");
    expect(hooked).toBeDefined();
    expect(hooked[0].symbol).toBe("sqlite3_key");
    expect(hooked[0].module).toBe("libwcdb.so");

    // Fire the hook: args = [sqlite3*, keyBytes, len]
    const keyHex = "11223344556677889900aabbccddeeff" +
                   "00112233445566778899aabbccddeeff"; // 64 hex = 32 bytes (SQLCipher 256-bit)
    const args = [fakePtr(0), fakePtr(keyHex), fakePtr(32)];
    attached.sqlite3_key.onEnter(args);

    const key = send.mock.calls.find((c) => c[0].kind === "key");
    expect(key).toBeDefined();
    expect(key[0].hex).toBe(keyHex);
    expect(key[0].source).toBe("sqlite3_key");
  });

  it("only emits the first key event (anti-detection: hook fires once)", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) { attached[addr.symbol] = handlers; },
    };
    const Module = {
      findExportByName(mod, sym) {
        if (sym === "sqlite3_key") return { symbol: sym };
        return null;
      },
    };
    const Process = { findModuleByName() { return { name: "libwcdb.so" }; } };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    const args = [fakePtr(0), fakePtr("aabb" + "00".repeat(30)), fakePtr(32)];
    attached.sqlite3_key.onEnter(args);
    attached.sqlite3_key.onEnter(args);
    attached.sqlite3_key.onEnter(args);

    const keyEvents = send.mock.calls.filter((c) => c[0].kind === "key");
    expect(keyEvents).toHaveLength(1);
  });

  it("rejects implausible key length with error event", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) { attached[addr.symbol] = handlers; },
    };
    const Module = {
      findExportByName(mod, sym) { return sym === "sqlite3_key" ? { symbol: sym } : null; },
    };
    const Process = { findModuleByName() { return { name: "libwcdb.so" }; } };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    attached.sqlite3_key.onEnter([fakePtr(0), fakePtr("aa"), fakePtr(9999)]);

    const errs = send.mock.calls.filter((c) => c[0].kind === "error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0][0].message).toMatch(/implausible key length 9999/);
  });
});

describe("frida-agent — fallback symbol resolution", () => {
  it("attaches to wcdb_setkey when sqlite3_key absent", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) { attached[addr.symbol] = handlers; },
    };
    const Module = {
      findExportByName(mod, sym) {
        // WeChat 8.x renamed primary symbol
        if (sym === "wcdb_setkey") return { symbol: sym };
        return null;
      },
    };
    const Process = { findModuleByName() { return { name: "libwcdb.so" }; } };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    const hooked = send.mock.calls.find((c) => c[0].kind === "hooked");
    expect(hooked[0].symbol).toBe("wcdb_setkey");
    expect(attached.wcdb_setkey).toBeDefined();
  });

  it("emits source = matched symbol when fallback fires", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) { attached[addr.symbol] = handlers; },
    };
    const Module = {
      findExportByName(mod, sym) {
        return sym === "WCDBKeyDerive" ? { symbol: sym } : null;
      },
    };
    const Process = { findModuleByName() { return { name: "libwcdb.so" }; } };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    attached.WCDBKeyDerive.onEnter([
      fakePtr(0),
      fakePtr("deadbeef" + "00".repeat(28)),
      fakePtr(32),
    ]);

    const key = send.mock.calls.find((c) => c[0].kind === "key");
    expect(key[0].source).toBe("WCDBKeyDerive");
  });
});

describe("frida-agent — sjqz-audit fixes (sig + format + module case)", () => {
  // Helper extending fakePtr with readCString for ascii-hex tests.
  function fakeAsciiHexPtr(asciiHex) {
    return {
      _v: asciiHex,
      toInt32() { return 0; },
      readByteArray(_len) { return new Uint8Array(0).buffer; },
    };
  }
  function memoryReadCString(ptr, _maxLen) {
    return ptr && typeof ptr._v === "string" ? ptr._v : null;
  }

  it("attaches when only uppercase libWCDB.so resolves (sjqz canonical name)", () => {
    const send = vi.fn();
    const Interceptor = { attach: vi.fn() };
    const Module = {
      findExportByName(mod, sym) {
        return mod === "libWCDB.so" && sym === "sqlite3_key"
          ? { symbol: sym }
          : null;
      },
    };
    const Process = {
      findModuleByName(mod) {
        return mod === "libWCDB.so" ? { name: mod } : null;
      },
    };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    const hooked = send.mock.calls.find((c) => c[0].kind === "hooked");
    expect(hooked).toBeDefined();
    expect(hooked[0].module).toBe("libWCDB.so");
  });

  it("v2 hook reads key from args[2] and length from args[3] (not args[1]/[2])", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) { attached[addr.symbol] = handlers; },
    };
    const Module = {
      findExportByName(mod, sym) {
        return sym === "sqlite3_key_v2" ? { symbol: sym } : null;
      },
    };
    const Process = { findModuleByName() { return { name: "libwcdb.so" }; } };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    // sqlite3_key_v2(sqlite3 *db, const char *zDbName, const void *pKey, int nKey)
    // args[0]=db, args[1]=name, args[2]=keyBytes, args[3]=len
    const dbNamePtr = fakePtr("ffeeffeeffeeffeeffeeffeeffeeffee");  // would be wrong if read as key
    const keyHex = "12345678" + "00".repeat(28);                     // 32 bytes
    const args = [
      fakePtr(0),                   // db
      dbNamePtr,                    // name (NOT the key)
      fakePtr(keyHex),              // pKey — correct args[2]
      fakePtr(32),                  // nKey — correct args[3]
    ];
    attached.sqlite3_key_v2.onEnter(args);

    const keyEvt = send.mock.calls.find((c) => c[0].kind === "key");
    expect(keyEvt).toBeDefined();
    expect(keyEvt[0].hex).toBe(keyHex);           // proves args[2] was read, not args[1]
    expect(keyEvt[0].sig).toBe("v2");
    expect(keyEvt[0].format).toBe("raw-bytes");
    expect(keyEvt[0].length).toBe(32);
  });

  it("reads ascii-hex key via readCString when length === 64", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) { attached[addr.symbol] = handlers; },
    };
    const Module = {
      findExportByName(mod, sym) {
        return sym === "sqlite3_key" ? { symbol: sym } : null;
      },
    };
    const Process = { findModuleByName() { return { name: "libwcdb.so" }; } };
    const Memory = { readCString: memoryReadCString };

    runAgentUnderMock({ Module, Process, Interceptor, send, Memory });

    // 64-char ASCII hex string + len=64 → readCString path (sjqz scenario)
    const asciiHex = "ABCDEF0123456789".repeat(4).toLowerCase();
    const args = [fakePtr(0), fakeAsciiHexPtr(asciiHex), fakePtr(64)];
    attached.sqlite3_key.onEnter(args);

    const keyEvt = send.mock.calls.find((c) => c[0].kind === "key");
    expect(keyEvt).toBeDefined();
    expect(keyEvt[0].hex).toBe(asciiHex);
    expect(keyEvt[0].format).toBe("ascii-hex");
    expect(keyEvt[0].length).toBe(64);
  });

  it("emits unsupported-signature error for mangled C++ symbol (no host attempt)", () => {
    const send = vi.fn();
    const attached = {};
    const Interceptor = {
      attach(addr, handlers) { attached[addr.symbol] = handlers; },
    };
    const mangledSymbol =
      "_ZN4WCDB8Database13setCipherKeyERKNSt6__ndk112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE";
    const Module = {
      findExportByName(mod, sym) {
        return sym === mangledSymbol ? { symbol: sym } : null;
      },
    };
    const Process = { findModuleByName() { return { name: "libwcdb.so" }; } };

    runAgentUnderMock({ Module, Process, Interceptor, send });

    attached[mangledSymbol].onEnter([fakePtr(0), fakePtr("aabb"), fakePtr(32)]);

    const errEvt = send.mock.calls.find(
      (c) => c[0].kind === "error" && /unsupported symbol signature/.test(c[0].message),
    );
    expect(errEvt).toBeDefined();
    // And NO key event emitted (host must fall back to MD5 path).
    const keyEvt = send.mock.calls.find((c) => c[0].kind === "key");
    expect(keyEvt).toBeUndefined();
  });
});

describe("frida-agent — module not yet loaded path", () => {
  it("emits module-waiting and schedules retry", () => {
    const send = vi.fn();
    const Interceptor = { attach: vi.fn() };
    const Module = { findExportByName: vi.fn().mockReturnValue(null) };
    const Process = { findModuleByName: vi.fn().mockReturnValue(null) };
    const setTimeoutMock = vi.fn();

    runAgentUnderMock({ Module, Process, Interceptor, send, setTimeout: setTimeoutMock });

    const waiting = send.mock.calls.find((c) => c[0].kind === "module-waiting");
    expect(waiting).toBeDefined();
    // Post-sjqz audit: agent now tries both libWCDB.so (uppercase, sjqz-verified)
    // and libwcdb.so. The module-waiting event surfaces the join so the
    // host telemetry shows both attempted names.
    expect(waiting[0].module).toBe("libWCDB.so|libwcdb.so");
    expect(setTimeoutMock).toHaveBeenCalled();
    // First retry delay 500ms
    expect(setTimeoutMock.mock.calls[0][1]).toBe(500);
  });
});
