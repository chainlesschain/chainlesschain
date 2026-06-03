/**
 * 系统信息远程处理器
 *
 * 处理来自 Android 端的系统信息查询命令：
 * - sysinfo.getCPU: 获取 CPU 信息和使用率 (PUBLIC)
 * - sysinfo.getMemory: 获取内存使用情况 (PUBLIC)
 * - sysinfo.getBattery: 获取电池状态 (PUBLIC)
 * - sysinfo.getTemperature: 获取系统温度 (PUBLIC)
 * - sysinfo.getUptime: 获取系统运行时间 (PUBLIC)
 * - sysinfo.getOS: 获取操作系统信息 (PUBLIC)
 * - sysinfo.getHardware: 获取硬件信息 (PUBLIC)
 * - sysinfo.getLogs: 获取系统日志 (ADMIN)
 * - sysinfo.getServices: 获取系统服务状态 (NORMAL)
 * - sysinfo.getPerformance: 获取性能摘要 (PUBLIC)
 *
 * @module remote/handlers/system-info-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const os = require("os");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * 系统信息处理器类
 */
class SystemInfoHandler {
  constructor(options = {}) {
    this.options = {
      maxLogLines: options.maxLogLines || 100,
      ...options,
    };

    // 缓存
    this.cache = {
      hardware: null,
      hardwareTime: 0,
    };

    logger.info("[SystemInfoHandler] 系统信息处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[SystemInfoHandler] 处理命令: ${action}`);

    switch (action) {
      case "getCPU":
        return await this.getCPU(params, context);

      case "getMemory":
        return await this.getMemory(params, context);

      case "getBattery":
        return await this.getBattery(params, context);

      case "getTemperature":
        return await this.getTemperature(params, context);

      case "getUptime":
        return await this.getUptime(params, context);

      case "getOS":
        return await this.getOS(params, context);

      case "getHardware":
        return await this.getHardware(params, context);

      case "getLogs":
        return await this.getLogs(params, context);

      case "getServices":
        return await this.getServices(params, context);

      case "getPerformance":
        return await this.getPerformance(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取 CPU 信息和使用率
   */
  async getCPU(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取 CPU 信息`);

    try {
      const cpus = os.cpus();
      const cpuModel = cpus[0]?.model || "Unknown";
      const cpuCores = cpus.length;
      const cpuSpeed = cpus[0]?.speed || 0;

      // 计算 CPU 使用率
      const usage = await this._getCPUUsage();

      // 获取详细信息
      let details = {};
      if (isWindows) {
        details = await this._getWindowsCPUDetails();
      } else if (isMac) {
        details = await this._getMacCPUDetails();
      } else if (isLinux) {
        details = await this._getLinuxCPUDetails();
      }

      return {
        success: true,
        cpu: {
          model: cpuModel,
          cores: cpuCores,
          logicalCores: cpuCores,
          speed: cpuSpeed,
          usage: usage,
          ...details,
        },
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取 CPU 信息失败:", error);
      throw new Error(`Failed to get CPU info: ${error.message}`);
    }
  }

  async _getCPUUsage() {
    return new Promise((resolve) => {
      const startMeasure = this._cpuAverage();

      setTimeout(() => {
        const endMeasure = this._cpuAverage();
        const idleDiff = endMeasure.idle - startMeasure.idle;
        const totalDiff = endMeasure.total - startMeasure.total;
        const usage = 100 - Math.floor((100 * idleDiff) / totalDiff);
        resolve(Math.max(0, Math.min(100, usage)));
      }, 100);
    });
  }

  _cpuAverage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    return {
      idle: totalIdle / cpus.length,
      total: totalTick / cpus.length,
    };
  }

  async _getWindowsCPUDetails() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, L2CacheSize, L3CacheSize | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "{}");
      return {
        physicalCores: data.NumberOfCores || 0,
        logicalCores: data.NumberOfLogicalProcessors || 0,
        maxSpeed: data.MaxClockSpeed || 0,
        l2Cache: data.L2CacheSize || 0,
        l3Cache: data.L3CacheSize || 0,
      };
    } catch {
      return {};
    }
  }

  async _getMacCPUDetails() {
    try {
      const { stdout } = await execAsync(
        "sysctl -n machdep.cpu.brand_string hw.physicalcpu hw.logicalcpu",
      );
      const lines = stdout.trim().split("\n");
      return {
        brand: lines[0] || "Unknown",
        physicalCores: parseInt(lines[1]) || 0,
        logicalCores: parseInt(lines[2]) || 0,
      };
    } catch {
      return {};
    }
  }

  async _getLinuxCPUDetails() {
    try {
      const { stdout } = await execAsync(
        "cat /proc/cpuinfo | grep -E '^(model name|cpu cores|cache size)' | head -6",
      );
      const lines = stdout.trim().split("\n");
      const details = {};
      for (const line of lines) {
        const [key, value] = line.split(":").map((s) => s.trim());
        if (key === "model name") {
          details.brand = value;
        }
        if (key === "cpu cores") {
          details.physicalCores = parseInt(value);
        }
        if (key === "cache size") {
          details.cache = value;
        }
      }
      return details;
    } catch {
      return {};
    }
  }

  /**
   * 获取内存使用情况
   */
  async getMemory(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取内存信息`);

    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      let swapInfo = { total: 0, used: 0, free: 0 };
      if (isWindows) {
        swapInfo = await this._getWindowsSwapInfo();
      } else if (isMac || isLinux) {
        swapInfo = await this._getUnixSwapInfo();
      }

      return {
        success: true,
        memory: {
          total: totalMem,
          used: usedMem,
          free: freeMem,
          usagePercent: Math.round((usedMem / totalMem) * 100),
          totalGB: (totalMem / (1024 * 1024 * 1024)).toFixed(2),
          usedGB: (usedMem / (1024 * 1024 * 1024)).toFixed(2),
          freeGB: (freeMem / (1024 * 1024 * 1024)).toFixed(2),
        },
        swap: swapInfo,
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取内存信息失败:", error);
      throw new Error(`Failed to get memory info: ${error.message}`);
    }
  }

  async _getWindowsSwapInfo() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-CimInstance Win32_PageFileUsage | Select-Object AllocatedBaseSize, CurrentUsage | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "{}");
      const total = (data.AllocatedBaseSize || 0) * 1024 * 1024;
      const used = (data.CurrentUsage || 0) * 1024 * 1024;
      return { total, used, free: total - used };
    } catch {
      return { total: 0, used: 0, free: 0 };
    }
  }

