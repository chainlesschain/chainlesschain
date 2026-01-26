/**
 * Python Sandbox Manager
 *
 * 安全的 Python 代码执行环境
 * 使用 Docker 隔离，支持资源限制和超时保护
 *
 * @module python-sandbox
 * @version 1.0.0
 *
 * 安全特性:
 * - 网络隔离 (NetworkMode: 'none')
 * - 内存限制 (默认 512MB)
 * - CPU 限制 (默认 50%)
 * - 超时保护 (默认 30s)
 * - 文件系统只读
 */

const { logger } = require('../utils/logger.js');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { v4: uuidv4 } = require('uuid');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // Docker 配置
  dockerImage: 'chainlesschain/python-sandbox:latest',
  containerPrefix: 'chainlesschain-sandbox',

  // 资源限制
  memoryLimit: '512m',    // 内存限制
  cpuLimit: '1.0',        // CPU 核心数限制
  pidsLimit: 100,         // 进程数限制

  // 安全配置
  networkDisabled: true,  // 禁用网络
  readOnlyRootfs: true,   // 只读文件系统
  noNewPrivileges: true,  // 禁止提权

  // 执行配置
  timeout: 30000,         // 执行超时 (ms)
  maxOutputSize: 1024 * 1024, // 最大输出 1MB

  // 临时目录
  tempDir: path.join(os.tmpdir(), 'chainlesschain-sandbox'),

  // 预装包
  preinstalledPackages: [
    'numpy',
    'pandas',
    'matplotlib',
    'scipy',
    'sympy',
    'requests',  // 虽然网络禁用，但可用于离线处理
  ],
};

/**
 * 执行状态
 */
const ExecutionStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  KILLED: 'killed',
};

/**
 * Python Sandbox 类
 */
