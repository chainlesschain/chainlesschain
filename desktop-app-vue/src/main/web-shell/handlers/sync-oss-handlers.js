/**
 * `sync.oss.*` WS handlers — Phase 3c.3 web-shell parity (D7 + D10 included).
 *
 * 镜像 sync-webdav-handlers.js 的模式 — 把 desktop V5/V6 已有的 IPC channels
 * (`sync:oss:*`) 同时暴露到 web-shell WS topic dispatcher，让 web-panel 不
 * 依赖 `cc sync oss ...` CLI（CLI 端尚未实现）。
 *
 * 7 个 topic：
 *   sync.oss.test                → testConnection (HeadBucket)
 *   sync.oss.run                 → runOSSSync (含 D10 conflict notify)
 *   sync.oss.config-get          → sanitized credentials + status
 *   sync.oss.config-set          → setCredentials（secretAccessKey 留空 = 沿用旧值）
 *   sync.oss.config-clear        → clearCredentials
 *   sync.oss.list-orphans        → D7 detectOrphans diff
 *   sync.oss.delete-orphans      → D7 deleteOrphans batch
 *
 * 进度事件：同 webdav-handlers，web-shell 暂不推 progress chunk。
 */

const credentials = require("../../sync/sync-credentials");
const store = require("../../sync/sync-external-store");
const walker = require("../../sync/incremental-walker");
const renderer = require("../../sync/markdown-renderer");
const { runOSSSync } = require("../../sync/oss-engine");
const { OSSClient } = require("../../sync/oss-client");
const { detectOrphans, deleteOrphans } = require("../../sync/orphan-detector");
const { notifyIfNewConflict } = require("../../sync/sync-conflict-notifier");

const PROVIDER_ID = "oss";

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

/** sync.oss.test */
function createSyncOSSTestHandler() {
  return async function syncOSSTestHandler() {
    const creds = _loadCredentialsForClient();
    if (!creds) {
      return { success: false, error: "OSS 凭证未配置" };
    }
    const client = new OSSClient(creds);
    const res = await client.testConnection();
    return res.ok
      ? { success: true }
      : { success: false, error: res.error, status: res.status };
  };
}

/** sync.oss.run */
function createSyncOSSRunHandler({ database }) {
  return async function syncOSSRunHandler() {
    if (!database) {
      return { success: false, error: "数据库未初始化" };
    }
    const creds = _loadCredentialsForClient();
    if (!creds) {
      return { success: false, error: "OSS 凭证未配置" };
    }
    const client = new OSSClient(creds);
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
    });

    try {
      notifyIfNewConflict({ provider: "OSS / S3", result: res, prevStatus });
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

/** sync.oss.config-get */
function createSyncOSSConfigGetHandler({ database }) {
  return async function syncOSSConfigGetHandler() {
    return {
      success: true,
      data: {
        ..._readSanitizedConfig(),
        status: _statusSummary(database),
      },
    };
  };
}

/** sync.oss.config-set */
function createSyncOSSConfigSetHandler() {
  return async function syncOSSConfigSetHandler(frame) {
    const payload = frame?.payload || {};
    if (typeof payload !== "object" || payload === null) {
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
  };
}

/** sync.oss.config-clear */
function createSyncOSSConfigClearHandler() {
  return async function syncOSSConfigClearHandler() {
    const ok = credentials.clearCredentials(PROVIDER_ID);
    return ok ? { success: true } : { success: false, error: "清除失败" };
  };
}

/** sync.oss.list-orphans — Phase 3c.D7 */
function createSyncOSSListOrphansHandler({ database }) {
  return async function syncOSSListOrphansHandler() {
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
  };
}

/** sync.oss.delete-orphans — Phase 3c.D7 */
function createSyncOSSDeleteOrphansHandler() {
  return async function syncOSSDeleteOrphansHandler(frame) {
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
      return { success: false, error: "OSS 凭证未配置" };
    }
    const client = new OSSClient(creds);
    const result = await deleteOrphans({ client, orphans });
    return { success: true, data: result };
  };
}

/**
 * 一把梭：返回 7 个 topic → handler 的 map。
 */
function createSyncOSSHandlers({ database } = {}) {
  return {
    "sync.oss.test": createSyncOSSTestHandler(),
    "sync.oss.run": createSyncOSSRunHandler({ database }),
    "sync.oss.config-get": createSyncOSSConfigGetHandler({ database }),
    "sync.oss.config-set": createSyncOSSConfigSetHandler(),
    "sync.oss.config-clear": createSyncOSSConfigClearHandler(),
    "sync.oss.list-orphans": createSyncOSSListOrphansHandler({ database }),
    "sync.oss.delete-orphans": createSyncOSSDeleteOrphansHandler(),
  };
}

module.exports = {
  createSyncOSSHandlers,
  createSyncOSSTestHandler,
  createSyncOSSRunHandler,
  createSyncOSSConfigGetHandler,
  createSyncOSSConfigSetHandler,
  createSyncOSSConfigClearHandler,
  createSyncOSSListOrphansHandler,
  createSyncOSSDeleteOrphansHandler,
  PROVIDER_ID,
};
