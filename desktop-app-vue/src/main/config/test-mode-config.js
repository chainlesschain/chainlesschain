/**
 * 测试模式配置
 * 根据环境变量启用不同的Mock服务
 */

const path = require("path");

class TestModeConfig {
  constructor() {
    this.isTestMode = process.env.NODE_ENV === "test";
    this.skipSlowInit = process.env.SKIP_SLOW_INIT === "true";
    this.mockHardware = process.env.MOCK_HARDWARE === "true";
    this.mockLLM = process.env.MOCK_LLM === "true";
    this.mockDatabase = process.env.MOCK_DATABASE === "true";
  }

  /**
   * 是否应该跳过某个初始化步骤
   */
  shouldSkipInit(initName) {
    if (!this.isTestMode && !this.skipSlowInit) {
      return false;
    }

    // 测试模式下跳过的慢速初始化
    const slowInits = [
      "backend-services", // 后端服务启动
      "plugin-system", // 插件系统
      "auto-update", // 自动更新检查
      "tray-icon", // 托盘图标
      "native-messaging", // 原生消息服务器
      "p2p-network", // P2P网络
      "blockchain", // 区块链服务
    ];

    return slowInits.includes(initName);
  }

  /**
   * 获取Mock LLM服务
   */
  getMockLLMService() {
    if (!this.mockLLM) {
      return null;
    }

    try {
      // 🔥 修复：使用正确的相对路径（从 dist/main/config/ 到 tests/mocks/）
      const MockLLMService = require("../../../tests/mocks/mock-llm-service");
      return new MockLLMService();
    } catch (error) {
      console.error("[TestMode] Failed to load Mock LLM Service:", error);
      console.error("[TestMode] Error details:", error.message);
      console.error("[TestMode] Stack:", error.stack);
      return null;
    }
  }

  /**
   * 获取Mock数据库
   */
  getMockDatabase() {
    if (!this.mockDatabase) {
      return null;
    }

    try {
      // 🔥 修复：使用正确的相对路径（从 dist/main/config/ 到 tests/mocks/）
      const MockDatabase = require("../../../tests/mocks/mock-database");
      return new MockDatabase();
    } catch (error) {
      console.error("[TestMode] Failed to load Mock Database:", error);
      return null;
    }
  }

  /**
   * 获取Mock U-Key Manager
   */
  getMockUKeyManager() {
    if (!this.mockHardware) {
      return null;
    }

    // 返回一个简单的mock对象
    return {
      initialized: true,
      isSimulationMode: true,
      isPinVerified: true,
      getPublicKey: async () => "mock-public-key",
      sign: async (data) => `mock-signature-${data.substring(0, 10)}`,
      verify: async () => true,
      listDevices: async () => [],
      getDeviceInfo: async () => ({
        deviceName: "Mock U-Key Device",
        serialNumber: "MOCK-12345",
        version: "1.0.0-mock",
      }),
    };
  }

  /**
   * 打印测试模式配置
   */
  printConfig() {
    console.log("\n========== 测试模式配置 ==========");
    console.log("测试模式:", this.isTestMode ? "✓ 已启用" : "✗ 未启用");
    console.log("跳过慢速初始化:", this.skipSlowInit ? "✓ 是" : "✗ 否");
    console.log("Mock硬件:", this.mockHardware ? "✓ 是" : "✗ 否");
    console.log("Mock LLM:", this.mockLLM ? "✓ 是" : "✗ 否");
    console.log("Mock数据库:", this.mockDatabase ? "✓ 是" : "✗ 否");
    console.log("==================================\n");
  }
}

// 导出单例
let testModeConfig = null;

function getTestModeConfig() {
  if (!testModeConfig) {
    testModeConfig = new TestModeConfig();
  }
  return testModeConfig;
}

module.exports = {
  TestModeConfig,
  getTestModeConfig,
};
