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
const { CtripAdapter } = require("../lib/adapters/travel-ctrip");
const { TongchengAdapter } = require("../lib/adapters/travel-tongcheng");
const { DidiAdapter } = require("../lib/adapters/travel-didi");
const { EmailAdapter } = require("../lib/adapters/email-imap");
const { TencentDocsAdapter } = require("../lib/adapters/doc-tencent-docs");
const {
  BrowserHistoryFirefoxAdapter,
} = require("../lib/adapters/browser-history-firefox");
const {
  BrowserHistoryBraveAdapter,
} = require("../lib/adapters/browser-history-brave");
const {
  BrowserHistoryOperaAdapter,
} = require("../lib/adapters/browser-history-opera");
const {
  BrowserHistoryVivaldiAdapter,
} = require("../lib/adapters/browser-history-vivaldi");
const {
  BrowserHistorySafariAdapter,
} = require("../lib/adapters/browser-history-safari");
const { TencentMeetingAdapter } = require("../lib/adapters/meeting-tencent");
const { HBuilderXAdapter } = require("../lib/adapters/hbuilderx");
const { LocalFilesAdapter } = require("../lib/adapters/local-files");
const { ShellHistoryAdapter } = require("../lib/adapters/shell-history");
const { WechatAdapter } = require("../lib/adapters/wechat");
const {
  SystemDataAndroidAdapter,
} = require("../lib/adapters/system-data-android");

// ─── Stub vault — readiness() only needs getWatermark ─────────────────────

