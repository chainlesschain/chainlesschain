const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * 项目模板管理器
 * 负责加载、管理和应用项目模板
 */
class ProjectTemplateManager {
  constructor(database) {
    this.db = database;
    this.templatesLoaded = false;
    this.handlebars = null;
  }

  /**
   * 初始化模板引擎
   */
  initializeTemplateEngine() {
    if (this.handlebars) return;

    const Handlebars = require('handlebars');
    this.handlebars = Handlebars;

    // 注册自定义 Handlebars helpers
    this.registerHelpers();
  }

  /**
   * 注册 Handlebars 辅助函数
   */
  registerHelpers() {
    // 日期格式化
    this.handlebars.registerHelper('formatDate', (date, format) => {
      if (!date) return '';
      const d = new Date(date);
      if (format === 'yyyy-MM-dd') {
        return d.toISOString().split('T')[0];
      } else if (format === 'yyyy年MM月dd日') {
        return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
      }
      return d.toLocaleDateString('zh-CN');
    });

    // 大写转换
    this.handlebars.registerHelper('uppercase', (str) => {
      return str ? str.toUpperCase() : '';
    });

    // 小写转换
    this.handlebars.registerHelper('lowercase', (str) => {
      return str ? str.toLowerCase() : '';
    });

    // 首字母大写
    this.handlebars.registerHelper('capitalize', (str) => {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    });

    // 条件判断 - 支持块级和内联使用
    this.handlebars.registerHelper('eq', function(a, b, options) {
      // 块级helper使用（{{#eq a b}}...{{/eq}}）
      if (options && options.fn) {
        return a === b ? options.fn(this) : options.inverse(this);
      }
      // 内联helper使用（{{eq a b}}）
      return a === b;
    });

    // 小于或等于 - 支持块级和内联使用
    this.handlebars.registerHelper('lte', function(a, b, options) {
      if (options && options.fn) {
        return a <= b ? options.fn(this) : options.inverse(this);
      }
      return a <= b;
    });

    // 大于或等于 - 支持块级和内联使用
    this.handlebars.registerHelper('gte', function(a, b, options) {
      if (options && options.fn) {
        return a >= b ? options.fn(this) : options.inverse(this);
      }
      return a >= b;
    });

    // 小于 - 支持块级和内联使用
    this.handlebars.registerHelper('lt', function(a, b, options) {
      if (options && options.fn) {
        return a < b ? options.fn(this) : options.inverse(this);
      }
      return a < b;
    });

    // 大于 - 支持块级和内联使用
    this.handlebars.registerHelper('gt', function(a, b, options) {
      if (options && options.fn) {
        return a > b ? options.fn(this) : options.inverse(this);
      }
      return a > b;
    });

    // 默认值
    this.handlebars.registerHelper('default', (value, defaultValue) => {
      return value || defaultValue;
    });

    // 数组长度
    this.handlebars.registerHelper('length', (arr) => {
      return Array.isArray(arr) ? arr.length : 0;
    });

    // 数组/对象查找 - 支持 lookup 语法访问数组元素
    this.handlebars.registerHelper('lookup', (obj, key) => {
      if (!obj) return undefined;
      return obj[key];
    });

    // 生成数字范围数组
    this.handlebars.registerHelper('range', (start, end) => {
      const result = [];
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
      return result;
    });

    // 加法
    this.handlebars.registerHelper('add', (a, b) => {
      return Number(a) + Number(b);
    });

    // 减法
    this.handlebars.registerHelper('subtract', (a, b) => {
      return Number(a) - Number(b);
    });
  }

