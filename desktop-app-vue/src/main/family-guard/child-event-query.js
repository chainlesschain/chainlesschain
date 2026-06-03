/**
 * FAMILY-26 家长端只读查询层 — 读 family_child_event 镜像表。
 *
 * 纯函数形式（接 dbManager 入参），不持有状态，便于 sql.js 单测。
 * family_child_event 由 mobile-bridge-sync._applyTelemetry 写入（Android child
 * 端上行的采集事件镜像）。
 *
 * @module family-guard/child-event-query
 */

/**
 * 从 foreground_app 事件的 payload JSON 抽 package 名；非 foreground_app /
 * 解析失败返 null（调用方归入"其他"）。payload shape: {"package":"...","duration_ms":...}
 */
function _parsePackage(source, payload) {
  if (source !== "foreground_app") {
    return null;
  }
  try {
    const parsed = JSON.parse(payload || "{}");
    return typeof parsed.package === "string" ? parsed.package : null;
  } catch {
    return null;
  }
}

/**
 * 列出有数据的孩子（供家长在仪表板顶部选孩子）。
 * @returns {Array<{childDid, eventCount, lastEventMs}>}
 */
function listChildren(dbManager) {
  const rows = dbManager.all(
    `SELECT child_did,
            COUNT(*) AS event_count,
            MAX(timestamp_ms) AS last_event_ms
     FROM family_child_event
     GROUP BY child_did
     ORDER BY last_event_ms DESC`,
  );
  return rows.map((r) => ({
    childDid: r.child_did,
    eventCount: Number(r.event_count) || 0,
    lastEventMs: Number(r.last_event_ms) || 0,
  }));
}

/**
 * 列出某孩子的最近事件（时间倒序）。
 * @param {{childDid:string, sinceMs?:number, limit?:number}} opts
 * @returns {Array<object>}
 */
function listChildEvents(
  dbManager,
  { childDid, sinceMs = 0, limit = 200 } = {},
) {
  if (!childDid) {
    return [];
  }
  const rows = dbManager.all(
    `SELECT resource_id, child_did, source, kind, payload,
            timestamp_ms, duration_ms, level, device_id
     FROM family_child_event
     WHERE child_did = ? AND timestamp_ms >= ?
     ORDER BY timestamp_ms DESC
     LIMIT ?`,
    [childDid, Number(sinceMs) || 0, Number(limit) || 200],
  );
  return rows.map((r) => ({
    resourceId: r.resource_id,
    childDid: r.child_did,
    source: r.source,
    kind: r.kind,
    payload: r.payload,
    package: _parsePackage(r.source, r.payload),
    timestampMs: Number(r.timestamp_ms) || 0,
    durationMs: Number(r.duration_ms) || 0,
    level: r.level,
    deviceId: r.device_id || "",
  }));
}

/**
 * 按 app 聚合某孩子的使用时长（前台 app 用 payload.package，其余归"其他"）。
 * @param {{childDid:string, sinceMs?:number}} opts
 * @returns {{totalMs:number, apps:Array<{package, totalMs, count}>}}
 */
function summarizeAppUsage(dbManager, { childDid, sinceMs = 0 } = {}) {
  if (!childDid) {
    return { totalMs: 0, apps: [] };
  }
  const rows = dbManager.all(
    `SELECT source, payload, duration_ms
     FROM family_child_event
     WHERE child_did = ? AND timestamp_ms >= ?`,
    [childDid, Number(sinceMs) || 0],
  );
  const byApp = new Map();
  let totalMs = 0;
  for (const r of rows) {
    const dur = Number(r.duration_ms) || 0;
    totalMs += dur;
    const key = _parsePackage(r.source, r.payload) || "(其他)";
    const cur = byApp.get(key) || { package: key, totalMs: 0, count: 0 };
    cur.totalMs += dur;
    cur.count += 1;
    byApp.set(key, cur);
  }
  const apps = Array.from(byApp.values()).sort((a, b) => b.totalMs - a.totalMs);
  return { totalMs, apps };
}

module.exports = { listChildren, listChildEvents, summarizeAppUsage };
