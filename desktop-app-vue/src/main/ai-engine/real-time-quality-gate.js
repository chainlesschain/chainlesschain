/**
 * RealTimeQualityGate - 实时质量门禁检查器
 *
 * 使用文件监控在代码修改时立即进行质量检查
 *
 * 核心功能:
 * 1. 文件变更监控（chokidar）
 * 2. 实时语法检查
 * 3. 实时代码质量分析
 * 4. 即时反馈和警告
 *
 * @module ai-engine/real-time-quality-gate
 */

const { logger } = require('../utils/logger.js');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

/**
 * 质量问题严重级别
 */
const Severity = {
  ERROR: 'error',       // 严重错误（必须修复）
  WARNING: 'warning',   // 警告（建议修复）
  INFO: 'info',         // 信息（可选修复）
};

/**
 * 质量检查规则
 */
class QualityRule {
  constructor(id, name, severity, check) {
    this.id = id;
    this.name = name;
    this.severity = severity;
    this.check = check; // 检查函数: (filePath, content) => issues[]
  }
}

/**
 * 质量问题
 */
class QualityIssue {
  constructor(ruleId, severity, message, filePath, line = null, column = null) {
    this.ruleId = ruleId;
    this.severity = severity;
    this.message = message;
    this.filePath = filePath;
    this.line = line;
    this.column = column;
    this.timestamp = Date.now();
  }
}

/**
 * RealTimeQualityGate 类
 */
class RealTimeQualityGate extends EventEmitter {
  constructor(options = {}) {
    super();

    this.enabled = options.enabled !== false;
    this.projectPath = options.projectPath || process.cwd();
    this.watchPatterns = options.watchPatterns || ['**/*.js', '**/*.ts', '**/*.vue', '**/*.jsx', '**/*.tsx'];
    this.ignorePatterns = options.ignorePatterns || ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/build/**'];
    this.checkDelay = options.checkDelay || 500; // 防抖延迟（ms）

    // 文件监控器
    this.watcher = null;

    // 检查规则
    this.rules = [];
    this._initializeRules();

    // 检查结果缓存
    this.issueCache = new Map(); // filePath => issues[]

    // 防抖定时器
    this.checkTimers = new Map(); // filePath => timer

    // 统计信息
    this.stats = {
      totalChecks: 0,
      filesChecked: 0,
      issuesFound: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      checksFailed: 0,
    };

    logger.info('[RealTimeQualityGate] 实时质量门禁已初始化', {
      enabled: this.enabled,
      projectPath: this.projectPath,
      watchPatterns: this.watchPatterns,
    });
  }

  /**
   * 初始化质量检查规则
   * @private
   */
  _initializeRules() {
    // 规则1: 语法错误检查（简单的括号匹配）
    this.rules.push(new QualityRule(
      'syntax-brackets',
      '括号匹配检查',
      Severity.ERROR,
      (filePath, content) => {
        const issues = [];
        const stack = [];
        const brackets = { '(': ')', '[': ']', '{': '}' };
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          for (let col = 0; col < line.length; col++) {
            const char = line[col];

            if (brackets[char]) {
              stack.push({ char, line: lineNum + 1, col: col + 1 });
            } else if (Object.values(brackets).includes(char)) {
              const last = stack.pop();
              if (!last || brackets[last.char] !== char) {
                issues.push(new QualityIssue(
                  'syntax-brackets',
                  Severity.ERROR,
                  `括号不匹配: 期望 ${last ? brackets[last.char] : '无'}, 实际 ${char}`,
                  filePath,
                  lineNum + 1,
                  col + 1
                ));
              }
            }
          }
        }

        if (stack.length > 0) {
          const unclosed = stack.pop();
          issues.push(new QualityIssue(
            'syntax-brackets',
            Severity.ERROR,
            `未闭合的括号: ${unclosed.char}`,
            filePath,
            unclosed.line,
            unclosed.col
          ));
        }

        return issues;
      }
    ));

    // 规则2: 长函数检查
    this.rules.push(new QualityRule(
      'long-function',
      '长函数检查',
      Severity.WARNING,
      (filePath, content) => {
        const issues = [];
        const lines = content.split('\n');
        const functionRegex = /^\s*(function|async\s+function|const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/;

        let functionStart = null;
        let functionName = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // 检测函数开始
          if (functionRegex.test(line)) {
            functionStart = i + 1;
            functionName = line.match(/(?:function|const)\s+(\w+)/)?.[1] || '匿名函数';
          }

          // 检测函数结束（简单的大括号闭合）
          if (functionStart && line.trim() === '}' && i - functionStart > 50) {
            issues.push(new QualityIssue(
              'long-function',
              Severity.WARNING,
              `函数过长 (${i - functionStart + 1}行): ${functionName}。建议拆分为更小的函数。`,
              filePath,
              functionStart,
              null
            ));
            functionStart = null;
          }
        }

        return issues;
      }
    ));

    // 规则3: 硬编码敏感信息检查
    this.rules.push(new QualityRule(
      'hardcoded-secrets',
      '硬编码敏感信息检查',
      Severity.ERROR,
      (filePath, content) => {
        const issues = [];
        const lines = content.split('\n');
        const patterns = [
          /password\s*=\s*["'][^"']{3,}["']/i,
          /api[_-]?key\s*=\s*["'][^"']{10,}["']/i,
          /secret\s*=\s*["'][^"']{10,}["']/i,
          /token\s*=\s*["'][^"']{10,}["']/i,
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          for (const pattern of patterns) {
            if (pattern.test(line)) {
              issues.push(new QualityIssue(
                'hardcoded-secrets',
                Severity.ERROR,
                '检测到硬编码的敏感信息。请使用环境变量或配置文件。',
                filePath,
                lineNum + 1,
                null
              ));
              break;
            }
          }
        }

        return issues;
      }
    ));

    // 规则4: console.log 检查
    this.rules.push(new QualityRule(
      'console-log',
      'console.log检查',
      Severity.INFO,
      (filePath, content) => {
        const issues = [];
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          if (/console\.(log|debug|info|warn|error)/.test(line) && !/\/\/.*console\./.test(line)) {
            issues.push(new QualityIssue(
              'console-log',
              Severity.INFO,
              '检测到console语句。建议使用logger替代。',
              filePath,
              lineNum + 1,
              null
            ));
          }
        }

        return issues;
      }
    ));

