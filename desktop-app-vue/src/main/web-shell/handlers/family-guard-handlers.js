/**
 * `family-guard.*` WS handlers — FAMILY-26 web-shell / V6 shell parity。
 *
 * 暴露 3 个只读 topic 给 web-panel（家长端家庭守护仪表板）：
 *   family-guard.list-children      → listChildren(db)
 *   family-guard.list-child-events  → listChildEvents(db, {childDid, sinceMs, limit})
 *   family-guard.app-usage-summary  → summarizeAppUsage(db, {childDid, sinceMs})
 *
 * 复用 desktop renderer IPC 同一查询层 [../../family-guard/child-event-query]，
 * 共用 main 已开的 db handle（同 sync-status-handlers 的 in-process 理由：避免
 * spawn cc 子进程再开 better-sqlite3 致 Windows WAL 独占失败）。
 *
 * 仅在 desktop web-shell (Gateway 1) 注册——family_child_event 是 desktop DB 专属
 * 镜像表，CLI standalone (`cc ui`) 无此数据，故不进 CLI message-dispatcher（同
 * ukey.status / sync.* 等 desktop-only handler 先例）。
 *
 * database 可能为 null（pre-bootstrap）— 各 handler 返回空结果而非抛，避免
 * ws-cli-loader dispatcher 被 trip。
 */

const query = require("../../family-guard/child-event-query");

function createFamilyGuardHandlers({ database } = {}) {
  return {
    "family-guard.list-children": async () => {
      if (!database) {
        return { success: true, data: [] };
      }
      try {
        return { success: true, data: query.listChildren(database) };
      } catch (err) {
        return { success: false, error: err?.message || String(err) };
      }
    },

    "family-guard.list-child-events": async (frame = {}) => {
      if (!database) {
        return { success: true, data: [] };
      }
      try {
        return {
          success: true,
          data: query.listChildEvents(database, frame || {}),
        };
      } catch (err) {
        return { success: false, error: err?.message || String(err) };
      }
    },

    "family-guard.app-usage-summary": async (frame = {}) => {
      if (!database) {
        return { success: true, data: { totalMs: 0, apps: [] } };
      }
      try {
        return {
          success: true,
          data: query.summarizeAppUsage(database, frame || {}),
        };
      } catch (err) {
        return { success: false, error: err?.message || String(err) };
      }
    },
  };
}

module.exports = { createFamilyGuardHandlers };
