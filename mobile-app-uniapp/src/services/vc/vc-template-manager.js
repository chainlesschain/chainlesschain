/**
 * 可验证凭证模板管理器 (Mobile Edition)
 *
 * 提供预定义的凭证模板，简化凭证创建流程
 * 支持5种W3C标准凭证类型 + 自定义模板
 *
 * @version 2.0.0
 * @module VCTemplateManager
 */

import { v4 as uuidv4 } from 'uuid'

/**
 * 内置凭证模板定义
 */
const BUILT_IN_TEMPLATES = {
  // JavaScript 技能证书
  'javascript-skill': {
    id: 'built-in:javascript-skill',
    name: 'JavaScript 技能证书',
    type: 'SkillCertificate',
    description: '用于证明 JavaScript 编程能力',
    icon: '🔧',
    category: 'skill',
    fields: [
      {
        key: 'skill',
        label: '技能名称',
        type: 'text',
        required: true,
        defaultValue: 'JavaScript',
        placeholder: '例如: JavaScript'
      },
      {
        key: 'level',
        label: '熟练程度',
        type: 'select',
        required: true,
        options: ['Beginner', 'Intermediate', 'Advanced', 'Expert'],
        defaultValue: 'Intermediate'
      },
      {
        key: 'yearsOfExperience',
        label: '工作年限',
        type: 'number',
        required: true,
        defaultValue: 2,
        min: 0,
        max: 50
      },
      {
        key: 'certifications',
        label: '相关认证',
        type: 'text',
        required: false,
        placeholder: '例如: AWS Certified Developer'
      }
    ],
    isBuiltIn: true
  },

  // 教育凭证
  'education-degree': {
    id: 'built-in:education-degree',
    name: '学历证书',
    type: 'EducationCredential',
    description: '用于证明教育背景和学历',
    icon: '🎓',
    category: 'education',
    fields: [
      {
        key: 'degree',
        label: '学位',
        type: 'select',
        required: true,
        options: ['高中', '专科', '本科', '硕士', '博士'],
        defaultValue: '本科'
      },
      {
        key: 'major',
        label: '专业',
        type: 'text',
        required: true,
        placeholder: '例如: 计算机科学'
      },
      {
        key: 'institution',
        label: '学校',
        type: 'text',
        required: true,
        placeholder: '例如: 清华大学'
      },
      {
        key: 'graduationYear',
        label: '毕业年份',
        type: 'number',
        required: true,
        min: 1950,
        max: new Date().getFullYear() + 10,
        defaultValue: new Date().getFullYear()
      },
      {
        key: 'gpa',
        label: 'GPA',
        type: 'text',
        required: false,
        placeholder: '例如: 3.8/4.0'
      }
    ],
    isBuiltIn: true
  },

  // 工作经历
  'work-experience': {
    id: 'built-in:work-experience',
    name: '工作经历',
    type: 'WorkExperience',
    description: '用于证明工作经验和职位',
    icon: '💼',
    category: 'work',
    fields: [
      {
        key: 'position',
        label: '职位',
        type: 'text',
        required: true,
        placeholder: '例如: 高级软件工程师'
      },
      {
        key: 'company',
        label: '公司',
        type: 'text',
        required: true,
        placeholder: '例如: 科技公司'
      },
      {
        key: 'startDate',
        label: '开始时间',
        type: 'month',
        required: true,
        placeholder: '例如: 2020-01'
      },
      {
        key: 'endDate',
        label: '结束时间',
        type: 'month',
        required: false,
        placeholder: '留空表示至今'
      },
      {
        key: 'responsibilities',
        label: '工作职责',
        type: 'textarea',
        required: true,
        placeholder: '描述主要工作内容和职责'
      },
      {
        key: 'achievements',
        label: '主要成就',
        type: 'textarea',
        required: false,
        placeholder: '列出重要的项目成果'
      }
    ],
    isBuiltIn: true
  },

  // 信任背书
  'trust-endorsement': {
    id: 'built-in:trust-endorsement',
    name: '信任背书',
    type: 'TrustEndorsement',
    description: '为他人提供信任评价和推荐',
    icon: '🤝',
    category: 'trust',
    fields: [
      {
        key: 'trustLevel',
        label: '信任级别',
        type: 'select',
        required: true,
        options: ['Low', 'Medium', 'High', 'Very High'],
        defaultValue: 'High'
      },
      {
        key: 'relationship',
        label: '关系',
        type: 'select',
        required: true,
        options: ['同事', '朋友', '合作伙伴', '客户', '导师', '学生'],
        defaultValue: '同事'
      },
      {
        key: 'endorsement',
        label: '背书内容',
        type: 'textarea',
        required: true,
        placeholder: '描述为何信任此人，以及他们的优点和特长'
      },
      {
        key: 'duration',
        label: '认识时长',
        type: 'text',
        required: false,
        placeholder: '例如: 3 years'
      }
    ],
    isBuiltIn: true
  },

  // 自我声明
  'self-declaration': {
    id: 'built-in:self-declaration',
    name: '自我声明',
    type: 'SelfDeclaration',
    description: '声明个人信息、偏好或立场',
    icon: '📝',
    category: 'personal',
    fields: [
      {
        key: 'statement',
        label: '声明内容',
        type: 'textarea',
        required: true,
        placeholder: '例如: 我是一名全栈开发者'
      },
      {
        key: 'category',
        label: '类别',
        type: 'select',
        required: false,
        options: ['职业', '兴趣', '技能', '观点', '其他'],
        defaultValue: '职业'
      },
      {
        key: 'details',
        label: '补充说明',
        type: 'textarea',
        required: false,
        placeholder: '提供更多细节和背景信息'
      }
    ],
    isBuiltIn: true
  },

  // 移动端专属：项目认证
  'project-certification': {
    id: 'built-in:project-certification',
    name: '项目认证',
    type: 'ProjectCertification',
    description: '证明参与或完成某个项目',
    icon: '🚀',
    category: 'project',
    fields: [
      {
        key: 'projectName',
        label: '项目名称',
        type: 'text',
        required: true,
        placeholder: '例如: 移动电商平台'
      },
      {
        key: 'role',
        label: '项目角色',
        type: 'text',
        required: true,
        placeholder: '例如: 前端负责人'
      },
      {
        key: 'startDate',
        label: '开始时间',
        type: 'month',
        required: true
      },
      {
        key: 'endDate',
        label: '结束时间',
        type: 'month',
        required: false,
        placeholder: '留空表示进行中'
      },
      {
        key: 'description',
        label: '项目描述',
        type: 'textarea',
        required: true,
        placeholder: '项目背景、目标和技术栈'
      },
      {
        key: 'achievements',
        label: '项目成果',
        type: 'textarea',
        required: false,
        placeholder: '列出项目成果和指标'
      },
      {
        key: 'teamSize',
        label: '团队规模',
        type: 'number',
        required: false,
        min: 1,
        max: 1000,
        placeholder: '团队人数'
      }
    ],
    isBuiltIn: true
  }
}

