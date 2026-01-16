/**
 * 安全存储模块测试脚本
 *
 * 测试内容：
 * 1. 基本加密/解密功能
 * 2. safeStorage 集成
 * 3. 备份和恢复
 * 4. 导出和导入
 * 5. API Key 格式验证
 * 6. 旧版本兼容性
 *
 * 运行方式：
 *   cd desktop-app-vue
 *   npm run test:secure-storage
 *   # 或
 *   node scripts/test-secure-storage.js
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");

// 模拟 Electron 环境
const mockApp = {
  getPath: (name) => {
    if (name === "userData") {
      return path.join(os.tmpdir(), "chainlesschain-test");
    }
    return os.tmpdir();
  },
};

// 模拟 safeStorage（测试环境不可用）
const mockSafeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("Not available in test");
  },
  decryptString: () => {
    throw new Error("Not available in test");
  },
};

// 注入模拟
require.cache[require.resolve("electron")] = {
  exports: {
    app: mockApp,
    safeStorage: mockSafeStorage,
  },
};

// 导入被测模块
const {
  SecureConfigStorage,
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
} = require("../src/main/llm/secure-config-storage");

// 测试计数器
let passed = 0;
let failed = 0;

/**
 * 断言函数
 */
function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failed++;
  }
}

/**
 * 测试组标题
 */
function describe(name, fn) {
  console.log(`\n▶ ${name}`);
  fn();
}

/**
 * 清理测试目录
 */
function cleanup() {
  const testDir = mockApp.getPath("userData");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
  resetInstance();
}

// 开始测试
console.log("═══════════════════════════════════════════════════════");
console.log("        安全存储模块测试 (SecureConfigStorage)         ");
console.log("═══════════════════════════════════════════════════════");

// 清理环境
cleanup();

describe("基本加密/解密功能", () => {
  const storage = new SecureConfigStorage({
    storagePath: path.join(mockApp.getPath("userData"), "test-config.enc"),
  });

  const testData = {
    "openai.apiKey": "sk-test1234567890abcdefghijklmnopqrstuvwxyz",
    "volcengine.apiKey": "12345678-1234-1234-1234-123456789abc",
    nested: {
      deep: {
        value: "secret",
      },
    },
  };

  // 测试加密
  const encrypted = storage.encrypt(testData);
  assert(Buffer.isBuffer(encrypted), "加密返回 Buffer");
  assert(encrypted.length > 0, "加密数据非空");

  // 测试解密
  const decrypted = storage.decrypt(encrypted);
  assert(
    JSON.stringify(decrypted) === JSON.stringify(testData),
    "解密数据与原数据一致",
  );

  // 测试保存和加载
  const saveResult = storage.save(testData);
  assert(saveResult === true, "保存成功");
  assert(storage.exists() === true, "文件存在");

  const loaded = storage.load();
  assert(
    JSON.stringify(loaded) === JSON.stringify(testData),
    "加载数据与原数据一致",
  );

  // 测试删除
  const deleteResult = storage.delete();
  assert(deleteResult === true, "删除成功");
  assert(storage.exists() === false, "文件已删除");
});

describe("缓存功能", () => {
  cleanup();
  const storage = new SecureConfigStorage({
    storagePath: path.join(mockApp.getPath("userData"), "cache-test.enc"),
  });

  const testData = { key: "value" };
  storage.save(testData);

  // 首次加载
  const load1 = storage.load(true);
  assert(load1.key === "value", "首次加载成功");

  // 使用缓存加载
  const load2 = storage.load(true);
  assert(load2.key === "value", "缓存加载成功");

  // 清除缓存
  storage.clearCache();
  const load3 = storage.load(false);
  assert(load3.key === "value", "强制刷新加载成功");
});

describe("备份和恢复功能", () => {
  cleanup();
  const storage = new SecureConfigStorage({
    storagePath: path.join(mockApp.getPath("userData"), "backup-test.enc"),
  });

  const testData = { original: "data" };
  storage.save(testData);

  // 创建备份
  const backupPath = storage.createBackup();
  assert(backupPath !== null, "备份创建成功");
  assert(fs.existsSync(backupPath), "备份文件存在");

  // 列出备份
  const backups = storage.listBackups();
  assert(backups.length === 1, "备份列表正确");

  // 修改原数据
  storage.save({ modified: "data" });
  const modified = storage.load();
  assert(modified.modified === "data", "数据已修改");

  // 从备份恢复
  const restoreResult = storage.restoreFromBackup(backupPath);
  assert(restoreResult === true, "恢复成功");

  const restored = storage.load();
  assert(restored.original === "data", "数据已恢复");
});

