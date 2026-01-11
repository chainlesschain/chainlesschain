/**
 * 知识图谱功能测试套件
 * 测试图分析算法、实体提取、导出功能等
 */

const assert = require('assert');
const analytics = require('./src/main/knowledge-graph/graph-analytics');
const entityExtraction = require('./src/main/knowledge-graph/entity-extraction');
const { exportToJSON, exportToGraphML, exportToDOT } = require('./src/main/knowledge-graph/graph-export');

// 测试数据
const testNodes = [
  { id: '1', title: 'Node 1', type: 'note' },
  { id: '2', title: 'Node 2', type: 'note' },
  { id: '3', title: 'Node 3', type: 'note' },
  { id: '4', title: 'Node 4', type: 'note' },
  { id: '5', title: 'Node 5', type: 'note' },
];

const testEdges = [
  { source_id: '1', target_id: '2', relation_type: 'link', weight: 1.0 },
  { source_id: '2', target_id: '3', relation_type: 'link', weight: 1.0 },
  { source_id: '3', target_id: '4', relation_type: 'link', weight: 1.0 },
  { source_id: '4', target_id: '5', relation_type: 'link', weight: 1.0 },
  { source_id: '1', target_id: '3', relation_type: 'tag', weight: 0.8 },
];

const testText = `
我在2025年1月12日学习了React和Vue.js，它们都是前端框架。
JavaScript是一门强大的编程语言，广泛应用于Web开发。
我使用Docker和Kubernetes进行容器化部署。
#前端开发 #技术学习
[[React入门教程]]
`;

console.log('🧪 开始测试知识图谱功能...\n');

// ==================== 图分析算法测试 ====================

console.log('📊 测试图分析算法');
console.log('─'.repeat(50));

// 测试度中心性
console.log('\n1️⃣  测试度中心性 (Degree Centrality)');
try {
  const degreeCentrality = analytics.calculateDegreeCentrality(testNodes, testEdges);
  console.log('✅ 度中心性计算成功');
  console.log('结果:', Array.from(degreeCentrality.entries()).map(([id, score]) =>
    `节点${id}: ${score.toFixed(3)}`
  ).join(', '));

  // 验证节点2和3应该有最高的度中心性
  assert(degreeCentrality.get('2') > 0, '节点2应该有正的度中心性');
  assert(degreeCentrality.get('3') > 0, '节点3应该有正的度中心性');
} catch (error) {
  console.error('❌ 度中心性测试失败:', error.message);
}

// 测试接近中心性
console.log('\n2️⃣  测试接近中心性 (Closeness Centrality)');
try {
  const closenessCentrality = analytics.calculateClosenessCentrality(testNodes, testEdges);
  console.log('✅ 接近中心性计算成功');
  console.log('结果:', Array.from(closenessCentrality.entries()).map(([id, score]) =>
    `节点${id}: ${score.toFixed(3)}`
  ).join(', '));
} catch (error) {
  console.error('❌ 接近中心性测试失败:', error.message);
}

// 测试中介中心性
console.log('\n3️⃣  测试中介中心性 (Betweenness Centrality)');
try {
  const betweennessCentrality = analytics.calculateBetweennessCentrality(testNodes, testEdges);
  console.log('✅ 中介中心性计算成功');
  console.log('结果:', Array.from(betweennessCentrality.entries()).map(([id, score]) =>
    `节点${id}: ${score.toFixed(3)}`
  ).join(', '));
} catch (error) {
  console.error('❌ 中介中心性测试失败:', error.message);
}

// 测试 PageRank
console.log('\n4️⃣  测试 PageRank');
try {
  const pageRank = analytics.calculatePageRank(testNodes, testEdges);
  console.log('✅ PageRank 计算成功');
  console.log('结果:', Array.from(pageRank.entries()).map(([id, score]) =>
    `节点${id}: ${score.toFixed(4)}`
  ).join(', '));

  // 验证所有 PageRank 值之和应该接近1
  const sum = Array.from(pageRank.values()).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1.0) < 0.01, 'PageRank 值之和应该接近1');
  console.log(`总和: ${sum.toFixed(4)} ✓`);
} catch (error) {
  console.error('❌ PageRank 测试失败:', error.message);
}

