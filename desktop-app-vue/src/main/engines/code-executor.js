/**
 * 代码执行引擎
 * 提供安全的Python代码执行功能
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class CodeExecutor {
  constructor() {
    this.initialized = false;
    this.pythonPath = null;
    this.tempDir = path.join(os.tmpdir(), 'chainlesschain-code-exec');

    // 执行超时时间(毫秒)
    this.timeout = 30000; // 30秒

    // 支持的语言
    this.supportedLanguages = {
      python: {
        extensions: ['.py'],
        command: 'python',
        args: []
      },
      javascript: {
        extensions: ['.js'],
        command: 'node',
        args: []
      },
      bash: {
        extensions: ['.sh'],
        command: process.platform === 'win32' ? 'bash' : '/bin/bash',
        args: []
      }
    };
  }

  /**
   * 初始化代码执行器
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 确保临时目录存在
      await fs.mkdir(this.tempDir, { recursive: true });

      // 检测Python环境
      this.pythonPath = await this.detectPython();

      this.initialized = true;
      console.log('[CodeExecutor] 初始化完成, Python路径:', this.pythonPath);
    } catch (error) {
      console.error('[CodeExecutor] 初始化失败:', error);
      // 即使没有Python也可以初始化,其他语言可能可用
      this.initialized = true;
    }
  }

  /**
   * 检测系统中的Python
   */
  async detectPython() {
    const pythonCommands = ['python3', 'python', 'py'];

    for (const cmd of pythonCommands) {
      try {
        const version = await this.getPythonVersion(cmd);
        if (version) {
          console.log(`[CodeExecutor] 找到Python: ${cmd} (${version})`);
          return cmd;
        }
      } catch (error) {
        // 继续尝试下一个命令
      }
    }

    throw new Error('未找到Python环境');
  }

  /**
   * 获取Python版本
   */
  getPythonVersion(command) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, ['--version']);
      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && output) {
          resolve(output.trim());
        } else {
          reject(new Error('无法获取版本'));
        }
      });

      // 超时保护
      setTimeout(() => {
        proc.kill();
        reject(new Error('超时'));
      }, 3000);
    });
  }

  /**
   * 执行Python代码
   * @param {string} code - Python代码
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  async executePython(code, options = {}) {
    if (!this.pythonPath) {
      throw new Error('Python环境未配置');
    }

    const {
      timeout = this.timeout,
      workingDir = this.tempDir,
      input = null,
      env = {}
    } = options;

    console.log('[CodeExecutor] 执行Python代码...');

    try {
      // 创建临时文件
      const filename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`;
      const filepath = path.join(workingDir, filename);

      // 写入代码到临时文件
      await fs.writeFile(filepath, code, 'utf8');

      // 执行代码
      const result = await this.runCommand(this.pythonPath, [filepath], {
        timeout,
        workingDir,
        input,
        env
      });

      // 清理临时文件
      try {
        await fs.unlink(filepath);
      } catch (error) {
        console.warn('[CodeExecutor] 清理临时文件失败:', error.message);
      }

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime
      };

    } catch (error) {
      console.error('[CodeExecutor] Python执行失败:', error);
      throw error;
    }
  }

  /**
   * 执行代码文件
   * @param {string} filepath - 文件路径
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  async executeFile(filepath, options = {}) {
    console.log('[CodeExecutor] 执行文件:', filepath);

    // 检测文件类型
    const ext = path.extname(filepath);
    const language = this.detectLanguage(ext);

    if (!language) {
      throw new Error(`不支持的文件类型: ${ext}`);
    }

    const langConfig = this.supportedLanguages[language];
    const workingDir = path.dirname(filepath);

    const {
      timeout = this.timeout,
      input = null,
      env = {}
    } = options;

    try {
      // 根据语言选择执行命令
      let command = langConfig.command;
      let args = [...langConfig.args, filepath];

      // 特殊处理
      if (language === 'python' && this.pythonPath) {
        command = this.pythonPath;
      }

      const result = await this.runCommand(command, args, {
        timeout,
        workingDir,
        input,
        env
      });

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        language: language
      };

    } catch (error) {
      console.error('[CodeExecutor] 文件执行失败:', error);
      throw error;
    }
  }

  /**
   * 执行命令
   * @param {string} command - 命令
   * @param {Array} args - 参数
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 执行结果
   */
  runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const {
        timeout = this.timeout,
        workingDir = process.cwd(),
        input = null,
        env = {}
      } = options;

      console.log(`[CodeExecutor] 运行命令: ${command} ${args.join(' ')}`);

      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      // 合并环境变量
      const processEnv = {
        ...process.env,
        ...env
      };

      const proc = spawn(command, args, {
        cwd: workingDir,
        env: processEnv,
        shell: process.platform === 'win32'
      });

      // 如果有输入,发送到stdin
      if (input) {
        proc.stdin.write(input);
        proc.stdin.end();
      }

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        if (!killed) {
          reject(new Error(`执行失败: ${error.message}`));
        }
      });

      proc.on('close', (code) => {
        if (killed) {
          return; // 超时已处理
        }

        const executionTime = Date.now() - startTime;

        resolve({
          stdout: stdout,
          stderr: stderr,
          exitCode: code,
          executionTime: executionTime
        });
      });

      // 超时保护
      const timer = setTimeout(() => {
        killed = true;
        proc.kill();
        reject(new Error(`执行超时 (${timeout}ms)`));
      }, timeout);

      // 确保清理定时器
      proc.on('close', () => {
        clearTimeout(timer);
      });
    });
  }

  /**
   * 检测语言类型
   * @param {string} extension - 文件扩展名
   * @returns {string|null} 语言类型
   */
  detectLanguage(extension) {
    for (const [lang, config] of Object.entries(this.supportedLanguages)) {
      if (config.extensions.includes(extension)) {
        return lang;
      }
    }
    return null;
  }

  /**
   * 检查代码安全性(基础检查)
   * @param {string} code - 代码
   * @returns {Object} 检查结果
   */
  checkSafety(code) {
    const dangerousPatterns = [
      /os\.system\(/i,
      /subprocess\.call/i,
      /subprocess\.Popen/i,
      /eval\(/i,
      /exec\(/i,
      /__import__/i,
      /open\([^)]*['"]w['"][^)]*\)/i, // 写文件操作
      /rmtree/i,
      /unlink/i,
      /remove/i
    ];

    const warnings = [];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        warnings.push(`检测到潜在危险操作: ${pattern.source}`);
      }
    }

    return {
      safe: warnings.length === 0,
      warnings: warnings
    };
  }

  /**
   * 清理临时文件
   */
  async cleanup() {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = 3600000; // 1小时

      for (const file of files) {
        const filepath = path.join(this.tempDir, file);
        const stats = await fs.stat(filepath);

        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filepath);
          console.log('[CodeExecutor] 清理过期文件:', file);
        }
      }
    } catch (error) {
      console.error('[CodeExecutor] 清理失败:', error);
    }
  }
}

// 单例实例
let instance = null;

function getCodeExecutor() {
  if (!instance) {
    instance = new CodeExecutor();
  }
  return instance;
}

module.exports = {
  CodeExecutor,
  getCodeExecutor
};
