/**
 * 外部 sync provider 游标 + tombstone 数据访问层（Phase 3c.2）
 *
 * 包 `sync_external_provider_cursor` 和 `sync_external_tombstones` 两张表 +
 * 配套 JSON 列（remote_etag_map / remote_filename_map）的增量更新。
 *
 * 风格对齐 database-knowledge.js：纯函数 + 调用方传 dbManager/logger，不维护
 * 自己的连接。
 *
 * 并发：sync 永远串行触发（syncScheduler），所以 etag/filename map 的
 * read-modify-write 不需要事务保护。
 */

const DEFAULT_ACCOUNT_KEY = "";

function _now() {
  return Date.now();
}

function _safeParseJson(text, fallback) {
  if (!text || typeof text !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * 取游标。不存在时返回 null（让调用方决定首次同步语义）。
 */
function getCursor(dbManager, providerId, accountKey = DEFAULT_ACCOUNT_KEY) {
  if (!dbManager?.db) {
    return null;
  }
  const row = dbManager.get(
    `SELECT * FROM sync_external_provider_cursor
     WHERE provider_id = ? AND account_key = ?`,
    [providerId, accountKey],
  );
  if (!row) {
    return null;
  }
  return {
    providerId: row.provider_id,
    accountKey: row.account_key,
    lastSyncAt: row.last_sync_at ?? 0,
    lastItemId: row.last_item_id || null,
    remoteEtagMap: _safeParseJson(row.remote_etag_map, {}),
    remoteFilenameMap: _safeParseJson(row.remote_filename_map, {}),
    lastRunStatus: row.last_run_status || null,
    lastRunError: row.last_run_error || null,
    lastRunDurationMs: row.last_run_duration_ms ?? null,
    itemsPushed: row.items_pushed ?? 0,
    itemsSkipped: row.items_skipped ?? 0,
    itemsDeleted: row.items_deleted ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 确保游标行存在（首次同步前由调用方调一次）。返回当前 cursor。
 *
 * INSERT OR IGNORE → 已存在不动，新建用 0 默认值。这是触发器
 * trg_sync_ext_tombstone_on_delete 生效的前提（trigger 只对已建过游标
 * 的 provider fan-out tombstone）。
 */
function ensureCursor(dbManager, providerId, accountKey = DEFAULT_ACCOUNT_KEY) {
  dbManager.run(
    `INSERT OR IGNORE INTO sync_external_provider_cursor
       (provider_id, account_key) VALUES (?, ?)`,
    [providerId, accountKey],
  );
  return getCursor(dbManager, providerId, accountKey);
}

/**
 * 推进游标（一次同步成功结束时调）。fields 是部分 patch。
 *
 * 已知字段（snake_case 由本函数转换）：
 *   lastSyncAt, lastItemId, remoteEtagMap, remoteFilenameMap,
 *   lastRunStatus, lastRunError, lastRunDurationMs,
 *   itemsPushed (累加), itemsSkipped (累加), itemsDeleted (累加)
 */
function updateCursor(
  dbManager,
  providerId,
  fields,
  accountKey = DEFAULT_ACCOUNT_KEY,
) {
  ensureCursor(dbManager, providerId, accountKey);

  const sets = ["updated_at = ?"];
  const params = [_now()];

  const map = {
    lastSyncAt: "last_sync_at",
    lastItemId: "last_item_id",
    remoteEtagMap: "remote_etag_map",
    remoteFilenameMap: "remote_filename_map",
    lastRunStatus: "last_run_status",
    lastRunError: "last_run_error",
    lastRunDurationMs: "last_run_duration_ms",
  };

  for (const [k, v] of Object.entries(fields ?? {})) {
    const col = map[k];
    if (!col) {
      continue;
    }
    if (col === "remote_etag_map" || col === "remote_filename_map") {
      sets.push(`${col} = ?`);
      params.push(JSON.stringify(v ?? {}));
    } else {
      sets.push(`${col} = ?`);
      params.push(v);
    }
  }

  // 累加字段单独处理
  if (typeof fields?.itemsPushed === "number") {
    sets.push("items_pushed = items_pushed + ?");
    params.push(fields.itemsPushed);
  }
  if (typeof fields?.itemsSkipped === "number") {
    sets.push("items_skipped = items_skipped + ?");
    params.push(fields.itemsSkipped);
  }
  if (typeof fields?.itemsDeleted === "number") {
    sets.push("items_deleted = items_deleted + ?");
    params.push(fields.itemsDeleted);
  }

  if (sets.length === 1) {
    // 只有 updated_at — 没必要写
    return;
  }

  params.push(providerId, accountKey);
  dbManager.run(
    `UPDATE sync_external_provider_cursor SET ${sets.join(", ")}
     WHERE provider_id = ? AND account_key = ?`,
    params,
  );
}

/**
 * 单条 etag/filename map 增量更新。每次推送一个 item 后调用。
 */
function recordPushedItem(
  dbManager,
  providerId,
  itemId,
  etag,
  remoteFilename,
  accountKey = DEFAULT_ACCOUNT_KEY,
) {
  const cursor = ensureCursor(dbManager, providerId, accountKey);
  const etagMap = { ...(cursor?.remoteEtagMap ?? {}) };
  const filenameMap = { ...(cursor?.remoteFilenameMap ?? {}) };
  if (etag) {
    etagMap[itemId] = etag;
  }
  if (remoteFilename) {
    filenameMap[itemId] = remoteFilename;
  }
  dbManager.run(
    `UPDATE sync_external_provider_cursor
       SET remote_etag_map = ?, remote_filename_map = ?, updated_at = ?
       WHERE provider_id = ? AND account_key = ?`,
    [
      JSON.stringify(etagMap),
      JSON.stringify(filenameMap),
      _now(),
      providerId,
      accountKey,
    ],
  );
}

/**
 * 列 tombstone — sync engine 取来批量执行远端 DELETE。
 * 排序 by deleted_at ASC（旧的先删），retry_count 限流由调用方处理。
 */
function listTombstones(
  dbManager,
  providerId,
  accountKey = DEFAULT_ACCOUNT_KEY,
  limit = 200,
) {
  if (!dbManager?.db) {
    return [];
  }
  const safeLimit = Math.max(
    1,
    Math.min(1000, Math.floor(Number(limit) || 200)),
  );
  return dbManager.all(
    `SELECT * FROM sync_external_tombstones
     WHERE provider_id = ? AND account_key = ?
     ORDER BY deleted_at ASC
     LIMIT ${safeLimit}`,
    [providerId, accountKey],
  );
}

function deleteTombstone(dbManager, id) {
  dbManager.run(`DELETE FROM sync_external_tombstones WHERE id = ?`, [id]);
}

function markTombstoneFailed(dbManager, id, error) {
  dbManager.run(
    `UPDATE sync_external_tombstones
     SET retry_count = retry_count + 1, last_error = ?
     WHERE id = ?`,
    [String(error ?? "").slice(0, 500), id],
  );
}

/** 推送成功后从 etag/filename map 移除（item 被远端删了或 rename 了旧文件名）。 */
function removeFromMaps(
  dbManager,
  providerId,
  itemId,
  accountKey = DEFAULT_ACCOUNT_KEY,
) {
  const cursor = getCursor(dbManager, providerId, accountKey);
  if (!cursor) {
    return;
  }
  const etagMap = { ...cursor.remoteEtagMap };
  const filenameMap = { ...cursor.remoteFilenameMap };
  delete etagMap[itemId];
  delete filenameMap[itemId];
  dbManager.run(
    `UPDATE sync_external_provider_cursor
       SET remote_etag_map = ?, remote_filename_map = ?, updated_at = ?
       WHERE provider_id = ? AND account_key = ?`,
    [
      JSON.stringify(etagMap),
      JSON.stringify(filenameMap),
      _now(),
      providerId,
      accountKey,
    ],
  );
}

/** 测试 / 重置工具：清空一个 provider 的状态（不动 knowledge_items）。 */
function resetCursor(dbManager, providerId, accountKey = DEFAULT_ACCOUNT_KEY) {
  dbManager.run(
    `DELETE FROM sync_external_provider_cursor
     WHERE provider_id = ? AND account_key = ?`,
    [providerId, accountKey],
  );
  dbManager.run(
    `DELETE FROM sync_external_tombstones
     WHERE provider_id = ? AND account_key = ?`,
    [providerId, accountKey],
  );
}

module.exports = {
  DEFAULT_ACCOUNT_KEY,
  getCursor,
  ensureCursor,
  updateCursor,
  recordPushedItem,
  listTombstones,
  deleteTombstone,
  markTombstoneFailed,
  removeFromMaps,
  resetCursor,
};
