/**
 * 工具管理器 (ToolManager)
 * 负责工具的注册、管理、统计和与FunctionCaller的集成
 */

const { v4: uuidv4 } = require('uuid');
const DocGenerator = require('./doc-generator');

class ToolManager {
  constructor(database, functionCaller) {
    this.db = database;
    this.functionCaller = functionCaller;

    // 工具元数据缓存
    this.tools = new Map(); // toolId -> toolMeta

    // 文档生成器（与SkillManager共享）
    this.docGenerator = new DocGenerator();

    this.isInitialized = false;
  }

  /**
   * 初始化工具管理器
   */
  async initialize() {
    try {
      console.log('[ToolManager] 初始化工具管理器...');

      // 1. 初始化文档生成器
      await this.docGenerator.initialize();

      // 2. 加载内置工具
      await this.loadBuiltInTools();

      // 3. 加载插件提供的工具
      await this.loadPluginTools();

      // 4. 生成所有工具的文档
      await this.generateAllDocs();

      this.isInitialized = true;
      console.log(`[ToolManager] 初始化完成，共加载 ${this.tools.size} 个工具`);

      return true;
    } catch (error) {
      console.error('[ToolManager] 初始化失败:', error);
      throw error;
    }
  }

  // ===================================
  // CRUD 操作
  // ===================================

  /**
   * 注册工具
   * @param {Object} toolData - 工具元数据
   * @param {Function} handler - 工具处理函数
   * @returns {Promise<string>} 工具ID
   */
  async registerTool(toolData, handler) {
    try {
      const now = Date.now();
      const toolId = toolData.id || `tool_${uuidv4()}`;

      // 1. 验证参数schema
      if (toolData.parameters_schema) {
        this.validateParametersSchema(toolData.parameters_schema);
      }

      // 2. 准备数据库记录
      const toolRecord = {
        id: toolId,
        name: toolData.name,
        display_name: toolData.display_name || toolData.name,
        description: toolData.description || '',
        tool_type: toolData.tool_type || 'function',
        category: toolData.category || 'general',
        parameters_schema: typeof toolData.parameters_schema === 'string'
          ? toolData.parameters_schema
          : JSON.stringify(toolData.parameters_schema || {}),
        return_schema: typeof toolData.return_schema === 'string'
          ? toolData.return_schema
          : JSON.stringify(toolData.return_schema || {}),
        is_builtin: toolData.is_builtin || 0,
        plugin_id: toolData.plugin_id || null,
        handler_path: toolData.handler_path || null,
        enabled: toolData.enabled !== undefined ? toolData.enabled : 1,
        deprecated: toolData.deprecated || 0,
        config: typeof toolData.config === 'string'
          ? toolData.config
          : JSON.stringify(toolData.config || {}),
        examples: typeof toolData.examples === 'string'
          ? toolData.examples
          : JSON.stringify(toolData.examples || []),
        doc_path: toolData.doc_path || null,
        required_permissions: typeof toolData.required_permissions === 'string'
          ? toolData.required_permissions
          : JSON.stringify(toolData.required_permissions || []),
        risk_level: toolData.risk_level || 1,
        usage_count: 0,
        success_count: 0,
        avg_execution_time: 0,
        last_used_at: null,
        created_at: now,
        updated_at: now,
      };

      // 3. 保存到数据库
      const sql = `
        INSERT INTO tools (
          id, name, display_name, description, tool_type, category,
          parameters_schema, return_schema, is_builtin, plugin_id,
          handler_path, enabled, deprecated, config, examples,
          doc_path, required_permissions, risk_level, usage_count,
          success_count, avg_execution_time, last_used_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          parameters_schema = excluded.parameters_schema,
          config = excluded.config,
          updated_at = excluded.updated_at
      `;

      await this.db.run(sql, [
        toolRecord.id, toolRecord.name, toolRecord.display_name,
        toolRecord.description, toolRecord.tool_type, toolRecord.category,
        toolRecord.parameters_schema, toolRecord.return_schema,
        toolRecord.is_builtin, toolRecord.plugin_id, toolRecord.handler_path,
        toolRecord.enabled, toolRecord.deprecated, toolRecord.config,
        toolRecord.examples, toolRecord.doc_path, toolRecord.required_permissions,
        toolRecord.risk_level, toolRecord.usage_count, toolRecord.success_count,
        toolRecord.avg_execution_time, toolRecord.last_used_at,
        toolRecord.created_at, toolRecord.updated_at,
      ]);

      // 4. 注册到FunctionCaller
      if (handler && this.functionCaller) {
        const schema = {
          name: toolRecord.name,
          description: toolRecord.description,
          parameters: JSON.parse(toolRecord.parameters_schema),
        };
        this.functionCaller.registerTool(toolRecord.name, handler, schema);
      }

      // 5. 缓存工具元数据
      this.tools.set(toolId, {
        ...toolRecord,
        handler,
      });

      console.log(`[ToolManager] 工具注册成功: ${toolRecord.name} (${toolId})`);

      return toolId;
    } catch (error) {
      console.error('[ToolManager] 注册工具失败:', error);
      throw error;
    }
  }

