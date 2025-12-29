const fs = require('fs');
const path = require('path');

// 读取技能和工具定义
const builtinSkills = require('./src/main/skill-tool-system/builtin-skills.js');
const builtinTools = require('./src/main/skill-tool-system/builtin-tools.js');

// 创建文档目录
const docsDir = path.join(__dirname, '..', 'docs');
const skillsDir = path.join(docsDir, 'skills');
const toolsDir = path.join(docsDir, 'tools');

[skillsDir, toolsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 生成技能文档
function generateSkillDoc(skill) {
  const config = typeof skill.config === 'string' ? JSON.parse(skill.config) : skill.config;
  const tags = typeof skill.tags === 'string' ? JSON.parse(skill.tags) : skill.tags;

  return `# ${skill.display_name || skill.name}

## 概述

**分类**: ${skill.category}
**状态**: ${skill.enabled ? '启用' : '禁用'}
**类型**: ${skill.is_builtin ? '内置技能' : '自定义技能'}
**图标**: ${skill.icon || 'default'}

${skill.description || '暂无描述'}

## 标签

${tags.map(tag => `\`${tag}\``).join(' ')}

## 配置选项

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## 包含的工具

${skill.tools && skill.tools.length > 0 ? skill.tools.map(tool => `- \`${tool}\``).join('\n') : '暂无关联工具'}

## 使用场景

根据技能分类，适用于以下场景：

${getCategoryScenarios(skill.category)}

## 权限要求

- 根据关联工具的权限要求而定

## 文档路径

\`${skill.doc_path || 'docs/skills/' + skill.id + '.md'}\`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
`;
}

// 生成工具文档
function generateToolDoc(tool) {
  const paramsSchema = typeof tool.parameters_schema === 'string' ? JSON.parse(tool.parameters_schema) : tool.parameters_schema;
  const returnSchema = typeof tool.return_schema === 'string' ? JSON.parse(tool.return_schema) : tool.return_schema;
  const config = typeof tool.config === 'string' ? JSON.parse(tool.config) : tool.config;
  const permissions = typeof tool.required_permissions === 'string' ? JSON.parse(tool.required_permissions) : tool.required_permissions;

  return `# ${tool.display_name || tool.name}

## 基本信息

- **工具ID**: ${tool.id}
- **工具名称**: ${tool.name}
- **类型**: ${tool.tool_type}
- **分类**: ${tool.category}
- **风险等级**: ${tool.risk_level}/5
- **状态**: ${tool.enabled ? '启用' : '禁用'}
- **来源**: ${tool.is_builtin ? '内置工具' : '自定义工具'}

## 功能描述

${tool.description || '暂无描述'}

## 参数Schema

\`\`\`json
${JSON.stringify(paramsSchema, null, 2)}
\`\`\`

## 返回值Schema

\`\`\`json
${JSON.stringify(returnSchema, null, 2)}
\`\`\`

## 配置选项

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## 权限要求

${permissions && permissions.length > 0 ? permissions.map(p => `- \`${p}\``).join('\n') : '无特殊权限要求'}

## 使用示例

\`\`\`javascript
const result = await callTool('${tool.name}', {
  // 参数根据 parameters_schema 定义
});

if (result.success) {
  console.log('执行成功:', result);
} else {
  console.error('执行失败:', result.error);
}
\`\`\`

## 性能指标

- **平均执行时间**: ${tool.avg_execution_time || 0} ms
- **调用次数**: ${tool.usage_count || 0}
- **成功次数**: ${tool.success_count || 0}

## 文档路径

\`${tool.doc_path || 'docs/tools/' + tool.id + '.md'}\`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
`;
}

// 获取分类应用场景
function getCategoryScenarios(category) {
  const scenarios = {
    code: '- 软件开发\n- 代码生成\n- 代码重构\n- 代码审查',
    web: '- 网页开发\n- 前端应用\n- UI/UX设计\n- 响应式布局',
    data: '- 数据分析\n- 数据可视化\n- 统计计算\n- 数据清洗',
    content: '- 内容创作\n- 文章写作\n- 文档编辑\n- SEO优化',
    document: '- 文档生成\n- 格式转换\n- PDF处理\n- Office文件操作',
    media: '- 图片处理\n- 视频编辑\n- 媒体转码\n- 素材管理',
    ai: '- AI对话\n- 智能问答\n- 知识检索\n- 语义理解',
    system: '- 系统管理\n- 文件操作\n- 环境配置\n- 进程管理',
    network: '- 网络请求\n- API调用\n- 数据抓取\n- 接口测试',
    automation: '- 工作流自动化\n- 批量处理\n- 定时任务\n- 流程编排',
    project: '- 项目管理\n- 任务跟踪\n- 团队协作\n- 进度监控',
    template: '- 模板应用\n- 快速搭建\n- 代码生成\n- 项目初始化',
  };
  return scenarios[category] || '- 通用场景';
}

// 执行生成
console.log('开始生成文档...\n');

let skillCount = 0;
let toolCount = 0;

// 生成技能文档
builtinSkills.forEach(skill => {
  const filename = skill.id.replace('skill_', '') + '.md';
  const filepath = path.join(skillsDir, filename);
  const content = generateSkillDoc(skill);

  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`✅ 生成技能文档: ${filename}`);
  skillCount++;
});

// 生成工具文档
builtinTools.forEach(tool => {
  const filename = tool.name + '.md';
  const filepath = path.join(toolsDir, filename);
  const content = generateToolDoc(tool);

  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`✅ 生成工具文档: ${filename}`);
  toolCount++;
});

console.log(`\n📊 文档生成完成!`);
console.log(`   技能文档: ${skillCount} 个`);
console.log(`   工具文档: ${toolCount} 个`);
console.log(`   总计: ${skillCount + toolCount} 个`);
console.log(`\n📁 文档位置: ${docsDir}`);
