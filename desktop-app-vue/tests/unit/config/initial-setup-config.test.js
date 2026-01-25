/**
 * 单元测试：初始设置配置管理器
 * 测试文件：src/main/config/initial-setup-config.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// 创建临时测试目录
const testDir = path.join(os.tmpdir(), "chainlesschain-test-" + Date.now());

// Mock模块
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

describe("InitialSetupConfig - 配置管理器单元测试", () => {
  let InitialSetupConfig;
  let configInstance;
  let configPath;

  beforeEach(async () => {
    // 创建测试目录
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    configPath = path.join(testDir, "initial-setup-config.json");

    // 清除模块缓存并重新导入
    vi.resetModules();
    const module =
      await import("../../../src/main/config/initial-setup-config.js");
    InitialSetupConfig = module.default || module.InitialSetupConfig;

    configInstance = new InitialSetupConfig(testDir);
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  });

  describe("isFirstTimeSetup()", () => {
    it("首次启动时应返回 true", () => {
      expect(configInstance.isFirstTimeSetup()).toBe(true);
    });

    it("完成设置后应返回 false", () => {
      configInstance.markSetupComplete();
      expect(configInstance.isFirstTimeSetup()).toBe(false);
    });
  });

  describe("get() 和 set()", () => {
    it("应正确获取和设置简单值", () => {
      configInstance.set("edition", "enterprise");
      expect(configInstance.get("edition")).toBe("enterprise");
    });

    it("应正确获取和设置嵌套值", () => {
      configInstance.set("paths.projectRoot", "/test/path");
      expect(configInstance.get("paths.projectRoot")).toBe("/test/path");
    });

    it("应正确获取嵌套对象", () => {
      configInstance.set("llm.provider", "ollama");
      configInstance.set("llm.apiKey", "test-key");

      const llmConfig = configInstance.get("llm");
      expect(llmConfig.provider).toBe("ollama");
      expect(llmConfig.apiKey).toBe("test-key");
    });
  });

  describe("getAll()", () => {
    it("应返回所有配置的副本", () => {
      const config1 = configInstance.getAll();
      const config2 = configInstance.getAll();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // 不是同一个引用
    });

    it("应包含所有默认字段", () => {
      const config = configInstance.getAll();

      expect(config).toHaveProperty("setupCompleted");
      expect(config).toHaveProperty("completedAt");
      expect(config).toHaveProperty("edition");
      expect(config).toHaveProperty("paths");
      expect(config).toHaveProperty("llm");
      expect(config).toHaveProperty("enterprise");
    });
  });

  describe("save() 和 load()", () => {
    it("应正确保存配置到文件", () => {
      configInstance.set("edition", "personal");
      configInstance.set("paths.projectRoot", "/test/projects");
      configInstance.save();

      expect(fs.existsSync(configPath)).toBe(true);

      // 验证文件内容
      const fileContent = fs.readFileSync(configPath, "utf8");
      const savedConfig = JSON.parse(fileContent);

      expect(savedConfig.edition).toBe("personal");
      expect(savedConfig.paths.projectRoot).toBe("/test/projects");
    });

    it("应正确加载配置文件", () => {
      // 手动创建配置文件
      const testConfig = {
        setupCompleted: true,
        completedAt: "2025-12-31T10:00:00.000Z",
        edition: "enterprise",
        paths: {
          projectRoot: "/enterprise/projects",
          database: "/enterprise/db.sqlite",
        },
        llm: {
          provider: "openai",
          apiKey: "sk-test-123",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4",
        },
        enterprise: {
          serverUrl: "https://enterprise.test.com",
          apiKey: "ent-key-456",
          tenantId: "tenant-789",
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), "utf8");

      // 重新加载实例
      const newInstance = new InitialSetupConfig(testDir);

      expect(newInstance.get("edition")).toBe("enterprise");
      expect(newInstance.get("paths.projectRoot")).toBe("/enterprise/projects");
      expect(newInstance.get("llm.provider")).toBe("openai");
      expect(newInstance.get("enterprise.serverUrl")).toBe(
        "https://enterprise.test.com",
      );
      expect(newInstance.isFirstTimeSetup()).toBe(false);
    });
  });

  describe("markSetupComplete()", () => {
    it("应设置 setupCompleted 为 true", () => {
      configInstance.markSetupComplete();

      expect(configInstance.get("setupCompleted")).toBe(true);
    });

    it("应设置 completedAt 时间戳", () => {
      configInstance.markSetupComplete();

      const completedAt = configInstance.get("completedAt");
      expect(completedAt).toBeTruthy();

      // 验证是有效的ISO时间戳
      const timestamp = new Date(completedAt);
      expect(timestamp.toString()).not.toBe("Invalid Date");
    });
  });

  describe("reset()", () => {
    it("应重置所有配置为默认值", () => {
      configInstance.set("edition", "enterprise");
      configInstance.set("paths.projectRoot", "/custom/path");
      configInstance.markSetupComplete();

      configInstance.reset();

      expect(configInstance.get("edition")).toBe("personal");
      expect(configInstance.get("paths.projectRoot")).toBe("");
      expect(configInstance.isFirstTimeSetup()).toBe(true);
    });
  });

  describe("边界情况测试", () => {
    it("应处理不存在的键 - 返回 undefined", () => {
      expect(configInstance.get("nonexistent.key")).toBeUndefined();
    });

    it("应处理空字符串路径", () => {
      configInstance.set("paths.projectRoot", "");
      expect(configInstance.get("paths.projectRoot")).toBe("");
    });

    it("应处理 null 值", () => {
      configInstance.set("enterprise", null);
      expect(configInstance.get("enterprise")).toBeNull();
    });

    it("应处理损坏的JSON文件 - 使用默认配置", () => {
      // 写入无效JSON
      fs.writeFileSync(configPath, "invalid json {{{", "utf8");

      // 重新加载应使用默认配置
      const newInstance = new InitialSetupConfig(testDir);
      expect(newInstance.get("edition")).toBe("personal");
    });
  });
});

describe("InitialSetupConfig - 配置应用到系统", () => {
  let configInstance;
  let mockAppConfig;
  let mockLlmConfig;
  let mockDatabase;

  beforeEach(async () => {
    // 创建测试目录
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // 清除模块缓存并重新导入
    vi.resetModules();
    const module =
      await import("../../../src/main/config/initial-setup-config.js");
    const InitialSetupConfig = module.default || module.InitialSetupConfig;
    configInstance = new InitialSetupConfig(testDir);

    // Mock依赖对象
    mockAppConfig = {
      set: vi.fn(),
      save: vi.fn(),
      setDatabasePath: vi.fn(),
    };

    mockLlmConfig = {
      set: vi.fn(),
      save: vi.fn(),
    };

    mockDatabase = {
      setSetting: vi.fn().mockResolvedValue(true),
    };
  });

  it("应正确应用个人版配置", async () => {
    configInstance.set("edition", "personal");
    configInstance.set("paths.projectRoot", "C:\\test\\projects");
    configInstance.set("paths.database", "C:\\test\\db.sqlite");

    await configInstance.applyToSystem(
      mockAppConfig,
      mockLlmConfig,
      mockDatabase,
    );

    expect(mockAppConfig.set).toHaveBeenCalledWith("app.edition", "personal");
    expect(mockAppConfig.setDatabasePath).toHaveBeenCalledWith(
      "C:\\test\\db.sqlite",
    );
    expect(mockDatabase.setSetting).toHaveBeenCalledWith(
      "project.rootPath",
      "C:\\test\\projects",
    );
  });

  it("应正确应用企业版配置", async () => {
    configInstance.set("edition", "enterprise");
    configInstance.set("enterprise", {
      serverUrl: "https://ent.test.com",
      tenantId: "tenant-123",
      apiKey: "ent-api-key",
    });

    await configInstance.applyToSystem(
      mockAppConfig,
      mockLlmConfig,
      mockDatabase,
    );

    expect(mockAppConfig.set).toHaveBeenCalledWith("app.edition", "enterprise");
    expect(mockDatabase.setSetting).toHaveBeenCalledWith(
      "enterprise.serverUrl",
      "https://ent.test.com",
    );
    expect(mockDatabase.setSetting).toHaveBeenCalledWith(
      "enterprise.tenantId",
      "tenant-123",
    );
    expect(mockDatabase.setSetting).toHaveBeenCalledWith(
      "enterprise.apiKey",
      "ent-api-key",
    );
  });

  it("应正确应用LLM配置", async () => {
    configInstance.set("llm", {
      provider: "volcengine",
      apiKey: "volcengine-key-123",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-pro-4k",
    });

    await configInstance.applyToSystem(
      mockAppConfig,
      mockLlmConfig,
      mockDatabase,
    );

    expect(mockLlmConfig.set).toHaveBeenCalledWith("provider", "volcengine");
    expect(mockLlmConfig.set).toHaveBeenCalledWith(
      "volcengine.apiKey",
      "volcengine-key-123",
    );
    expect(mockLlmConfig.set).toHaveBeenCalledWith(
      "volcengine.baseURL",
      "https://ark.cn-beijing.volces.com/api/v3",
    );
    expect(mockLlmConfig.set).toHaveBeenCalledWith(
      "volcengine.model",
      "doubao-pro-4k",
    );
    expect(mockLlmConfig.save).toHaveBeenCalled();
  });
});

console.log("✅ 单元测试脚本已创建");
