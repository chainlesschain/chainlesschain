/**
 * WebDAV 同步业务编排（Phase 3c.2，task #5 上半段）
 *
 * 把 walker / store / client / renderer 串起来：单次 runWebDAVSync 流程
 *   ① ensureCursor                                  保证游标存在（trigger 才会 fan-out tombstone）
 *   ② drain tombstones — listTombstones 循环执行远端 DELETE
 *      ↳ ok → deleteTombstone + removeFromMaps + deleted++
 *      ↳ conflict (412) → markTombstoneFailed + skipped++
 *      ↳ error → markTombstoneFailed + 累计 lastError 但**继续**（不打断 push）
 *   ③ push 循环 — fetchBatch(cursor, 200) → 渲染 → putFile(If-Match etag)
 *      ↳ ok → recordPushedItem + cursorAfterItem 推进 + pushed++
 *      ↳ conflict (412) → skipped++ + 仍 advance cursor（避免每次 sync 重新冲突轰炸；
 *                          用户在 Settings 用「强制重推」按钮可手动 reset map）
 *      ↳ hard error → 不 advance cursor + return（下次 sync 从断点续）
 *   ④ updateCursor 写最终 status / duration / 累加计数
 *
 * 进度上报 (D9)：5 条 OR 500ms 节流；最终 finalize 事件不节流。
 *
 * 测试 / 注入：所有外部依赖通过 deps 参数传入 — engine 不直 require
 * dbManager / store / walker / renderer / client，方便 unit test 用 fake。
 */

const { logger } = require("../utils/logger.js");

const PROGRESS_FLUSH_EVERY = 5;
const PROGRESS_FLUSH_MS = 500;

/**
 * @param {Object} deps
 * @param {Object} deps.dbManager
 * @param {Object} deps.client                 — WebDAVClient instance
 * @param {Object} deps.store                  — sync-external-store module
 * @param {Object} deps.walker                 — incremental-walker module
 * @param {Object} deps.renderer               — markdown-renderer module
 * @param {string} [deps.providerId="webdav"]
 * @param {string} [deps.accountKey=""]
 * @param {function} [deps.onProgress]         — ({phase, pushed, skipped, deleted, totalPending}) => void
 * @returns {Promise<{success: boolean, pushed: number, skipped: number, deleted: number, durationMs: number, status: string, error?: string}>}
 */
