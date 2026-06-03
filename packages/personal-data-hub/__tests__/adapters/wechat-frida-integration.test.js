"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  WechatAdapter,
  WeChatFridaKeyProvider,
} = require("../../lib/adapters/wechat");

/**
 * Phase 12.6.5 — integration: WechatAdapter.authenticate flow against
 * a mock FridaKeyProvider. We don't open a real SQLCipher DB here —
 * that requires a fixture + better-sqlite3-multiple-ciphers compiled
 * against the host's Node ABI, and is covered separately in the v0.5
 * suite. Goal of this slice: prove the adapter's KeyProvider DI seam
 * works identically for the Frida path.
 */

function mockFrida({ keyHex, throwOnAttach, delayMs = 0 } = {}) {
  const script = {
    message: { connect: (h) => { script._handler = h; } },
    load: async () => {
      setTimeout(() => {
        if (!script._handler) return;
        script._handler({ type: "send", payload: {
          kind: "hooked", symbol: "sqlite3_key", module: "libwcdb.so",
        } });
        script._handler({ type: "send", payload: {
          kind: "key", hex: keyHex, source: "sqlite3_key",
        } });
      }, delayMs);
    },
    unload: async () => {},
  };
  const session = {
    createScript: async () => script,
    detach: async () => {},
  };
  const device = {
    attach: async () => {
      if (throwOnAttach) throw new Error(throwOnAttach);
      return session;
    },
  };
  return {
    getDevice: async () => device,
    getUsbDevice: async () => device,
  };
}

describe("WechatAdapter + FridaKeyProvider — DI integration", () => {
  it("authenticate succeeds when frida provides a key", async () => {
    // dbPath needs to point to a real file for the existsSync gate
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const tmpDb = path.join(os.tmpdir(), `wechat-mock-${Date.now()}.db`);
    fs.writeFileSync(tmpDb, "fake sqlite header");

    const frida = mockFrida({ keyHex: "ab".repeat(32) /* 64 hex */ });
    const keyProvider = new WeChatFridaKeyProvider({
      frida,
      deviceId: "TEST",
      agentLoader: () => "/* test agent */",
    });

    const adapter = new WechatAdapter({
      account: { uin: "1234567890" },
      dbPath: tmpDb,
      keyProvider,
    });

    const r = await adapter.authenticate();
    expect(r.ok).toBe(true);
    expect(r.account).toBe("1234567890");

    try { fs.unlinkSync(tmpDb); } catch (_e) { /* test cleanup */ }
  });

  it("authenticate reports NO_KEY_PROVIDER when keyProvider absent", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const tmpDb = path.join(os.tmpdir(), `wechat-mock-${Date.now()}.db`);
    fs.writeFileSync(tmpDb, "fake");

    const adapter = new WechatAdapter({
      account: { uin: "1234567890" },
      dbPath: tmpDb,
      // keyProvider omitted on purpose
    });
    const r = await adapter.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_KEY_PROVIDER");

    try { fs.unlinkSync(tmpDb); } catch (_e) { /* test cleanup */ }
  });

  it("authenticate reports KEY_PROVIDER_THREW when Frida times out", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const tmpDb = path.join(os.tmpdir(), `wechat-mock-${Date.now()}.db`);
    fs.writeFileSync(tmpDb, "fake");

    // Mock with no messages → will timeout
    const session = {
      createScript: async () => ({
        message: { connect: () => {} },
        load: async () => {},
        unload: async () => {},
      }),
      detach: async () => {},
    };
    const frida = {
      getDevice: async () => ({ attach: async () => session }),
      getUsbDevice: async () => ({ attach: async () => session }),
    };
    const keyProvider = new WeChatFridaKeyProvider({
      frida,
      deviceId: "TEST",
      agentLoader: () => "",
      timeoutMs: 30,
    });

    const adapter = new WechatAdapter({
      account: { uin: "1234567890" },
      dbPath: tmpDb,
      keyProvider,
    });

    const r = await adapter.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("KEY_PROVIDER_THREW");
    expect(r.error).toMatch(/30ms/);

    try { fs.unlinkSync(tmpDb); } catch (_e) { /* test cleanup */ }
  });

  it("DB_NOT_PULLED takes precedence over keyProvider absence", async () => {
    const adapter = new WechatAdapter({
      account: { uin: "1234567890" },
      dbPath: "/definitely/not/a/real/path/wechat.db",
    });
    const r = await adapter.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_NOT_PULLED");
  });
});
