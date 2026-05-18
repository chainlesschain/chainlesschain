/**
 * 增量游标驱动的 knowledge_items walker（Phase 3c.2）
 *
 * 给 WebDAV / OSS sync 用：按 (updated_at, id) 字典序，从 cursor 之后
 * 取一批待推送的 items。
 *
 * 与 markdown-exporter.exportAll() 的 9999 一次性查询不同：
 *   - 分批（默认 batch=200），避免大 KB 一次性吃内存
 *   - 严格 `(updated_at, id) > (lastSyncAt, lastItemId)` 字典序游标，
 *     即使一次同步中途失败也能从断点续推
 *   - 不在 walker 里做渲染 / 写盘 — 调用方决定怎么处理
 *
 * 注意：不直接读 dbManager.getKnowledgeItems(...)，因为其包装层有已知 bug
 * （`(limit = 100)` 赋值表达式覆盖入参，硬限 100），所以本 walker 直接
 * 走 dbManager.all 拿原始 SQL 结果。
 */

const DEFAULT_BATCH = 200;
const MAX_BATCH = 1000;

/**
 * 取 cursor 之后的下一批 items。
 *
 * @param {Object} dbManager — 暴露 .db / .all(sql, params)
 * @param {Object} cursor — { lastSyncAt: number, lastItemId: string|null }
 * @param {number} [batch] — 单批上限，默认 200，clamped 到 [1, 1000]
 * @returns {Array<Object>} knowledge_items 行，按 (updated_at ASC, id ASC) 排序
 */
function fetchBatch(dbManager, cursor, batch = DEFAULT_BATCH) {
  if (!dbManager?.db) {
    return [];
  }
  const limit = Math.max(
    1,
    Math.min(MAX_BATCH, Math.floor(Number(batch) || DEFAULT_BATCH)),
  );
  const sinceMs = Number(cursor?.lastSyncAt) || 0;
  const sinceId = cursor?.lastItemId ?? "";

  // 字典序游标：(updated_at, id) > (sinceMs, sinceId)
  // SQLite 不支持 row-value 比较的 <,> 在所有版本，分支写：
  const sql = `
    SELECT * FROM knowledge_items
    WHERE updated_at > ?
       OR (updated_at = ? AND id > ?)
    ORDER BY updated_at ASC, id ASC
    LIMIT ${limit}
  `;
  return dbManager.all(sql, [sinceMs, sinceMs, sinceId]);
}

/**
 * 计算游标推进位置（取本批最后一条的 (updated_at, id)）。
 * 调用方应在批内每条都成功推送后调用，作为"下次起点"。
 *
 * @param {Array<Object>} batch
 * @returns {{lastSyncAt: number, lastItemId: string} | null}
 *           batch 为空时返回 null（保持现 cursor 不动）
 */
function nextCursorFromBatch(batch) {
  if (!batch || batch.length === 0) {
    return null;
  }
  const last = batch[batch.length - 1];
  return {
    lastSyncAt: Number(last.updated_at) || 0,
    lastItemId: String(last.id ?? ""),
  };
}

/**
 * 取 batch 中相对前一个 cursor 的"游标推进点"per item — 失败重试时
 * 从最近一条成功的 item 之后重启。
 *
 * @param {Object} item
 * @returns {{lastSyncAt: number, lastItemId: string}}
 */
function cursorAfterItem(item) {
  return {
    lastSyncAt: Number(item.updated_at) || 0,
    lastItemId: String(item.id ?? ""),
  };
}

/**
 * 计本地 KB 中"待推送"item 总数（updated_at > sinceMs OR ...）。
 * 进度条用 — 调用方在 sync run 启动时调一次拿总数。
 */
function countPending(dbManager, cursor) {
  if (!dbManager?.db) {
    return 0;
  }
  const sinceMs = Number(cursor?.lastSyncAt) || 0;
  const sinceId = cursor?.lastItemId ?? "";
  const row = dbManager.get(
    `SELECT COUNT(*) AS c FROM knowledge_items
     WHERE updated_at > ? OR (updated_at = ? AND id > ?)`,
    [sinceMs, sinceMs, sinceId],
  );
  return row?.c ?? 0;
}

module.exports = {
  DEFAULT_BATCH,
  MAX_BATCH,
  fetchBatch,
  nextCursorFromBatch,
  cursorAfterItem,
  countPending,
};