  /**
   * 注销工具
   * @param {string} toolId - 工具ID
   */
  async unregisterTool(toolId) {
    try {
      const tool = await this.getTool(toolId);
      if (!tool) {
        throw new Error(`工具不存在: ${toolId}`);
      }

      // 1. 从FunctionCaller注销
      if (this.functionCaller && this.functionCaller.hasTool(tool.name)) {
        this.functionCaller.unregisterTool(tool.name);
      }

      // 2. 从数据库删除
      await this.db.run('DELETE FROM tools WHERE id = ?', [toolId]);

      // 3. 从缓存中移除
      this.tools.delete(toolId);

      console.log(`[ToolManager] 工具注销成功: ${tool.name}`);
    } catch (error) {
      console.error('[ToolManager] 注销工具失败:', error);
      throw error;
    }
  }

  /**
   * 更新工具
   * @param {string} toolId - 工具ID
   * @param {Object} updates - 更新的字段
   */
  async updateTool(toolId, updates) {
    try {
      const tool = await this.getTool(toolId);
      if (!tool) {
        throw new Error(`工具不存在: ${toolId}`);
      }

      const allowedFields = [
        'display_name', 'description', 'parameters_schema', 'return_schema',
        'config', 'examples', 'doc_path', 'enabled', 'deprecated',
        'required_permissions', 'risk_level',
      ];

      const updatePairs = [];
      const updateValues = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updatePairs.push(`${key} = ?`);

          // 处理JSON字段
          if (['parameters_schema', 'return_schema', 'config', 'examples', 'required_permissions'].includes(key)) {
            updateValues.push(typeof value === 'string' ? value : JSON.stringify(value));
          } else {
            updateValues.push(value);
          }
        }
      }

      if (updatePairs.length === 0) {
        return;
      }

      updatePairs.push('updated_at = ?');
      updateValues.push(Date.now());
      updateValues.push(toolId);

      const sql = `UPDATE tools SET ${updatePairs.join(', ')} WHERE id = ?`;
      await this.db.run(sql, updateValues);

      // 更新缓存
      const updatedTool = await this.getTool(toolId);
      this.tools.set(toolId, updatedTool);

