/**
 * 进程管理远程处理器
 *
 * 处理来自 Android 端的进程管理命令：
 * - process.list: 列出进程 (PUBLIC)
 * - process.get: 获取进程详情 (NORMAL)
 * - process.kill: 终止进程 (ADMIN)
 * - process.start: 启动进程 (ADMIN)
 * - process.getResources: 获取资源使用 (PUBLIC)
 * - process.search: 搜索进程 (PUBLIC)
 *
 * @module remote/handlers/process-handler
 */

const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const os = require("os");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

// 危险进程黑名单（不允许终止）
const PROTECTED_PROCESSES = [
  "system",
  "systemd",
  "init",
  "kernel",
  "launchd",
  "csrss",
  "smss",
  "wininit",
  "services",
  "lsass",
  "svchost",
];

/**
 * 进程管理处理器类
 */
class ProcessHandler {
  constructor(options = {}) {
    this.options = {
      maxProcesses: 500, // 最大返回进程数
      allowKillProtected: false,
      ...options,
    };

    logger.info("[ProcessHandler] 进程管理处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[ProcessHandler] 处理命令: ${action}`);

    switch (action) {
      case "list":
        return await this.listProcesses(params, context);

      case "get":
        return await this.getProcess(params, context);

      case "kill":
        return await this.killProcess(params, context);

      case "start":
        return await this.startProcess(params, context);

      case "getResources":
        return await this.getResources(params, context);

      case "search":
        return await this.searchProcesses(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 列出进程
   */
  async listProcesses(params = {}, context) {
    const { sortBy = "cpu", limit = 50, offset = 0 } = params;

    logger.debug(`[ProcessHandler] 列出进程 from ${context?.did || "local"}`);

    try {
      let processes;

      if (isWindows) {
        processes = await this._getWindowsProcesses();
      } else {
        processes = await this._getUnixProcesses();
      }

      // 排序
      if (sortBy === "cpu") {
        processes.sort((a, b) => b.cpu - a.cpu);
      } else if (sortBy === "memory") {
        processes.sort((a, b) => b.memory - a.memory);
      } else if (sortBy === "name") {
        processes.sort((a, b) => a.name.localeCompare(b.name));
      } else if (sortBy === "pid") {
        processes.sort((a, b) => a.pid - b.pid);
      }

      // 分页
      const total = processes.length;
      const paginated = processes.slice(offset, offset + limit);

      return {
        success: true,
        processes: paginated,
        total,
        offset,
        limit,
      };
    } catch (error) {
      logger.error("[ProcessHandler] 列出进程失败:", error);
      throw new Error(`Failed to list processes: ${error.message}`);
    }
  }

  /**
   * 获取 Windows 进程列表
   */
  async _getWindowsProcesses() {
    const { stdout } = await execAsync(
      "wmic process get ProcessId,Name,WorkingSetSize,PercentProcessorTime /format:csv",
      { maxBuffer: 10 * 1024 * 1024 },
    );

    const lines = stdout.trim().split("\n").filter(Boolean);
    const processes = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length >= 4) {
        const name = parts[1]?.trim() || "";
        const cpu = parseFloat(parts[2]) || 0;
        const pid = parseInt(parts[3]) || 0;
        const memory = parseInt(parts[4]) || 0;

        if (pid > 0) {
          processes.push({
            pid,
            name,
            cpu: cpu / 100,
            memory: Math.round(memory / 1024 / 1024), // MB
            memoryBytes: memory,
          });
        }
      }
    }

    return processes;
  }

  /**
   * 获取 Unix 进程列表
   */
  async _getUnixProcesses() {
    const { stdout } = await execAsync("ps aux --no-headers", {
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    const processes = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 11) {
        const user = parts[0];
        const pid = parseInt(parts[1]) || 0;
        const cpu = parseFloat(parts[2]) || 0;
        const memPercent = parseFloat(parts[3]) || 0;
        const vsz = parseInt(parts[4]) || 0;
        const rss = parseInt(parts[5]) || 0;
        const command = parts.slice(10).join(" ");
        const name = command.split("/").pop()?.split(" ")[0] || command;

        if (pid > 0) {
          processes.push({
            pid,
            name,
            user,
            cpu,
            memoryPercent: memPercent,
            memory: Math.round(rss / 1024), // MB
            memoryBytes: rss * 1024,
            vsz,
            command: command.substring(0, 200),
          });
        }
      }
    }

    return processes;
  }

  /**
   * 获取进程详情
   */
  async getProcess(params, context) {
    const { pid } = params;

    if (!pid) {
      throw new Error('Parameter "pid" is required');
    }

    logger.debug(`[ProcessHandler] 获取进程详情: ${pid}`);

    try {
      let processInfo;

      if (isWindows) {
        processInfo = await this._getWindowsProcessDetail(pid);
      } else {
        processInfo = await this._getUnixProcessDetail(pid);
      }

      if (!processInfo) {
        throw new Error(`Process ${pid} not found`);
      }

      return {
        success: true,
        process: processInfo,
      };
    } catch (error) {
      logger.error(`[ProcessHandler] 获取进程 ${pid} 详情失败:`, error);
      throw new Error(`Failed to get process: ${error.message}`);
    }
  }

  async _getWindowsProcessDetail(pid) {
    try {
      const { stdout } = await execAsync(
        `wmic process where ProcessId=${pid} get ProcessId,Name,CommandLine,WorkingSetSize,ExecutablePath,CreationDate /format:list`,
      );

      const info = {};
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length) {
          info[key.trim()] = valueParts.join("=").trim();
        }
      }

      if (!info.ProcessId) {
        return null;
      }

      return {
        pid: parseInt(info.ProcessId),
        name: info.Name || "",
        command: info.CommandLine || "",
        executablePath: info.ExecutablePath || "",
        memory: Math.round(parseInt(info.WorkingSetSize || 0) / 1024 / 1024),
        createdAt: info.CreationDate || "",
      };
    } catch {
      return null;
    }
  }

