/**
 * 增强版文档生成器
 * 生成更详细、更实用的技能和工具文档
 */

const fs = require('fs');
const path = require('path');

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

// 增强的技能文档模板
function generateEnhancedSkillDoc(skill) {
  const config = typeof skill.config === 'string' ? JSON.parse(skill.config) : skill.config;
  const tags = typeof skill.tags === 'string' ? JSON.parse(skill.tags) : skill.tags;

  return `# ${skill.display_name || skill.name}

## 📋 概述

**技能ID**: \`${skill.id}\`
**分类**: ${skill.category}
**状态**: ${skill.enabled ? '✅ 启用' : '❌ 禁用'}
**类型**: ${skill.is_builtin ? '🔧 内置技能' : '🔌 自定义技能'}
**图标**: ${skill.icon || 'default'}

${skill.description || '暂无描述'}

---

## 🏷️ 标签

${tags.map(tag => `\`${tag}\``).join(' ')}

---

## ⚙️ 配置选项

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

### 配置说明

${getConfigExplanation(skill.category, config)}

---

## 🛠️ 包含的工具

${skill.tools && skill.tools.length > 0 ? skill.tools.map((tool, index) => `${index + 1}. [\`${tool}\`](../tools/${tool}.md)`).join('\n') : '暂无关联工具'}

---

## 📖 使用场景

${getDetailedScenarios(skill.category)}

---

## 💡 使用示例

${getSkillExamples(skill)}

---

## 🎯 最佳实践

${getBestPractices(skill.category)}

---

## ⚠️ 常见问题

${getFAQ(skill.category)}

---

## 🚀 进阶技巧

${getAdvancedTips(skill.category)}

---

## 🔐 权限要求

${getSkillPermissions(skill.tools || [])}

---

## 📊 性能优化建议

${getPerformanceTips(skill.category)}

---

## 🔗 相关技能

${getRelatedSkills(skill.category, skill.id)}

---

## 📝 更新日志

### v1.0.0 (2025-12-29)
- ✅ 初始版本发布
- ✅ 完整功能实现
- ✅ 文档完善

---

## 📚 参考资料

${getReferences(skill.category)}

---

**文档版本**: v1.0.0
**最后更新**: 2025-12-29
**维护者**: ChainlessChain Team
**反馈**: [提交Issue](https://github.com/chainlesschain/chainlesschain/issues)
`;
}

// 增强的工具文档模板
function generateEnhancedToolDoc(tool) {
  const paramsSchema = typeof tool.parameters_schema === 'string' ? JSON.parse(tool.parameters_schema) : tool.parameters_schema;
  const returnSchema = typeof tool.return_schema === 'string' ? JSON.parse(tool.return_schema) : tool.return_schema;
  const config = typeof tool.config === 'string' ? JSON.parse(tool.config) : tool.config;
  const permissions = typeof tool.required_permissions === 'string' ? JSON.parse(tool.required_permissions) : tool.required_permissions;

  return `# ${tool.display_name || tool.name}

## 📋 基本信息

| 属性 | 值 |
|------|-----|
| **工具ID** | \`${tool.id}\` |
| **工具名称** | \`${tool.name}\` |
| **类型** | ${tool.tool_type} |
| **分类** | ${getCategoryBadge(tool.category)} |
| **风险等级** | ${getRiskBadge(tool.risk_level)} |
| **状态** | ${tool.enabled ? '✅ 启用' : '❌ 禁用'} |
| **来源** | ${tool.is_builtin ? '🔧 内置工具' : '🔌 自定义工具'} |

---

## 📖 功能描述

${tool.description || '暂无描述'}

### 核心功能

${getToolFeatures(tool)}

---

## 📥 参数Schema

\`\`\`json
${JSON.stringify(paramsSchema, null, 2)}
\`\`\`

### 参数说明

${getParameterExplanation(paramsSchema)}

---

## 📤 返回值Schema

\`\`\`json
${JSON.stringify(returnSchema, null, 2)}
\`\`\`

### 返回值说明

${getReturnValueExplanation(returnSchema)}

---

## ⚙️ 配置选项

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

---

## 🔐 权限要求

${permissions && permissions.length > 0 ? permissions.map(p => `- \`${p}\` - ${getPermissionDescription(p)}`).join('\n') : '✅ 无特殊权限要求'}

