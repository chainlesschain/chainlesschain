/**
 * 代码执行引擎
 * 提供安全的Python代码执行功能
 */

const { logger } = require("../utils/logger.js");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");

/**
 * Environment variables that change HOW the OS resolves the executable or HOW
 * the interpreter loads code. A caller/renderer-supplied env must never be
 * allowed to override these: doing so lets an untrusted caller point the bare
 * `python`/`node`/`bash` command at a planted binary (PATH/PATHEXT), inject a
 * shared library into the child (LD_PRELOAD / DYLD_*), or force the interpreter
 * to run attacker code at startup (NODE_OPTIONS, PYTHONSTARTUP, BASH_ENV, ...).
 * spawn(shell:false) already blocks SHELL injection; this closes the parallel
 * ENV-hijack vector. Compared case-insensitively (Windows env names are).
 */
const BLOCKED_CHILD_ENV_KEYS = new Set([
  // Executable resolution
  "PATH",
  "PATHEXT",
  // Dynamic linker / loader injection
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "DYLD_FALLBACK_FRAMEWORK_PATH",
  // Node startup / module resolution
  "NODE_OPTIONS",
  "NODE_PATH",
  "ELECTRON_RUN_AS_NODE",
  // Python startup / module resolution
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PYTHONHOME",
  "PYTHONEXECUTABLE",
  "PYTHONINSPECT",
  // POSIX shell startup / word-splitting
  "BASH_ENV",
  "ENV",
  "IFS",
]);

/**
 * Filter a caller/renderer-supplied env map, dropping any key that could hijack
 * executable resolution or dynamic-library / interpreter startup loading. The
 * spawned child still INHERITS the trusted process env (including the real
 * PATH) — this only governs what an untrusted caller may ADD or override.
 * Returns a new object; never mutates the input.
 * @param {Object} env - caller-supplied environment overrides
 * @returns {{ safe: Object, dropped: string[] }}
 */
function sanitizeChildEnv(env) {
  const safe = {};
  const dropped = [];
  if (!env || typeof env !== "object") {
    return { safe, dropped };
  }
  for (const [key, value] of Object.entries(env)) {
    if (BLOCKED_CHILD_ENV_KEYS.has(String(key).toUpperCase())) {
      dropped.push(key);
      continue;
    }
    safe[key] = value;
  }
  return { safe, dropped };
}

class CodeExecutor {
  constructor() {
    this.initialized = false;
    this.pythonPath = null;
    this.tempDir = path.join(os.tmpdir(), "chainlesschain-code-exec");

    // 执行超时时间(毫秒)
    this.timeout = 30000; // 30秒

    // 支持的语言
    this.supportedLanguages = {
      python: {
        extensions: [".py"],
        command: "python",
        args: [],
      },
      javascript: {
        extensions: [".js"],
        command: "node",
        args: [],
      },
      bash: {
        extensions: [".sh"],
        command: process.platform === "win32" ? "bash" : "/bin/bash",
        args: [],
      },
    };
  }

  /**
   * 初始化代码执行器
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // 确保临时目录存在
      await fs.mkdir(this.tempDir, { recursive: true });

      // 检测Python环境
      this.pythonPath = await this.detectPython();

      this.initialized = true;
      logger.info("[CodeExecutor] 初始化完成, Python路径:", this.pythonPath);
    } catch (error) {
      logger.error("[CodeExecutor] 初始化失败:", error);
      // 即使没有Python也可以初始化,其他语言可能可用
      this.initialized = true;
    }
  }

  /**
   * 检测系统中的Python
   */
  async detectPython() {
    const pythonCommands = ["python3", "python", "py"];

    for (const cmd of pythonCommands) {
      try {
        const version = await this.getPythonVersion(cmd);
        if (version) {
          logger.info(`[CodeExecutor] 找到Python: ${cmd} (${version})`);
          return cmd;
        }
      } catch (error) {
        // 继续尝试下一个命令
      }
    }

    throw new Error("未找到Python环境");
  }

