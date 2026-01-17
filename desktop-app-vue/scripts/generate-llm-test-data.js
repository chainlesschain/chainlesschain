/**
 * LLM 性能页面测试数据生成脚本
 *
 * 用法: node scripts/generate-llm-test-data.js
 *
 * 生成内容:
 * - 最近 30 天的 LLM 使用记录
 * - 多个提供商 (ollama, openai, anthropic, deepseek)
 * - 多个模型
 * - 随机的 Token 使用和成本数据
 */

const path = require("path");
const { v4: uuidv4 } = require("uuid");

// 获取数据库路径 (Electron 用户数据目录)
const os = require("os");
const userDataDir =
  process.platform === "win32"
    ? path.join(
        os.homedir(),
        "AppData",
        "Roaming",
        "chainlesschain-desktop-vue",
      )
    : process.platform === "darwin"
      ? path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "chainlesschain-desktop-vue",
        )
      : path.join(os.homedir(), ".config", "chainlesschain-desktop-vue");
const dataDir = path.join(userDataDir, "data");
const dbPath = path.join(dataDir, "chainlesschain.db");

// 使用 better-sqlite3 (从 workspace root 的 node_modules 加载)
let Database;
const modulePaths = [
  path.join(
    __dirname,
    "..",
    "..",
    "node_modules",
    "better-sqlite3-multiple-ciphers",
  ),
  path.join(__dirname, "..", "..", "node_modules", "better-sqlite3"),
  path.join(__dirname, "..", "node_modules", "better-sqlite3-multiple-ciphers"),
  path.join(__dirname, "..", "node_modules", "better-sqlite3"),
];

for (const modulePath of modulePaths) {
  try {
    Database = require(modulePath);
    console.log(`使用数据库模块: ${modulePath}`);
    break;
  } catch (e) {
    // 继续尝试下一个
  }
}

if (!Database) {
  console.error("无法加载 better-sqlite3 模块");
  process.exit(1);
}

// 定价数据 (USD per million tokens)
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

// 汇率
const EXCHANGE_RATE = 7.2;

