/**
 * LLM IPC handlers — test-data group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-test-data
 */
const { logger } = require("../utils/logger.js");

function registerTestDataHandlers(ctx) {
  const { ipcMain, database } = ctx;

  // ============================================================
  // Test Data Generation (测试数据生成)
  // ============================================================

  /**
   * 生成 LLM 测试数据（仅用于开发测试）
   * Channel: 'llm:generate-test-data'
   */
  ipcMain.handle("llm:generate-test-data", async (_event, options = {}) => {
    const { days = 30, recordsPerDay = 50, clear = false } = options;

    if (!database) {
      throw new Error("数据库未初始化");
    }

    const { v4: uuidv4 } = require("uuid");

    // 定价数据
    const PRICING = {
      ollama: {
        "qwen2:7b": { input: 0, output: 0 },
        "llama3:8b": { input: 0, output: 0 },
        "mistral:7b": { input: 0, output: 0 },
      },
      openai: {
        "gpt-4o": { input: 2.5, output: 10.0 },
        "gpt-4o-mini": { input: 0.15, output: 0.6 },
        "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
      },
      anthropic: {
        "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
        "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
        "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
      },
      deepseek: {
        "deepseek-chat": { input: 0.14, output: 0.28 },
        "deepseek-coder": { input: 0.14, output: 0.28 },
      },
    };

    const EXCHANGE_RATE = 7.2;
    const randomInt = (min, max) =>
      Math.floor(Math.random() * (max - min + 1)) + min;
    const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const calculateCost = (provider, model, inputTokens, outputTokens) => {
      const pricing = PRICING[provider]?.[model];
      if (!pricing) {
        return { costUsd: 0, costCny: 0 };
      }
      const inputCost = (inputTokens / 1_000_000) * pricing.input;
      const outputCost = (outputTokens / 1_000_000) * pricing.output;
      const costUsd = inputCost + outputCost;
      return { costUsd, costCny: costUsd * EXCHANGE_RATE };
    };

    try {
      if (clear) {
        database.prepare("DELETE FROM llm_usage_log").run();
        logger.info("[LLM IPC] 已清除现有测试数据");
      }

      const now = Date.now();
      const msPerDay = 24 * 60 * 60 * 1000;
      const providers = Object.keys(PRICING);

      const insert = database.prepare(`
          INSERT INTO llm_usage_log (
            id, conversation_id, message_id, provider, model,
            input_tokens, output_tokens, total_tokens, cached_tokens,
            cost_usd, cost_cny,
            was_cached, was_compressed, compression_ratio,
            latency_ms, response_time,
            endpoint, user_id, session_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

      const insertMany = database.transaction((records) => {
        for (const r of records) {
          insert.run(...r);
        }
      });

      const records = [];
      let totalRecords = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;

      for (let day = 0; day < days; day++) {
        const dailyRecords = recordsPerDay + randomInt(-20, 20);

        for (let i = 0; i < dailyRecords; i++) {
          const provider = randomChoice(providers);
          const models = Object.keys(PRICING[provider]);
          const model = randomChoice(models);

          const inputTokens = randomInt(100, 4000);
          const outputTokens = randomInt(50, 2000);
          const totalTokensVal = inputTokens + outputTokens;
          const cachedTokens =
            Math.random() > 0.7 ? randomInt(0, inputTokens / 2) : 0;

          const { costUsd, costCny } = calculateCost(
            provider,
            model,
            inputTokens,
            outputTokens,
          );

          const dayStart = now - (day + 1) * msPerDay;
          const timestamp = dayStart + randomInt(0, msPerDay);

          const wasCached = Math.random() > 0.85 ? 1 : 0;
          const wasCompressed = Math.random() > 0.7 ? 1 : 0;
          const compressionRatio = wasCompressed
            ? 0.5 + Math.random() * 0.4
            : 1.0;
          const latencyMs = randomInt(200, 5000);

          records.push([
            uuidv4(),
            `conv-test-${randomInt(1, 100)}`,
            `msg-${uuidv4().slice(0, 8)}`,
            provider,
            model,
            inputTokens,
            outputTokens,
            totalTokensVal,
            cachedTokens,
            costUsd,
            costCny,
            wasCached,
            wasCompressed,
            compressionRatio,
            latencyMs,
            latencyMs,
            null,
            "default",
            null,
            timestamp,
          ]);

          totalRecords++;
          totalTokens += totalTokensVal;
          totalCostUsd += costUsd;
        }
      }

      insertMany(records);

      logger.info(
        `[LLM IPC] 测试数据生成完成: ${totalRecords} 条记录, ${totalTokens} tokens, $${totalCostUsd.toFixed(4)}`,
      );

      return {
        success: true,
        totalRecords,
        totalTokens,
        totalCostUsd,
        totalCostCny: totalCostUsd * EXCHANGE_RATE,
      };
    } catch (error) {
      logger.error("[LLM IPC] 生成测试数据失败:", error);
      throw error;
    }
  });
}

module.exports = { registerTestDataHandlers };
