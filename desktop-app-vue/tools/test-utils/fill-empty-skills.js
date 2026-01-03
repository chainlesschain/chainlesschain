/**
 * Phase 2: 为空技能添加工具引用
 * 根据技能类别和描述，智能匹配合适的工具
 */

const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  Phase 2: 填充空技能                                    ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 加载工具列表
const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const toolsByCategory = new Map();

// 按类别组织工具
tools.forEach(tool => {
  if (!toolsByCategory.has(tool.category)) {
    toolsByCategory.set(tool.category, []);
  }
  toolsByCategory.get(tool.category).push(tool);
});

// 定义空技能的工具映射
const skillToolMappings = {
  'skill_image_processing': {
    description: '图片处理',
    tools: ['image_editor', 'image_filter', 'image_resizer', 'image_compressor', 'image_converter']
  },
  'skill_video_processing': {
    description: '视频处理',
    tools: ['video_cutter', 'video_merger', 'video_editor', 'video_compressor', 'video_converter']
  },
  'skill_code_execution': {
    description: '代码执行',
    tools: ['code_executor', 'file_reader', 'file_writer', 'test_runner']
  },
  'skill_knowledge_search': {
    description: '知识库搜索',
    tools: ['info_searcher', 'file_reader', 'text_analyzer', 'keyword_generator']
  },
  'skill_template_application': {
    description: '模板应用',
    tools: ['template_renderer', 'file_writer', 'format_output', 'html_generator']
  },
  'skill_network_requests': {
    description: '网络请求',
    tools: ['http_client', 'api_client', 'websocket_client', 'url_validator']
  },
  'skill_ai_conversation': {
    description: 'AI对话',
    tools: ['text_generator', 'text_analyzer', 'prompt_generator', 'sentiment_analyzer']
  },
  'skill_automation_workflow': {
    description: '自动化工作流',
    tools: ['file_reader', 'file_writer', 'http_client', 'task_scheduler', 'event_processor']
  }
};

console.log(`为 ${Object.keys(skillToolMappings).length} 个空技能准备工具映射\n`);

// 验证工具是否存在
const validatedMappings = {};
let totalToolsAdded = 0;

Object.entries(skillToolMappings).forEach(([skillId, mapping]) => {
  const validTools = mapping.tools.filter(toolName => {
    return tools.some(t => t.name === toolName);
  });

  validatedMappings[skillId] = {
    description: mapping.description,
    tools: validTools,
    invalidTools: mapping.tools.filter(t => !validTools.includes(t))
  };

  console.log(`${skillId} (${mapping.description}):`);
  console.log(`  ✓ 有效工具: ${validTools.length}/${mapping.tools.length}`);
  if (validatedMappings[skillId].invalidTools.length > 0) {
    console.log(`  ✗ 无效工具: ${validatedMappings[skillId].invalidTools.join(', ')}`);
  }
  console.log('');

  totalToolsAdded += validTools.length;
});

console.log(`总计将添加 ${totalToolsAdded} 个工具引用\n`);

// 读取并修改技能文件
const builtinSkillsPath = './src/main/skill-tool-system/builtin-skills.js';
let content = fs.readFileSync(builtinSkillsPath, 'utf-8');

// 备份
const backupPath = builtinSkillsPath + '.backup-fill-empty-' + Date.now();
fs.writeFileSync(backupPath, content);
console.log(`📦 已备份到: ${backupPath}\n`);

console.log('═══ 应用工具映射 ===\n');

let modificationsCount = 0;

Object.entries(validatedMappings).forEach(([skillId, mapping]) => {
  if (mapping.tools.length === 0) {
    console.log(`⚠️  ${skillId}: 没有有效工具可添加`);
    return;
  }

  // 构建工具数组字符串
  const toolsArrayStr = mapping.tools.map(t => `"${t}"`).join(',\n      ');

  // 查找技能定义中的 "tools": [] 并替换
  const emptyToolsPattern = new RegExp(
    `("id":\\s*"${skillId}"[\\s\\S]*?"tools":\\s*)\\[\\s*\\]`,
    'g'
  );

  const replacement = `$1[\n      ${toolsArrayStr}\n    ]`;

  if (emptyToolsPattern.test(content)) {
    content = content.replace(emptyToolsPattern, replacement);
    modificationsCount++;
    console.log(`✓ ${skillId}: 添加了 ${mapping.tools.length} 个工具`);
  } else {
    console.log(`✗ ${skillId}: 未找到匹配的技能定义`);
  }
});

console.log(`\n成功修改 ${modificationsCount} 个技能\n`);

// 保存修改
fs.writeFileSync(builtinSkillsPath, content);

console.log('═══════════════════════════════════════════════════════════');
console.log(`✅ 已为 ${modificationsCount} 个空技能添加工具`);
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`📝 已更新: ${builtinSkillsPath}\n`);

// 验证结果
console.log('═══ 验证结果 ===\n');

try {
  delete require.cache[require.resolve(builtinSkillsPath)];
  const skills = require(builtinSkillsPath);

  const emptySkills = skills.filter(s => !s.tools || s.tools.length === 0);
  const filledSkills = skills.filter(s => s.tools && s.tools.length > 0);

  console.log(`技能总数: ${skills.length}`);
  console.log(`有工具的技能: ${filledSkills.length} (${(filledSkills.length/skills.length*100).toFixed(1)}%)`);
  console.log(`空技能: ${emptySkills.length}`);

  if (emptySkills.length === 0) {
    console.log('\n🎉 所有技能现在都有工具了！');
  } else {
    console.log(`\n仍然为空的技能 (${emptySkills.length}个):`);
    emptySkills.forEach(skill => {
      console.log(`  - ${skill.id}: ${skill.name}`);
    });
  }

  // 计算总工具引用数
  let totalToolRefs = 0;
  skills.forEach(skill => {
    if (skill.tools) {
      totalToolRefs += skill.tools.length;
    }
  });

  console.log(`\n总工具引用数: ${totalToolRefs}`);
  console.log(`平均每技能: ${(totalToolRefs/skills.length).toFixed(1)}个工具\n`);

} catch (error) {
  console.error(`❌ 验证失败: ${error.message}`);
  console.log(`\n正在恢复备份...`);
  fs.writeFileSync(builtinSkillsPath, fs.readFileSync(backupPath, 'utf-8'));
  console.log(`✅ 已恢复到备份版本`);
}