---

## 💡 使用示例

### 示例 1: 基础用法

\`\`\`javascript
const result = await callTool('${tool.name}', ${getExampleParams(paramsSchema)});

if (result.success) {
  console.log('✅ 执行成功:', result);
} else {
  console.error('❌ 执行失败:', result.error);
}
\`\`\`

### 示例 2: 高级用法

${getAdvancedExample(tool)}

### 示例 3: 错误处理

\`\`\`javascript
try {
  const result = await callTool('${tool.name}', ${getExampleParams(paramsSchema)});

  if (!result.success) {
    throw new Error(result.error || '工具执行失败');
  }

  // 处理成功结果
  console.log('结果:', result);

} catch (error) {
  console.error('错误:', error.message);

  // 错误恢复逻辑
  ${getErrorRecoveryCode(tool)}
}
\`\`\`

---

## 🎯 使用场景

${getToolUseCases(tool)}

---

## ⚠️ 注意事项

${getToolWarnings(tool)}

---

## 🚀 性能优化

${getToolPerformanceTips(tool)}

---

## 🔧 故障排除

${getTroubleshooting(tool)}

---

## 📊 性能指标

| 指标 | 值 |
|------|-----|
| **平均执行时间** | ${tool.avg_execution_time || 0} ms |
| **调用次数** | ${tool.usage_count || 0} |
| **成功次数** | ${tool.success_count || 0} |
| **成功率** | ${tool.usage_count > 0 ? ((tool.success_count / tool.usage_count) * 100).toFixed(2) : 0}% |

---

## 🔗 相关工具

${getRelatedTools(tool.category, tool.id)}

---

## 📚 最佳实践

${getToolBestPractices(tool)}

---

## 📝 更新日志

### v1.0.0 (2025-12-29)
- ✅ 初始版本发布
- ✅ 完整功能实现
- ✅ 文档完善

---

## 📖 文档路径

\`${tool.doc_path || 'docs/tools/' + tool.id + '.md'}\`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
**反馈**: [提交Issue](https://github.com/chainlesschain/chainlesschain/issues)
`;
}

// ========== 辅助函数 ==========

function getCategoryBadge(category) {
  const badges = {
    file: '📁 文件操作',
    code: '💻 代码生成',
    web: '🌐 Web开发',
    project: '📦 项目管理',
    data: '📊 数据处理',
    ai: '🤖 AI功能',
    system: '⚙️ 系统操作',
    network: '🌐 网络请求',
    media: '🎨 媒体处理',
    document: '📄 文档处理',
    automation: '🔄 自动化',
    template: '📋 模板应用'
  };
  return badges[category] || category;
}

function getRiskBadge(level) {
  const badges = {
    1: '🟢 1/5 (低风险)',
    2: '🟡 2/5 (较低风险)',
    3: '🟠 3/5 (中等风险)',
    4: '🔴 4/5 (较高风险)',
    5: '⛔ 5/5 (高风险)'
  };
  return badges[level] || `${level}/5`;
}

function getConfigExplanation(category, config) {
  // 根据分类和配置生成说明
  const keys = Object.keys(config);
  if (keys.length === 0) return '暂无配置选项';

  return keys.map(key => {
    return `- **${key}**: ${config[key]} - ${getConfigKeyDescription(key, config[key])}`;
  }).join('\n');
}

function getConfigKeyDescription(key, value) {
  const descriptions = {
    defaultLanguage: '默认编程语言',
    autoFormat: value ? '自动格式化代码' : '不自动格式化',
    enableLinting: value ? '启用代码检查' : '禁用代码检查',
    defaultTemplate: `使用 ${value} 模板`,
    responsive: value ? '支持响应式布局' : '不支持响应式',
    defaultEngine: `使用 ${value} 引擎`,
    cacheResults: value ? '缓存查询结果' : '不缓存结果',
    maxResults: `最多返回 ${value} 条结果`,
    timeout: `超时时间 ${value} 毫秒`,
    retryCount: `重试 ${value} 次`,
    batchSize: `批量处理大小 ${value}`
  };
  return descriptions[key] || '自定义配置项';
}

