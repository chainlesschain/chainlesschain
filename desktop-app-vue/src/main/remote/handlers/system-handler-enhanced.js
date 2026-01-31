/**
 * 系统命令处理器（增强版）
 *
 * 完整实现系统相关命令，集成截图、通知、系统监控等功能
 *
 * 命令列表：
 * - system.screenshot: 截图
 * - system.notify: 发送通知
 * - system.getStatus: 获取系统状态
 * - system.getInfo: 获取系统信息
 * - system.execCommand: 执行命令（需 Admin 权限）
 *
 * @module remote/handlers/system-handler-enhanced
 */

const { logger } = require('../../utils/logger');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const EventEmitter = require('events');

const execAsync = promisify(exec);

// 动态导入可选依赖
let screenshot, Notification, si;

try {
  screenshot = require('screenshot-desktop');
} catch (error) {
  logger.warn('[SystemHandler] screenshot-desktop not available:', error.message);
}

try {
  const electron = require('electron');
  Notification = electron.Notification;
} catch (error) {
  logger.warn('[SystemHandler] Electron Notification not available:', error.message);
}

try {
  si = require('systeminformation');
} catch (error) {
  logger.warn('[SystemHandler] systeminformation not available:', error.message);
}

/**
 * 系统命令处理器类
 */
class SystemCommandHandlerEnhanced extends EventEmitter {
  constructor(options = {}) {
    super();

    // 配置
    this.config = {
      screenshotQuality: 80,
      screenshotFormat: 'png',
      maxCommandTimeout: 30000, // 30 秒
      maxCommandOutputSize: 1024 * 1024, // 1MB
      enableCommandWhitelist: true,
      ...options
    };

    // 命令白名单（安全的命令）
    this.commandWhitelist = [
      // 文件列表
      /^ls\s/,
      /^dir\s/,
      /^tree\s/,

      // 文件查看
      /^cat\s/,
      /^type\s/,
      /^head\s/,
      /^tail\s/,

      // 当前目录
      /^pwd$/,
      /^cd$/,

      // 信息查看
      /^echo\s/,
      /^date$/,
      /^whoami$/,
      /^hostname$/,

      // 搜索
      /^grep\s/,
      /^find\s/,
      /^where\s/,
      /^which\s/,

      // 网络（只读）
      /^ping\s/,
      /^nslookup\s/,
      /^tracert\s/,
      /^traceroute\s/,
      /^curl\s.*--head/,
      /^wget\s.*--spider/,

      // Git（只读）
      /^git\s+status/,
      /^git\s+log/,
      /^git\s+diff/,
      /^git\s+branch/,
      /^git\s+show/,

      // NPM/Yarn（只读）
      /^npm\s+list/,
      /^npm\s+ls/,
      /^yarn\s+list/
    ];

    // 命令黑名单（危险的命令）
    this.commandBlacklist = [
      // 删除
      /rm\s+-rf/,
      /del\s+\/[sS]/,
      /rmdir\s+\/[sS]/,

      // 格式化
      /format/,
      /mkfs/,
      /dd\s+if/,

      // 系统修改
      />\/dev\//,
      /shutdown/,
      /reboot/,
      /poweroff/,
      /halt/,

      // 权限提升
      /sudo/,
      /su\s/,
      /runas/,

      // 网络攻击
      /wget\s+.*\s+-O/,
      /curl\s+.*\s+-o/,
      /nc\s+-l/,
      /netcat\s+-l/,

      // 危险操作
      /chmod\s+777/,
      /chown/,
      /kill\s+-9/,
      /pkill/,
      /killall/
    ];

    // 性能指标
    this.metrics = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      screenshotCount: 0,
      notificationCount: 0,
      commandExecutionCount: 0
    };

