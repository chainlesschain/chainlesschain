/**
 * S3 / OSS IPC 处理器 (Phase 3c follow-up — Phase 3c.3 OSS provider)
 *
 * 暴露 5 个 IPC channel：
 *   sync:oss:test           —— HeadBucket，验证 endpoint / credentials / bucket
 *   sync:oss:run            —— 跑一次完整 sync (drain tombstones + push 增量)
 *   sync:oss:config-get     —— 返回 mask 后的配置（secretAccessKey 不回 renderer）
 *   sync:oss:config-set     —— 接受 plain 配置，写 secure-config.enc
 *   sync:oss:config-clear   —— 清除凭证
 *
 * 进度事件：
 *   sync:oss:progress       —— mainWindow.webContents.send；payload 见
 *                              oss-engine onProgress。Renderer 可通过
 *                              preload `electronAPI.sync.oss.onProgress` 订阅
 *
 * 设计：
 *   - dependencies-injection：registerOSSIPC({ database, mainWindow })
 *   - 走 ipcGuard 防重复注册（同 git-ipc.js / webdav-ipc.js）
 *   - OSSClient 实例 lazy-create per-call（每次拿最新配置）
 */

"use strict";

const { logger } = require("../utils/logger.js");
const ipcGuard = require("../ipc/ipc-guard");

const credentials = require("./sync-credentials");
const store = require("./sync-external-store");
const walker = require("./incremental-walker");
const renderer = require("./markdown-renderer");
const { runOSSSync } = require("./oss-engine");
const { OSSClient } = require("./oss-client");
const { detectOrphans, deleteOrphans } = require("./orphan-detector");
const { notifyIfNewConflict } = require("./sync-conflict-notifier");

const PROVIDER_ID = "oss";

/** 把 sanitized credentials 拼成给 renderer 看的视图（secretAccessKey 已 mask）。 */
function _readSanitizedConfig() {
  const c = credentials.getCredentialsSanitized(PROVIDER_ID);
  return {
    endpoint: c.endpoint || "",
    region: c.region || "",
    bucket: c.bucket || "",
    accessKeyId: c.accessKeyId || "",
    secretAccessKey: c.secretAccessKey || "", // 已 mask
    remotePath: c.remotePath || "",
    forcePathStyle: c.forcePathStyle === true,
    configured: credentials.hasCredentials(PROVIDER_ID),
  };
}

