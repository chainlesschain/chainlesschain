/**
 * Prompt模板管理器 (Mobile Edition)
 *
 * 管理AI提示词模板，支持变量替换、分类管理、使用统计等功能
 * 基于PC版实现，针对移动端进行优化
 *
 * @version 1.9.0
 * @module PromptManager
 */

import { v4 as uuidv4 } from 'uuid'

/**
 * Prompt模板管理器类
 */
class PromptManager {
  /**
   * 构造函数
   * @param {Object} db - 数据库实例 (uni-app SQLite)
   */
  constructor(db) {
    this.db = db
    this.cache = new Map() // 模板缓存
    this.statsCache = null // 统计缓存
    this.categoriesCache = null // 分类缓存
    this.cacheExpiry = 5 * 60 * 1000 // 缓存过期时间: 5分钟
    this.initialized = false
  }

  /**
   * 初始化
   * 创建数据库表并插入内置模板
   */
  async initialize() {
    if (this.initialized) {
      console.log('[PromptManager] 已初始化，跳过')
      return true
    }

    try {
      console.log('[PromptManager] 初始化Prompt模板管理器...')

      // 创建表
      await this.createTable()

      // 插入内置模板
      await this.insertBuiltInTemplates()

      this.initialized = true
      console.log('[PromptManager] Prompt模板管理器初始化成功')
      return true
    } catch (error) {
      console.error('[PromptManager] 初始化失败:', error)
      throw error
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
        tags TEXT,
        is_system INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        author TEXT,
        version TEXT DEFAULT '1.0.0',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `

    return new Promise((resolve, reject) => {
      this.db.executeSql({
        sql,
        success: () => {
          console.log('[PromptManager] 数据库表已创建')
          resolve()
        },
        fail: (err) => {
          console.error('[PromptManager] 创建表失败:', err)
          reject(err)
        }
      })
    })
  }

  /**
   * 插入内置模板
   */
  async insertBuiltInTemplates() {
    try {
      // 检查是否已存在内置模板
      const existing = await this.queryOne(
        'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 1 AND deleted = 0'
      )

      if (existing && existing.count > 0) {
        console.log('[PromptManager] 内置模板已存在，跳过插入')
        return
      }

      const builtInTemplates = this.getBuiltInTemplates()
      const now = Date.now()

      for (const template of builtInTemplates) {
        const id = template.id || uuidv4()

        await this.execute(
          `INSERT OR IGNORE INTO prompt_templates
           (id, name, description, template, variables, category, tags, is_system,
            usage_count, rating, rating_count, author, version, created_at, updated_at, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            template.name,
            template.description || '',
            template.template,
            JSON.stringify(template.variables || []),
            template.category || 'general',
            JSON.stringify(template.tags || []),
            1, // is_system
            0, // usage_count
            0, // rating
            0, // rating_count
            'system',
            '1.0.0',
            now,
            now,
            0 // not deleted
          ]
        )
      }