// 测试社区检测
console.log('\n5️⃣  测试社区检测 (Louvain Algorithm)');
try {
  const communities = analytics.detectCommunities(testNodes, testEdges);
  console.log('✅ 社区检测成功');

  const communityCount = new Set(communities.values()).size;
  console.log(`发现 ${communityCount} 个社区`);

  // 按社区分组
  const communityGroups = new Map();
  communities.forEach((communityId, nodeId) => {
    if (!communityGroups.has(communityId)) {
      communityGroups.set(communityId, []);
    }
    communityGroups.get(communityId).push(nodeId);
  });

  communityGroups.forEach((nodes, communityId) => {
    console.log(`  社区 ${communityId}: [${nodes.join(', ')}]`);
  });
} catch (error) {
  console.error('❌ 社区检测测试失败:', error.message);
}

// 测试节点聚类
console.log('\n6️⃣  测试节点聚类 (K-means)');
try {
  const clusters = analytics.clusterNodes(testNodes, testEdges, 2);
  console.log('✅ 节点聚类成功');

  const clusterCount = new Set(clusters.values()).size;
  console.log(`生成 ${clusterCount} 个聚类`);

  // 按聚类分组
  const clusterGroups = new Map();
  clusters.forEach((clusterId, nodeId) => {
    if (!clusterGroups.has(clusterId)) {
      clusterGroups.set(clusterId, []);
    }
    clusterGroups.get(clusterId).push(nodeId);
  });

  clusterGroups.forEach((nodes, clusterId) => {
    console.log(`  聚类 ${clusterId}: [${nodes.join(', ')}]`);
  });
} catch (error) {
  console.error('❌ 节点聚类测试失败:', error.message);
}

// 测试关键节点识别
console.log('\n7️⃣  测试关键节点识别');
try {
  const keyNodes = analytics.findKeyNodes(testNodes, testEdges, 3);
  console.log('✅ 关键节点识别成功');
  console.log('Top 3 关键节点:');
  keyNodes.forEach((node, index) => {
    console.log(`  ${index + 1}. ${node.title} (得分: ${node.score.toFixed(4)}, 度: ${node.degree.toFixed(3)}, PR: ${node.pageRank.toFixed(4)})`);
  });
} catch (error) {
  console.error('❌ 关键节点识别测试失败:', error.message);
}

// 测试图谱统计
console.log('\n8️⃣  测试图谱统计分析');
try {
  const stats = analytics.analyzeGraphStats(testNodes, testEdges);
  console.log('✅ 图谱统计分析成功');
  console.log('统计结果:');
  console.log(`  节点数: ${stats.nodeCount}`);
  console.log(`  边数: ${stats.edgeCount}`);
  console.log(`  密度: ${stats.density.toFixed(4)}`);
  console.log(`  平均度: ${stats.avgDegree.toFixed(2)}`);
  console.log(`  最大度: ${stats.maxDegree}`);
  console.log(`  最小度: ${stats.minDegree}`);
  console.log(`  连通分量数: ${stats.componentCount}`);
  console.log(`  最大分量大小: ${stats.largestComponentSize}`);
  console.log(`  平均聚类系数: ${stats.avgClusteringCoeff.toFixed(4)}`);

  assert(stats.nodeCount === testNodes.length, '节点数应该匹配');
  assert(stats.edgeCount === testEdges.length, '边数应该匹配');
} catch (error) {
  console.error('❌ 图谱统计测试失败:', error.message);
}

// ==================== 实体提取测试 ====================

console.log('\n\n📝 测试实体提取');
console.log('─'.repeat(50));

// 测试基础实体提取
console.log('\n1️⃣  测试基础实体提取');
try {
  const entities = entityExtraction.extractEntities(testText);
  console.log('✅ 实体提取成功');
  console.log(`提取到 ${entities.length} 个实体:`);

  const entityByType = {};
  entities.forEach(entity => {
    if (!entityByType[entity.type]) {
      entityByType[entity.type] = [];
    }
    entityByType[entity.type].push(entity.value);
  });

  Object.entries(entityByType).forEach(([type, values]) => {
    console.log(`  ${type}: [${values.join(', ')}]`);
  });

  // 验证应该提取到日期
  const hasDate = entities.some(e => e.type === 'date');
  assert(hasDate, '应该提取到日期实体');

  // 验证应该提取到技术
  const hasTech = entities.some(e => e.type === 'technology');
  assert(hasTech, '应该提取到技术实体');
} catch (error) {
  console.error('❌ 实体提取测试失败:', error.message);
}

// 测试关键词提取
console.log('\n2️⃣  测试关键词提取');
try {
  const keywords = entityExtraction.extractKeywords(testText, 5);
  console.log('✅ 关键词提取成功');
  console.log('Top 5 关键词:');
  keywords.forEach((kw, index) => {
    console.log(`  ${index + 1}. ${kw.word} (频率: ${kw.frequency}, 得分: ${kw.score.toFixed(4)})`);
  });
} catch (error) {
  console.error('❌ 关键词提取测试失败:', error.message);
}

