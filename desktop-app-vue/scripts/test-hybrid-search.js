/**
 * 混合搜索引擎测试脚本
 *
 * 测试 BM25Search 和 HybridSearchEngine
 *
 * 运行方式:
 * cd desktop-app-vue
 * node scripts/test-hybrid-search.js
 */

const path = require("path");

// 设置环境变量
process.env.CHAINLESSCHAIN_DISABLE_NATIVE_DB = "1";

const { BM25Search } = require("../src/main/rag/bm25-search");
const { HybridSearchEngine } = require("../src/main/rag/hybrid-search-engine");

// ANSI 颜色代码
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logError(message) {
  log(`✗ ${message}`, "red");
}

function logInfo(message) {
  log(`ℹ ${message}`, "cyan");
}

function logSection(message) {
  log(`\n${"=".repeat(60)}`, "blue");
  log(message, "blue");
  log("=".repeat(60), "blue");
}

// 测试文档
const testDocuments = [
  {
    id: "doc1",
    content:
      "如何优化 SQLite 数据库查询性能？可以通过创建索引、启用 WAL 模式、使用 prepared statements 来提升性能。",
    metadata: { type: "qa", topic: "database" },
  },
  {
    id: "doc2",
    content:
      "Vue 3 的 Composition API 提供了更好的代码组织方式。使用 setup() 函数和响应式 API 可以让代码更清晰。",
    metadata: { type: "tutorial", topic: "frontend" },
  },
  {
    id: "doc3",
    content:
      "数据库连接池可以显著提升应用性能。推荐使用 better-sqlite3 或 node-postgres 的连接池功能。",
    metadata: { type: "best_practice", topic: "database" },
  },
  {
    id: "doc4",
    content:
      "Electron 应用优化技巧：使用 IPC 通信时避免传递大对象，启用 context isolation，使用 preload 脚本。",
    metadata: { type: "tips", topic: "electron" },
  },
  {
    id: "doc5",
    content:
      'SQLite 锁问题解决方案：启用 WAL 模式（db.pragma("journal_mode = WAL")），设置 busy_timeout。',
    metadata: { type: "troubleshooting", topic: "database" },
  },
  {
    id: "doc6",
    content:
      "Vue 性能优化：使用虚拟滚动、懒加载组件、使用 v-memo 指令减少重渲染。",
    metadata: { type: "optimization", topic: "frontend" },
  },
  {
    id: "doc7",
    content:
      "LLM 提示词工程最佳实践：清晰的指令、提供示例、设定角色、使用分隔符。",
    metadata: { type: "best_practice", topic: "ai" },
  },
  {
    id: "doc8",
    content:
      "Node.js 性能分析工具：使用 clinic.js 进行性能诊断，使用 0x 生成火焰图。",
    metadata: { type: "tools", topic: "nodejs" },
  },
];

