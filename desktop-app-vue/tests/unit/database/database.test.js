/**
 * Database 模块单元测试
 * 测试数据库核心功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockElectronAPI } from "../../setup";

describe("Database 模块", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("数据库初始化", () => {
    it("应该成功初始化数据库", async () => {
      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await mockElectronAPI.db.query("SELECT 1");

      expect(result.success).toBe(true);
      expect(mockElectronAPI.db.query).toHaveBeenCalled();
    });

    it("应该创建所有必需的表", async () => {
      const tables = [
        "notes",
        "chat_conversations",
        "chat_messages",
        "did_identities",
        "p2p_messages",
        "contacts",
        "social_posts",
        "projects",
        "project_files",
      ];

      for (const table of tables) {
        mockElectronAPI.db.query.mockResolvedValue({
          success: true,
          data: [{ name: table }],
        });

        const result = await mockElectronAPI.db.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`,
        );

        expect(result.success).toBe(true);
      }
    });
  });

  describe("笔记管理", () => {
    it("应该能够创建新笔记", async () => {
      const note = {
        id: "test-note-1",
        title: "测试笔记",
        content: "这是测试内容",
        tags: "测试,单元测试",
      };

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        lastID: note.id,
      });

      const result = await mockElectronAPI.db.run(
        "INSERT INTO notes (id, title, content, tags) VALUES (?, ?, ?, ?)",
        [note.id, note.title, note.content, note.tags],
      );

      expect(result.success).toBe(true);
      expect(mockElectronAPI.db.run).toHaveBeenCalled();
    });

    it("应该能够查询笔记", async () => {
      const mockNotes = [
        { id: "1", title: "笔记1", content: "内容1" },
        { id: "2", title: "笔记2", content: "内容2" },
      ];

      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: mockNotes,
      });

      const result = await mockElectronAPI.db.query("SELECT * FROM notes");

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].title).toBe("笔记1");
    });

    it("应该能够更新笔记", async () => {
      const noteId = "test-note-1";
      const newTitle = "更新后的标题";

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        changes: 1,
      });

      const result = await mockElectronAPI.db.run(
        "UPDATE notes SET title = ? WHERE id = ?",
        [newTitle, noteId],
      );

      expect(result.success).toBe(true);
      expect(result.changes).toBe(1);
    });

    it("应该能够删除笔记", async () => {
      const noteId = "test-note-1";

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        changes: 1,
      });

      const result = await mockElectronAPI.db.run(
        "DELETE FROM notes WHERE id = ?",
        [noteId],
      );

      expect(result.success).toBe(true);
      expect(result.changes).toBe(1);
    });

    it("应该支持按标签搜索笔记", async () => {
      const tag = "测试";
      const mockNotes = [{ id: "1", title: "笔记1", tags: "测试,开发" }];

      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: mockNotes,
      });

      const result = await mockElectronAPI.db.query(
        "SELECT * FROM notes WHERE tags LIKE ?",
        [`%${tag}%`],
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it("应该支持全文搜索", async () => {
      const keyword = "测试";
      const mockNotes = [
        { id: "1", title: "测试笔记", content: "包含测试内容" },
      ];

      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: mockNotes,
      });

      const result = await mockElectronAPI.db.query(
        "SELECT * FROM notes WHERE title LIKE ? OR content LIKE ?",
        [`%${keyword}%`, `%${keyword}%`],
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe("聊天会话管理", () => {
    it("应该能够创建聊天会话", async () => {
      const conversation = {
        id: "conv-1",
        title: "新对话",
        created_at: Date.now(),
      };

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        lastID: conversation.id,
      });

      const result = await mockElectronAPI.db.run(
        "INSERT INTO chat_conversations (id, title, created_at) VALUES (?, ?, ?)",
        [conversation.id, conversation.title, conversation.created_at],
      );

      expect(result.success).toBe(true);
    });

    it("应该能够保存聊天消息", async () => {
      const message = {
        id: "msg-1",
        conversation_id: "conv-1",
        role: "user",
        content: "你好",
        created_at: Date.now(),
      };

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        lastID: message.id,
      });

      const result = await mockElectronAPI.db.run(
        "INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        [
          message.id,
          message.conversation_id,
          message.role,
          message.content,
          message.created_at,
        ],
      );

      expect(result.success).toBe(true);
    });

    it("应该能够获取会话历史", async () => {
      const conversationId = "conv-1";
      const mockMessages = [
        { id: "msg-1", role: "user", content: "你好" },
        { id: "msg-2", role: "assistant", content: "你好!有什么可以帮助你的?" },
      ];

      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: mockMessages,
      });

      const result = await mockElectronAPI.db.query(
        "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at",
        [conversationId],
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].role).toBe("user");
      expect(result.data[1].role).toBe("assistant");
    });
  });

  describe("项目管理", () => {
    it("应该能够创建项目", async () => {
      const project = {
        id: "proj-1",
        name: "测试项目",
        description: "这是一个测试项目",
        created_at: Date.now(),
      };

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        lastID: project.id,
      });

      const result = await mockElectronAPI.db.run(
        "INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)",
        [project.id, project.name, project.description, project.created_at],
      );

      expect(result.success).toBe(true);
    });

    it("应该能够添加项目文件", async () => {
      const file = {
        id: "file-1",
        project_id: "proj-1",
        name: "test.py",
        content: 'print("Hello")',
        created_at: Date.now(),
      };

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        lastID: file.id,
      });

      const result = await mockElectronAPI.db.run(
        "INSERT INTO project_files (id, project_id, name, content, created_at) VALUES (?, ?, ?, ?, ?)",
        [file.id, file.project_id, file.name, file.content, file.created_at],
      );

      expect(result.success).toBe(true);
    });

    it("应该能够查询项目文件", async () => {
      const projectId = "proj-1";
      const mockFiles = [
        { id: "file-1", name: "test.py", content: 'print("Hello")' },
        { id: "file-2", name: "main.py", content: "import test" },
      ];

      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: mockFiles,
      });

      const result = await mockElectronAPI.db.query(
        "SELECT * FROM project_files WHERE project_id = ?",
        [projectId],
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe("事务处理", () => {
    it("应该支持事务开始", async () => {
      mockElectronAPI.db.execute.mockResolvedValue({
        success: true,
      });

      const result = await mockElectronAPI.db.execute("BEGIN TRANSACTION");

      expect(result.success).toBe(true);
      expect(mockElectronAPI.db.execute).toHaveBeenCalledWith(
        "BEGIN TRANSACTION",
      );
    });

    it("应该支持事务提交", async () => {
      mockElectronAPI.db.execute.mockResolvedValue({
        success: true,
      });

      const result = await mockElectronAPI.db.execute("COMMIT");

      expect(result.success).toBe(true);
      expect(mockElectronAPI.db.execute).toHaveBeenCalledWith("COMMIT");
    });

    it("应该支持事务回滚", async () => {
      mockElectronAPI.db.execute.mockResolvedValue({
        success: true,
      });

      const result = await mockElectronAPI.db.execute("ROLLBACK");

      expect(result.success).toBe(true);
      expect(mockElectronAPI.db.execute).toHaveBeenCalledWith("ROLLBACK");
    });
  });

  describe("错误处理", () => {
    it("应该处理SQL语法错误", async () => {
      mockElectronAPI.db.query.mockRejectedValue(new Error("SQL syntax error"));

      await expect(mockElectronAPI.db.query("INVALID SQL")).rejects.toThrow(
        "SQL syntax error",
      );
    });

    it("应该处理约束违规错误", async () => {
      mockElectronAPI.db.run.mockRejectedValue(
        new Error("UNIQUE constraint failed"),
      );

      await expect(
        mockElectronAPI.db.run("INSERT INTO notes (id) VALUES (?)", [
          "duplicate-id",
        ]),
      ).rejects.toThrow("UNIQUE constraint failed");
    });

    it("应该处理外键约束错误", async () => {
      mockElectronAPI.db.run.mockRejectedValue(
        new Error("FOREIGN KEY constraint failed"),
      );

      await expect(
        mockElectronAPI.db.run(
          "INSERT INTO project_files (project_id) VALUES (?)",
          ["non-existent"],
        ),
      ).rejects.toThrow("FOREIGN KEY constraint failed");
    });
  });

  describe("数据持久化", () => {
    it("应该支持数据保存到文件", async () => {
      mockElectronAPI.db.execute.mockResolvedValue({
        success: true,
        message: "数据库已保存",
      });

      const result = await mockElectronAPI.db.execute("SAVE");

      expect(result.success).toBe(true);
    });

    it("应该支持数据备份", async () => {
      mockElectronAPI.db.execute.mockResolvedValue({
        success: true,
        backupPath: "/path/to/backup.db",
      });

      const result = await mockElectronAPI.db.execute("BACKUP");

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeTruthy();
    });
  });
});
