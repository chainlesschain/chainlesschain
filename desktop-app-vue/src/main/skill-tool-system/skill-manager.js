/**
 * 技能管理器 (SkillManager)
 * 负责技能的注册、管理、统计和与工具的关联
 */

const { v4: uuidv4 } = require('uuid');

class SkillManager {
  constructor(database, toolManager) {
    this.db = database;
    this.toolManager = toolManager;

    // 技能元数据缓存
    this.skills = new Map(); // skillId -> skillObject

    this.isInitialized = false;
  }

  /**
   * 初始化技能管理器
   */
  async initialize() {
    try {
      console.log('[SkillManager] 初始化技能管理器...');

      // 1. 加载内置技能
      await this.loadBuiltInSkills();

      // 2. 加载插件提供的技能
      await this.loadPluginSkills();

      this.isInitialized = true;
      console.log(`[SkillManager] 初始化完成，共加载 ${this.skills.size} 个技能`);

      return true;
    } catch (error) {
      console.error('[SkillManager] 初始化失败:', error);
      throw error;
    }
  }

  // ===================================
  // CRUD 操作
  // ===================================

  /**
   * 注册技能
   * @param {Object} skillData - 技能元数据
   * @returns {Promise<string>} 技能ID
   */
  async registerSkill(skillData) {
    try {
      const now = Date.now();
      const skillId = skillData.id || `skill_${uuidv4()}`;

      // 准备数据库记录
      const skillRecord = {
        id: skillId,
        name: skillData.name,
        display_name: skillData.display_name || skillData.name,
        description: skillData.description || '',
        category: skillData.category || 'general',
        icon: skillData.icon || null,
        enabled: skillData.enabled !== undefined ? skillData.enabled : 1,
        is_builtin: skillData.is_builtin || 0,
        plugin_id: skillData.plugin_id || null,
        config: typeof skillData.config === 'string'
          ? skillData.config
          : JSON.stringify(skillData.config || {}),
        tags: typeof skillData.tags === 'string'
          ? skillData.tags
          : JSON.stringify(skillData.tags || []),
        doc_path: skillData.doc_path || null,
        usage_count: 0,
        success_count: 0,
        last_used_at: null,
        created_at: now,
        updated_at: now,
      };

      // 保存到数据库
      const sql = `
        INSERT INTO skills (
          id, name, display_name, description, category, icon,
          enabled, is_builtin, plugin_id, config, tags, doc_path,
          usage_count, success_count, last_used_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          config = excluded.config,
          updated_at = excluded.updated_at
      `;

      await this.db.run(sql, [
        skillRecord.id, skillRecord.name, skillRecord.display_name,
        skillRecord.description, skillRecord.category, skillRecord.icon,
        skillRecord.enabled, skillRecord.is_builtin, skillRecord.plugin_id,
        skillRecord.config, skillRecord.tags, skillRecord.doc_path,
        skillRecord.usage_count, skillRecord.success_count,
        skillRecord.last_used_at, skillRecord.created_at, skillRecord.updated_at,
      ]);

      // 缓存技能元数据
      this.skills.set(skillId, skillRecord);

      console.log(`[SkillManager] 技能注册成功: ${skillRecord.name} (${skillId})`);

      return skillId;
    } catch (error) {
      console.error('[SkillManager] 注册技能失败:', error);
      throw error;
    }
  }

  /**
   * 注销技能
   * @param {string} skillId - 技能ID
   */
  async unregisterSkill(skillId) {
    try {
      const skill = await this.getSkill(skillId);
      if (!skill) {
        throw new Error(`技能不存在: ${skillId}`);
      }

      // 删除数据库记录（级联删除skill_tools关联）
      await this.db.run('DELETE FROM skills WHERE id = ?', [skillId]);

      // 从缓存中移除
      this.skills.delete(skillId);

      console.log(`[SkillManager] 技能注销成功: ${skill.name}`);
    } catch (error) {
      console.error('[SkillManager] 注销技能失败:', error);
      throw error;
    }
  }

