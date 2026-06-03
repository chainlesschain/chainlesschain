/**
 * RAG修复验证脚本（简化版）
 * 仅验证配置和代码结构，不需要Electron环境
 */

const fs = require('fs');
const path = require('path');

console.log('====================================');
console.log('  RAG系统修复验证');
console.log('====================================\n');

let allPassed = true;

// 测试1: 验证rag-manager.js的修复
console.log('✓ 测试1: 验证 rag-manager.js 修复');
const ragManagerPath = './desktop-app-vue/src/main/rag/rag-manager.js';
const ragManagerCode = fs.readFileSync(ragManagerPath, 'utf-8');

const checks = [
  { name: 'topK: 10', pattern: /topK:\s*10/ },
  { name: 'similarityThreshold: 0.6', pattern: /similarityThreshold:\s*0\.6/ },
  { name: 'maxContextLength: 6000', pattern: /maxContextLength:\s*6000/ },
  { name: 'enableReranking: true', pattern: /enableReranking:\s*true/ },
  { name: 'rerankMethod: hybrid', pattern: /rerankMethod:\s*['"]hybrid['"]/ },
  { name: 'batchSize: 20', pattern: /batchSize\s*=\s*20/ },
  { name: 'addDocument方法', pattern: /async addDocument\(doc\)/ },
  { name: 'getDocument方法', pattern: /async getDocument\(id\)/ },
  { name: 'deleteDocument方法', pattern: /async deleteDocument\(id\)/ },
  { name: 'search方法', pattern: /async search\(query,\s*options/ },
  { name: 'rerank方法', pattern: /async rerank\(query,\s*documents/ },
];

checks.forEach(check => {
  if (check.pattern.test(ragManagerCode)) {
    console.log(`  ✅ ${check.name}`);
  } else {
    console.log(`  ❌ ${check.name}`);
    allPassed = false;
  }
});

// 测试2: 验证embeddings-service.js的优化
console.log('\n✓ 测试2: 验证 embeddings-service.js 优化');
const embeddingsPath = './desktop-app-vue/src/main/rag/embeddings-service.js';
const embeddingsCode = fs.readFileSync(embeddingsPath, 'utf-8');

const embeddingsChecks = [
  { name: '缓存大小: 2000', pattern: /cache\.size\s*>\s*2000/ },
  { name: 'cacheHits追踪', pattern: /this\.cacheHits/ },
  { name: 'cacheMisses追踪', pattern: /this\.cacheMisses/ },
  { name: 'hitRate计算', pattern: /hitRate:.*cacheHits.*cacheMisses/ },
];

embeddingsChecks.forEach(check => {
  if (check.pattern.test(embeddingsCode)) {
    console.log(`  ✅ ${check.name}`);
  } else {
    console.log(`  ❌ ${check.name}`);
    allPassed = false;
  }
});

// 测试3: 验证docker-compose.yml
console.log('\n✓ 测试3: 验证 docker-compose.yml');
const dockerComposePath = './docker-compose.yml';
const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf-8');

const dockerChecks = [
  { name: 'ChromaDB服务', pattern: /chromadb:/ },
  { name: 'ChromaDB端口8000', pattern: /"8000:8000"/ },
  { name: 'ChromaDB持久化', pattern: /IS_PERSISTENT=TRUE/ },
  { name: 'Qdrant服务', pattern: /qdrant:/ },
  { name: 'Qdrant端口6333', pattern: /"6333:6333"/ },
];

dockerChecks.forEach(check => {
  if (check.pattern.test(dockerComposeContent)) {
    console.log(`  ✅ ${check.name}`);
  } else {
    console.log(`  ❌ ${check.name}`);
    allPassed = false;
  }
});

// 测试4: 验证修复文档
console.log('\n✓ 测试4: 验证修复文档');
const docChecks = [
  { name: 'RAG_FIX_SUMMARY.md', path: './RAG_FIX_SUMMARY.md' },
  { name: 'start-chromadb.bat', path: './start-chromadb.bat' },
];

docChecks.forEach(check => {
  if (fs.existsSync(check.path)) {
    console.log(`  ✅ ${check.name}`);
  } else {
    console.log(`  ❌ ${check.name}`);
    allPassed = false;
  }
});

// 总结
console.log('\n====================================');
if (allPassed) {
  console.log('  ✅ 所有验证通过！');
  console.log('====================================\n');
  console.log('修复摘要:');
  console.log('  1. ✅ RAGManager API已修复（新增5个方法）');
  console.log('  2. ✅ 配置已优化（Reranking启用，参数调优）');
  console.log('  3. ✅ 性能已提升（批次20，缓存2000）');
  console.log('  4. ✅ ChromaDB服务已添加到docker-compose');
  console.log('\n下一步:');
  console.log('  1. 运行: start-chromadb.bat (启动ChromaDB)');
  console.log('  2. 运行: cd desktop-app-vue && npm run dev');
  console.log('  3. 测试RAG功能');
  console.log('  4. 查看: RAG_FIX_SUMMARY.md (详细文档)\n');
} else {
  console.log('  ❌ 部分验证失败');
  console.log('====================================\n');
  console.log('请检查上述失败项\n');
  process.exit(1);
}