function getDetailedScenarios(category) {
  const scenarios = {
    code: `### 1. 新建项目
- 快速创建标准项目结构
- 自动生成配置文件
- 初始化版本控制

### 2. 代码生成
- 根据需求生成代码文件
- 支持多种编程语言
- 自动格式化代码

### 3. 代码重构
- 优化现有代码结构
- 提升代码质量
- 遵循最佳实践

### 4. 版本管理
- Git 初始化和配置
- 提交代码变更
- 分支管理`,

    web: `### 1. 网页开发
- 创建静态网页
- 生成响应式布局
- 实现交互功能

### 2. 单页应用
- 创建 SPA 项目
- 路由配置
- 状态管理

### 3. 博客系统
- 生成博客模板
- Markdown 支持
- SEO 优化

### 4. 前端组件
- 创建可复用组件
- 样式定制
- 事件处理`,

    data: `### 1. 数据分析
- 数据读取和解析
- 统计计算
- 趋势分析

### 2. 数据可视化
- 生成图表
- 交互式可视化
- 报表生成

### 3. 数据清洗
- 数据验证
- 格式转换
- 异常处理

### 4. 数据导出
- 多格式导出
- 批量处理
- 自动化报告`,

    ai: `### 1. 智能对话
- 多轮对话
- 上下文理解
- 个性化回复

### 2. 知识检索
- RAG 增强搜索
- 语义理解
- 相关性排序

### 3. 内容生成
- 文本生成
- 摘要提取
- 翻译转换

### 4. 智能分析
- 情感分析
- 意图识别
- 实体提取`
  };

  return scenarios[category] || `根据 ${category} 分类的应用场景`;
}

function getSkillExamples(skill) {
  // 根据技能生成具体示例
  return `### 示例 1: 基础使用

\`\`\`javascript
// 调用 ${skill.name} 技能
const result = await executeSkill('${skill.id}', {
  // 技能参数
  ...yourParams
});

console.log('执行结果:', result);
\`\`\`

### 示例 2: 组合使用

\`\`\`javascript
// 结合多个工具使用
const workflow = {
  skill: '${skill.id}',
  tools: ${JSON.stringify(skill.tools ? skill.tools.slice(0, 3) : [], null, 2)}
};

const result = await executeWorkflow(workflow);
\`\`\`

### 示例 3: 自动化流程

\`\`\`javascript
// 创建自动化任务
await createAutomationTask({
  name: '${skill.name}自动化',
  skill: '${skill.id}',
  schedule: '0 9 * * *', // 每天9点执行
  params: {
    // 自动化参数
  }
});
\`\`\``;
}

function getBestPractices(category) {
  const practices = {
    code: `1. **代码规范**: 遵循团队代码规范，使用 ESLint/Prettier
2. **版本控制**: 频繁提交，编写清晰的 commit 信息
3. **代码审查**: 提交前进行自我审查
4. **测试驱动**: 编写单元测试，确保代码质量
5. **文档同步**: 代码和文档同步更新`,

    web: `1. **响应式设计**: 优先考虑移动端体验
2. **性能优化**: 压缩资源，使用CDN
3. **SEO优化**: 合理使用语义化标签
4. **可访问性**: 遵循WCAG标准
5. **浏览器兼容**: 测试主流浏览器`,

    data: `1. **数据验证**: 输入数据进行严格验证
2. **异常处理**: 完善的错误处理机制
3. **性能优化**: 大数据集使用流式处理
4. **结果缓存**: 缓存频繁查询的结果
5. **日志记录**: 记录关键操作日志`,

    ai: `1. **提示工程**: 优化提示词，提高AI理解准确度
2. **上下文管理**: 合理控制上下文长度
3. **结果验证**: 验证AI生成的结果
4. **隐私保护**: 不发送敏感信息
5. **成本控制**: 监控API调用次数和成本`
  };

  return practices[category] || '遵循行业最佳实践';
}