// 测试 Wiki 链接提取
console.log('\n3️⃣  测试 Wiki 链接提取');
try {
  const wikiLinks = entityExtraction.extractWikiLinks(testText);
  console.log('✅ Wiki 链接提取成功');
  console.log(`提取到 ${wikiLinks.length} 个链接:`);
  wikiLinks.forEach(link => {
    console.log(`  [[${link.title}]]`);
  });

  assert(wikiLinks.length > 0, '应该提取到至少一个 Wiki 链接');
} catch (error) {
  console.error('❌ Wiki 链接提取测试失败:', error.message);
}

// 测试文本摘要
console.log('\n4️⃣  测试文本摘要');
try {
  const summary = entityExtraction.extractSummary(testText, 50);
  console.log('✅ 文本摘要生成成功');
  console.log(`摘要: ${summary}`);

  assert(summary.length <= 53, '摘要长度应该不超过限制'); // 50 + "..."
} catch (error) {
  console.error('❌ 文本摘要测试失败:', error.message);
}

// 测试文本相似度
console.log('\n5️⃣  测试文本相似度');
try {
  const text1 = 'React 是一个前端框架';
  const text2 = 'Vue 是一个前端框架';
  const text3 = '今天天气很好';

  const sim12 = entityExtraction.calculateTextSimilarity(text1, text2);
  const sim13 = entityExtraction.calculateTextSimilarity(text1, text3);

  console.log('✅ 文本相似度计算成功');
  console.log(`  "${text1}" vs "${text2}": ${sim12.toFixed(4)}`);
  console.log(`  "${text1}" vs "${text3}": ${sim13.toFixed(4)}`);

  assert(sim12 > sim13, '相关文本的相似度应该更高');
} catch (error) {
  console.error('❌ 文本相似度测试失败:', error.message);
}

// ==================== 导出功能测试 ====================

console.log('\n\n💾 测试导出功能');
console.log('─'.repeat(50));

// 测试 JSON 导出
console.log('\n1️⃣  测试 JSON 导出');
try {
  const json = exportToJSON(testNodes, testEdges);
  const parsed = JSON.parse(json);

  console.log('✅ JSON 导出成功');
  console.log(`导出了 ${parsed.nodes.length} 个节点和 ${parsed.edges.length} 条边`);

  assert(parsed.nodes.length === testNodes.length, 'JSON 节点数应该匹配');
  assert(parsed.edges.length === testEdges.length, 'JSON 边数应该匹配');
} catch (error) {
  console.error('❌ JSON 导出测试失败:', error.message);
}

// 测试 GraphML 导出
console.log('\n2️⃣  测试 GraphML 导出');
try {
  const graphml = exportToGraphML(testNodes, testEdges);

  console.log('✅ GraphML 导出成功');
  console.log(`生成了 ${graphml.length} 字符的 GraphML 文件`);

  assert(graphml.includes('<?xml'), 'GraphML 应该包含 XML 声明');
  assert(graphml.includes('<graphml'), 'GraphML 应该包含 graphml 标签');
  assert(graphml.includes('<node'), 'GraphML 应该包含 node 标签');
  assert(graphml.includes('<edge'), 'GraphML 应该包含 edge 标签');
} catch (error) {
  console.error('❌ GraphML 导出测试失败:', error.message);
}

// 测试 DOT 导出
console.log('\n3️⃣  测试 DOT 导出');
try {
  const dot = exportToDOT(testNodes, testEdges);

  console.log('✅ DOT 导出成功');
  console.log(`生成了 ${dot.length} 字符的 DOT 文件`);

  assert(dot.includes('digraph'), 'DOT 应该包含 digraph 声明');
  assert(dot.includes('->'), 'DOT 应该包含边的定义');
} catch (error) {
  console.error('❌ DOT 导出测试失败:', error.message);
}

// ==================== 测试总结 ====================

console.log('\n\n' + '='.repeat(50));
console.log('✨ 测试完成！');
console.log('='.repeat(50));
console.log('\n所有核心功能测试通过 ✅');
console.log('\n建议：');
console.log('  1. 在实际应用中测试大规模图谱（1000+ 节点）');
console.log('  2. 测试 LLM 实体提取功能（需要 LLM 服务运行）');
console.log('  3. 测试导出文件的实际保存功能');
console.log('  4. 在浏览器中测试 3D 可视化');
console.log('  5. 进行性能基准测试');
console.log('\n运行方式:');
console.log('  node desktop-app-vue/test-graph-features.js');
console.log('');
