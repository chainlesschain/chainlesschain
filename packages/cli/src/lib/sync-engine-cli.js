/**
 * CLI sync engine — Phase 3c follow-up Phase 2.
 *
 * Provider-agnostic sync engine consolidating the desktop-side
 * sync-external-store + incremental-walker + markdown-renderer + engine
 * into ONE focused CLI module. The CLI vault has only KNOWLEDGE_ITEM
 * tombstones (no mobile sync ResourceTypes) so we drop the filter
 * parameter and simplify.
 *
 * Flow (mirror desktop runWebDAVSync / runOSSSync):
 *   1. ensureCursor
 *   2. drain tombstones (delete then deleteFile on remote)
 *   3. push loop: fetchBatch → putFile → recordPushed → advance cursor
 *   4. update final cursor state
 */

"use strict";

const PROGRESS_FLUSH_EVERY = 5;
const PROGRESS_FLUSH_MS = 500;

// ── markdown renderer (deterministic; mirror desktop) ──────────────

function _cleanTitle(title) {
  // Note: place `-` AT END of char-class — putting it mid-class triggers
  // JS "invalid range" silent fallthrough and space stops matching.
  return (
    String(title || "untitled")
      .replace(/[\\/:*?"<>|\s-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 80) || "untitled"
  );
}

function generateFilename(item) {
  return `${item.id}-${_cleanTitle(item.title)}.md`;
}

function generateMarkdown(item) {
  const tags = item.tags ? String(item.tags) : "";
  // Conditionally include the tags line via a spread — a previous
  // `.filter(Boolean)` here dropped the empty tags entry but ALSO ate the
  // intended trailing "" newline, so the closing `---` was glued directly
  // onto the body ("---body") producing malformed YAML front matter.
  const frontMatter = [
    "---",
    `id: ${item.id}`,
    `title: ${JSON.stringify(item.title || "untitled")}`,
    `type: ${item.type || "note"}`,
    `created_at: ${item.created_at}`,
    `updated_at: ${item.updated_at}`,
    ...(tags ? [`tags: ${tags}`] : []),
    "---",
    "",
  ].join("\n");
  return frontMatter + (item.content || "") + "\n";
}

// ── store: cursor + tombstone CRUD ─────────────────────────────────

function _parseJsonField(v, fallback) {
  if (v == null || v === "") return fallback;
  try {
    return JSON.parse(v);
  } catch (_e) {
    return fallback;
  }
}

function getCursor(dbManager, providerId, accountKey = "") {
  const row = dbManager.get(
    `SELECT * FROM sync_external_provider_cursor
     WHERE provider_id = ? AND account_key = ?`,
    [providerId, accountKey],
  );
  if (!row) return undefined;
  return {
    providerId: row.provider_id,
    accountKey: row.account_key,
    lastSyncAt: row.last_sync_at,
    lastItemId: row.last_item_id,
    remoteEtagMap: _parseJsonField(row.remote_etag_map, {}),
    remoteFilenameMap: _parseJsonField(row.remote_filename_map, {}),
    lastRunStatus: row.last_run_status,
    lastRunError: row.last_run_error,
    lastRunDurationMs: row.last_run_duration_ms,
    itemsPushed: row.items_pushed,
    itemsSkipped: row.items_skipped,
    itemsDeleted: row.items_deleted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureCursor(dbManager, providerId, accountKey = "") {
  const existing = getCursor(dbManager, providerId, accountKey);
  if (existing) return existing;
  dbManager.run(
    `INSERT OR IGNORE INTO sync_external_provider_cursor
     (provider_id, account_key) VALUES (?, ?)`,
    [providerId, accountKey],
  );
  return getCursor(dbManager, providerId, accountKey);
}

function updateCursor(dbManager, providerId, patch, accountKey = "") {
  if (!patch || typeof patch !== "object") return;
  const fields = [];
  const params = [];
  const map = {
    lastSyncAt: "last_sync_at",
    lastItemId: "last_item_id",
    lastRunStatus: "last_run_status",
    lastRunError: "last_run_error",
    lastRunDurationMs: "last_run_duration_ms",
    itemsPushed: "items_pushed",
    itemsSkipped: "items_skipped",
    itemsDeleted: "items_deleted",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      fields.push(`${col} = ?`);
      params.push(patch[k]);
    }
  }
  if ("remoteEtagMap" in patch) {
    fields.push("remote_etag_map = ?");
    params.push(JSON.stringify(patch.remoteEtagMap));
  }
  if ("remoteFilenameMap" in patch) {
    fields.push("remote_filename_map = ?");
    params.push(JSON.stringify(patch.remoteFilenameMap));
  }
  fields.push("updated_at = ?");
  params.push(Date.now());
  params.push(providerId, accountKey);
  dbManager.run(
    `UPDATE sync_external_provider_cursor SET ${fields.join(", ")}
     WHERE provider_id = ? AND account_key = ?`,
    params,
  );
}

function recordPushedItem(
  dbManager,
  providerId,
  itemId,
  etag,
  filename,
  accountKey = "",
) {
  const cursor = getCursor(dbManager, providerId, accountKey) || {
    remoteEtagMap: {},
    remoteFilenameMap: {},
  };
  const etagMap = { ...cursor.remoteEtagMap, [itemId]: etag };
  const fnMap = { ...cursor.remoteFilenameMap, [itemId]: filename };
  dbManager.run(
    `UPDATE sync_external_provider_cursor
     SET remote_etag_map = ?, remote_filename_map = ?, updated_at = ?
     WHERE provider_id = ? AND account_key = ?`,
    [
      JSON.stringify(etagMap),
      JSON.stringify(fnMap),
      Date.now(),
      providerId,
      accountKey,
    ],
  );
}

function removeFromMaps(dbManager, providerId, itemId, accountKey = "") {
  const cursor = getCursor(dbManager, providerId, accountKey);
  if (!cursor) return;
  const etagMap = { ...cursor.remoteEtagMap };
  const fnMap = { ...cursor.remoteFilenameMap };
  delete etagMap[itemId];
  delete fnMap[itemId];
  dbManager.run(
    `UPDATE sync_external_provider_cursor
     SET remote_etag_map = ?, remote_filename_map = ?, updated_at = ?
     WHERE provider_id = ? AND account_key = ?`,
    [
      JSON.stringify(etagMap),
      JSON.stringify(fnMap),
      Date.now(),
      providerId,
      accountKey,
    ],
  );
}

function listTombstones(dbManager, providerId, accountKey = "", limit = 1000) {
  return dbManager.all(
    `SELECT * FROM sync_external_tombstones
     WHERE provider_id = ? AND account_key = ?
       AND resource_type = 'KNOWLEDGE_ITEM'
     ORDER BY deleted_at ASC LIMIT ?`,
    [providerId, accountKey, limit],
  );
}

function deleteTombstone(dbManager, id) {
  dbManager.run(`DELETE FROM sync_external_tombstones WHERE id = ?`, [id]);
}

function markTombstoneFailed(dbManager, id, errMsg) {
  dbManager.run(
    `UPDATE sync_external_tombstones
     SET retry_count = retry_count + 1, last_error = ?
     WHERE id = ?`,
    [String(errMsg || "").slice(0, 500), id],
  );
}

// ── walker: incremental batch fetching ─────────────────────────────

function fetchBatch(dbManager, cursor, batchSize = 200) {
  const after = cursor?.lastSyncAt || 0;
  const afterId = cursor?.lastItemId || "";
  return dbManager.all(
    `SELECT id, title, type, content, tags, created_at, updated_at
     FROM knowledge_items
     WHERE updated_at > ? OR (updated_at = ? AND id > ?)
     ORDER BY updated_at ASC, id ASC
     LIMIT ?`,
    [after, after, afterId, batchSize],
  );
}

function cursorAfterItem(item) {
  return { lastSyncAt: item.updated_at, lastItemId: item.id };
}

function countPending(dbManager, cursor) {
  const after = cursor?.lastSyncAt || 0;
  const afterId = cursor?.lastItemId || "";
  const row = dbManager.get(
    `SELECT COUNT(*) AS c FROM knowledge_items
     WHERE updated_at > ? OR (updated_at = ? AND id > ?)`,
    [after, after, afterId],
  );
  return row?.c || 0;
}

// ── engine: orchestration ──────────────────────────────────────────

async function runSync(deps) {
  const { dbManager, client, providerId, accountKey = "", onProgress } = deps;

  const t0 = Date.now();
  let pushed = 0;
  let skipped = 0;
  let deleted = 0;
  let lastError = null;
  let lastFlushPushed = 0;
  let lastFlushDeleted = 0;
  let lastFlushAt = Date.now();
  let totalPending = 0;

  function maybeFlush(phase) {
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

  function refresh() {
    return getCursor(dbManager, providerId, accountKey) || {};
  }

  let cursor = ensureCursor(dbManager, providerId, accountKey);
  totalPending =
    countPending(dbManager, cursor) +
    listTombstones(dbManager, providerId, accountKey, 1000).length;
  onProgress?.({
    phase: "start",
    pushed: 0,
    skipped: 0,
    deleted: 0,
    totalPending,
  });

  // Drain tombstones
  const tombs = listTombstones(dbManager, providerId, accountKey, 1000);
  for (const t of tombs) {
    const fn = cursor.remoteFilenameMap?.[t.item_id];
    if (!fn) {
      deleteTombstone(dbManager, t.id);
      continue;
    }
    const etag = cursor.remoteEtagMap?.[t.item_id] || null;
    let res;
    try {
      res = await client.deleteFile(fn, etag);
    } catch (err) {
      markTombstoneFailed(dbManager, t.id, err?.message || String(err));
      lastError = err?.message || String(err);
      continue;
    }
    if (res.ok) {
      deleteTombstone(dbManager, t.id);
      removeFromMaps(dbManager, providerId, t.item_id, accountKey);
      deleted++;
      cursor = refresh();
      maybeFlush("delete");
    } else if (res.conflict) {
      markTombstoneFailed(dbManager, t.id, "etag mismatch");
      skipped++;
    } else {
      markTombstoneFailed(dbManager, t.id, res.error || "unknown");
      lastError = res.error || lastError;
    }
  }

  // Push loop
  pushLoop: while (true) {
    const batch = fetchBatch(dbManager, cursor, 200);
    if (batch.length === 0) break;
    for (const item of batch) {
      const filename = generateFilename(item);
      const content = generateMarkdown(item);
      const etag = cursor.remoteEtagMap?.[item.id] || null;
      let res;
      try {
        res = await client.putFile(filename, content, etag);
      } catch (err) {
        lastError = err?.message || String(err);
        break pushLoop;
      }
      if (res.ok) {
        recordPushedItem(
          dbManager,
          providerId,
          item.id,
          res.etag,
          filename,
          accountKey,
        );
        updateCursor(dbManager, providerId, cursorAfterItem(item), accountKey);
        cursor = refresh();
        pushed++;
        maybeFlush("push");
      } else if (res.conflict) {
        skipped++;
        updateCursor(dbManager, providerId, cursorAfterItem(item), accountKey);
        cursor = refresh();
      } else {
        lastError = res.error || `status ${res.status}`;
        break pushLoop;
      }
    }
  }

  const durationMs = Date.now() - t0;
  const status = lastError ? "failed" : skipped > 0 ? "conflict" : "success";
  updateCursor(
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
  onProgress?.({ phase: status, pushed, skipped, deleted, totalPending });

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

export {
  runSync,
  generateFilename,
  generateMarkdown,
  getCursor,
  ensureCursor,
  updateCursor,
  recordPushedItem,
  removeFromMaps,
  listTombstones,
  deleteTombstone,
  markTombstoneFailed,
  fetchBatch,
  cursorAfterItem,
  countPending,
  PROGRESS_FLUSH_EVERY,
  PROGRESS_FLUSH_MS,
};