    // 规则5: TODO/FIXME 检查
    this.rules.push(new QualityRule(
      'todo-fixme',
      'TODO/FIXME检查',
      Severity.INFO,
      (filePath, content) => {
        const issues = [];
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          if (/\b(TODO|FIXME)\b/i.test(line)) {
            const match = line.match(/\b(TODO|FIXME)\b:?\s*(.+)/i);
            const type = match ? match[1] : 'TODO';
            const message = match ? match[2].trim() : '';

            issues.push(new QualityIssue(
              'todo-fixme',
              Severity.INFO,
              `${type}: ${message || '待处理'}`,
              filePath,
              lineNum + 1,
              null
            ));
          }
        }

        return issues;
      }
    ));

    logger.info(`[RealTimeQualityGate] 已加载 ${this.rules.length} 个质量检查规则`);
  }

  /**
   * 启动文件监控
   */
  async start() {
    if (!this.enabled) {
      logger.info('[RealTimeQualityGate] 已禁用，跳过启动');
      return;
    }

    if (this.watcher) {
      logger.warn('[RealTimeQualityGate] 监控器已在运行中');
      return;
    }

    try {
      // 动态导入 chokidar
      const chokidar = require('chokidar');

      this.watcher = chokidar.watch(this.watchPatterns, {
        cwd: this.projectPath,
        ignored: this.ignorePatterns,
        persistent: true,
        ignoreInitial: true, // 跳过初始扫描
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });

      this.watcher.on('change', (filePath) => {
        this._onFileChanged(filePath);
      });

      this.watcher.on('add', (filePath) => {
        this._onFileChanged(filePath);
      });

      this.watcher.on('error', (error) => {
        logger.error('[RealTimeQualityGate] 监控器错误:', error);
      });

      logger.info('[RealTimeQualityGate] ✅ 文件监控已启动');
      this.emit('started');

    } catch (error) {
      logger.error('[RealTimeQualityGate] 启动失败:', error.message);
      logger.warn('[RealTimeQualityGate] 提示: 需要安装 chokidar 依赖 (npm install chokidar)');
      this.enabled = false;
    }
  }

  /**
   * 停止文件监控
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      logger.info('[RealTimeQualityGate] 文件监控已停止');
      this.emit('stopped');
    }

    // 清除所有定时器
    for (const timer of this.checkTimers.values()) {
      clearTimeout(timer);
    }
    this.checkTimers.clear();
  }

  /**
   * 文件变更处理（防抖）
   * @private
   */
  _onFileChanged(filePath) {
    const fullPath = path.join(this.projectPath, filePath);

    // 清除旧定时器
    if (this.checkTimers.has(fullPath)) {
      clearTimeout(this.checkTimers.get(fullPath));
    }

    // 设置新定时器（防抖）
    const timer = setTimeout(() => {
      this._checkFile(fullPath);
      this.checkTimers.delete(fullPath);
    }, this.checkDelay);

    this.checkTimers.set(fullPath, timer);
  }

  /**
   * 检查单个文件
   * @private
   */
  async _checkFile(filePath) {
    this.stats.totalChecks++;
    this.stats.filesChecked++;

    try {
      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf-8');

      // 执行所有规则
      const allIssues = [];

      for (const rule of this.rules) {
        try {
          const issues = rule.check(filePath, content);
          allIssues.push(...issues);
        } catch (error) {
          logger.error(`[RealTimeQualityGate] 规则 ${rule.id} 执行失败:`, error.message);
        }
      }

      // 更新缓存
      this.issueCache.set(filePath, allIssues);

      // 更新统计
      this.stats.issuesFound += allIssues.length;
      this.stats.errorCount += allIssues.filter(i => i.severity === Severity.ERROR).length;
      this.stats.warningCount += allIssues.filter(i => i.severity === Severity.WARNING).length;
      this.stats.infoCount += allIssues.filter(i => i.severity === Severity.INFO).length;

      // 发出事件
      if (allIssues.length > 0) {
        this.emit('issues-found', {
          filePath,
          issues: allIssues,
          errorCount: allIssues.filter(i => i.severity === Severity.ERROR).length,
          warningCount: allIssues.filter(i => i.severity === Severity.WARNING).length,
        });

        logger.warn(`[RealTimeQualityGate] ⚠️ 发现 ${allIssues.length} 个问题: ${path.relative(this.projectPath, filePath)}`);

        // 打印问题详情
        for (const issue of allIssues) {
          const location = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
          logger.warn(`  [${issue.severity}] ${issue.message} (${path.basename(filePath)}${location})`);
        }
      } else {
        logger.debug(`[RealTimeQualityGate] ✅ 无问题: ${path.relative(this.projectPath, filePath)}`);
      }

    } catch (error) {
      this.stats.checksFailed++;
      logger.error(`[RealTimeQualityGate] 检查文件失败 ${filePath}:`, error.message);
    }
  }

  /**
   * 手动检查文件
   */
  async checkFile(filePath) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath, filePath);
    await this._checkFile(fullPath);
    return this.issueCache.get(fullPath) || [];
  }

  /**
   * 获取所有问题
   */
  getAllIssues() {
    const allIssues = [];
    for (const issues of this.issueCache.values()) {
      allIssues.push(...issues);
    }
    return allIssues;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      cachedFiles: this.issueCache.size,
      totalIssues: this.getAllIssues().length,
    };
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.issueCache.clear();
    logger.info('[RealTimeQualityGate] 缓存已清空');
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalChecks: 0,
      filesChecked: 0,
      issuesFound: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      checksFailed: 0,
    };
  }
}

module.exports = { RealTimeQualityGate, QualityRule, QualityIssue, Severity };
