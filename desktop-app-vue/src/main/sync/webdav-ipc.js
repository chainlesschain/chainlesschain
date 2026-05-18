/**
 * WebDAV IPC 处理器（Phase 3c.2，task #5 下半段）
 *
 * 暴露 4 个 IPC channel：
 *   sync:webdav:test         —— PROPFIND remotePath，验证连通性
 *   sync:webdav:run          —— 跑一次完整 sync（drain tombstones + push 增量）
 *   sync:webdav:config-get   —— 返回 mask 后的配置（password 不回 renderer）
 *   sync:webdav:config-set   —— 接受 plain 配置，写 secure-config.enc
 *
 * 进度事件：
 *   sync:webdav:progress     —— mainWindow.webContents.send；payload 见
 *                                webdav-engine onProgress。Renderer 可通过
 *                                preload `electronAPI.sync.webdav.onProgress` 订阅
 *
 * 设计：
 *   - dependencies-injection：registerWebDAVIPC({ database, mainWindow })
 *   - 走 ipcGuard 防重复注册（同 git-ipc.js）
 *   - WebDAVClient 实例 lazy-create per-call（每次拿最新配置；并发推送
 *     Phase 3c v1 不会出现 — scheduler 串行）
 */

const { logger } = require("../utils/logger.js");
const ipcGuard = require("../ipc/ipc-guard");

const credentials = require("./sync-credentials");
const store = require("./sync-external-store");
const walker = require("./incremental-walker");
const renderer = require("./markdown-renderer");
const { runWebDAVSync } = require("./webdav-engine");
const { WebDAVClient } = require("./webdav-client");

const PROVIDER_ID = "webdav";

/** 把 sanitized credentials 拼成给 renderer 看的视图。 */
function _readSanitizedConfig() {
  const c = credentials.getCredentialsSanitized(PROVIDER_ID);
  return {
    url: c.url || "",
    username: c.username || "",
    password: c.password || "", // 已 mask
    remotePath: c.remotePath || "",
    configured: credentials.hasCredentials(PROVIDER_ID),
  };
}

/** 从存储拿 plain 凭证 + 校验必填，给 client / engine 用。 */
function _loadCredentialsForClient() {
  const c = credentials.getCredentials(PROVIDER_ID);
  if (!c.url || !c.username || !c.password) {
    return null;
  }
  return {
    url: c.url,
    username: c.username,
    password: c.password,
    remotePath: c.remotePath || "/",
  };
}

/** 把 cursor row 摊成给 UI 看的状态 summary。 */
function _statusSummary(database) {
  const cursor = store.getCursor(database, PROVIDER_ID) || {};
  return {
    lastSyncAt: cursor.lastSyncAt ?? null,
    lastRunStatus: cursor.lastRunStatus ?? null,
    lastRunError: cursor.lastRunError ?? null,
    lastRunDurationMs: cursor.lastRunDurationMs ?? null,
    itemsPushed: cursor.itemsPushed ?? 0,
    itemsSkipped: cursor.itemsSkipped ?? 0,
    itemsDeleted: cursor.itemsDeleted ?? 0,
    pendingTombstones:
      store.listTombstones(database, PROVIDER_ID, "", 1, ["KNOWLEDGE_ITEM"])
        .length > 0,
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.database     — DatabaseManager 实例（暴露 .all/.get/.run/.db）
 * @param {Object} deps.mainWindow   — BrowserWindow，用 webContents.send 推进度
 * @param {Object} [deps.ipcMain]    — 测试注入
 */
function registerWebDAVIPC({ database, mainWindow, ipcMain: injectedIpcMain }) {
  if (ipcGuard.isModuleRegistered("webdav-ipc")) {
    logger.info("[WebDAV IPC] 已注册，跳过");
    return;
  }
  const ipcMain = injectedIpcMain || require("electron").ipcMain;

  // ── sync:webdav:test ──────────────────────────────────────────
  ipcMain.handle("sync:webdav:test", async () => {
    try {
      const creds = _loadCredentialsForClient();
      if (!creds) {
        return { success: false, error: "WebDAV 凭证未配置" };
      }
      const client = new WebDAVClient(creds);
      const res = await client.testConnection();
      return res.ok
        ? { success: true }
        : { success: false, error: res.error, status: res.status };
    } catch (err) {
      logger.error("[WebDAV IPC] test 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:webdav:run ───────────────────────────────────────────
  ipcMain.handle("sync:webdav:run", async () => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }
      const creds = _loadCredentialsForClient();
      if (!creds) {
        return { success: false, error: "WebDAV 凭证未配置" };
      }
      const client = new WebDAVClient(creds);

      const onProgress = (e) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed?.()) {
            mainWindow.webContents.send("sync:webdav:progress", e);
          }
        } catch (sendErr) {
          logger.warn(
            "[WebDAV IPC] progress send 失败（不致命）:",
            sendErr?.message,
          );
        }
      };

      const res = await runWebDAVSync({
        dbManager: database,
        client,
        store,
        walker,
        renderer,
        providerId: PROVIDER_ID,
        accountKey: "",
        onProgress,
      });
      return {
        success: res.success,
        status: res.status,
        pushed: res.pushed,
        skipped: res.skipped,
        deleted: res.deleted,
        durationMs: res.durationMs,
        error: res.error,
      };
    } catch (err) {
      logger.error("[WebDAV IPC] run 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:webdav:config-get ────────────────────────────────────
  ipcMain.handle("sync:webdav:config-get", async () => {
    try {
      return {
        success: true,
        data: {
          ..._readSanitizedConfig(),
          status: database ? _statusSummary(database) : null,
        },
      };
    } catch (err) {
      logger.error("[WebDAV IPC] config-get 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:webdav:config-set ────────────────────────────────────
  ipcMain.handle("sync:webdav:config-set", async (_event, payload) => {
    try {
      if (!payload || typeof payload !== "object") {
        return { success: false, error: "payload 必须是对象" };
      }
      const { url, username, password, remotePath } = payload;
      if (!url || typeof url !== "string") {
        return { success: false, error: "url 必填" };
      }
      // password 留空表示沿用旧值（renderer 永远拿不到 plain password）
      let finalPassword = password;
      if (!finalPassword) {
        const existing = credentials.getCredentials(PROVIDER_ID);
        finalPassword = existing.password || "";
      }
      const ok = credentials.setCredentials(PROVIDER_ID, {
        url: url.trim(),
        username: username || "",
        password: finalPassword,
        remotePath: (remotePath || "/").trim(),
      });
      return ok ? { success: true } : { success: false, error: "保存失败" };
    } catch (err) {
      logger.error("[WebDAV IPC] config-set 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:webdav:config-clear ──────────────────────────────────
  ipcMain.handle("sync:webdav:config-clear", async () => {
    try {
      const ok = credentials.clearCredentials(PROVIDER_ID);
      return ok ? { success: true } : { success: false, error: "清除失败" };
    } catch (err) {
      logger.error("[WebDAV IPC] config-clear 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcGuard.markModuleRegistered("webdav-ipc");
  logger.info("[WebDAV IPC] 已注册 5 个 handlers");
}

module.exports = {
  registerWebDAVIPC,
  PROVIDER_ID,
};
