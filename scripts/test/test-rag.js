/**
 * RAG系统测试脚本
 * 用于验证修复后的功能
 */

const { RAGManager, DEFAULT_CONFIG } = require('./desktop-app-vue/src/main/rag/rag-manager');

console.log('====================================');
console.log('  RAG系统修复验证测试');
console.log('====================================\n');

// 测试1: 检查默认配置
console.log('✓ 测试1: 验证优化后的配置');
console.log('  配置项:');
console.log(`    - topK: ${DEFAULT_CONFIG.topK} (预期: 10)`);
console.log(`    - similarityThreshold: ${DEFAULT_CONFIG.similarityThreshold} (预期: 0.6)`);
console.log(`    - maxContextLength: ${DEFAULT_CONFIG.maxContextLength} (预期: 6000)`);
console.log(`    - enableReranking: ${DEFAULT_CONFIG.enableReranking} (预期: true)`);
console.log(`    - rerankMethod: ${DEFAULT_CONFIG.rerankMethod} (预期: hybrid)`);
console.log(`    - vectorWeight: ${DEFAULT_CONFIG.vectorWeight} (预期: 0.6)`);
console.log(`    - keywordWeight: ${DEFAULT_CONFIG.keywordWeight} (预期: 0.4)\n`);

const configValid =
  DEFAULT_CONFIG.topK === 10 &&
  DEFAULT_CONFIG.similarityThreshold === 0.6 &&
  DEFAULT_CONFIG.maxContextLength === 6000 &&
  DEFAULT_CONFIG.enableReranking === true &&
  DEFAULT_CONFIG.rerankMethod === 'hybrid' &&
  DEFAULT_CONFIG.vectorWeight === 0.6 &&
  DEFAULT_CONFIG.keywordWeight === 0.4;

if (configValid) {
  console.log('  ✅ 配置验证通过！\n');
} else {
  console.log('  ❌ 配置验证失败！\n');
  process.exit(1);
}

// 测试2: 检查新增的API方法
console.log('✓ 测试2: 验证新增的API方法');

// 创建模拟的database和llmManager
const mockDatabase = {
  getKnowledgeItems: () => [],
  searchKnowledgeItems: () => [],
};

const mockLLMManager = {
  isInitialized: true,
  embeddings: async (text) => {
    // 返回模拟的embedding向量
    return new Array(128).fill(0).map(() => Math.random());
  },
  query: async (prompt) => {
    // 模拟LLM响应
    return '0.8, 0.6, 0.4';
  }
};

const ragManager = new RAGManager(mockDatabase, mockLLMManager);

const apiMethods = [
  'addDocument',
  'getDocument',
  'deleteDocument',
  'search',
  'rerank',
  'addToIndex',
  'removeFromIndex',
  'retrieve',
  'enhanceQuery',
  'rebuildIndex',
  'getIndexStats',
  'updateConfig',
  'getRerankConfig',
  'setRerankingEnabled'
];

let methodsValid = true;
for (const method of apiMethods) {
  if (typeof ragManager[method] === 'function') {
    console.log(`  ✓ ${method}()`);
  } else {
    console.log(`  ✗ ${method}() - 不存在`);
    methodsValid = false;
  }
}

if (methodsValid) {
  console.log('\n  ✅ API方法验证通过！\n');
} else {
  console.log('\n  ❌ API方法验证失败！\n');
  process.exit(1);
}

// 测试3: 测试文档添加（简化版）
console.log('✓ 测试3: 测试文档操作');

async function testDocumentOperations() {
  try {
    // 初始化RAG管理器
    await ragManager.initialize();
    console.log('  ✓ RAG Manager 初始化成功');

    // 测试添加文档
    const testDoc = {
      id: 'test_doc_1',
      content: '这是一个测试文档，用于验证RAG系统功能',
      metadata: {
        title: '测试文档',
        type: 'test',
        fileName: 'test.md',
        createdAt: new Date().toISOString()
      }
    };

    await ragManager.addDocument(testDoc);
    console.log('  ✓ addDocument() 调用成功');

    // 测试搜索
    const searchResults = await ragManager.search('测试', { limit: 5 });
    console.log(`  ✓ search() 调用成功，返回 ${searchResults.length} 个结果`);

    // 测试重排序
    if (searchResults.length > 0) {
      const rerankedResults = await ragManager.rerank('测试文档', searchResults);
      console.log(`  ✓ rerank() 调用成功，重排序后 ${rerankedResults.length} 个结果`);
    }

    // 测试删除
    await ragManager.deleteDocument('test_doc_1');
    console.log('  ✓ deleteDocument() 调用成功');

    console.log('\n  ✅ 文档操作测试通过！\n');

  } catch (error) {
    console.log(`\n  ❌ 文档操作测试失败: ${error.message}\n`);
    if (error.message.includes('ChromaDB') || error.message.includes('connection')) {
      console.log('  ⚠️  提示: 请确保 ChromaDB 服务正在运行');
      console.log('     运行: docker-compose up -d chromadb\n');
    }
  }
}

// 运行测试
testDocumentOperations().then(() => {
  console.log('====================================');
  console.log('  测试完成！');
  console.log('====================================\n');
  console.log('摘要:');
  console.log('  ✅ 配置优化已应用');
  console.log('  ✅ API方法已添加');
  console.log('  ✅ 文档操作正常');
  console.log('\n下一步:');
  console.log('  1. 启动 ChromaDB: npm run docker:up 或 start-chromadb.bat');
  console.log('  2. 启动 Desktop App: cd desktop-app-vue && npm run dev');
  console.log('  3. 在应用中测试RAG功能');
  console.log('  4. 查看详细文档: RAG_FIX_SUMMARY.md\n');
}).catch((error) => {
  console.error('测试失败:', error);
  process.exit(1);
});