  async _getUnixSwapInfo() {
    try {
      const { stdout } = await execAsync("free -b | grep Swap");
      const parts = stdout.trim().split(/\s+/);
      return {
        total: parseInt(parts[1]) || 0,
        used: parseInt(parts[2]) || 0,
        free: parseInt(parts[3]) || 0,
      };
    } catch {
      return { total: 0, used: 0, free: 0 };
    }
  }

  /**
   * 获取电池状态
   */
  async getBattery(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取电池状态`);

    try {
      let battery = null;

      if (isWindows) {
        battery = await this._getWindowsBattery();
      } else if (isMac) {
        battery = await this._getMacBattery();
      } else if (isLinux) {
        battery = await this._getLinuxBattery();
      }

      return {
        success: true,
        battery,
        hasBattery: battery !== null,
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取电池状态失败:", error);
      return {
        success: true,
        battery: null,
        hasBattery: false,
        error: error.message,
      };
    }
  }

  async _getWindowsBattery() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "null");
      if (!data) {
        return null;
      }

      const statusMap = {
        1: "discharging",
        2: "charging",
        3: "full",
        4: "low",
        5: "critical",
      };

      return {
        percent: data.EstimatedChargeRemaining || 0,
        status: statusMap[data.BatteryStatus] || "unknown",
        timeRemaining: data.EstimatedRunTime || null,
        isCharging: data.BatteryStatus === 2,
      };
    } catch {
      return null;
    }
  }

  async _getMacBattery() {
    try {
      const { stdout } = await execAsync(
        "pmset -g batt | grep -E 'InternalBattery|charging|discharging'",
      );
      const match = stdout.match(/(\d+)%/);
      const percent = match ? parseInt(match[1]) : 0;
      const isCharging =
        stdout.includes("charging") && !stdout.includes("discharging");

      return {
        percent,
        status: isCharging ? "charging" : "discharging",
        isCharging,
      };
    } catch {
      return null;
    }
  }

  async _getLinuxBattery() {
    try {
      const { stdout: capacity } = await execAsync(
        "cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1",
      );
      const { stdout: status } = await execAsync(
        "cat /sys/class/power_supply/BAT*/status 2>/dev/null | head -1",
      );

      const percent = parseInt(capacity.trim()) || 0;
      const statusLower = status.trim().toLowerCase();

      return {
        percent,
        status: statusLower,
        isCharging: statusLower === "charging",
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取系统温度
   */
  async getTemperature(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取系统温度`);