/** 从存储拿 plain 凭证 + 校验必填，给 client / engine 用。 */
function _loadCredentialsForClient() {
  const c = credentials.getCredentials(PROVIDER_ID);
  if (!c.endpoint || !c.bucket || !c.accessKeyId || !c.secretAccessKey) {
    return null;
  }
  return {
    endpoint: c.endpoint,
    region: c.region || "auto",
    bucket: c.bucket,
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    remotePath: c.remotePath || "",
    forcePathStyle: c.forcePathStyle === true,
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
 * @param {Object} deps.database     — DatabaseManager 实例
 * @param {Object} deps.mainWindow   — BrowserWindow，用 webContents.send 推进度
 * @param {Object} [deps.ipcMain]    — 测试注入
 */
function registerOSSIPC({ database, mainWindow, ipcMain: injectedIpcMain }) {
  if (ipcGuard.isModuleRegistered("oss-ipc")) {
    logger.info("[OSS IPC] 已注册，跳过");
    return;
  }
  const ipcMain = injectedIpcMain || require("electron").ipcMain;

  // ── sync:oss:test ────────────────────────────────────────────
  ipcMain.handle("sync:oss:test", async () => {
    try {
      const creds = _loadCredentialsForClient();
      if (!creds) {
        return { success: false, error: "OSS 凭证未配置" };
      }
      const client = new OSSClient(creds);
      const res = await client.testConnection();
      return res.ok
        ? { success: true }
        : { success: false, error: res.error, status: res.status };
    } catch (err) {
      logger.error("[OSS IPC] test 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:oss:run ──────────────────────────────────────────────
  ipcMain.handle("sync:oss:run", async () => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }
      const creds = _loadCredentialsForClient();
      if (!creds) {
        return { success: false, error: "OSS 凭证未配置" };
      }
      const client = new OSSClient(creds);

      const onProgress = (e) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed?.()) {
            mainWindow.webContents.send("sync:oss:progress", e);
          }
        } catch (sendErr) {
          logger.warn(
            "[OSS IPC] progress send 失败（不致命）:",
            sendErr?.message,
          );
        }
      };

      const prevCursor = store.getCursor(database, PROVIDER_ID) || {};
      const prevStatus = prevCursor.lastRunStatus ?? null;

      const res = await runOSSSync({
        dbManager: database,
        client,
        store,
        walker,
        renderer,
        providerId: PROVIDER_ID,
        accountKey: "",
        onProgress,
      });

      // D10 conflict notify (transition clean → conflict only)
      try {
        notifyIfNewConflict({
          provider: "OSS / S3",
          result: res,
          prevStatus,
        });
      } catch (notifyErr) {
        logger.warn(
          "[OSS IPC] conflict notify 失败（不致命）:",
          notifyErr?.message,
        );
      }

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
      logger.error("[OSS IPC] run 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:oss:config-get ───────────────────────────────────────
  ipcMain.handle("sync:oss:config-get", async () => {
    try {
      return {
        success: true,
        data: {
          ..._readSanitizedConfig(),
          status: database ? _statusSummary(database) : null,
        },
      };
    } catch (err) {
      logger.error("[OSS IPC] config-get 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:oss:config-set ───────────────────────────────────────
  ipcMain.handle("sync:oss:config-set", async (_event, payload) => {
    try {
      if (!payload || typeof payload !== "object") {
        return { success: false, error: "payload 必须是对象" };
      }
      const {
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        remotePath,
        forcePathStyle,
      } = payload;
      if (!endpoint || typeof endpoint !== "string") {
        return { success: false, error: "endpoint 必填" };
      }
      if (!bucket || typeof bucket !== "string") {
        return { success: false, error: "bucket 必填" };
      }
      if (!accessKeyId || typeof accessKeyId !== "string") {
        return { success: false, error: "accessKeyId 必填" };
      }
      // secretAccessKey 留空 → 沿用旧值（renderer 永远拿不到 plain secret）
      let finalSecret = secretAccessKey;
      if (!finalSecret) {
        const existing = credentials.getCredentials(PROVIDER_ID);
        finalSecret = existing.secretAccessKey || "";
      }
      if (!finalSecret) {
        return { success: false, error: "secretAccessKey 必填（首次配置）" };
      }
      const ok = credentials.setCredentials(PROVIDER_ID, {
        endpoint: endpoint.trim(),
        region: (region || "auto").trim(),
        bucket: bucket.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: finalSecret,
        remotePath: (remotePath || "").trim(),
        forcePathStyle: forcePathStyle === true,
      });
      return ok ? { success: true } : { success: false, error: "保存失败" };
    } catch (err) {
      logger.error("[OSS IPC] config-set 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:oss:config-clear ─────────────────────────────────────
  ipcMain.handle("sync:oss:config-clear", async () => {
    try {
      const ok = credentials.clearCredentials(PROVIDER_ID);
      return ok ? { success: true } : { success: false, error: "清除失败" };
    } catch (err) {
      logger.error("[OSS IPC] config-clear 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:oss:list-orphans ─────────────────────────────────────
  // Phase 3c follow-up D7: 列远端在本地 cursor 没记录的孤儿对象
  ipcMain.handle("sync:oss:list-orphans", async () => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }
      const creds = _loadCredentialsForClient();
      if (!creds) {
        return { success: false, error: "OSS 凭证未配置" };
      }
      const client = new OSSClient(creds);
      let listResult;
      try {
        listResult = await client.listRemote();
      } catch (err) {
        return {
          success: false,
          error: `远端列举失败：${err?.message || String(err)}`,
        };
      }
      const cursor = store.getCursor(database, PROVIDER_ID) || {};
      const diff = detectOrphans({ cursor, listResult });
      return {
        success: true,
        data: {
          orphans: diff.orphans,
          knownCount: diff.knownCount,
          totalRemote: diff.totalRemote,
        },
      };
    } catch (err) {
      logger.error("[OSS IPC] list-orphans 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── sync:oss:delete-orphans ───────────────────────────────────
  ipcMain.handle("sync:oss:delete-orphans", async (_event, payload) => {
    try {
      const orphans = Array.isArray(payload?.orphans) ? payload.orphans : null;
      if (!orphans) {
        return {
          success: false,
          error: "payload.orphans 必须是 [{filename, etag?}] 数组",
        };
      }
      const creds = _loadCredentialsForClient();
      if (!creds) {
        return { success: false, error: "OSS 凭证未配置" };
      }
      const client = new OSSClient(creds);
      const result = await deleteOrphans({
        client,
        orphans,
        logger: (e) => logger[e.level || "info"]?.("[OSS IPC orphan]", e.msg),
      });
      return { success: true, data: result };
    } catch (err) {
      logger.error("[OSS IPC] delete-orphans 异常:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcGuard.markModuleRegistered("oss-ipc");
  logger.info("[OSS IPC] 已注册 7 个 handlers");
}

module.exports = {
  registerOSSIPC,
  PROVIDER_ID,
};
