#!/usr/bin/env node

/**
 * 生产环境集成脚本
 * 一键启动和管理三大高级特性：自适应阈值调整、模型在线学习、高级优化器
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class ProductionIntegration {
  constructor() {
    this.processes = new Map();
    this.config = this.loadConfig();
    this.logFile = path.join(__dirname, 'logs', 'production-integration.log');
    this.healthCheckInterval = null;
  }

  /**
   * 加载配置
   */
  loadConfig() {
    const configPath = path.join(__dirname, 'config', 'advanced-features.json');

    // 默认配置
    const defaultConfig = {
      adaptiveThreshold: {
        enabled: true,
        autoAdjust: true,
        interval: 60,  // 分钟
        targets: {
          smallModelRate: { min: 40, max: 60, ideal: 45 },
          successRate: { min: 85, ideal: 95 },
          costSavings: { min: 50, ideal: 70 }
        }
      },
      onlineLearning: {
        enabled: true,
        autoTrain: true,
        trainSchedule: '0 2 * * 0',  // 每周日凌晨2点
        trainDays: 30,
        models: {
          complexityEstimator: { learningRate: 0.01 },
          intentRecognizer: { confidenceThreshold: 0.7 },
          toolSelector: { learningRate: 0.1 },
          userPreference: { learningRate: 0.05 }
        }
      },
      advancedOptimizer: {
        enabled: true,
        autoOptimize: true,
        optimizeSchedule: '0 4 * * 0',  // 每周日凌晨4点
        features: {
          predictiveCache: true,
          parallelOptimization: true,
          smartRetry: true,
          bottleneckDetection: true
        },
        config: {
          maxParallelTasks: 4,
          cacheExpiry: 1800000,
          retryMaxAttempts: 3
        }
      },
      healthCheck: {
        enabled: true,
        interval: 300000  // 5分钟
      },
      logging: {
        level: 'info',  // debug, info, warn, error
        maxFileSize: '10M',
        maxFiles: 5
      }
    };

    // 尝试读取用户配置
    if (fs.existsSync(configPath)) {
      try {
        const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return { ...defaultConfig, ...userConfig };
      } catch (error) {
        this.log('warn', `配置文件解析失败，使用默认配置: ${error.message}`);
        return defaultConfig;
      }
    }

    // 创建默认配置文件
    try {
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      this.log('info', `已创建默认配置文件: ${configPath}`);
    } catch (error) {
      this.log('warn', `无法创建配置文件: ${error.message}`);
    }

    return defaultConfig;
  }

  /**
   * 日志记录
   */
  log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    console.log(logMessage);

    // 写入日志文件
    try {
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(this.logFile, logMessage + '\n');
    } catch (error) {
      console.error(`日志写入失败: ${error.message}`);
    }
  }

  /**
   * 环境检查
   */
  async checkEnvironment() {
    this.log('info', '开始环境检查...');

    const checks = [
      { name: '数据库文件', check: () => fs.existsSync(path.join(__dirname, '..', 'data', 'chainlesschain.db')) },
      { name: '日志目录', check: () => {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
          return true;
        }
        return true;
      }},
      { name: 'Node.js版本', check: () => {
        const version = process.version;
        const major = parseInt(version.slice(1).split('.')[0]);
        return major >= 14;
      }},
      { name: '配置文件', check: () => this.config !== null }
    ];

    let allPassed = true;
    for (const { name, check } of checks) {
      try {
        const passed = check();
        if (passed) {
          this.log('info', `✓ ${name}: 通过`);
        } else {
          this.log('error', `✗ ${name}: 失败`);
          allPassed = false;
        }
      } catch (error) {
        this.log('error', `✗ ${name}: 检查失败 - ${error.message}`);
        allPassed = false;
      }
    }

    if (!allPassed) {
      throw new Error('环境检查未通过，请修复上述问题后重试');
    }

    this.log('info', '环境检查完成，所有检查通过');
  }

  /**
   * 启动自适应阈值调整
   */
  startAdaptiveThreshold() {
    if (!this.config.adaptiveThreshold.enabled) {
      this.log('info', '自适应阈值调整已禁用');
      return;
    }

    this.log('info', '启动自适应阈值调整...');

    const args = [
      'adaptive-threshold.js',
      'auto',
      `--interval=${this.config.adaptiveThreshold.interval}`
    ];

    const child = spawn('node', args, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      this.log('info', `[自适应阈值] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      this.log('error', `[自适应阈值] ${data.toString().trim()}`);
    });

    child.on('exit', (code) => {
      this.log('warn', `自适应阈值调整进程退出，代码: ${code}`);
      this.processes.delete('adaptiveThreshold');

      // 自动重启
      if (code !== 0) {
        this.log('info', '10秒后自动重启自适应阈值调整...');
        setTimeout(() => this.startAdaptiveThreshold(), 10000);
      }
    });

    this.processes.set('adaptiveThreshold', child);
    this.log('info', '自适应阈值调整已启动');
  }

  /**
   * 启动在线学习（使用cron模拟定时任务）
   */
  startOnlineLearning() {
    if (!this.config.onlineLearning.enabled) {
      this.log('info', '模型在线学习已禁用');
      return;
    }

    this.log('info', '设置模型在线学习定时任务...');

    // 立即执行一次评估
    this.runOnlineLearningEvaluate();

    // 设置定时训练（这里简化为每24小时执行一次，生产环境建议使用cron）
    setInterval(() => {
      this.runOnlineLearningTrain();
    }, 24 * 60 * 60 * 1000);  // 24小时

    this.log('info', '模型在线学习定时任务已设置');
  }

  /**
   * 执行在线学习训练
   */
  runOnlineLearningTrain() {
    this.log('info', '开始模型在线学习训练...');

    const args = [
      'online-learning.js',
      'train',
      `--days=${this.config.onlineLearning.trainDays}`
    ];

    const child = spawn('node', args, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      this.log('info', `[在线学习] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      this.log('error', `[在线学习] ${data.toString().trim()}`);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        this.log('info', '模型在线学习训练完成');
      } else {
        this.log('error', `模型在线学习训练失败，代码: ${code}`);
      }
    });
  }

  /**
   * 执行在线学习评估
   */
  runOnlineLearningEvaluate() {
    this.log('info', '开始模型性能评估...');

    const child = spawn('node', ['online-learning.js', 'evaluate'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      this.log('info', `[评估] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      this.log('error', `[评估] ${data.toString().trim()}`);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        this.log('info', '模型性能评估完成');
      }
    });
  }

  /**
   * 启动高级优化器（定时任务）
   */
  startAdvancedOptimizer() {
    if (!this.config.advancedOptimizer.enabled) {
      this.log('info', '高级优化器已禁用');
      return;
    }

    this.log('info', '设置高级优化器定时任务...');

    // 立即执行一次瓶颈检测
    this.runBottleneckDetection();

    // 设置定时优化（每周执行一次）
    setInterval(() => {
      this.runFullOptimization();
    }, 7 * 24 * 60 * 60 * 1000);  // 7天

    this.log('info', '高级优化器定时任务已设置');
  }

  /**
   * 执行瓶颈检测
   */
  runBottleneckDetection() {
    this.log('info', '开始瓶颈检测...');

    const child = spawn('node', ['advanced-optimizer.js', 'bottleneck', '--days=7'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      this.log('info', `[瓶颈检测] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      this.log('error', `[瓶颈检测] ${data.toString().trim()}`);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        this.log('info', '瓶颈检测完成');
      }
    });
  }

  /**
   * 执行全面优化
   */
  runFullOptimization() {
    this.log('info', '开始全面优化...');

    const child = spawn('node', ['advanced-optimizer.js', 'optimize'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      this.log('info', `[全面优化] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      this.log('error', `[全面优化] ${data.toString().trim()}`);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        this.log('info', '全面优化完成');
      } else {
        this.log('error', `全面优化失败，代码: ${code}`);
      }
    });
  }

  /**
   * 健康检查
   */
  healthCheck() {
    const status = {
      timestamp: new Date().toISOString(),
      processes: {},
      overall: 'healthy'
    };

    // 检查进程状态
    for (const [name, process] of this.processes) {
      const isRunning = !process.killed && process.exitCode === null;
      status.processes[name] = {
        running: isRunning,
        pid: process.pid
      };

      if (!isRunning) {
        status.overall = 'unhealthy';
      }
    }

    // 检查日志文件大小
    try {
      const stats = fs.statSync(this.logFile);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      status.logFileSize = `${sizeMB}MB`;

      // 如果日志文件过大，进行轮转
      if (stats.size > 10 * 1024 * 1024) {  // 10MB
        this.rotateLogFile();
      }
    } catch (error) {
      // 日志文件不存在或无法访问
    }

    this.log('info', `健康检查: ${status.overall} - ${JSON.stringify(status.processes)}`);

    return status;
  }

  /**
   * 日志文件轮转
   */
  rotateLogFile() {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const archivePath = this.logFile.replace('.log', `.${timestamp}.log`);

      fs.renameSync(this.logFile, archivePath);
      this.log('info', `日志文件已轮转: ${archivePath}`);

      // 删除旧日志文件（保留最近5个）
      const logDir = path.dirname(this.logFile);
      const files = fs.readdirSync(logDir)
        .filter(f => f.startsWith('production-integration.') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(logDir, f),
          time: fs.statSync(path.join(logDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // 删除超过5个的旧文件
      files.slice(5).forEach(file => {
        fs.unlinkSync(file.path);
        this.log('info', `已删除旧日志: ${file.name}`);
      });
    } catch (error) {
      this.log('error', `日志轮转失败: ${error.message}`);
    }
  }

  /**
   * 启动所有服务
   */
  async start() {
    try {
      console.log('='.repeat(60));
      console.log('ChainlessChain 生产环境集成启动');
      console.log('='.repeat(60));

      // 环境检查
      await this.checkEnvironment();

      // 启动各个服务
      this.startAdaptiveThreshold();
      this.startOnlineLearning();
      this.startAdvancedOptimizer();

      // 启动健康检查
      if (this.config.healthCheck.enabled) {
        this.healthCheckInterval = setInterval(() => {
          this.healthCheck();
        }, this.config.healthCheck.interval);
        this.log('info', '健康检查已启动');
      }

      this.log('info', '所有服务已启动');
      console.log('\n' + '='.repeat(60));
      console.log('系统运行中...');
      console.log('按 Ctrl+C 停止所有服务');
      console.log('='.repeat(60) + '\n');

      // 立即执行一次健康检查
      setTimeout(() => this.healthCheck(), 5000);

    } catch (error) {
      this.log('error', `启动失败: ${error.message}`);
      console.error('\n启动失败，请检查上述错误信息');
      process.exit(1);
    }
  }

  /**
   * 停止所有服务
   */
  async stop() {
    this.log('info', '正在停止所有服务...');

    // 停止健康检查
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // 停止所有进程
    for (const [name, process] of this.processes) {
      this.log('info', `停止 ${name}...`);
      process.kill('SIGTERM');
    }

    // 等待所有进程退出
    await new Promise(resolve => setTimeout(resolve, 2000));

    this.log('info', '所有服务已停止');
    console.log('\n系统已安全关闭');
  }

  /**
   * 获取状态
   */
  getStatus() {
    const status = {
      uptime: process.uptime(),
      config: this.config,
      processes: {}
    };

    for (const [name, process] of this.processes) {
      status.processes[name] = {
        running: !process.killed && process.exitCode === null,
        pid: process.pid
      };
    }

    return status;
  }
}

// 命令行接口
async function main() {
  const command = process.argv[2] || 'start';
  const integration = new ProductionIntegration();

  // 处理退出信号
  process.on('SIGINT', async () => {
    console.log('\n收到退出信号...');
    await integration.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n收到终止信号...');
    await integration.stop();
    process.exit(0);
  });

  switch (command) {
    case 'start':
      await integration.start();
      break;

    case 'stop':
      await integration.stop();
      process.exit(0);
      break;

    case 'status':
      const status = integration.getStatus();
      console.log(JSON.stringify(status, null, 2));
      process.exit(0);
      break;

    case 'health':
      await integration.checkEnvironment();
      const health = integration.healthCheck();
      console.log(JSON.stringify(health, null, 2));
      process.exit(0);
      break;

    default:
      console.log('用法: node production-integration.js [start|stop|status|health]');
      console.log('');
      console.log('命令:');
      console.log('  start   - 启动所有服务（默认）');
      console.log('  stop    - 停止所有服务');
      console.log('  status  - 查看运行状态');
      console.log('  health  - 健康检查');
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('错误:', error.message);
    process.exit(1);
  });
}

module.exports = ProductionIntegration;
