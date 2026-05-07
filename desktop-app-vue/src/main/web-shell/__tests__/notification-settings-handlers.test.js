/**
 * notification-settings.* WS handler 单元测试 — Phase 3c.7 web-shell parity
 *
 * 注入 stub appConfig (get/set),不 require 真 AppConfigManager。
 * 覆盖默认值 / patch / 拒绝非对象 / appConfig=null 三态。
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  createNotificationSettingsHandlers,
  createNotificationSettingsGetHandler,
  createNotificationSettingsUpdateHandler,
  NOTIF_KEYS,
  DEFAULTS,
} = require("../handlers/notification-settings-handlers");

function makeStubAppConfig(initial = {}) {
  const store = { ...initial };
  return {
    get: vi.fn((key, defaultValue) => {
      const k = key.replace(/^notifications\./, "");
      return Object.prototype.hasOwnProperty.call(store, k)
        ? store[k]
        : defaultValue;
    }),
    set: vi.fn((key, value) => {
      const k = key.replace(/^notifications\./, "");
      store[k] = value;
    }),
    _store: store,
  };
}

// ── get ─────────────────────────────────────────────────────────

describe("notification-settings.get", () => {
  it("returns DEFAULTS when getAppConfig is null/undefined", async () => {
    const handler = createNotificationSettingsGetHandler({
      getAppConfig: null,
    });
    const reply = await handler({});
    expect(reply.success).toBe(true);
    expect(reply.settings).toEqual(DEFAULTS);
  });

  it("returns DEFAULTS when getAppConfig throws", async () => {
    const handler = createNotificationSettingsGetHandler({
      getAppConfig: () => {
        throw new Error("boom");
      },
    });
    const reply = await handler({});
    expect(reply.success).toBe(true);
    expect(reply.settings).toEqual(DEFAULTS);
  });

  it("reads each NOTIF_KEY from appConfig with default fallback", async () => {
    const cfg = makeStubAppConfig({
      enabled: false,
      sound: true,
      // badge / desktop missing → defaults
    });
    const handler = createNotificationSettingsGetHandler({
      getAppConfig: () => cfg,
    });
    const reply = await handler({});
    expect(reply.settings).toEqual({
      enabled: false,
      sound: true,
      badge: true,
      desktop: true,
    });
    for (const key of NOTIF_KEYS) {
      expect(cfg.get).toHaveBeenCalledWith(
        `notifications.${key}`,
        DEFAULTS[key],
      );
    }
  });

  it("coerces non-boolean stored value to default", async () => {
    const cfg = makeStubAppConfig({ enabled: "yes" /* corrupt */ });
    const handler = createNotificationSettingsGetHandler({
      getAppConfig: () => cfg,
    });
    const reply = await handler({});
    expect(reply.settings.enabled).toBe(true); // coerced to default
  });
});

// ── update ──────────────────────────────────────────────────────

describe("notification-settings.update", () => {
  it("rejects when appConfig is null", async () => {
    const handler = createNotificationSettingsUpdateHandler({
      getAppConfig: null,
    });
    const reply = await handler({ settings: { enabled: false } });
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/未初始化/);
  });

  it("rejects when frame.settings is missing/non-object", async () => {
    const cfg = makeStubAppConfig();
    const handler = createNotificationSettingsUpdateHandler({
      getAppConfig: () => cfg,
    });
    const reply = await handler({ settings: null });
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/缺少 settings/);
  });

  it("writes only listed NOTIF_KEYS, ignores other keys", async () => {
    const cfg = makeStubAppConfig();
    const handler = createNotificationSettingsUpdateHandler({
      getAppConfig: () => cfg,
    });
    const reply = await handler({
      settings: { enabled: false, sound: false, _injection: true },
    });
    expect(reply.success).toBe(true);
    expect(cfg.set).toHaveBeenCalledWith("notifications.enabled", false);
    expect(cfg.set).toHaveBeenCalledWith("notifications.sound", false);
    expect(cfg.set).not.toHaveBeenCalledWith(
      "notifications._injection",
      expect.any(Boolean),
    );
    expect(reply.settings).toEqual({
      enabled: false,
      sound: false,
      badge: true,
      desktop: true,
    });
  });

  it("coerces truthy/falsy patch values to boolean", async () => {
    const cfg = makeStubAppConfig();
    const handler = createNotificationSettingsUpdateHandler({
      getAppConfig: () => cfg,
    });
    await handler({ settings: { enabled: 1, sound: 0, badge: "" } });
    expect(cfg.set).toHaveBeenCalledWith("notifications.enabled", true);
    expect(cfg.set).toHaveBeenCalledWith("notifications.sound", false);
    expect(cfg.set).toHaveBeenCalledWith("notifications.badge", false);
  });

  it("accepts flat patch (settings spread on frame)", async () => {
    const cfg = makeStubAppConfig();
    const handler = createNotificationSettingsUpdateHandler({
      getAppConfig: () => cfg,
    });
    const reply = await handler({ desktop: false });
    expect(reply.success).toBe(true);
    expect(cfg.set).toHaveBeenCalledWith("notifications.desktop", false);
  });

  it("returns error envelope when set throws", async () => {
    const cfg = makeStubAppConfig();
    cfg.set.mockImplementation(() => {
      throw new Error("disk full");
    });
    const handler = createNotificationSettingsUpdateHandler({
      getAppConfig: () => cfg,
    });
    const reply = await handler({ settings: { enabled: false } });
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/disk full/);
  });
});

// ── factory ─────────────────────────────────────────────────────

describe("createNotificationSettingsHandlers", () => {
  it("returns the 2 named topics", () => {
    const cfg = makeStubAppConfig();
    const handlers = createNotificationSettingsHandlers({
      getAppConfig: () => cfg,
    });
    expect(Object.keys(handlers).sort()).toEqual([
      "notification-settings.get",
      "notification-settings.update",
    ]);
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe("function");
    }
  });
});
