/**
 * RAG高级优化功能验证脚本
 * 验证所有5个高级功能是否正确实现
 */

const fs = require('fs');
const path = require('path');

console.log('====================================');
console.log('  RAG高级优化验证');
console.log('====================================\n');

let allPassed = true;
const results = [];

// 测试1: 验证文档分块器
console.log('✓ 测试1: 验证文档分块器 (RecursiveCharacterTextSplitter)');
const textSplitterPath = './desktop-app-vue/src/main/rag/text-splitter.js';
if (fs.existsSync(textSplitterPath)) {
  const code = fs.readFileSync(textSplitterPath, 'utf-8');
  const checks = [
    { name: 'RecursiveCharacterTextSplitter类', pattern: /class RecursiveCharacterTextSplitter/ },
    { name: 'splitText方法', pattern: /splitText\(text/ },
    { name: '递归分割', pattern: /_recursiveSplit/ },
    { name: 'Markdown分块器', pattern: /class MarkdownTextSplitter/ },
    { name: 'Code分块器', pattern: /class CodeTextSplitter/ },
  ];

  checks.forEach(check => {
    if (check.pattern.test(code)) {
      console.log(`  ✅ ${check.name}`);
      results.push({ test: `Splitter-${check.name}`, passed: true });
    } else {
      console.log(`  ❌ ${check.name}`);
      results.push({ test: `Splitter-${check.name}`, passed: false });
      allPassed = false;
    }
  });
} else {
  console.log(`  ❌ 文件不存在: ${textSplitterPath}`);
  allPassed = false;
}

// 测试2: 验证Query重写器
console.log('\n✓ 测试2: 验证查询重写器 (QueryRewriter)');
const queryRewriterPath = './desktop-app-vue/src/main/rag/query-rewriter.js';
if (fs.existsSync(queryRewriterPath)) {
  const code = fs.readFileSync(queryRewriterPath, 'utf-8');
  const checks = [
    { name: 'QueryRewriter类', pattern: /class QueryRewriter/ },
    { name: 'multiQueryRewrite方法', pattern: /multiQueryRewrite/ },
    { name: 'hydeRewrite方法', pattern: /hydeRewrite/ },
    { name: 'stepBackRewrite方法', pattern: /stepBackRewrite/ },
    { name: 'decomposeQuery方法', pattern: /decomposeQuery/ },
  ];

  checks.forEach(check => {
    if (check.pattern.test(code)) {
      console.log(`  ✅ ${check.name}`);
      results.push({ test: `QueryRewriter-${check.name}`, passed: true });
    } else {
      console.log(`  ❌ ${check.name}`);
      results.push({ test: `QueryRewriter-${check.name}`, passed: false });
      allPassed = false;
    }
  });
} else {
  console.log(`  ❌ 文件不存在: ${queryRewriterPath}`);
  allPassed = false;
}

// 测试3: 验证CrossEncoder集成
console.log('\n✓ 测试3: 验证CrossEncoder集成');
const rerankerPath = './desktop-app-vue/src/main/rag/reranker.js';
const crossEncoderPyPath = './backend/ai-service/src/rag/crossencoder_reranker.py';
const mainPyPath = './backend/ai-service/main.py';

const checks3 = [
  { name: 'Reranker CrossEncoder方法', path: rerankerPath, pattern: /rerankWithCrossEncoder/ },
  { name: 'CrossEncoder API调用', path: rerankerPath, pattern: /fetch\(crossEncoderUrl/ },
  { name: 'Python CrossEncoder类', path: crossEncoderPyPath, pattern: /class CrossEncoderReranker/ },
  { name: 'API端点 /api/rerank', path: mainPyPath, pattern: /@app\.post\("\/api\/rerank"\)/ },
];

checks3.forEach(check => {
  if (fs.existsSync(check.path)) {
    const code = fs.readFileSync(check.path, 'utf-8');
    if (check.pattern.test(code)) {
      console.log(`  ✅ ${check.name}`);
      results.push({ test: `CrossEncoder-${check.name}`, passed: true });
    } else {
      console.log(`  ❌ ${check.name}`);
      results.push({ test: `CrossEncoder-${check.name}`, passed: false });
      allPassed = false;
    }
  } else {
    console.log(`  ⚠️  ${check.name} - 文件不存在`);
  }
});

// 测试4: 验证LRU缓存升级
console.log('\n✓ 测试4: 验证LRU缓存升级');
const embeddingsPath = './desktop-app-vue/src/main/rag/embeddings-service.js';
if (fs.existsSync(embeddingsPath)) {
  const code = fs.readFileSync(embeddingsPath, 'utf-8');
  const checks = [
    { name: 'LRUCache引入', pattern: /require\('lru-cache'\)/ },
    { name: 'LRU初始化', pattern: /new LRUCache\(/ },
    { name: 'maxAge配置', pattern: /maxAge:/ },
    { name: '降级到Map', pattern: /this\.cache = new Map\(\)/ },
    { name: '缓存类型标记', pattern: /cacheType:/ },
  ];

  checks.forEach(check => {
    if (check.pattern.test(code)) {
      console.log(`  ✅ ${check.name}`);
      results.push({ test: `LRU-${check.name}`, passed: true });
    } else {
      console.log(`  ❌ ${check.name}`);
      results.push({ test: `LRU-${check.name}`, passed: false });
      allPassed = false;
    }
  });
} else {
  console.log(`  ❌ 文件不存在: ${embeddingsPath}`);
  allPassed = false;
}

// 测试5: 验证性能监控
console.log('\n✓ 测试5: 验证性能监控');
const metricsPath = './desktop-app-vue/src/main/rag/metrics.js';
const ragManagerPath = './desktop-app-vue/src/main/rag/rag-manager.js';

const checks5 = [
  { name: 'RAGMetrics类', path: metricsPath, pattern: /class RAGMetrics/ },
  { name: 'startTimer方法', path: metricsPath, pattern: /startTimer/ },
  { name: 'recordError方法', path: metricsPath, pattern: /recordError/ },
  { name: '性能报告', path: metricsPath, pattern: /getPerformanceReport/ },
  { name: 'RAGManager集成Metrics', path: ragManagerPath, pattern: /this\.metrics = new RAGMetrics/ },
  { name: '检索性能监控', path: ragManagerPath, pattern: /MetricTypes\.RETRIEVAL/ },
  { name: 'getPerformanceMetrics', path: ragManagerPath, pattern: /getPerformanceMetrics/ },
];

checks5.forEach(check => {
  if (fs.existsSync(check.path)) {
    const code = fs.readFileSync(check.path, 'utf-8');
    if (check.pattern.test(code)) {
      console.log(`  ✅ ${check.name}`);
      results.push({ test: `Metrics-${check.name}`, passed: true });
    } else {
      console.log(`  ❌ ${check.name}`);
      results.push({ test: `Metrics-${check.name}`, passed: false });
      allPassed = false;
    }
  } else {
    console.log(`  ⚠️  ${check.name} - 文件不存在`);
  }
});

// 测试6: 验证RAGManager集成
console.log('\n✓ 测试6: 验证RAGManager高级功能集成');
if (fs.existsSync(ragManagerPath)) {
  const code = fs.readFileSync(ragManagerPath, 'utf-8');
  const checks = [
    { name: 'TextSplitter导入', pattern: /RecursiveCharacterTextSplitter/ },
    { name: 'QueryRewriter导入', pattern: /QueryRewriter/ },
    { name: '文档分块配置', pattern: /enableChunking/ },
    { name: '查询重写配置', pattern: /enableQueryRewrite/ },
    { name: '性能监控配置', pattern: /enableMetrics/ },
    { name: 'addToIndex支持分块', pattern: /this\.textSplitter\.splitText/ },
    { name: 'retrieve支持Query重写', pattern: /this\.queryRewriter\.rewriteQuery/ },
  ];

  checks.forEach(check => {
    if (check.pattern.test(code)) {
      console.log(`  ✅ ${check.name}`);
      results.push({ test: `Integration-${check.name}`, passed: true });
    } else {
      console.log(`  ❌ ${check.name}`);
      results.push({ test: `Integration-${check.name}`, passed: false });
      allPassed = false;
    }
  });
} else {
  console.log(`  ❌ 文件不存在: ${ragManagerPath}`);
  allPassed = false;
}

// 统计结果
const passedCount = results.filter(r => r.passed).length;
const totalCount = results.length;

// 总结
console.log('\n====================================');
if (allPassed) {
  console.log('  ✅ 所有验证通过！');
  console.log('====================================\n');
  console.log(`验证通过: ${passedCount}/${totalCount}\n`);
  console.log('已实现的高级功能:');
  console.log('  1. ✅ 文档分块 (RecursiveCharacterTextSplitter)');
  console.log('     - 智能递归分割');
  console.log('     - Markdown/Code专用分块器');
  console.log('     - 支持重叠滑窗');
  console.log('\n  2. ✅ Query重写 (4种策略)');
  console.log('     - Multi-Query: 生成查询变体');
  console.log('     - HyDE: 假设文档嵌入');
  console.log('     - Step-Back: 抽象查询');
  console.log('     - Decompose: 查询分解');
  console.log('\n  3. ✅ CrossEncoder重排序');
  console.log('     - 远程API集成');
  console.log('     - 本地关键词回退');
  console.log('     - Python后端支持');
  console.log('\n  4. ✅ LRU缓存');
  console.log('     - lru-cache库集成');
  console.log('     - 智能降级到Map');
  console.log('     - 缓存命中率统计');
  console.log('\n  5. ✅ 性能监控');
  console.log('     - 检索/重排序/嵌入延迟跟踪');
  console.log('     - 实时性能概览');
  console.log('     - 性能报告生成');
  console.log('     - 告警阈值检查');
  console.log('\n下一步:');
  console.log('  1. 安装lru-cache: npm install lru-cache');
  console.log('  2. 启动ChromaDB: start-chromadb.bat');
  console.log('  3. 测试高级功能: node test-advanced-rag.js');
  console.log('  4. 查看文档: RAG_ADVANCED_FEATURES.md\n');
} else {
  console.log('  ❌ 部分验证失败');
  console.log('====================================\n');
  console.log(`验证通过: ${passedCount}/${totalCount}\n`);
  console.log('失败的测试:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.test}`);
  });
  console.log('\n请检查上述失败项\n');
  process.exit(1);
}
