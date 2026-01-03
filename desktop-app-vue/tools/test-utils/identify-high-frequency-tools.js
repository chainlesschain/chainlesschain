/**
 * 识别高频工具（前50个）
 * 基于类别、功能和通用性判断
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  识别高频工具（前50个）                                 ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 高频类别（基础功能，使用频率高）
const highFreqCategories = {
  'file': 10,           // 文件操作
  'data': 9,            // 数据处理
  'text': 9,            // 文本处理
  'ai': 8,              // AI推理
  'network': 7,         // 网络请求
  'format': 7,          // 格式转换
  'utility': 7,         // 实用工具
  'code': 6,            // 代码处理
  'image': 6,           // 图片处理
  'document': 6,        // 文档处理
  'system': 5,          // 系统操作
  'web': 5,             // Web相关
  'automation': 5,      // 自动化
  'project': 4,         // 项目管理
  'database': 4         // 数据库
};

// 高频功能关键词（工具名称或描述包含这些关键词）
const highFreqKeywords = [
  'read', 'write', 'parse', 'generate', 'convert',
  'search', 'query', 'create', 'update', 'delete',
  'analyze', 'process', 'execute', 'call', 'request',
  'file', 'data', 'text', 'json', 'xml', 'csv',
  'api', 'http', 'fetch', 'format', 'validator'
];

// 低风险工具更常用
const riskLevelWeight = {
  1: 5,   // 低风险
  2: 3,   // 中低风险
  3: 1,   // 中风险
  4: 0.5, // 中高风险
  5: 0.1  // 高风险
};

/**
 * 计算工具的频率分数
 */
function calculateFrequencyScore(tool) {
  let score = 0;

  // 1. 类别分数
  const categoryScore = highFreqCategories[tool.category] || 0;
  score += categoryScore * 10;

  // 2. 关键词分数
  const name = (tool.name || '').toLowerCase();
  const desc = (tool.description || '').toLowerCase();
  const displayName = (tool.display_name || '').toLowerCase();

  highFreqKeywords.forEach(keyword => {
    if (name.includes(keyword)) score += 5;
    if (desc.includes(keyword)) score += 2;
    if (displayName.includes(keyword)) score += 1;
  });

  // 3. 风险级别分数（风险越低，使用越频繁）
  const riskLevel = tool.risk_level || 1;
  score *= (riskLevelWeight[riskLevel] || 1);

  // 4. 是否是内置工具
  if (tool.is_builtin === 1) {
    score += 10;
  }

  // 5. 特殊加分项
  // 文件基础操作
  if (name.match(/file_(read|write|list|search|copy|move|delete)/)) {
    score += 20;
  }
  // 数据格式解析/生成
  if (name.match(/(json|xml|csv|yaml)_(parser|generator)/)) {
    score += 15;
  }
  // HTTP/网络请求
  if (name.match(/(http|api|fetch|request)/)) {
    score += 15;
  }
  // 文本处理
  if (name.match(/text_(analyzer|processor|formatter)/)) {
    score += 15;
  }
  // AI基础功能
  if (name.match(/(model_predictor|info_searcher|text_generator)/)) {
    score += 15;
  }

  return score;
}

// 计算所有工具的频率分数
const scoredTools = tools.map(tool => ({
  ...tool,
  frequencyScore: calculateFrequencyScore(tool)
}));

// 排序并取前50
const top50Tools = scoredTools
  .sort((a, b) => b.frequencyScore - a.frequencyScore)
  .slice(0, 50);

console.log(`总工具数: ${tools.length}`);
console.log(`识别出高频工具: 50个\n`);

// 按类别统计
const categoryStats = {};
top50Tools.forEach(t => {
  categoryStats[t.category] = (categoryStats[t.category] || 0) + 1;
});

console.log('高频工具按类别分布:');
Object.entries(categoryStats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}个`);
  });

// 按风险级别统计
const riskStats = {};
top50Tools.forEach(t => {
  const level = t.risk_level || 1;
  riskStats[level] = (riskStats[level] || 0) + 1;
});

console.log('\n高频工具按风险级别分布:');
Object.entries(riskStats)
  .sort((a, b) => a[0] - b[0])
  .forEach(([level, count]) => {
    console.log(`  Level ${level}: ${count}个`);
  });

// 显示前20个工具
console.log('\n前20个高频工具:');
top50Tools.slice(0, 20).forEach((tool, i) => {
  console.log(`  ${i+1}. ${tool.id} (${tool.category}) - 分数:${tool.frequencyScore.toFixed(0)}`);
  console.log(`     ${tool.display_name}`);
  console.log(`     当前examples数: ${tool.examples?.length || 0}`);
});

// 保存到文件
const report = {
  generatedAt: new Date().toISOString(),
  totalTools: tools.length,
  selectedCount: 50,
  tools: top50Tools.map(t => ({
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

fs.writeFileSync('./high-frequency-tools.json', JSON.stringify(report, null, 2));
console.log('\n📄 已保存到: high-frequency-tools.json');

// 检查哪些高频工具只有1个example
const needMoreExamples = top50Tools.filter(t =>
  !t.examples || t.examples.length < 2
);

console.log(`\n需要补充examples的高频工具: ${needMoreExamples.length}个`);
console.log('  (当前examples数量 < 2)');