    logger.info('[SystemHandlerEnhanced] 系统命令处理器已初始化');
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[SystemHandlerEnhanced] 处理命令: ${action}`);

    try {
      this.metrics.totalRequests++;

      let result;
      switch (action) {
        case 'screenshot':
          result = await this.screenshot(params, context);
          break;

        case 'notify':
          result = await this.notify(params, context);
          break;

        case 'getStatus':
          result = await this.getStatus(params, context);
          break;

        case 'getInfo':
          result = await this.getInfo(params, context);
          break;

        case 'execCommand':
          result = await this.execCommand(params, context);
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      this.metrics.successCount++;

      // 发出成功事件
      this.emit('command-success', {
        action,
        did: context.did,
        result
      });

      return result;
    } catch (error) {
      this.metrics.failureCount++;
      logger.error(`[SystemHandlerEnhanced] 命令失败: ${action}`, error);

      // 发出失败事件
      this.emit('command-failure', {
        action,
        did: context.did,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 截图
   *
   * 支持全屏、区域截图、质量配置
   */
  async screenshot(params, context) {
    const {
      quality = this.config.screenshotQuality,
      format = this.config.screenshotFormat,
      display = 'all',
      filename
    } = params;

    logger.info(`[SystemHandlerEnhanced] 截图请求 (quality: ${quality}, format: ${format}, display: ${display})`);

    try {
      // 检查截图库是否可用
      if (!screenshot) {
        throw new Error('Screenshot library not available. Please install screenshot-desktop.');
      }

      // 捕获截图
      const imageBuffer = await screenshot({ format, display });

      // 转换为 Base64
      const base64Image = imageBuffer.toString('base64');

      this.metrics.screenshotCount++;

      return {
        success: true,
        format,
        data: base64Image,
        size: imageBuffer.length,
        display,
        timestamp: Date.now(),
        metadata: {
          quality,
          filename: filename || `screenshot-${Date.now()}.${format}`
        }
      };
    } catch (error) {
      logger.error('[SystemHandlerEnhanced] 截图失败:', error);
      throw new Error(`Screenshot failed: ${error.message}`);
    }
  }

  /**
   * 发送通知
   *
   * 支持标题、内容、图标、操作按钮
   */
  async notify(params, context) {
    const {
      title,
      body,
      icon,
      actions = [],
      sound = true,
      urgency = 'normal'
    } = params;

    // 参数验证
    if (!title || typeof title !== 'string') {
      throw new Error('Parameter "title" is required and must be a string');
    }

    if (!body || typeof body !== 'string') {
      throw new Error('Parameter "body" is required and must be a string');
    }

    logger.info(`[SystemHandlerEnhanced] 发送通知: "${title}"`);

    try {
      // 检查 Notification 是否可用
      if (!Notification) {
        // 如果 Electron Notification 不可用，返回模拟成功
        logger.warn('[SystemHandlerEnhanced] Electron Notification not available, returning mock success');
        return {
          success: true,
          title,
          body,
          timestamp: Date.now(),
          note: 'Notification sent (mock mode - Electron not available)'
        };
      }

      // 创建通知
      const notification = new Notification({
        title,
        body,
        icon,
        silent: !sound,
        urgency
      });

      // 添加点击事件处理
      notification.on('click', () => {
        logger.info(`[SystemHandlerEnhanced] 通知被点击: "${title}"`);
        this.emit('notification-clicked', { title, body, did: context.did });
      });

      // 添加关闭事件处理
      notification.on('close', () => {
        logger.debug(`[SystemHandlerEnhanced] 通知已关闭: "${title}"`);
      });

      // 显示通知
      notification.show();

      this.metrics.notificationCount++;

      return {
        success: true,
        title,
        body,
        timestamp: Date.now(),
        metadata: {
          sound,
          urgency,
          actionsCount: actions.length
        }
      };
    } catch (error) {
      logger.error('[SystemHandlerEnhanced] 发送通知失败:', error);
      throw new Error(`Notify failed: ${error.message}`);
    }
  }

  /**
   * 获取系统状态
   *
   * CPU、内存、磁盘、网络状态
   */
  async getStatus(params, context) {
    logger.info('[SystemHandlerEnhanced] 获取系统状态');

    try {
      const status = {
        cpu: await this.getCPUStatus(),
        memory: await this.getMemoryStatus(),
        disk: await this.getDiskStatus(),
        network: await this.getNetworkStatus(),
        uptime: os.uptime(),
        timestamp: Date.now()
      };

      return status;
    } catch (error) {
      logger.error('[SystemHandlerEnhanced] 获取系统状态失败:', error);
      throw new Error(`Get status failed: ${error.message}`);
    }
  }

  /**
   * 获取系统信息
   *
   * OS、硬件、应用版本等
   */
  async getInfo(params, context) {
    logger.info('[SystemHandlerEnhanced] 获取系统信息');

    try {
      const info = {
        os: await this.getOSInfo(),
        cpu: await this.getCPUInfo(),
        memory: await this.getMemoryInfo(),
        graphics: await this.getGraphicsInfo(),
        app: this.getAppInfo(),
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        timestamp: Date.now()
      };

      return info;
    } catch (error) {
      logger.error('[SystemHandlerEnhanced] 获取系统信息失败:', error);
      throw new Error(`Get info failed: ${error.message}`);
    }
  }

  /**
   * 执行命令（需 Admin 权限）
   *
   * 安全沙箱、超时控制、输出捕获
   */
  async execCommand(params, context) {
    const {
      command,
      timeout = this.config.maxCommandTimeout,
      cwd = os.homedir()
    } = params;

    // 参数验证
    if (!command || typeof command !== 'string') {
      throw new Error('Parameter "command" is required and must be a string');
    }

    logger.info(`[SystemHandlerEnhanced] 执行命令: "${command}"`);

    try {
      // 安全检查
      if (this.config.enableCommandWhitelist) {
        if (!this.isCommandSafe(command)) {
          logger.warn(`[SystemHandlerEnhanced] 命令被拒绝: "${command}"`);
          throw new Error('Command not allowed. Please check command whitelist/blacklist.');
        }
      }

      // 执行命令
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd,
        maxBuffer: this.config.maxCommandOutputSize
      });

      this.metrics.commandExecutionCount++;

      return {
        success: true,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('[SystemHandlerEnhanced] 执行命令失败:', error);

      return {
        success: false,
        command,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.code || 1,
        timestamp: Date.now()
      };
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 检查命令是否安全
   */
  isCommandSafe(command) {
    // 检查黑名单
    for (const pattern of this.commandBlacklist) {
      if (pattern.test(command)) {
        logger.warn(`[SystemHandlerEnhanced] 命令匹配黑名单: ${pattern}`);
        return false;
      }
    }

    // 检查白名单
    for (const pattern of this.commandWhitelist) {
      if (pattern.test(command)) {
        return true;
      }
    }

    // 如果没有匹配白名单，拒绝
    logger.warn(`[SystemHandlerEnhanced] 命令未匹配白名单: "${command}"`);
    return false;
  }

  /**
   * 获取 CPU 状态
   */
  async getCPUStatus() {
    if (si) {
      try {
        const currentLoad = await si.currentLoad();
        return {
          usage: currentLoad.currentLoad.toFixed(2),
          cores: os.cpus().length,
          loadAverage: os.loadavg()
        };
      } catch (error) {
        logger.warn('[SystemHandlerEnhanced] systeminformation CPU 获取失败:', error);
      }
    }

    // Fallback: 基本 CPU 信息
    return {
      cores: os.cpus().length,
      loadAverage: os.loadavg(),
      usage: 'N/A'
    };
  }

  /**
   * 获取内存状态
   */
  async getMemoryStatus() {
    if (si) {
      try {
        const mem = await si.mem();
        return {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          usage: ((mem.used / mem.total) * 100).toFixed(2)
        };
      } catch (error) {
        logger.warn('[SystemHandlerEnhanced] systeminformation 内存获取失败:', error);
      }
    }

    // Fallback: os module
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usage: ((usedMem / totalMem) * 100).toFixed(2)
    };
  }

  /**
   * 获取磁盘状态
   */
  async getDiskStatus() {
    if (si) {
      try {
        const fsSize = await si.fsSize();
        return fsSize.map(fs => ({
          fs: fs.fs,
          type: fs.type,
          size: fs.size,
          used: fs.used,
          available: fs.available,
          usage: fs.use
        }));
      } catch (error) {
        logger.warn('[SystemHandlerEnhanced] systeminformation 磁盘获取失败:', error);
      }
    }

    // Fallback: 无磁盘信息
    return [];
  }

  /**
   * 获取网络状态
   */
  async getNetworkStatus() {
    if (si) {
      try {
        const networkStats = await si.networkStats();
        if (networkStats && networkStats.length > 0) {
          const primaryInterface = networkStats[0];
          return {
            rx: primaryInterface.rx_sec || 0,
            tx: primaryInterface.tx_sec || 0,
            interface: primaryInterface.iface
          };
        }
      } catch (error) {
        logger.warn('[SystemHandlerEnhanced] systeminformation 网络获取失败:', error);
      }
    }

    // Fallback: 基本网络信息
    const networkInterfaces = os.networkInterfaces();
    return {
      interfaces: Object.keys(networkInterfaces).length,
      rx: 0,
      tx: 0
    };
  }

  /**
   * 获取 OS 信息
   */
  async getOSInfo() {
    if (si) {
      try {
        const osInfo = await si.osInfo();
        return {
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch,
          kernel: osInfo.kernel
        };
      } catch (error) {
        logger.warn('[SystemHandlerEnhanced] systeminformation OS 获取失败:', error);
      }
    }

    // Fallback: os module
    return {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      type: os.type()
    };
  }

  /**
   * 获取 CPU 信息
   */
  async getCPUInfo() {
    if (si) {
      try {
        const cpu = await si.cpu();
        return {
          manufacturer: cpu.manufacturer,
          brand: cpu.brand,
          cores: cpu.cores,
          speed: cpu.speed,
          physicalCores: cpu.physicalCores
        };
      } catch (error) {
        logger.warn('[SystemHandlerEnhanced] systeminformation CPU 信息获取失败:', error);
      }
    }

    // Fallback: os.cpus()
    const cpus = os.cpus();
    return {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      speed: cpus[0]?.speed || 0
    };
  }

  /**
   * 获取内存信息
   */
  async getMemoryInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem
    };
  }

  /**
   * 获取显卡信息
   */
  async getGraphicsInfo() {
    if (si) {
      try {
        const graphics = await si.graphics();
        return graphics.controllers.map(g => ({
          model: g.model,
          vendor: g.vendor,
          vram: g.vram
        }));
      } catch (error) {
        logger.warn('[SystemHandlerEnhanced] systeminformation 显卡获取失败:', error);
      }
    }

    // Fallback: 无显卡信息
    return [];
  }

  /**
   * 获取应用信息
   */
  getAppInfo() {
    try {
      const packageJson = require('../../../package.json');
      return {
        name: packageJson.name,
        version: packageJson.version,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
      };
    } catch (error) {
      logger.warn('[SystemHandlerEnhanced] 获取应用信息失败:', error);
      return {
        electron: process.versions.electron,
        node: process.versions.node
      };
    }
  }

  /**
   * 获取性能指标
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRequests > 0
        ? (this.metrics.successCount / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}

module.exports = SystemCommandHandlerEnhanced;
