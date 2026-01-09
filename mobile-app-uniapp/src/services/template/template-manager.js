/**
 * 移动端模板管理器 (Template Manager)
 * 版本: v1.8.0
 * 功能: 项目模板管理、变量替换、模板应用
 */

import database from '../database'

/**
 * 简化的模板引擎
 * 支持 {{variable}} 语法的变量替换
 */
class SimpleTemplateEngine {
  /**
   * 渲染模板
   * @param {string} template - 模板字符串
   * @param {Object} data - 数据对象
   * @returns {string} 渲染结果
   */
  render(template, data = {}) {
    if (!template) return ''

    // 替换 {{variable}} 格式的变量
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim()

      // 支持嵌套对象访问：{{user.name}}
      const value = this.getNestedValue(data, trimmedKey)

      // 如果值是undefined或null，返回空字符串
      return value !== undefined && value !== null ? String(value) : ''
    })
  }

  /**
   * 获取嵌套对象的值
   * @param {Object} obj - 对象
   * @param {string} path - 路径（如 'user.name'）
   * @returns {*} 值
   */
  getNestedValue(obj, path) {
    const keys = path.split('.')
    let value = obj

    for (const key of keys) {
      if (value === undefined || value === null) {
        return undefined
      }
      value = value[key]
    }

    return value
  }

  /**
   * 提取模板中的所有变量
   * @param {string} template - 模板字符串
   * @returns {Array<string>} 变量名数组
   */
  extractVariables(template) {
    if (!template) return []

    const variables = []
    const regex = /\{\{([^}]+)\}\}/g
    let match

    while ((match = regex.exec(template)) !== null) {
      const variable = match[1].trim()
      if (!variables.includes(variable)) {
        variables.push(variable)
      }
    }

    return variables
  }
}

/**
 * 模板管理器类
 */
class TemplateManager {
  constructor() {
    this.db = null
    this.engine = new SimpleTemplateEngine()
    this.initialized = false
    this.cache = new Map() // 模板缓存
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) {
      return
    }