  /**
   * 更新技能
   * @param {string} skillId - 技能ID
   * @param {Object} updates - 更新的字段
   */
  async updateSkill(skillId, updates) {
    try {
      const skill = await this.getSkill(skillId);
      if (!skill) {
        throw new Error(`技能不存在: ${skillId}`);
      }

      const allowedFields = [
        'display_name', 'description', 'category', 'icon',
        'enabled', 'config', 'tags', 'doc_path',
      ];

      const updatePairs = [];
      const updateValues = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updatePairs.push(`${key} = ?`);

          // 处理JSON字段
          if (['config', 'tags'].includes(key)) {
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
      updateValues.push(skillId);

      const sql = `UPDATE skills SET ${updatePairs.join(', ')} WHERE id = ?`;
      await this.db.run(sql, updateValues);

      // 更新缓存
      const updatedSkill = await this.getSkill(skillId);
      this.skills.set(skillId, updatedSkill);

      console.log(`[SkillManager] 技能更新成功: ${skill.name}`);
    } catch (error) {
      console.error('[SkillManager] 更新技能失败:', error);
      throw error;
    }
  }

  /**
   * 获取技能
   * @param {string} skillId - 技能ID
   * @returns {Promise<Object|null>} 技能对象
   */
  async getSkill(skillId) {
    try {
      // 先查缓存
      if (this.skills.has(skillId)) {
        return this.skills.get(skillId);
      }

      // 查数据库
      const skill = await this.db.get('SELECT * FROM skills WHERE id = ?', [skillId]);
      if (skill) {
        this.skills.set(skillId, skill);
      }
      return skill;
    } catch (error) {
      console.error('[SkillManager] 获取技能失败:', error);
      return null;
    }
  }

  // ===================================
  // 查询操作
  // ===================================

  /**
   * 获取所有技能
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 技能列表
   */
  async getAllSkills(options = {}) {
    try {
      const {
        enabled = null,
        category = null,
        plugin_id = null,
        is_builtin = null,
        limit = null,
        offset = 0,
      } = options;

      let sql = 'SELECT * FROM skills WHERE 1=1';
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

      sql += ' ORDER BY usage_count DESC';

      if (limit !== null) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
      }

      const skills = await this.db.all(sql, params);
      return skills;
    } catch (error) {
      console.error('[SkillManager] 获取技能列表失败:', error);
      return [];
    }
  }

  /**
   * 根据分类获取技能
   * @param {string} category - 分类
   * @returns {Promise<Array>} 技能列表
   */
  async getSkillsByCategory(category) {
    return this.getAllSkills({ category });
  }

  /**
   * 获取启用的技能
   * @returns {Promise<Array>} 技能列表
   */
  async getEnabledSkills() {
    return this.getAllSkills({ enabled: 1 });
  }

  // ===================================
  // 状态管理
  // ===================================

  /**
   * 启用技能
   * @param {string} skillId - 技能ID
   */
  async enableSkill(skillId) {
    await this.updateSkill(skillId, { enabled: 1 });
    console.log(`[SkillManager] 技能已启用: ${skillId}`);
  }

  /**
   * 禁用技能
   * @param {string} skillId - 技能ID
   */
  async disableSkill(skillId) {
    await this.updateSkill(skillId, { enabled: 0 });
    console.log(`[SkillManager] 技能已禁用: ${skillId}`);
  }

  // ===================================
  // 工具关联管理
  // ===================================

  /**
   * 添加工具到技能
   * @param {string} skillId - 技能ID
   * @param {string} toolId - 工具ID
   * @param {string} role - 角色 (primary/secondary/optional)
   * @param {number} priority - 优先级
   */
  async addToolToSkill(skillId, toolId, role = 'primary', priority = 0) {
    try {
      const skill = await this.getSkill(skillId);
      if (!skill) {
        throw new Error(`技能不存在: ${skillId}`);
      }

      const tool = await this.toolManager.getTool(toolId);
      if (!tool) {
        throw new Error(`工具不存在: ${toolId}`);
      }

      const id = `st_${uuidv4()}`;
      const now = Date.now();

      await this.db.run(`
        INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(skill_id, tool_id) DO UPDATE SET
          role = excluded.role,
          priority = excluded.priority
      `, [id, skillId, toolId, role, priority, now]);

      console.log(`[SkillManager] 工具已添加到技能: ${tool.name} -> ${skill.name}`);
    } catch (error) {
      console.error('[SkillManager] 添加工具到技能失败:', error);
      throw error;
    }
  }

