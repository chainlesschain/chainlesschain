/**
 * 技能和工具加载测试
 * 验证所有内置技能和工具是否成功加载
 */

const { logger, createLogger } = require('../utils/logger.js');
const builtinSkills = require('./builtin-skills');
const builtinTools = require('./builtin-tools');

logger.info('========== 技能和工具加载测试 ==========\n');

// 测试技能加载
logger.info('📦 技能加载测试:');
logger.info(`总技能数: ${builtinSkills.length}`);

// 统计各批次技能
const batches = {
  'batch1': { range: [0, 15], count: 0 },
  'batch2': { range: [15, 25], count: 0 },
  'batch3': { range: [25, 35], count: 0 },
  'batch4': { range: [35, 45], count: 0 },
  'batch5': { range: [45, 55], count: 0 },
  'batch6': { range: [55, 65], count: 0 }
};

builtinSkills.forEach((skill, index) => {
  for (const batch in batches) {
    const { range } = batches[batch];
    if (index >= range[0] && index < range[1]) {
      batches[batch].count++;
      break;
    }
  }
  if (index >= 65) {
    logger.info(`  技能 ${index + 1}: ${skill.name} (${skill.display_name})`);
  }
});

logger.info('\n批次统计:');
Object.keys(batches).forEach(batch => {
  logger.info(`  ${batch}: ${batches[batch].count} 个技能`);
});

// 测试工具加载
logger.info('\n\n🔧 工具加载测试:');
logger.info(`总工具数: ${builtinTools.length}`);

// 统计各批次工具
const toolBatches = {
  'batch1': { range: [0, 12], count: 0 },
  'batch2': { range: [12, 32], count: 0 },
  'batch3': { range: [32, 52], count: 0 },
  'batch4': { range: [52, 72], count: 0 },
  'batch5': { range: [72, 92], count: 0 },
  'batch6': { range: [92, 112], count: 0 }
};

builtinTools.forEach((tool, index) => {
  for (const batch in toolBatches) {
    const { range } = toolBatches[batch];
    if (index >= range[0] && index < range[1]) {
      toolBatches[batch].count++;
      break;
    }
  }
  if (index >= 112) {
    logger.info(`  工具 ${index + 1}: ${tool.name} (${tool.display_name})`);
  }
});

logger.info('\n批次统计:');
Object.keys(toolBatches).forEach(batch => {
  logger.info(`  ${batch}: ${toolBatches[batch].count} 个工具`);
});

// 验证第六批新增内容
logger.info('\n\n✨ 第六批新增内容验证:');

const sixthBatchSkills = builtinSkills.slice(65, 75);
logger.info(`\n第六批技能 (66-75): ${sixthBatchSkills.length} 个`);
sixthBatchSkills.forEach((skill, index) => {
  logger.info(`  ${66 + index}. ${skill.name} - ${skill.display_name}`);
});

const sixthBatchTools = builtinTools.slice(112, 132);
logger.info(`\n第六批工具 (113-132): ${sixthBatchTools.length} 个`);
sixthBatchTools.forEach((tool, index) => {
  logger.info(`  ${113 + index}. ${tool.name} - ${tool.display_name}`);
});

// 最终验证
logger.info('\n\n========== 测试结果 ==========');
const expectedSkills = 135;  // 第十二批后的总数
const expectedTools = 256;  // 第十二批后的总数

if (builtinSkills.length === expectedSkills && builtinTools.length === expectedTools) {
  logger.info('✅ 测试通过!');
  logger.info(`   技能数: ${builtinSkills.length}/${expectedSkills}`);
  logger.info(`   工具数: ${builtinTools.length}/${expectedTools}`);
  logger.info('\n所有技能和工具已成功加载!');
} else {
  logger.info('❌ 测试失败!');
  logger.info(`   技能数: ${builtinSkills.length}/${expectedSkills} ${builtinSkills.length === expectedSkills ? '✓' : '✗'}`);
  logger.info(`   工具数: ${builtinTools.length}/${expectedTools} ${builtinTools.length === expectedTools ? '✓' : '✗'}`);
}

logger.info('================================\n');
