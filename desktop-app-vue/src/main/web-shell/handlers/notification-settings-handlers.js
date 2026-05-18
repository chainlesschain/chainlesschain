/**
 * `notification-settings.*` WS handlers — Phase 3c.7 web-shell parity
 * (2026-05-07).
 *
 * 暴露 2 个 topic 给 web-panel，对齐 V5/V6 桌面 SystemSettings.vue 通知
 * tab 的 4 个 toggle (enabled / sound / badge / desktop):
 *   notification-settings.get      → { enabled, sound, badge, desktop }
 *   notification-settings.update   → patch {…} → 持久化 + 返回新值
 *
 * Why a focused topic instead of a full config bridge: V5 SystemSettings
 * 跨 30+ 子节 (general/llm/p2p/database/git/security/...) — 把整个 appConfig
 * surface 全暴露给 SPA 是表面积爆炸。这里只开通知子树，等其他子设置
 * 单独 port 时再各自加 topic / pinia store。
 *
 * 持久化: appConfig.set('notifications.<key>', value)，由 AppConfigManager
 * 自身原子落盘 (跟 V5 SystemSettings 走同一管道)。
 *
 * getAppConfig 复用 web-shell-bootstrap.js 已注入的 lazy getter (Phase
 * 1.6 shell.switch 用过同一引用)，AppConfig 未初始化时 get 返回默认值，
 * update 报错 "AppConfig 未初始化" 给前端 banner 用。
 */

const NOTIF_KEYS = ["enabled", "sound", "badge", "desktop"];
const DEFAULTS = { enabled: true, sound: true, badge: true, desktop: true };

function _loadAppConfig(getAppConfig) {
  if (typeof getAppConfig !== "function") {
    return null;
  }
  try {
    return getAppConfig();
  } catch {
    return null;
  }
}

function _readAll(cfg) {
  const settings = {};
  for (const key of NOTIF_KEYS) {
    const value = cfg.get(`notifications.${key}`, DEFAULTS[key]);
    settings[key] = typeof value === "boolean" ? value : DEFAULTS[key];
  }
  return settings;
}

function createNotificationSettingsGetHandler({ getAppConfig }) {
  return async function notificationSettingsGetHandler() {
    const cfg = _loadAppConfig(getAppConfig);
    if (!cfg) {
      // 未初始化 → 返回默认值,不抛错;SPA 显示 V5 默认形状即可。
      return { success: true, settings: { ...DEFAULTS } };
    }
    return { success: true, settings: _readAll(cfg) };
  };
}

function createNotificationSettingsUpdateHandler({ getAppConfig }) {
  return async function notificationSettingsUpdateHandler(frame = {}) {
    const cfg = _loadAppConfig(getAppConfig);
    if (!cfg) {
      return { success: false, error: "AppConfig 未初始化" };
    }
    // 允许两种形状: {settings: {...}} 或者平铺 {enabled, sound, ...}
    // — 显式 settings: null 视为缺失,不会回退到 frame 本身吞掉错误。
    const patch =
      frame && Object.prototype.hasOwnProperty.call(frame, "settings")
        ? frame.settings
        : frame;
    if (!patch || typeof patch !== "object") {
      return { success: false, error: "缺少 settings" };
    }
    try {
      for (const key of NOTIF_KEYS) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          const value = !!patch[key];
          cfg.set(`notifications.${key}`, value);
        }
      }
      return { success: true, settings: _readAll(cfg) };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createNotificationSettingsHandlers({ getAppConfig } = {}) {
  return {
    "notification-settings.get": createNotificationSettingsGetHandler({
      getAppConfig,
    }),
    "notification-settings.update": createNotificationSettingsUpdateHandler({
      getAppConfig,
    }),
  };
}

module.exports = {
  createNotificationSettingsHandlers,
  createNotificationSettingsGetHandler,
  createNotificationSettingsUpdateHandler,
  NOTIF_KEYS,
  DEFAULTS,
};