      console.log('[PromptManager] 内置模板已插入:', builtInTemplates.length)
    } catch (error) {
      console.error('[PromptManager] 插入内置模板失败:', error)
      throw error
    }
  }

  /**
   * 获取内置模板定义
   */
  getBuiltInTemplates() {
    return [
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
        variables: ['content'],
        category: 'writing',
        tags: ['摘要', '总结', '写作']
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
        variables: ['content', 'length'],
        category: 'writing',
        tags: ['扩写', '写作', '内容生成']
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
        variables: ['content', 'target_language'],
        category: 'translation',
        tags: ['翻译', '语言', '多语言']
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
        variables: ['content'],
        category: 'writing',
        tags: ['校对', '纠错', '写作']
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
        variables: ['content'],
        category: 'analysis',
        tags: ['关键词', '分析', 'NLP']
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
        variables: ['context', 'question'],
        category: 'qa',
        tags: ['问答', 'Q&A', '知识问答']
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
        variables: ['topic', 'count'],
        category: 'creative',
        tags: ['创意', '头脑风暴', '想法生成']
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
        variables: ['code', 'language'],
        category: 'programming',
        tags: ['代码', '编程', '代码解释']
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
        variables: ['topic', 'sections'],
        category: 'writing',
        tags: ['大纲', '结构', '写作规划']
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
        variables: ['retrieved_docs', 'question'],
        category: 'rag',
        tags: ['RAG', '检索增强', '知识问答']
      },
      {
        id: 'builtin-sentiment-analysis',
        name: '情感分析',
        description: '分析文本的情感倾向',
        template: `请分析以下文本的情感倾向：

{{content}}

请提供：
1. 整体情感倾向（正面/中性/负面）
2. 情感强度（1-10分）
3. 关键情感词汇
4. 情感细节分析`,
        variables: ['content'],
        category: 'analysis',
        tags: ['情感分析', 'NLP', '文本分析']
      },
      {
        id: 'builtin-mobile-note',
        name: '移动快记',
        description: '移动端快速笔记模板',
        template: `# {{title}}

**时间：** {{datetime}}
**位置：** {{location}}
**标签：** {{tags}}

## 内容

{{content}}

## 待办
- [ ] {{todo_1}}
- [ ] {{todo_2}}

## 备注
{{notes}}`,
        variables: ['title', 'datetime', 'location', 'tags', 'content', 'todo_1', 'todo_2', 'notes'],
        category: 'mobile',
        tags: ['移动', '笔记', '快记']
      }
    ]
  }

  /**
   * 创建Prompt模板
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
      tags = [],
      author = 'user'
    } = templateData

    if (!name || !template) {
      throw new Error('模板名称和内容不能为空')
    }

    const id = uuidv4()
    const now = Date.now()

    await this.execute(
      `INSERT INTO prompt_templates
       (id, name, description, template, variables, category, tags, is_system,
        usage_count, rating, rating_count, author, version, created_at, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        description,
        template,
        JSON.stringify(variables),
        category,
        JSON.stringify(tags),
        0, // 用户模板
        0, // usage_count
        0, // rating
        0, // rating_count
        author,
        '1.0.0',
        now,
        now,
        0 // not deleted
      ]
    )

    // 清除缓存
    this.invalidateCache()

    return this.getTemplateById(id)
  }

  /**
   * 根据ID获取模板
   * @param {string} id - 模板ID
   * @returns {Promise<Object|null>} 模板对象
   */
  async getTemplateById(id) {
    // 检查缓存
    if (this.cache.has(id)) {
      const cached = this.cache.get(id)
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.data
      }
    }

    const template = await this.queryOne(
      'SELECT * FROM prompt_templates WHERE id = ? AND deleted = 0',
      [id]
    )

    if (!template) {
      return null
    }

    const parsed = this.parseTemplate(template)

    // 缓存结果
    this.cache.set(id, {
      data: parsed,
      timestamp: Date.now()
    })

    return parsed
  }

  /**
   * 获取模板列表
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 模板列表
   */
  async getTemplates(options = {}) {
    const {
      category,
      isSystem,
      tags,
      offset = 0,
      limit = 50
    } = options

    let sql = 'SELECT * FROM prompt_templates WHERE deleted = 0'
    const params = []

    if (category) {
      sql += ' AND category = ?'
      params.push(category)
    }

    if (isSystem !== undefined) {
      sql += ' AND is_system = ?'
      params.push(isSystem ? 1 : 0)
    }

    if (tags && tags.length > 0) {
      // 简单的标签匹配（可以优化为全文搜索）
      sql += ' AND tags LIKE ?'
      params.push(`%${tags[0]}%`)
    }

    sql += ' ORDER BY is_system DESC, usage_count DESC, created_at DESC'
    sql += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const templates = await this.query(sql, params)
    return templates.map(t => this.parseTemplate(t))
  }

  /**
   * 更新模板
   * @param {string} id - 模板ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} 更新后的模板
   */
  async updateTemplate(id, updates) {
    const template = await this.getTemplateById(id)

    if (!template) {
      throw new Error('模板不存在')
    }

    if (template.is_system) {
      throw new Error('系统模板不能修改')
    }

    const fields = []
    const params = []

    const allowedFields = ['name', 'description', 'template', 'variables', 'category', 'tags']

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`)

        // 处理JSON字段
        if (field === 'variables' || field === 'tags') {
          params.push(JSON.stringify(updates[field]))
        } else {
          params.push(updates[field])
        }
      }
    }

    if (fields.length === 0) {
      return template
    }

    fields.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    await this.execute(
      `UPDATE prompt_templates SET ${fields.join(', ')} WHERE id = ?`,
      params
    )

    // 清除缓存
    this.cache.delete(id)
    this.invalidateCache()

    return this.getTemplateById(id)
  }

  /**
   * 删除模板（软删除）
   * @param {string} id - 模板ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteTemplate(id) {
    const template = await this.getTemplateById(id)

    if (!template) {
      throw new Error('模板不存在')
    }

    if (template.is_system) {
      throw new Error('系统模板不能删除')
    }

    await this.execute(
      'UPDATE prompt_templates SET deleted = 1, updated_at = ? WHERE id = ?',
      [Date.now(), id]
    )

    // 清除缓存
    this.cache.delete(id)
    this.invalidateCache()

    return true
  }

  /**
   * 填充模板变量
   * @param {string} id - 模板ID
   * @param {Object} values - 变量值对象
   * @returns {Promise<string>} 填充后的提示词
   */
  async fillTemplate(id, values) {
    const template = await this.getTemplateById(id)

    if (!template) {
      throw new Error('模板不存在')
    }

    let result = template.template

    // 替换所有变量 {{variable}}
    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
      result = result.replace(regex, value || '')
    }

    // 增加使用次数
    await this.incrementUsage(id)

    return result
  }

  /**
   * 增加使用次数
   * @param {string} id - 模板ID
   */
  async incrementUsage(id) {
    await this.execute(
      'UPDATE prompt_templates SET usage_count = usage_count + 1 WHERE id = ?',
      [id]
    )

    // 清除缓存
    this.cache.delete(id)
    this.invalidateCache()
  }

  /**
   * 搜索模板
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 匹配的模板列表
   */
  async searchTemplates(query, options = {}) {
    const { limit = 50 } = options

    const templates = await this.query(
      `SELECT * FROM prompt_templates
       WHERE deleted = 0 AND (
         name LIKE ? OR
         description LIKE ? OR
         template LIKE ? OR
         tags LIKE ?
       )
       ORDER BY usage_count DESC, created_at DESC
       LIMIT ?`,
      [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, limit]
    )

    return templates.map(t => this.parseTemplate(t))
  }

  /**
   * 获取分类列表
   * @returns {Promise<Array>} 分类列表
   */
  async getCategories() {
    // 检查缓存
    if (this.categoriesCache && Date.now() - this.categoriesCache.timestamp < this.cacheExpiry) {
      return this.categoriesCache.data
    }

    const result = await this.query(
      'SELECT DISTINCT category FROM prompt_templates WHERE deleted = 0 ORDER BY category'
    )

    const categories = result.map(row => row.category)

    // 缓存结果
    this.categoriesCache = {
      data: categories,
      timestamp: Date.now()
    }

    return categories
  }

  /**
   * 获取统计信息
   * @returns {Promise<Object>} 统计数据
   */
  async getStatistics() {
    // 检查缓存
    if (this.statsCache && Date.now() - this.statsCache.timestamp < this.cacheExpiry) {
      return this.statsCache.data
    }

    const total = await this.queryOne(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE deleted = 0'
    )

    const system = await this.queryOne(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 1 AND deleted = 0'
    )

    const custom = await this.queryOne(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 0 AND deleted = 0'
    )

    const byCategory = await this.query(
      'SELECT category, COUNT(*) as count FROM prompt_templates WHERE deleted = 0 GROUP BY category'
    )

    const mostUsed = await this.query(
      'SELECT id, name, usage_count FROM prompt_templates WHERE deleted = 0 ORDER BY usage_count DESC LIMIT 5'
    )

    const stats = {
      total: total.count,
      system: system.count,
      custom: custom.count,
      byCategory: byCategory.reduce((acc, row) => {
        acc[row.category] = row.count
        return acc
      }, {}),
      mostUsed
    }

    // 缓存结果
    this.statsCache = {
      data: stats,
      timestamp: Date.now()
    }

    return stats
  }

  /**
   * 评分模板
   * @param {string} id - 模板ID
   * @param {number} rating - 评分 (1-5)
   * @returns {Promise<Object>} 更新后的模板
   */
  async rateTemplate(id, rating) {
    if (rating < 1 || rating > 5) {
      throw new Error('评分必须在1-5之间')
    }

    const template = await this.getTemplateById(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    // 计算新的平均评分
    const newRatingCount = template.rating_count + 1
    const newRating = (template.rating * template.rating_count + rating) / newRatingCount

    await this.execute(
      'UPDATE prompt_templates SET rating = ?, rating_count = ? WHERE id = ?',
      [newRating, newRatingCount, id]
    )

    // 清除缓存
    this.cache.delete(id)
    this.invalidateCache()

    return this.getTemplateById(id)
  }

  /**
   * 导出模板
   * @param {string} id - 模板ID
   * @returns {Promise<Object>} 导出数据
   */
  async exportTemplate(id) {
    const template = await this.getTemplateById(id)

    if (!template) {
      throw new Error('模板不存在')
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
        tags: template.tags,
        author: template.author
      }
    }
  }

  /**
   * 导入模板
   * @param {Object} importData - 导入数据
   * @returns {Promise<Object>} 导入的模板
   */
  async importTemplate(importData) {
    if (!importData.template) {
      throw new Error('无效的导入数据')
    }

    const { name, description, template, variables, category, tags, author } = importData.template

    return await this.createTemplate({
      name,
      description,
      template,
      variables,
      category,
      tags,
      author: author || 'imported'
    })
  }

  /**
   * 解析模板对象（处理JSON字段）
   * @param {Object} template - 原始模板对象
   * @returns {Object} 解析后的模板对象
   */
  parseTemplate(template) {
    return {
      ...template,
      variables: template.variables ? JSON.parse(template.variables) : [],
      tags: template.tags ? JSON.parse(template.tags) : [],
      is_system: Boolean(template.is_system),
      deleted: Boolean(template.deleted),
      rating: Number(template.rating || 0)
    }
  }

  /**
   * 清除所有缓存
   */
  invalidateCache() {
    this.statsCache = null
    this.categoriesCache = null
    // 不清除模板缓存，只让其自然过期
  }

  /**
   * 清除所有缓存（包括模板缓存）
   */
  clearAllCache() {
    this.cache.clear()
    this.statsCache = null
    this.categoriesCache = null
  }

  // ============================================================
  // 数据库辅助方法
  // ============================================================

  /**
   * 执行SQL语句
   * @param {string} sql - SQL语句
   * @param {Array} params - 参数
   */
  execute(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.executeSql({
        sql,
        args: params,
        success: () => resolve(),
        fail: (err) => reject(err)
      })
    })
  }

  /**
   * 查询多行
   * @param {string} sql - SQL语句
   * @param {Array} params - 参数
   * @returns {Promise<Array>} 结果数组
   */
  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.selectSql({
        sql,
        args: params,
        success: (res) => resolve(res || []),
        fail: (err) => reject(err)
      })
    })
  }

  /**
   * 查询单行
   * @param {string} sql - SQL语句
   * @param {Array} params - 参数
   * @returns {Promise<Object|null>} 结果对象
   */
  async queryOne(sql, params = []) {
    const results = await this.query(sql, params)
    return results.length > 0 ? results[0] : null
  }
}

/**
 * 工厂函数：创建或获取PromptManager实例（单例模式）
 */
let promptManagerInstance = null

export function createPromptManager(db) {
  if (!promptManagerInstance) {
    promptManagerInstance = new PromptManager(db)
  }
  return promptManagerInstance
}

export default PromptManager
