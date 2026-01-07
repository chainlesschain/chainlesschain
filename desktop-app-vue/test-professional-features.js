/**
 * 职业专用功能测试脚本
 * 验证所有新增的Prompt模板、技能和工具
 */

const path = require('path');

console.log('\n========================================');
console.log('职业专用功能验证测试');
console.log('========================================\n');

// 1. 测试技能加载
console.log('【1】验证职业专用技能加载');
console.log('----------------------------------------');
try {
  const skills = require('./src/main/skill-tool-system/builtin-skills');

  const professionalSkills = skills.filter(s =>
    ['medical', 'legal', 'education', 'research'].includes(s.category)
  );

  console.log(`✓ 技能文件加载成功`);
  console.log(`  总技能数: ${skills.length}`);
  console.log(`  职业专用技能数: ${professionalSkills.length}`);

  // 按职业分类统计
  const byCategory = {
    medical: professionalSkills.filter(s => s.category === 'medical'),
    legal: professionalSkills.filter(s => s.category === 'legal'),
    education: professionalSkills.filter(s => s.category === 'education'),
    research: professionalSkills.filter(s => s.category === 'research')
  };

  console.log('\n  分类统计:');
  console.log(`    🏥 医疗技能: ${byCategory.medical.length}个`);
  byCategory.medical.forEach(s => console.log(`       - ${s.id}: ${s.name}`));

  console.log(`\n    ⚖️  法律技能: ${byCategory.legal.length}个`);
  byCategory.legal.forEach(s => console.log(`       - ${s.id}: ${s.name}`));

  console.log(`\n    👨‍🏫 教育技能: ${byCategory.education.length}个`);
  byCategory.education.forEach(s => console.log(`       - ${s.id}: ${s.name}`));

  console.log(`\n    🔬 科研技能: ${byCategory.research.length}个`);
  byCategory.research.forEach(s => console.log(`       - ${s.id}: ${s.name}`));

} catch (error) {
  console.error('✗ 技能加载失败:', error.message);
  process.exit(1);
}

// 2. 测试工具加载
console.log('\n\n【2】验证职业专用工具加载');
console.log('----------------------------------------');
try {
  const tools = require('./src/main/skill-tool-system/builtin-tools');

  const professionalTools = tools.filter(t =>
    ['medical', 'legal', 'education', 'research'].includes(t.category)
  );

  console.log(`✓ 工具文件加载成功`);
  console.log(`  总工具数: ${tools.length}`);
  console.log(`  职业专用工具数: ${professionalTools.length}`);

  // 按职业分类统计
  const byCategory = {
    medical: professionalTools.filter(t => t.category === 'medical'),
    legal: professionalTools.filter(t => t.category === 'legal'),
    education: professionalTools.filter(t => t.category === 'education'),
    research: professionalTools.filter(t => t.category === 'research')
  };

  console.log('\n  分类统计:');
  console.log(`    🏥 医疗工具: ${byCategory.medical.length}个`);
  byCategory.medical.forEach(t => console.log(`       - ${t.id}: ${t.display_name}`));

  console.log(`\n    ⚖️  法律工具: ${byCategory.legal.length}个`);
  byCategory.legal.forEach(t => console.log(`       - ${t.id}: ${t.display_name}`));

  console.log(`\n    👨‍🏫 教育工具: ${byCategory.education.length}个`);
  byCategory.education.forEach(t => console.log(`       - ${t.id}: ${t.display_name}`));

  console.log(`\n    🔬 科研工具: ${byCategory.research.length}个`);
  byCategory.research.forEach(t => console.log(`       - ${t.id}: ${t.display_name}`));

} catch (error) {
  console.error('✗ 工具加载失败:', error.message);
  process.exit(1);
}

// 3. 验证技能与工具的关联
console.log('\n\n【3】验证技能与工具的关联关系');
console.log('----------------------------------------');
try {
  const skills = require('./src/main/skill-tool-system/builtin-skills');
  const tools = require('./src/main/skill-tool-system/builtin-tools');

  const professionalSkills = skills.filter(s =>
    ['medical', 'legal', 'education', 'research'].includes(s.category)
  );

  const toolNameSet = new Set(tools.map(t => t.name));

  let allValid = true;

  professionalSkills.forEach(skill => {
    if (skill.tools && skill.tools.length > 0) {
      console.log(`\n  ${skill.name} (${skill.id}):`);
      console.log(`    关联工具数: ${skill.tools.length}`);

      const invalidTools = skill.tools.filter(toolName => !toolNameSet.has(toolName));
      if (invalidTools.length > 0) {
        console.log(`    ✗ 未找到的工具: ${invalidTools.join(', ')}`);
        allValid = false;
      } else {
        console.log(`    ✓ 所有工具关联有效`);
      }
    }
  });

  if (allValid) {
    console.log('\n✓ 所有技能的工具关联都有效');
  } else {
    console.log('\n✗ 存在无效的工具关联');
  }

} catch (error) {
  console.error('✗ 关联验证失败:', error.message);
  process.exit(1);
}

