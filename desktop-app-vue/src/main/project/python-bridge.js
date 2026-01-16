/**
 * Python工具桥接器
 * 负责Node.js与Python脚本之间的通信
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
  constructor() {
    this.pythonPath = this.findPythonExecutable();
    this.toolsPath = path.join(__dirname, "../python-tools");
    this.timeout = 60000; // 默认60秒超时
  }

  /**
   * 查找Python可执行文件
   */
  findPythonExecutable() {
    // 常见的Python可执行文件路径
    const possiblePaths = [
      "python", // 系统PATH中的python
      "python3", // Linux/Mac中的python3
      "py", // Windows中的py启动器
      "C:/Python312/python.exe", // Windows常见路径
      "C:/Python311/python.exe",
      "C:/Python310/python.exe",
      "C:/Users/" +
        require("os").userInfo().username +
        "/AppData/Local/Programs/Python/Python312/python.exe",
      "C:/Users/" +
        require("os").userInfo().username +
        "/AppData/Local/Programs/Python/Python311/python.exe",
      "C:/Users/" +
        require("os").userInfo().username +
        "/AppData/Local/Programs/Python/Python310/python.exe",
    ];

    // 尝试找到可用的Python
    for (const pythonCmd of possiblePaths) {
      try {
        // 使用 spawnSync 替代 execSync 避免命令注入
        const { spawnSync } = require("child_process");
        const result = spawnSync(pythonCmd, ["--version"], {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5000,
          windowsHide: true,
        });
        if (result.status === 0) {
          const version = (result.stdout || result.stderr || "").trim();
          console.log(
            `[PythonBridge] 找到Python: ${pythonCmd}, 版本: ${version}`,
          );
          return pythonCmd;
        }
      } catch (e) {
        // 继续尝试下一个
      }
    }

    console.warn('[PythonBridge] 未找到Python，将使用默认的"python"命令');
    return "python";
  }

  /**
   * 调用Python工具
   * @param {string} toolName - Python脚本名称（不含.py后缀）
   * @param {object} args - 传递给Python的参数
   * @param {object} options - 额外选项
   * @returns {Promise<any>} Python脚本的返回结果
   */
  async callTool(toolName, args = {}, options = {}) {
    const scriptPath = path.join(this.toolsPath, `${toolName}.py`);

    // 检查脚本是否存在
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Python工具不存在: ${scriptPath}`);
    }

    console.log(`[PythonBridge] 调用Python工具: ${toolName}`);
    console.log(`[PythonBridge] 参数:`, args);

    return new Promise((resolve, reject) => {
      // 创建子进程
      const python = spawn(
        this.pythonPath,
        [scriptPath, JSON.stringify(args)],
        {
          cwd: this.toolsPath,
          env: { ...process.env },
        },
      );

      let stdout = "";
      let stderr = "";

      // 收集标准输出
      python.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // 实时输出（用于调试）
        if (options.verbose) {
          console.log("[Python stdout]", chunk);
        }
      });

      // 收集标准错误
      python.stderr.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;

        // Python的print()默认输出到stderr，这里也收集
        if (options.verbose) {
          console.error("[Python stderr]", chunk);
        }
      });

      // 进程退出
      python.on("close", (code) => {
        console.log(`[PythonBridge] Python进程退出，代码: ${code}`);

        if (code === 0) {
          try {
            // 尝试解析JSON输出
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (e) {
            // 如果不是JSON，返回原始文本
            console.warn("[PythonBridge] 输出不是有效的JSON，返回原始文本");
            resolve({
              success: true,
              output: stdout,
              raw: true,
            });
          }
        } else {
          // 进程失败
          reject(
            new Error(
              `Python工具执行失败 (退出码: ${code})\n${stderr || stdout}`,
            ),
          );
        }
      });

      // 错误处理
      python.on("error", (err) => {
        console.error("[PythonBridge] 进程错误:", err);
        reject(new Error(`Python进程启动失败: ${err.message}`));
      });

      // 超时处理
      if (options.timeout !== undefined) {
        setTimeout(() => {
          python.kill();
          reject(new Error("Python工具执行超时"));
        }, options.timeout || this.timeout);
      }
    });
  }

  /**
   * 批量调用Python工具（并行）
   * @param {Array<{tool: string, args: object}>} calls - 调用列表
   * @returns {Promise<Array>} 所有调用的结果
   */
  async callBatch(calls) {
    console.log(`[PythonBridge] 批量调用${calls.length}个Python工具`);

    const promises = calls.map(({ tool, args, options }) =>
      this.callTool(tool, args, options).catch((err) => ({
        error: true,
        message: err.message,
      })),
    );

    return Promise.all(promises);
  }

  /**
   * 检查Python环境和依赖
   * @returns {Promise<object>} 环境检查结果
   */
  async checkEnvironment() {
    try {
      const result = await this.callTool(
        "check_environment",
        {},
        { timeout: 10000 },
      );
      return result;
    } catch (error) {
      console.error("[PythonBridge] 环境检查失败:", error.message);
      return {
        success: false,
        error: error.message,
        pythonPath: this.pythonPath,
      };
    }
  }
}

// 单例
let instance = null;

/**
 * 获取PythonBridge实例
 * @returns {PythonBridge}
 */
function getPythonBridge() {
  if (!instance) {
    instance = new PythonBridge();
  }
  return instance;
}

module.exports = {
  PythonBridge,
  getPythonBridge,
};
