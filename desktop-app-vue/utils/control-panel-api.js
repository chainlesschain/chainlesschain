#!/usr/bin/env node

/**
 * 控制面板 API 服务
 * 为用户干预UI提供数据查询和操作接口
 */

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3').verbose();

class ControlPanelAPI {
  constructor(port = 3001) {
    this.port = port;
    this.dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');
    this.configPath = path.join(__dirname, 'config', 'advanced-features.json');
    this.server = null;
    this.db = null;
  }

  /**
   * 启动API服务
   */
  start() {
    // 连接数据库
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error('数据库连接失败:', err.message);
        process.exit(1);
      }
      console.log('✓ 数据库连接成功');
    });

    // 创建HTTP服务器
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.port, () => {
      console.log('='.repeat(60));
      console.log(`控制面板 API 服务已启动`);
      console.log(`监听端口: ${this.port}`);
      console.log(`访问地址: http://localhost:${this.port}`);
      console.log('='.repeat(60));
    });
  }

  /**
   * 处理HTTP请求
   */
  async handleRequest(req, res) {
    // 设置CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    try {
      // 路由分发
      if (pathname === '/') {
        // 返回控制面板HTML
        this.serveControlPanel(res);
      } else if (pathname === '/api/overview') {
        await this.handleOverview(req, res, query);
      } else if (pathname === '/api/threshold/status') {
        await this.handleThresholdStatus(req, res);
      } else if (pathname === '/api/threshold/monitor') {
        await this.handleThresholdMonitor(req, res, query);
      } else if (pathname === '/api/threshold/adjust') {
        await this.handleThresholdAdjust(req, res);
      } else if (pathname === '/api/threshold/history') {
        await this.handleThresholdHistory(req, res, query);
      } else if (pathname === '/api/learning/status') {
        await this.handleLearningStatus(req, res);
      } else if (pathname === '/api/learning/train') {
        await this.handleLearningTrain(req, res, query);
      } else if (pathname === '/api/learning/evaluate') {
        await this.handleLearningEvaluate(req, res);
      } else if (pathname === '/api/learning/stats') {
        await this.handleLearningStats(req, res);
      } else if (pathname === '/api/optimizer/status') {
        await this.handleOptimizerStatus(req, res);
      } else if (pathname === '/api/optimizer/predict') {
        await this.handleOptimizerPredict(req, res);
      } else if (pathname === '/api/optimizer/parallel') {
        await this.handleOptimizerParallel(req, res);
      } else if (pathname === '/api/optimizer/retry') {
        await this.handleOptimizerRetry(req, res);
      } else if (pathname === '/api/optimizer/bottleneck') {
        await this.handleOptimizerBottleneck(req, res, query);
      } else if (pathname === '/api/optimizer/optimize') {
        await this.handleOptimizerOptimize(req, res);
      } else if (pathname === '/api/logs') {
        await this.handleLogs(req, res, query);
      } else if (pathname === '/api/config') {
        await this.handleConfig(req, res);
      } else if (pathname === '/api/config/save') {
        await this.handleConfigSave(req, res);
      } else {
        this.send404(res);
      }
    } catch (error) {
      console.error('请求处理错误:', error);
      this.sendError(res, error.message);
    }
  }

  /**
   * 返回控制面板HTML
   */
  serveControlPanel(res) {
    const htmlPath = path.join(__dirname, 'control-panel.html');
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        this.sendError(res, '无法加载控制面板');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }

  /**
   * 总览数据
   */
  async handleOverview(req, res, query) {
    const days = parseInt(query.days) || 7;

    const sql = `
      SELECT
        COUNT(*) as total_tasks,
        AVG(CASE WHEN selected_model = 'small' THEN 100.0 ELSE 0.0 END) as small_model_rate,
        AVG(CASE WHEN is_success = 1 THEN 100.0 ELSE 0.0 END) as success_rate,
        AVG(cost_savings) as avg_cost_savings,
        AVG(quality_score) as avg_quality_score
      FROM knowledge_distillation_history
      WHERE created_at >= datetime('now', '-${days} days')
    `;

    this.db.get(sql, (err, row) => {
      if (err) {
        this.sendError(res, err.message);
        return;
      }

      // 计算综合评分
      const score = this.calculateOverallScore(row);

      this.sendJSON(res, {
        success: true,
        data: {
          totalTasks: row.total_tasks || 0,
          smallModelRate: row.small_model_rate || 0,
          successRate: row.success_rate || 0,
          costSavings: row.avg_cost_savings || 0,
          qualityScore: row.avg_quality_score || 0,
          overallScore: score,
          period: `${days}天`
        }
      });
    });
  }

  /**
   * 计算综合评分
   */
  calculateOverallScore(metrics) {
    const targets = {
      smallModelRate: { min: 40, max: 60, ideal: 45 },
      successRate: { min: 85, ideal: 95 },
      costSavings: { min: 50, ideal: 70 }
    };

    let score = 0;

    // 小模型使用率得分 (40分)
    const smRate = metrics.small_model_rate || 0;
    if (smRate >= targets.smallModelRate.min && smRate <= targets.smallModelRate.max) {
      score += 40;
    } else {
      const deviation = Math.min(
        Math.abs(smRate - targets.smallModelRate.min),
        Math.abs(smRate - targets.smallModelRate.max)
      );
      score += Math.max(0, 40 - deviation);
    }

    // 成本节约得分 (30分)
    const savings = metrics.avg_cost_savings || 0;
    if (savings >= targets.costSavings.ideal) {
      score += 30;
    } else if (savings >= targets.costSavings.min) {
      const range = targets.costSavings.ideal - targets.costSavings.min;
      const actual = savings - targets.costSavings.min;
      score += 30 * (actual / range);
    }

    // 稳定性得分 (30分)
    const successRate = metrics.success_rate || 0;
    const qualityScore = metrics.avg_quality_score || 0;
    const successScore = Math.min(30, (successRate - 85) * 2);
    const qualityScorePoints = Math.min(30, (qualityScore - 0.8) * 150);
    score += (successScore + qualityScorePoints) / 2;

    return Math.round(score);
  }

  /**
   * 自适应阈值状态
   */
  async handleThresholdStatus(req, res) {
    // 获取当前阈值
    const config = this.loadConfig();
    const currentThreshold = config.adaptiveThreshold.currentThreshold || 0.52;

    // 获取最近调整信息
    this.db.get(
      `SELECT * FROM threshold_adjustment_history ORDER BY created_at DESC LIMIT 1`,
      (err, row) => {
        if (err) {
          this.sendError(res, err.message);
          return;
        }

        this.sendJSON(res, {
          success: true,
          data: {
            currentThreshold,
            isRunning: config.adaptiveThreshold.enabled,
            lastAdjustment: row ? {
              time: row.created_at,
              oldValue: row.old_threshold,
              newValue: row.new_threshold,
              reason: row.reason
            } : null
          }
        });
      }
    );
  }

  /**
   * 执行阈值监控
   */
  async handleThresholdMonitor(req, res, query) {
    const days = parseInt(query.days) || 7;

    this.executeCommand('adaptive-threshold.js', ['monitor', `--days=${days}`], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '监控完成'
        }
      });
    });
  }

  /**
   * 执行阈值调整
   */
  async handleThresholdAdjust(req, res) {
    this.executeCommand('adaptive-threshold.js', ['adjust'], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '调整完成'
        }
      });
    });
  }

  /**
   * 阈值调整历史
   */
  async handleThresholdHistory(req, res, query) {
    const limit = parseInt(query.limit) || 20;

    this.db.all(
      `SELECT * FROM threshold_adjustment_history ORDER BY created_at DESC LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) {
          this.sendError(res, err.message);
          return;
        }

        this.sendJSON(res, {
          success: true,
          data: rows || []
        });
      }
    );
  }

  /**
   * 在线学习状态
   */
  async handleLearningStatus(req, res) {
    const config = this.loadConfig();

    this.db.get(
      `SELECT * FROM online_learning_models ORDER BY last_trained_at DESC LIMIT 1`,
      (err, row) => {
        if (err) {
          this.sendError(res, err.message);
          return;
        }

        this.sendJSON(res, {
          success: true,
          data: {
            isRunning: config.onlineLearning.enabled,
            lastTrained: row ? row.last_trained_at : null,
            trainingSamples: row ? row.training_examples_count : 0
          }
        });
      }
    );
  }

  /**
   * 执行模型训练
   */
  async handleLearningTrain(req, res, query) {
    const days = parseInt(query.days) || 30;

    this.executeCommand('online-learning.js', ['train', `--days=${days}`], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '训练完成'
        }
      });
    });
  }

  /**
   * 执行模型评估
   */
  async handleLearningEvaluate(req, res) {
    this.executeCommand('online-learning.js', ['evaluate'], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '评估完成'
        }
      });
    });
  }

  /**
   * 学习统计信息
   */
  async handleLearningStats(req, res) {
    this.executeCommand('online-learning.js', ['stats'], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '统计信息'
        }
      });
    });
  }

  /**
   * 优化器状态
   */
  async handleOptimizerStatus(req, res) {
    const config = this.loadConfig();

    this.sendJSON(res, {
      success: true,
      data: {
        isRunning: config.advancedOptimizer.enabled,
        features: config.advancedOptimizer.features
      }
    });
  }

  /**
   * 执行预测性缓存
   */
  async handleOptimizerPredict(req, res) {
    this.executeCommand('advanced-optimizer.js', ['predict'], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '预测性缓存分析完成'
        }
      });
    });
  }

  /**
   * 执行并行优化
   */
  async handleOptimizerParallel(req, res) {
    this.executeCommand('advanced-optimizer.js', ['parallel'], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '并行优化分析完成'
        }
      });
    });
  }

  /**
   * 执行智能重试
   */
  async handleOptimizerRetry(req, res) {
    this.executeCommand('advanced-optimizer.js', ['retry'], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '智能重试分析完成'
        }
      });
    });
  }

  /**
   * 执行瓶颈检测
   */
  async handleOptimizerBottleneck(req, res, query) {
    const days = parseInt(query.days) || 7;

    this.executeCommand('advanced-optimizer.js', ['bottleneck', `--days=${days}`], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '瓶颈检测完成'
        }
      });
    });
  }

  /**
   * 执行全面优化
   */
  async handleOptimizerOptimize(req, res) {
    this.executeCommand('advanced-optimizer.js', ['optimize'], (output) => {
      this.sendJSON(res, {
        success: true,
        data: {
          output,
          message: '全面优化完成'
        }
      });
    });
  }

  /**
   * 获取日志
   */
  async handleLogs(req, res, query) {
    const lines = parseInt(query.lines) || 100;
    const filter = query.filter || 'all';

    const logPath = path.join(__dirname, 'logs', 'production-integration.log');

    fs.readFile(logPath, 'utf8', (err, data) => {
      if (err) {
        this.sendJSON(res, {
          success: true,
          data: {
            logs: []
          }
        });
        return;
      }

      let logLines = data.split('\n').filter(line => line.trim());

      // 过滤
      if (filter !== 'all') {
        logLines = logLines.filter(line => line.includes(`[${filter.toUpperCase()}]`));
      }

      // 获取最后N行
      logLines = logLines.slice(-lines);

      this.sendJSON(res, {
        success: true,
        data: {
          logs: logLines
        }
      });
    });
  }

  /**
   * 获取配置
   */
  async handleConfig(req, res) {
    const config = this.loadConfig();
    this.sendJSON(res, {
      success: true,
      data: config
    });
  }

  /**
   * 保存配置
   */
  async handleConfigSave(req, res) {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);

        fs.writeFileSync(this.configPath, JSON.stringify(newConfig, null, 2));

        this.sendJSON(res, {
          success: true,
          data: {
            message: '配置保存成功'
          }
        });
      } catch (error) {
        this.sendError(res, '配置保存失败: ' + error.message);
      }
    });
  }

  /**
   * 执行命令
   */
  executeCommand(script, args, callback) {
    const child = spawn('node', [script, ...args], {
      cwd: __dirname
    });

    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      callback(output);
    });
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      const data = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return this.getDefaultConfig();
    }
  }

  /**
   * 默认配置
   */
  getDefaultConfig() {
    return {
      adaptiveThreshold: {
        enabled: true,
        interval: 60,
        currentThreshold: 0.52
      },
      onlineLearning: {
        enabled: true,
        trainDays: 30
      },
      advancedOptimizer: {
        enabled: true,
        features: {
          predictiveCache: true,
          parallelOptimization: true,
          smartRetry: true,
          bottleneckDetection: true
        }
      }
    };
  }

  /**
   * 发送JSON响应
   */
  sendJSON(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * 发送错误响应
   */
  sendError(res, message) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      error: message
    }));
  }

  /**
   * 发送404响应
   */
  send404(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }

  /**
   * 停止服务
   */
  stop() {
    if (this.db) {
      this.db.close();
    }
    if (this.server) {
      this.server.close();
    }
    console.log('API服务已停止');
  }
}

// 命令行启动
if (require.main === module) {
  const port = process.argv[2] || 3001;
  const api = new ControlPanelAPI(port);

  api.start();

  // 处理退出信号
  process.on('SIGINT', () => {
    console.log('\n收到退出信号...');
    api.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n收到终止信号...');
    api.stop();
    process.exit(0);
  });
}

module.exports = ControlPanelAPI;