function getFAQ(category) {
  const faqs = {
    code: `### Q1: 支持哪些编程语言？
A: 支持 JavaScript、Python、Java、Go、Rust 等主流语言。

### Q2: 如何配置代码格式化？
A: 在配置选项中设置 \`autoFormat: true\` 即可。

### Q3: Git 操作失败怎么办？
A: 检查 Git 配置，确保已设置用户名和邮箱。

### Q4: 如何自定义项目模板？
A: 可以在 templates 目录下添加自定义模板。`,

    web: `### Q1: 生成的网页兼容哪些浏览器？
A: 兼容现代主流浏览器（Chrome、Firefox、Safari、Edge）。

### Q2: 如何修改默认样式？
A: 可以通过配置选项设置主题颜色和样式。

### Q3: 支持TypeScript吗？
A: 支持，设置 language: 'typescript' 即可。

### Q4: 如何集成第三方库？
A: 在生成时指定依赖项即可自动引入。`,

    data: `### Q1: 支持哪些数据格式？
A: 支持 CSV、JSON、Excel、SQL 等常见格式。

### Q2: 处理大文件会不会内存溢出？
A: 使用流式处理，支持处理GB级文件。

### Q3: 如何自定义数据转换？
A: 可以编写自定义转换函数。

### Q4: 数据安全如何保证？
A: 所有数据本地处理，不上传到云端。`,

    ai: `### Q1: 使用哪个AI模型？
A: 支持本地Ollama和14+云端LLM提供商。

### Q2: 如何保护隐私？
A: 优先使用本地模型，敏感数据不发送到云端。

### Q3: API调用有次数限制吗？
A: 本地模型无限制，云端模型根据提供商而定。

### Q4: 如何提高响应速度？
A: 使用本地模型或启用结果缓存。`
  };

  return faqs[category] || '暂无常见问题';
}

function getAdvancedTips(category) {
  const tips = {
    code: `1. **自定义模板**: 创建项目模板以复用最佳实践
2. **代码片段**: 使用代码片段库加速开发
3. **自动化工作流**: 配置pre-commit hook自动检查
4. **性能分析**: 使用profiler工具优化性能
5. **持续集成**: 集成CI/CD流程`,

    web: `1. **组件库**: 构建自己的组件库
2. **PWA支持**: 添加Service Worker实现离线访问
3. **性能监控**: 集成性能监控工具
4. **自动化测试**: 使用Playwright进行E2E测试
5. **国际化**: 实现多语言支持`,

    data: `1. **增量处理**: 只处理变更的数据
2. **并行计算**: 利用多核进行并行处理
3. **数据分片**: 大数据集分片处理
4. **智能缓存**: 使用LRU缓存策略
5. **实时分析**: 流式数据实时处理`,

    ai: `1. **提示词优化**: 使用Few-shot学习提高准确度
2. **模型微调**: 针对特定任务微调模型
3. **RAG增强**: 结合知识库增强回答质量
4. **多模型协作**: 使用多个模型互相验证
5. **成本优化**: 小任务用小模型，大任务用大模型`
  };

  return tips[category] || '探索更多高级功能';
}

function getSkillPermissions(tools) {
  if (!tools || tools.length === 0) {
    return '✅ 无特殊权限要求';
  }

  const permissionMap = {
    file_reader: '`file:read` - 文件读取权限',
    file_writer: '`file:write` - 文件写入权限',
    file_editor: '`file:write` - 文件编辑权限',
    git_init: '`git:init` - Git初始化权限',
    git_commit: '`git:commit` - Git提交权限',
    html_generator: '无特殊权限',
    css_generator: '无特殊权限',
    js_generator: '无特殊权限',
    create_project_structure: '`file:write` - 文件系统写入权限',
    info_searcher: '`network:request` - 网络请求权限',
    format_output: '无特殊权限',
    generic_handler: '`system:execute` - 系统执行权限'
  };

  const permissions = new Set();
  tools.forEach(tool => {
    const perm = permissionMap[tool];
    if (perm && perm !== '无特殊权限') {
      permissions.add(perm);
    }
  });

  return permissions.size > 0
    ? Array.from(permissions).map(p => `- ${p}`).join('\n')
    : '✅ 无特殊权限要求';
}

function getPerformanceTips(category) {
  const tips = {
    code: '- 使用增量编译加速构建\n- 启用代码缓存\n- 并行处理多个文件',
    web: '- 压缩HTML/CSS/JS资源\n- 使用CDN加速资源加载\n- 启用浏览器缓存',
    data: '- 使用流式处理大文件\n- 启用结果缓存\n- 并行处理数据块',
    ai: '- 使用本地模型减少延迟\n- 启用响应缓存\n- 控制上下文长度'
  };

  return tips[category] || '- 根据实际需求优化性能';
}

