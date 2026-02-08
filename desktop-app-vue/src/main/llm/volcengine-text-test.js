/**
 * 火山引擎文本功能测试脚本
 *
 * 测试内容：
 * 1. 模块导入
 * 2. 智能模型选择器
 * 3. 文本对话功能（如果配置了API Key）
 */

const { logger } = require("../utils/logger.js");
const path = require("path");
const fs = require("fs");

// Mock Electron app for testing in Node.js
const mockApp = {
  getPath: (name) => {
    const userDataPath = path.join(__dirname, "../../../test-userdata");
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    return userDataPath;
  },
};

// 暂时 mock electron 模块
require.cache[require.resolve("electron")] = {
  exports: { app: mockApp, ipcMain: {} },
};

const { getModelSelector, TaskTypes } = require("./volcengine-models");
const { VolcengineToolsClient } = require("./volcengine-tools");
const { getLLMConfig } = require("./llm-config");

logger.info("========================================");
logger.info("火山引擎文本功能测试");
logger.info("========================================\n");

// ========== 测试 1: 模块导入 ==========
logger.info("【测试 1】模块导入检查");
logger.info("------------------");

try {
  logger.info("✓ volcengine-models 导入成功");
  logger.info("✓ volcengine-tools 导入成功");
  logger.info("✓ llm-config 导入成功");
  logger.info(
    "✓ TaskTypes 枚举可用:",
    Object.keys(TaskTypes).slice(0, 5).join(", ") + "...",
  );
  logger.info("");
} catch (error) {
  logger.error("✗ 模块导入失败:", error.message);
  process.exit(1);
}

// ========== 测试 2: 智能模型选择器 ==========
logger.info("【测试 2】智能模型选择器");
logger.info("------------------");

try {
  const selector = getModelSelector();

  // 测试场景1: 低成本对话
  logger.info("\n场景1: 低成本AI对话");
  const lowCostModel = selector.selectByScenario({
    userBudget: "low",
  });
  logger.info("✓ 选择模型:", lowCostModel.name);
  logger.info("  模型ID:", lowCostModel.id);
  logger.info("  价格:", `¥${lowCostModel.pricing.input}/百万tokens（输入）`);
  logger.info("  上下文:", lowCostModel.contextLength);

  // 测试场景2: 高质量对话（深度思考）
  logger.info("\n场景2: 高质量对话（深度思考）");
  const highQualityModel = selector.selectByScenario({
    needsThinking: true,
    userBudget: "high",
  });
  logger.info("✓ 选择模型:", highQualityModel.name);
  logger.info("  能力:", highQualityModel.capabilities.join(", "));
  logger.info("  思考模式:", highQualityModel.thinkingMode || "N/A");

  // 测试场景3: 长文本处理
  logger.info("\n场景3: 长文本处理（200K上下文）");
  const longContextModel = selector.selectModel(TaskTypes.LONG_CONTEXT, {
    contextLength: 200000,
    preferQuality: true,
  });
  logger.info("✓ 选择模型:", longContextModel.name);
  logger.info("  最大上下文:", longContextModel.contextLength);

  // 测试场景4: 快速响应
  logger.info("\n场景4: 快速响应（低延迟）");
  const fastModel = selector.selectModel(TaskTypes.FAST_RESPONSE, {
    preferSpeed: true,
  });
  logger.info("✓ 选择模型:", fastModel.name);
  logger.info("  特点:", fastModel.description);

  // 测试场景5: 代码生成
  logger.info("\n场景5: 代码生成");
  const codeModel = selector.selectModel(TaskTypes.CODE_WRITING, {
    preferQuality: true,
  });
  logger.info("✓ 选择模型:", codeModel.name);
  logger.info("  上下文:", codeModel.contextLength);

  logger.info("\n✓ 智能模型选择器测试通过");
  logger.info("");
} catch (error) {
  logger.error("✗ 智能模型选择器测试失败:", error.message);
  logger.error(error.stack);
  process.exit(1);
}

// ========== 测试 3: 成本估算 ==========
logger.info("【测试 3】成本估算功能");
logger.info("------------------");

try {
  const selector = getModelSelector();

  // 场景: 100K输入 + 30K输出
  const modelId = "doubao-seed-1.6";
  const cost = selector.estimateCost(
    modelId,
    100000, // 输入tokens
    30000, // 输出tokens
    0, // 图片数量
  );

  logger.info("\n成本估算示例:");
  logger.info("  模型:", modelId);
  logger.info("  输入: 100,000 tokens");
  logger.info("  输出: 30,000 tokens");
  logger.info("  预估成本: ¥" + cost.toFixed(4));

  // 对比不同模型成本
  logger.info("\n成本对比（100K输入 + 30K输出）:");
  const models = [
    "doubao-seed-1.6-lite",
    "doubao-seed-1.6",
    "doubao-seed-1.6-thinking",
  ];

  models.forEach((mid) => {
    const c = selector.estimateCost(mid, 100000, 30000, 0);
    const m = selector.getModelDetails(mid);
    logger.info(`  ${m.name.padEnd(30)} ¥${c.toFixed(4)}`);
  });

  logger.info("\n✓ 成本估算功能测试通过");
  logger.info("");
} catch (error) {
  logger.error("✗ 成本估算测试失败:", error.message);
  process.exit(1);
}

// ========== 测试 4: 列出模型 ==========
logger.info("【测试 4】列出模型功能");
logger.info("------------------");

