/**
 * 项目自动化管理器
 * 提供定时任务、文件监听、事件触发等自动化功能
 */

const { logger, createLogger } = require('../utils/logger.js');
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
    if (this.initialized) {return;}

    try {
      const { getDatabase } = require('../database');
      this.database = getDatabase();

      // 创建数据库表
      await this.createTables();

      this.initialized = true;
      logger.info('[AutomationManager] 初始化完成');
    } catch (error) {
      logger.error('[AutomationManager] 初始化失败:', error);
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

      logger.info('[AutomationManager] 数据库表创建成功');
    } catch (error) {
      logger.error('[AutomationManager] 创建数据库表失败:', error);
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

      logger.info(`[AutomationManager] 加载项目 ${projectId} 的 ${rules.length} 条规则`);

      // 注册所有规则
      for (const rule of rules) {
        await this.registerRule(rule);
      }

      return rules;
    } catch (error) {
      logger.error('[AutomationManager] 加载规则失败:', error);
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

      logger.info('[AutomationManager] 规则创建成功:', id);
      return rule;

    } catch (error) {
      logger.error('[AutomationManager] 创建规则失败:', error);
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
          logger.warn(`[AutomationManager] 未知触发类型: ${trigger_type}`);
      }

      this.rules.set(id, rule);
      logger.info(`[AutomationManager] 规则已注册: ${id}`);

    } catch (error) {
      logger.error('[AutomationManager] 注册规则失败:', error);
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
      logger.info(`[AutomationManager] 执行定时任务: ${ruleId}`);

      try {
        await this.executeAction(actionType, actionConfig);
        await this.updateLastRun(ruleId);

        // 发送事件
        this.emit('rule:executed', { ruleId, actionType, success: true });
      } catch (error) {
        logger.error(`[AutomationManager] 定时任务执行失败: ${ruleId}`, error);
        this.emit('rule:error', { ruleId, error: error.message });
      }
    });

    this.scheduledTasks.set(ruleId, task);
    logger.info(`[AutomationManager] 定时任务已注册: ${cronExpression}`);
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
        logger.info(`[AutomationManager] 文件${event}触发: ${filePath}`);

        try {
          await this.executeAction(actionType, {
            ...actionConfig,
            triggeredBy: { event, filePath }
          });
          await this.updateLastRun(ruleId);

          this.emit('rule:executed', { ruleId, actionType, filePath, success: true });
        } catch (error) {
          logger.error(`[AutomationManager] 文件监听任务执行失败:`, error);
          this.emit('rule:error', { ruleId, error: error.message });
        }
      });
    }

    this.fileWatchers.set(ruleId, watcher);
    logger.info(`[AutomationManager] 文件监听已注册: ${watchPath}`);
  }

  /**
   * 执行动作
   * @param {string} actionType - 动作类型
   * @param {Object} actionConfig - 动作配置
   */
  async executeAction(actionType, actionConfig) {
    logger.info(`[AutomationManager] 执行动作: ${actionType}`);

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
        logger.warn(`[AutomationManager] 未知动作类型: ${actionType}`);
    }
  }

  /**
   * 执行任务
   */
  async runTask(config) {
    const { taskDescription, projectId } = config;

    logger.info(`[AutomationManager] 执行任务: ${taskDescription}`);

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
    const { reportType, projectId, outputPath, format = 'md' } = config;
    logger.info(`[AutomationManager] 生成报告: ${reportType}`);

    try {
      let reportData = {};
      let reportContent = '';
      const now = new Date();

      switch (reportType) {
        case 'daily':
          reportData = await this.collectDailyReportData(projectId, now);
          reportContent = this.formatDailyReport(reportData);
          break;
        case 'weekly':
          reportData = await this.collectWeeklyReportData(projectId, now);
          reportContent = this.formatWeeklyReport(reportData);
          break;
        case 'analytics':
          reportData = await this.collectAnalyticsData(projectId, config.dateRange);
          reportContent = this.formatAnalyticsReport(reportData);
          break;
      }

      if (outputPath) {
        const fs = require('fs').promises;
        const path = require('path');
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, reportContent, 'utf-8');
        logger.info(`[AutomationManager] ✓ 报告已保存: ${outputPath}`);
      }

      return { success: true, reportType, content: reportContent, data: reportData };
    } catch (error) {
      logger.error('[AutomationManager] 生成报告失败:', error);
      return { success: false, error: error.message };
    }
  }

  async collectDailyReportData(projectId, date) {
    const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);
    const project = this.database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const completedTasks = this.database.prepare(`
      SELECT title FROM tasks WHERE project_id = ? AND status = 'completed'
      AND completed_at BETWEEN ? AND ?
    `).all(projectId, startOfDay.getTime(), endOfDay.getTime());
    return { project, date: date.toISOString().split('T')[0], completedTasks };
  }

  async collectWeeklyReportData(projectId, date) {
    const endOfWeek = new Date(date);
    const startOfWeek = new Date(date); startOfWeek.setDate(startOfWeek.getDate() - 7);
    const project = this.database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const taskStats = this.database.prepare(`SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status`).all(projectId);
    const completedTasks = this.database.prepare(`
      SELECT title FROM tasks WHERE project_id = ? AND status = 'completed' AND completed_at BETWEEN ? AND ?
    `).all(projectId, startOfWeek.getTime(), endOfWeek.getTime());
    return { project, startDate: startOfWeek.toISOString().split('T')[0], endDate: endOfWeek.toISOString().split('T')[0], taskStats, completedTasks };
  }

  async collectAnalyticsData(projectId, dateRange) {
    const { start, end } = dateRange || { start: Date.now() - 30 * 24 * 60 * 60 * 1000, end: Date.now() };
    const taskTrend = this.database.prepare(`
      SELECT DATE(completed_at / 1000, 'unixepoch') as date, COUNT(*) as count
      FROM tasks WHERE project_id = ? AND status = 'completed' AND completed_at BETWEEN ? AND ?
      GROUP BY DATE(completed_at / 1000, 'unixepoch')
    `).all(projectId, start, end);
    return { projectId, taskTrend };
  }

  formatDailyReport(data) {
    let report = `# ${data.project?.name || '项目'} - 每日报告\n\n**日期:** ${data.date}\n\n`;
    report += `## 今日完成 (${data.completedTasks.length})\n\n`;
    data.completedTasks.forEach(t => { report += `- [x] ${t.title}\n`; });
    return report;
  }

  formatWeeklyReport(data) {
    let report = `# ${data.project?.name || '项目'} - 周报\n\n**周期:** ${data.startDate} ~ ${data.endDate}\n\n`;
    report += `## 任务概览\n\n`;
    data.taskStats.forEach(s => { report += `- ${s.status}: ${s.count}\n`; });
    report += `\n## 本周完成 (${data.completedTasks.length})\n\n`;
    data.completedTasks.slice(0, 20).forEach(t => { report += `- [x] ${t.title}\n`; });
    return report;
  }

  formatAnalyticsReport(data) {
    let report = `# 项目分析报告\n\n## 任务完成趋势\n\n`;
    data.taskTrend.forEach(t => { report += `- ${t.date}: ${t.count} 个任务\n`; });
    return report;
  }

  /**
   * 发送通知
   */
  async sendNotification(config) {
    const { title, message, channels = ['desktop'] } = config;
    logger.info(`[AutomationManager] 发送通知: ${title}`);
    const results = {};

    for (const channel of channels) {
      try {
        switch (channel) {
          case 'desktop':
            const { Notification } = require('electron');
            const notification = new Notification({ title, body: message });
            notification.show();
            results.desktop = { success: true };
            break;

          case 'email':
            results.email = await this.sendEmailNotification(config);
            break;

          case 'webhook':
            results.webhook = await this.sendWebhookNotification(config);
            break;
        }
      } catch (error) {
        results[channel] = { success: false, error: error.message };
      }
    }
    return results;
  }

  async sendEmailNotification(config) {
    const { title, message, emailConfig = {} } = config;
    const { to, smtpHost, smtpPort = 587, smtpUser, smtpPass } = emailConfig;
    if (!to) return { success: false, error: '缺少收件人' };

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost || process.env.SMTP_HOST,
        port: smtpPort,
        auth: { user: smtpUser || process.env.SMTP_USER, pass: smtpPass || process.env.SMTP_PASS }
      });
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'ChainlessChain <noreply@local>',
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: title,
        text: message,
        html: `<h2>${title}</h2><p>${message.replace(/\n/g, '<br>')}</p>`
      });
      logger.info(`[AutomationManager] ✓ 邮件已发送: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') return { success: false, error: 'nodemailer 未安装' };
      throw error;
    }
  }

  async sendWebhookNotification(config) {
    const { title, message, webhookConfig = {} } = config;
    const { url, method = 'POST', headers = {}, secret } = webhookConfig;
    if (!url) return { success: false, error: '缺少 Webhook URL' };

    const https = require('https');
    const http = require('http');
    const crypto = require('crypto');
    const { URL } = require('url');

    const payload = JSON.stringify({ title, message, timestamp: new Date().toISOString() });
    const reqHeaders = { 'Content-Type': 'application/json', ...headers };
    if (secret) reqHeaders['X-Signature'] = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: parsedUrl.hostname, port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: method.toUpperCase(), headers: reqHeaders, timeout: 30000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.info(`[AutomationManager] ✓ Webhook 成功: ${res.statusCode}`);
            resolve({ success: true, statusCode: res.statusCode });
          } else {
            resolve({ success: false, statusCode: res.statusCode, error: data });
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Git提交
   */
  async gitCommit(config) {
    const { projectPath, commitMessage } = config;

    logger.info(`[AutomationManager] Git提交: ${commitMessage}`);

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

    logger.info(`[AutomationManager] 导出文件: ${format}`);

    const DocumentEngine = require('../engines/document-engine');
    const docEngine = new DocumentEngine();

    await docEngine.export(sourcePath, outputPath, format);
  }

  /**
   * 运行脚本
   */
  async runScript(config) {
    const { scriptPath, args = [] } = config;

    logger.info(`[AutomationManager] 运行脚本: ${scriptPath}`);

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
   * @param {Object} data - 要匹配的数据
   * @param {Object} condition - 条件配置
   * @returns {boolean} 是否匹配
   */
  matchesCondition(data, condition) {
    if (!condition || Object.keys(condition).length === 0) {
      return true; // 无条件时默认匹配
    }

    // 支持的操作符
    const operators = {
      eq: (a, b) => a === b,
      ne: (a, b) => a !== b,
      gt: (a, b) => a > b,
      gte: (a, b) => a >= b,
      lt: (a, b) => a < b,
      lte: (a, b) => a <= b,
      contains: (a, b) => String(a).includes(String(b)),
      startsWith: (a, b) => String(a).startsWith(String(b)),
      endsWith: (a, b) => String(a).endsWith(String(b)),
      regex: (a, b) => new RegExp(b).test(String(a)),
      in: (a, b) => Array.isArray(b) && b.includes(a),
      notIn: (a, b) => Array.isArray(b) && !b.includes(a),
      exists: (a, b) => b ? a !== undefined && a !== null : a === undefined || a === null,
    };

    // 递归匹配逻辑
    const matchSingle = (dataValue, conditionValue) => {
      // 如果条件是对象且包含操作符
      if (typeof conditionValue === 'object' && conditionValue !== null && !Array.isArray(conditionValue)) {
        for (const [op, expected] of Object.entries(conditionValue)) {
          if (operators[op]) {
            if (!operators[op](dataValue, expected)) {
              return false;
            }
          } else {
            // 嵌套对象匹配
            if (typeof dataValue !== 'object' || dataValue === null) {
              return false;
            }
            if (!matchSingle(dataValue[op], expected)) {
              return false;
            }
          }
        }
        return true;
      }

      // 直接值比较
      return dataValue === conditionValue;
    };

    // 处理逻辑运算符
    if (condition.$and) {
      return condition.$and.every(subCond => this.matchesCondition(data, subCond));
    }

    if (condition.$or) {
      return condition.$or.some(subCond => this.matchesCondition(data, subCond));
    }

    if (condition.$not) {
      return !this.matchesCondition(data, condition.$not);
    }

    // 遍历所有条件字段
    for (const [field, conditionValue] of Object.entries(condition)) {
      if (field.startsWith('$')) continue; // 跳过逻辑运算符

      // 获取嵌套字段值 (支持 "a.b.c" 格式)
      const fieldParts = field.split('.');
      let dataValue = data;
      for (const part of fieldParts) {
        if (dataValue === undefined || dataValue === null) {
          dataValue = undefined;
          break;
        }
        dataValue = dataValue[part];
      }

      if (!matchSingle(dataValue, conditionValue)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 计算下次执行时间
   * @param {string} ruleId - 规则ID
   * @returns {number|null} 下次执行的时间戳（毫秒）
   */
  calculateNextRun(ruleId) {
    const rule = this.rules.get(ruleId);
    if (!rule) {return null;}

    const triggerConfig = typeof rule.trigger_config === 'string'
      ? JSON.parse(rule.trigger_config)
      : rule.trigger_config;

    if (rule.trigger_type === 'schedule') {
      const cronExpression = triggerConfig.cron || triggerConfig.schedule;
      if (!cronExpression) {
        return null;
      }

      // 解析 cron 表达式并计算下次执行时间
      return this.getNextCronTime(cronExpression);
    }

    if (rule.trigger_type === 'interval') {
      // 间隔触发
      const interval = triggerConfig.interval || 60000; // 默认1分钟
      const lastRun = rule.last_run_at || Date.now();
      return lastRun + interval;
    }

    return null;
  }

  /**
   * 解析 cron 表达式并计算下次执行时间
   * 支持标准 5 字段 cron: 分 时 日 月 周
   * @param {string} cronExpression - cron 表达式
   * @returns {number} 下次执行的时间戳
   */
  getNextCronTime(cronExpression) {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5) {
      logger.warn(`[AutomationManager] 无效的 cron 表达式: ${cronExpression}`);
      return Date.now() + 60000; // 默认1分钟后
    }

    const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;

    // 解析单个字段
    const parseField = (field, min, max) => {
      if (field === '*') {
        return Array.from({ length: max - min + 1 }, (_, i) => min + i);
      }

      const values = new Set();

      // 处理逗号分隔的多个值
      for (const segment of field.split(',')) {
        // 处理步长 (*/5 或 1-10/2)
        if (segment.includes('/')) {
          const [range, step] = segment.split('/');
          const stepNum = parseInt(step, 10);
          let start = min, end = max;

          if (range !== '*') {
            if (range.includes('-')) {
              [start, end] = range.split('-').map(n => parseInt(n, 10));
            } else {
              start = parseInt(range, 10);
            }
          }

          for (let i = start; i <= end; i += stepNum) {
            values.add(i);
          }
        }
        // 处理范围 (1-5)
        else if (segment.includes('-')) {
          const [start, end] = segment.split('-').map(n => parseInt(n, 10));
          for (let i = start; i <= end; i++) {
            values.add(i);
          }
        }
        // 单个值
        else {
          values.add(parseInt(segment, 10));
        }
      }

      return Array.from(values).filter(v => v >= min && v <= max).sort((a, b) => a - b);
    };

    const minutes = parseField(minutePart, 0, 59);
    const hours = parseField(hourPart, 0, 23);
    const days = parseField(dayPart, 1, 31);
    const months = parseField(monthPart, 1, 12);
    const weekdays = parseField(weekdayPart, 0, 6); // 0=周日

    // 从当前时间开始查找下一个匹配时间
    const now = new Date();
    const maxIterations = 366 * 24 * 60; // 最多查找一年

    for (let i = 0; i < maxIterations; i++) {
      const candidate = new Date(now.getTime() + i * 60000); // 每次增加1分钟

      const minute = candidate.getMinutes();
      const hour = candidate.getHours();
      const day = candidate.getDate();
      const month = candidate.getMonth() + 1;
      const weekday = candidate.getDay();

      // 检查是否匹配
      if (
        minutes.includes(minute) &&
        hours.includes(hour) &&
        days.includes(day) &&
        months.includes(month) &&
        weekdays.includes(weekday)
      ) {
        // 确保是未来时间
        if (candidate.getTime() > now.getTime()) {
          return candidate.getTime();
        }
      }
    }

    // 如果找不到，返回1小时后
    logger.warn(`[AutomationManager] 无法计算下次执行时间: ${cronExpression}`);
    return Date.now() + 3600000;
  }

  /**
   * 停止规则
   * @param {string} ruleId - 规则ID
   */
  stopRule(ruleId) {
    logger.info(`[AutomationManager] 停止规则: ${ruleId}`);

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

    logger.info('[AutomationManager] 规则更新成功:', ruleId);
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

    logger.info('[AutomationManager] 规则删除成功:', ruleId);
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

    logger.info(`[AutomationManager] 手动触发规则: ${ruleId}`);

    const actionConfig = JSON.parse(rule.action_config);

    try {
      await this.executeAction(rule.action_type, actionConfig);
      await this.updateLastRun(ruleId);

      this.emit('rule:executed', { ruleId, manual: true, success: true });

      return { success: true };
    } catch (error) {
      logger.error('[AutomationManager] 手动触发失败:', error);
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