function getRelatedSkills(category, currentId) {
  const related = {
    code: ['skill_web_development', 'skill_project_management', 'skill_code_execution'],
    web: ['skill_code_development', 'skill_content_creation', 'skill_image_processing'],
    data: ['skill_ai_conversation', 'skill_automation_workflow', 'skill_content_creation'],
    ai: ['skill_knowledge_search', 'skill_data_analysis', 'skill_content_creation']
  };

  const skills = related[category] || [];
  return skills
    .filter(id => id !== currentId)
    .map(id => `- [${id.replace('skill_', '').replace(/_/g, ' ')}](../${id.replace('skill_', '')}.md)`)
    .join('\n') || '暂无相关技能';
}

function getReferences(category) {
  const refs = {
    code: `- [Git 官方文档](https://git-scm.com/doc)
- [JavaScript MDN](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript)
- [Node.js 文档](https://nodejs.org/docs/)`,

    web: `- [HTML标准](https://html.spec.whatwg.org/)
- [CSS规范](https://www.w3.org/Style/CSS/)
- [Web.dev](https://web.dev/)`,

    data: `- [Pandas 文档](https://pandas.pydata.org/docs/)
- [数据可视化指南](https://www.datavisualization.ch/)
- [统计学习基础](https://web.stanford.edu/~hastie/ElemStatLearn/)`,

    ai: `- [Ollama 文档](https://ollama.ai/docs)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)
- [LangChain 文档](https://python.langchain.com/docs/get_started/introduction)`
  };

  return refs[category] || '- 参考官方文档';
}

// 工具相关辅助函数

function getToolFeatures(tool) {
  const features = {
    file_reader: `- 🔍 读取本地文件内容
- 📝 支持多种文本编码
- 🔒 安全的路径验证
- ⚡ 高效的文件流读取`,

    file_writer: `- ✏️ 写入文件内容
- 📁 自动创建目录
- 🔄 覆盖或追加模式
- 🔐 文件权限设置`,

    html_generator: `- 🎨 生成标准HTML5结构
- 📱 响应式设计支持
- 🎭 主题颜色定制
- ⚡ SEO优化`,

    css_generator: `- 🎨 生成现代CSS样式
- 📐 Flexbox/Grid布局
- 🌈 颜色主题系统
- 📱 媒体查询支持`,

    git_init: `- 🔧 初始化Git仓库
- 📝 创建.gitignore
- 🏷️ 设置初始分支
- ⚙️ 配置Git选项`
  };

  return features[tool.name] || `- ${tool.description}`;
}

function getParameterExplanation(schema) {
  if (!schema.properties) {
    return '无参数';
  }

  return Object.entries(schema.properties).map(([key, value]) => {
    const required = schema.required && schema.required.includes(key) ? '**必填**' : '可选';
    const defaultVal = value.default ? ` (默认: \`${value.default}\`)` : '';
    return `- **${key}** (${value.type}) - ${required}${defaultVal}\n  ${value.description || '暂无描述'}`;
  }).join('\n\n');
}

function getReturnValueExplanation(schema) {
  if (!schema.properties) {
    return '无返回值说明';
  }

  return Object.entries(schema.properties).map(([key, value]) => {
    return `- **${key}** (${value.type}): ${value.description || '暂无描述'}`;
  }).join('\n');
}

function getPermissionDescription(perm) {
  const descriptions = {
    'file:read': '读取文件系统',
    'file:write': '写入文件系统',
    'git:init': 'Git仓库初始化',
    'git:commit': 'Git提交操作',
    'network:request': '网络请求',
    'system:execute': '系统命令执行'
  };
  return descriptions[perm] || '未知权限';
}

function getExampleParams(schema) {
  if (!schema.properties) {
    return '{}';
  }

  const example = {};
  Object.entries(schema.properties).forEach(([key, value]) => {
    if (value.default !== undefined) {
      example[key] = value.default;
    } else if (value.type === 'string') {
      example[key] = `your_${key}`;
    } else if (value.type === 'number') {
      example[key] = 0;
    } else if (value.type === 'boolean') {
      example[key] = true;
    }
  });

  return JSON.stringify(example, null, 2);
}