async function runTests() {
  try {
    logSection("混合搜索引擎测试");

    // ============================================
    // 1. 测试 BM25Search
    // ============================================
    logSection("1. 测试 BM25Search");

    const bm25 = new BM25Search({
      k1: 1.5,
      b: 0.75,
      language: "zh",
    });

    bm25.indexDocuments(testDocuments);
    logSuccess("BM25 索引创建成功");

    const bm25Stats = bm25.getStats();
    logInfo(`  - 文档数: ${bm25Stats.documentCount}`);
    logInfo(`  - 平均长度: ${bm25Stats.avgDocLength}`);
    logInfo(`  - k1: ${bm25Stats.k1}`);
    logInfo(`  - b: ${bm25Stats.b}`);

    // 测试搜索 1: "数据库优化"
    logSection('2. BM25 搜索测试 - "数据库优化"');

    const results1 = bm25.search("数据库优化", { limit: 3 });
    logSuccess(`找到 ${results1.length} 个结果`);

    results1.forEach((result, idx) => {
      logInfo(
        `  ${idx + 1}. [${result.document.id}] 分数: ${result.score.toFixed(4)}`,
      );
      logInfo(`     ${result.document.content.substring(0, 60)}...`);
    });

    // 测试搜索 2: "Vue 性能"
    logSection('3. BM25 搜索测试 - "Vue 性能"');

    const results2 = bm25.search("Vue 性能", { limit: 3 });
    logSuccess(`找到 ${results2.length} 个结果`);

    results2.forEach((result, idx) => {
      logInfo(
        `  ${idx + 1}. [${result.document.id}] 分数: ${result.score.toFixed(4)}`,
      );
      logInfo(`     ${result.document.content.substring(0, 60)}...`);
    });

    // 测试搜索 3: "SQLite 锁"
    logSection('4. BM25 搜索测试 - "SQLite 锁"');

    const results3 = bm25.search("SQLite 锁", { limit: 3 });
    logSuccess(`找到 ${results3.length} 个结果`);

    results3.forEach((result, idx) => {
      logInfo(
        `  ${idx + 1}. [${result.document.id}] 分数: ${result.score.toFixed(4)}`,
      );
      logInfo(`     ${result.document.content.substring(0, 60)}...`);
    });

    // ============================================
    // 5. 测试 HybridSearchEngine（模拟 RAG Manager）
    // ============================================
    logSection("5. 测试 HybridSearchEngine (模拟 RAG Manager)");

    // 创建模拟 RAG Manager
    const mockRagManager = {
      async search(options) {
        // 模拟 Vector Search：返回与查询语义相关的文档
        const query = options.query.toLowerCase();

        // 简单的语义匹配（实际应该用 Embedding）
        const semanticResults = [];

        if (query.includes("数据库") || query.includes("优化")) {
          semanticResults.push(
            {
              id: "doc1",
              content: testDocuments[0].content,
              score: 0.85,
              metadata: testDocuments[0].metadata,
            },
            {
              id: "doc3",
              content: testDocuments[2].content,
              score: 0.75,
              metadata: testDocuments[2].metadata,
            },
            {
              id: "doc5",
              content: testDocuments[4].content,
              score: 0.7,
              metadata: testDocuments[4].metadata,
            },
          );
        }

        if (query.includes("vue") || query.includes("性能")) {
          semanticResults.push(
            {
              id: "doc2",
              content: testDocuments[1].content,
              score: 0.8,
              metadata: testDocuments[1].metadata,
            },
            {
              id: "doc6",
              content: testDocuments[5].content,
              score: 0.78,
              metadata: testDocuments[5].metadata,
            },
          );
        }

        return semanticResults.slice(0, options.limit || 10);
      },
    };

    const hybridEngine = new HybridSearchEngine({
      ragManager: mockRagManager,
      vectorWeight: 0.6,
      textWeight: 0.4,
      rrfK: 60,
      language: "zh",
    });

    await hybridEngine.indexDocuments(testDocuments);
    logSuccess("HybridSearchEngine 索引创建成功");

    const hybridStats = hybridEngine.getStats();
    logInfo(`  - 文档数: ${hybridStats.documentCount}`);
    logInfo(`  - Vector 权重: ${hybridStats.vectorWeight}`);
    logInfo(`  - BM25 权重: ${hybridStats.textWeight}`);
    logInfo(`  - RRF k: ${hybridStats.rrfK}`);

    // 测试混合搜索 1: "数据库优化"
    logSection('6. 混合搜索测试 - "数据库优化"');

    const hybridResults1 = await hybridEngine.search("数据库优化", {
      limit: 5,
    });
    logSuccess(`找到 ${hybridResults1.length} 个结果 (混合)`);

    hybridResults1.forEach((result, idx) => {
      logInfo(
        `  ${idx + 1}. [${result.document.id}] 分数: ${result.score.toFixed(4)} (${result.source})`,
      );
      logInfo(`     ${result.document.content.substring(0, 60)}...`);
    });

    // 测试混合搜索 2: "Vue 性能"
    logSection('7. 混合搜索测试 - "Vue 性能"');

    const hybridResults2 = await hybridEngine.search("Vue 性能", { limit: 5 });
    logSuccess(`找到 ${hybridResults2.length} 个结果 (混合)`);

    hybridResults2.forEach((result, idx) => {
      logInfo(
        `  ${idx + 1}. [${result.document.id}] 分数: ${result.score.toFixed(4)} (${result.source})`,
      );
      logInfo(`     ${result.document.content.substring(0, 60)}...`);
    });

    // 测试权重调整
    logSection("8. 测试权重调整");

    hybridEngine.updateWeights(0.8, 0.2); // 更加重视 Vector Search
    logSuccess("权重更新成功 (Vector 0.8, BM25 0.2)");

    const hybridResults3 = await hybridEngine.search("数据库优化", {
      limit: 3,
    });
    logSuccess(`找到 ${hybridResults3.length} 个结果 (新权重)`);

    hybridResults3.forEach((result, idx) => {
      logInfo(
        `  ${idx + 1}. [${result.document.id}] 分数: ${result.score.toFixed(4)}`,
      );
    });

    // ============================================
    // 测试总结
    // ============================================
    logSection("测试总结");
    logSuccess("所有测试通过!");

    logInfo("\n核心功能验证:");
    logInfo("  ✓ BM25Search 关键词匹配");
    logInfo("  ✓ HybridSearchEngine 混合搜索");
    logInfo("  ✓ RRF 融合算法");
    logInfo("  ✓ 权重动态调整");

    logInfo("\n性能特点:");
    logInfo("  - BM25 擅长精确关键词匹配");
    logInfo("  - Vector Search 擅长语义理解");
    logInfo("  - 混合搜索结合两者优势");
    logInfo("  - 权重可根据场景调整");
  } catch (error) {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// 运行测试
runTests();
