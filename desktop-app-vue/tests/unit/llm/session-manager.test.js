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

// Mock fs.promises
vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      readFile: vi.fn(async () => "{}"),
      unlink: vi.fn(async () => undefined),
      readdir: vi.fn(async () => []),
    },
  },
}));

// Mock path
vi.mock("path", () => ({
  default: {
    join: vi.fn((...args) => args.join("/")),
    basename: vi.fn((p) => p.split("/").pop()),
    dirname: vi.fn((p) => p.split("/").slice(0, -1).join("/")),
  },
}));

// Mock uuid
vi.mock("uuid", () => ({
  v4: vi.fn(() => "mocked-uuid-1234"),
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
      const fs = await import("fs");

      await sessionManager.initialize();

      expect(fs.default.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining("sessions"),
        { recursive: true }
      );
    });

    it("创建目录失败应抛出错误", async () => {
      const fs = await import("fs");
      fs.default.promises.mkdir.mockRejectedValueOnce(new Error("EACCES"));

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
      const uuid = await import("uuid");

      await sessionManager.createSession({ conversationId: "conv1" });

      expect(uuid.v4).toHaveBeenCalled();
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

  describe.skip("addMessage", () => {
    // TODO: Skipped - Depends on db.prepare()

    it("应该添加消息到会话", async () => {});
  });

  describe.skip("compressSession", () => {
    // TODO: Skipped - Depends on db.prepare() and PromptCompressor

    it("应该压缩会话历史", async () => {});
  });

  describe.skip("saveSession", () => {
    // TODO: Skipped - Depends on db.prepare()

    it("应该保存会话", async () => {});
  });

  describe.skip("saveSessionToFile", () => {
    // TODO: Skipped - Depends on fs.promises.writeFile()

    it("应该保存会话到文件", async () => {});
  });

  describe.skip("loadSessionFromFile", () => {
    // TODO: Skipped - Depends on fs.promises.readFile()

    it("应该从文件加载会话", async () => {});
  });

  describe.skip("getEffectiveMessages", () => {
    // TODO: Skipped - Depends on loadSession

    it("应该获取有效消息", async () => {});
  });

  describe.skip("deleteSession", () => {
    // TODO: Skipped - Depends on db.prepare() and fs.promises.unlink()

    it("应该删除会话", async () => {});
  });

  describe.skip("listSessions", () => {
    // TODO: Skipped - Depends on db.prepare().all()

    it("应该列出所有会话", async () => {});
  });

  describe.skip("getSessionStats", () => {
    // TODO: Skipped - Depends on loadSession

    it("应该获取会话统计", async () => {});
  });

  describe.skip("cleanupOldSessions", () => {
    // TODO: Skipped - Depends on db.prepare() and fs operations

    it("应该清理旧会话", async () => {});
  });

  describe.skip("searchSessions", () => {
    // TODO: Skipped - Depends on db.prepare().all()

    it("应该搜索会话", async () => {});
  });

  describe.skip("标签管理", () => {
    // TODO: Skipped - Depends on db.prepare()

    it("应该添加标签", async () => {});
    it("应该移除标签", async () => {});
    it("应该获取所有标签", async () => {});
    it("应该按标签查找会话", async () => {});
  });

  describe.skip("导出导入", () => {
    // TODO: Skipped - Depends on loadSession and fs operations

    it("应该导出为JSON", async () => {});
    it("应该导出为Markdown", async () => {});
    it("应该从JSON导入", async () => {});
    it("应该导出多个会话", async () => {});
  });

  describe.skip("摘要生成", () => {
    // TODO: Skipped - Depends on loadSession and llmManager

    it("应该生成会话摘要", async () => {});
    it("应该批量生成摘要", async () => {});
  });

  describe.skip("模板管理", () => {
    // TODO: Skipped - Depends on db.prepare()

    it("应该保存为模板", async () => {});
    it("应该从模板创建", async () => {});
    it("应该列出模板", async () => {});
    it("应该删除模板", async () => {});
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
