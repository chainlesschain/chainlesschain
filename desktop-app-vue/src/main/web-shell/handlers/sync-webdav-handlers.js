/**
 * `sync.webdav.*` WS handlers — Phase 3c.3 web-shell parity (2026-05-06).
 *
 * 把 desktop V5/V6 已有的 IPC channels (`sync:webdav:*`) 同时暴露到 web-shell
 * 的 WS topic dispatcher，让 web-panel 不依赖 `cc sync webdav ...` CLI（CLI
 * 端尚未实现，且 spawn `process.execPath` 在 Electron 内会指向 Electron
 * binary —— 同 skill.list 那条路径）。
 *
 * 5 个 topic：
 *   sync.webdav.test            → testConnection
 *   sync.webdav.run             → runWebDAVSync
 *   sync.webdav.config-get      → sanitized credentials + status
 *   sync.webdav.config-set      → setCredentials（password 留空 = 沿用旧值）
 *   sync.webdav.config-clear    → clearCredentials
 *
 * 进度事件：
 *   web-shell 暂不推 progress chunk（不走流式 envelope）—— web-panel UI 通过
 *   final result 显示一次完成度。如要 push 5 条/500ms 节流的实时进度，需要
 *   走 ws-cli-loader 的 streaming envelope（async generator handler），
 *   作为 follow-up。
 *
 * 错误处理：
 *   handler 抛异常 → ws-cli-loader 包成 {ok:false, error:msg}。结构化 error
 *   （如"未配置"、"认证失败"）通过 result.error 字段返回，仍 ok:true，
 *   让 SPA 区分"系统错"和"业务错"。
 */

const credentials = require("../../sync/sync-credentials");
const store = require("../../sync/sync-external-store");
const walker = require("../../sync/incremental-walker");
const renderer = require("../../sync/markdown-renderer");
const { runWebDAVSync } = require("../../sync/webdav-engine");
const { WebDAVClient } = require("../../sync/webdav-client");
const { detectOrphans, deleteOrphans } = require("../../sync/orphan-detector");
const { notifyIfNewConflict } = require("../../sync/sync-conflict-notifier");

const PROVIDER_ID = "webdav";

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

function _statusSummary(database) {
  if (!database) {
    return null;
  }
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

/** sync.webdav.test */
function createSyncWebDAVTestHandler() {
  return async function syncWebDAVTestHandler() {
    const creds = _loadCredentialsForClient();
    if (!creds) {
      return { success: false, error: "WebDAV 凭证未配置" };
    }
    const client = new WebDAVClient(creds);
    const res = await client.testConnection();
    return res.ok
      ? { success: true }
      : { success: false, error: res.error, status: res.status };
  };
}

/** sync.webdav.run */
function createSyncWebDAVRunHandler({ database }) {
  return async function syncWebDAVRunHandler() {
    if (!database) {
      return { success: false, error: "数据库未初始化" };
    }
    const creds = _loadCredentialsForClient();
    if (!creds) {
      return { success: false, error: "WebDAV 凭证未配置" };
    }
    const client = new WebDAVClient(creds);
    // Capture prevStatus for D10 conflict notifier transition logic
    const prevCursor = store.getCursor(database, PROVIDER_ID) || {};
    const prevStatus = prevCursor.lastRunStatus ?? null;

    const res = await runWebDAVSync({
      dbManager: database,
      client,
      store,
      walker,
      renderer,
      providerId: PROVIDER_ID,
      accountKey: "",
      // web-shell 暂不推 progress chunk
    });

    // D10: notify on clean→conflict transition
    try {
      notifyIfNewConflict({ provider: "WebDAV", result: res, prevStatus });
    } catch (_e) {
      /* non-fatal */
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
  };
}

/** sync.webdav.list-orphans — Phase 3c.D7 */
function createSyncWebDAVListOrphansHandler({ database }) {
  return async function syncWebDAVListOrphansHandler() {
    if (!database) {
      return { success: false, error: "数据库未初始化" };
    }
    const creds = _loadCredentialsForClient();
    if (!creds) {
      return { success: false, error: "WebDAV 凭证未配置" };
    }
    const client = new WebDAVClient(creds);
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
  };
}

/** sync.webdav.delete-orphans — Phase 3c.D7 */
function createSyncWebDAVDeleteOrphansHandler() {
  return async function syncWebDAVDeleteOrphansHandler(frame) {
    const payload = frame?.payload || {};
    const orphans = Array.isArray(payload.orphans) ? payload.orphans : null;
    if (!orphans) {
      return {
        success: false,
        error: "payload.orphans 必须是 [{filename, etag?}] 数组",
      };
    }
    const creds = _loadCredentialsForClient();
    if (!creds) {
      return { success: false, error: "WebDAV 凭证未配置" };
    }
    const client = new WebDAVClient(creds);
    const result = await deleteOrphans({ client, orphans });
    return { success: true, data: result };
  };
}

/** sync.webdav.config-get */
function createSyncWebDAVConfigGetHandler({ database }) {
  return async function syncWebDAVConfigGetHandler() {
    return {
      success: true,
      data: {
        ..._readSanitizedConfig(),
        status: _statusSummary(database),
      },
    };
  };
}

/** sync.webdav.config-set */
function createSyncWebDAVConfigSetHandler() {
  return async function syncWebDAVConfigSetHandler(frame) {
    const payload = frame?.payload || {};
    if (typeof payload !== "object" || payload === null) {
      return { success: false, error: "payload 必须是对象" };
    }
    const { url, username, password, remotePath } = payload;
    if (!url || typeof url !== "string") {
      return { success: false, error: "url 必填" };
    }
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
  };
}

/** sync.webdav.config-clear */
function createSyncWebDAVConfigClearHandler() {
  return async function syncWebDAVConfigClearHandler() {
    const ok = credentials.clearCredentials(PROVIDER_ID);
    return ok ? { success: true } : { success: false, error: "清除失败" };
  };
}

/**
 * 一把梭：返回 7 个 topic → handler 的 map，给 web-shell-bootstrap 直接展开。
 */
function createSyncWebDAVHandlers({ database } = {}) {
  return {
    "sync.webdav.test": createSyncWebDAVTestHandler(),
    "sync.webdav.run": createSyncWebDAVRunHandler({ database }),
    "sync.webdav.config-get": createSyncWebDAVConfigGetHandler({ database }),
    "sync.webdav.config-set": createSyncWebDAVConfigSetHandler(),
    "sync.webdav.config-clear": createSyncWebDAVConfigClearHandler(),
    "sync.webdav.list-orphans": createSyncWebDAVListOrphansHandler({
      database,
    }),
    "sync.webdav.delete-orphans": createSyncWebDAVDeleteOrphansHandler(),
  };
}

module.exports = {
  createSyncWebDAVHandlers,
  createSyncWebDAVTestHandler,
  createSyncWebDAVRunHandler,
  createSyncWebDAVConfigGetHandler,
  createSyncWebDAVConfigSetHandler,
  createSyncWebDAVConfigClearHandler,
  createSyncWebDAVListOrphansHandler,
  createSyncWebDAVDeleteOrphansHandler,
  PROVIDER_ID,
};