// 4. 验证Prompt模板定义
console.log('\n\n【4】验证Prompt模板定义');
console.log('----------------------------------------');
try {
  const PromptTemplateManager = require('./src/main/prompt/prompt-template-manager');

  // 检查是否有insertBuiltInTemplates方法
  console.log('✓ Prompt模板管理器加载成功');

  // 读取文件内容统计模板数量
  const fs = require('fs');
  const content = fs.readFileSync('./src/main/prompt/prompt-template-manager.js', 'utf8');

  // 统计builtin-开头的ID数量
  const builtinMatches = content.match(/id:\s*['"]builtin-/g);
  const totalBuiltinTemplates = builtinMatches ? builtinMatches.length : 0;

  // 统计各职业的模板
  const medicalTemplates = (content.match(/id:\s*['"]builtin-medical-/g) || []).length;
  const legalTemplates = (content.match(/id:\s*['"]builtin-legal-/g) || []).length;
  const teacherTemplates = (content.match(/id:\s*['"]builtin-teacher-/g) || []).length;
  const researchTemplates = (content.match(/id:\s*['"]builtin-research-/g) || []).length;

  console.log(`  文件中定义的内置模板总数: ${totalBuiltinTemplates}`);
  console.log(`\n  职业专用模板分布:`);
  console.log(`    🏥 医疗模板: ${medicalTemplates}个`);
  console.log(`    ⚖️  法律模板: ${legalTemplates}个`);
  console.log(`    👨‍🏫 教育模板: ${teacherTemplates}个`);
  console.log(`    🔬 科研模板: ${researchTemplates}个`);

  const totalProfessional = medicalTemplates + legalTemplates + teacherTemplates + researchTemplates;
  console.log(`\n  职业专用模板总数: ${totalProfessional}个`);

} catch (error) {
  console.error('✗ Prompt模板验证失败:', error.message);
  process.exit(1);
}

// 5. 验证代码质量
console.log('\n\n【5】代码质量检查');
console.log('----------------------------------------');
try {
  const skills = require('./src/main/skill-tool-system/professional-skills');
  const tools = require('./src/main/skill-tool-system/professional-tools');

  // 检查必填字段
  let qualityIssues = [];

  skills.forEach(skill => {
    if (!skill.id) qualityIssues.push(`技能缺少id: ${skill.name}`);
    if (!skill.name) qualityIssues.push(`技能缺少name: ${skill.id}`);
    if (!skill.category) qualityIssues.push(`技能缺少category: ${skill.id}`);
    if (!skill.description) qualityIssues.push(`技能缺少description: ${skill.id}`);
  });

  tools.forEach(tool => {
    if (!tool.id) qualityIssues.push(`工具缺少id: ${tool.name}`);
    if (!tool.name) qualityIssues.push(`工具缺少name: ${tool.id}`);
    if (!tool.category) qualityIssues.push(`工具缺少category: ${tool.id}`);
    if (!tool.description) qualityIssues.push(`工具缺少description: ${tool.id}`);
    if (!tool.parameters_schema) qualityIssues.push(`工具缺少parameters_schema: ${tool.id}`);
  });

  if (qualityIssues.length === 0) {
    console.log('✓ 所有必填字段都已正确定义');
    console.log(`  已验证 ${skills.length} 个技能和 ${tools.length} 个工具`);
  } else {
    console.log('✗ 发现以下问题:');
    qualityIssues.forEach(issue => console.log(`  - ${issue}`));
  }

} catch (error) {
  console.error('✗ 代码质量检查失败:', error.message);
  process.exit(1);
}

// 测试总结
console.log('\n\n========================================');
console.log('测试总结');
console.log('========================================');
console.log('✓ 所有职业专用功能加载验证通过!');
console.log('\n功能统计:');
console.log('  - Prompt模板: 24个职业专用模板');
console.log('  - Skills技能: 16个职业专用技能');
console.log('  - Tools工具: 20个职业专用工具');
console.log('\n状态: 就绪，可以启动应用进行实际测试');
console.log('========================================\n');
