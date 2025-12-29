/**
 * 文档生成器
 * 为技能和工具生成 Markdown 文档
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class DocGenerator {
  constructor() {
    // 文档目录路径
    this.docsPath = path.join(app.getPath('userData'), 'docs');
    this.skillsDocsPath = path.join(this.docsPath, 'skills');
    this.toolsDocsPath = path.join(this.docsPath, 'tools');
  }

  /**
   * 初始化文档目录
   */
  async initialize() {
    try {
      // 创建文档目录
      await fs.mkdir(this.docsPath, { recursive: true });
      await fs.mkdir(this.skillsDocsPath, { recursive: true });
      await fs.mkdir(this.toolsDocsPath, { recursive: true });

      console.log('[DocGenerator] 文档目录初始化完成');
    } catch (error) {
      console.error('[DocGenerator] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 生成技能文档
   * @param {Object} skill - 技能对象
   * @param {Array} tools - 技能包含的工具列表
   * @returns {Promise<string>} 文档路径
   */
  async generateSkillDoc(skill, tools = []) {
    try {
      const markdown = this._buildSkillMarkdown(skill, tools);
      const fileName = `${skill.id}.md`;
      const filePath = path.join(this.skillsDocsPath, fileName);

      await fs.writeFile(filePath, markdown, 'utf-8');
      console.log(`[DocGenerator] 技能文档已生成: ${fileName}`);

      return filePath;
    } catch (error) {
      console.error('[DocGenerator] 生成技能文档失败:', error);
      throw error;
    }
  }

  /**
   * 生成工具文档
   * @param {Object} tool - 工具对象
   * @returns {Promise<string>} 文档路径
   */
  async generateToolDoc(tool) {
    try {
      const markdown = this._buildToolMarkdown(tool);
      const fileName = `${tool.name}.md`;
      const filePath = path.join(this.toolsDocsPath, fileName);

      await fs.writeFile(filePath, markdown, 'utf-8');
      console.log(`[DocGenerator] 工具文档已生成: ${fileName}`);

      return filePath;
    } catch (error) {
      console.error('[DocGenerator] 生成工具文档失败:', error);
      throw error;
    }
  }

  /**
   * 构建技能 Markdown 文档
   * @private
   */
  _buildSkillMarkdown(skill, tools) {
    const config = typeof skill.config === 'string'
      ? JSON.parse(skill.config)
      : (skill.config || {});

    const tags = typeof skill.tags === 'string'
      ? JSON.parse(skill.tags)
      : (skill.tags || []);

    let markdown = `---
id: ${skill.id}
name: ${skill.name}
category: ${skill.category}
enabled: ${skill.enabled ? 'true' : 'false'}
---

# ${skill.display_name || skill.name}

## 📝 概述

${skill.description || '暂无描述'}

**分类**: ${this._getCategoryDisplayName(skill.category)}
**标签**: ${tags.join(', ') || '无'}
**状态**: ${skill.enabled ? '✅ 已启用' : '❌ 已禁用'}

`;

    // 包含的工具
    if (tools && tools.length > 0) {
      markdown += `## 🛠️ 包含的工具\n\n`;
      markdown += `本技能包含以下 ${tools.length} 个工具：\n\n`;

      for (const tool of tools) {
        const roleIcon = tool.role === 'primary' ? '⭐' :
                        tool.role === 'secondary' ? '🔹' : '⚪';
        markdown += `${roleIcon} **${tool.display_name || tool.name}** (${tool.role})\n`;
        markdown += `   - ${tool.description || '无描述'}\n`;
        markdown += `   - 优先级: ${tool.priority || 0}\n\n`;
      }
    }

    // 使用场景
    markdown += `## 💡 使用场景\n\n`;
    markdown += this._getSkillUseCases(skill.category);

    // 配置选项
    if (Object.keys(config).length > 0) {
      markdown += `\n## ⚙️ 配置选项\n\n`;
      markdown += '```json\n';
      markdown += JSON.stringify(config, null, 2);
      markdown += '\n```\n';

      markdown += `\n**配置说明**:\n\n`;
      for (const [key, value] of Object.entries(config)) {
        markdown += `- \`${key}\`: ${this._getConfigDescription(skill.category, key, value)}\n`;
      }
    }

    // 使用示例
    markdown += `\n## 📖 使用示例\n\n`;
    markdown += this._getSkillExample(skill.category, skill.name);

    // 统计信息
    if (skill.usage_count > 0) {
      markdown += `\n## 📊 统计信息\n\n`;
      markdown += `- 总使用次数: ${skill.usage_count}\n`;
      markdown += `- 成功次数: ${skill.success_count}\n`;
      const successRate = skill.usage_count > 0
        ? ((skill.success_count / skill.usage_count) * 100).toFixed(2)
        : 0;
      markdown += `- 成功率: ${successRate}%\n`;

      if (skill.last_used_at) {
        const lastUsedDate = new Date(skill.last_used_at).toLocaleString('zh-CN');
        markdown += `- 最后使用: ${lastUsedDate}\n`;
      }
    }

    // 相关技能
    markdown += `\n## 🔗 相关技能\n\n`;
    markdown += this._getRelatedSkills(skill.category);

    // 更新时间
    markdown += `\n---\n\n`;
    markdown += `**文档生成时间**: ${new Date().toLocaleString('zh-CN')}\n`;
    markdown += `**技能类型**: ${skill.is_builtin ? '内置' : '插件提供'}\n`;

    return markdown;
  }

  /**
   * 构建工具 Markdown 文档
   * @private
   */
  _buildToolMarkdown(tool) {
    const schema = typeof tool.parameters_schema === 'string'
      ? JSON.parse(tool.parameters_schema)
      : (tool.parameters_schema || {});

    const returnSchema = typeof tool.return_schema === 'string'
      ? JSON.parse(tool.return_schema)
      : (tool.return_schema || {});

    const permissions = typeof tool.required_permissions === 'string'
      ? JSON.parse(tool.required_permissions)
      : (tool.required_permissions || []);

    let markdown = `---
id: ${tool.id}
name: ${tool.name}
category: ${tool.category}
type: ${tool.tool_type}
risk_level: ${tool.risk_level}
---

# ${tool.display_name || tool.name}

## 📝 概述

${tool.description || '暂无描述'}

**分类**: ${this._getCategoryDisplayName(tool.category)}
**类型**: ${tool.tool_type}
**风险等级**: ${this._getRiskLevelDisplay(tool.risk_level)}
**状态**: ${tool.enabled ? '✅ 已启用' : '❌ 已禁用'}

`;

    // 参数说明
    markdown += `## 📥 参数说明\n\n`;
    if (Object.keys(schema).length > 0) {
      markdown += '| 参数名 | 类型 | 必填 | 说明 |\n';
      markdown += '|--------|------|------|------|\n';

      for (const [key, param] of Object.entries(schema)) {
        const type = param.type || 'any';
        const required = param.required ? '✅' : '❌';
        const description = param.description || '无';
        markdown += `| \`${key}\` | ${type} | ${required} | ${description} |\n`;
      }
    } else {
      markdown += '该工具无参数。\n';
    }

    // 返回值说明
    markdown += `\n## 📤 返回值说明\n\n`;
    if (Object.keys(returnSchema).length > 0) {
      markdown += '```json\n';
      markdown += JSON.stringify(returnSchema, null, 2);
      markdown += '\n```\n';
    } else {
      markdown += '返回值根据具体执行情况而定。\n';
    }

    // 权限要求
    if (permissions.length > 0) {
      markdown += `\n## 🔐 权限要求\n\n`;
      for (const perm of permissions) {
        markdown += `- \`${perm}\`\n`;
      }
    }

    // 使用示例
    markdown += `\n## 📖 使用示例\n\n`;
    markdown += this._getToolExample(tool.name, schema);

    // 统计信息
    if (tool.usage_count > 0) {
      markdown += `\n## 📊 统计信息\n\n`;
      markdown += `- 总调用次数: ${tool.usage_count}\n`;
      markdown += `- 成功次数: ${tool.success_count}\n`;
      const successRate = tool.usage_count > 0
        ? ((tool.success_count / tool.usage_count) * 100).toFixed(2)
        : 0;
      markdown += `- 成功率: ${successRate}%\n`;
      markdown += `- 平均执行时间: ${tool.avg_execution_time.toFixed(2)}ms\n`;

      if (tool.last_used_at) {
        const lastUsedDate = new Date(tool.last_used_at).toLocaleString('zh-CN');
        markdown += `- 最后使用: ${lastUsedDate}\n`;
      }
    }

    // 注意事项
    markdown += `\n## ⚠️ 注意事项\n\n`;
    markdown += this._getToolNotes(tool.name, tool.risk_level);

    // 更新时间
    markdown += `\n---\n\n`;
    markdown += `**文档生成时间**: ${new Date().toLocaleString('zh-CN')}\n`;
    markdown += `**工具类型**: ${tool.is_builtin ? '内置' : '插件提供'}\n`;

    return markdown;
  }

  /**
   * 获取分类显示名称
   * @private
   */
  _getCategoryDisplayName(category) {
    const categoryMap = {
      code: '代码开发',
      web: 'Web开发',
      data: '数据处理',
      content: '内容创作',
      document: '文档处理',
      media: '媒体处理',
      ai: 'AI功能',
      system: '系统操作',
      network: '网络请求',
      automation: '自动化',
      project: '项目管理',
      template: '模板应用',
      custom: '自定义',
      file: '文件操作',
    };

    return categoryMap[category] || category;
  }

  /**
   * 获取风险等级显示
   * @private
   */
  _getRiskLevelDisplay(level) {
    const riskMap = {
      1: '🟢 低风险',
      2: '🟡 中风险',
      3: '🟠 较高风险',
      4: '🔴 高风险',
      5: '⛔ 极高风险',
    };

    return riskMap[level] || '未知';
  }

  /**
   * 获取技能使用场景
   * @private
   */
  _getSkillUseCases(category) {
    const useCases = {
      code: `1. 创建新项目或代码文件
2. 阅读和修改现有代码
3. 代码重构和优化
4. 版本控制和提交`,

      web: `1. 创建静态网页和博客
2. 生成响应式布局
3. 开发单页应用（SPA）
4. 设计网页样式和交互`,

      data: `1. 读取和分析CSV/Excel数据
2. 数据清洗和转换
3. 生成数据可视化图表
4. 数据报告生成`,

      content: `1. 编写文章和博客
2. Markdown文档编辑
3. 内容格式化和排版
4. 文档模板应用`,

      ai: `1. LLM对话和查询
2. 知识库语义搜索
3. Prompt模板填充
4. AI辅助决策`,
    };

    return useCases[category] || `1. 根据需求使用相关工具
2. 完成特定领域的任务
3. 提高工作效率`;
  }

  /**
   * 获取配置说明
   * @private
   */
  _getConfigDescription(category, key, value) {
    const descriptions = {
      defaultLanguage: '默认编程语言',
      autoFormat: '是否自动格式化代码',
      enableLinting: '是否启用代码检查',
      defaultTemplate: '默认使用的模板',
      responsive: '是否生成响应式布局',
      chartType: '图表类型（auto为自动选择）',
      exportFormat: '导出格式',
      defaultFormat: '默认文件格式',
      quality: '输出质量（1-100）',
      maxWidth: '最大宽度（像素）',
      timeout: '超时时间（毫秒）',
      sandbox: '是否在沙箱环境中执行',
      topK: 'RAG检索返回的最相关结果数量',
      threshold: '相似度阈值（0-1）',
    };

    return descriptions[key] || `${typeof value} 类型，当前值: ${JSON.stringify(value)}`;
  }

  /**
   * 获取技能示例
   * @private
   */
  _getSkillExample(category, skillName) {
    return `### 示例1: 使用 ${skillName}

\`\`\`javascript
// 通过AI引擎调用技能
const result = await aiEngineManager.processUserInput(
  "请帮我...",  // 用户输入
  { skillId: "${category}" }  // 指定使用的技能
);
\`\`\`

### 示例2: 通过IPC调用

\`\`\`javascript
// 在渲染进程中
const tools = await window.electronAPI.invoke('skill:get-tools', skillId);
console.log('技能包含的工具:', tools);
\`\`\`
`;
  }

  /**
   * 获取工具示例
   * @private
   */
  _getToolExample(toolName, schema) {
    // 生成示例参数
    const exampleParams = {};
    for (const [key, param] of Object.entries(schema)) {
      if (param.type === 'string') {
        exampleParams[key] = `示例${key}`;
      } else if (param.type === 'number') {
        exampleParams[key] = 100;
      } else if (param.type === 'boolean') {
        exampleParams[key] = true;
      } else if (param.type === 'array') {
        exampleParams[key] = [];
      } else {
        exampleParams[key] = null;
      }
    }

    return `\`\`\`javascript
// 通过 FunctionCaller 调用
const result = await functionCaller.call('${toolName}', ${JSON.stringify(exampleParams, null, 2)});

console.log('执行结果:', result);
\`\`\`

\`\`\`javascript
// 通过 IPC 测试工具
const result = await window.electronAPI.invoke('tool:test', toolId, ${JSON.stringify(exampleParams, null, 2)});
\`\`\`
`;
  }

  /**
   * 获取工具注意事项
   * @private
   */
  _getToolNotes(toolName, riskLevel) {
    let notes = '';

    // 根据风险等级添加通用警告
    if (riskLevel >= 4) {
      notes += '- ⚠️ **高风险工具**：该工具可能会修改系统文件或执行敏感操作，请谨慎使用\n';
    } else if (riskLevel >= 3) {
      notes += '- ⚠️ **注意**：该工具会修改文件或数据，建议先备份\n';
    }

    // 根据工具名称添加特定注意事项
    if (toolName.includes('writer') || toolName.includes('editor')) {
      notes += '- 文件写入前请确保路径正确，避免覆盖重要文件\n';
      notes += '- 建议启用版本控制（Git）以便回滚\n';
    }

    if (toolName.includes('executor') || toolName.includes('bash')) {
      notes += '- 代码执行具有安全风险，请确保输入可信\n';
      notes += '- 建议在沙箱环境中运行\n';
    }

    if (toolName.includes('git')) {
      notes += '- 请确保Git配置正确（用户名、邮箱等）\n';
      notes += '- 大文件提交前建议配置 .gitignore\n';
    }

    if (notes === '') {
      notes = '- 请按照参数说明正确传递参数\n- 注意处理可能的错误和异常情况\n';
    }

    return notes;
  }

  /**
   * 获取相关技能
   * @private
   */
  _getRelatedSkills(category) {
    const related = {
      code: '- Web开发\n- 项目管理\n- 代码执行',
      web: '- 代码开发\n- 文档处理\n- 模板应用',
      data: '- 文档处理\n- AI对话\n- 自动化工作流',
      content: '- 文档处理\n- Web开发\n- 模板应用',
      ai: '- 知识库搜索\n- 内容创作\n- 自动化工作流',
    };

    return related[category] || '暂无相关技能';
  }

  /**
   * 读取技能文档
   * @param {string} skillId - 技能ID
   * @returns {Promise<string>} 文档内容
   */
  async readSkillDoc(skillId) {
    try {
      const filePath = path.join(this.skillsDocsPath, `${skillId}.md`);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // 文档不存在
      }
      throw error;
    }
  }

  /**
   * 读取工具文档
   * @param {string} toolName - 工具名称
   * @returns {Promise<string>} 文档内容
   */
  async readToolDoc(toolName) {
    try {
      const filePath = path.join(this.toolsDocsPath, `${toolName}.md`);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // 文档不存在
      }
      throw error;
    }
  }

  /**
   * 批量生成技能文档
   * @param {Array} skills - 技能列表（包含关联的工具）
   * @returns {Promise<number>} 生成的文档数量
   */
  async generateAllSkillDocs(skills) {
    let count = 0;
    for (const skillData of skills) {
      const { skill, tools } = skillData;
      await this.generateSkillDoc(skill, tools);
      count++;
    }
    console.log(`[DocGenerator] 批量生成了 ${count} 个技能文档`);
    return count;
  }

  /**
   * 批量生成工具文档
   * @param {Array} tools - 工具列表
   * @returns {Promise<number>} 生成的文档数量
   */
  async generateAllToolDocs(tools) {
    let count = 0;
    for (const tool of tools) {
      await this.generateToolDoc(tool);
      count++;
    }
    console.log(`[DocGenerator] 批量生成了 ${count} 个工具文档`);
    return count;
  }
}

module.exports = DocGenerator;