try {
  const selector = getModelSelector();

  // 列出所有推荐模型
  const recommendedModels = selector.listModels({ recommended: true });
  logger.info(`\n推荐模型列表（共${recommendedModels.length}个）:`);
  recommendedModels.forEach((m) => {
    logger.info(`  ✓ ${m.name} (${m.type})`);
    logger.info(`    ID: ${m.id}`);
    logger.info(`    价格: ¥${m.pricing.input}/百万tokens`);
  });

  // 列出所有文本生成模型
  const textModels = selector.listModels({ type: "text" });
  logger.info(`\n文本生成模型（共${textModels.length}个）:`);
  textModels.slice(0, 3).forEach((m) => {
    logger.info(`  - ${m.name}`);
  });

  logger.info("\n✓ 列出模型功能测试通过");
  logger.info("");
} catch (error) {
  logger.error("✗ 列出模型测试失败:", error.message);
  process.exit(1);
}

// ========== 测试 5: 配置检查 ==========
logger.info("【测试 5】配置检查");
logger.info("------------------");

let hasApiKey = false;
let apiKey = "";

try {
  const llmConfig = getLLMConfig();
  const volcengineConfig = llmConfig.getProviderConfig("volcengine");

  logger.info("\n当前配置:");
  logger.info("  Base URL:", volcengineConfig.baseURL);
  logger.info("  Model:", volcengineConfig.model);
  logger.info("  Embedding Model:", volcengineConfig.embeddingModel);

  if (volcengineConfig.apiKey && volcengineConfig.apiKey.length > 0) {
    hasApiKey = true;
    apiKey = volcengineConfig.apiKey;
    logger.info("  API Key: ✓ 已配置 (" + apiKey.substring(0, 10) + "...)");
  } else {
    logger.info("  API Key: ✗ 未配置");
    logger.info("\n  提示: 如需测试实际API调用，请先配置API Key");
    logger.info("  可以通过以下方式配置:");
    logger.info("  1. 在桌面应用设置中配置");
    logger.info("  2. 修改 llm-config.json 文件");
  }

  logger.info("\n✓ 配置检查完成");
  logger.info("");
} catch (error) {
  logger.error("✗ 配置检查失败:", error.message);
}

// ========== 测试 6: 实际API调用（如果有API Key）==========
if (hasApiKey) {
  logger.info("【测试 6】实际API调用测试");
  logger.info("------------------");

  (async () => {
    try {
      const client = new VolcengineToolsClient({
        apiKey: apiKey,
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-seed-1.6",
      });

      logger.info("\n测试1: 简单文本对话");
      logger.info("问题: 你好，请用一句话介绍你自己");

      const messages = [
        { role: "user", content: "你好，请用一句话介绍你自己" },
      ];

      // 调用API
      const result = await client._callAPI("/chat/completions", {
        model: "doubao-seed-1.6",
        messages: messages,
      });

      if (result && result.choices && result.choices[0]) {
        logger.info("✓ API调用成功");
        logger.info("AI回答:", result.choices[0].message.content);
        logger.info("模型:", result.model);
        logger.info("使用tokens:", result.usage?.total_tokens || "N/A");
      } else {
        logger.info("✗ API返回格式异常");
        logger.info("返回结果:", JSON.stringify(result, null, 2));
      }

      logger.info("\n测试2: 多轮对话");
      const conversation = [
        { role: "user", content: "请告诉我今天是星期几？" },
        { role: "assistant", content: "今天是星期六。" },
        { role: "user", content: "那明天呢？" },
      ];

      const result2 = await client._callAPI("/chat/completions", {
        model: "doubao-seed-1.6",
        messages: conversation,
      });

      if (result2 && result2.choices && result2.choices[0]) {
        logger.info("✓ 多轮对话成功");
        logger.info("AI回答:", result2.choices[0].message.content);
      }

      logger.info("\n测试3: 不同温度参数");
      const creativeResult = await client._callAPI("/chat/completions", {
        model: "doubao-seed-1.6",
        messages: [{ role: "user", content: "用一句话描述春天" }],
        temperature: 0.9, // 高温度，更有创意
      });

      if (
        creativeResult &&
        creativeResult.choices &&
        creativeResult.choices[0]
      ) {
        logger.info("✓ 温度参数测试成功");
        logger.info(
          "AI回答（temperature=0.9）:",
          creativeResult.choices[0].message.content,
        );
      }

      logger.info("\n✓ 实际API调用测试通过");
      logger.info("");
    } catch (error) {
      logger.error("✗ API调用测试失败:", error.message);
      logger.error("错误详情:", error);

      // 检查是否是认证错误
      if (error.message.includes("401") || error.message.includes("认证")) {
        logger.info("\n提示: API Key可能无效或已过期，请检查配置");
      }
      if (
        error.message.includes("ENOTFOUND") ||
        error.message.includes("timeout")
      ) {
        logger.info("\n提示: 网络连接问题，请检查网络或代理设置");
      }
    }

    // 完成所有测试
    logger.info("========================================");
    logger.info("测试完成！");
    logger.info("========================================");
  })();
} else {
  logger.info("【测试 6】实际API调用测试");
  logger.info("------------------");
  logger.info("⊘ 跳过（未配置API Key）");
  logger.info("");

  logger.info("========================================");
  logger.info("测试完成！（基础功能测试通过）");
  logger.info("========================================");
  logger.info("\n提示: 要测试实际API调用，请先配置火山引擎API Key");
}