describe("导出和导入功能", () => {
  cleanup();
  const storage = new SecureConfigStorage({
    storagePath: path.join(mockApp.getPath("userData"), "export-test.enc"),
  });

  const testData = {
    "openai.apiKey": "sk-exporttest123456789012345678901234",
    "volcengine.apiKey": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  };
  storage.save(testData);

  const exportPath = path.join(mockApp.getPath("userData"), "exported.enc");
  const password = "test-password-123";

  // 导出
  const exportResult = storage.exportWithPassword(password, exportPath);
  assert(exportResult === true, "导出成功");
  assert(fs.existsSync(exportPath), "导出文件存在");

  // 验证导出文件格式
  const exportedData = fs.readFileSync(exportPath);
  assert(
    exportedData.subarray(0, 2).toString("ascii") === "EX",
    "导出文件格式正确",
  );

  // 删除原配置
  storage.delete();

  // 导入
  const importResult = storage.importWithPassword(password, exportPath);
  assert(importResult === true, "导入成功");

  const imported = storage.load();
  assert(
    imported["openai.apiKey"] === testData["openai.apiKey"],
    "导入数据正确",
  );

  // 测试错误密码
  const wrongImport = storage.importWithPassword("wrong-password", exportPath);
  assert(wrongImport === false, "错误密码导入失败");
});

describe("API Key 格式验证", () => {
  // OpenAI
  let result = validateApiKeyFormat(
    "openai",
    "sk-abc123def456ghi789jkl012mno345pqr678",
  );
  assert(result.valid === true, "OpenAI 有效格式验证通过");

  result = validateApiKeyFormat("openai", "invalid-key");
  assert(result.valid === false, "OpenAI 无效格式验证失败");

  // Anthropic
  result = validateApiKeyFormat(
    "anthropic",
    "sk-ant-api03-abc123def456ghi789jkl012mno345",
  );
  assert(result.valid === true, "Anthropic 有效格式验证通过");

  // Volcengine (UUID)
  result = validateApiKeyFormat(
    "volcengine",
    "12345678-1234-1234-1234-123456789abc",
  );
  assert(result.valid === true, "火山引擎 UUID 格式验证通过");

  result = validateApiKeyFormat("volcengine", "not-a-uuid");
  assert(result.valid === false, "火山引擎无效格式验证失败");

  // 空值检查
  result = validateApiKeyFormat("openai", "");
  assert(result.valid === false, "空 API Key 验证失败");

  result = validateApiKeyFormat("openai", null);
  assert(result.valid === false, "null API Key 验证失败");

  // 长度检查
  result = validateApiKeyFormat("openai", "short");
  assert(result.valid === false, "过短 API Key 验证失败");
});

describe("敏感字段处理", () => {
  // 检查敏感字段列表
  assert(SENSITIVE_FIELDS.includes("openai.apiKey"), "包含 openai.apiKey");
  assert(
    SENSITIVE_FIELDS.includes("anthropic.apiKey"),
    "包含 anthropic.apiKey",
  );
  assert(
    SENSITIVE_FIELDS.includes("volcengine.apiKey"),
    "包含 volcengine.apiKey",
  );
  assert(SENSITIVE_FIELDS.includes("zhipuai.apiKey"), "包含 zhipuai.apiKey");

  // 提取敏感字段
  const config = {
    openai: { apiKey: "sk-test123", model: "gpt-4" },
    volcengine: { apiKey: "uuid-test", baseURL: "https://..." },
    nonSensitive: "data",
  };

  const sensitive = extractSensitiveFields(config);
  assert(sensitive["openai.apiKey"] === "sk-test123", "提取 OpenAI Key");
  assert(sensitive["volcengine.apiKey"] === "uuid-test", "提取火山引擎 Key");
  assert(!("nonSensitive" in sensitive), "非敏感字段未被提取");

  // 合并敏感字段
  const target = { openai: { model: "gpt-4" } };
  mergeSensitiveFields(target, { "openai.apiKey": "merged-key" });
  assert(target.openai.apiKey === "merged-key", "合并敏感字段成功");
  assert(target.openai.model === "gpt-4", "原有字段保留");

  // 脱敏处理
  const toSanitize = {
    openai: { apiKey: "sk-verylongapikey1234567890abcdef" },
  };
  const sanitized = sanitizeConfig(toSanitize);
  assert(sanitized.openai.apiKey.includes("****"), "脱敏成功");
  assert(!sanitized.openai.apiKey.includes("verylongapikey"), "原值已隐藏");

  // 检查敏感字段
  assert(
    isSensitiveField("openai.apiKey") === true,
    "openai.apiKey 是敏感字段",
  );
  assert(
    isSensitiveField("openai.model") === false,
    "openai.model 不是敏感字段",
  );

  // 获取提供商敏感字段
  const baiduFields = getProviderSensitiveFields("baidu");
  assert(baiduFields.includes("baidu.apiKey"), "包含 baidu.apiKey");
  assert(baiduFields.includes("baidu.secretKey"), "包含 baidu.secretKey");
});