async function runWebDAVSync(deps) {
  const {
    dbManager,
    client,
    store,
    walker,
    renderer,
    providerId = "webdav",
    accountKey = "",
    onProgress,
  } = deps;

  const t0 = Date.now();
  let pushed = 0;
  let skipped = 0;
  let deleted = 0;
  let lastError = null;

  // 节流状态
  let lastFlushPushed = 0;
  let lastFlushDeleted = 0;
  let lastFlushAt = Date.now();
  let totalPending = 0;

  function maybeFlushProgress(phase) {
    const now = Date.now();
    const delta = pushed - lastFlushPushed + (deleted - lastFlushDeleted);
    if (
      delta >= PROGRESS_FLUSH_EVERY ||
      now - lastFlushAt >= PROGRESS_FLUSH_MS
    ) {
      onProgress?.({ phase, pushed, skipped, deleted, totalPending });
      lastFlushPushed = pushed;
      lastFlushDeleted = deleted;
      lastFlushAt = now;
    }
  }

  function emitFinal(phase) {
    onProgress?.({ phase, pushed, skipped, deleted, totalPending });
  }

  function refreshCursor() {
    return store.getCursor(dbManager, providerId, accountKey) || {};
  }

  // ① ensure cursor 存在
  let cursor = store.ensureCursor(dbManager, providerId, accountKey);

  // 进度条总数（push pending + tombstones 数量）。Phase 3d 起 tombstones
  // 表会含其他 ResourceType（mobile sync 等），用 filter 只看 KNOWLEDGE_ITEM。
  totalPending =
    walker.countPending(dbManager, cursor) +
    store.listTombstones(dbManager, providerId, accountKey, 1000, [
      "KNOWLEDGE_ITEM",
    ]).length;

  onProgress?.({
    phase: "start",
    pushed: 0,
    skipped: 0,
    deleted: 0,
    totalPending,
  });

  // ② drain tombstones (filter to KNOWLEDGE_ITEM since Phase 3d adds 5
  // mobile-only ResourceTypes whose tombstones fan-out to webdav cursor too)
  const tombstones = store.listTombstones(
    dbManager,
    providerId,
    accountKey,
    1000,
    ["KNOWLEDGE_ITEM"],
  );
  for (const t of tombstones) {
    const filename = cursor.remoteFilenameMap?.[t.item_id];
    if (!filename) {
      // 没推过 → tombstone 自然消解，无需远端调用
      store.deleteTombstone(dbManager, t.id);
      continue;
    }
    const etag = cursor.remoteEtagMap?.[t.item_id] || null;
    let res;
    try {
      res = await client.deleteFile(filename, etag);
    } catch (err) {
      logger.error(`[webdav-engine] deleteFile 抛异常: ${err?.message}`);
      store.markTombstoneFailed(dbManager, t.id, err?.message || String(err));
      lastError = err?.message || String(err);
      continue;
    }
    if (res.ok) {
      store.deleteTombstone(dbManager, t.id);
      store.removeFromMaps(dbManager, providerId, t.item_id, accountKey);
      deleted++;
      cursor = refreshCursor();
      maybeFlushProgress("delete");
    } else if (res.conflict) {
      store.markTombstoneFailed(dbManager, t.id, "远端 etag 不匹配");
      skipped++;
    } else {
      store.markTombstoneFailed(dbManager, t.id, res.error || "未知错误");
      lastError = res.error || lastError;
    }
  }

  // ③ push 循环
  pushLoop: while (true) {
    const batch = walker.fetchBatch(dbManager, cursor, 200);
    if (batch.length === 0) {
      break;
    }

    for (const item of batch) {
      const filename = renderer.generateFilename(item);
      const content = renderer.generateMarkdown(item);
      const etag = cursor.remoteEtagMap?.[item.id] || null;

      let res;
      try {
        res = await client.putFile(filename, content, etag);
      } catch (err) {
        // 网络 / 退避耗尽 / 库内部异常 — 不 advance cursor，断点续
        logger.error(`[webdav-engine] putFile 抛异常: ${err?.message}`);
        lastError = err?.message || String(err);
        break pushLoop;
      }

      if (res.ok) {
        store.recordPushedItem(
          dbManager,
          providerId,
          item.id,
          res.etag,
          filename,
          accountKey,
        );
        store.updateCursor(
          dbManager,
          providerId,
          walker.cursorAfterItem(item),
          accountKey,
        );
        cursor = refreshCursor();
        pushed++;
        maybeFlushProgress("push");
      } else if (res.conflict) {
        // 12-Factor 推则进，避免循环（D7 决策）
        skipped++;
        store.updateCursor(
          dbManager,
          providerId,
          walker.cursorAfterItem(item),
          accountKey,
        );
        cursor = refreshCursor();
      } else {
        // 4xx 非 412：当前行硬错，停整轮 sync，下次重试
        lastError = res.error || `status ${res.status}`;
        break pushLoop;
      }
    }
  }

  // ④ 写最终状态
  const durationMs = Date.now() - t0;
  const status = lastError ? "failed" : skipped > 0 ? "conflict" : "success";
  store.updateCursor(
    dbManager,
    providerId,
    {
      lastRunStatus: status,
      lastRunError: lastError,
      lastRunDurationMs: durationMs,
      itemsPushed: pushed,
      itemsSkipped: skipped,
      itemsDeleted: deleted,
    },
    accountKey,
  );

  emitFinal(status);

  return {
    success: !lastError,
    status,
    pushed,
    skipped,
    deleted,
    durationMs,
    error: lastError || undefined,
  };
}

module.exports = {
  runWebDAVSync,
  PROGRESS_FLUSH_EVERY,
  PROGRESS_FLUSH_MS,
};