function stubVault(watermarks = {}) {
  return {
    _wm: watermarks,
    getWatermark(adapter /*, scope */) {
      return this._wm[adapter] || null;
    },
    setWatermark(adapter, _scope, value) {
      this._wm[adapter] = value;
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
    expect(r.capabilities).toEqual(expect.arrayContaining(["sync:snapshot"]));
  });

  it("list and readiness expose collection-routing metadata", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new TelegramAdapter());
    const [listed] = reg.list();
    const [ready] = await reg.readiness();
    expect(listed.extractMode).toBe("device-pull");
    expect(listed.capabilities).toContain("sync:sqlite");
    expect(ready.extractMode).toBe(listed.extractMode);
    expect(ready.capabilities).toEqual(listed.capabilities);
    expect(ready.capabilities).not.toBe(listed.capabilities);
  });

  it("probes with bounded concurrency while preserving registration order", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    let active = 0;
    let maxActive = 0;
    const names = Array.from({ length: 6 }, (_, index) => `source-${index}`);

    for (const [index, name] of names.entries()) {
      reg.register({
        name,
        version: "1.0.0",
        capabilities: ["sync:snapshot"],
        extractMode: "file-import",
        dataDisclosure: { fields: [], sensitivity: "low" },
        authenticate: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) =>
            setTimeout(resolve, (names.length - index) * 5),
          );
          active -= 1;
          return { ok: true, mode: "configured" };
        },
        healthCheck: async () => ({ ok: true }),
        normalize: () => ({
          events: [],
          persons: [],
          places: [],
          items: [],
          topics: [],
        }),
        sync: async function* () {},
      });
    }

    const reports = await reg.readiness({ concurrency: 2 });

    expect(maxActive).toBe(2);
    expect(reports.map((report) => report.name)).toEqual(names);
    expect(reports.every((report) => report.ready)).toBe(true);
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
    reg.register(
      new WhatsAppAdapter({ bridgeProvider: () => ({ invoke() {} }) }),
    );
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

  it("maps rejected live source URLs to actionable credential setup", () => {
    for (const reason of [
      "INVALID_SOURCE_URL",
      "SOURCE_URL_HOST_NOT_ALLOWED",
      "SOURCE_URL_PORT_NOT_ALLOWED",
    ]) {
      const r = describeReadiness(reason);
      expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
      expect(r.category).toBe(READINESS_CATEGORY.CREDENTIAL);
      expect(r.actionHint).toMatch(/HTTPS.*official/i);
    }
  });

  it("maps unverified SQLite schemas to snapshot setup instead of ready", () => {
    const r = describeReadiness("EXPLICIT_SCHEMA_REQUIRED");
    expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(r.category).toBe(READINESS_CATEGORY.SNAPSHOT);
    expect(r.actionHint).toMatch(/snapshot|table/i);
  });

  it("Tencent Docs requests a local export directory instead of website credentials", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new TencentDocsAdapter());
    const [result] = await reg.readiness();

    expect(result.ready).toBe(false);
    expect(result.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(result.reason).toBe("NO_EXPORT_DIR");
    expect(result.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(result.actionHint).toMatch(/导出目录/u);
  });

  it("Firefox requests a local profile directory when no default profile exists", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(
      new BrowserHistoryFirefoxAdapter({ defaultProfileDir: () => null }),
    );
    const [result] = await reg.readiness();

    expect(result.ready).toBe(false);
    expect(result.status).toBe(READINESS_STATUS.ERROR);
    expect(result.reason).toBe("PROFILE_PATH_UNRESOLVED");
    expect(result.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(result.capabilities).toContain("sync:profile-directory");
  });

  it.each([
    ["Brave", BrowserHistoryBraveAdapter],
    ["Opera", BrowserHistoryOperaAdapter],
    ["Vivaldi", BrowserHistoryVivaldiAdapter],
    ["Safari", BrowserHistorySafariAdapter],
  ])(
    "%s requests a local profile directory when no default profile exists",
    async (_label, Adapter) => {
      const reg = new AdapterRegistry({ vault: stubVault() });
      reg.register(new Adapter({ defaultProfileDir: () => null }));
      const [result] = await reg.readiness();

      expect(result.ready).toBe(false);
      expect(result.status).toBe(READINESS_STATUS.ERROR);
      expect(result.reason).toBe("PROFILE_PATH_UNRESOLVED");
      expect(result.category).toBe(READINESS_CATEGORY.LOCAL);
      expect(result.capabilities).toContain("sync:profile-directory");
    },
  );

  it("maps Safari Full Disk Access denial to an actionable local error", () => {
    const result = describeReadiness("SAFARI_PERMISSION_DENIED");
    expect(result.status).toBe(READINESS_STATUS.ERROR);
    expect(result.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(result.message).toMatch(/Safari/u);
    expect(result.actionHint).toMatch(/完全磁盘访问权限/u);
  });

  it("Tencent Meeting requests a local WeMeet directory when history is absent", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(new TencentMeetingAdapter({ defaultRoot: () => null }));
    const [result] = await reg.readiness();

    expect(result.ready).toBe(false);
    expect(result.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(result.reason).toBe("MEETING_DATA_NOT_FOUND");
    expect(result.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(result.actionHint).toMatch(/路径|数据源/u);
    expect(result.capabilities).toContain("sync:meeting-history");
  });

  it("maps Tencent Meeting schema and permission failures to local guidance", () => {
    const schema = describeReadiness("MEETING_SCHEMA_MISMATCH");
    expect(schema.status).toBe(READINESS_STATUS.ERROR);
    expect(schema.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(schema.message).toMatch(/腾讯会议/u);

    const permission = describeReadiness("MEETING_PERMISSION_DENIED");
    expect(permission.status).toBe(READINESS_STATUS.ERROR);
    expect(permission.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(permission.actionHint).toMatch(/读取权限/u);
  });

  it("reports unresolved and readable-empty HBuilderX profiles as local setup", async () => {
    const unresolvedRegistry = new AdapterRegistry({ vault: stubVault() });
    unresolvedRegistry.register(
      new HBuilderXAdapter({ defaultHBuilderXHomes: () => [] }),
    );
    const [unresolved] = await unresolvedRegistry.readiness();
    expect(unresolved).toMatchObject({
      ready: false,
      status: READINESS_STATUS.NEEDS_SETUP,
      reason: "HBUILDERX_ROOT_UNRESOLVED",
      category: READINESS_CATEGORY.LOCAL,
    });

    const emptyRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "pdh-rd-hbuilderx-"),
    );
    try {
      const emptyRegistry = new AdapterRegistry({ vault: stubVault() });
      emptyRegistry.register(new HBuilderXAdapter({ roots: [emptyRoot] }));
      const [empty] = await emptyRegistry.readiness();
      expect(empty).toMatchObject({
        ready: false,
        status: READINESS_STATUS.NEEDS_SETUP,
        reason: "HBUILDERX_FILE_ACTIVITY_NOT_FOUND",
        category: READINESS_CATEGORY.LOCAL,
      });
      expect(empty.capabilities).toContain("sync:profile-directory");
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("does not report missing local-file roots as ready", async () => {
    const missing = path.join(os.tmpdir(), `pdh-rd-local-files-${Date.now()}`);
    const registry = new AdapterRegistry({ vault: stubVault() });
    registry.register(new LocalFilesAdapter({ roots: [missing] }));
    const [result] = await registry.readiness();

    expect(result).toMatchObject({
      ready: false,
      status: READINESS_STATUS.NEEDS_SETUP,
      reason: "LOCAL_FILES_ROOT_UNRESOLVED",
      category: READINESS_CATEGORY.LOCAL,
    });
    expect(result.capabilities).toContain("sync:scan-directory");
    expect(result.capabilities).toContain("sync:profile-directory");

    const unreadable = describeReadiness("LOCAL_FILES_NOT_READABLE");
    expect(unreadable.status).toBe(READINESS_STATUS.ERROR);
    expect(unreadable.category).toBe(READINESS_CATEGORY.LOCAL);
    const networkRoot = describeReadiness(
      "LOCAL_FILES_NETWORK_ROOT_UNSUPPORTED",
    );
    expect(networkRoot.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(networkRoot.category).toBe(READINESS_CATEGORY.LOCAL);
  });

  it("maps invalid or unreadable local developer metadata to local errors", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-rd-hbuilderx-tz-"));
    try {
      const registry = new AdapterRegistry({ vault: stubVault() });
      registry.register(
        new HBuilderXAdapter({
          roots: [root],
          sourceTimezone: "Mars/Olympus_Mons",
        }),
      );
      const [invalidTimezone] = await registry.readiness();
      expect(invalidTimezone).toMatchObject({
        ready: false,
        status: READINESS_STATUS.ERROR,
        reason: "HBUILDERX_TIMEZONE_INVALID",
        category: READINESS_CATEGORY.LOCAL,
      });
      expect(invalidTimezone.actionHint).toMatch(/sourceTimezone/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    const unreadable = describeReadiness("HBUILDERX_NOT_READABLE");
    expect(unreadable.status).toBe(READINESS_STATUS.ERROR);
    expect(unreadable.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(unreadable.message).toMatch(/HBuilderX/u);

    const repositoryScanFailed = describeReadiness("REPOSITORY_SCAN_FAILED");
    expect(repositoryScanFailed.status).toBe(READINESS_STATUS.ERROR);
    expect(repositoryScanFailed.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(repositoryScanFailed.message).toMatch(/Git/u);

    const invalidHistorySource = describeReadiness("INVALID_HISTORY_SOURCE");
    expect(invalidHistorySource.status).toBe(READINESS_STATUS.ERROR);
    expect(invalidHistorySource.category).toBe(READINESS_CATEGORY.LOCAL);
    expect(invalidHistorySource.message).toMatch(/命令行/u);
  });

  it("does not report absent or invalid shell history files as ready", async () => {
    const missing = path.join(os.tmpdir(), `pdh-rd-shell-${Date.now()}.txt`);
    const defaultsRegistry = new AdapterRegistry({ vault: stubVault() });
    defaultsRegistry.register(
      new ShellHistoryAdapter({
        defaultHistorySources: () => [
          { shell: "bash", file: missing, optional: true },
        ],
      }),
    );
    const [defaults] = await defaultsRegistry.readiness();
    expect(defaults).toMatchObject({
      ready: false,
      status: READINESS_STATUS.NEEDS_SETUP,
      reason: "NO_HISTORY_SOURCES",
      category: READINESS_CATEGORY.LOCAL,
    });

    const explicitRegistry = new AdapterRegistry({ vault: stubVault() });
    explicitRegistry.register(
      new ShellHistoryAdapter({
        sources: [{ shell: "bash", file: missing }],
      }),
    );
    const [explicit] = await explicitRegistry.readiness();
    expect(explicit).toMatchObject({
      ready: false,
      status: READINESS_STATUS.ERROR,
      reason: "INVALID_HISTORY_SOURCE",
      category: READINESS_CATEGORY.LOCAL,
    });
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
      account: {
        email: "user@gmail.com",
        authCode: "secret",
        provider: "gmail",
      },
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

      sync: async function* () {},
    });
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("TOTALLY_NEW_CODE_42");
    expect(r.message).toBeTruthy(); // mapped via UNKNOWN fallback
  });

  it("does not report ready when cookie mode only has a placeholder fetch seam", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    const defaultFetch = async () => {
      throw new Error("not configured");
    };
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
      expect(Array.isArray(r.capabilities)).toBe(true);
    }
    expect(byName(reports, "messaging-telegram").reason).toBe("DB_NOT_PULLED");
  });
});

describe("AdapterRegistry.readiness() — ADB-capable sources", () => {
  const oneClick = { oneClickNames: new Set(["social-bilibili"]) };

  it("device connected → ready via adb-oneclick", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        ...oneClick,
        probe: async () => ({
          authorizedDeviceCount: 1,
          deviceConnected: true,
          serial: "ABC123",
        }),
      },
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
      adbReadiness: {
        ...oneClick,
        probe: async () => ({
          authorizedDeviceCount: 0,
          deviceConnected: false,
        }),
      },
    });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("ADB_DEVICE_NEEDED");
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(r.message).toMatch(/root|USB|手机/);
  });

  it("multiple authorized devices → ADB_MULTIPLE_DEVICES instead of ready", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        ...oneClick,
        probe: async () => ({
          authorizedDeviceCount: 2,
          deviceConnected: true,
        }),
      },
    });
    reg.register(new BilibiliAdapter());

    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.status).toBe(READINESS_STATUS.NEEDS_SETUP);
    expect(r.reason).toBe("ADB_MULTIPLE_DEVICES");
    expect(r.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(r.actionHint).toBeTruthy();
  });

  it.each([
    ["Ctrip", CtripAdapter],
    ["Tongcheng", TongchengAdapter],
    ["Didi enterprise", DidiAdapter],
  ])(
    "%s is not ready when no file or custom fetch source is configured",
    async (_label, Adapter) => {
      const registry = new AdapterRegistry({ vault: stubVault() });
      registry.register(new Adapter());

      const [result] = await registry.readiness();

      expect(result).toMatchObject({
        ready: false,
        status: READINESS_STATUS.NEEDS_SETUP,
        reason: "NO_INPUT",
        category: READINESS_CATEGORY.SNAPSHOT,
      });
    },
  );

  it("a probe that throws reports ADB_PROBE_FAILED (never crashes)", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        ...oneClick,
        probe: async () => {
          throw new Error("adb missing");
        },
      },
    });
    reg.register(new BilibiliAdapter());
    const [r] = await reg.readiness();
    expect(r.reason).toBe("ADB_PROBE_FAILED");
    expect(r.status).toBe(READINESS_STATUS.ERROR);
  });

  it.each([
    "ADB_NOT_INSTALLED",
    "ADB_PROBE_FAILED",
    "ADB_DEVICE_UNAUTHORIZED",
    "ADB_DEVICE_OFFLINE",
    "ADB_SELECTED_DEVICE_NOT_FOUND",
  ])("preserves the detailed ADB probe reason %s", async (reason) => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        ...oneClick,
        probe: async () => ({
          authorizedDeviceCount: 0,
          deviceConnected: false,
          reason,
        }),
      },
    });
    reg.register(new BilibiliAdapter());

    const [result] = await reg.readiness();

    expect(result.ready).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.category).toBe(READINESS_CATEGORY.DEVICE);
    expect(result.actionHint).toBeTruthy();
  });

  it("non-one-click adapter is unaffected by ADB readiness", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        oneClickNames: new Set(["social-bilibili"]),
        probe: async () => ({
          authorizedDeviceCount: 1,
          deviceConnected: true,
        }),
      },
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

  it("marks Android system-data direct collection ready when a device is connected", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        oneClickNames: new Set(["system-data-android"]),
        probe: async () => ({
          authorizedDeviceCount: 1,
          deviceConnected: true,
          serial: "ANDROID-1",
        }),
      },
    });
    reg.register(new SystemDataAndroidAdapter());

    const [r] = await reg.readiness();
    expect(r).toMatchObject({
      name: "system-data-android",
      ready: true,
      status: READINESS_STATUS.READY,
      category: READINESS_CATEGORY.DEVICE,
      mode: "adb-oneclick",
    });
    expect(r.capabilities).toEqual(
      expect.arrayContaining(["sync:snapshot", "sync:adb"]),
    );
  });

  it("keeps Android system-data snapshot import available when no device is connected", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        oneClickNames: new Set(["system-data-android"]),
        probe: async () => ({
          authorizedDeviceCount: 0,
          deviceConnected: false,
        }),
      },
    });
    reg.register(new SystemDataAndroidAdapter());

    const [r] = await reg.readiness();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("ADB_DEVICE_NEEDED");
    expect(r.capabilities).toContain("sync:snapshot");
  });
});