  /**
   * 从技能中移除工具
   * @param {string} skillId - 技能ID
   * @param {string} toolId - 工具ID
   */
  async removeToolFromSkill(skillId, toolId) {
    try {
      await this.db.run(
        'DELETE FROM skill_tools WHERE skill_id = ? AND tool_id = ?',
        [skillId, toolId]
      );

      console.log(`[SkillManager] 工具已从技能移除`);
    } catch (error) {
      console.error('[SkillManager] 移除工具失败:', error);
      throw error;
    }
  }

  /**
   * 获取技能包含的工具
   * @param {string} skillId - 技能ID
   * @returns {Promise<Array>} 工具列表
   */
  async getSkillTools(skillId) {
    try {
      const sql = `
        SELECT t.*, st.role, st.priority, st.config_override
        FROM tools t
        INNER JOIN skill_tools st ON t.id = st.tool_id
        WHERE st.skill_id = ?
        ORDER BY st.priority DESC, t.name ASC
      `;

      const tools = await this.db.all(sql, [skillId]);
      return tools;
    } catch (error) {
      console.error('[SkillManager] 获取技能工具失败:', error);
      return [];
    }
  }

  /**
   * 获取使用某个工具的技能列表
   * @param {string} toolId - 工具ID
   * @returns {Promise<Array>} 技能列表
   */
  async getSkillsByTool(toolId) {
    try {
      const sql = `
        SELECT s.*, st.role, st.priority
        FROM skills s
        INNER JOIN skill_tools st ON s.id = st.skill_id
        WHERE st.tool_id = ?
        ORDER BY s.usage_count DESC
      `;

      const skills = await this.db.all(sql, [toolId]);
      return skills;
    } catch (error) {
      console.error('[SkillManager] 获取工具关联技能失败:', error);
      return [];
    }
  }

  // ===================================
  // 统计功能
  // ===================================

  /**
   * 记录技能使用情况
   * @param {string} skillId - 技能ID
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(秒)
   */
  async recordSkillUsage(skillId, success, duration) {
    try {
      // 1. 更新技能表的统计字段
      const skill = await this.getSkill(skillId);
      if (!skill) {
        console.warn(`[SkillManager] 技能不存在，跳过统计: ${skillId}`);
        return;
      }

      const newUsageCount = skill.usage_count + 1;
      const newSuccessCount = success ? skill.success_count + 1 : skill.success_count;

      await this.db.run(`
        UPDATE skills
        SET usage_count = ?,
            success_count = ?,
            last_used_at = ?
        WHERE id = ?
      `, [newUsageCount, newSuccessCount, Date.now(), skillId]);

      // 2. 更新每日统计表
      await this.updateDailyStats(skillId, success, duration);

    } catch (error) {
      console.error('[SkillManager] 记录技能使用失败:', error);
    }
  }