function getAdvancedExample(tool) {
  const examples = {
    file_reader: `\`\`\`javascript
// 批量读取多个文件
const files = ['file1.txt', 'file2.txt', 'file3.txt'];
const contents = await Promise.all(
  files.map(file => callTool('file_reader', { filePath: file }))
);

// 处理读取结果
contents.forEach((result, index) => {
  if (result.success) {
    console.log(\`文件 \${files[index]} 内容:\`, result.content);
  }
});
\`\`\``,

    file_writer: `\`\`\`javascript
// 写入JSON数据
const data = { name: '张三', age: 25 };
const result = await callTool('file_writer', {
  filePath: './data.json',
  content: JSON.stringify(data, null, 2),
  mode: 'overwrite'
});

console.log('写入结果:', result);
\`\`\``,

    html_generator: `\`\`\`javascript
// 生成带导航的网页
const result = await callTool('html_generator', {
  title: '我的博客',
  content: '<h1>欢迎</h1><p>这是我的博客首页</p>',
  primaryColor: '#667eea',
  includeNav: true,
  navItems: ['首页', '文章', '关于']
});

console.log('生成的HTML:', result.html);
\`\`\``
  };

  return examples[tool.name] || `\`\`\`javascript
// 高级用法示例
const result = await callTool('${tool.name}', {
  // 更多参数...
});
\`\`\``;
}

function getErrorRecoveryCode(tool) {
  const recovery = {
    file_reader: `  // 尝试读取备份文件
  const backupResult = await callTool('file_reader', {
    filePath: params.filePath + '.bak'
  });`,

    file_writer: `  // 清理可能的部分写入
  await callTool('file_delete', {
    filePath: params.filePath
  });`,

    git_init: `  // 检查是否已经是Git仓库
  const isGitRepo = await checkGitRepository();
  if (isGitRepo) {
    console.log('已经是Git仓库，跳过初始化');
  }`
  };

  return recovery[tool.name] || '  // 实现错误恢复逻辑';
}

function getToolUseCases(tool) {
  const useCases = {
    file_reader: `1. **读取配置文件**: 读取JSON/YAML配置
2. **日志分析**: 读取和分析日志文件
3. **数据导入**: 导入CSV/TXT数据
4. **模板加载**: 加载HTML/Markdown模板`,

    file_writer: `1. **保存用户数据**: 持久化用户设置
2. **生成报告**: 输出分析报告
3. **导出数据**: 导出CSV/JSON数据
4. **日志记录**: 写入应用日志`,

    html_generator: `1. **快速原型**: 快速生成网页原型
2. **静态网站**: 创建博客、文档网站
3. **邮件模板**: 生成HTML邮件
4. **报告页面**: 生成数据报告页面`
  };

  return useCases[tool.name] || `根据 ${tool.name} 的功能特性选择合适的使用场景`;
}

function getToolWarnings(tool) {
  const warnings = {
    file_reader: `1. ⚠️ 读取大文件时注意内存占用
2. 🔒 验证文件路径，防止路径遍历攻击
3. 📝 检查文件编码，避免乱码
4. ⏱️ 设置读取超时，避免阻塞`,

    file_writer: `1. ⚠️ 写入前检查磁盘空间
2. 🔒 验证写入路径，防止覆盖重要文件
3. 💾 考虑写入失败的回滚机制
4. 🔐 设置适当的文件权限`,

    git_init: `1. ⚠️ 确保目录不是已有仓库的子目录
2. 📁 检查目录是否为空
3. 🔧 配置Git用户信息
4. 📝 准备好.gitignore文件`
  };

  return warnings[tool.name] || `使用前请仔细阅读文档`;
}

function getToolPerformanceTips(tool) {
  const tips = {
    file_reader: `1. **流式读取**: 大文件使用流式读取
2. **并发控制**: 限制并发读取数量
3. **缓存结果**: 缓存频繁读取的文件
4. **编码检测**: 自动检测文件编码`,

    file_writer: `1. **批量写入**: 合并多次写入操作
2. **异步写入**: 使用异步I/O
3. **缓冲写入**: 使用写入缓冲区
4. **原子写入**: 先写临时文件再重命名`,

    html_generator: `1. **模板缓存**: 缓存编译后的模板
2. **并行生成**: 并行生成多个页面
3. **压缩输出**: 压缩生成的HTML
4. **增量更新**: 只更新变化的部分`
  };

  return tips[tool.name] || `根据实际情况优化性能`;
}

