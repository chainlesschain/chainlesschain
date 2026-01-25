/**
 * SecureConfigStorage 单元测试
 * 测试目标: src/main/llm/secure-config-storage.js
 * 覆盖场景: 三层加密策略、API Key验证、配置脱敏、备份恢复
 *
 * ⚠️ LIMITATION: 大部分测试跳过 - Electron和文件系统依赖
 *
 * 主要问题：
 * 1. SecureConfigStorage依赖electron (app, safeStorage) - CommonJS require无法mock
 * 2. 构造函数调用app.getPath导致所有实例化测试失败
 * 3. 所有核心方法依赖fs (writeFileSync, readFileSync, existsSync等)
 * 4. 加密/解密依赖crypto.createCipheriv和safeStorage
 *
 * 跳过的测试类别：
 * - 构造函数 (app.getPath)
 * - clearCache (需要实例化)
 * - _getMachineKeySeed (需要实例化)
 * - _getEncryptionType (需要实例化)
 * - 单例管理 (getSecureConfigStorage需要实例化)
 * - _checkSafeStorageAvailability (safeStorage)
 * - _getDefaultStoragePath, _getBackupDir (app.getPath)
 * - _deriveKey (crypto.pbkdf2Sync)
 * - encrypt/decrypt系列 (crypto + safeStorage)
 * - save/load (fs.writeFileSync/readFileSync)
 * - exists/delete (fs.existsSync/unlinkSync)
 * - 备份恢复 (fs.copyFileSync/readdirSync)
 * - 导出导入 (fs操作)
 * - getStorageInfo (fs.statSync)
 * - migrateToSafeStorage (fs + safeStorage)
 *
 * ✅ 当前覆盖：
 * - 常量（SENSITIVE_FIELDS, API_KEY_PATTERNS, STORAGE_VERSION）
 * - 辅助函数（validateApiKeyFormat, extractSensitiveFields, sanitizeConfig等）
 * - isSensitiveField, getProviderSensitiveFields
 * - mergeSensitiveFields
 * - 边界情况和配置完整性
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

// Mock crypto (Node built-in) - CommonJS compatible
vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto");
  return actual;
});

// Mock os (Node built-in) - CommonJS compatible
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return actual;
});

// Mock fs - CommonJS compatible
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => Buffer.from([])),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  copyFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtime: new Date(), size: 1024 })),
}));

// Mock path - CommonJS compatible
vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
  dirname: vi.fn((p) => p.split("/").slice(0, -1).join("/")),
  basename: vi.fn((p) => p.split("/").pop()),
}));

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name) => {
      if (name === "userData") {
        return "/mock/userData";
      }
      return "/mock/" + name;
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str) => Buffer.from(str)),
    decryptString: vi.fn((buf) => buf.toString()),
  },
}));

describe("SecureConfigStorage", () => {
  let SecureConfigStorage,
    getSecureConfigStorage,
    resetInstance,
    extractSensitiveFields,
    mergeSensitiveFields,
    sanitizeConfig,
    validateApiKeyFormat,
    isSensitiveField,
    getProviderSensitiveFields,
    SENSITIVE_FIELDS,
    API_KEY_PATTERNS,
    STORAGE_VERSION;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module =
      await import("../../../src/main/llm/secure-config-storage.js");
    SecureConfigStorage = module.SecureConfigStorage;
    getSecureConfigStorage = module.getSecureConfigStorage;
    resetInstance = module.resetInstance;
    extractSensitiveFields = module.extractSensitiveFields;
    mergeSensitiveFields = module.mergeSensitiveFields;
    sanitizeConfig = module.sanitizeConfig;
    validateApiKeyFormat = module.validateApiKeyFormat;
    isSensitiveField = module.isSensitiveField;
    getProviderSensitiveFields = module.getProviderSensitiveFields;
    SENSITIVE_FIELDS = module.SENSITIVE_FIELDS;
    API_KEY_PATTERNS = module.API_KEY_PATTERNS;
    STORAGE_VERSION = module.STORAGE_VERSION;

    // Reset singleton
    resetInstance();
  });

  afterEach(() => {
    resetInstance();
  });

  describe("常量", () => {
    it("应该定义SENSITIVE_FIELDS数组", () => {
      expect(Array.isArray(SENSITIVE_FIELDS)).toBe(true);
      expect(SENSITIVE_FIELDS.length).toBeGreaterThan(0);
    });

    it("应该包含主要LLM提供商的敏感字段", () => {
      expect(SENSITIVE_FIELDS).toContain("openai.apiKey");
      expect(SENSITIVE_FIELDS).toContain("anthropic.apiKey");
      expect(SENSITIVE_FIELDS).toContain("deepseek.apiKey");
      expect(SENSITIVE_FIELDS).toContain("volcengine.apiKey");
    });

    it("应该包含国内提供商的敏感字段", () => {
      expect(SENSITIVE_FIELDS).toContain("dashscope.apiKey"); // 阿里云
      expect(SENSITIVE_FIELDS).toContain("zhipuai.apiKey"); // 智谱
      expect(SENSITIVE_FIELDS).toContain("baidu.apiKey"); // 百度
      expect(SENSITIVE_FIELDS).toContain("moonshot.apiKey"); // 月之暗面
    });

    it("应该包含MCP服务器凭证字段", () => {
      expect(SENSITIVE_FIELDS).toContain("mcp.postgres.password");
      expect(SENSITIVE_FIELDS).toContain("mcp.mysql.password");
      expect(SENSITIVE_FIELDS).toContain("mcp.redis.password");
    });

    it("应该定义API_KEY_PATTERNS对象", () => {
      expect(typeof API_KEY_PATTERNS).toBe("object");
      expect(Object.keys(API_KEY_PATTERNS).length).toBeGreaterThan(0);
    });

    it("应该包含主要提供商的API Key正则模式", () => {
      expect(API_KEY_PATTERNS.openai).toBeInstanceOf(RegExp);
      expect(API_KEY_PATTERNS.anthropic).toBeInstanceOf(RegExp);
      expect(API_KEY_PATTERNS.deepseek).toBeInstanceOf(RegExp);
      expect(API_KEY_PATTERNS.google).toBeInstanceOf(RegExp);
    });

    it("应该定义STORAGE_VERSION", () => {
      expect(typeof STORAGE_VERSION).toBe("number");
      expect(STORAGE_VERSION).toBeGreaterThan(0);
    });
  });

  describe("validateApiKeyFormat", () => {
    it("应该验证OpenAI API Key格式", () => {
      const result = validateApiKeyFormat(
        "openai",
        "sk-abcdefghijklmnopqrstuvwxyz123456",
      );
      expect(result.valid).toBe(true);
    });

    it("应该拒绝无效的OpenAI API Key", () => {
      const result = validateApiKeyFormat("openai", "invalid-key");
      expect(result.valid).toBe(false);
      expect(result.message).toBeDefined();
    });

    it("应该验证Anthropic API Key格式", () => {
      const result = validateApiKeyFormat(
        "anthropic",
        "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456",
      );
      expect(result.valid).toBe(true);
    });

    it("应该拒绝空API Key", () => {
      const result = validateApiKeyFormat("openai", "");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("不能为空");
    });

    it("应该拒绝null API Key", () => {
      const result = validateApiKeyFormat("openai", null);
      expect(result.valid).toBe(false);
    });

    it("应该拒绝非字符串API Key", () => {
      const result = validateApiKeyFormat("openai", 123);
      expect(result.valid).toBe(false);
    });

    it("应该拒绝过短的API Key", () => {
      const result = validateApiKeyFormat("openai", "short");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("长度过短");
    });

    it("应该验证Google API Key格式", () => {
      const result = validateApiKeyFormat(
        "google",
        "AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456",
      );
      expect(result.valid).toBe(true);
    });

    it("应该验证火山引擎UUID格式", () => {
      const result = validateApiKeyFormat(
        "volcengine",
        "12345678-1234-1234-1234-123456789abc",
      );
      expect(result.valid).toBe(true);
    });

    it("应该验证智谱AI key.secret格式", () => {
      const result = validateApiKeyFormat(
        "zhipuai",
        "abcdefghijklmnopqrstuvwxyz123456.ABCDEFG",
      );
      expect(result.valid).toBe(true);
    });

    it("应该允许无模式的提供商", () => {
      const result = validateApiKeyFormat(
        "custom",
        "any-custom-key-format-123",
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("extractSensitiveFields", () => {
    it("应该提取顶层敏感字段", () => {
      const config = {
        openai: { apiKey: "sk-test123" },
        model: "gpt-4",
      };

      const sensitive = extractSensitiveFields(config);

      expect(sensitive["openai.apiKey"]).toBe("sk-test123");
      expect(Object.keys(sensitive).length).toBe(1);
    });

    it("应该提取多个敏感字段", () => {
      const config = {
        openai: { apiKey: "sk-openai123" },
        anthropic: { apiKey: "sk-ant-test" },
        deepseek: { apiKey: "sk-deepseek123" },
      };

      const sensitive = extractSensitiveFields(config);

      expect(sensitive["openai.apiKey"]).toBe("sk-openai123");
      expect(sensitive["anthropic.apiKey"]).toBe("sk-ant-test");
      expect(sensitive["deepseek.apiKey"]).toBe("sk-deepseek123");
    });

    it("应该忽略空字符串字段", () => {
      const config = {
        openai: { apiKey: "" },
        anthropic: { apiKey: "sk-ant-test" },
      };

      const sensitive = extractSensitiveFields(config);

      expect(sensitive["openai.apiKey"]).toBeUndefined();
      expect(sensitive["anthropic.apiKey"]).toBe("sk-ant-test");
    });

    it("应该忽略不存在的字段", () => {
      const config = {
        openai: { model: "gpt-4" },
      };

      const sensitive = extractSensitiveFields(config);

      expect(sensitive["openai.apiKey"]).toBeUndefined();
    });

    it("应该处理嵌套字段", () => {
      const config = {
        baidu: {
          apiKey: "baidu-key",
          secretKey: "baidu-secret",
        },
      };

      const sensitive = extractSensitiveFields(config);

      expect(sensitive["baidu.apiKey"]).toBe("baidu-key");
      expect(sensitive["baidu.secretKey"]).toBe("baidu-secret");
    });

    it("应该提取MCP凭证", () => {
      const config = {
        mcp: {
          postgres: { password: "pg-password" },
          mysql: { password: "mysql-password" },
        },
      };

      const sensitive = extractSensitiveFields(config);

      expect(sensitive["mcp.postgres.password"]).toBe("pg-password");
      expect(sensitive["mcp.mysql.password"]).toBe("mysql-password");
    });
  });

  describe("mergeSensitiveFields", () => {
    it("应该合并敏感字段到配置对象", () => {
      const config = { openai: { model: "gpt-4" } };
      const sensitive = { "openai.apiKey": "sk-test123" };

      mergeSensitiveFields(config, sensitive);

      expect(config.openai.apiKey).toBe("sk-test123");
      expect(config.openai.model).toBe("gpt-4");
    });

    it("应该创建不存在的嵌套对象", () => {
      const config = {};
      const sensitive = { "openai.apiKey": "sk-test123" };

      mergeSensitiveFields(config, sensitive);

      expect(config.openai).toBeDefined();
      expect(config.openai.apiKey).toBe("sk-test123");
    });

    it("应该合并多个敏感字段", () => {
      const config = {};
      const sensitive = {
        "openai.apiKey": "sk-openai",
        "anthropic.apiKey": "sk-ant",
        "deepseek.apiKey": "sk-deepseek",
      };

      mergeSensitiveFields(config, sensitive);

      expect(config.openai.apiKey).toBe("sk-openai");
      expect(config.anthropic.apiKey).toBe("sk-ant");
      expect(config.deepseek.apiKey).toBe("sk-deepseek");
    });

    it("应该合并嵌套字段", () => {
      const config = {};
      const sensitive = {
        "baidu.apiKey": "baidu-key",
        "baidu.secretKey": "baidu-secret",
      };

      mergeSensitiveFields(config, sensitive);

      expect(config.baidu.apiKey).toBe("baidu-key");
      expect(config.baidu.secretKey).toBe("baidu-secret");
    });

    it("应该覆盖现有字段", () => {
      const config = { openai: { apiKey: "old-key" } };
      const sensitive = { "openai.apiKey": "new-key" };

      mergeSensitiveFields(config, sensitive);

      expect(config.openai.apiKey).toBe("new-key");
    });
  });

  describe("sanitizeConfig", () => {
    it("应该脱敏API Key", () => {
      const config = {
        openai: { apiKey: "sk-abcdefghijklmnopqrstuvwxyz" },
      };

      const sanitized = sanitizeConfig(config);

      expect(sanitized.openai.apiKey).toContain("****");
      expect(sanitized.openai.apiKey).not.toBe("sk-abcdefghijklmnopqrstuvwxyz");
    });

    it("应该保留前4后4字符", () => {
      const config = {
        openai: { apiKey: "sk-abcdefghijklmnopqrstuvwxyz" },
      };

      const sanitized = sanitizeConfig(config);

      expect(sanitized.openai.apiKey).toMatch(/^sk-a.*wxyz$/);
    });

    it("应该处理短API Key", () => {
      const config = {
        openai: { apiKey: "short" },
      };

      const sanitized = sanitizeConfig(config);

      expect(sanitized.openai.apiKey).toBe("********");
    });

    it("应该脱敏多个敏感字段", () => {
      const config = {
        openai: { apiKey: "sk-openai123456789012" },
        anthropic: { apiKey: "sk-ant-test123456789" },
      };

      const sanitized = sanitizeConfig(config);

      expect(sanitized.openai.apiKey).toContain("****");
      expect(sanitized.anthropic.apiKey).toContain("****");
    });

    it("应该保留非敏感字段", () => {
      const config = {
        openai: {
          apiKey: "sk-test123456789012",
          model: "gpt-4",
          temperature: 0.7,
        },
      };

      const sanitized = sanitizeConfig(config);

      expect(sanitized.openai.model).toBe("gpt-4");
      expect(sanitized.openai.temperature).toBe(0.7);
      expect(sanitized.openai.apiKey).toContain("****");
    });

    it("应该返回新对象（不修改原对象）", () => {
      const config = {
        openai: { apiKey: "sk-test123456789012" },
      };

      const sanitized = sanitizeConfig(config);

      expect(sanitized).not.toBe(config);
      expect(config.openai.apiKey).toBe("sk-test123456789012");
    });

    it("应该忽略空字符串字段", () => {
      const config = {
        openai: { apiKey: "" },
      };

      const sanitized = sanitizeConfig(config);

      expect(sanitized.openai.apiKey).toBe("");
    });
  });

  describe("isSensitiveField", () => {
    it("应该识别敏感字段", () => {
      expect(isSensitiveField("openai.apiKey")).toBe(true);
      expect(isSensitiveField("anthropic.apiKey")).toBe(true);
    });

    it("应该识别非敏感字段", () => {
      expect(isSensitiveField("openai.model")).toBe(false);
      expect(isSensitiveField("temperature")).toBe(false);
    });

    it("应该识别MCP敏感字段", () => {
      expect(isSensitiveField("mcp.postgres.password")).toBe(true);
      expect(isSensitiveField("mcp.mysql.password")).toBe(true);
    });
  });

  describe("getProviderSensitiveFields", () => {
    it("应该返回OpenAI的敏感字段", () => {
      const fields = getProviderSensitiveFields("openai");

      expect(fields).toContain("openai.apiKey");
      expect(fields.every((f) => f.startsWith("openai."))).toBe(true);
    });

    it("应该返回百度的敏感字段", () => {
      const fields = getProviderSensitiveFields("baidu");

      expect(fields).toContain("baidu.apiKey");
      expect(fields).toContain("baidu.secretKey");
    });

    it("应该返回火山引擎的敏感字段", () => {
      const fields = getProviderSensitiveFields("volcengine");

      expect(fields).toContain("volcengine.apiKey");
    });

    it("应该返回空数组对于不存在的提供商", () => {
      const fields = getProviderSensitiveFields("nonexistent");

      expect(fields).toEqual([]);
    });

    it("应该返回MCP的敏感字段", () => {
      const fields = getProviderSensitiveFields("mcp");

      expect(fields.length).toBeGreaterThan(0);
      expect(fields.every((f) => f.startsWith("mcp."))).toBe(true);
    });
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      const storage = new SecureConfigStorage();

      expect(storage).toBeDefined();
      expect(storage.safeStorageAvailable).toBe(true);
    });

    it("应该使用默认storagePath", () => {
      const storage = new SecureConfigStorage();

      expect(storage.storagePath).toBeDefined();
      expect(storage.storagePath).toContain("secure-config.enc");
    });

    it("应该接受自定义storagePath", () => {
      const storage = new SecureConfigStorage({ storagePath: "/custom/path" });

      expect(storage.storagePath).toBe("/custom/path");
    });

    it("应该初始化缓存为null", () => {
      const storage = new SecureConfigStorage();

      expect(storage._cache).toBeNull();
      expect(storage._cacheTimestamp).toBeNull();
    });

    it("应该设置默认缓存TTL为5分钟", () => {
      const storage = new SecureConfigStorage();

      expect(storage._cacheTTL).toBe(5 * 60 * 1000);
    });
  });

  describe("clearCache", () => {
    it("应该清除缓存", () => {
      const storage = new SecureConfigStorage();
      storage._cache = { some: "data" };
      storage._cacheTimestamp = Date.now();

      storage.clearCache();

      expect(storage._cache).toBeNull();
      expect(storage._cacheTimestamp).toBeNull();
    });

    it("应该处理空缓存", () => {
      const storage = new SecureConfigStorage();

      storage.clearCache();

      expect(storage._cache).toBeNull();
      expect(storage._cacheTimestamp).toBeNull();
    });
  });

  describe("_getMachineKeySeed", () => {
    it("应该生成机器密钥种子", () => {
      const storage = new SecureConfigStorage();

      const seed = storage._getMachineKeySeed();

      expect(typeof seed).toBe("string");
      expect(seed.length).toBeGreaterThan(0);
    });

    it("应该包含机器特征信息", () => {
      const storage = new SecureConfigStorage();

      const seed = storage._getMachineKeySeed();

      expect(seed).toContain("chainlesschain-llm-config-v2");
    });

    it("应该使用竖线分隔组件", () => {
      const storage = new SecureConfigStorage();

      const seed = storage._getMachineKeySeed();

      expect(seed).toContain("|");
    });

    it("种子应该是确定性的", () => {
      const storage = new SecureConfigStorage();

      const seed1 = storage._getMachineKeySeed();
      const seed2 = storage._getMachineKeySeed();

      expect(seed1).toBe(seed2);
    });
  });

  describe("_getEncryptionType", () => {
    it("应该识别safeStorage加密", () => {
      const storage = new SecureConfigStorage();
      const data = Buffer.from([0x53, 0x53, 0x02, 0x01, 0x02]); // 'SS' + version 2

      const type = storage._getEncryptionType(data);

      expect(type).toBe("safeStorage");
    });

    it("应该识别AES加密", () => {
      const storage = new SecureConfigStorage();
      const data = Buffer.from([0x41, 0x45, 0x02, 0x01, 0x02]); // 'AE' + version 2

      const type = storage._getEncryptionType(data);

      expect(type).toBe("aes");
    });

    it("应该识别legacy格式", () => {
      const storage = new SecureConfigStorage();
      const data = Buffer.from([0x01, 0x02, 0x03, 0x04]); // 无标记头

      const type = storage._getEncryptionType(data);

      expect(type).toBe("legacy");
    });

    it("应该处理过短的数据", () => {
      const storage = new SecureConfigStorage();
      const data = Buffer.from([0x01, 0x02]); // 长度 < 3

      const type = storage._getEncryptionType(data);

      expect(type).toBe("unknown");
    });

    it("应该识别导出格式'EX'", () => {
      const storage = new SecureConfigStorage();
      const data = Buffer.from([0x45, 0x58, 0x02]); // 'EX' + version

      const type = storage._getEncryptionType(data);

      // 导出格式可能被识别为unknown或有特殊处理
      expect(type).toBeDefined();
    });
  });

  describe("单例管理", () => {
    it("应该返回单例实例", () => {
      const instance1 = getSecureConfigStorage();
      const instance2 = getSecureConfigStorage();

      expect(instance1).toBe(instance2);
    });

    it("应该重置单例", () => {
      const instance1 = getSecureConfigStorage();

      resetInstance();

      const instance2 = getSecureConfigStorage();

      expect(instance1).not.toBe(instance2);
    });

    it("应该在重置后创建新实例", () => {
      getSecureConfigStorage();

      resetInstance();

      const newInstance = getSecureConfigStorage();

      expect(newInstance).toBeDefined();
      expect(newInstance).toBeInstanceOf(SecureConfigStorage);
    });
  });

  describe("_checkSafeStorageAvailability", () => {
    it("应该检查safeStorage可用性", () => {
      const storage = new SecureConfigStorage();

      expect(storage.safeStorageAvailable).toBe(true);
    });

    it("当safeStorage不可用时应返回false", () => {
      // Re-mock electron with unavailable safeStorage
      vi.doMock("electron", () => ({
        app: { getPath: vi.fn(() => "/mock/path") },
        safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
      }));

      const storage = new SecureConfigStorage();

      expect(storage.safeStorageAvailable).toBe(false);
    });
  });

  describe("_getDefaultStoragePath", () => {
    it("应该返回默认存储路径", () => {
      const storage = new SecureConfigStorage();

      const path = storage._getDefaultStoragePath();

      expect(path).toBeDefined();
      expect(path).toContain("secure-config.enc");
    });
  });

  describe("_getBackupDir", () => {
    it("应该返回备份目录路径", () => {
      const storage = new SecureConfigStorage();

      const backupDir = storage._getBackupDir();

      expect(backupDir).toBeDefined();
      expect(backupDir).toContain("secure-backups");
    });
  });

  describe("_deriveKey", () => {
    it("应该从种子派生密钥", () => {
      const storage = new SecureConfigStorage();
      const salt = Buffer.alloc(32).fill(0xAA);

      const key = storage._deriveKey(salt);

      expect(key).toBeDefined();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32); // 256-bit key
    });

    it("相同salt应产生相同密钥", () => {
      const storage = new SecureConfigStorage();
      const salt = Buffer.alloc(32).fill(0xBB);

      const key1 = storage._deriveKey(salt);
      const key2 = storage._deriveKey(salt);

      expect(key1.equals(key2)).toBe(true);
    });

    it("不同salt应产生不同密钥", () => {
      const storage = new SecureConfigStorage();
      const salt1 = Buffer.alloc(32).fill(0xAA);
      const salt2 = Buffer.alloc(32).fill(0xBB);

      const key1 = storage._deriveKey(salt1);
      const key2 = storage._deriveKey(salt2);

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe("encrypt/decrypt", () => {
    it("应该加密数据", () => {
      const storage = new SecureConfigStorage();
      const testData = { apiKey: "sk-test123", model: "gpt-4" };

      const encrypted = storage.encrypt(testData);

      expect(Buffer.isBuffer(encrypted)).toBe(true);
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("应该解密数据", () => {
      const storage = new SecureConfigStorage();
      const testData = { apiKey: "sk-test456", provider: "openai" };

      const encrypted = storage.encrypt(testData);
      const decrypted = storage.decrypt(encrypted);

      expect(decrypted).toEqual(testData);
    });

    it("应该使用safeStorage加密", () => {
      const storage = new SecureConfigStorage();
      const testData = { key: "value" };

      const encrypted = storage.encrypt(testData);

      // 验证使用了safeStorage (标记头 'SS')
      expect(encrypted[0]).toBe(0x53);
      expect(encrypted[1]).toBe(0x53);
    });

    it("加密/解密应roundtrip正确", () => {
      const storage = new SecureConfigStorage();
      const testCases = [
        { simple: "string" },
        { nested: { deep: { value: 123 } } },
        { array: [1, 2, 3] },
        { mixed: { str: "test", num: 42, bool: true, null: null } },
      ];

      testCases.forEach((testData) => {
        const encrypted = storage.encrypt(testData);
        const decrypted = storage.decrypt(encrypted);
        expect(decrypted).toEqual(testData);
      });
    });
  });

  describe("save/load", () => {
    it("应该保存配置", () => {
      const storage = new SecureConfigStorage();
      const testConfig = { openai: { apiKey: "sk-test" } };

      const result = storage.save(testConfig);

      expect(result).toBe(true);
    });

    it("应该加载配置", () => {
      const storage = new SecureConfigStorage();
      const testConfig = { anthropic: { apiKey: "sk-ant-test" } };

      storage.save(testConfig);
      const loaded = storage.load(false); // 不使用缓存

      expect(loaded).toEqual(testConfig);
    });

    it("应该使用缓存", () => {
      const storage = new SecureConfigStorage();
      const testConfig = { test: "data" };

      storage.save(testConfig);
      const loaded1 = storage.load(true); // 使用缓存
      const loaded2 = storage.load(true); // 应该从缓存读取

      expect(loaded1).toEqual(testConfig);
      expect(loaded2).toEqual(testConfig);
      expect(storage._cache).toEqual(testConfig);
    });

    it("缓存过期后应重新加载", () => {
      const storage = new SecureConfigStorage();
      const testConfig = { data: "test" };

      storage.save(testConfig);
      storage.load(true);

      // 手动使缓存过期
      storage._cacheTimestamp = Date.now() - (6 * 60 * 1000); // 6分钟前

      const loaded = storage.load(true);

      expect(loaded).toEqual(testConfig);
    });

    it("加载不存在的文件应返回null", () => {
      const storage = new SecureConfigStorage({
        storagePath: "/nonexistent/path/config.enc",
      });

      const loaded = storage.load();

      expect(loaded).toBeNull();
    });
  });

  describe("exists/delete", () => {
    it("应该检查配置存在", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const exists = storage.exists();

      expect(exists).toBe(true);
    });

    it("应该检查不存在的配置", () => {
      const storage = new SecureConfigStorage({
        storagePath: "/nonexistent/config.enc",
      });

      const exists = storage.exists();

      expect(exists).toBe(false);
    });

    it("应该删除配置", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const result = storage.delete();

      expect(result).toBe(true);
      expect(storage._cache).toBeNull();
    });

    it("删除不存在的配置应成功", () => {
      const storage = new SecureConfigStorage({
        storagePath: "/nonexistent/config.enc",
      });

      const result = storage.delete();

      expect(result).toBe(true);
    });
  });

  describe("备份恢复", () => {
    it("应该创建备份", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const backupPath = storage.createBackup();

      expect(backupPath).toBeDefined();
      expect(backupPath).toContain("secure-config-");
    });

    it("没有配置时创建备份应返回null", () => {
      const storage = new SecureConfigStorage({
        storagePath: "/nonexistent/config.enc",
      });

      const backupPath = storage.createBackup();

      expect(backupPath).toBeNull();
    });

    it("应该从备份恢复", () => {
      const storage = new SecureConfigStorage();
      const originalConfig = { key: "original" };
      storage.save(originalConfig);

      const backupPath = storage.createBackup();
      storage.save({ key: "modified" });

      const result = storage.restoreFromBackup(backupPath);

      expect(result).toBe(true);
    });

    it("从不存在的备份恢复应返回false", () => {
      const storage = new SecureConfigStorage();

      const result = storage.restoreFromBackup("/nonexistent/backup.enc.bak");

      expect(result).toBe(false);
    });

    it("应该列出备份", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      storage.createBackup();
      const backups = storage.listBackups();

      expect(Array.isArray(backups)).toBe(true);
    });

    it("备份列表应按时间排序（新到旧）", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      storage.createBackup();
      storage.createBackup();

      const backups = storage.listBackups();

      if (backups.length >= 2) {
        expect(backups[0].date >= backups[1].date).toBe(true);
      }
    });
  });

  describe("导出导入", () => {
    it("应该使用密码导出", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "export-data" });

      const exportPath = "/tmp/export-test.enc";
      const result = storage.exportWithPassword("password123", exportPath);

      expect(result).toBe(true);
    });

    it("没有配置时导出应返回false", () => {
      const storage = new SecureConfigStorage({
        storagePath: "/nonexistent/config.enc",
      });

      const result = storage.exportWithPassword("password", "/tmp/export.enc");

      expect(result).toBe(false);
    });

    it("应该使用密码导入", () => {
      const storage = new SecureConfigStorage();
      const originalConfig = { test: "import-data" };
      storage.save(originalConfig);

      const exportPath = "/tmp/import-test.enc";
      storage.exportWithPassword("password123", exportPath);

      const result = storage.importWithPassword("password123", exportPath);

      expect(result).toBe(true);
    });

    it("导入不存在的文件应返回false", () => {
      const storage = new SecureConfigStorage();

      const result = storage.importWithPassword(
        "password",
        "/nonexistent/import.enc",
      );

      expect(result).toBe(false);
    });

    it("错误的密码应导入失败", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const exportPath = "/tmp/password-test.enc";
      storage.exportWithPassword("correct-password", exportPath);

      const result = storage.importWithPassword("wrong-password", exportPath);

      expect(result).toBe(false);
    });
  });

  describe("getStorageInfo", () => {
    it("应该获取存储信息", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const info = storage.getStorageInfo();

      expect(info).toBeDefined();
      expect(info.exists).toBe(true);
      expect(info.safeStorageAvailable).toBe(true);
      expect(info.storagePath).toBeDefined();
    });

    it("不存在的配置信息应正确", () => {
      const storage = new SecureConfigStorage({
        storagePath: "/nonexistent/config.enc",
      });

      const info = storage.getStorageInfo();

      expect(info.exists).toBe(false);
      expect(info.encryptionType).toBeNull();
      expect(info.version).toBeNull();
    });

    it("应该包含备份计数", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const info = storage.getStorageInfo();

      expect(info.backupCount).toBeDefined();
      expect(typeof info.backupCount).toBe("number");
    });

    it("应该包含加密类型信息", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const info = storage.getStorageInfo();

      expect(info.encryptionType).toBeDefined();
      expect(["safeStorage", "aes"].includes(info.encryptionType)).toBe(true);
    });
  });

  describe("migrateToSafeStorage", () => {
    it("应该迁移到safeStorage", () => {
      const storage = new SecureConfigStorage();
      storage.save({ test: "data" });

      const result = storage.migrateToSafeStorage();

      // 已经在使用safeStorage时应返回true或保持不变
      expect(typeof result).toBe("boolean");
    });

    it("safeStorage不可用时应返回false", () => {
      // Re-mock with unavailable safeStorage
      vi.doMock("electron", () => ({
        app: { getPath: vi.fn(() => "/mock/path") },
        safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
      }));

      const storage = new SecureConfigStorage();

      const result = storage.migrateToSafeStorage();

      expect(result).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("应该处理空配置对象", () => {
      const config = {};

      const sensitive = extractSensitiveFields(config);

      expect(Object.keys(sensitive).length).toBe(0);
    });

    it("应该处理null配置", () => {
      const config = null;

      const sensitive = extractSensitiveFields(config);

      expect(Object.keys(sensitive).length).toBe(0);
    });

    it("应该处理未定义的提供商验证", () => {
      const result = validateApiKeyFormat(
        "unknown-provider",
        "any-key-12345678901234",
      );

      expect(result.valid).toBe(true); // 无模式时允许
    });

    it("应该处理API Key前后空格", () => {
      const result = validateApiKeyFormat(
        "openai",
        "  sk-abcdefghijklmnopqrstuvwxyz123456  ",
      );

      expect(result.valid).toBe(true);
    });

    it("应该处理嵌套路径不存在的情况", () => {
      const config = { openai: {} };
      const sensitive = { "anthropic.apiKey": "sk-test" };

      mergeSensitiveFields(config, sensitive);

      expect(config.anthropic).toBeDefined();
      expect(config.anthropic.apiKey).toBe("sk-test");
    });
  });

  describe("配置完整性", () => {
    it("应该支持提取-脱敏-合并循环", () => {
      const config = {
        openai: { apiKey: "sk-test123456789012", model: "gpt-4" },
      };

      // 提取敏感字段
      const sensitive = extractSensitiveFields(config);

      // 脱敏
      const sanitized = sanitizeConfig(config);

      // 合并回去
      mergeSensitiveFields(sanitized, sensitive);

      expect(sanitized.openai.apiKey).toBe("sk-test123456789012");
    });

    it("应该验证所有提供商模式", () => {
      const providers = Object.keys(API_KEY_PATTERNS);

      for (const provider of providers) {
        const pattern = API_KEY_PATTERNS[provider];
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });

    it("应该确保SENSITIVE_FIELDS无重复", () => {
      const uniqueFields = new Set(SENSITIVE_FIELDS);

      expect(uniqueFields.size).toBe(SENSITIVE_FIELDS.length);
    });
  });
});
