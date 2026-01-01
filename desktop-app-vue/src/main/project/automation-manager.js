/**
 * 项目自动化管理器
 * 提供定时任务、文件监听、事件触发等自动化功能
 */

const cron = require('node-cron');
const chokidar = require('chokidar');
const { EventEmitter } = require('events');
const path = require('path');

class AutomationManager extends EventEmitter {
  constructor() {
    super();
    this.database = null;
    this.rules = new Map();          // 规则存储
    this.scheduledTasks = new Map(); // 定时任务
    this.fileWatchers = new Map();   // 文件监听器
    this.initialized = false;
  }

  /**
   * 初始化自动化管理器
   */
  async initialize() {
    if (this.initialized) return;

    try {
      const { getDatabase } = require('../database');
      this.database = getDatabase();

      // 创建数据库表
      await this.createTables();

      this.initialized = true;
      console.log('[AutomationManager] 初始化完成');
    } catch (error) {
      console.error('[AutomationManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建数据库表
   */
  async createTables() {
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS project_automation_rules (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          trigger_type TEXT NOT NULL,
          trigger_config TEXT NOT NULL,
          action_type TEXT NOT NULL,
          action_config TEXT NOT NULL,
          is_enabled INTEGER DEFAULT 1,
          last_run_at INTEGER,
          next_run_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        )
      `);

      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_automation_project
        ON project_automation_rules(project_id)
      `);

      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_automation_enabled
        ON project_automation_rules(is_enabled)
      `);

      console.log('[AutomationManager] 数据库表创建成功');
    } catch (error) {
      console.error('[AutomationManager] 创建数据库表失败:', error);
      throw error;
    }
  }

  /**
   * 加载项目的自动化规则
   * @param {string} projectId - 项目ID
   * @returns {Promise<Array>} 规则列表
   */
  async loadProjectRules(projectId) {
    try {
      const rules = this.database.prepare(`
        SELECT * FROM project_automation_rules
        WHERE project_id = ? AND is_enabled = 1
      `).all(projectId);

      console.log(`[AutomationManager] 加载项目 ${projectId} 的 ${rules.length} 条规则`);

      // 注册所有规则
      for (const rule of rules) {
        await this.registerRule(rule);
      }

      return rules;
    } catch (error) {
      console.error('[AutomationManager] 加载规则失败:', error);
      throw error;
    }
  }

  /**
   * 创建自动化规则
   * @param {Object} ruleData - 规则数据
   * @returns {Promise<Object>} 创建的规则
   */
  async createRule(ruleData) {
    const {
      projectId,
      name,
      description = '',
      triggerType,
      triggerConfig,
      actionType,
      actionConfig
    } = ruleData;

    const now = Date.now();
    const id = `rule_${now}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      this.database.prepare(`
        INSERT INTO project_automation_rules (
          id, project_id, name, description,
          trigger_type, trigger_config,
          action_type, action_config,
          is_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id, projectId, name, description,
        triggerType, JSON.stringify(triggerConfig),
        actionType, JSON.stringify(actionConfig),
        now, now
      );

      const rule = this.database.prepare(`
        SELECT * FROM project_automation_rules WHERE id = ?
      `).get(id);

      // 注册规则
      await this.registerRule(rule);

      console.log('[AutomationManager] 规则创建成功:', id);
      return rule;

    } catch (error) {
      console.error('[AutomationManager] 创建规则失败:', error);
      throw error;
    }
  }

  /**
   * 注册自动化规则
   * @param {Object} rule - 规则对象
   */
  async registerRule(rule) {
    const { id, trigger_type, trigger_config, action_type, action_config } = rule;

    try {
      const triggerConf = JSON.parse(trigger_config);
      const actionConf = JSON.parse(action_config);

      switch (trigger_type) {
        case 'schedule':
          await this.registerScheduledTask(id, triggerConf, action_type, actionConf);
          break;

        case 'file_change':
          await this.registerFileWatcher(id, triggerConf, action_type, actionConf);
          break;

        case 'task_complete':
          // 通过事件监听实现
          this.on('task:complete', async (taskData) => {
            if (this.matchesCondition(taskData, triggerConf)) {
              await this.executeAction(action_type, actionConf);
              await this.updateLastRun(id);
            }
          });
          break;

        case 'manual':
          // 手动触发，不需要注册
          break;

        default:
          console.warn(`[AutomationManager] 未知触发类型: ${trigger_type}`);
      }

      this.rules.set(id, rule);
      console.log(`[AutomationManager] 规则已注册: ${id}`);

    } catch (error) {
      console.error('[AutomationManager] 注册规则失败:', error);
      throw error;
    }
  }

  /**
   * 注册定时任务
   * @param {string} ruleId - 规则ID
   * @param {Object} triggerConfig - 触发配置
   * @param {string} actionType - 动作类型
   * @param {Object} actionConfig - 动作配置
   */
  async registerScheduledTask(ruleId, triggerConfig, actionType, actionConfig) {
    const { cron: cronExpression } = triggerConfig;

    if (!cron.validate(cronExpression)) {
      throw new Error(`无效的cron表达式: ${cronExpression}`);
    }

    const task = cron.schedule(cronExpression, async () => {
      console.log(`[AutomationManager] 执行定时任务: ${ruleId}`);

      try {
        await this.executeAction(actionType, actionConfig);
        await this.updateLastRun(ruleId);

        // 发送事件
        this.emit('rule:executed', { ruleId, actionType, success: true });
      } catch (error) {
        console.error(`[AutomationManager] 定时任务执行失败: ${ruleId}`, error);
        this.emit('rule:error', { ruleId, error: error.message });
      }
    });

    this.scheduledTasks.set(ruleId, task);
    console.log(`[AutomationManager] 定时任务已注册: ${cronExpression}`);
  }

  /**
   * 注册文件监听
   * @param {string} ruleId - 规则ID
   * @param {Object} triggerConfig - 触发配置
   * @param {string} actionType - 动作类型
   * @param {Object} actionConfig - 动作配置
   */
  async registerFileWatcher(ruleId, triggerConfig, actionType, actionConfig) {
    const { path: watchPath, pattern = '**/*', events = ['change'] } = triggerConfig;

    const watcher = chokidar.watch(path.join(watchPath, pattern), {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    // 监听指定事件
    for (const event of events) {
      watcher.on(event, async (filePath) => {
        console.log(`[AutomationManager] 文件${event}触发: ${filePath}`);

        try {
          await this.executeAction(actionType, {
            ...actionConfig,
            triggeredBy: { event, filePath }
          });
          await this.updateLastRun(ruleId);

          this.emit('rule:executed', { ruleId, actionType, filePath, success: true });
        } catch (error) {
          console.error(`[AutomationManager] 文件监听任务执行失败:`, error);
          this.emit('rule:error', { ruleId, error: error.message });
        }
      });
    }

    this.fileWatchers.set(ruleId, watcher);
    console.log(`[AutomationManager] 文件监听已注册: ${watchPath}`);
  }

  /**
   * 执行动作
   * @param {string} actionType - 动作类型
   * @param {Object} actionConfig - 动作配置
   */
  async executeAction(actionType, actionConfig) {
    console.log(`[AutomationManager] 执行动作: ${actionType}`);

    switch (actionType) {
      case 'run_task':
        await this.runTask(actionConfig);
        break;

      case 'generate_report':
        await this.generateReport(actionConfig);
        break;

      case 'send_notification':
        await this.sendNotification(actionConfig);
        break;

      case 'git_commit':
        await this.gitCommit(actionConfig);
        break;

      case 'export_file':
        await this.exportFile(actionConfig);
        break;

      case 'run_script':
        await this.runScript(actionConfig);
        break;

      default:
        console.warn(`[AutomationManager] 未知动作类型: ${actionType}`);
    }
  }

  /**
   * 执行任务
   */
  async runTask(config) {
    const { taskDescription, projectId } = config;

    console.log(`[AutomationManager] 执行任务: ${taskDescription}`);

    // 调用AI引擎处理任务 (使用单例 - 优化版)
    const { getAIEngineManagerOptimized } = require('../ai-engine/ai-engine-manager-optimized');
    const aiEngine = getAIEngineManagerOptimized();

    // 初始化优化版AI引擎（启用所有优化功能）
    await aiEngine.initialize({
      enableSlotFilling: true,
      enableToolSandbox: true,
      enablePerformanceMonitor: true,
      sandboxConfig: {
        timeout: 30000,
        retries: 2
      }
    });

    const result = await aiEngine.processUserInput(taskDescription, { projectId });

    return result;
  }

  /**
   * 生成报告
   */
  async generateReport(config) {
    const { reportType, projectId, outputPath } = config;

    console.log(`[AutomationManager] 生成报告: ${reportType}`);

    // 根据类型生成不同报告
    switch (reportType) {
      case 'daily':
        // 生成每日进度报告
        break;
      case 'weekly':
        // 生成周报
        break;
      case 'analytics':
        // 生成数据分析报告
        break;
    }

    // TODO: 实现报告生成逻辑
  }

  /**
   * 发送通知
   */
  async sendNotification(config) {
    const { title, message, channels = ['desktop'] } = config;

    console.log(`[AutomationManager] 发送通知: ${title}`);

    // 发送到不同渠道
    for (const channel of channels) {
      switch (channel) {
        case 'desktop':
          // 桌面通知
          const { Notification } = require('electron');
          const notification = new Notification({
            title: title,
            body: message
          });
          notification.show();
          break;

        case 'email':
          // TODO: 邮件通知
          break;

        case 'webhook':
          // TODO: Webhook通知
          break;
      }
    }
  }

  /**
   * Git提交
   */
  async gitCommit(config) {
    const { projectPath, commitMessage } = config;

    console.log(`[AutomationManager] Git提交: ${commitMessage}`);

    const GitManager = require('../git/git-manager');
    const gitManager = new GitManager();

    // 执行Git操作
    await gitManager.init(projectPath);
    await gitManager.add(projectPath, '.');
    await gitManager.commit(projectPath, commitMessage);

    // 可选: 推送到远程
    if (config.autoPush) {
      await gitManager.push(projectPath);
    }
  }

  /**
   * 导出文件
   */
  async exportFile(config) {
    const { sourcePath, format, outputPath } = config;

    console.log(`[AutomationManager] 导出文件: ${format}`);

    const DocumentEngine = require('../engines/document-engine');
    const docEngine = new DocumentEngine();

    await docEngine.export(sourcePath, outputPath, format);
  }

  /**
   * 运行脚本
   */
  async runScript(config) {
    const { scriptPath, args = [] } = config;

    console.log(`[AutomationManager] 运行脚本: ${scriptPath}`);

    const { spawn } = require('child_process');

    return new Promise((resolve, reject) => {
      const process = spawn(scriptPath, args);

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Script exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  /**
   * 更新最后执行时间
   */
  async updateLastRun(ruleId) {
    const now = Date.now();

    this.database.prepare(`
      UPDATE project_automation_rules
      SET last_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, ruleId);
  }

  /**
   * 条件匹配
   */
  matchesCondition(data, condition) {
    // 简单的条件匹配实现
    // TODO: 实现更复杂的条件逻辑
    return true;
  }

  /**
   * 计算下次执行时间
   */
  calculateNextRun(ruleId) {
    const rule = this.rules.get(ruleId);
    if (!rule) return null;

    const triggerConfig = JSON.parse(rule.trigger_config);

    if (rule.trigger_type === 'schedule') {
      // 使用node-cron计算下次执行时间
      // TODO: 实现精确的下次执行时间计算
      return Date.now() + 60000; // 临时返回1分钟后
    }

    return null;
  }

  /**
   * 停止规则
   * @param {string} ruleId - 规则ID
   */
  stopRule(ruleId) {
    console.log(`[AutomationManager] 停止规则: ${ruleId}`);

    // 停止定时任务
    if (this.scheduledTasks.has(ruleId)) {
      const task = this.scheduledTasks.get(ruleId);
      task.stop();
      this.scheduledTasks.delete(ruleId);
    }

    // 停止文件监听
    if (this.fileWatchers.has(ruleId)) {
      const watcher = this.fileWatchers.get(ruleId);
      watcher.close();
      this.fileWatchers.delete(ruleId);
    }

    // 从缓存中删除
    this.rules.delete(ruleId);
  }

  /**
   * 更新规则
   * @param {string} ruleId - 规则ID
   * @param {Object} updates - 更新数据
   */
  async updateRule(ruleId, updates) {
    const now = Date.now();

    // 先停止旧规则
    this.stopRule(ruleId);

    // 更新数据库
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'trigger_config' || key === 'action_config') {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(ruleId);

    this.database.prepare(`
      UPDATE project_automation_rules
      SET ${fields.join(', ')}
      WHERE id = ?
    `).run(...values);

    // 重新加载并注册规则
    const rule = this.database.prepare(`
      SELECT * FROM project_automation_rules WHERE id = ?
    `).get(ruleId);

    if (rule && rule.is_enabled) {
      await this.registerRule(rule);
    }

    console.log('[AutomationManager] 规则更新成功:', ruleId);
    return rule;
  }

  /**
   * 删除规则
   * @param {string} ruleId - 规则ID
   */
  async deleteRule(ruleId) {
    // 停止规则
    this.stopRule(ruleId);

    // 从数据库删除
    this.database.prepare(`
      DELETE FROM project_automation_rules WHERE id = ?
    `).run(ruleId);

    console.log('[AutomationManager] 规则删除成功:', ruleId);
  }

  /**
   * 获取规则列表
   * @param {string} projectId - 项目ID
   * @returns {Array} 规则列表
   */
  getRules(projectId) {
    return this.database.prepare(`
      SELECT * FROM project_automation_rules
      WHERE project_id = ?
      ORDER BY created_at DESC
    `).all(projectId);
  }

  /**
   * 获取规则详情
   * @param {string} ruleId - 规则ID
   * @returns {Object} 规则详情
   */
  getRule(ruleId) {
    return this.database.prepare(`
      SELECT * FROM project_automation_rules WHERE id = ?
    `).get(ruleId);
  }

  /**
   * 手动触发规则
   * @param {string} ruleId - 规则ID
   */
  async manualTrigger(ruleId) {
    const rule = this.getRule(ruleId);
    if (!rule) {
      throw new Error(`规则不存在: ${ruleId}`);
    }

    console.log(`[AutomationManager] 手动触发规则: ${ruleId}`);

    const actionConfig = JSON.parse(rule.action_config);

    try {
      await this.executeAction(rule.action_type, actionConfig);
      await this.updateLastRun(ruleId);

      this.emit('rule:executed', { ruleId, manual: true, success: true });

      return { success: true };
    } catch (error) {
      console.error('[AutomationManager] 手动触发失败:', error);
      this.emit('rule:error', { ruleId, error: error.message });
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const stats = this.database.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) as enabled,
        SUM(CASE WHEN is_enabled = 0 THEN 1 ELSE 0 END) as disabled
      FROM project_automation_rules
    `).get();

    return {
      total: stats.total,
      enabled: stats.enabled,
      disabled: stats.disabled,
      activeScheduledTasks: this.scheduledTasks.size,
      activeFileWatchers: this.fileWatchers.size
    };
  }
}

// 单例模式
let automationManager = null;

/**
 * 获取自动化管理器实例
 * @returns {AutomationManager}
 */
function getAutomationManager() {
  if (!automationManager) {
    automationManager = new AutomationManager();
  }
  return automationManager;
}

module.exports = {
  AutomationManager,
  getAutomationManager
};
