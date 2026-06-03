/**
 * `knowledge.*` WS handlers — Phase 3c.6 web-shell parity (2026-05-06).
 *
 * 暴露 1 个 topic 给 web-panel，对齐 V5/V6 桌面壳 `db:add-knowledge-item`：
 *   knowledge.add-item       → database.addKnowledgeItem({title,type,content,tags})
 *
 * 用途：剪贴板导入 / 截图识别 / 任意"快速保存到知识库"路径。Notes.vue 的
 *   常规 CRUD 走 `note add` CLI（没有锁冲突，因为 cli 子进程 spawn 后立即
 *   退出），但剪贴板导入在 V5/V6 直接调 IPC 写主进程 db，所以 web-shell
 *   也走同样的 in-process 写法（避免 spawn 子进程争 SQLite 锁）。
 *
 * RAG 同步：与 desktop IPC 不同，本 handler 暂不接 ragManager.addToIndex —
 *   web-shell 在 Phase 3c.6 不需要立即索引，knowledge.add-item 只负责 row
 *   写入。如果将来 web-panel 需要同步索引，从 options.ragManager 注入。
 *
 * database / item 结构：
 *   item.title    string  必需
 *   item.content  string  必需
 *   item.type     string  默认 "note"
 *   item.tags     array   可选
 */

function createKnowledgeAddItemHandler({ database, ragManager } = {}) {
  return async function knowledgeAddItemHandler(frame = {}) {
    if (!database || typeof database.addKnowledgeItem !== "function") {
      return { success: false, error: "数据库未初始化" };
    }
    const item = frame?.item ?? frame;
    if (!item || typeof item !== "object") {
      return { success: false, error: "缺少 item" };
    }
    if (typeof item.title !== "string" || !item.title.trim()) {
      return { success: false, error: "缺少 title" };
    }
    if (typeof item.content !== "string") {
      return { success: false, error: "缺少 content" };
    }
    try {
      const newItem = database.addKnowledgeItem({
        title: item.title,
        type: item.type || "note",
        content: item.content,
        tags: Array.isArray(item.tags) ? item.tags : [],
      });
      if (
        newItem &&
        ragManager &&
        typeof ragManager.addToIndex === "function"
      ) {
        try {
          await ragManager.addToIndex(newItem);
        } catch {
          /* index sync is best-effort; row is already persisted */
        }
      }
      return { success: true, item: newItem || null };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createKnowledgeHandlers({ database, ragManager } = {}) {
  return {
    "knowledge.add-item": createKnowledgeAddItemHandler({
      database,
      ragManager,
    }),
  };
}

module.exports = {
  createKnowledgeHandlers,
  createKnowledgeAddItemHandler,
};