function getTroubleshooting(tool) {
  const troubleshooting = {
    file_reader: `### 问题1: 文件读取失败

**原因**: 文件不存在或无权限

**解决**:
\`\`\`javascript
// 检查文件是否存在
if (fs.existsSync(filePath)) {
  // 读取文件
} else {
  console.error('文件不存在');
}
\`\`\`

### 问题2: 文件编码错误

**原因**: 文件编码不是UTF-8

**解决**: 指定正确的编码格式`,

    file_writer: `### 问题1: 磁盘空间不足

**原因**: 目标磁盘空间不足

**解决**: 检查磁盘空间或清理临时文件

### 问题2: 权限不足

**原因**: 没有写入权限

**解决**: 检查目录权限或更改写入位置`,

    git_init: `### 问题1: 已经是Git仓库

**原因**: 目录已初始化为Git仓库

**解决**: 检查.git目录是否存在

### 问题2: Git未安装

**原因**: 系统未安装Git

**解决**: 安装Git并配置环境变量`
  };

  return troubleshooting[tool.name] || `参考常见问题解决`;
}

function getRelatedTools(category, currentId) {
  const related = {
    file: ['file_reader', 'file_writer', 'file_editor'],
    code: ['html_generator', 'css_generator', 'js_generator'],
    project: ['create_project_structure', 'git_init', 'git_commit'],
    web: ['html_generator', 'css_generator', 'js_generator']
  };

  const tools = related[category] || [];
  return tools
    .filter(name => `tool_${name}` !== currentId)
    .map(name => `- [\`${name}\`](./${name}.md)`)
    .join('\n') || '暂无相关工具';
}

function getToolBestPractices(tool) {
  const practices = {
    file_reader: `1. **路径验证**: 始终验证文件路径的合法性
2. **错误处理**: 完善的try-catch错误处理
3. **资源释放**: 及时关闭文件句柄
4. **编码处理**: 正确处理文件编码
5. **安全检查**: 防止路径遍历攻击`,

    file_writer: `1. **原子写入**: 使用临时文件+重命名保证原子性
2. **备份机制**: 写入前备份原文件
3. **权限检查**: 验证写入权限
4. **空间检查**: 检查磁盘剩余空间
5. **错误回滚**: 写入失败时回滚`,

    html_generator: `1. **语义化**: 使用语义化HTML标签
2. **可访问性**: 遵循WCAG标准
3. **性能优化**: 压缩输出，使用CDN
4. **SEO友好**: 合理使用meta标签
5. **响应式**: 移动端优先设计`
  };

  return practices[tool.name] || `遵循行业最佳实践`;
}

// ========== 主执行逻辑 ==========

console.log('🚀 开始生成增强版文档...\n');

let skillCount = 0;
let toolCount = 0;

// 生成增强版技能文档
console.log('📚 生成技能文档...');
builtinSkills.forEach(skill => {
  const filename = skill.id.replace('skill_', '') + '.md';
  const filepath = path.join(skillsDir, filename);
  const content = generateEnhancedSkillDoc(skill);

  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`  ✅ ${filename}`);
  skillCount++;
});

// 生成增强版工具文档
console.log('\n🛠️  生成工具文档...');
builtinTools.forEach(tool => {
  const filename = tool.name + '.md';
  const filepath = path.join(toolsDir, filename);
  const content = generateEnhancedToolDoc(tool);

  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`  ✅ ${filename}`);
  toolCount++;
});

console.log(`\n✨ 文档生成完成!`);
console.log(`   📚 技能文档: ${skillCount} 个`);
console.log(`   🛠️  工具文档: ${toolCount} 个`);
console.log(`   📊 总计: ${skillCount + toolCount} 个`);
console.log(`\n📁 文档位置: ${docsDir}`);
console.log('\n💡 提示: 文档已包含详细的使用示例、最佳实践、FAQ等内容\n');
