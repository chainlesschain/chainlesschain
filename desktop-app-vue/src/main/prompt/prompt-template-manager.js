/**
 * 提示词模板管理器
 *
 * 管理 AI 提示词模板，支持变量替换、分类管理、使用统计等功能
 */

const { v4: uuidv4 } = require('uuid');

/**
 * 提示词模板管理器类
 */
class PromptTemplateManager {
  constructor(databaseManager) {
    this.db = databaseManager;
  }

  /**
   * 初始化
   * 创建数据库表并插入内置模板
   */
  async initialize() {
    try {
      console.log('[PromptTemplateManager] 初始化提示词模板管理器...');

      // 创建表
      await this.createTable();

      // 插入内置模板
      await this.insertBuiltInTemplates();

      console.log('[PromptTemplateManager] 提示词模板管理器初始化成功');
      return true;
    } catch (error) {
      console.error('[PromptTemplateManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建数据库表
   */
  async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        template TEXT NOT NULL,
        variables TEXT,
        category TEXT DEFAULT 'general',
        is_system INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;

    await this.db.run(sql);
    console.log('[PromptTemplateManager] 数据库表已创建');
  }

  /**
   * 插入内置模板
   */
  async insertBuiltInTemplates() {
    // 检查是否已经存在内置模板
    const existing = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 1'
    );

    if (existing && existing.count > 0) {
      console.log('[PromptTemplateManager] 内置模板已存在，跳过插入');
      return;
    }

    const builtInTemplates = [
      {
        id: 'builtin-summarize',
        name: '内容摘要',
        description: '为长文本生成简洁摘要',
        template: `请为以下内容生成一个简洁的摘要：

{{content}}

要求：
- 保留关键信息和核心观点
- 使用简洁明了的语言
- 长度控制在 200 字以内`,
        variables: JSON.stringify(['content']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-expand',
        name: '内容扩写',
        description: '扩展和丰富简短内容',
        template: `请将以下简短内容扩写成详细的文章：

{{content}}

要求：
- 保持原意不变
- 补充细节和例子
- 逻辑连贯，结构清晰
- 目标长度约 {{length}} 字`,
        variables: JSON.stringify(['content', 'length']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-translate',
        name: '翻译助手',
        description: '翻译文本到指定语言',
        template: `请将以下文本翻译成{{target_language}}：

{{content}}

要求：
- 准确传达原文含义
- 符合目标语言表达习惯
- 保持专业术语的准确性`,
        variables: JSON.stringify(['content', 'target_language']),
        category: 'translation',
        is_system: 1,
      },
      {
        id: 'builtin-proofread',
        name: '文本校对',
        description: '检查并修正文本错误',
        template: `请校对以下文本，找出并修正其中的错误：

{{content}}

请检查：
- 拼写错误
- 语法错误
- 标点符号
- 表达不当的地方

请以表格形式列出：
| 位置 | 原文 | 修改建议 | 原因 |`,
        variables: JSON.stringify(['content']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-extract-keywords',
        name: '关键词提取',
        description: '提取文本的关键词和主题',
        template: `请从以下内容中提取关键词和主题：

{{content}}

请按以下格式输出：
1. 核心主题：
2. 关键词列表（5-10个）：
3. 主要概念：`,
        variables: JSON.stringify(['content']),
        category: 'analysis',
        is_system: 1,
      },
      {
        id: 'builtin-qa',
        name: '问答助手',
        description: '基于上下文回答问题',
        template: `根据以下背景信息回答问题：

背景信息：
{{context}}

问题：{{question}}

请提供准确、详细的回答。如果背景信息不足以回答问题，请说明。`,
        variables: JSON.stringify(['context', 'question']),
        category: 'qa',
        is_system: 1,
      },
      {
        id: 'builtin-brainstorm',
        name: '头脑风暴',
        description: '生成创意想法',
        template: `请就以下主题进行头脑风暴：

主题：{{topic}}

要求：
- 提供 {{count}} 个创意想法
- 每个想法包含简短说明
- 想法应该新颖、可行
- 从不同角度思考`,
        variables: JSON.stringify(['topic', 'count']),
        category: 'creative',
        is_system: 1,
      },
      {
        id: 'builtin-code-explain',
        name: '代码解释',
        description: '解释代码的功能和逻辑',
        template: `请解释以下{{language}}代码的功能和逻辑：

\`\`\`{{language}}
{{code}}
\`\`\`

请包含：
1. 代码整体功能
2. 关键逻辑说明
3. 重要函数/方法解释
4. 可能的优化建议`,
        variables: JSON.stringify(['code', 'language']),
        category: 'programming',
        is_system: 1,
      },
      {
        id: 'builtin-outline',
        name: '大纲生成',
        description: '为文章生成结构化大纲',
        template: `请为以下主题生成一个详细的文章大纲：

主题：{{topic}}

要求：
- 至少包含 {{sections}} 个主要章节
- 每个章节有 2-3 个小节
- 逻辑清晰，结构合理
- 包含引言和结论`,
        variables: JSON.stringify(['topic', 'sections']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-rag-query',
        name: 'RAG 增强查询',
        description: '基于检索结果回答问题',
        template: `你是一个知识助手，请基于以下检索到的相关文档回答用户问题。

相关文档：
{{retrieved_docs}}

用户问题：{{question}}

请遵循以下原则：
1. 优先使用检索到的文档信息
2. 如果文档信息不足，可以使用你的知识补充
3. 明确区分文档信息和推理内容
4. 如果无法回答，诚实说明
5. 提供信息来源（引用文档序号）`,
        variables: JSON.stringify(['retrieved_docs', 'question']),
        category: 'rag',
        is_system: 1,
      },
    ];

    const now = Date.now();

    for (const template of builtInTemplates) {
      const id = template.id || uuidv4();
      const name = template.name || 'Untitled';
      const description = template.description || '';
      const templateText = template.template || '';
      const variables = template.variables || JSON.stringify([]);
      const category = template.category || 'general';
      const isSystem = template.is_system ? 1 : 0;

      await this.db.run(
        `INSERT OR IGNORE INTO prompt_templates
         (id, name, description, template, variables, category, is_system, usage_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          name,
          description,
          templateText,
          variables,
          category,
          isSystem,
          0,
          now,
          now,
        ]
      );
    }

    console.log('[PromptTemplateManager] 内置模板已插入:', builtInTemplates.length);
  }

  /**
   * 创建模板
   * @param {Object} templateData - 模板数据
   * @returns {Promise<Object>} 创建的模板
   */
  async createTemplate(templateData) {
    const {
      name,
      description = '',
      template,
      variables = [],
      category = 'general',
    } = templateData;

    if (!name || !template) {
      throw new Error('模板名称和内容不能为空');
    }

    const id = uuidv4();
    const now = Date.now();

    await this.db.run(
      `INSERT INTO prompt_templates
       (id, name, description, template, variables, category, is_system, usage_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        description,
        template,
        JSON.stringify(variables),
        category,
        0, // 用户创建的模板，is_system = 0
        0,
        now,
        now,
      ]
    );

    return this.getTemplateById(id);
  }

  /**
   * 获取模板列表
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 模板列表
   */
  async getTemplates(filters = {}) {
    const { category, isSystem } = filters;

    let sql = 'SELECT * FROM prompt_templates WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (isSystem !== undefined) {
      sql += ' AND is_system = ?';
      params.push(isSystem ? 1 : 0);
    }

    sql += ' ORDER BY is_system DESC, usage_count DESC, created_at DESC';

    const templates = await this.db.all(sql, params);

    // 解析 variables JSON
    return templates.map(template => ({
      ...template,
      variables: template.variables ? JSON.parse(template.variables) : [],
      is_system: Boolean(template.is_system),
    }));
  }

  /**
   * 根据 ID 获取模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object|null>} 模板对象
   */
  async getTemplateById(id) {
    const template = await this.db.get(
      'SELECT * FROM prompt_templates WHERE id = ?',
      [id]
    );

    if (!template) {
      return null;
    }

    return {
      ...template,
      variables: template.variables ? JSON.parse(template.variables) : [],
      is_system: Boolean(template.is_system),
    };
  }

  /**
   * 更新模板
   * @param {string} id - 模板 ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} 更新后的模板
   */
  async updateTemplate(id, updates) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    if (template.is_system) {
      throw new Error('系统模板不能修改');
    }

    const {
      name,
      description,
      template: templateText,
      variables,
      category,
    } = updates;

    const fields = [];
    const params = [];

    if (name !== undefined) {
      fields.push('name = ?');
      params.push(name);
    }

    if (description !== undefined) {
      fields.push('description = ?');
      params.push(description);
    }

    if (templateText !== undefined) {
      fields.push('template = ?');
      params.push(templateText);
    }

    if (variables !== undefined) {
      fields.push('variables = ?');
      params.push(JSON.stringify(variables));
    }

    if (category !== undefined) {
      fields.push('category = ?');
      params.push(category);
    }

    fields.push('updated_at = ?');
    params.push(Date.now());

    params.push(id);

    await this.db.run(
      `UPDATE prompt_templates SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    return this.getTemplateById(id);
  }

  /**
   * 删除模板
   * @param {string} id - 模板 ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteTemplate(id) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    if (template.is_system) {
      throw new Error('系统模板不能删除');
    }

    await this.db.run('DELETE FROM prompt_templates WHERE id = ?', [id]);
    return true;
  }

  /**
   * 填充模板变量
   * @param {string} id - 模板 ID
   * @param {Object} values - 变量值对象
   * @returns {Promise<string>} 填充后的提示词
   */
  async fillTemplate(id, values) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    let result = template.template;

    // 替换所有变量
    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, value);
    }

    // 增加使用次数
    await this.incrementUsage(id);

    return result;
  }

  /**
   * 增加使用次数
   * @param {string} id - 模板 ID
   */
  async incrementUsage(id) {
    await this.db.run(
      'UPDATE prompt_templates SET usage_count = usage_count + 1 WHERE id = ?',
      [id]
    );
  }

  /**
   * 获取模板分类列表
   * @returns {Promise<Array>} 分类列表
   */
  async getCategories() {
    const result = await this.db.all(
      'SELECT DISTINCT category FROM prompt_templates ORDER BY category'
    );

    return result.map(row => row.category);
  }

  /**
   * 搜索模板
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>} 匹配的模板列表
   */
  async searchTemplates(query) {
    const templates = await this.db.all(
      `SELECT * FROM prompt_templates
       WHERE name LIKE ? OR description LIKE ? OR template LIKE ?
       ORDER BY usage_count DESC, created_at DESC`,
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );

    return templates.map(template => ({
      ...template,
      variables: template.variables ? JSON.parse(template.variables) : [],
      is_system: Boolean(template.is_system),
    }));
  }

  /**
   * 获取统计信息
   * @returns {Promise<Object>} 统计数据
   */
  async getStatistics() {
    const total = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates'
    );

    const system = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 1'
    );

    const custom = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 0'
    );

    const byCategory = await this.db.all(
      'SELECT category, COUNT(*) as count FROM prompt_templates GROUP BY category'
    );

    const mostUsed = await this.db.all(
      'SELECT id, name, usage_count FROM prompt_templates ORDER BY usage_count DESC LIMIT 5'
    );

    return {
      total: total.count,
      system: system.count,
      custom: custom.count,
      byCategory: byCategory.reduce((acc, row) => {
        acc[row.category] = row.count;
        return acc;
      }, {}),
      mostUsed,
    };
  }

  /**
   * 导出模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object>} 导出数据
   */
  async exportTemplate(id) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    return {
      version: '1.0',
      exported_at: new Date().toISOString(),
      template: {
        name: template.name,
        description: template.description,
        template: template.template,
        variables: template.variables,
        category: template.category,
      },
    };
  }

  /**
   * 导入模板
   * @param {Object} importData - 导入数据
   * @returns {Promise<Object>} 导入的模板
   */
  async importTemplate(importData) {
    if (!importData.template) {
      throw new Error('无效的导入数据');
    }

    const { name, description, template, variables, category } = importData.template;

    return await this.createTemplate({
      name,
      description,
      template,
      variables,
      category,
    });
  }
}

module.exports = PromptTemplateManager;