  async _getUnixProcessDetail(pid) {
    try {
      const { stdout } = await execAsync(
        `ps -p ${pid} -o pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,command --no-headers`,
      );

      const parts = stdout.trim().split(/\s+/);
      if (parts.length < 11) {
        return null;
      }

      return {
        pid: parseInt(parts[0]),
        ppid: parseInt(parts[1]),
        user: parts[2],
        cpu: parseFloat(parts[3]),
        memoryPercent: parseFloat(parts[4]),
        vsz: parseInt(parts[5]),
        rss: parseInt(parts[6]),
        memory: Math.round(parseInt(parts[6]) / 1024),
        status: parts[7],
        startTime: parts[8],
        cpuTime: parts[9],
        command: parts.slice(10).join(" "),
      };
    } catch {
      return null;
    }
  }

  /**
   * 终止进程
   */
  async killProcess(params, context) {
    const { pid, signal = "SIGTERM", force = false } = params;

    if (!pid) {
      throw new Error('Parameter "pid" is required');
    }

    logger.info(
      `[ProcessHandler] 终止进程: ${pid} from ${context?.did || "local"}`,
    );

    // 检查是否为受保护进程
    const processInfo = await this.getProcess({ pid }, context);
    const processName = processInfo.process?.name?.toLowerCase() || "";

    if (
      !this.options.allowKillProtected &&
      PROTECTED_PROCESSES.some((p) => processName.includes(p))
    ) {
      throw new Error(`Cannot kill protected system process: ${processName}`);
    }

    try {
      if (isWindows) {
        const forceFlag = force ? "/F" : "";
        await execAsync(`taskkill ${forceFlag} /PID ${pid}`);
      } else {
        const sig = force ? "SIGKILL" : signal;
        process.kill(pid, sig);
      }

      return {
        success: true,
        pid,
        message: `Process ${pid} terminated`,
        signal: force ? "SIGKILL" : signal,
      };
    } catch (error) {
      logger.error(`[ProcessHandler] 终止进程 ${pid} 失败:`, error);
      throw new Error(`Failed to kill process: ${error.message}`);
    }
  }

  /**
   * 启动进程
   */
  async startProcess(params, context) {
    const { command, args = [], cwd, env, detached = true } = params;

    if (!command) {
      throw new Error('Parameter "command" is required');
    }

    // 安全检查：禁止危险命令
    const dangerousCommands = ["rm -rf", "del /s", "format", "mkfs", "dd if="];
    const fullCommand = `${command} ${args.join(" ")}`.toLowerCase();

    for (const dangerous of dangerousCommands) {
      if (fullCommand.includes(dangerous)) {
        throw new Error(`Dangerous command blocked: ${dangerous}`);
      }
    }

    logger.info(
      `[ProcessHandler] 启动进程: ${command} from ${context?.did || "local"}`,
    );

    try {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        detached,
        stdio: "ignore",
      });

      if (detached) {
        child.unref();
      }

      return {
        success: true,
        pid: child.pid,
        command,
        args,
        message: `Process started with PID ${child.pid}`,
      };
    } catch (error) {
      logger.error(`[ProcessHandler] 启动进程失败:`, error);
      throw new Error(`Failed to start process: ${error.message}`);
    }
  }

  /**
   * 获取系统资源使用情况
   */
  async getResources(params = {}, context) {
    logger.debug(`[ProcessHandler] 获取资源使用`);

    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    // 计算 CPU 使用率
    let cpuUsage = 0;
    for (const cpu of cpus) {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      cpuUsage += ((total - idle) / total) * 100;
    }
    cpuUsage = cpuUsage / cpus.length;

    // 获取负载
    const loadAvg = os.loadavg();

    return {
      success: true,
      resources: {
        cpu: {
          usage: Math.round(cpuUsage * 100) / 100,
          cores: cpus.length,
          model: cpus[0]?.model || "Unknown",
          speed: cpus[0]?.speed || 0,
        },
        memory: {
          total: Math.round((totalMemory / 1024 / 1024 / 1024) * 100) / 100, // GB
          used: Math.round((usedMemory / 1024 / 1024 / 1024) * 100) / 100,
          free: Math.round((freeMemory / 1024 / 1024 / 1024) * 100) / 100,
          usagePercent:
            Math.round((usedMemory / totalMemory) * 100 * 100) / 100,
        },
        loadAverage: {
          "1min": loadAvg[0],
          "5min": loadAvg[1],
          "15min": loadAvg[2],
        },
        uptime: os.uptime(),
        platform: process.platform,
        arch: process.arch,
      },
    };
  }

  /**
   * 搜索进程
   */
  async searchProcesses(params, context) {
    const { query, limit = 20 } = params;

    if (!query) {
      throw new Error('Parameter "query" is required');
    }

    logger.debug(`[ProcessHandler] 搜索进程: ${query}`);

    const { processes } = await this.listProcesses(
      { limit: this.options.maxProcesses },
      context,
    );

    const queryLower = query.toLowerCase();
    const matched = processes.filter(
      (p) =>
        p.name.toLowerCase().includes(queryLower) ||
        (p.command && p.command.toLowerCase().includes(queryLower)),
    );

    return {
      success: true,
      processes: matched.slice(0, limit),
      total: matched.length,
      query,
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[ProcessHandler] 资源已清理");
  }
}

module.exports = { ProcessHandler };