class PythonSandbox extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dockerClient = null;
    this.isInitialized = false;
    this.activeContainers = new Map();

    // 统计数据
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      timeouts: 0,
      totalDuration: 0,
    };
  }

  /**
   * 初始化沙箱
   */
  async initialize() {
    logger.info('[PythonSandbox] 初始化沙箱...');

    try {
      // 检查 Docker 是否可用
      const dockerAvailable = await this._checkDocker();
      if (!dockerAvailable) {
        throw new Error('Docker 不可用，请确保 Docker 已安装并运行');
      }

      // 创建临时目录
      await fs.mkdir(this.config.tempDir, { recursive: true });

      // 检查/拉取 Docker 镜像
      const imageExists = await this._checkImage();
      if (!imageExists) {
        logger.info('[PythonSandbox] Docker 镜像不存在，尝试拉取...');
        await this._pullImage();
      }

      this.isInitialized = true;
      this.emit('initialized');
      logger.info('[PythonSandbox] 初始化完成');

      return true;
    } catch (error) {
      logger.error('[PythonSandbox] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 执行 Python 代码
   * @param {string} code - Python 代码
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  async execute(code, options = {}) {
    if (!this.isInitialized) {
      throw new Error('沙箱未初始化');
    }

    const executionId = uuidv4();
    const startTime = Date.now();

    this.stats.totalExecutions++;
    this.emit('execution-start', { executionId, code });

    try {
      // 准备执行环境
      const workDir = path.join(this.config.tempDir, executionId);
      await fs.mkdir(workDir, { recursive: true });

      // 写入代码文件
      const scriptPath = path.join(workDir, 'script.py');
      await fs.writeFile(scriptPath, code, 'utf-8');

      // 写入输入数据（如果有）
      if (options.inputData) {
        const inputPath = path.join(workDir, 'input.json');
        await fs.writeFile(inputPath, JSON.stringify(options.inputData), 'utf-8');
      }

      // 执行代码
      const result = await this._runInContainer(executionId, workDir, options);

      const duration = Date.now() - startTime;
      this.stats.successfulExecutions++;
      this.stats.totalDuration += duration;

      const finalResult = {
        executionId,
        status: ExecutionStatus.COMPLETED,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        duration,
        timestamp: Date.now(),
      };

      this.emit('execution-complete', finalResult);
      logger.info(`[PythonSandbox] 执行完成: ${executionId}, 耗时 ${duration}ms`);

      // 清理工作目录
      await this._cleanup(workDir);

      return finalResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.failedExecutions++;

      const isTimeout = error.message?.includes('timeout');
      if (isTimeout) {
        this.stats.timeouts++;
      }

      const errorResult = {
        executionId,
        status: isTimeout ? ExecutionStatus.TIMEOUT : ExecutionStatus.ERROR,
        output: '',
        error: error.message,
        exitCode: -1,
        duration,
        timestamp: Date.now(),
      };

      this.emit('execution-error', errorResult);
      logger.error(`[PythonSandbox] 执行失败: ${executionId}`, error);

      return errorResult;
    }
  }

  /**
   * 在 Docker 容器中运行代码
   * @private
   */
  async _runInContainer(executionId, workDir, options = {}) {
    const timeout = options.timeout || this.config.timeout;
    const memoryLimit = options.memoryLimit || this.config.memoryLimit;
    const cpuLimit = options.cpuLimit || this.config.cpuLimit;

    // 构建 Docker 命令
    const containerName = `${this.config.containerPrefix}-${executionId}`;

    const dockerArgs = [
      'run',
      '--rm',
      '--name', containerName,
      // 资源限制
      '--memory', memoryLimit,
      '--cpus', cpuLimit,
      '--pids-limit', String(this.config.pidsLimit),
      // 安全设置
      '--network', this.config.networkDisabled ? 'none' : 'bridge',
      '--read-only',
      '--no-new-privileges',
      // 挂载工作目录
      '-v', `${workDir}:/workspace:ro`,
      '-v', `${workDir}/output:/output:rw`,
      // 工作目录
      '-w', '/workspace',
      // 镜像
      this.config.dockerImage,
      // 执行命令
      'python', '/workspace/script.py',
    ];

    // 创建输出目录
    const outputDir = path.join(workDir, 'output');
    await fs.mkdir(outputDir, { recursive: true });

    // 记录活动容器
    this.activeContainers.set(executionId, {
      containerName,
      startTime: Date.now(),
    });

    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const docker = spawn('docker', dockerArgs);

      let stdout = '';
      let stderr = '';
      let isTimedOut = false;

      // 设置超时
      const timeoutHandle = setTimeout(() => {
        isTimedOut = true;
        this._killContainer(containerName);
        reject(new Error(`执行超时 (${timeout}ms)`));
      }, timeout);

      // 收集输出
      docker.stdout.on('data', (data) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= this.config.maxOutputSize) {
          stdout += chunk;
        }
      });

      docker.stderr.on('data', (data) => {
        const chunk = data.toString();
        if (stderr.length + chunk.length <= this.config.maxOutputSize) {
          stderr += chunk;
        }
      });

      docker.on('close', (code) => {
        clearTimeout(timeoutHandle);
        this.activeContainers.delete(executionId);

        if (isTimedOut) {
          return; // 已在超时处理中 reject
        }

        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
        });
      });

      docker.on('error', (error) => {
        clearTimeout(timeoutHandle);
        this.activeContainers.delete(executionId);
        reject(error);
      });
    });
  }

  /**
   * 终止容器
   * @private
   */
  async _killContainer(containerName) {
    try {
      const { execSync } = require('child_process');
      execSync(`docker kill ${containerName}`, { stdio: 'ignore' });
      logger.info(`[PythonSandbox] 容器已终止: ${containerName}`);
    } catch (error) {
      // 容器可能已经停止
    }
  }

  /**
   * 终止指定执行
   * @param {string} executionId - 执行 ID
   */
  async killExecution(executionId) {
    const container = this.activeContainers.get(executionId);
    if (container) {
      await this._killContainer(container.containerName);
      this.activeContainers.delete(executionId);
      this.emit('execution-killed', { executionId });
      return true;
    }
    return false;
  }

  /**
   * 检查 Docker 是否可用
   * @private
   */
  async _checkDocker() {
    try {
      const { execSync } = require('child_process');
      execSync('docker --version', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查镜像是否存在
   * @private
   */
  async _checkImage() {
    try {
      const { execSync } = require('child_process');
      execSync(`docker image inspect ${this.config.dockerImage}`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 拉取 Docker 镜像
   * @private
   */
  async _pullImage() {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const docker = spawn('docker', ['pull', this.config.dockerImage]);

      docker.on('close', (code) => {
        if (code === 0) {
          logger.info(`[PythonSandbox] 镜像拉取成功: ${this.config.dockerImage}`);
          resolve();
        } else {
          reject(new Error(`镜像拉取失败: ${this.config.dockerImage}`));
        }
      });

      docker.on('error', reject);
    });
  }

  /**
   * 清理工作目录
   * @private
   */
  async _cleanup(workDir) {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn('[PythonSandbox] 清理失败:', error);
    }
  }

  /**
   * 获取统计数据
   */
  getStats() {
    return {
      ...this.stats,
      activeContainers: this.activeContainers.size,
      avgDuration: this.stats.successfulExecutions > 0
        ? this.stats.totalDuration / this.stats.successfulExecutions
        : 0,
    };
  }

  /**
   * 检查状态
   */
  async checkStatus() {
    const dockerAvailable = await this._checkDocker();
    const imageExists = dockerAvailable ? await this._checkImage() : false;

    return {
      initialized: this.isInitialized,
      dockerAvailable,
      imageExists,
      dockerImage: this.config.dockerImage,
      activeContainers: this.activeContainers.size,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info('[PythonSandbox] 配置已更新');
  }

  /**
   * 关闭沙箱
   */
  async close() {
    logger.info('[PythonSandbox] 关闭沙箱...');

    // 终止所有活动容器
    for (const [executionId, container] of this.activeContainers) {
      await this._killContainer(container.containerName);
    }
    this.activeContainers.clear();

    // 清理临时目录
    try {
      await fs.rm(this.config.tempDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }

    this.isInitialized = false;
    this.emit('closed');
  }
}

// 单例实例
let sandboxInstance = null;

/**
 * 获取 PythonSandbox 单例
 * @param {Object} config - 配置
 * @returns {PythonSandbox}
 */
function getPythonSandbox(config = {}) {
  if (!sandboxInstance) {
    sandboxInstance = new PythonSandbox(config);
  }
  return sandboxInstance;
}

module.exports = {
  PythonSandbox,
  getPythonSandbox,
  ExecutionStatus,
  DEFAULT_CONFIG,
};
