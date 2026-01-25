/**
 * SessionManager 单元测试
 * 测试目标: src/main/llm/session-manager.js
 * 覆盖场景: 会话管理、上下文压缩、摘要生成、标签管理、导出导入
 *
 * ⚠️ LIMITATION: 大部分测试跳过 - 数据库和文件系统依赖
 *
 * 主要问题：
 * 1. SessionManager的40+个方法几乎全部依赖数据库(db.prepare())
 * 2. 文件持久化依赖fs.promises（CommonJS）
 * 3. PromptCompressor依赖注入，但其方法也可能依赖LLM
 *
 * 跳过的测试类别：
 * - initialize, createSession, loadSession (依赖fs.mkdir, db.prepare)
 * - addMessage, compressSession, saveSession (依赖db.prepare)
 * - saveSessionToFile, loadSessionFromFile (依赖fs)
 * - 所有查询方法 (listSessions, getSessionStats, searchSessions等)
 * - 标签管理 (addTags, removeTags, getAllTags等)
 * - 导出导入 (exportToJSON, exportToMarkdown, importFromJSON等)
 * - 摘要生成 (generateSummary, generateSummariesBatch等)
 *
 * ✅ 当前覆盖：
 * - 构造函数和配置验证
 * - 错误处理和边界情况
 * - EventEmitter接口
 * - destroy方法（清理逻辑）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

// Mock fs.promises (CommonJS format - no default wrapper)
const mockMkdir = vi.fn(async () => undefined);
const mockWriteFile = vi.fn(async () => undefined);
const mockReadFile = vi.fn(async () => "{}");
const mockUnlink = vi.fn(async () => undefined);
const mockReaddir = vi.fn(async () => []);

vi.mock("fs", () => ({
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    unlink: mockUnlink,
    readdir: mockReaddir,
  },
}));

// Mock path (CommonJS format)
const mockJoin = vi.fn((...args) => args.join("/"));
const mockBasename = vi.fn((p) => p.split("/").pop());
const mockDirname = vi.fn((p) => p.split("/").slice(0, -1).join("/"));

vi.mock("path", () => ({
  join: mockJoin,
  basename: mockBasename,
  dirname: mockDirname,
}));

// Mock uuid (named export format)
const mockUuidV4 = vi.fn(() => "mocked-uuid-1234");

vi.mock("uuid", () => ({
  v4: mockUuidV4,
}));

// Mock PromptCompressor
const mockPromptCompressor = {
  compress: vi.fn(async (messages) => ({
    compressed: messages.slice(-5),
    summary: "Test summary",
  })),
  updateConfig: vi.fn(),
};

vi.mock("../../../src/main/llm/prompt-compressor.js", () => ({
  PromptCompressor: vi.fn(function () {
    return mockPromptCompressor;
  }),
}));

describe("SessionManager", () => {
  let SessionManager;
  let sessionManager;
  let mockDatabase;
  let mockLLMManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database
    mockDatabase = {
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      })),
    };

    // Mock LLM manager
    mockLLMManager = {
      query: vi.fn(async () => "Test summary"),
      isInitialized: true,
    };

    // Dynamic import
    const module = await import("../../../src/main/llm/session-manager.js");
    SessionManager = module.SessionManager;
  });

  afterEach(() => {
    if (sessionManager) {
      sessionManager.destroy();
      sessionManager = null;
    }
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(sessionManager).toBeDefined();
      expect(sessionManager.db).toBe(mockDatabase);
    });

    it("应该要求非空database参数", () => {
      expect(() => new SessionManager({})).toThrow("database 参数是必需的");
    });

    it("应该使用默认配置", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(sessionManager.maxHistoryMessages).toBe(10);
      expect(sessionManager.compressionThreshold).toBe(10);
      expect(sessionManager.enableAutoSave).toBe(true);
      expect(sessionManager.enableCompression).toBe(true);
      expect(sessionManager.enableAutoSummary).toBe(true);
      expect(sessionManager.autoSummaryThreshold).toBe(5);
    });

    it("应该接受自定义配置", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        maxHistoryMessages: 20,
        compressionThreshold: 15,
        enableAutoSave: false,
        enableCompression: false,
        autoSummaryThreshold: 10,
      });

      expect(sessionManager.maxHistoryMessages).toBe(20);
      expect(sessionManager.compressionThreshold).toBe(15);
      expect(sessionManager.enableAutoSave).toBe(false);
      expect(sessionManager.enableCompression).toBe(false);
      expect(sessionManager.autoSummaryThreshold).toBe(10);
    });

    it("应该初始化PromptCompressor", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(sessionManager.promptCompressor).toBeDefined();
    });

    it("应该初始化sessionCache为Map", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(sessionManager.sessionCache).toBeInstanceOf(Map);
    });

    it("应该继承EventEmitter", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(typeof sessionManager.on).toBe("function");
      expect(typeof sessionManager.emit).toBe("function");
    });

    it("应该设置默认sessionsDir路径", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(sessionManager.sessionsDir).toContain(".chainlesschain");
      expect(sessionManager.sessionsDir).toContain("memory");
      expect(sessionManager.sessionsDir).toContain("sessions");
    });

    it("应该接受自定义sessionsDir", () => {
      const customDir = "/custom/sessions";
      sessionManager = new SessionManager({
        database: mockDatabase,
        sessionsDir: customDir,
      });

      expect(sessionManager.sessionsDir).toBe(customDir);
    });

    it("应该初始化后台摘要任务状态", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(sessionManager._backgroundSummaryTimer).toBeNull();
      expect(sessionManager._isGeneratingSummary).toBe(false);
      expect(Array.isArray(sessionManager._summaryQueue)).toBe(true);
    });
  });

  describe("destroy", () => {
    it("应该清理sessionCache", () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      sessionManager.sessionCache.set("test", { id: "test" });

      sessionManager.destroy();

      expect(sessionManager.sessionCache.size).toBe(0);
    });

    it("应该停止后台摘要生成器", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        llmManager: mockLLMManager,
      });
      sessionManager._backgroundSummaryTimer = setTimeout(() => {}, 1000);

      sessionManager.destroy();

      expect(sessionManager._backgroundSummaryTimer).toBeNull();
    });
  });

  describe("配置管理", () => {
    it("应该正确处理enableAutoSave=false", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        enableAutoSave: false,
      });

      expect(sessionManager.enableAutoSave).toBe(false);
    });

    it("应该正确处理enableCompression=false", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        enableCompression: false,
      });

      expect(sessionManager.enableCompression).toBe(false);
    });

    it("应该正确处理enableAutoSummary=false", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        enableAutoSummary: false,
      });

      expect(sessionManager.enableAutoSummary).toBe(false);
    });

    it("应该正确处理enableBackgroundSummary=false", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        enableBackgroundSummary: false,
      });

      expect(sessionManager.enableBackgroundSummary).toBe(false);
    });
  });

  describe("initialize", () => {
    beforeEach(() => {
      sessionManager = new SessionManager({ database: mockDatabase });
    });

    it("应该创建会话目录", async () => {
      await sessionManager.initialize();

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining("sessions"),
        { recursive: true }
      );
    });

    it("创建目录失败应抛出错误", async () => {
      mockMkdir.mockRejectedValueOnce(new Error("EACCES"));

      await expect(sessionManager.initialize()).rejects.toThrow();
    });

    it("enableBackgroundSummary时应启动后台任务", async () => {
      const mgr = new SessionManager({
        database: mockDatabase,
        llmManager: mockLLMManager,
        enableBackgroundSummary: true,
      });

      await mgr.initialize();

      expect(mgr._backgroundSummaryTimer).toBeDefined();
      mgr.destroy();
    });
  });

  describe("createSession", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该创建新会话", async () => {
      const session = await sessionManager.createSession({
        conversationId: "conv1",
        title: "Test Session",
      });

      expect(session.conversationId).toBe("conv1");
      expect(session.title).toBe("Test Session");
      expect(session.id).toBe("mocked-uuid-1234");
    });

    it("应该使用UUID生成会话ID", async () => {
      await sessionManager.createSession({ conversationId: "conv1" });

      expect(mockUuidV4).toHaveBeenCalled();
    });

    it("conversationId是必需的", async () => {
      await expect(sessionManager.createSession({})).rejects.toThrow(
        "conversationId 是必需的"
      );
    });

    it("应该调用数据库prepare", async () => {
      await sessionManager.createSession({
        conversationId: "conv1",
        title: "Test",
      });

      expect(mockDatabase.prepare).toHaveBeenCalled();
      const sql = mockDatabase.prepare.mock.calls[0][0];
      expect(sql).toContain("INSERT INTO llm_sessions");
    });

    it("应该触发session-created事件", async () => {
      const listener = vi.fn();
      sessionManager.on("session-created", listener);

      const session = await sessionManager.createSession({
        conversationId: "conv1",
      });

      expect(listener).toHaveBeenCalledWith(session);
    });

    it("应该初始化空消息数组", async () => {
      const session = await sessionManager.createSession({
        conversationId: "conv1",
      });

      expect(session.messages).toEqual([]);
    });

    it("应该设置元数据", async () => {
      const session = await sessionManager.createSession({
        conversationId: "conv1",
        metadata: { custom: "value" },
      });

      expect(session.metadata.custom).toBe("value");
      expect(session.metadata.createdAt).toBeDefined();
      expect(session.metadata.messageCount).toBe(0);
      expect(session.metadata.totalTokens).toBe(0);
    });

    it("应该缓存会话", async () => {
      const session = await sessionManager.createSession({
        conversationId: "conv1",
      });

      expect(sessionManager.sessionCache.has(session.id)).toBe(true);
    });
  });

  describe("loadSession", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该从数据库加载会话", async () => {
      const mockSessionData = {
        id: "sess-123",
        conversation_id: "conv-123",
        title: "Test Session",
        messages: JSON.stringify([{ role: "user", content: "hello" }]),
        compressed_history: null,
        metadata: JSON.stringify({ createdAt: Date.now() }),
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      mockDatabase.prepare.mockReturnValueOnce({
        get: vi.fn(() => mockSessionData),
      });

      const session = await sessionManager.loadSession("sess-123");

      expect(session).toBeDefined();
      expect(session.id).toBe("sess-123");
      expect(session.conversationId).toBe("conv-123");
      expect(mockDatabase.prepare).toHaveBeenCalled();
    });

    it("加载不存在的会话应返回null", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        get: vi.fn(() => null),
      });

      const session = await sessionManager.loadSession("nonexistent");

      expect(session).toBeNull();
    });

    it("应该使用缓存", async () => {
      const cachedSession = { id: "sess-123", messages: [] };
      sessionManager.sessionCache.set("sess-123", cachedSession);

      const session = await sessionManager.loadSession("sess-123", {
        fromCache: true,
      });

      expect(session).toBe(cachedSession);
    });

    it("fromCache=false应跳过缓存", async () => {
      const mockSessionData = {
        id: "sess-123",
        conversation_id: "conv-123",
        title: "Test",
        messages: "[]",
        compressed_history: null,
        metadata: "{}",
      };

      mockDatabase.prepare.mockReturnValueOnce({
        get: vi.fn(() => mockSessionData),
      });

      sessionManager.sessionCache.set("sess-123", { cached: true });

      await sessionManager.loadSession("sess-123", { fromCache: false });

      expect(mockDatabase.prepare).toHaveBeenCalled();
    });
  });

  describe("addMessage", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该添加消息到会话", async () => {
      const session = { id: "sess-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.addMessage("sess-1", {
        role: "user",
        content: "Hello",
      });

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].content).toBe("Hello");
    });

    it("应该更新元数据中的消息计数", async () => {
      const session = { id: "sess-1", messages: [], metadata: { messageCount: 0 } };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.addMessage("sess-1", { role: "user", content: "Hi" });

      expect(session.metadata.messageCount).toBe(1);
    });

    it("enableAutoSave时应自动保存", async () => {
      sessionManager.enableAutoSave = true;
      const session = { id: "sess-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);
      const saveSpy = vi.spyOn(sessionManager, "saveSession");

      await sessionManager.addMessage("sess-1", { role: "user", content: "Test" });

      expect(saveSpy).toHaveBeenCalled();
    });

    it("达到压缩阈值时应触发压缩", async () => {
      sessionManager.compressionThreshold = 2;
      sessionManager.enableCompression = true;
      const session = { id: "sess-1", messages: [{ role: "user", content: "msg1" }], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);
      const compressSpy = vi.spyOn(sessionManager, "compressSession");

      await sessionManager.addMessage("sess-1", { role: "user", content: "msg2" });

      expect(compressSpy).toHaveBeenCalled();
    });
  });

  describe("compressSession", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该压缩会话历史", async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: "user",
        content: `Message ${i}`,
      }));
      const session = { id: "sess-1", messages, metadata: { compressionCount: 0 } };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.compressSession("sess-1");

      expect(mockPromptCompressor.compress).toHaveBeenCalled();
    });

    it("应该更新压缩计数", async () => {
      const session = { id: "sess-1", messages: [], metadata: { compressionCount: 0 } };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.compressSession("sess-1");

      expect(session.metadata.compressionCount).toBe(1);
    });

    it("应该触发compression-triggered事件", async () => {
      const session = { id: "sess-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);
      const listener = vi.fn();
      sessionManager.on("compression-triggered", listener);

      await sessionManager.compressSession("sess-1");

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("saveSession", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该保存会话到数据库", async () => {
      const session = {
        id: "sess-1",
        conversationId: "conv-1",
        title: "Test",
        messages: [],
        compressedHistory: null,
        metadata: {},
      };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.saveSession("sess-1");

      expect(mockDatabase.prepare).toHaveBeenCalled();
      const sql = mockDatabase.prepare.mock.calls[0][0];
      expect(sql).toContain("UPDATE llm_sessions");
    });

    it("应该触发session-saved事件", async () => {
      const session = { id: "sess-1", conversationId: "conv-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);
      const listener = vi.fn();
      sessionManager.on("session-saved", listener);

      await sessionManager.saveSession("sess-1");

      expect(listener).toHaveBeenCalled();
    });

    it("会话不存在时应抛出错误", async () => {
      await expect(sessionManager.saveSession("nonexistent")).rejects.toThrow();
    });
  });

  describe("saveSessionToFile", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该保存会话到文件", async () => {
      const session = { id: "sess-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.saveSessionToFile(session);

      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("文件内容应该是JSON格式", async () => {
      const session = { id: "sess-1", messages: [{ role: "user", content: "test" }], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.saveSessionToFile(session);

      const writeCall = mockWriteFile.mock.calls[0];
      expect(() => JSON.parse(writeCall[1])).not.toThrow();
    });
  });

  describe("loadSessionFromFile", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该从文件加载会话", async () => {
      const sessionData = { id: "sess-1", messages: [], metadata: {} };
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify(sessionData)
      );

      const session = await sessionManager.loadSessionFromFile("sess-1");

      expect(session).toBeDefined();
      expect(session.id).toBe("sess-1");
    });

    it("文件不存在时应抛出错误", async () => {
      mockReadFile.mockRejectedValueOnce(
        new Error("ENOENT")
      );

      await expect(
        sessionManager.loadSessionFromFile("nonexistent")
      ).rejects.toThrow();
    });

    it("无效JSON应抛出错误", async () => {
      mockReadFile.mockResolvedValueOnce("invalid-json{");

      await expect(
        sessionManager.loadSessionFromFile("sess-1")
      ).rejects.toThrow();
    });
  });

  describe("getEffectiveMessages", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该获取有效消息", async () => {
      const session = {
        id: "sess-1",
        messages: [{ role: "user", content: "msg1" }, { role: "assistant", content: "msg2" }],
        compressedHistory: null,
        metadata: {},
      };
      sessionManager.sessionCache.set("sess-1", session);

      const messages = await sessionManager.getEffectiveMessages("sess-1");

      expect(messages).toHaveLength(2);
    });

    it("有压缩历史时应合并消息", async () => {
      const session = {
        id: "sess-1",
        messages: [{ role: "user", content: "new" }],
        compressedHistory: { summary: "Old conversation" },
        metadata: {},
      };
      sessionManager.sessionCache.set("sess-1", session);

      const messages = await sessionManager.getEffectiveMessages("sess-1");

      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe("deleteSession", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该删除会话", async () => {
      const fs = await import("fs");
      const session = { id: "sess-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.deleteSession("sess-1");

      expect(mockDatabase.prepare).toHaveBeenCalled();
      expect(fs.default.promises.unlink).toHaveBeenCalled();
    });

    it("应该从缓存中移除", async () => {
      const session = { id: "sess-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.deleteSession("sess-1");

      expect(sessionManager.sessionCache.has("sess-1")).toBe(false);
    });
  });

  describe("listSessions", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该列出所有会话", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        all: vi.fn(() => [
          { id: "sess-1", title: "Session 1" },
          { id: "sess-2", title: "Session 2" },
        ]),
      });

      const sessions = await sessionManager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(mockDatabase.prepare).toHaveBeenCalled();
    });

    it("支持分页", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        all: vi.fn(() => [{ id: "sess-1" }]),
      });

      await sessionManager.listSessions({ limit: 10, offset: 0 });

      const sql = mockDatabase.prepare.mock.calls[0][0];
      expect(sql).toContain("LIMIT");
    });
  });

  describe("getSessionStats", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该获取会话统计", async () => {
      const session = {
        id: "sess-1",
        messages: [{ role: "user" }, { role: "assistant" }],
        metadata: { totalTokens: 100, compressionCount: 2 },
      };
      sessionManager.sessionCache.set("sess-1", session);

      const stats = await sessionManager.getSessionStats("sess-1");

      expect(stats.messageCount).toBe(2);
      expect(stats.totalTokens).toBe(100);
      expect(stats.compressionCount).toBe(2);
    });
  });

  describe("cleanupOldSessions", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该清理旧会话", async () => {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      await sessionManager.cleanupOldSessions(cutoffDate);

      expect(mockDatabase.prepare).toHaveBeenCalled();
    });

    it("应该删除对应的文件", async () => {
      const fs = await import("fs");

      await sessionManager.cleanupOldSessions(new Date());

      // 文件删除操作应该被调用
      expect(fs.default.promises.readdir).toHaveBeenCalled();
    });
  });

  describe("searchSessions", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该搜索会话", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        all: vi.fn(() => [{ id: "sess-1", title: "Test Session" }]),
      });

      const results = await sessionManager.searchSessions("test");

      expect(results).toHaveLength(1);
      expect(mockDatabase.prepare).toHaveBeenCalled();
    });

    it("搜索条件应包含在SQL中", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        all: vi.fn(() => []),
      });

      await sessionManager.searchSessions("keyword");

      const sql = mockDatabase.prepare.mock.calls[0][0];
      expect(sql).toContain("LIKE");
    });
  });

  describe("标签管理", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该添加标签", async () => {
      const session = { id: "sess-1", metadata: { tags: [] } };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.addTags("sess-1", ["tag1", "tag2"]);

      expect(session.metadata.tags).toContain("tag1");
      expect(session.metadata.tags).toContain("tag2");
    });

    it("应该移除标签", async () => {
      const session = { id: "sess-1", metadata: { tags: ["tag1", "tag2"] } };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.removeTags("sess-1", ["tag1"]);

      expect(session.metadata.tags).not.toContain("tag1");
      expect(session.metadata.tags).toContain("tag2");
    });

    it("应该获取所有标签", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        all: vi.fn(() => [{ tags: '["tag1","tag2"]' }, { tags: '["tag2","tag3"]' }]),
      });

      const tags = await sessionManager.getAllTags();

      expect(Array.isArray(tags)).toBe(true);
    });

    it("应该按标签查找会话", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        all: vi.fn(() => [{ id: "sess-1", metadata: '{"tags":["tag1"]}' }]),
      });

      const sessions = await sessionManager.findSessionsByTag("tag1");

      expect(Array.isArray(sessions)).toBe(true);
    });
  });

  describe("导出导入", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该导出为JSON", async () => {
      const session = { id: "sess-1", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);

      const json = await sessionManager.exportToJSON("sess-1");

      expect(typeof json).toBe("string");
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("应该导出为Markdown", async () => {
      const session = {
        id: "sess-1",
        title: "Test",
        messages: [{ role: "user", content: "Hello" }],
        metadata: {},
      };
      sessionManager.sessionCache.set("sess-1", session);

      const markdown = await sessionManager.exportToMarkdown("sess-1");

      expect(typeof markdown).toBe("string");
      expect(markdown).toContain("Hello");
    });

    it("应该从JSON导入", async () => {
      const sessionData = { id: "imported", messages: [], metadata: {} };
      const json = JSON.stringify(sessionData);

      await sessionManager.importFromJSON(json);

      expect(mockDatabase.prepare).toHaveBeenCalled();
    });

    it("应该导出多个会话", async () => {
      const sessions = [
        { id: "sess-1", messages: [], metadata: {} },
        { id: "sess-2", messages: [], metadata: {} },
      ];
      sessions.forEach((s) => sessionManager.sessionCache.set(s.id, s));

      const exported = await sessionManager.exportMultipleSessions(["sess-1", "sess-2"]);

      expect(Array.isArray(exported)).toBe(true);
    });
  });

  describe("摘要生成", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        llmManager: mockLLMManager,
      });
      await sessionManager.initialize();
    });

    it("应该生成会话摘要", async () => {
      const session = {
        id: "sess-1",
        messages: [{ role: "user", content: "Test" }],
        metadata: {},
      };
      sessionManager.sessionCache.set("sess-1", session);

      const summary = await sessionManager.generateSummary("sess-1");

      expect(typeof summary).toBe("string");
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it("应该批量生成摘要", async () => {
      const sessions = [
        { id: "sess-1", messages: [], metadata: {} },
        { id: "sess-2", messages: [], metadata: {} },
      ];
      sessions.forEach((s) => sessionManager.sessionCache.set(s.id, s));

      await sessionManager.generateSummariesBatch(["sess-1", "sess-2"]);

      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it("llmManager未初始化时应抛出错误", async () => {
      const mgr = new SessionManager({ database: mockDatabase });
      await mgr.initialize();

      await expect(mgr.generateSummary("sess-1")).rejects.toThrow();
      mgr.destroy();
    });
  });

  describe("模板管理", () => {
    beforeEach(async () => {
      sessionManager = new SessionManager({ database: mockDatabase });
      await sessionManager.initialize();
    });

    it("应该保存为模板", async () => {
      const session = { id: "sess-1", title: "Template", messages: [], metadata: {} };
      sessionManager.sessionCache.set("sess-1", session);

      await sessionManager.saveAsTemplate("sess-1", "My Template");

      expect(mockDatabase.prepare).toHaveBeenCalled();
      const sql = mockDatabase.prepare.mock.calls[0][0];
      expect(sql).toContain("INSERT");
    });

    it("应该从模板创建", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        get: vi.fn(() => ({
          id: "template-1",
          name: "Template",
          content: JSON.stringify({ messages: [] }),
        })),
      });

      const session = await sessionManager.createFromTemplate("template-1", "conv-1");

      expect(session).toBeDefined();
    });

    it("应该列出模板", async () => {
      mockDatabase.prepare.mockReturnValueOnce({
        all: vi.fn(() => [
          { id: "t1", name: "Template 1" },
          { id: "t2", name: "Template 2" },
        ]),
      });

      const templates = await sessionManager.listTemplates();

      expect(templates).toHaveLength(2);
    });

    it("应该删除模板", async () => {
      await sessionManager.deleteTemplate("template-1");

      expect(mockDatabase.prepare).toHaveBeenCalled();
      const sql = mockDatabase.prepare.mock.calls[0][0];
      expect(sql).toContain("DELETE");
    });
  });

  describe("边界情况", () => {
    it("应该处理空配置", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        llmManager: null,
      });

      expect(sessionManager.llmManager).toBeNull();
    });

    it("应该处理自定义autoSummaryInterval", () => {
      sessionManager = new SessionManager({
        database: mockDatabase,
        autoSummaryInterval: 60000, // 1分钟
      });

      expect(sessionManager.autoSummaryInterval).toBe(60000);
    });

    it("应该初始化空的summaryQueue", () => {
      sessionManager = new SessionManager({ database: mockDatabase });

      expect(sessionManager._summaryQueue.length).toBe(0);
    });
  });
});