  /**
   * 获取Python版本
   */
  getPythonVersion(command) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, ["--version"]);
      let output = "";

      proc.stdout.on("data", (data) => {
        output += data.toString("utf8");
      });

      proc.stderr.on("data", (data) => {
        output += data.toString("utf8");
      });

      proc.on("close", (code) => {
        if (code === 0 && output) {
          resolve(output.trim());
        } else {
          reject(new Error("无法获取版本"));
        }
      });

      // 超时保护
      setTimeout(() => {
        proc.kill();
        reject(new Error("超时"));
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
      throw new Error("Python环境未配置");
    }

    const {
      timeout = this.timeout,
      workingDir = this.tempDir,
      input = null,
      env = {},
    } = options;

    logger.info("[CodeExecutor] 执行Python代码...");

    try {
      // 创建临时文件
      const filename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`;
      const filepath = path.join(workingDir, filename);

      // 写入代码到临时文件
      await fs.writeFile(filepath, code, "utf8");

      // 执行代码
      const result = await this.runCommand(this.pythonPath, [filepath], {
        timeout,
        workingDir,
        input,
        env,
      });

      // 清理临时文件
      try {
        await fs.unlink(filepath);
      } catch (error) {
        logger.warn("[CodeExecutor] 清理临时文件失败:", error.message);
      }

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
      };
    } catch (error) {
      logger.error("[CodeExecutor] Python执行失败:", error);
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
    logger.info("[CodeExecutor] 执行文件:", filepath);

    // 检测文件类型
    const ext = path.extname(filepath);
    const language = this.detectLanguage(ext);

    if (!language) {
      throw new Error(`不支持的文件类型: ${ext}`);
    }

    const langConfig = this.supportedLanguages[language];
    const workingDir = path.dirname(filepath);

    const { timeout = this.timeout, input = null, env = {} } = options;

    try {
      // 根据语言选择执行命令
      let command = langConfig.command;
      const args = [...langConfig.args, filepath];

      // 特殊处理
      if (language === "python" && this.pythonPath) {
        command = this.pythonPath;
      }

      const result = await this.runCommand(command, args, {
        timeout,
        workingDir,
        input,
        env,
      });

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        language: language,
      };
    } catch (error) {
      logger.error("[CodeExecutor] 文件执行失败:", error);
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
        env = {},
      } = options;

      logger.info(`[CodeExecutor] 运行命令: ${command} ${args.join(" ")}`);

      const startTime = Date.now();
      let stdout = "";
      let stderr = "";
      let killed = false;

      // 合并环境变量。调用方(经 IPC 可达 renderer)传入的 env 先过滤掉可劫持
      // 可执行文件解析 / 动态库 / 解释器启动加载的敏感变量(PATH、LD_PRELOAD、
      // NODE_OPTIONS、PYTHONSTARTUP 等)——否则即使 shell:false 也能把裸命令
      // python/node/bash 指向植入的二进制或向子进程注入代码。子进程仍继承可信
      // 的 process.env(含真实 PATH)。
      const { safe: safeEnv, dropped } = sanitizeChildEnv(env);
      if (dropped.length > 0) {
        logger.warn(
          `[CodeExecutor] 已忽略调用方 env 中的敏感变量 (防 PATH/loader 劫持): ${dropped.join(", ")}`,
        );
      }
      const processEnv = {
        ...process.env,
        ...safeEnv,
      };

      const proc = spawn(command, args, {
        cwd: workingDir,
        env: processEnv,
        // SECURITY: never spawn with a shell. With shell:true the args —
        // including a (possibly renderer-supplied) filepath — are
        // shell-interpreted, so an arg like `& calc` injects commands on
        // Windows (cmd.exe). spawn resolves the python/node/bash interpreters
        // on Windows WITHOUT a shell (empirically verified), so shell:false
        // closes the injection with no functional loss. A .cmd/.bat
        // interpreter would need an absolute path, but the defaults are .exe.
        shell: false,
      });

      // 如果有输入,发送到stdin
      if (input) {
        proc.stdin.write(input);
        proc.stdin.end();
      }

      proc.stdout.on("data", (data) => {
        stdout += data.toString("utf8");
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString("utf8");
      });

      proc.on("error", (error) => {
        if (!killed) {
          reject(new Error(`执行失败: ${error.message}`));
        }
      });

      proc.on("close", (code) => {
        if (killed) {
          return; // 超时已处理
        }

        const executionTime = Date.now() - startTime;

        resolve({
          stdout: stdout,
          stderr: stderr,
          exitCode: code,
          executionTime: executionTime,
        });
      });

      // 超时保护
      const timer = setTimeout(() => {
        killed = true;
        proc.kill();
        reject(new Error(`执行超时 (${timeout}ms)`));
      }, timeout);

      // 确保清理定时器
      proc.on("close", () => {
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
      /remove/i,
    ];

    const warnings = [];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        warnings.push(`检测到潜在危险操作: ${pattern.source}`);
      }
    }

    return {
      safe: warnings.length === 0,
      warnings: warnings,
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
          logger.info("[CodeExecutor] 清理过期文件:", file);
        }
      }
    } catch (error) {
      logger.error("[CodeExecutor] 清理失败:", error);
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
  getCodeExecutor,
  sanitizeChildEnv,
  BLOCKED_CHILD_ENV_KEYS,
};