  /**
   * 初始化：加载所有内置模板到数据库
   */
  async initialize() {
    if (this.templatesLoaded) {
      console.log('[TemplateManager] 模板已加载，跳过初始化');
      return;
    }

    this.initializeTemplateEngine();

    const templatesDir = path.join(__dirname, '../templates');
    const categories = [
      // 职业专用分类（优先加载）
      'medical',              // 医疗
      'legal',                // 法律
      'education',            // 教育
      'research',             // 研究
      // 原有分类
      'writing',
      'ppt',
      'excel',
      'web',
      'design',
      'podcast',
      'resume',
      'marketing',
      'lifestyle',
      // 新增分类（v0.19.0）
      'video',                // 视频内容
      'social-media',         // 社交媒体
      'creative-writing',     // 创意写作
      'code-project',         // 代码项目
      'data-science',         // 数据科学
      'tech-docs',            // 技术文档
      'ecommerce',            // 电商运营
      'marketing-pro',        // 营销推广
      'learning',             // 学习成长
      'health',               // 健康生活
      'time-management',      // 时间管理
      // 新增分类（v0.20.0）
      'productivity',         // 效率工具
      'finance',              // 财务管理
      'photography',          // 摄影
      'music',                // 音乐创作
      'gaming',               // 游戏设计
      'travel',               // 旅行规划
      'cooking',              // 烹饪美食
      'career'                // 职业发展
    ];

    let loadedCount = 0;

    for (const category of categories) {
      const categoryPath = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryPath);

        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const templateData = JSON.parse(
                await fs.readFile(path.join(categoryPath, file), 'utf8')
              );

              await this.saveTemplate(templateData);
              loadedCount++;
            } catch (err) {
              console.error(`[TemplateManager] 加载模板失败 ${category}/${file}:`, err.message);
            }
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`[TemplateManager] 读取${category}目录失败:`, err.message);
        }
      }
    }

    this.templatesLoaded = true;
    console.log(`[TemplateManager] ✓ 成功加载 ${loadedCount} 个项目模板`);
  }

  /**
   * 保存模板到数据库
   */
  async saveTemplate(templateData) {
    const now = Date.now();

    try {
      // 验证必需字段
      if (!templateData.id) {
        throw new Error('模板缺少ID');
      }
      if (!templateData.name) {
        throw new Error(`模板 ${templateData.id} 缺少name字段`);
      }
      if (!templateData.display_name) {
        throw new Error(`模板 ${templateData.id} 缺少display_name字段`);
      }
      if (!templateData.prompt_template || templateData.prompt_template.trim() === '') {
        console.warn(`[TemplateManager] 警告: 模板 ${templateData.id} (${templateData.display_name}) 缺少prompt_template字段`);
        // 不抛出错误，但记录警告
      }

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO project_templates (
          id, name, display_name, description, icon, cover_image,
          category, subcategory, tags,
          project_type, prompt_template, variables_schema, file_structure, default_files,
          is_builtin, author, version, usage_count, rating, rating_count,
          created_at, updated_at, sync_status, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const promptTemplate = templateData.prompt_template || '';

      // 调试日志：记录写入前的 prompt_template 长度
      console.log(`[TemplateManager] 准备保存模板 ${templateData.id}:`);
      console.log(`  - display_name: ${templateData.display_name}`);
      console.log(`  - prompt_template 长度: ${promptTemplate.length}`);

      stmt.run([
        templateData.id,
        templateData.name,
        templateData.display_name,
        templateData.description || '',
        templateData.icon || '',
        templateData.cover_image || '',
        templateData.category,
        templateData.subcategory || '',
        JSON.stringify(templateData.tags || []),
        templateData.project_type,
        promptTemplate,
        JSON.stringify(templateData.variables_schema || []),
        JSON.stringify(templateData.file_structure || {}),
        JSON.stringify(templateData.default_files || []),
        templateData.is_builtin ? 1 : 0,
        templateData.author || '',
        templateData.version || '1.0.0',
        templateData.usage_count || 0,
        templateData.rating || 0,
        templateData.rating_count || 0,
        templateData.created_at || now,
        now,
        'synced',
        0
      ]);

      this.db.saveToFile();

      // 调试日志：验证写入后的数据
      const verify = this.db.prepare('SELECT id, LENGTH(prompt_template) as len FROM project_templates WHERE id = ?').get([templateData.id]);
      console.log(`[TemplateManager] 写入后验证: ${verify.id}, prompt_template长度=${verify.len}`);
    } catch (error) {
      console.error('[TemplateManager] 保存模板失败:', templateData.id, error);
      throw error;
    }
  }

  /**
   * 获取所有模板
   */
  async getAllTemplates(filters = {}) {
    if (!this.db) {
      console.error('[ProjectTemplateManager] 数据库未初始化');
      return [];
    }

    let query = 'SELECT * FROM project_templates WHERE deleted = 0';
    const params = [];

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.subcategory) {
      query += ' AND subcategory = ?';
      params.push(filters.subcategory);
    }

    if (filters.projectType) {
      query += ' AND project_type = ?';
      params.push(filters.projectType);
    }

    if (filters.isBuiltin !== undefined) {
      query += ' AND is_builtin = ?';
      params.push(filters.isBuiltin ? 1 : 0);
    }

    // 排序：优先显示高使用量和高评分的模板
    query += ' ORDER BY usage_count DESC, rating DESC, created_at DESC';

    const stmt = this.db.prepare(query);
    const templates = stmt.all(params);

    return templates.map(t => this.parseTemplateData(t));
  }

  /**
   * 根据ID获取模板
   */
  async getTemplateById(templateId) {
    const stmt = this.db.prepare(`
      SELECT * FROM project_templates WHERE id = ? AND deleted = 0
    `);
    const template = stmt.get([templateId]);

    if (!template) {
      throw new Error(`模板不存在: ${templateId}`);
    }

    return this.parseTemplateData(template);
  }

  /**
   * 解析模板数据（JSON字段转换）
   */
  parseTemplateData(template) {
    return {
      ...template,
      tags: JSON.parse(template.tags || '[]'),
      variables_schema: JSON.parse(template.variables_schema || '[]'),
      file_structure: JSON.parse(template.file_structure || '{}'),
      default_files: JSON.parse(template.default_files || '[]'),
      is_builtin: template.is_builtin === 1
    };
  }

  /**
   * 验证模板变量
   */
  validateVariables(variablesSchema, userVariables) {
    const errors = [];

    if (!Array.isArray(variablesSchema)) {
      return { valid: true, errors: [] };
    }

    for (const varDef of variablesSchema) {
      const { name, label, type, required, pattern, min, max, options } = varDef;
      const value = userVariables[name];

      // 检查必填项
      if (required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: name,
          message: `${label || name} 为必填项`
        });
        continue;
      }

      // 如果值为空且非必填，跳过其他验证
      if (!value && !required) {
        continue;
      }

      // 类型验证
      if (type === 'number' && typeof value !== 'number') {
        errors.push({
          field: name,
          message: `${label || name} 必须是数字`
        });
        continue;
      }

      // 数值范围验证
      if (type === 'number') {
        if (min !== undefined && value < min) {
          errors.push({
            field: name,
            message: `${label || name} 不能小于 ${min}`
          });
        }
        if (max !== undefined && value > max) {
          errors.push({
            field: name,
            message: `${label || name} 不能大于 ${max}`
          });
        }
      }

      // 正则表达式验证
      if (pattern && typeof value === 'string') {
        const regex = new RegExp(pattern);
        if (!regex.test(value)) {
          errors.push({
            field: name,
            message: `${label || name} 格式不正确`
          });
        }
      }

      // 选项验证
      if (type === 'select' && options && Array.isArray(options)) {
        const validValues = options.map(opt => opt.value);
        const validLabels = options.map(opt => opt.label);

        // 允许匹配 value 或 label（更灵活的验证）
        const isValidValue = validValues.includes(value);
        const isValidLabel = validLabels.includes(value);

        if (!isValidValue && !isValidLabel) {
          errors.push({
            field: name,
            message: `${label || name} 必须是以下选项之一: ${validValues.join(', ')}`
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 渲染模板提示词
   */
  renderPrompt(template, userVariables) {
    this.initializeTemplateEngine();

    try {
      // 检查模板是否有效
      if (!template) {
        throw new Error('模板对象不能为空');
      }

      // 检查 prompt_template 是否存在（注意：空字符串也视为无效）
      if (!template.prompt_template || typeof template.prompt_template !== 'string' || template.prompt_template.trim() === '') {
        console.error('[TemplateManager] 模板数据不完整:', {
          id: template.id,
          name: template.name,
          display_name: template.display_name,
          prompt_template_exists: !!template.prompt_template,
          prompt_template_type: typeof template.prompt_template,
          prompt_template_length: template.prompt_template ? template.prompt_template.length : 0,
          all_keys: Object.keys(template)
        });
        throw new Error(`模板 "${template.display_name || template.name || template.id}" 缺少有效的 prompt_template 字段`);
      }

      // 验证变量
      const validation = this.validateVariables(template.variables_schema, userVariables);
      if (!validation.valid) {
        throw new Error(`变量验证失败: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // 合并默认值
      const variables = { ...userVariables };
      if (Array.isArray(template.variables_schema)) {
        for (const varDef of template.variables_schema) {
          if (variables[varDef.name] === undefined && varDef.default !== undefined) {
            variables[varDef.name] = varDef.default;
          }
        }
      }

      // 添加系统变量
      variables.createdAt = Date.now();
      variables.currentDate = new Date().toLocaleDateString('zh-CN');
      variables.currentYear = new Date().getFullYear();

      // 渲染模板
      const compiledTemplate = this.handlebars.compile(template.prompt_template);
      return compiledTemplate(variables);
    } catch (error) {
      console.error('[TemplateManager] 渲染模板失败:', error);
      throw new Error(`模板渲染失败: ${error.message}`);
    }
  }

  /**
   * 记录模板使用
   */
  async recordTemplateUsage(templateId, userId, projectId, variablesUsed = {}) {
    const now = Date.now();

    try {
      // 记录使用历史
      const historyStmt = this.db.prepare(`
        INSERT INTO template_usage_history (id, template_id, user_id, project_id, variables_used, used_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      historyStmt.run([
        uuidv4(),
        templateId,
        userId,
        projectId,
        JSON.stringify(variablesUsed),
        now
      ]);

      // 增加使用计数
      const updateStmt = this.db.prepare(`
        UPDATE project_templates
        SET usage_count = usage_count + 1, updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run([now, templateId]);

      this.db.saveToFile();
    } catch (error) {
      console.error('[TemplateManager] 记录模板使用失败:', error);
    }
  }

  /**
   * 搜索模板
   */
  async searchTemplates(keyword, filters = {}) {
    if (!keyword || keyword.trim() === '') {
      return this.getAllTemplates(filters);
    }

    let query = `
      SELECT * FROM project_templates
      WHERE deleted = 0
      AND (display_name LIKE ? OR description LIKE ? OR tags LIKE ?)
    `;
    const params = [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`];

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.projectType) {
      query += ' AND project_type = ?';
      params.push(filters.projectType);
    }

    query += ' ORDER BY usage_count DESC, rating DESC LIMIT 50';

    const stmt = this.db.prepare(query);
    const templates = stmt.all(params);

    return templates.map(t => this.parseTemplateData(t));
  }

  /**
   * 提交模板评价
   */
  async rateTemplate(templateId, userId, rating, review = '') {
    if (rating < 1 || rating > 5) {
      throw new Error('评分必须在1-5之间');
    }

    const now = Date.now();

    try {
      // 保存或更新评价
      const ratingStmt = this.db.prepare(`
        INSERT OR REPLACE INTO template_ratings (id, template_id, user_id, rating, review, created_at, updated_at)
        VALUES (
          COALESCE((SELECT id FROM template_ratings WHERE template_id = ? AND user_id = ?), ?),
          ?, ?, ?, ?, ?, ?
        )
      `);
      ratingStmt.run([
        templateId, userId, uuidv4(),
        templateId, userId, rating, review, now, now
      ]);

      // 重新计算模板平均评分
      const avgStmt = this.db.prepare(`
        SELECT AVG(rating) as avg_rating, COUNT(*) as count
        FROM template_ratings
        WHERE template_id = ?
      `);
      const result = avgStmt.get([templateId]);

      // 更新模板评分
      const updateStmt = this.db.prepare(`
        UPDATE project_templates
        SET rating = ?, rating_count = ?, updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run([
        result.avg_rating || 0,
        result.count || 0,
        now,
        templateId
      ]);

      this.db.saveToFile();
    } catch (error) {
      console.error('[TemplateManager] 提交评价失败:', error);
      throw new Error(`提交评价失败: ${error.message}`);
    }
  }

  /**
   * 获取模板统计信息
   */
  async getTemplateStats() {
    const totalStmt = this.db.prepare(`
      SELECT COUNT(*) as total FROM project_templates WHERE deleted = 0
    `);
    const builtinStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0 AND is_builtin = 1
    `);
    const customStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0 AND is_builtin = 0
    `);
    const categoriesStmt = this.db.prepare(`
      SELECT category, COUNT(*) as count
      FROM project_templates
      WHERE deleted = 0
      GROUP BY category
    `);

    return {
      total: totalStmt.get().total,
      builtin: builtinStmt.get().count,
      custom: customStmt.get().count,
      byCategory: categoriesStmt.all()
    };
  }

  /**
   * 创建新模板
   */
  async createTemplate(templateData) {
    const now = Date.now();
    const templateId = uuidv4();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO project_templates (
          id, name, display_name, description, icon, cover_image,
          category, subcategory, tags,
          project_type, prompt_template, variables_schema, file_structure, default_files,
          is_builtin, author, version, usage_count, rating, rating_count,
          created_at, updated_at, sync_status, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        templateId,
        templateData.name,
        templateData.display_name,
        templateData.description || '',
        templateData.icon || '',
        templateData.cover_image || '',
        templateData.category,
        templateData.subcategory || '',
        JSON.stringify(templateData.tags || []),
        templateData.project_type,
        templateData.prompt_template || '',
        JSON.stringify(templateData.variables_schema || []),
        JSON.stringify(templateData.file_structure || {}),
        JSON.stringify(templateData.default_files || []),
        0, // 用户创建的模板不是内置模板
        templateData.author || '',
        templateData.version || '1.0.0',
        0, // 初始使用次数为0
        0, // 初始评分为0
        0, // 初始评分数为0
        now,
        now,
        'pending',
        0
      ]);

      this.db.saveToFile();

      return {
        id: templateId,
        ...templateData,
        created_at: now,
        updated_at: now
      };
    } catch (error) {
      console.error('[TemplateManager] 创建模板失败:', error);
      throw error;
    }
  }

  /**
   * 更新模板
   */
  async updateTemplate(templateId, updates) {
    const now = Date.now();

    try {
      // 首先检查模板是否存在
      const existing = await this.getTemplateById(templateId);
      if (!existing) {
        throw new Error(`模板不存在: ${templateId}`);
      }

      // 构建更新语句
      const fields = [];
      const values = [];

      if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
      }
      if (updates.display_name !== undefined) {
        fields.push('display_name = ?');
        values.push(updates.display_name);
      }
      if (updates.description !== undefined) {
        fields.push('description = ?');
        values.push(updates.description);
      }
      if (updates.icon !== undefined) {
        fields.push('icon = ?');
        values.push(updates.icon);
      }
      if (updates.cover_image !== undefined) {
        fields.push('cover_image = ?');
        values.push(updates.cover_image);
      }
      if (updates.category !== undefined) {
        fields.push('category = ?');
        values.push(updates.category);
      }
      if (updates.subcategory !== undefined) {
        fields.push('subcategory = ?');
        values.push(updates.subcategory);
      }
      if (updates.tags !== undefined) {
        fields.push('tags = ?');
        values.push(JSON.stringify(updates.tags));
      }
      if (updates.project_type !== undefined) {
        fields.push('project_type = ?');
        values.push(updates.project_type);
      }
      if (updates.prompt_template !== undefined) {
        fields.push('prompt_template = ?');
        values.push(updates.prompt_template);
      }
      if (updates.variables_schema !== undefined) {
        fields.push('variables_schema = ?');
        values.push(JSON.stringify(updates.variables_schema));
      }
      if (updates.file_structure !== undefined) {
        fields.push('file_structure = ?');
        values.push(JSON.stringify(updates.file_structure));
      }
      if (updates.default_files !== undefined) {
        fields.push('default_files = ?');
        values.push(JSON.stringify(updates.default_files));
      }
      if (updates.author !== undefined) {
        fields.push('author = ?');
        values.push(updates.author);
      }
      if (updates.version !== undefined) {
        fields.push('version = ?');
        values.push(updates.version);
      }

      // 总是更新 updated_at
      fields.push('updated_at = ?');
      values.push(now);

      // 添加 WHERE 条件的参数
      values.push(templateId);

      const stmt = this.db.prepare(`
        UPDATE project_templates
        SET ${fields.join(', ')}
        WHERE id = ?
      `);

      stmt.run(values);
      this.db.saveToFile();

      // 返回更新后的模板
      return await this.getTemplateById(templateId);
    } catch (error) {
      console.error('[TemplateManager] 更新模板失败:', error);
      throw error;
    }
  }

  /**
   * 删除模板（软删除）
   */
  async deleteTemplate(templateId) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE project_templates
      SET deleted = 1, updated_at = ?
      WHERE id = ?
    `);
    stmt.run([now, templateId]);
    this.db.saveToFile();
  }

  /**
   * 获取用户最近使用的模板
   */
  async getRecentTemplates(userId, limit = 10) {
    const stmt = this.db.prepare(`
      SELECT DISTINCT t.*
      FROM project_templates t
      INNER JOIN template_usage_history h ON t.id = h.template_id
      WHERE h.user_id = ? AND t.deleted = 0
      ORDER BY h.used_at DESC
      LIMIT ?
    `);
    const templates = stmt.all([userId, limit]);
    return templates.map(t => this.parseTemplateData(t));
  }

  /**
   * 获取热门模板
   */
  async getPopularTemplates(limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM project_templates
      WHERE deleted = 0
      ORDER BY usage_count DESC, rating DESC
      LIMIT ?
    `);
    const templates = stmt.all([limit]);
    return templates.map(t => this.parseTemplateData(t));
  }

  /**
   * 智能推荐模板
   * 基于用户输入、项目类型和历史使用情况推荐合适的模板
   */
  async recommendTemplates(userInput, projectType, userId, options = {}) {
    const { limit = 10, includeReasons = true } = options;

    try {
      // 1. 基础过滤：按项目类型筛选
      let candidates = [];
      if (projectType && projectType !== 'general') {
        candidates = await this.getAllTemplates({ projectType });
      } else {
        candidates = await this.getAllTemplates();
      }

      if (candidates.length === 0) {
        console.log('[TemplateManager] 没有找到符合条件的模板');
        return [];
      }

      // 2. 提取用户输入的关键词
      const keywords = this.extractKeywords(userInput);
      console.log('[TemplateManager] 提取的关键词:', keywords);

      // 3. 计算每个模板的相关性分数
      const scoredTemplates = candidates.map(template => {
        let score = 0;
        const reasons = [];

        // 3.1 关键词匹配（权重：40%）
        const keywordScore = this.calculateKeywordScore(template, keywords);
        score += keywordScore * 0.4;
        if (keywordScore > 0) {
          reasons.push(`关键词匹配 (${(keywordScore * 100).toFixed(0)}%)`);
        }

        // 3.2 使用频率（权重：20%）
        const usageScore = Math.min(template.usage_count / 100, 1);
        score += usageScore * 0.2;
        if (template.usage_count > 0) {
          reasons.push(`使用次数: ${template.usage_count}`);
        }

        // 3.3 评分（权重：20%）
        const ratingScore = template.rating / 5;
        score += ratingScore * 0.2;
        if (template.rating > 0) {
          reasons.push(`评分: ${template.rating.toFixed(1)}/5.0`);
        }

        // 3.4 项目类型完全匹配（权重：20%）
        if (template.project_type === projectType) {
          score += 0.2;
          reasons.push('项目类型匹配');
        }

        return {
          ...template,
          score,
          matchReasons: includeReasons ? reasons : undefined
        };
      });

      // 4. 排序并返回top N
      const recommended = scoredTemplates
        .filter(t => t.score > 0.1) // 过滤掉分数太低的
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      console.log(`[TemplateManager] 推荐了 ${recommended.length} 个模板，总候选: ${candidates.length}`);

      return recommended;
    } catch (error) {
      console.error('[TemplateManager] 推荐模板失败:', error);
      return [];
    }
  }

  /**
   * 提取关键词
   */
  extractKeywords(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // 简单的中文分词（基于常见词汇）
    const commonKeywords = [
      // 技术相关
      '网站', '应用', 'app', 'web', '博客', 'blog', '前端', '后端', '全栈',
      '待办', 'todo', '任务', 'task', '管理', '系统',
      '数据', '分析', '报告', '可视化', '图表', 'dashboard',
      '社交', '聊天', '论坛', '评论',
      // 文档相关
      '文章', '写作', '笔记', '文档', 'markdown', 'md',
      '简历', 'resume', '个人', '介绍',
      'ppt', '演示', '幻灯片', 'presentation',
      'excel', '表格', '数据表',
      // 创意相关
      '设计', 'design', 'ui', 'ux',
      '视频', 'video', '剪辑',
      '音频', 'podcast', '播客',
      // 业务相关
      '营销', '推广', '运营', '电商', 'ecommerce',
      '教育', '学习', '课程', '培训',
      '健康', '健身', '食谱', '烹饪',
      '旅行', '旅游', '规划'
    ];

    const keywords = [];
    const lowerText = text.toLowerCase();

    for (const keyword of commonKeywords) {
      if (lowerText.includes(keyword)) {
        keywords.push(keyword);
      }
    }

    return [...new Set(keywords)]; // 去重
  }

  /**
   * 计算关键词匹配分数
   */
  calculateKeywordScore(template, keywords) {
    if (keywords.length === 0) {
      return 0;
    }

    let matches = 0;
    const searchText = `${template.display_name} ${template.description} ${template.tags.join(' ')}`.toLowerCase();

    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        matches++;
      }
    }

    return matches / keywords.length;
  }
}

module.exports = ProjectTemplateManager;
