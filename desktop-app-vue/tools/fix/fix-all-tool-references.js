/**
 * Phase 1: 修复所有技能文件中的无效工具引用
 * 包括 builtin-skills.js, additional-skills.js, additional-skills-v3.js
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  Phase 1: 修复所有技能文件的工具引用                   ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 加载工具列表
const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const toolsMap = new Map(tools.map(t => [t.name, t]));

// 创建工具名称映射（移除tool_前缀）
const toolNameMappings = new Map();

tools.forEach(tool => {
  // 添加带tool_前缀的映射
  toolNameMappings.set(`tool_${tool.name}`, tool.name);
});

console.log(`创建了 ${toolNameMappings.size} 个工具名称映射\n`);

// 需要修复的文件列表
const skillFiles = [
  './src/main/skill-tool-system/builtin-skills.js',
  './src/main/skill-tool-system/additional-skills.js',
  './src/main/skill-tool-system/additional-skills-v3.js'
];

let totalReplacements = 0;

skillFiles.forEach(filePath => {
  console.log(`\n═══ 处理文件: ${path.basename(filePath)} ===\n`);

  // 备份原文件
  const backupPath = filePath + '.backup-fix-all-' + Date.now();
  const originalContent = fs.readFileSync(filePath, 'utf-8');
  fs.writeFileSync(backupPath, originalContent);
  console.log(`📦 已备份到: ${backupPath}`);

  let content = originalContent;
  let fileReplacements = 0;

  // 遍历所有映射，进行字符串替换
  toolNameMappings.forEach((correctName, wrongName) => {
    // 替换数组中的工具名称引用: "tool_xxx" → "xxx"
    const patterns = [
      new RegExp(`"${wrongName}"`, 'g'),
      new RegExp(`'${wrongName}'`, 'g')
    ];

    patterns.forEach(pattern => {
      const beforeCount = (content.match(pattern) || []).length;
      if (beforeCount > 0) {
        content = content.replace(pattern, `"${correctName}"`);
        fileReplacements += beforeCount;
        console.log(`  ✓ ${wrongName} → ${correctName} (${beforeCount}处)`);
      }
    });
  });

  // 保存修改后的文件
  if (fileReplacements > 0) {
    fs.writeFileSync(filePath, content);
    console.log(`\n✅ 替换了 ${fileReplacements} 处引用`);
    totalReplacements += fileReplacements;
  } else {
    console.log('\n无需修改');
    // 删除备份
    fs.unlinkSync(backupPath);
  }
});

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log(`✅ 总共修正了 ${totalReplacements} 个工具引用`);
console.log('═══════════════════════════════════════════════════════════\n');

// 验证修复结果
console.log('═══ 验证修复结果 ===\n');

try {
  // 清除缓存并重新加载
  skillFiles.forEach(filePath => {
    delete require.cache[require.resolve(filePath)];
  });

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
  console.log(`无效工具引用: ${invalidRefs} (${(invalidRefs/(validRefs+invalidRefs)*100).toFixed(1)}%)`);

  if (missingTools.size > 0) {
    console.log(`\n仍然缺失的工具 (${missingTools.size}个):`);
    Array.from(missingTools).slice(0, 20).forEach(tool => {
      console.log(`  - ${tool}`);
    });
    if (missingTools.size > 20) {
      console.log(`  ... 还有 ${missingTools.size - 20} 个`);
    }
  }

  // 保存验证报告
  const report = {
    timestamp: new Date().toISOString(),
    totalReplacements: totalReplacements,
    validReferencesAfter: validRefs,
    invalidReferencesAfter: invalidRefs,
    validityRate: `${(validRefs/(validRefs+invalidRefs)*100).toFixed(1)}%`,
    missingTools: Array.from(missingTools)
  };

  fs.writeFileSync('./fix-all-tool-references-report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 详细报告已保存到: fix-all-tool-references-report.json\n');

} catch (error) {
  console.error(`❌ 验证失败: ${error.message}`);
}