  /**
   * 更新每日统计
   * @param {string} skillId - 技能ID
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(秒)
   */
  async updateDailyStats(skillId, success, duration) {
    try {
      const statDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const now = Date.now();

      // 查询今日统计
      const stat = await this.db.get(
        'SELECT * FROM skill_stats WHERE skill_id = ? AND stat_date = ?',
        [skillId, statDate]
      );

      if (stat) {
        // 更新现有统计
        const newInvokeCount = stat.invoke_count + 1;
        const newSuccessCount = success ? stat.success_count + 1 : stat.success_count;
        const newFailureCount = success ? stat.failure_count : stat.failure_count + 1;
        const newTotalDuration = stat.total_duration + duration;
        const newAvgDuration = newTotalDuration / newInvokeCount;

        await this.db.run(`
          UPDATE skill_stats
          SET invoke_count = ?,
              success_count = ?,
              failure_count = ?,
              avg_duration = ?,
              total_duration = ?,
              updated_at = ?
          WHERE id = ?
        `, [
          newInvokeCount, newSuccessCount, newFailureCount,
          newAvgDuration, newTotalDuration, now, stat.id
        ]);
      } else {
        // 创建新统计
        await this.db.run(`
          INSERT INTO skill_stats (
            id, skill_id, stat_date, invoke_count, success_count,
            failure_count, avg_duration, total_duration,
            positive_feedback, negative_feedback, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          `stat_${uuidv4()}`, skillId, statDate, 1,
          success ? 1 : 0, success ? 0 : 1,
          duration, duration, 0, 0, now, now
        ]);
      }
    } catch (error) {
      console.error('[SkillManager] 更新每日统计失败:', error);
    }
  }

  /**
   * 获取技能统计
   * @param {string} skillId - 技能ID
   * @param {Object} dateRange - 日期范围 {start, end}
   * @returns {Promise<Array>} 统计数据
   */
  async getSkillStats(skillId, dateRange = null) {
    try {
      let sql = 'SELECT * FROM skill_stats WHERE skill_id = ?';
      const params = [skillId];

      if (dateRange) {
        sql += ' AND stat_date >= ? AND stat_date <= ?';
        params.push(dateRange.start, dateRange.end);
      }

      sql += ' ORDER BY stat_date DESC';

      const stats = await this.db.all(sql, params);
      return stats;
    } catch (error) {
      console.error('[SkillManager] 获取技能统计失败:', error);
      return [];
    }
  }

  // ===================================
  // 文档管理
  // ===================================

  /**
   * 获取技能文档路径
   * @param {string} skillId - 技能ID
   * @returns {Promise<string|null>} 文档路径
   */
  async getSkillDoc(skillId) {
    const skill = await this.getSkill(skillId);
    return skill ? skill.doc_path : null;
  }

  // ===================================
  // 技能推荐
  // ===================================

  /**
   * 根据意图推荐技能
   * @param {string} intent - 用户意图
   * @returns {Promise<Array>} 推荐的技能列表
   */
  async getSuggestedSkills(intent) {
    try {
      // 简化实现：根据意图关键词匹配技能分类
      const intentCategoryMap = {
        '文件': 'file',
        '代码': 'code',
        '数据': 'data',
        '网页': 'web',
        'Web': 'web',
        '内容': 'content',
        '文档': 'document',
        '图片': 'media',
        '视频': 'media',
      };

      let category = null;
      for (const [keyword, cat] of Object.entries(intentCategoryMap)) {
        if (intent.includes(keyword)) {
          category = cat;
          break;
        }
      }

      if (category) {
        return this.getSkillsByCategory(category);
      }

      // 默认返回使用次数最多的技能
      return this.getAllSkills({ enabled: 1, limit: 5 });

    } catch (error) {
      console.error('[SkillManager] 技能推荐失败:', error);
      return [];
    }
  }

  // ===================================
  // 内置技能加载
  // ===================================

  /**
   * 加载内置技能
   */
  async loadBuiltInSkills() {
    try {
      console.log('[SkillManager] 加载内置技能...');

      // 导入内置技能定义
      const builtInSkills = require('./builtin-skills');

      for (const skillDef of builtInSkills) {
        // 检查是否已存在
        const existing = await this.db.get(
          'SELECT id FROM skills WHERE id = ?',
          [skillDef.id]
        );

        if (existing) {
          console.log(`[SkillManager] 技能已存在，跳过: ${skillDef.name}`);
          continue;
        }

        // 注册技能
        const skillId = await this.registerSkill({
          ...skillDef,
          is_builtin: 1,
        });

        // 关联工具
        if (skillDef.tools && skillDef.tools.length > 0) {
          for (let i = 0; i < skillDef.tools.length; i++) {
            const toolName = skillDef.tools[i];

            // 查找工具ID
            const tool = await this.toolManager.getToolByName(toolName);
            if (tool) {
              await this.addToolToSkill(
                skillId,
                tool.id,
                i === 0 ? 'primary' : 'secondary',
                skillDef.tools.length - i
              );
            } else {
              console.warn(`[SkillManager] 工具不存在，跳过关联: ${toolName}`);
            }
          }
        }
      }

      console.log('[SkillManager] 内置技能加载完成');
    } catch (error) {
      console.error('[SkillManager] 加载内置技能失败:', error);
      // 如果builtin-skills.js还不存在，不要抛出错误
      if (error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }

  /**
   * 加载插件技能
   */
  async loadPluginSkills() {
    try {
      console.log('[SkillManager] 加载插件技能...');

      // 查询数据库中plugin_id不为空的技能
      const pluginSkills = await this.db.all(
        'SELECT * FROM skills WHERE plugin_id IS NOT NULL AND enabled = 1'
      );

      for (const skill of pluginSkills) {
        this.skills.set(skill.id, skill);
      }

      console.log(`[SkillManager] 插件技能加载完成，共 ${pluginSkills.length} 个`);
    } catch (error) {
      console.error('[SkillManager] 加载插件技能失败:', error);
    }
  }
}

module.exports = SkillManager;