    try {
      let temps = [];

      if (isWindows) {
        temps = await this._getWindowsTemperature();
      } else if (isMac) {
        temps = await this._getMacTemperature();
      } else if (isLinux) {
        temps = await this._getLinuxTemperature();
      }

      return {
        success: true,
        temperatures: temps,
        hasData: temps.length > 0,
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取温度失败:", error);
      return {
        success: true,
        temperatures: [],
        hasData: false,
        error: error.message,
      };
    }
  }

  async _getWindowsTemperature() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi 2>$null | Select-Object InstanceName, CurrentTemperature | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "[]");
      const temps = Array.isArray(data) ? data : [data];

      return temps
        .filter((t) => t.CurrentTemperature)
        .map((t) => ({
          name: t.InstanceName || "Unknown",
          celsius: ((t.CurrentTemperature - 2732) / 10).toFixed(1),
        }));
    } catch {
      return [];
    }
  }

  async _getMacTemperature() {
    // macOS 需要第三方工具如 osx-cpu-temp
    try {
      const { stdout } = await execAsync("osx-cpu-temp 2>/dev/null");
      const match = stdout.match(/([\d.]+)°C/);
      if (match) {
        return [{ name: "CPU", celsius: match[1] }];
      }
      return [];
    } catch {
      return [];
    }
  }

  async _getLinuxTemperature() {
    try {
      const { stdout } = await execAsync(
        "cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null",
      );
      const temps = stdout.trim().split("\n").filter(Boolean);
      return temps.map((t, i) => ({
        name: `Zone ${i}`,
        celsius: (parseInt(t) / 1000).toFixed(1),
      }));
    } catch {
      try {
        const { stdout } = await execAsync(
          "sensors 2>/dev/null | grep -E '^Core|^temp'",
        );
        const lines = stdout.trim().split("\n").filter(Boolean);
        return lines
          .map((line) => {
            const match = line.match(/([^:]+):\s*\+([\d.]+)°C/);
            if (match) {
              return { name: match[1].trim(), celsius: match[2] };
            }
            return null;
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    }
  }

  /**
   * 获取系统运行时间
   */
  async getUptime(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取系统运行时间`);

    try {
      const uptimeSeconds = os.uptime();
      const days = Math.floor(uptimeSeconds / 86400);
      const hours = Math.floor((uptimeSeconds % 86400) / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      const seconds = Math.floor(uptimeSeconds % 60);

      const bootTime = new Date(Date.now() - uptimeSeconds * 1000);

      return {
        success: true,
        uptime: {
          seconds: uptimeSeconds,
          formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
          days,
          hours,
          minutes,
          bootTime: bootTime.toISOString(),
        },
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取运行时间失败:", error);
      throw new Error(`Failed to get uptime: ${error.message}`);
    }
  }

  /**
   * 获取操作系统信息
   */
  async getOS(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取操作系统信息`);

    try {
      const osInfo = {
        platform: os.platform(),
        type: os.type(),
        release: os.release(),
        version: os.version ? os.version() : "Unknown",
        arch: os.arch(),
        hostname: os.hostname(),
        userInfo: {
          username: os.userInfo().username,
          homedir: os.userInfo().homedir,
        },
      };

      // 获取详细版本信息
      if (isWindows) {
        const details = await this._getWindowsOSDetails();
        Object.assign(osInfo, details);
      } else if (isMac) {
        const details = await this._getMacOSDetails();
        Object.assign(osInfo, details);
      } else if (isLinux) {
        const details = await this._getLinuxOSDetails();
        Object.assign(osInfo, details);
      }

      return {
        success: true,
        os: osInfo,
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取操作系统信息失败:", error);
      throw new Error(`Failed to get OS info: ${error.message}`);
    }
  }

  async _getWindowsOSDetails() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "(Get-CimInstance Win32_OperatingSystem).Caption"',
      );
      return { name: stdout.trim() };
    } catch {
      return {};
    }
  }

  async _getMacOSDetails() {
    try {
      const { stdout } = await execAsync("sw_vers");
      const lines = stdout.trim().split("\n");
      const details = {};
      for (const line of lines) {
        const [key, value] = line.split(":").map((s) => s.trim());
        if (key === "ProductName") {
          details.name = value;
        }
        if (key === "ProductVersion") {
          details.version = value;
        }
        if (key === "BuildVersion") {
          details.build = value;
        }
      }
      return details;
    } catch {
      return {};
    }
  }

  async _getLinuxOSDetails() {
    try {
      const { stdout } = await execAsync("cat /etc/os-release");
      const lines = stdout.trim().split("\n");
      const details = {};
      for (const line of lines) {
        const [key, value] = line.split("=");
        if (key === "NAME") {
          details.name = value?.replace(/"/g, "");
        }
        if (key === "VERSION") {
          details.version = value?.replace(/"/g, "");
        }
        if (key === "ID") {
          details.id = value?.replace(/"/g, "");
        }
      }
      return details;
    } catch {
      return {};
    }
  }

  /**
   * 获取硬件信息
   */
  async getHardware(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取硬件信息`);

    // 使用缓存（硬件信息不常变化）
    const now = Date.now();
    if (this.cache.hardware && now - this.cache.hardwareTime < 60000) {
      return {
        success: true,
        hardware: this.cache.hardware,
        cached: true,
      };
    }

    try {
      const hardware = {
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        platform: os.platform(),
        arch: os.arch(),
        endianness: os.endianness(),
      };

      if (isWindows) {
        const details = await this._getWindowsHardwareDetails();
        Object.assign(hardware, details);
      } else if (isMac) {
        const details = await this._getMacHardwareDetails();
        Object.assign(hardware, details);
      } else if (isLinux) {
        const details = await this._getLinuxHardwareDetails();
        Object.assign(hardware, details);
      }

      this.cache.hardware = hardware;
      this.cache.hardwareTime = now;

      return {
        success: true,
        hardware,
        cached: false,
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取硬件信息失败:", error);
      throw new Error(`Failed to get hardware info: ${error.message}`);
    }
  }

  async _getWindowsHardwareDetails() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, SystemType | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "{}");
      return {
        manufacturer: data.Manufacturer,
        model: data.Model,
        systemType: data.SystemType,
      };
    } catch {
      return {};
    }
  }

  async _getMacHardwareDetails() {
    try {
      const { stdout } = await execAsync(
        "system_profiler SPHardwareDataType | grep -E 'Model|Chip|Memory'",
      );
      const details = {};
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const [key, value] = line.split(":").map((s) => s.trim());
        if (key?.includes("Model")) {
          details.model = value;
        }
        if (key?.includes("Chip")) {
          details.chip = value;
        }
      }
      return details;
    } catch {
      return {};
    }
  }

  async _getLinuxHardwareDetails() {
    try {
      const { stdout: vendor } = await execAsync(
        "cat /sys/class/dmi/id/sys_vendor 2>/dev/null",
      );
      const { stdout: model } = await execAsync(
        "cat /sys/class/dmi/id/product_name 2>/dev/null",
      );
      return {
        manufacturer: vendor.trim(),
        model: model.trim(),
      };
    } catch {
      return {};
    }
  }

  /**
   * 获取系统日志
   */
  async getLogs(params, context) {
    const { type = "system", lines = this.options.maxLogLines } = params;

    logger.debug(`[SystemInfoHandler] 获取系统日志: ${type}`);

    try {
      let logs = [];
      const maxLines = Math.min(lines, this.options.maxLogLines);

      if (isWindows) {
        logs = await this._getWindowsLogs(type, maxLines);
      } else if (isMac) {
        logs = await this._getMacLogs(type, maxLines);
      } else if (isLinux) {
        logs = await this._getLinuxLogs(type, maxLines);
      }

      return {
        success: true,
        logs,
        type,
        count: logs.length,
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取系统日志失败:", error);
      throw new Error(`Failed to get logs: ${error.message}`);
    }
  }

  async _getWindowsLogs(type, lines) {
    try {
      const logName = type === "application" ? "Application" : "System";
      const { stdout } = await execAsync(
        `powershell -command "Get-EventLog -LogName ${logName} -Newest ${lines} | Select-Object TimeGenerated, EntryType, Source, Message | ConvertTo-Json"`,
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const data = JSON.parse(stdout || "[]");
      const logs = Array.isArray(data) ? data : [data];
      return logs.map((log) => ({
        time: log.TimeGenerated,
        type: log.EntryType,
        source: log.Source,
        message: (log.Message || "").substring(0, 500),
      }));
    } catch {
      return [];
    }
  }

  async _getMacLogs(type, lines) {
    try {
      const { stdout } = await execAsync(
        `log show --last 1h --style syslog | tail -${lines}`,
      );
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => ({
          message: line,
        }));
    } catch {
      return [];
    }
  }

  async _getLinuxLogs(type, lines) {
    try {
      const { stdout } = await execAsync(
        `journalctl -n ${lines} --no-pager 2>/dev/null || tail -${lines} /var/log/syslog 2>/dev/null || tail -${lines} /var/log/messages 2>/dev/null`,
      );
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => ({
          message: line,
        }));
    } catch {
      return [];
    }
  }

  /**
   * 获取系统服务状态
   */
  async getServices(params = {}, context) {
    const { filter } = params;

    logger.debug(`[SystemInfoHandler] 获取系统服务状态`);

    try {
      let services = [];

      if (isWindows) {
        services = await this._getWindowsServices();
      } else if (isMac) {
        services = await this._getMacServices();
      } else if (isLinux) {
        services = await this._getLinuxServices();
      }

      // 过滤
      if (filter) {
        const filterLower = filter.toLowerCase();
        services = services.filter((s) =>
          s.name.toLowerCase().includes(filterLower),
        );
      }

      return {
        success: true,
        services: services.slice(0, 100),
        total: services.length,
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取服务状态失败:", error);
      throw new Error(`Failed to get services: ${error.message}`);
    }
  }

  async _getWindowsServices() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-Service | Select-Object Name, DisplayName, Status | ConvertTo-Json"',
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const data = JSON.parse(stdout || "[]");
      const services = Array.isArray(data) ? data : [data];
      return services.map((s) => ({
        name: s.Name,
        displayName: s.DisplayName,
        status: s.Status === 4 ? "running" : "stopped",
      }));
    } catch {
      return [];
    }
  }

  async _getMacServices() {
    try {
      const { stdout } = await execAsync("launchctl list | tail -n +2");
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          return {
            name: parts[2] || parts[1],
            pid: parts[0] !== "-" ? parseInt(parts[0]) : null,
            status: parts[0] !== "-" ? "running" : "stopped",
          };
        });
    } catch {
      return [];
    }
  }

  async _getLinuxServices() {
    try {
      const { stdout } = await execAsync(
        "systemctl list-units --type=service --no-pager --plain 2>/dev/null | head -100",
      );
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          return {
            name: parts[0],
            status: parts[2] === "running" ? "running" : "stopped",
            description: parts.slice(4).join(" "),
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * 获取性能摘要
   */
  async getPerformance(params = {}, context) {
    logger.debug(`[SystemInfoHandler] 获取性能摘要`);

    try {
      // 并行获取各项数据
      const [cpuResult, memoryResult, uptimeResult] = await Promise.all([
        this.getCPU({}, context),
        this.getMemory({}, context),
        this.getUptime({}, context),
      ]);

      // 尝试获取电池（可能失败）
      let batteryResult = { battery: null };
      try {
        batteryResult = await this.getBattery({}, context);
      } catch {
        // 忽略
      }

      return {
        success: true,
        performance: {
          cpu: {
            usage: cpuResult.cpu.usage,
            cores: cpuResult.cpu.cores,
            model: cpuResult.cpu.model,
          },
          memory: {
            usagePercent: memoryResult.memory.usagePercent,
            usedGB: memoryResult.memory.usedGB,
            totalGB: memoryResult.memory.totalGB,
          },
          uptime: uptimeResult.uptime.formatted,
          battery: batteryResult.battery,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("[SystemInfoHandler] 获取性能摘要失败:", error);
      throw new Error(`Failed to get performance: ${error.message}`);
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    this.cache = { hardware: null, hardwareTime: 0 };
    logger.info("[SystemInfoHandler] 资源已清理");
  }
}

module.exports = { SystemInfoHandler };
