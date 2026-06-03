/**
 * `git.config-*` WS handlers — Phase 3c.5 (2026-05-06)
 *
 * 把 git-config.json (`getGitConfig()` 单例) 暴露给 web-panel：用户在
 * web-shell 里也能配置 Git 仓库（remote URL / 用户名 / token / 作者 /
 * 启用开关），不必切回 V5/V6 桌面 shell。
 *
 * 3 个 topic：
 *   git.config-get    → mask 后的全量配置 + configured 标志
 *   git.config-set    → 部分 patch（password 留空 = 沿用旧值）
 *   git.config-clear  → 关 enabled + 清 auth（保留 remoteUrl / repoPath
 *                       方便用户参考；要彻底重置就清完整段后重输）
 *
 * 注：git-config.json 当前是**明文落盘**（已存在的安全 issue，跨 phase
 * 不在范围内修）—— mask 行为只影响渲染端展示，不动落盘。设计文档
 * §2.3 提了这条债务。
 */

const PROVIDER_ID = "git";

function _maskValue(v) {
  if (v === null || v === undefined || v === "") {
    return v;
  }
  const s = String(v);
  if (s.length > 8) {
    return s.substring(0, 4) + "****" + s.substring(s.length - 4);
  }
  return "********";
}

/**
 * 把 GitConfig 实例转成给 renderer 看的视图：
 *   - auth.password → mask
 *   - auth.token → mask（如果以后加了）
 *   - 其它字段原样
 */
function _shape(cfg) {
  const all = cfg.getAll();
  const auth = all.auth || {};
  const sanitizedAuth = {
    username: auth.username || "",
    password: auth.password ? _maskValue(auth.password) : "",
    token: auth.token ? _maskValue(auth.token) : "",
  };
  return {
    enabled: !!all.enabled,
    repoPath: all.repoPath || "",
    remoteUrl: all.remoteUrl || "",
    authorName: all.authorName || "",
    authorEmail: all.authorEmail || "",
    auth: sanitizedAuth,
    autoSync: !!all.autoSync,
    autoSyncInterval: all.autoSyncInterval || 300000,
    exportPath: all.exportPath || "knowledge",
    configured: !!(all.remoteUrl && (auth.username || auth.token)),
  };
}

function createGitConfigGetHandler({ getConfig }) {
  return async function gitConfigGetHandler() {
    try {
      const cfg = getConfig();
      if (!cfg) {
        return { success: false, error: "git-config 未初始化" };
      }
      return { success: true, data: _shape(cfg) };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createGitConfigSetHandler({ getConfig }) {
  return async function gitConfigSetHandler(frame = {}) {
    try {
      const rawPayload = frame?.payload;
      if (
        rawPayload === null ||
        rawPayload === undefined ||
        typeof rawPayload !== "object" ||
        Array.isArray(rawPayload)
      ) {
        return { success: false, error: "payload 必须是对象" };
      }
      const payload = rawPayload;
      const cfg = getConfig();
      if (!cfg) {
        return { success: false, error: "git-config 未初始化" };
      }

      // 字段级 patch — 只接受白名单字段，其它静默忽略
      if (typeof payload.enabled === "boolean") {
        cfg.setEnabled(payload.enabled);
      }
      if (typeof payload.repoPath === "string") {
        cfg.setRepoPath(payload.repoPath.trim() || null);
      }
      if (typeof payload.remoteUrl === "string") {
        cfg.setRemoteUrl(payload.remoteUrl.trim() || null);
      }
      if (
        typeof payload.authorName === "string" ||
        typeof payload.authorEmail === "string"
      ) {
        const cur = cfg.getAuthor();
        cfg.setAuthor(
          typeof payload.authorName === "string"
            ? payload.authorName
            : cur.name,
          typeof payload.authorEmail === "string"
            ? payload.authorEmail
            : cur.email,
        );
      }
      // auth：username / password / token 三个子字段
      if (payload.auth && typeof payload.auth === "object") {
        const existing = cfg.getAuth() || {};
        const merged = {
          ...existing,
          ...(typeof payload.auth.username === "string"
            ? { username: payload.auth.username }
            : {}),
        };
        // password / token 留空 = 沿用旧值（renderer 拿到 mask 后无法回填明文）
        if (
          typeof payload.auth.password === "string" &&
          payload.auth.password !== ""
        ) {
          merged.password = payload.auth.password;
        }
        if (
          typeof payload.auth.token === "string" &&
          payload.auth.token !== ""
        ) {
          merged.token = payload.auth.token;
        }
        cfg.setAuth(merged);
      }
      if (typeof payload.autoSync === "boolean") {
        const interval =
          typeof payload.autoSyncInterval === "number"
            ? payload.autoSyncInterval
            : null;
        cfg.setAutoSync(payload.autoSync, interval);
      }

      return { success: true, data: _shape(cfg) };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createGitConfigClearHandler({ getConfig }) {
  return async function gitConfigClearHandler() {
    try {
      const cfg = getConfig();
      if (!cfg) {
        return { success: false, error: "git-config 未初始化" };
      }
      cfg.setEnabled(false);
      cfg.setAuth(null);
      return { success: true, data: _shape(cfg) };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

/**
 * 工厂：返回 3 个 topic → handler 的 map。
 *
 * @param {Object} options
 * @param {() => Object|null} [options.getConfig]
 *        返回 GitConfig 单例。默认动态 require（避免循环 import + 启动期未就绪问题）；
 *        测试可注入 fake。
 */
function createGitConfigHandlers(options = {}) {
  const getConfig =
    options.getConfig ||
    (() => {
      try {
        const { getGitConfig } = require("../../git/git-config");
        return getGitConfig();
      } catch (err) {
        return null;
      }
    });
  return {
    "git.config-get": createGitConfigGetHandler({ getConfig }),
    "git.config-set": createGitConfigSetHandler({ getConfig }),
    "git.config-clear": createGitConfigClearHandler({ getConfig }),
  };
}

module.exports = {
  createGitConfigHandlers,
  createGitConfigGetHandler,
  createGitConfigSetHandler,
  createGitConfigClearHandler,
  PROVIDER_ID,
};