    try {
      this.db = database

      // 创建模板表
      await this.createTables()

      // 加载内置模板
      await this.loadBuiltinTemplates()

      this.initialized = true
      console.log('[TemplateManager] 初始化成功')
    } catch (error) {
      console.error('[TemplateManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建数据库表
   */
  async createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        category TEXT NOT NULL,
        subcategory TEXT,
        tags TEXT,
        content TEXT NOT NULL,
        variables TEXT,
        is_builtin INTEGER DEFAULT 0,
        author TEXT,
        version TEXT DEFAULT '1.0.0',
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `

    await this.db.executeSql(createTableSQL)

    // 创建索引
    await this.db.executeSql(
      'CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category)'
    )
    await this.db.executeSql(
      'CREATE INDEX IF NOT EXISTS idx_templates_deleted ON templates(deleted)'
    )
  }

  /**
   * 加载内置模板
   */
  async loadBuiltinTemplates() {
    const builtinTemplates = this.getBuiltinTemplates()

    let loadedCount = 0
    for (const template of builtinTemplates) {
      try {
        // 检查是否已存在
        const existing = await this.getTemplateById(template.id)

        if (!existing) {
          await this.createTemplate(template, true)
          loadedCount++
        }
      } catch (error) {
        console.error(`[TemplateManager] 加载内置模板失败 ${template.id}:`, error)
      }
    }

    console.log(`[TemplateManager] 加载了 ${loadedCount} 个内置模板`)
  }

  /**
   * 获取内置模板定义
   */
  getBuiltinTemplates() {
    return [
      // 1. 写作类模板
      {
        id: 'template_blog_post',
        name: 'blog_post',
        display_name: '博客文章',
        description: '创建一篇专业的博客文章',
        icon: '📝',
        category: 'writing',
        subcategory: 'blog',
        tags: ['博客', '文章', '写作'],
        content: `# {{title}}

作者：{{author}}
日期：{{date}}

## 摘要
{{summary}}

## 正文
{{content}}

## 结论
{{conclusion}}

---
标签：{{tags}}`,
        variables: JSON.stringify([
          { name: 'title', label: '标题', type: 'text', required: true },
          { name: 'author', label: '作者', type: 'text', required: true },
          { name: 'date', label: '日期', type: 'date', required: false },
          { name: 'summary', label: '摘要', type: 'textarea', required: false },
          { name: 'content', label: '正文', type: 'textarea', required: true },
          { name: 'conclusion', label: '结论', type: 'textarea', required: false },
          { name: 'tags', label: '标签', type: 'text', required: false }
        ]),
        version: '1.0.0',
        author: 'ChainlessChain'
      },

      // 2. 会议记录
      {
        id: 'template_meeting_notes',
        name: 'meeting_notes',
        display_name: '会议记录',
        description: '结构化的会议记录模板',
        icon: '📋',
        category: 'productivity',
        subcategory: 'meeting',
        tags: ['会议', '记录', '办公'],
        content: `# 会议记录 - {{title}}

**时间**: {{date}} {{time}}
**地点**: {{location}}
**主持人**: {{host}}
**参会人员**: {{attendees}}

## 会议议程
{{agenda}}

## 讨论要点
{{discussion}}

## 决策事项
{{decisions}}

## 待办事项
{{action_items}}

## 下次会议
**时间**: {{next_meeting_date}}
**议题**: {{next_meeting_agenda}}

---
记录人：{{recorder}}`,
        variables: JSON.stringify([
          { name: 'title', label: '会议主题', type: 'text', required: true },
          { name: 'date', label: '日期', type: 'date', required: true },
          { name: 'time', label: '时间', type: 'time', required: true },
          { name: 'location', label: '地点', type: 'text', required: false },
          { name: 'host', label: '主持人', type: 'text', required: true },
          { name: 'attendees', label: '参会人员', type: 'textarea', required: true },
          { name: 'agenda', label: '会议议程', type: 'textarea', required: true },
          { name: 'discussion', label: '讨论要点', type: 'textarea', required: true },
          { name: 'decisions', label: '决策事项', type: 'textarea', required: false },
          { name: 'action_items', label: '待办事项', type: 'textarea', required: false },
          { name: 'next_meeting_date', label: '下次会议日期', type: 'date', required: false },
          { name: 'next_meeting_agenda', label: '下次会议议题', type: 'text', required: false },
          { name: 'recorder', label: '记录人', type: 'text', required: true }
        ]),
        version: '1.0.0',
        author: 'ChainlessChain'
      },

      // 3. 项目文档
      {
        id: 'template_project_doc',
        name: 'project_doc',
        display_name: '项目文档',
        description: '软件项目文档模板',
        icon: '📄',
        category: 'tech-docs',
        subcategory: 'project',
        tags: ['项目', '文档', '技术'],
        content: `# {{project_name}}

## 项目概述
{{overview}}

## 技术栈
{{tech_stack}}

## 功能模块
{{features}}

## 架构设计
{{architecture}}

## 接口文档
{{api_docs}}

## 部署说明
{{deployment}}

## 版本历史
**当前版本**: {{version}}
{{changelog}}

---
**维护者**: {{maintainer}}
**最后更新**: {{last_updated}}`,
        variables: JSON.stringify([
          { name: 'project_name', label: '项目名称', type: 'text', required: true },
          { name: 'overview', label: '项目概述', type: 'textarea', required: true },
          { name: 'tech_stack', label: '技术栈', type: 'textarea', required: true },
          { name: 'features', label: '功能模块', type: 'textarea', required: true },
          { name: 'architecture', label: '架构设计', type: 'textarea', required: false },
          { name: 'api_docs', label: '接口文档', type: 'textarea', required: false },
          { name: 'deployment', label: '部署说明', type: 'textarea', required: false },
          { name: 'version', label: '版本号', type: 'text', required: true },
          { name: 'changelog', label: '版本历史', type: 'textarea', required: false },
          { name: 'maintainer', label: '维护者', type: 'text', required: true },
          { name: 'last_updated', label: '最后更新', type: 'date', required: false }
        ]),
        version: '1.0.0',
        author: 'ChainlessChain'
      },

      // 4. 学习笔记
      {
        id: 'template_study_notes',
        name: 'study_notes',
        display_name: '学习笔记',
        description: '结构化学习笔记模板',
        icon: '📚',
        category: 'education',
        subcategory: 'notes',
        tags: ['学习', '笔记', '教育'],
        content: `# {{subject}} - {{topic}}

**日期**: {{date}}
**来源**: {{source}}

## 核心概念
{{key_concepts}}

## 详细笔记
{{detailed_notes}}

## 示例
{{examples}}

## 问题与思考
{{questions}}

## 总结
{{summary}}

## 参考资料
{{references}}

---
**下一步**: {{next_steps}}`,
        variables: JSON.stringify([
          { name: 'subject', label: '学科', type: 'text', required: true },
          { name: 'topic', label: '主题', type: 'text', required: true },
          { name: 'date', label: '日期', type: 'date', required: false },
          { name: 'source', label: '来源', type: 'text', required: false },
          { name: 'key_concepts', label: '核心概念', type: 'textarea', required: true },
          { name: 'detailed_notes', label: '详细笔记', type: 'textarea', required: true },
          { name: 'examples', label: '示例', type: 'textarea', required: false },
          { name: 'questions', label: '问题与思考', type: 'textarea', required: false },
          { name: 'summary', label: '总结', type: 'textarea', required: false },
          { name: 'references', label: '参考资料', type: 'textarea', required: false },
          { name: 'next_steps', label: '下一步', type: 'text', required: false }
        ]),
        version: '1.0.0',
        author: 'ChainlessChain'
      },

      // 5. 任务清单
      {
        id: 'template_todo_list',
        name: 'todo_list',
        display_name: '任务清单',
        description: 'GTD风格的任务清单',
        icon: '✅',
        category: 'productivity',
        subcategory: 'task',
        tags: ['任务', '清单', 'GTD'],
        content: `# {{list_name}}

**日期**: {{date}}
**优先级**: {{priority}}

## 今日必做 🔥
{{today_must_do}}

## 本周计划 📅
{{week_plan}}

## 待办事项 📝
{{todo_items}}

## 已完成 ✅
{{completed_items}}

## 推迟/搁置 ⏸
{{postponed_items}}

---
**备注**: {{notes}}`,
        variables: JSON.stringify([
          { name: 'list_name', label: '清单名称', type: 'text', required: true },
          { name: 'date', label: '日期', type: 'date', required: true },
          { name: 'priority', label: '优先级', type: 'select', options: ['高', '中', '低'], required: false },
          { name: 'today_must_do', label: '今日必做', type: 'textarea', required: false },
          { name: 'week_plan', label: '本周计划', type: 'textarea', required: false },
          { name: 'todo_items', label: '待办事项', type: 'textarea', required: true },
          { name: 'completed_items', label: '已完成', type: 'textarea', required: false },
          { name: 'postponed_items', label: '推迟/搁置', type: 'textarea', required: false },
          { name: 'notes', label: '备注', type: 'textarea', required: false }
        ]),
        version: '1.0.0',
        author: 'ChainlessChain'
      },

      // 6. 读书笔记
      {
        id: 'template_book_notes',
        name: 'book_notes',
        display_name: '读书笔记',
        description: '读书笔记和书评模板',
        icon: '📖',
        category: 'education',
        subcategory: 'reading',
        tags: ['读书', '笔记', '书评'],
        content: `# 《{{book_title}}》读书笔记

**作者**: {{author}}
**出版社**: {{publisher}}
**阅读日期**: {{reading_date}}
**评分**: {{rating}}/5

## 书籍简介
{{brief}}

## 核心观点
{{key_points}}

## 精彩摘录
{{quotes}}

## 读后感
{{thoughts}}

## 实践应用
{{action_items}}

## 推荐指数
{{recommendation}}

---
**相关书籍**: {{related_books}}`,
        variables: JSON.stringify([
          { name: 'book_title', label: '书名', type: 'text', required: true },
          { name: 'author', label: '作者', type: 'text', required: true },
          { name: 'publisher', label: '出版社', type: 'text', required: false },
          { name: 'reading_date', label: '阅读日期', type: 'date', required: false },
          { name: 'rating', label: '评分(1-5)', type: 'number', required: false },
          { name: 'brief', label: '书籍简介', type: 'textarea', required: false },
          { name: 'key_points', label: '核心观点', type: 'textarea', required: true },
          { name: 'quotes', label: '精彩摘录', type: 'textarea', required: false },
          { name: 'thoughts', label: '读后感', type: 'textarea', required: true },
          { name: 'action_items', label: '实践应用', type: 'textarea', required: false },
          { name: 'recommendation', label: '推荐指数', type: 'text', required: false },
          { name: 'related_books', label: '相关书籍', type: 'text', required: false }
        ]),
        version: '1.0.0',
        author: 'ChainlessChain'
      }
    ]
  }

  /**
   * 创建模板
   * @param {Object} templateData - 模板数据
   * @param {boolean} isBuiltin - 是否内置模板
   * @returns {Object} 创建的模板
   */
  async createTemplate(templateData, isBuiltin = false) {
    this.ensureDatabase()

    const now = Date.now()
    const id = templateData.id || `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 提取模板变量
    const variables = this.engine.extractVariables(templateData.content)

    const template = {
      id,
      name: templateData.name,
      display_name: templateData.display_name,
      description: templateData.description || '',
      icon: templateData.icon || '📄',
      category: templateData.category,
      subcategory: templateData.subcategory || '',
      tags: JSON.stringify(templateData.tags || []),
      content: templateData.content,
      variables: templateData.variables || JSON.stringify(variables.map(v => ({ name: v, type: 'text', required: false }))),
      is_builtin: isBuiltin ? 1 : 0,
      author: templateData.author || '',
      version: templateData.version || '1.0.0',
      usage_count: 0,
      rating: 0,
      rating_count: 0,
      created_at: now,
      updated_at: now,
      deleted: 0
    }

    const sql = `
      INSERT INTO templates (
        id, name, display_name, description, icon, category, subcategory, tags,
        content, variables, is_builtin, author, version, usage_count,
        rating, rating_count, created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    await this.db.executeSql(sql, [
      template.id,
      template.name,
      template.display_name,
      template.description,
      template.icon,
      template.category,
      template.subcategory,
      template.tags,
      template.content,
      template.variables,
      template.is_builtin,
      template.author,
      template.version,
      template.usage_count,
      template.rating,
      template.rating_count,
      template.created_at,
      template.updated_at,
      template.deleted
    ])

    // 清除缓存
    this.cache.clear()

    return template
  }

  /**
   * 获取模板（通过ID）
   * @param {string} id - 模板ID
   * @returns {Object|null} 模板对象
   */
  async getTemplateById(id) {
    this.ensureDatabase()

    // 检查缓存
    if (this.cache.has(id)) {
      return this.cache.get(id)
    }

    const sql = 'SELECT * FROM templates WHERE id = ? AND deleted = 0'
    const results = await this.db.executeSql(sql, [id])

    if (results.rows && results.rows.length > 0) {
      const template = this.parseTemplate(results.rows.item(0))
      this.cache.set(id, template)
      return template
    }

    return null
  }

  /**
   * 获取所有模板
   * @param {Object} options - 查询选项
   * @returns {Array} 模板列表
   */
  async getTemplates(options = {}) {
    this.ensureDatabase()

    const {
      category = null,
      subcategory = null,
      search = null,
      includeBuiltin = true,
      limit = 100,
      offset = 0
    } = options

    let sql = 'SELECT * FROM templates WHERE deleted = 0'
    const params = []

    if (category) {
      sql += ' AND category = ?'
      params.push(category)
    }

    if (subcategory) {
      sql += ' AND subcategory = ?'
      params.push(subcategory)
    }

    if (search) {
      sql += ' AND (display_name LIKE ? OR description LIKE ? OR tags LIKE ?)'
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern)
    }

    if (!includeBuiltin) {
      sql += ' AND is_builtin = 0'
    }

    sql += ' ORDER BY usage_count DESC, created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const results = await this.db.executeSql(sql, params)
    const templates = []

    if (results.rows) {
      for (let i = 0; i < results.rows.length; i++) {
        templates.push(this.parseTemplate(results.rows.item(i)))
      }
    }

    return templates
  }

  /**
   * 获取分类列表
   * @returns {Array} 分类列表
   */
  async getCategories() {
    this.ensureDatabase()

    const sql = `
      SELECT DISTINCT category, COUNT(*) as count
      FROM templates
      WHERE deleted = 0
      GROUP BY category
      ORDER BY count DESC
    `

    const results = await this.db.executeSql(sql)
    const categories = []

    if (results.rows) {
      for (let i = 0; i < results.rows.length; i++) {
        categories.push(results.rows.item(i))
      }
    }

    return categories
  }

  /**
   * 更新模板
   * @param {string} id - 模板ID
   * @param {Object} updates - 更新数据
   * @returns {Object} 更新后的模板
   */
  async updateTemplate(id, updates) {
    this.ensureDatabase()

    const template = await this.getTemplateById(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    if (template.is_builtin) {
      throw new Error('不能修改内置模板')
    }

    const now = Date.now()
    const fields = []
    const params = []

    // 可更新字段
    const allowedFields = [
      'name',
      'display_name',
      'description',
      'icon',
      'category',
      'subcategory',
      'tags',
      'content',
      'variables'
    ]

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`)

        if (field === 'tags' && Array.isArray(updates[field])) {
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
    params.push(now)
    params.push(id)

    const sql = `UPDATE templates SET ${fields.join(', ')} WHERE id = ?`
    await this.db.executeSql(sql, params)

    // 清除缓存
    this.cache.delete(id)
    this.cache.clear()

    return await this.getTemplateById(id)
  }

  /**
   * 删除模板（软删除）
   * @param {string} id - 模板ID
   * @returns {boolean} 是否成功
   */
  async deleteTemplate(id) {
    this.ensureDatabase()

    const template = await this.getTemplateById(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    if (template.is_builtin) {
      throw new Error('不能删除内置模板')
    }

    const sql = 'UPDATE templates SET deleted = 1, updated_at = ? WHERE id = ?'
    await this.db.executeSql(sql, [Date.now(), id])

    // 清除缓存
    this.cache.delete(id)
    this.cache.clear()

    return true
  }

  /**
   * 应用模板（渲染）
   * @param {string} templateId - 模板ID
   * @param {Object} data - 数据对象
   * @returns {string} 渲染结果
   */
  async applyTemplate(templateId, data = {}) {
    const content = await this.renderTemplateContent(templateId, data)

    // 增加使用次数
    await this.incrementUsageCount(templateId)

    return content
  }

  /**
   * 渲染模板内容（不会记录使用次数）
   * @param {string|Object} templateOrId 模板ID或模板对象
   * @param {Object} data 填充数据
   * @returns {string} 渲染结果
   */
  async renderTemplateContent(templateOrId, data = {}) {
    this.ensureDatabase()

    const template = typeof templateOrId === 'string'
      ? await this.getTemplateById(templateOrId)
      : templateOrId

    if (!template) {
      throw new Error('模板不存在')
    }

    return this.engine.render(template.content, data)
  }

  /**
   * 增加使用次数
   * @param {string} id - 模板ID
   */
  async incrementUsageCount(id) {
    const sql = 'UPDATE templates SET usage_count = usage_count + 1 WHERE id = ?'
    await this.db.executeSql(sql, [id])

    // 清除缓存
    this.cache.delete(id)
  }

  /**
   * 评分模板
   * @param {string} id - 模板ID
   * @param {number} rating - 评分 (1-5)
   * @returns {Object} 更新后的模板
   */
  async rateTemplate(id, rating) {
    if (rating < 1 || rating > 5) {
      throw new Error('评分必须在1-5之间')
    }

    const template = await this.getTemplateById(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    const newRatingCount = template.rating_count + 1
    const newRating =
      (template.rating * template.rating_count + rating) / newRatingCount

    const sql = `
      UPDATE templates
      SET rating = ?, rating_count = ?, updated_at = ?
      WHERE id = ?
    `

    await this.db.executeSql(sql, [newRating, newRatingCount, Date.now(), id])

    // 清除缓存
    this.cache.delete(id)

    return await this.getTemplateById(id)
  }

  /**
   * 解析模板对象
   * @param {Object} row - 数据库行
   * @returns {Object} 模板对象
   */
  parseTemplate(row) {
    return {
      ...row,
      tags: this.parseJSON(row.tags),
      variables: this.parseJSON(row.variables),
      is_builtin: Boolean(row.is_builtin),
      deleted: Boolean(row.deleted)
    }
  }

  /**
   * 安全解析JSON
   * @param {string} jsonStr - JSON字符串
   * @returns {*} 解析结果
   */
  parseJSON(jsonStr) {
    try {
      return JSON.parse(jsonStr)
    } catch {
      return []
    }
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  async getStats() {
    const totalSQL = 'SELECT COUNT(*) as total FROM templates WHERE deleted = 0'
    const builtinSQL = 'SELECT COUNT(*) as count FROM templates WHERE is_builtin = 1 AND deleted = 0'
    const customSQL = 'SELECT COUNT(*) as count FROM templates WHERE is_builtin = 0 AND deleted = 0'
    const mostUsedSQL = 'SELECT * FROM templates WHERE deleted = 0 ORDER BY usage_count DESC LIMIT 5'

    const [totalResult, builtinResult, customResult, mostUsedResult] = await Promise.all([
      this.db.executeSql(totalSQL),
      this.db.executeSql(builtinSQL),
      this.db.executeSql(customSQL),
      this.db.executeSql(mostUsedSQL)
    ])

    const mostUsed = []
    if (mostUsedResult.rows) {
      for (let i = 0; i < mostUsedResult.rows.length; i++) {
        mostUsed.push(this.parseTemplate(mostUsedResult.rows.item(i)))
      }
    }

    return {
      total: totalResult.rows?.item(0)?.total || 0,
      builtin: builtinResult.rows?.item(0)?.count || 0,
      custom: customResult.rows?.item(0)?.count || 0,
      mostUsed
    }
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.cache.clear()
  }
}

// 单例模式
let templateManagerInstance = null

/**
 * 获取模板管理器实例
 * @returns {TemplateManager} 模板管理器实例
 */
export function getTemplateManager() {
  if (!templateManagerInstance) {
    templateManagerInstance = new TemplateManager()
  }
  return templateManagerInstance
}

export default {
  getTemplateManager
}
