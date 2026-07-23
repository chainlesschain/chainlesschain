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
  describeReadiness,
  READINESS_CATEGORY,
  READINESS_STATUS,
} = require("../lib/adapter-readiness");
const { BilibiliAdapter } = require("../lib/adapters/social-bilibili");
const { TelegramAdapter } = require("../lib/adapters/messaging-telegram");
const { WhatsAppAdapter } = require("../lib/adapters/messaging-whatsapp");
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

  it("WhatsApp ADB pull remains needs_setup until the user supplies a key", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new WhatsAppAdapter({ bridgeProvider: () => ({ invoke() {} }) }));
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(r.reason).toBe("ADB_PULL_REQUIRED");
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(r.actionHint).toMatch(/crypt15|crypt14/i);
  });

  it("maps WhatsApp KEY_REQUIRED to an actionable device setup state", () => {
    const r = describeReadiness("KEY_REQUIRED");
    expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(r.actionHint).toMatch(/crypt15|crypt14/i);
  });

  it("maps unverified live endpoints to snapshot setup instead of ready", () => {
    const r = describeReadiness("EXPLICIT_ENDPOINT_REQUIRED");
    expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(r.category).toBe(READINESS_CATEGORY.SNAPSHOT);
    expect(r.actionHint).toMatch(/snapshot|endpoint/i);
  });

  it("maps unverified SQLite schemas to snapshot setup instead of ready", () => {
    const r = describeReadiness("EXPLICIT_SCHEMA_REQUIRED");
    expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(r.category).toBe(READINESS_CATEGORY.SNAPSHOT);
    expect(r.actionHint).toMatch(/snapshot|table/i);
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

  it("does not report ready when cookie mode only has a placeholder fetch seam", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    const defaultFetch = async () => { throw new Error("not configured"); };
    reg.register({
      name: "custom-web-seam",
      version: "1.0.0",
      capabilities: ["sync:snapshot", "sync:cookie-api"],
      extractMode: "web-api",
      dataDisclosure: { fields: [], sensitivity: "low" },
      _cookieAuth: { configured: true },
      _fetchFn: defaultFetch,
      authenticate: async () => ({ ok: true, mode: "cookie" }),
      healthCheck: async () => ({ ok: true }),
      normalize: (value) => value,
      async *sync() {},
    });
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("CUSTOM_FETCH_REQUIRED");
    expect(r.category).toBe(READINESS_CATEGORY.SNAPSHOT);
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

describe("AdapterRegistry.readiness() — ADB one-click (social)", () => {
  const oneClick = { oneClickNames: new Set(["social-bilibili"]) };

  it("device connected → ready via adb-oneclick", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: { ...oneClick, probe: async () => ({ deviceConnected: true, serial: "ABC123" }) },
    });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.ready).toBe(true);
    expect(r.status).toBe(READINESS_STATUS.READY);
    expect(r.mode).toBe("adb-oneclick");
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(r.message).toMatch(/一键采集/);
  });

  it("no device → ADB_DEVICE_NEEDED (actionable, not the snapshot message)", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: { ...oneClick, probe: async () => ({ deviceConnected: false }) },
    });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("ADB_DEVICE_NEEDED");
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(r.message).toMatch(/root|USB|手机/);
  });

  it("a probe that throws degrades to ADB_DEVICE_NEEDED (never crashes)", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: { ...oneClick, probe: async () => { throw new Error("adb missing"); } },
    });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.reason).toBe("ADB_DEVICE_NEEDED");
  });

  it("non-one-click adapter is unaffected by ADB readiness", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: { oneClickNames: new Set(["social-bilibili"]), probe: async () => ({ deviceConnected: true }) },
    });
    reg.register(new TelegramAdapter());
    const [r] = await reg.readiness();
    expect(r.name).toBe("messaging-telegram");
    expect(r.reason).toBe("DB_NOT_PULLED"); // unchanged
  });

  it("without adbReadiness config, social adapter still reports NO_INPUT", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.reason).toBe("NO_INPUT");
  });
});