/**
 * VC模板管理器类
 */
class VCTemplateManager {
  /**
   * 构造函数
   * @param {Object} db - 数据库实例
   */
  constructor(db) {
    this.db = db
    this.cache = new Map() // 模板缓存
    this.statsCache = null // 统计缓存
    this.cacheExpiry = 10 * 60 * 1000 // 缓存过期时间: 10分钟
    this.initialized = false
  }

  /**
   * 初始化模板管理器
   */
  async initialize() {
    if (this.initialized) {
      console.log('[VCTemplateManager] 已初始化，跳过')
      return true
    }

    try {
      console.log('[VCTemplateManager] 初始化凭证模板管理器...')

      // 创建表
      await this.createTable()

      this.initialized = true
      console.log('[VCTemplateManager] 凭证模板管理器初始化成功')
      return true
    } catch (error) {
      console.error('[VCTemplateManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建数据库表
   */
  async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS vc_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        category TEXT,
        fields TEXT NOT NULL,
        created_by TEXT NOT NULL,
        is_public INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `

    return new Promise((resolve, reject) => {
      this.db.executeSql({
        sql,
        success: () => {
          console.log('[VCTemplateManager] 数据库表已创建')
          resolve()
        },
        fail: (err) => {
          console.error('[VCTemplateManager] 创建表失败:', err)
          reject(err)
        }
      })
    })
  }

  /**
   * 获取所有模板（内置 + 用户自定义）
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 模板列表
   */
  async getAllTemplates(filters = {}) {
    try {
      // 获取内置模板
      let builtInTemplates = Object.values(BUILT_IN_TEMPLATES)

      // 按类型过滤内置模板
      if (filters.type) {
        builtInTemplates = builtInTemplates.filter(t => t.type === filters.type)
      }

      if (filters.category) {
        builtInTemplates = builtInTemplates.filter(t => t.category === filters.category)
      }

      // 获取用户自定义模板
      let sql = 'SELECT * FROM vc_templates WHERE deleted = 0'
      const params = []

      if (filters.type) {
        sql += ' AND type = ?'
        params.push(filters.type)
      }

      if (filters.category) {
        sql += ' AND category = ?'
        params.push(filters.category)
      }

      if (filters.createdBy) {
        sql += ' AND created_by = ?'
        params.push(filters.createdBy)
      }

      if (filters.isPublic !== undefined) {
        sql += ' AND is_public = ?'
        params.push(filters.isPublic ? 1 : 0)
      }

      sql += ' ORDER BY usage_count DESC, created_at DESC'

      const userTemplates = await this.query(sql, params)
      const parsedUserTemplates = userTemplates.map(t => this.parseTemplate(t))

      // 合并内置模板和用户模板
      return [...builtInTemplates, ...parsedUserTemplates]
    } catch (error) {
      console.error('[VCTemplateManager] 获取模板列表失败:', error)
      return Object.values(BUILT_IN_TEMPLATES)
    }
  }

  /**
   * 根据 ID 获取模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object|null>} 模板对象
   */
  async getTemplateById(id) {
    try {
      // 检查缓存
      if (this.cache.has(id)) {
        const cached = this.cache.get(id)
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          return cached.data
        }
      }

      // 检查是否是内置模板
      if (id.startsWith('built-in:')) {
        const templateKey = id.replace('built-in:', '')
        const template = BUILT_IN_TEMPLATES[templateKey] || null

        if (template) {
          // 缓存内置模板
          this.cache.set(id, {
            data: template,
            timestamp: Date.now()
          })
        }

        return template
      }

      // 查询用户自定义模板
      const template = await this.queryOne(
        'SELECT * FROM vc_templates WHERE id = ? AND deleted = 0',
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
    } catch (error) {
      console.error('[VCTemplateManager] 获取模板失败:', error)
      return null
    }
  }

  /**
   * 创建自定义模板
   * @param {Object} templateData - 模板数据
   * @returns {Promise<Object>} 创建的模板
   */
  async createTemplate(templateData) {
    const {
      name,
      type,
      description = '',
      icon = '📄',
      category = 'custom',
      fields,
      createdBy,
      isPublic = false
    } = templateData

    if (!name || !type || !fields || !createdBy) {
      throw new Error('模板名称、类型、字段和创建者不能为空')
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      throw new Error('字段定义无效')
    }

    // 验证字段格式
    for (const field of fields) {
      if (!field.key || !field.label || !field.type) {
        throw new Error(`字段定义不完整: ${JSON.stringify(field)}`)
      }

      const validTypes = ['text', 'number', 'select', 'month', 'textarea', 'date']
      if (!validTypes.includes(field.type)) {
        throw new Error(`不支持的字段类型: ${field.type}`)
      }
    }

    const id = `custom:${uuidv4()}`
    const now = Date.now()

    await this.execute(
      `INSERT INTO vc_templates (
        id, name, type, description, icon, category, fields,
        created_by, is_public, usage_count, rating, rating_count,
        created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        type,
        description,
        icon,
        category,
        JSON.stringify(fields),
        createdBy,
        isPublic ? 1 : 0,
        0, // usage_count
        0, // rating
        0, // rating_count
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
   * 更新模板
   * @param {string} id - 模板 ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Object>} 更新后的模板
   */
  async updateTemplate(id, updates) {
    // 不能更新内置模板
    if (id.startsWith('built-in:')) {
      throw new Error('不能修改内置模板')
    }

    const template = await this.getTemplateById(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    const fields = []
    const params = []

    const allowedFields = ['name', 'description', 'icon', 'category', 'fields', 'isPublic']

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        const dbField = field === 'isPublic' ? 'is_public' : field

        if (field === 'fields') {
          fields.push(`${dbField} = ?`)
          params.push(JSON.stringify(updates[field]))
        } else if (field === 'isPublic') {
          fields.push(`${dbField} = ?`)
          params.push(updates[field] ? 1 : 0)
        } else {
          fields.push(`${dbField} = ?`)
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
      `UPDATE vc_templates SET ${fields.join(', ')} WHERE id = ?`,
      params
    )

    // 清除缓存
    this.cache.delete(id)
    this.invalidateCache()

    return this.getTemplateById(id)
  }

  /**
   * 删除模板（软删除）
   * @param {string} id - 模板 ID
   * @returns {Promise<boolean>} 操作结果
   */
  async deleteTemplate(id) {
    // 不能删除内置模板
    if (id.startsWith('built-in:')) {
      throw new Error('不能删除内置模板')
    }

    const template = await this.getTemplateById(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    await this.execute(
      'UPDATE vc_templates SET deleted = 1, updated_at = ? WHERE id = ?',
      [Date.now(), id]
    )

    // 清除缓存
    this.cache.delete(id)
    this.invalidateCache()

    return true
  }

  /**
   * 增加模板使用次数
   * @param {string} id - 模板 ID
   */
  async incrementUsageCount(id) {
    try {
      // 内置模板不记录使用次数
      if (id.startsWith('built-in:')) {
        return
      }

      await this.execute(
        'UPDATE vc_templates SET usage_count = usage_count + 1 WHERE id = ?',
        [id]
      )

      // 清除缓存
      this.cache.delete(id)
      this.invalidateCache()
    } catch (error) {
      console.error('[VCTemplateManager] 更新使用次数失败:', error)
    }
  }

  /**
   * 评分模板
   * @param {string} id - 模板 ID
   * @param {number} rating - 评分 (1-5)
   * @returns {Promise<Object>} 更新后的模板
   */
  async rateTemplate(id, rating) {
    if (id.startsWith('built-in:')) {
      throw new Error('不能为内置模板评分')
    }

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
      'UPDATE vc_templates SET rating = ?, rating_count = ? WHERE id = ?',
      [newRating, newRatingCount, id]
    )

    // 清除缓存
    this.cache.delete(id)
    this.invalidateCache()

    return this.getTemplateById(id)
  }

  /**
   * 从模板填充凭证数据
   * @param {string} templateId - 模板 ID
   * @param {Object} values - 用户填写的值
   * @returns {Promise<Object>} 凭证声明数据
   */
  async fillTemplateValues(templateId, values) {
    const template = await this.getTemplateById(templateId)
    if (!template) {
      throw new Error('模板不存在')
    }

    const claims = {}

    template.fields.forEach(field => {
      const value = values[field.key]

      // 必填字段检查
      if (field.required && (value === undefined || value === null || value === '')) {
        throw new Error(`字段 "${field.label}" 是必填的`)
      }

      // 使用用户提供的值或默认值
      if (value !== undefined && value !== null && value !== '') {
        claims[field.key] = value
      } else if (field.defaultValue !== undefined) {
        claims[field.key] = field.defaultValue
      }
    })

    return claims
  }

  /**
   * 获取模板统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStatistics() {
    // 检查缓存
    if (this.statsCache && Date.now() - this.statsCache.timestamp < this.cacheExpiry) {
      return this.statsCache.data
    }

    try {
      const builtInCount = Object.keys(BUILT_IN_TEMPLATES).length

      const customResult = await this.queryOne(
        'SELECT COUNT(*) as count FROM vc_templates WHERE deleted = 0'
      )

      const publicResult = await this.queryOne(
        'SELECT COUNT(*) as count FROM vc_templates WHERE is_public = 1 AND deleted = 0'
      )

      const byTypeResult = await this.query(
        'SELECT type, COUNT(*) as count FROM vc_templates WHERE deleted = 0 GROUP BY type'
      )

      const byType = byTypeResult.reduce((acc, row) => {
        acc[row.type] = row.count
        return acc
      }, {})

      // 添加内置模板的类型统计
      Object.values(BUILT_IN_TEMPLATES).forEach(template => {
        byType[template.type] = (byType[template.type] || 0) + 1
      })

      const stats = {
        builtIn: builtInCount,
        custom: customResult?.count || 0,
        public: publicResult?.count || 0,
        total: builtInCount + (customResult?.count || 0),
        byType
      }

      // 缓存结果
      this.statsCache = {
        data: stats,
        timestamp: Date.now()
      }

      return stats
    } catch (error) {
      console.error('[VCTemplateManager] 获取统计信息失败:', error)
      return {
        builtIn: Object.keys(BUILT_IN_TEMPLATES).length,
        custom: 0,
        public: 0,
        total: Object.keys(BUILT_IN_TEMPLATES).length,
        byType: {}
      }
    }
  }

  /**
   * 导出模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object>} 导出数据
   */
  async exportTemplate(id) {
    const template = await this.getTemplateById(id)

    if (!template) {
      throw new Error('模板不存在')
    }

    return {
      version: '1.0',
      exportedAt: Date.now(),
      template: {
        name: template.name,
        type: template.type,
        description: template.description || '',
        icon: template.icon || '📄',
        category: template.category || 'custom',
        fields: template.fields
      }
    }
  }

  /**
   * 批量导出模板
   * @param {Array<string>} ids - 模板 ID 数组
   * @returns {Promise<Object>} 导出数据
   */
  async exportTemplates(ids) {
    const templates = []

    for (const id of ids) {
      try {
        const template = await this.getTemplateById(id)
        if (template) {
          templates.push({
            name: template.name,
            type: template.type,
            description: template.description || '',
            icon: template.icon || '📄',
            category: template.category || 'custom',
            fields: template.fields
          })
        }
      } catch (error) {
        console.warn(`[VCTemplateManager] 导出模板失败: ${id}`, error)
      }
    }

    return {
      version: '1.0',
      exportedAt: Date.now(),
      count: templates.length,
      templates
    }
  }

  /**
   * 导入模板
   * @param {Object} importData - 导入数据
   * @param {string} createdBy - 创建者
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果
   */
  async importTemplate(importData, createdBy, options = {}) {
    const { overwrite = false } = options

    try {
      console.log('[VCTemplateManager] 开始导入模板...')

      // 验证导入数据格式
      if (!importData || !importData.version) {
        throw new Error('无效的导入数据格式')
      }

      if (importData.version !== '1.0') {
        throw new Error(`不支持的版本: ${importData.version}`)
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [],
        imported: []
      }

      // 单个模板导入
      if (importData.template) {
        try {
          await this._importSingleTemplate(importData.template, createdBy, { overwrite })
          results.success++
          results.imported.push(importData.template.name)
        } catch (error) {
          results.failed++
          results.errors.push({
            template: importData.template.name,
            error: error.message
          })
        }
      }

      // 批量模板导入
      if (importData.templates && Array.isArray(importData.templates)) {
        for (const template of importData.templates) {
          try {
            await this._importSingleTemplate(template, createdBy, { overwrite })
            results.success++
            results.imported.push(template.name)
          } catch (error) {
            results.failed++
            results.errors.push({
              template: template.name,
              error: error.message
            })
          }
        }
      }

      console.log('[VCTemplateManager] 导入完成:', results)
      return results
    } catch (error) {
      console.error('[VCTemplateManager] 导入模板失败:', error)
      throw error
    }
  }

  /**
   * 导入单个模板（内部方法）
   * @param {Object} templateData - 模板数据
   * @param {string} createdBy - 创建者
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 创建的模板
   */
  async _importSingleTemplate(templateData, createdBy, options = {}) {
    const { overwrite = false } = options

    // 验证必填字段
    if (!templateData.name) {
      throw new Error('模板名称不能为空')
    }

    if (!templateData.type) {
      throw new Error('模板类型不能为空')
    }

    if (!templateData.fields || !Array.isArray(templateData.fields)) {
      throw new Error('模板字段定义无效')
    }

    // 检查是否已存在同名模板
    const allTemplates = await this.getAllTemplates({ createdBy })
    const duplicate = allTemplates.find(t => t.name === templateData.name && !t.isBuiltIn)

    if (duplicate && !overwrite) {
      throw new Error(`模板 "${templateData.name}" 已存在，请启用覆盖选项或重命名`)
    }

    // 如果需要覆盖，先删除旧模板
    if (duplicate && overwrite) {
      await this.deleteTemplate(duplicate.id)
    }

    // 创建新模板
    return await this.createTemplate({
      name: templateData.name,
      type: templateData.type,
      description: templateData.description || '',
      icon: templateData.icon || '📄',
      category: templateData.category || 'custom',
      fields: templateData.fields,
      createdBy,
      isPublic: false
    })
  }

  /**
   * 搜索模板
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 匹配的模板列表
   */
  async searchTemplates(query, options = {}) {
    try {
      const allTemplates = await this.getAllTemplates(options)

      const lowerQuery = query.toLowerCase()

      return allTemplates.filter(template => {
        return (
          template.name.toLowerCase().includes(lowerQuery) ||
          (template.description && template.description.toLowerCase().includes(lowerQuery)) ||
          template.type.toLowerCase().includes(lowerQuery) ||
          (template.category && template.category.toLowerCase().includes(lowerQuery))
        )
      })
    } catch (error) {
      console.error('[VCTemplateManager] 搜索模板失败:', error)
      return []
    }
  }

  /**
   * 获取所有凭证类型
   * @returns {Array<string>} 类型列表
   */
  getCredentialTypes() {
    const types = new Set()

    // 内置模板类型
    Object.values(BUILT_IN_TEMPLATES).forEach(template => {
      types.add(template.type)
    })

    return Array.from(types)
  }

  /**
   * 解析模板对象（处理JSON字段）
   * @param {Object} template - 原始模板对象
   * @returns {Object} 解析后的模板对象
   */
  parseTemplate(template) {
    return {
      ...template,
      fields: template.fields ? JSON.parse(template.fields) : [],
      isBuiltIn: false,
      is_public: Boolean(template.is_public),
      deleted: Boolean(template.deleted),
      rating: Number(template.rating || 0)
    }
  }

  /**
   * 清除缓存
   */
  invalidateCache() {
    this.statsCache = null
  }

  /**
   * 清除所有缓存
   */
  clearAllCache() {
    this.cache.clear()
    this.statsCache = null
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
 * 工厂函数：创建或获取VCTemplateManager实例（单例模式）
 */
let vcTemplateManagerInstance = null

export function createVCTemplateManager(db) {
  if (!vcTemplateManagerInstance) {
    vcTemplateManagerInstance = new VCTemplateManager(db)
  }
  return vcTemplateManagerInstance
}

export { BUILT_IN_TEMPLATES }
export default VCTemplateManager