      console.log(`[ToolManager] 工具更新成功: ${tool.name}`);
    } catch (error) {
      console.error('[ToolManager] 更新工具失败:', error);
      throw error;
    }
  }

  /**
   * 获取工具
   * @param {string} toolId - 工具ID
   * @returns {Promise<Object|null>} 工具对象
   */
  async getTool(toolId) {
    try {
      // 先查缓存
      if (this.tools.has(toolId)) {
        return this.tools.get(toolId);
      }

      // 查数据库
      const tool = await this.db.get('SELECT * FROM tools WHERE id = ?', [toolId]);
      if (tool) {
        this.tools.set(toolId, tool);
      }
      return tool;
    } catch (error) {
      console.error('[ToolManager] 获取工具失败:', error);
      return null;
    }
  }

  /**
   * 根据名称获取工具
   * @param {string} name - 工具名称
   * @returns {Promise<Object|null>} 工具对象
   */
  async getToolByName(name) {
    try {
      const tool = await this.db.get('SELECT * FROM tools WHERE name = ?', [name]);
      return tool;
    } catch (error) {
      console.error('[ToolManager] 获取工具失败:', error);
      return null;
    }
  }

  // ===================================
  // 查询操作
  // ===================================

  /**
   * 获取所有工具
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 工具列表
   */
  async getAllTools(options = {}) {
    try {
      const {
        enabled = null,
        category = null,
        plugin_id = null,
        is_builtin = null,
        deprecated = null,
        limit = null,
        offset = 0,
      } = options;

      let sql = 'SELECT * FROM tools WHERE 1=1';
      const params = [];

      if (enabled !== null) {
        sql += ' AND enabled = ?';
        params.push(enabled);
      }

      if (category !== null) {
        sql += ' AND category = ?';
        params.push(category);
      }

      if (plugin_id !== null) {
        sql += ' AND plugin_id = ?';
        params.push(plugin_id);
      }

      if (is_builtin !== null) {
        sql += ' AND is_builtin = ?';
        params.push(is_builtin);
      }

      if (deprecated !== null) {
        sql += ' AND deprecated = ?';
        params.push(deprecated);
      }

      sql += ' ORDER BY usage_count DESC';

      if (limit !== null) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
      }

      const tools = await this.db.all(sql, params);
      return tools;
    } catch (error) {
      console.error('[ToolManager] 获取工具列表失败:', error);
      return [];
    }
  }

  /**
   * 根据分类获取工具
   * @param {string} category - 分类
   * @returns {Promise<Array>} 工具列表
   */
  async getToolsByCategory(category) {
    return this.getAllTools({ category });
  }

  /**
   * 根据技能获取工具
   * @param {string} skillId - 技能ID
   * @returns {Promise<Array>} 工具列表
   */
  async getToolsBySkill(skillId) {
    try {
      const sql = `
        SELECT t.* FROM tools t
        INNER JOIN skill_tools st ON t.id = st.tool_id
        WHERE st.skill_id = ?
        ORDER BY st.priority DESC
      `;
      const tools = await this.db.all(sql, [skillId]);
      return tools;
    } catch (error) {
      console.error('[ToolManager] 获取技能工具失败:', error);
      return [];
    }
  }

  /**
   * 获取启用的工具
   * @returns {Promise<Array>} 工具列表
   */
  async getEnabledTools() {
    return this.getAllTools({ enabled: 1, deprecated: 0 });
  }

  // ===================================
  // 状态管理
  // ===================================

  /**
   * 启用工具
   * @param {string} toolId - 工具ID
   */
  async enableTool(toolId) {
    await this.updateTool(toolId, { enabled: 1 });
    console.log(`[ToolManager] 工具已启用: ${toolId}`);
  }

  /**
   * 禁用工具
   * @param {string} toolId - 工具ID
   */
  async disableTool(toolId) {
    await this.updateTool(toolId, { enabled: 0 });
    console.log(`[ToolManager] 工具已禁用: ${toolId}`);
  }

  // ===================================
  // 统计功能
  // ===================================

  /**
   * 记录工具使用情况
   * @param {string} toolName - 工具名称（FunctionCaller中的key）
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(ms)
   * @param {string} errorType - 错误类型
   */
  async recordToolUsage(toolName, success, duration, errorType = null) {
    try {
      // 1. 更新工具表的统计字段
      const tool = await this.getToolByName(toolName);
      if (!tool) {
        console.warn(`[ToolManager] 工具不存在，跳过统计: ${toolName}`);
        return;
      }

      const newUsageCount = tool.usage_count + 1;
      const newSuccessCount = success ? tool.success_count + 1 : tool.success_count;
      const newAvgTime = ((tool.avg_execution_time * tool.usage_count) + duration) / newUsageCount;

      await this.db.run(`
        UPDATE tools
        SET usage_count = ?,
            success_count = ?,
            avg_execution_time = ?,
            last_used_at = ?
        WHERE id = ?
      `, [newUsageCount, newSuccessCount, newAvgTime, Date.now(), tool.id]);

      // 2. 更新每日统计表
      await this.updateDailyStats(tool.id, success, duration, errorType);

    } catch (error) {
      console.error('[ToolManager] 记录工具使用失败:', error);
    }
  }

  /**
   * 更新每日统计
   * @param {string} toolId - 工具ID
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(ms)
   * @param {string} errorType - 错误类型
   */
  async updateDailyStats(toolId, success, duration, errorType) {
    try {
      const statDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const now = Date.now();

      // 查询今日统计
      const stat = await this.db.get(
        'SELECT * FROM tool_stats WHERE tool_id = ? AND stat_date = ?',
        [toolId, statDate]
      );

      if (stat) {
        // 更新现有统计
        const newInvokeCount = stat.invoke_count + 1;
        const newSuccessCount = success ? stat.success_count + 1 : stat.success_count;
        const newFailureCount = success ? stat.failure_count : stat.failure_count + 1;
        const newTotalDuration = stat.total_duration + duration;
        const newAvgDuration = newTotalDuration / newInvokeCount;

        // 更新错误类型统计
        let errorTypes = {};
        try {
          errorTypes = stat.error_types ? JSON.parse(stat.error_types) : {};
        } catch (e) {
          errorTypes = {};
        }

        if (!success && errorType) {
          errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
        }

        await this.db.run(`
          UPDATE tool_stats
          SET invoke_count = ?,
              success_count = ?,
              failure_count = ?,
              avg_duration = ?,
              total_duration = ?,
              error_types = ?,
              updated_at = ?
          WHERE id = ?
        `, [
          newInvokeCount, newSuccessCount, newFailureCount,
          newAvgDuration, newTotalDuration, JSON.stringify(errorTypes),
          now, stat.id
        ]);
      } else {
        // 创建新统计
        const errorTypes = {};
        if (!success && errorType) {
          errorTypes[errorType] = 1;
        }

        await this.db.run(`
          INSERT INTO tool_stats (
            id, tool_id, stat_date, invoke_count, success_count,
            failure_count, avg_duration, total_duration, error_types,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          `stat_${uuidv4()}`, toolId, statDate, 1,
          success ? 1 : 0, success ? 0 : 1,
          duration, duration, JSON.stringify(errorTypes),
          now, now
        ]);
      }
    } catch (error) {
      console.error('[ToolManager] 更新每日统计失败:', error);
    }
  }

  /**
   * 获取工具统计
   * @param {string} toolId - 工具ID
   * @param {Object} dateRange - 日期范围 {start, end}
   * @returns {Promise<Array>} 统计数据
   */
  async getToolStats(toolId, dateRange = null) {
    try {
      let sql = 'SELECT * FROM tool_stats WHERE tool_id = ?';
      const params = [toolId];

      if (dateRange) {
        sql += ' AND stat_date >= ? AND stat_date <= ?';
        params.push(dateRange.start, dateRange.end);
      }

      sql += ' ORDER BY stat_date DESC';

      const stats = await this.db.all(sql, params);
      return stats;
    } catch (error) {
      console.error('[ToolManager] 获取工具统计失败:', error);
      return [];
    }
  }

  // ===================================
  // Schema验证
  // ===================================

  /**
   * 验证参数Schema
   * @param {Object|string} schema - JSON Schema
   */
  validateParametersSchema(schema) {
    try {
      const schemaObj = typeof schema === 'string' ? JSON.parse(schema) : schema;

      // 基本验证：确保是对象
      if (typeof schemaObj !== 'object' || schemaObj === null) {
        throw new Error('参数schema必须是对象');
      }

      // 这里可以使用 ajv 库进行更严格的JSON Schema验证
      // 目前简化处理
      return true;
    } catch (error) {
      console.error('[ToolManager] Schema验证失败:', error);
      throw error;
    }
  }

  // ===================================
  // 文档管理
  // ===================================

  /**
   * 获取工具文档路径
   * @param {string} toolId - 工具ID
   * @returns {Promise<string|null>} 文档路径
   */
  async getToolDoc(toolId) {
    const tool = await this.getTool(toolId);
    return tool ? tool.doc_path : null;
  }

  // ===================================
  // 内置工具加载
  // ===================================

  /**
   * 加载内置工具
   * 将FunctionCaller中现有的工具注册到数据库
   */
  async loadBuiltInTools() {
    try {
      console.log('[ToolManager] 加载内置工具...');

      if (!this.functionCaller) {
        console.warn('[ToolManager] FunctionCaller未设置，跳过内置工具加载');
        return;
      }

      // 获取FunctionCaller中的所有工具
      const availableTools = this.functionCaller.getAvailableTools();

      for (const toolSchema of availableTools) {
        // 检查是否已存在
        const existing = await this.getToolByName(toolSchema.name);
        if (existing) {
          console.log(`[ToolManager] 工具已存在，跳过: ${toolSchema.name}`);
          continue;
        }

        // 注册到数据库（不重复注册到FunctionCaller）
        const toolId = `builtin_${toolSchema.name}`;
        const toolData = {
          id: toolId,
          name: toolSchema.name,
          display_name: toolSchema.name,
          description: toolSchema.description || '',
          category: this.inferCategory(toolSchema.name),
          parameters_schema: toolSchema.parameters,
          is_builtin: 1,
          enabled: 1,
        };

        // 直接插入数据库，不调用registerTool避免重复注册到FunctionCaller
        await this.db.run(`
          INSERT OR IGNORE INTO tools (
            id, name, display_name, description, category,
            parameters_schema, is_builtin, enabled,
            tool_type, usage_count, success_count, avg_execution_time,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          toolId, toolData.name, toolData.display_name,
          toolData.description, toolData.category,
          JSON.stringify(toolData.parameters_schema),
          1, 1, 'function', 0, 0, 0,
          Date.now(), Date.now()
        ]);

        console.log(`[ToolManager] 内置工具已加载: ${toolSchema.name}`);
      }

      console.log('[ToolManager] 内置工具加载完成');
    } catch (error) {
      console.error('[ToolManager] 加载内置工具失败:', error);
    }
  }

  /**
   * 推断工具分类
   * @param {string} toolName - 工具名称
   * @returns {string} 分类
   */
  inferCategory(toolName) {
    const categoryMap = {
      file: ['file_reader', 'file_writer', 'file_editor'],
      code: ['html_generator', 'css_generator', 'js_generator'],
      project: ['create_project_structure', 'git_init', 'git_commit'],
      system: ['generic_handler', 'info_searcher'],
      output: ['format_output'],
    };

    for (const [category, tools] of Object.entries(categoryMap)) {
      if (tools.includes(toolName)) {
        return category;
      }
    }

    return 'general';
  }

  /**
   * 加载插件工具
   */
  async loadPluginTools() {
    try {
      console.log('[ToolManager] 加载插件工具...');

      // 查询数据库中plugin_id不为空的工具
      const pluginTools = await this.db.all(
        'SELECT * FROM tools WHERE plugin_id IS NOT NULL AND enabled = 1'
      );

      for (const tool of pluginTools) {
        this.tools.set(tool.id, tool);
      }

      console.log(`[ToolManager] 插件工具加载完成，共 ${pluginTools.length} 个`);
    } catch (error) {
      console.error('[ToolManager] 加载插件工具失败:', error);
    }
  }

  // ===================================
  // 文档管理
  // ===================================

  /**
   * 生成所有工具的文档
   */
  async generateAllDocs() {
    try {
      console.log('[ToolManager] 生成工具文档...');

      const tools = Array.from(this.tools.values());
      const count = await this.docGenerator.generateAllToolDocs(tools);

      console.log(`[ToolManager] 工具文档生成完成，共 ${count} 个`);
    } catch (error) {
      console.error('[ToolManager] 生成工具文档失败:', error);
      // 文档生成失败不影响系统运行
    }
  }

  /**
   * 获取工具文档
   * @param {string} toolId - 工具ID
   * @returns {Promise<string>} 文档内容（Markdown格式）
   */
  async getToolDoc(toolId) {
    try {
      const tool = await this.getTool(toolId);
      if (!tool) {
        throw new Error(`工具不存在: ${toolId}`);
      }

      let content = await this.docGenerator.readToolDoc(tool.name);

      if (!content) {
        // 文档不存在，尝试生成
        await this.docGenerator.generateToolDoc(tool);
        content = await this.docGenerator.readToolDoc(tool.name);
      }

      return content;
    } catch (error) {
      console.error('[ToolManager] 获取工具文档失败:', error);
      throw error;
    }
  }

  /**
   * 重新生成工具文档
   * @param {string} toolId - 工具ID
   */
  async regenerateDoc(toolId) {
    try {
      const tool = await this.getTool(toolId);
      if (!tool) {
        throw new Error(`工具不存在: ${toolId}`);
      }

      await this.docGenerator.generateToolDoc(tool);
      console.log(`[ToolManager] 工具文档已重新生成: ${tool.name}`);
    } catch (error) {
      console.error('[ToolManager] 重新生成工具文档失败:', error);
      throw error;
    }
  }
}

module.exports = ToolManager;