// 随机整数
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 随机选择
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 计算成本
function calculateCost(provider, model, inputTokens, outputTokens) {
  const pricing = PRICING[provider]?.[model];
  if (!pricing) {
    return { costUsd: 0, costCny: 0 };
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const costUsd = inputCost + outputCost;
  const costCny = costUsd * EXCHANGE_RATE;

  return { costUsd, costCny };
}

// 生成测试数据
function generateTestData(db, days = 30, recordsPerDay = 50) {
  console.log(
    `\n正在生成 ${days} 天的测试数据，每天约 ${recordsPerDay} 条记录...\n`,
  );

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const providers = Object.keys(PRICING);

  let totalRecords = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  const insert = db.prepare(`
    INSERT INTO llm_usage_log (
      id, conversation_id, message_id, provider, model,
      input_tokens, output_tokens, total_tokens, cached_tokens,
      cost_usd, cost_cny,
      was_cached, was_compressed, compression_ratio,
      latency_ms, response_time,
      endpoint, user_id, session_id, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?
    )
  `);

  // 开始事务
  const insertMany = db.transaction((records) => {
    for (const r of records) {
      insert.run(...r);
    }
  });

  const records = [];

  for (let day = 0; day < days; day++) {
    // 每天的记录数有一些随机波动
    const dailyRecords = recordsPerDay + randomInt(-20, 20);

    for (let i = 0; i < dailyRecords; i++) {
      const provider = randomChoice(providers);
      const models = Object.keys(PRICING[provider]);
      const model = randomChoice(models);

      // 生成随机 Token 数
      const inputTokens = randomInt(100, 4000);
      const outputTokens = randomInt(50, 2000);
      const totalTokensVal = inputTokens + outputTokens;
      const cachedTokens =
        Math.random() > 0.7 ? randomInt(0, inputTokens / 2) : 0;

      // 计算成本
      const { costUsd, costCny } = calculateCost(
        provider,
        model,
        inputTokens,
        outputTokens,
      );

      // 随机时间戳（在当天范围内）
      const dayStart = now - (day + 1) * msPerDay;
      const timestamp = dayStart + randomInt(0, msPerDay);

      // 是否缓存命中
      const wasCached = Math.random() > 0.85 ? 1 : 0;
      const wasCompressed = Math.random() > 0.7 ? 1 : 0;
      const compressionRatio = wasCompressed ? 0.5 + Math.random() * 0.4 : 1.0;

      // 响应时间
      const latencyMs = randomInt(200, 5000);

      records.push([
        uuidv4(), // id
        `conv-test-${randomInt(1, 100)}`, // conversation_id
        `msg-${uuidv4().slice(0, 8)}`, // message_id
        provider, // provider
        model, // model
        inputTokens, // input_tokens
        outputTokens, // output_tokens
        totalTokensVal, // total_tokens
        cachedTokens, // cached_tokens
        costUsd, // cost_usd
        costCny, // cost_cny
        wasCached, // was_cached
        wasCompressed, // was_compressed
        compressionRatio, // compression_ratio
        latencyMs, // latency_ms
        latencyMs, // response_time
        null, // endpoint
        "default", // user_id
        null, // session_id
        timestamp, // created_at
      ]);

      totalRecords++;
      totalTokens += totalTokensVal;
      totalCostUsd += costUsd;
    }
  }

  // 批量插入
  insertMany(records);

  console.log("=".repeat(50));
  console.log("测试数据生成完成！");
  console.log("=".repeat(50));
  console.log(`总记录数: ${totalRecords}`);
  console.log(`总 Token 数: ${totalTokens.toLocaleString()}`);
  console.log(`总成本 (USD): $${totalCostUsd.toFixed(4)}`);
  console.log(`总成本 (CNY): ¥${(totalCostUsd * EXCHANGE_RATE).toFixed(4)}`);
  console.log("=".repeat(50));

  // 显示按提供商统计
  console.log("\n按提供商统计:");
  const stats = db
    .prepare(
      `
    SELECT
      provider,
      COUNT(*) as count,
      SUM(total_tokens) as tokens,
      SUM(cost_usd) as cost_usd
    FROM llm_usage_log
    WHERE created_at > ?
    GROUP BY provider
    ORDER BY cost_usd DESC
  `,
    )
    .all(now - days * msPerDay);

  stats.forEach((s) => {
    console.log(
      `  ${s.provider}: ${s.count} 次调用, ${s.tokens?.toLocaleString() || 0} tokens, $${(s.cost_usd || 0).toFixed(4)}`,
    );
  });

  // 显示按模型统计
  console.log("\n按模型统计 (Top 10):");
  const modelStats = db
    .prepare(
      `
    SELECT
      provider || '/' || model as full_model,
      COUNT(*) as count,
      SUM(total_tokens) as tokens,
      SUM(cost_usd) as cost_usd
    FROM llm_usage_log
    WHERE created_at > ?
    GROUP BY provider, model
    ORDER BY cost_usd DESC
    LIMIT 10
  `,
    )
    .all(now - days * msPerDay);

  modelStats.forEach((s) => {
    console.log(
      `  ${s.full_model}: ${s.count} 次, $${(s.cost_usd || 0).toFixed(4)}`,
    );
  });
}

// 主函数
async function main() {
  console.log("LLM 性能页面测试数据生成器");
  console.log("=".repeat(50));
  console.log(`数据库路径: ${dbPath}`);

  // 检查数据库文件是否存在
  const fs = require("fs");
  if (!fs.existsSync(dbPath)) {
    console.error(`\n错误: 数据库文件不存在: ${dbPath}`);
    console.error("请先运行应用以初始化数据库。");
    process.exit(1);
  }

  // 连接数据库
  let db;
  try {
    db = new Database(dbPath);
    console.log("数据库连接成功");
  } catch (e) {
    console.error(`数据库连接失败: ${e.message}`);
    process.exit(1);
  }

  // 检查表是否存在
  const tableExists = db
    .prepare(
      `
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='llm_usage_log'
  `,
    )
    .get();

  if (!tableExists) {
    console.error("\n错误: llm_usage_log 表不存在");
    console.error("请先运行应用以执行数据库迁移。");
    db.close();
    process.exit(1);
  }

  // 询问是否清除现有数据
  const existingCount = db
    .prepare("SELECT COUNT(*) as count FROM llm_usage_log")
    .get();
  console.log(`\n当前已有 ${existingCount.count} 条记录`);

  // 解析命令行参数
  const args = process.argv.slice(2);
  const clearExisting = args.includes("--clear");
  const days =
    parseInt(args.find((a) => a.startsWith("--days="))?.split("=")[1]) || 30;
  const recordsPerDay =
    parseInt(args.find((a) => a.startsWith("--records="))?.split("=")[1]) || 50;

  if (clearExisting) {
    console.log("\n清除现有数据...");
    db.prepare("DELETE FROM llm_usage_log").run();
    console.log("已清除所有现有记录");
  }

  // 生成测试数据
  try {
    generateTestData(db, days, recordsPerDay);
  } catch (e) {
    console.error(`\n生成数据失败: ${e.message}`);
    console.error(e.stack);
  }

  // 关闭数据库
  db.close();
  console.log("\n数据库连接已关闭");
  console.log("\n现在可以在应用中访问 LLM 性能页面查看测试数据！");
  console.log("路径: 系统监控与维护 → LLM 性能仪表板");
  console.log("或访问: #/llm/performance");
}

main().catch(console.error);
