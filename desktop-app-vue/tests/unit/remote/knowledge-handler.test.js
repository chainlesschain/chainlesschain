/**
 * KnowledgeHandler 单元测试
 */

import { vi } from 'vitest';
const KnowledgeHandler = require("../../../src/main/remote/handlers/knowledge-handler");

describe("KnowledgeHandler", () => {
  let handler;
  let mockDatabase;
  let mockRagManager;

  beforeEach(() => {
    // Mock Database
    mockDatabase = {
      run: vi.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
    };

    // Mock RAG Manager
    mockRagManager = {
      indexDocument: vi.fn().mockResolvedValue(true),
    };

    handler = new KnowledgeHandler(mockDatabase, mockRagManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createNote", () => {
    it("应该成功创建笔记", async () => {
      const params = {
        title: "测试笔记",
        content: "这是测试内容",
        tags: ["test", "demo"],
      };

      const context = {
        did: "did:example:123",
      };

      mockDatabase.run.mockResolvedValue({ lastID: 42 });

      const result = await handler.createNote(params, context);

      expect(result).toEqual({
        noteId: 42,
        title: "测试笔记",
        message: "Note created successfully",
      });

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO notes"),
        expect.arrayContaining([
          "测试笔记",
          "这是测试内容",
          JSON.stringify(["test", "demo"]),
          "did:example:123",
          expect.any(Number),
          expect.any(Number),
        ]),
      );
    });

    it("缺少标题时应该抛出错误", async () => {
      const params = {
        content: "内容",
      };

      const context = { did: "did:example:123" };

      await expect(handler.createNote(params, context)).rejects.toThrow(
        "Title and content are required",
      );
    });

    it("缺少内容时应该抛出错误", async () => {
      const params = {
        title: "标题",
      };

      const context = { did: "did:example:123" };

      await expect(handler.createNote(params, context)).rejects.toThrow(
        "Title and content are required",
      );
    });
  });

  describe("searchNotes", () => {
    it("应该成功搜索笔记", async () => {
      const params = {
        query: "测试",
        limit: 10,
      };

      const context = {};

      const mockNotes = [
        { id: 1, title: "测试笔记1", content: "内容1", tags: "[]" },
        { id: 2, title: "测试笔记2", content: "内容2", tags: "[]" },
      ];

      mockDatabase.all.mockResolvedValue(mockNotes);

      const result = await handler.searchNotes(params, context);

      expect(result).toEqual({
        results: mockNotes,
        total: 2,
      });

      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id, title, content, tags FROM notes"),
        ["%测试%", "%测试%", 10],
      );
    });

    it("缺少查询参数时应该抛出错误", async () => {
      const params = {};
      const context = {};

      await expect(handler.searchNotes(params, context)).rejects.toThrow(
        "Search query is required",
      );
    });
  });

  describe("getNoteById", () => {
    it("应该成功获取笔记", async () => {
      const params = { noteId: 1 };
      const context = {};

      const mockNote = {
        id: 1,
        title: "测试笔记",
        content: "内容",
        tags: '["test"]',
        created_by_did: "did:example:123",
      };

      mockDatabase.get.mockResolvedValue(mockNote);

      const result = await handler.getNoteById(params, context);

      expect(result).toEqual(mockNote);
      expect(mockDatabase.get).toHaveBeenCalledWith(
        "SELECT * FROM notes WHERE id = ?",
        [1],
      );
    });

    it("笔记不存在时应该抛出错误", async () => {
      const params = { noteId: 999 };
      const context = {};

      mockDatabase.get.mockResolvedValue(null);

      await expect(handler.getNoteById(params, context)).rejects.toThrow(
        "Note not found",
      );
    });
  });

  describe("updateNote", () => {
    it("应该成功更新笔记", async () => {
      const params = {
        noteId: 1,
        title: "更新的标题",
        content: "更新的内容",
        tags: ["updated"],
      };

      const context = {};

      const mockExisting = {
        id: 1,
        title: "旧标题",
        content: "旧内容",
        tags: "[]",
      };

      mockDatabase.get.mockResolvedValue(mockExisting);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handler.updateNote(params, context);

      expect(result).toEqual({
        noteId: 1,
        message: "Note updated successfully",
      });

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE notes SET"),
        expect.arrayContaining([
          "更新的标题",
          "更新的内容",
          JSON.stringify(["updated"]),
          expect.any(Number),
          1,
        ]),
      );
    });

    it("笔记不存在时应该抛出错误", async () => {
      const params = {
        noteId: 999,
        title: "标题",
        content: "内容",
      };

      const context = {};

      mockDatabase.get.mockResolvedValue(null);

      await expect(handler.updateNote(params, context)).rejects.toThrow(
        "Note not found",
      );
    });
  });

  describe("deleteNote", () => {
    it("应该成功删除笔记", async () => {
      const params = { noteId: 1 };
      const context = {};

      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handler.deleteNote(params, context);

      expect(result).toEqual({
        noteId: 1,
        message: "Note deleted successfully",
      });

      expect(mockDatabase.run).toHaveBeenCalledWith(
        "DELETE FROM notes WHERE id = ?",
        [1],
      );
    });

    it("笔记不存在时应该抛出错误", async () => {
      const params = { noteId: 999 };
      const context = {};

      mockDatabase.run.mockResolvedValue({ changes: 0 });

      await expect(handler.deleteNote(params, context)).rejects.toThrow(
        "Note not found",
      );
    });
  });

  describe("getTags", () => {
    it("应该成功获取所有标签", async () => {
      const params = {};
      const context = {};

      const mockRows = [
        { tags: '["tag1", "tag2"]' },
        { tags: '["tag2", "tag3"]' },
        { tags: '["tag1"]' },
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      const result = await handler.getTags(params, context);

      expect(result).toEqual({
        tags: ["tag1", "tag2", "tag3"],
        total: 3,
      });
    });

    it("没有标签时应该返回空数组", async () => {
      const params = {};
      const context = {};

      mockDatabase.all.mockResolvedValue([]);

      const result = await handler.getTags(params, context);

      expect(result).toEqual({
        tags: [],
        total: 0,
      });
    });
  });

  describe("getNotesByTag", () => {
    it("应该成功按标签获取笔记", async () => {
      const params = {
        tag: "test",
        limit: 50,
      };

      const context = {};

      const mockNotes = [
        { id: 1, title: "笔记1", content: "内容1", tags: '["test"]' },
      ];

      mockDatabase.all.mockResolvedValue(mockNotes);

      const result = await handler.getNotesByTag(params, context);

      expect(result).toEqual({
        results: mockNotes,
        total: 1,
        tag: "test",
      });
    });
  });

  describe("getFavorites", () => {
    it("应该成功获取收藏笔记", async () => {
      const params = { limit: 50 };
      const context = {};

      const mockNotes = [
        { id: 1, title: "收藏笔记", content: "内容", is_favorite: 1 },
      ];

      mockDatabase.all.mockResolvedValue(mockNotes);

      const result = await handler.getFavorites(params, context);

      expect(result).toEqual({
        results: mockNotes,
        total: 1,
      });
    });
  });

  describe("syncNote", () => {
    it("应该成功同步笔记到向量库", async () => {
      const params = {
        noteId: 1,
        vectorize: true,
      };

      const context = {};

      const mockNote = {
        id: 1,
        title: "测试笔记",
        content: "内容",
        tags: '["test"]',
        created_at: Date.now(),
      };

      mockDatabase.get.mockResolvedValue(mockNote);

      const result = await handler.syncNote(params, context);

      expect(result).toEqual({
        noteId: 1,
        message: "Note synced and vectorized",
        vectorized: true,
      });

      expect(mockRagManager.indexDocument).toHaveBeenCalledWith({
        id: 1,
        text: "测试笔记\n\n内容",
        metadata: {
          type: "note",
          tags: ["test"],
          created_at: expect.any(Number),
        },
      });
    });

    it("不向量化时应该只同步", async () => {
      const params = {
        noteId: 1,
        vectorize: false,
      };

      const context = {};

      const mockNote = { id: 1, title: "笔记", content: "内容", tags: "[]" };
      mockDatabase.get.mockResolvedValue(mockNote);

      const result = await handler.syncNote(params, context);

      expect(result).toEqual({
        noteId: 1,
        message: "Note synced",
        vectorized: false,
      });

      expect(mockRagManager.indexDocument).not.toHaveBeenCalled();
    });
  });

  describe("handle", () => {
    it("应该正确路由到 createNote", async () => {
      const params = { title: "标题", content: "内容" };
      const context = { did: "did:example:123" };

      mockDatabase.run.mockResolvedValue({ lastID: 1 });

      const result = await handler.handle("createNote", params, context);

      expect(result.message).toBe("Note created successfully");
    });

    it("未知动作应该抛出错误", async () => {
      const params = {};
      const context = {};

      await expect(
        handler.handle("unknownAction", params, context),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });
});
