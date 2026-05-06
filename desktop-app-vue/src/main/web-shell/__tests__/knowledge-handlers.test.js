/**
 * knowledge.* WS handler 单元测试 — Phase 3c.6 web-shell parity
 *
 * Handler 直接 delegate 到 database.addKnowledgeItem(item)，所以 mock 一个
 * fake DatabaseManager 就够了。RAG 索引同步是 best-effort，单测里覆盖
 * "没有 ragManager"、"ragManager 抛错"、"ragManager 成功" 三种路径。
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  createKnowledgeHandlers,
  createKnowledgeAddItemHandler,
} = require("../handlers/knowledge-handlers");

function makeDb({ throwOnAdd = false } = {}) {
  return {
    addKnowledgeItem: vi.fn((item) => {
      if (throwOnAdd) {
        throw new Error("constraint failed");
      }
      return { id: "uuid-1", ...item };
    }),
  };
}

// ── factory ─────────────────────────────────────────────────────

describe("knowledge-handlers · factory", () => {
  it("returns the knowledge.add-item topic", () => {
    const handlers = createKnowledgeHandlers({ database: makeDb() });
    expect(Object.keys(handlers)).toEqual(["knowledge.add-item"]);
  });

  it("works with no args (database defaults to null)", () => {
    const handlers = createKnowledgeHandlers();
    expect(typeof handlers["knowledge.add-item"]).toBe("function");
  });
});

// ── knowledge.add-item ──────────────────────────────────────────

describe("knowledge.add-item", () => {
  it("delegates to database.addKnowledgeItem and returns the new item", async () => {
    const db = makeDb();
    const handler = createKnowledgeAddItemHandler({ database: db });
    const result = await handler({
      item: {
        title: "Clip",
        content: "hello",
        tags: ["a", "b"],
      },
    });
    expect(result).toEqual({
      success: true,
      item: {
        id: "uuid-1",
        title: "Clip",
        content: "hello",
        tags: ["a", "b"],
        type: "note",
      },
    });
    expect(db.addKnowledgeItem).toHaveBeenCalledWith({
      title: "Clip",
      type: "note",
      content: "hello",
      tags: ["a", "b"],
    });
  });

  it("accepts a flat frame as item (no .item wrapper) for ergonomics", async () => {
    const db = makeDb();
    const handler = createKnowledgeAddItemHandler({ database: db });
    const result = await handler({
      title: "Flat",
      content: "x",
    });
    expect(result.success).toBe(true);
    expect(result.item.title).toBe("Flat");
  });

  it("defaults type to 'note' and tags to []", async () => {
    const db = makeDb();
    const handler = createKnowledgeAddItemHandler({ database: db });
    await handler({ item: { title: "t", content: "c" } });
    expect(db.addKnowledgeItem).toHaveBeenCalledWith({
      title: "t",
      type: "note",
      content: "c",
      tags: [],
    });
  });

  it("returns 数据库未初始化 when database is null", async () => {
    const handler = createKnowledgeAddItemHandler({ database: null });
    const result = await handler({ item: { title: "t", content: "c" } });
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });

  it("returns 缺少 title when title is empty", async () => {
    const handler = createKnowledgeAddItemHandler({ database: makeDb() });
    const result = await handler({ item: { title: "  ", content: "c" } });
    expect(result).toEqual({ success: false, error: "缺少 title" });
  });

  it("returns 缺少 content when content is not a string", async () => {
    const handler = createKnowledgeAddItemHandler({ database: makeDb() });
    const result = await handler({ item: { title: "t", content: 42 } });
    expect(result).toEqual({ success: false, error: "缺少 content" });
  });

  it("returns 缺少 item when frame has no item-shaped fields", async () => {
    const handler = createKnowledgeAddItemHandler({ database: makeDb() });
    const result = await handler(null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/缺少/);
  });

  it("captures database errors into envelope", async () => {
    const handler = createKnowledgeAddItemHandler({
      database: makeDb({ throwOnAdd: true }),
    });
    const result = await handler({ item: { title: "t", content: "c" } });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/constraint failed/);
  });

  it("calls ragManager.addToIndex on success when provided", async () => {
    const db = makeDb();
    const ragManager = { addToIndex: vi.fn().mockResolvedValue(true) };
    const handler = createKnowledgeAddItemHandler({ database: db, ragManager });
    await handler({ item: { title: "t", content: "c" } });
    expect(ragManager.addToIndex).toHaveBeenCalled();
  });

  it("swallows ragManager errors (best-effort) and still returns success", async () => {
    const db = makeDb();
    const ragManager = {
      addToIndex: vi.fn().mockRejectedValue(new Error("rag down")),
    };
    const handler = createKnowledgeAddItemHandler({ database: db, ragManager });
    const result = await handler({ item: { title: "t", content: "c" } });
    expect(result.success).toBe(true);
    expect(result.item).not.toBeNull();
  });
});