describe("AdapterRegistry.syncAdapter() — collection input contract", () => {
  it("forwards sync-time options to the pre-sync health gate", async () => {
    let healthInputPath = null;
    let syncInputPath = null;
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register({
      name: "file-contract",
      version: "1.0.0",
      capabilities: ["sync:file-import"],
      extractMode: "file-import",
      dataDisclosure: { fields: [], sensitivity: "low" },
      authenticate: async () => ({ ok: false, reason: "NO_INPUT" }),
      healthCheck: async (options) => {
        healthInputPath = options.inputPath;
        return { ok: healthInputPath === "fixture.json" };
      },
      normalize: (value) => value,
      sync: async function* (options) {
        syncInputPath = options.inputPath;
        yield* [];
      },
    });

    const report = await reg.syncAdapter("file-contract", {
      inputPath: "fixture.json",
    });

    expect(report.status).toBe("ok");
    expect(healthInputPath).toBe("fixture.json");
    expect(syncInputPath).toBe("fixture.json");
  });
});

describe("AdapterRegistry.syncAll() — readiness-aware batch collection", () => {
  function emptyAdapter({
    name,
    authenticate,
    healthCheck = async () => ({ ok: true }),
    capabilities = ["sync:snapshot"],
  }) {
    return {
      name,
      version: "1.0.0",
      capabilities,
      extractMode: "file-import",
      dataDisclosure: { fields: [], sensitivity: "low" },
      authenticate,
      healthCheck,
      normalize: () => ({
        events: [],
        persons: [],
        places: [],
        items: [],
        topics: [],
      }),
      sync: async function* () {},
    };
  }

  it("runs ready adapters and emits explicit skipped reports for setup-bound sources", async () => {
    let blockedHealthCalls = 0;
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(
      emptyAdapter({
        name: "ready-source",
        authenticate: async () => ({ ok: true, mode: "configured" }),
      }),
    );
    reg.register(
      emptyAdapter({
        name: "needs-file",
        authenticate: async () => ({ ok: false, reason: "NO_INPUT" }),
        healthCheck: async () => {
          blockedHealthCalls += 1;
          return { ok: false, reason: "NO_INPUT" };
        },
      }),
    );

    const reports = await reg.syncAll();
    expect(reports).toHaveLength(2);
    expect(reports[0].status).toBe("ok");
    expect(reports[1]).toMatchObject({
      adapter: "needs-file",
      status: "skipped",
      skipReason: "NO_INPUT",
      error: null,
    });
    expect(blockedHealthCalls).toBe(0);
  });

  it("emits ordered batch lifecycle progress for ready and skipped sources", async () => {
    const events = [];
    const reg = new AdapterRegistry({
      vault: stubVault(),
      onSyncEvent: (event) => events.push(event),
    });
    reg.register(
      emptyAdapter({
        name: "ready-source",
        authenticate: async () => ({ ok: true, mode: "configured" }),
      }),
    );
    reg.register(
      emptyAdapter({
        name: "needs-file",
        authenticate: async () => ({ ok: false, reason: "NO_INPUT" }),
      }),
    );

    await reg.syncAll();

    const batchEvents = events.filter((event) =>
      event.kind.startsWith("sync.batch."),
    );
    expect(batchEvents).toEqual([
      expect.objectContaining({
        kind: "sync.batch.start",
        current: 0,
        total: 2,
      }),
      expect.objectContaining({
        kind: "sync.batch.progress",
        adapter: "ready-source",
        current: 1,
        total: 2,
        status: "ok",
      }),
      expect.objectContaining({
        kind: "sync.batch.progress",
        adapter: "needs-file",
        current: 2,
        total: 2,
        status: "skipped",
      }),
      expect.objectContaining({
        kind: "sync.batch.done",
        current: 2,
        total: 2,
        statusCounts: { ok: 1, skipped: 1 },
      }),
    ]);
  });

  it("uses adapterOptions as explicit intent even when baseline readiness needs setup", async () => {
    let receivedInputPath = null;
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(
      emptyAdapter({
        name: "file-source",
        authenticate: async (options) =>
          options.inputPath
            ? { ok: true, mode: "snapshot-file" }
            : { ok: false, reason: "NO_INPUT" },
        healthCheck: async (options) => ({
          ok: options.inputPath === "fixture.json",
          reason: "NO_INPUT",
        }),
      }),
    );
    reg.get("file-source").sync = async function* (options) {
      receivedInputPath = options.inputPath;
      yield* [];
    };

    const [report] = await reg.syncAll({
      adapterOptions: {
        "file-source": { inputPath: "fixture.json" },
      },
    });
    expect(report.status).toBe("ok");
    expect(receivedInputPath).toBe("fixture.json");
  });

  it("does not send host-only ADB collectors through the generic adapter sync path", async () => {
    const reg = new AdapterRegistry({
      vault: stubVault(),
      adbReadiness: {
        oneClickNames: new Set(["social-bilibili"]),
        probe: async () => ({
          authorizedDeviceCount: 1,
          deviceConnected: true,
          serial: "ANDROID-1",
        }),
      },
    });
    reg.register(new BilibiliAdapter());

    const [report] = await reg.syncAll();
    expect(report).toMatchObject({
      adapter: "social-bilibili",
      status: "skipped",
      skipReason: "DEDICATED_COLLECTOR_REQUIRED",
    });
  });

  it("supports the legacy force-all mode when readyOnly is false", async () => {
    const reg = new AdapterRegistry({ vault: stubVault() });
    reg.register(
      emptyAdapter({
        name: "forced-source",
        authenticate: async () => ({ ok: false, reason: "NO_INPUT" }),
        healthCheck: async () => ({ ok: false, reason: "NO_INPUT" }),
      }),
    );

    const [report] = await reg.syncAll({ readyOnly: false });
    expect(report.status).toBe("unhealthy");
    expect(report).not.toHaveProperty("skipReason");
  });
});
