/**
 * 移除技能中无效的工具引用
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  移除无效工具引用                                       ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 加载所有技能和工具
const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const toolsMap = new Map(tools.map(t => [t.name, t]));

// 要处理的文件列表
const skillFiles = [
  './src/main/skill-tool-system/additional-skills.js',
  './src/main/skill-tool-system/additional-skills-v3.js'
];

// 需要移除的工具引用列表（这些工具在系统中不存在）
const invalidToolsToRemove = [
  'tool_ml_model_trainer',
  'tool_seo_optimizer',
  'tool_keyword_extractor',
  'tool_readability_checker',
  'tool_subtitle_generator',
  'tool_audio_cutter',
  'tool_audio_merger',
  'tool_audio_noise_reduction',
  'tool_sql_executor',
  'tool_db_schema_generator',
  'tool_db_migration_tool',
  'tool_api_schema_generator',
  'tool_openapi_doc_generator',
  'tool_api_tester',
  'tool_color_palette_generator',
  'tool_typography_selector',
  'tool_svg_generator',
  'tool_code_coverage_analyzer',
  'tool_code_quality_checker',
  'tool_ci_config_generator',
  'tool_deployment_script_generator'
];

let totalRemovals = 0;

skillFiles.forEach(filePath => {
  console.log(`\n═══ 处理文件: ${path.basename(filePath)} ===\n`);

  // 备份原文件
  const backupPath = filePath + '.backup-remove-invalid-' + Date.now();
  const originalContent = fs.readFileSync(filePath, 'utf-8');
  fs.writeFileSync(backupPath, originalContent);
  console.log(`📦 已备份到: ${backupPath}`);

  let content = originalContent;
  let fileRemovals = 0;

  // 移除无效的工具引用
  invalidToolsToRemove.forEach(invalidTool => {
    // 匹配数组中的工具引用，包括前后的逗号和空格
    const patterns = [
      // 匹配: "tool_xxx",
      new RegExp(`"${invalidTool}",?\\s*`, 'g'),
      new RegExp(`'${invalidTool}',?\\s*`, 'g'),
      // 匹配数组中最后一个元素前的逗号: , "tool_xxx"
      new RegExp(`,\\s*"${invalidTool}"`, 'g'),
      new RegExp(`,\\s*'${invalidTool}'`, 'g')
    ];

    patterns.forEach(pattern => {
      const beforeCount = (content.match(pattern) || []).length;
      if (beforeCount > 0) {
        content = content.replace(pattern, '');
        fileRemovals += beforeCount;
        console.log(`  ✗ 移除 ${invalidTool} (${beforeCount}处)`);
      }
    });
  });

  // 清理tools数组中的空格和多余逗号
  // 修复: [   ] → []
  content = content.replace(/tools":\s*\[\s+\]/g, 'tools": []');
  // 修复: [ , "xxx"] → ["xxx"]
  content = content.replace(/\[\s*,\s*/g, '[');
  // 修复: [, , "xxx"] → ["xxx"]
  content = content.replace(/,\s*,/g, ',');
  // 修复: ["xxx", , ] → ["xxx"]
  content = content.replace(/,\s*\]/g, ']');

  // 保存修改后的文件
  if (fileRemovals > 0) {
    fs.writeFileSync(filePath, content);
    console.log(`\n✅ 移除了 ${fileRemovals} 个无效引用`);
    totalRemovals += fileRemovals;
  } else {
    console.log('\n无需修改');
    fs.unlinkSync(backupPath);
  }
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log(`✅ 总共移除了 ${totalRemovals} 个无效工具引用`);
console.log('═══════════════════════════════════════════════════════════\n');

// 验证清理结果
console.log('═══ 验证清理结果 ===\n');

try {
  // 清除缓存
  skillFiles.forEach(filePath => {
    delete require.cache[require.resolve(filePath)];
  });
  delete require.cache[require.resolve('./src/main/skill-tool-system/builtin-skills.js')];

  const skills = require('./src/main/skill-tool-system/builtin-skills.js');

  let validRefs = 0;
  let invalidRefs = 0;
  const missingTools = new Set();

  skills.forEach(skill => {
    if (skill.tools) {
      skill.tools.forEach(toolName => {
        if (toolsMap.has(toolName)) {
          validRefs++;
        } else {
          invalidRefs++;
          missingTools.add(toolName);
        }
      });
    }
  });

  console.log(`技能总数: ${skills.length}`);
  console.log(`有效工具引用: ${validRefs} (${(validRefs/(validRefs+invalidRefs)*100).toFixed(1)}%)`);
  console.log(`无效工具引用: ${invalidRefs}`);

  if (invalidRefs === 0) {
    console.log('\n🎉 所有工具引用现在都是有效的！');
  } else {
    console.log(`\n仍然存在 ${invalidRefs} 个无效引用:`);
    Array.from(missingTools).forEach(tool => {
      console.log(`  - ${tool}`);
    });
  }

  console.log('\n📄 清理报告已保存\n');

} catch (error) {
  console.error(`❌ 验证失败: ${error.message}`);
}
