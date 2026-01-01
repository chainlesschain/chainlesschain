/**
 * 识别中频工具（51-150名）
 * 基于频率评分算法
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  识别中频工具（51-150名）                               ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 高频类别（基础功能）
const highFreqCategories = {
  'file': 10, 'data': 9, 'text': 9, 'ai': 8,
  'network': 7, 'format': 7, 'utility': 7,
  'code': 6, 'image': 6, 'document': 6,
  'system': 5, 'web': 5, 'automation': 5,
  'project': 4, 'database': 4, 'blockchain': 4,
  'media': 3, 'security': 3
};

// 高频关键词
const highFreqKeywords = [
  'read', 'write', 'parse', 'generate', 'convert',
  'search', 'query', 'create', 'update', 'delete',
  'analyze', 'process', 'execute', 'call', 'request',
  'file', 'data', 'text', 'json', 'xml', 'csv',
  'api', 'http', 'fetch', 'format', 'validator'
];

// 风险级别权重
const riskLevelWeight = {
  1: 5, 2: 3, 3: 1, 4: 0.5, 5: 0.1
};

function calculateFrequencyScore(tool) {
  let score = 0;

  const categoryScore = highFreqCategories[tool.category] || 0;
  score += categoryScore * 10;

  const name = (tool.name || '').toLowerCase();
  const desc = (tool.description || '').toLowerCase();
  const displayName = (tool.display_name || '').toLowerCase();

  highFreqKeywords.forEach(keyword => {
    if (name.includes(keyword)) score += 5;
    if (desc.includes(keyword)) score += 2;
    if (displayName.includes(keyword)) score += 1;
  });

  const riskLevel = tool.risk_level || 1;
  score *= (riskLevelWeight[riskLevel] || 1);

  if (tool.is_builtin === 1) score += 10;

  // 特殊加分
  if (name.match(/file_(read|write|list|search|copy|move|delete)/)) score += 20;
  if (name.match(/(json|xml|csv|yaml)_(parser|generator)/)) score += 15;
  if (name.match(/(http|api|fetch|request)/)) score += 15;
  if (name.match(/text_(analyzer|processor|formatter)/)) score += 15;
  if (name.match(/(model_predictor|info_searcher|text_generator)/)) score += 15;

  return score;
}

// 计算频率分数
const scoredTools = tools.map(tool => ({
  ...tool,
  frequencyScore: calculateFrequencyScore(tool)
}));

// 排序
const sortedTools = scoredTools.sort((a, b) => b.frequencyScore - a.frequencyScore);

// 取51-150名（100个工具）
const midFreqTools = sortedTools.slice(50, 150);

console.log(`总工具数: ${tools.length}`);
console.log(`识别出中频工具: ${midFreqTools.length}个 (排名51-150)\n`);

// 按类别统计
const categoryStats = {};
midFreqTools.forEach(t => {
  categoryStats[t.category] = (categoryStats[t.category] || 0) + 1;
});

console.log('中频工具按类别分布:');
Object.entries(categoryStats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}个`);
  });

// 按风险级别统计
const riskStats = {};
midFreqTools.forEach(t => {
  const level = t.risk_level || 1;
  riskStats[level] = (riskStats[level] || 0) + 1;
});

console.log('\n中频工具按风险级别分布:');
Object.entries(riskStats)
  .sort((a, b) => a[0] - b[0])
  .forEach(([level, count]) => {
    console.log(`  Level ${level}: ${count}个`);
  });

// 显示排名51-70的工具
console.log('\n排名51-70的工具:');
midFreqTools.slice(0, 20).forEach((tool, i) => {
  console.log(`  ${51 + i}. ${tool.id} (${tool.category}) - 分数:${tool.frequencyScore.toFixed(0)}`);
  console.log(`     ${tool.display_name}`);
  console.log(`     当前examples数: ${tool.examples?.length || 0}`);
});

// 检查examples数量
const needMoreExamples = midFreqTools.filter(t => !t.examples || t.examples.length < 2);

console.log(`\n需要补充examples的中频工具: ${needMoreExamples.length}个`);
console.log(`  (当前examples数量 < 2)`);

// 保存到文件
const report = {
  generatedAt: new Date().toISOString(),
  totalTools: tools.length,
  selectedCount: midFreqTools.length,
  rankRange: '51-150',
  tools: midFreqTools.map(t => ({
    rank: sortedTools.indexOf(t) + 1,
    id: t.id,
    name: t.name,
    display_name: t.display_name,
    category: t.category,
    description: t.description,
    risk_level: t.risk_level || 1,
    current_examples_count: t.examples?.length || 0,
    frequency_score: t.frequencyScore,
    parameters_schema: t.parameters_schema
  }))
};

fs.writeFileSync('./mid-frequency-tools.json', JSON.stringify(report, null, 2));
console.log('\n📄 已保存到: mid-frequency-tools.json');