describe("存储信息", () => {
  cleanup();
  const storage = new SecureConfigStorage({
    storagePath: path.join(mockApp.getPath("userData"), "info-test.enc"),
  });

  // 空存储
  let info = storage.getStorageInfo();
  assert(info.exists === false, "空存储：exists 为 false");
  assert(info.safeStorageAvailable === false, "测试环境：safeStorage 不可用");

  // 保存后
  storage.save({ test: "data" });
  info = storage.getStorageInfo();
  assert(info.exists === true, "保存后：exists 为 true");
  assert(info.encryptionType === "aes", "加密类型为 aes");
  assert(info.version === 2, "版本为 2");
  assert(info.size > 0, "文件大小大于 0");
});

describe("旧版本兼容性", () => {
  cleanup();
  const storage = new SecureConfigStorage({
    storagePath: path.join(mockApp.getPath("userData"), "legacy-test.enc"),
  });

  // 创建旧版本格式的加密数据（使用 v2 密钥种子，但无标记头）
  const testData = { legacy: "data" };
  const SALT_LENGTH = 32;
  const IV_LENGTH = 16;
  const ALGORITHM = "aes-256-gcm";
  const KEY_LENGTH = 32;
  const ITERATIONS = 100000;

  // 模拟旧版本加密（无标记头，但使用 v2 密钥种子以匹配当前 _decryptLegacy）
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  // 注意：旧版本兼容性实际上需要当前实现使用相同的种子
  // 这里测试的是无标记头的旧格式，密钥种子需要与 _deriveKey 一致
  const seed = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.homedir(),
    JSON.stringify(
      os
        .cpus()
        .map((c) => c.model)
        .slice(0, 1),
    ),
    "chainlesschain-llm-config-v2", // 使用当前版本的种子
  ].join("|");
  const key = crypto.pbkdf2Sync(seed, salt, ITERATIONS, KEY_LENGTH, "sha256");

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(testData), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // 旧格式: salt + iv + authTag + encrypted（无标记头）
  const legacyData = Buffer.concat([salt, iv, authTag, encrypted]);

  // 保存旧格式数据
  fs.writeFileSync(storage.storagePath, legacyData);

  // 尝试加载
  const loaded = storage.load();
  assert(loaded !== null, "旧格式数据可加载");
  assert(loaded && loaded.legacy === "data", "旧格式数据正确解密");
});

describe("单例模式", () => {
  cleanup();
  const storage1 = getSecureConfigStorage();
  const storage2 = getSecureConfigStorage();
  assert(storage1 === storage2, "单例模式返回同一实例");

  resetInstance();
  const storage3 = getSecureConfigStorage();
  assert(storage1 !== storage3, "重置后返回新实例");
});

describe("错误处理", () => {
  cleanup();
  const storage = new SecureConfigStorage({
    storagePath: path.join(mockApp.getPath("userData"), "error-test.enc"),
  });

  // 加载不存在的文件
  const loaded = storage.load();
  assert(loaded === null, "加载不存在的文件返回 null");

  // 从不存在的备份恢复
  const restoreResult = storage.restoreFromBackup("/nonexistent/path.bak");
  assert(restoreResult === false, "从不存在的备份恢复失败");

  // 解密损坏的数据
  let decryptError = false;
  try {
    storage.decrypt(Buffer.from("corrupted data"));
  } catch (e) {
    decryptError = true;
  }
  assert(decryptError === true, "解密损坏数据抛出异常");
});

// 清理
cleanup();

// 输出结果
console.log("\n═══════════════════════════════════════════════════════");
console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
console.log("═══════════════════════════════════════════════════════");

// 退出码
process.exit(failed > 0 ? 1 : 0);
