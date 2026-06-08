"use strict";

/**
 * AdapterRegistry.readiness() — the "why can't I collect" surface.
 *
 * Uses a STUB vault (readiness only calls vault.getWatermark, defensively)
 * so this file does NOT depend on the native SQLCipher driver and runs on
 * every host — unlike registry.test.js which opens a real LocalVault and is
 * auto-skipped when bs3mc's ABI doesn't match the host Node. See
 * vitest.config.js NATIVE_DEPENDENT_TESTS.
 */

import { describe, it, expect } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AdapterRegistry } = require("../lib/registry");
const {
  READINESS_CATEGORY,
  READINESS_STATUS,
} = require("../lib/adapter-readiness");
const { BilibiliAdapter } = require("../lib/adapters/social-bilibili");
const { TelegramAdapter } = require("../lib/adapters/messaging-telegram");
const { Train12306Adapter } = require("../lib/adapters/travel-12306");
const { EmailAdapter } = require("../lib/adapters/email-imap");
const { WechatAdapter } = require("../lib/adapters/wechat");

// ─── Stub vault — readiness() only needs getWatermark ─────────────────────

function stubVault(watermarks = {}) {
  return {
    _wm: watermarks,
    getWatermark(adapter /*, scope */) {
      return this._wm[adapter] || null;
    },
    audit() {},
  };
}

function byName(reports, name) {
  return reports.find((r) => r.name === name);
}

describe("AdapterRegistry.readiness()", () => {
  it("snapshot adapter with no input → needs_setup / NO_INPUT", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.name).toBe("social-bilibili");
    expect(r.ready).toBe(false);
    expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(r.reason).toBe("NO_INPUT");
    expect(r.category).toBe(READINESS_CATEGORY.SNAPSHOT);
    expect(typeof r.message).toBe("string");
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.actionHint).toBeTruthy();
  });

  it("device-pull adapter (telegram) → needs_setup / DB_NOT_PULLED / device", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new TelegramAdapter());
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("DB_NOT_PULLED");
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(r.extractMode).toBe("device-pull");
  });

  it("12306 snapshot adapter → needs_setup", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new Train12306Adapter());
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("NO_INPUT");
  });

  it("email snapshot stub → NO_INPUT (no live IMAP login)", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new EmailAdapter({ snapshotMode: true }));
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("NO_INPUT");
  });

  it("email per-account → ready=configured WITHOUT opening an IMAP session", async () => {
    let sessionFactoryCalled = false;
    const adapter = new EmailAdapter({
      account: { email: "user@gmail.com", authCode: "secret", provider: "gmail" },
      // If readiness wrongly performed a live login it would call this.
      sessionFactory: () => {
        sessionFactoryCalled = true;
        return { connect: async () => {}, close: async () => {} };
      },
    });
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(adapter);
    const [r] = await reg.readiness();
    expect(r.ready).toBe(true);
    expect(r.status).toBe(READINESS_STATUS.READY);
    expect(r.mode).toBe("configured");
    expect(sessionFactoryCalled).toBe(false);
  });

  it("wechat readiness with db+keyProvider present → configured WITHOUT calling getKey", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-rd-wx-"));
    const dbPath = path.join(tmp, "EnMicroMsg.db");
    fs.writeFileSync(dbPath, "x");
    let getKeyCalled = false;
    const adapter = new WechatAdapter({
      account: { uin: "12345" },
      dbPath,
      keyProvider: {
        getKey: async () => {
          getKeyCalled = true;
          return "deadbeef";
        },
      },
    });
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(adapter);
    const [r] = await reg.readiness();
    expect(r.ready).toBe(true);
    expect(r.mode).toBe("configured");
    // The whole point of readinessOnly: don't invoke the (frida) key provider.
    expect(getKeyCalled).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("wechat with no db → DB_NOT_PULLED", async () => {
    const adapter = new WechatAdapter({ account: { uin: "1" } });
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(adapter);
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("DB_NOT_PULLED");
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
  });

  it("a hanging authenticate() hits the per-adapter timeout → PROBE_TIMEOUT", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register({
      name: "hang-test",
      version: "1.0.0",
      capabilities: [],
      dataDisclosure: { fields: [], sensitivity: "low" },
      authenticate: () => new Promise(() => {}), // never resolves
      healthCheck: async () => ({ ok: true }),
      normalize: (r) => r,
      // eslint-disable-next-line require-yield
      sync: async function* () {},
    });
    const [r] = await reg.readiness({ timeoutMs: 200 });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("PROBE_TIMEOUT");
    expect(r.status).toBe(READINESS_STATUS.ERROR);
  });

  it("an unknown reason code falls back to UNKNOWN (never crashes)", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register({
      name: "weird",
      version: "1.0.0",
      capabilities: [],
      dataDisclosure: { fields: [], sensitivity: "low" },
      authenticate: async () => ({ ok: false, reason: "TOTALLY_NEW_CODE_42" }),
      healthCheck: async () => ({ ok: true }),
      normalize: (r) => r,
      // eslint-disable-next-line require-yield
      sync: async function* () {},
    });
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("TOTALLY_NEW_CODE_42");
    expect(r.message).toBeTruthy(); // mapped via UNKNOWN fallback
  });

  it("folds last sync outcome from the watermark into the report", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault({
        "social-bilibili": {
          last_synced_at: 1700000000000,
          last_status: "error",
          last_error: "boom from last run",
        },
      }),
    });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.lastSyncedAt).toBe(1700000000000);
    expect(r.lastStatus).toBe("error");
    expect(r.lastError).toBe("boom from last run");
  });

  it("attaches a step-by-step import guide to each report", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new BilibiliAdapter());
    reg.register(new WechatAdapter({ account: { uin: "1" } }));
    const reports = await reg.readiness();
    const bili = byName(reports, "social-bilibili");
    expect(bili.guide).toBeTruthy();
    expect(bili.guide.displayName).toBe("哔哩哔哩");
    expect(Array.isArray(bili.guide.methods)).toBe(true);
    expect(bili.guide.methods.length).toBeGreaterThan(0);
    expect(bili.guide.methods[0].steps.length).toBeGreaterThan(0);
    // wechat gets the bespoke device override, not the generic category guide
    const wx = byName(reports, "wechat");
    expect(wx.guide.displayName).toBe("微信（手机）");
    expect(wx.guide.methods[0].label).toMatch(/frida|root/);
  });

  it("reports every registered adapter in registration order", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new BilibiliAdapter());
    reg.register(new TelegramAdapter());
    reg.register(new Train12306Adapter());
    const reports = await reg.readiness();
    expect(reports.map((r) => r.name)).toEqual([
      "social-bilibili",
      "messaging-telegram",
      "travel-12306",
    ]);
    // every report carries the required UI fields
    for (const r of reports) {
      expect(r).toHaveProperty("ready");
      expect(r).toHaveProperty("status");
      expect(r).toHaveProperty("category");
      expect(r).toHaveProperty("message");
    }
    expect(byName(reports, "messaging-telegram").reason).toBe("DB_NOT_PULLED");
  });
});
