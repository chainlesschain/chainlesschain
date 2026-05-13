/**
 * `project.*` WS handlers — #21 P3 (web-shell projects view in-process WS).
 *
 * 给 desktop web-shell 里的 `packages/web-panel/src/views/Projects.vue` 提供 6 个
 * in-process WS topics, 避免 ws.execute('cc project …') 子进程冷启 6-10s
 * (per memory `desktop_release_b4_surgery_lessons`)。
 *
 * 设计取舍:
 *   - DRY: 复用 #21 P1 落地的 ProjectManagementHandler (本就被 Android L3 REMOTE
 *     调用), 不重写 SQL。同份 handler 同时服务 mobile + web-shell, 满足 #21
 *     "目标在手机端做 AI 项目的交互要像在电脑端那样丝滑" 的双端一致性需求。
 *   - 状态: 6 actions read/write desktop DatabaseManager (database/database-projects.js),
 *     与 cc project CLI 写同一 chainlesschain.db, 桌面 V5/V6 UI / cc CLI /
 *     web-panel 三处看见同一份数据。
 *
 * Topics shipped:
 *   project.list        - list({ userId?, status?, limit?, offset? })
 *   project.show        - get({ id })
 *   project.init        - init({ name, description?, type?, userId?, rootPath? })
 *   project.delete      - delete({ id, hard? })
 *   project.listFiles   - listFiles({ projectId, limit?, offset? })
 *   project.getFile     - getFile({ fileId })
 *
 * `database` 可能为 null (pre-bootstrap) — 各 handler 返回结构化错误而不抛,
 * 避免 ws-cli-loader 把 dispatcher 给 trip 掉 (同 sync-status-handlers pattern)。
 */

const ProjectManagementHandler = require("../../remote/handlers/project-management-handler");

/**
 * @param {{ database: object | null, defaultUserId?: string }} [options]
 * @returns {Record<string, (msg: any) => Promise<any>>}
 */
function createProjectHandlers(options = {}) {
  const database = options.database || null;
  const defaultUserId = options.defaultUserId || "default";

  // Pre-bootstrap: database not ready → all topics return structured error.
  if (!database) {
    const unavailable = async () => {
      const e = new Error("Database not yet initialized");
      e.code = "DB_UNAVAILABLE";
      throw e;
    };
    return {
      "project.list": unavailable,
      "project.show": unavailable,
      "project.init": unavailable,
      "project.delete": unavailable,
      "project.listFiles": unavailable,
      "project.getFile": unavailable,
    };
  }

  const handler = new ProjectManagementHandler(database);

  // Wrap each action with a stable context object. handler.list / handler.init
  // both honor context.userId as fallback when params.userId missing.
  const ctx = { userId: defaultUserId };

  return {
    "project.list": async (msg = {}) => handler.list(msg, ctx),
    "project.show": async (msg = {}) => handler.get(msg, ctx),
    "project.init": async (msg = {}) => handler.init(msg, ctx),
    "project.delete": async (msg = {}) => handler.delete(msg, ctx),
    "project.listFiles": async (msg = {}) => handler.listFiles(msg, ctx),
    "project.getFile": async (msg = {}) => handler.getFile(msg, ctx),
  };
}

module.exports = { createProjectHandlers };
