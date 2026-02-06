/**
 * 系统命令处理器
 *
 * 处理系统相关命令：
 * - system.getStatus: 获取系统状态
 * - system.getInfo: 获取系统信息
 * - system.screenshot: 截图
 * - system.notify: 通知
 * - system.execCommand: 执行 Shell 命令（高权限）
 *
 * @module remote/handlers/system-handler
 */

const { logger } = require('../../utils/logger');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * 系统命令处理器类
 */
class SystemCommandHandler {
  constructor(mainWindow, options = {}) {
    this.mainWindow = mainWindow;
    this.options = options;

    logger.info('[SystemHandler] 系统命令处理器已初始化');
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[SystemHandler] 处理命令: ${action}`);

    switch (action) {
      case 'getStatus':
        return await this.getStatus(params, context);

      case 'getInfo':
        return await this.getInfo(params, context);

      case 'screenshot':
        return await this.screenshot(params, context);

      case 'notify':
        return await this.notify(params, context);

      case 'execCommand':
        return await this.execCommand(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取系统状态
   */
  async getStatus(params, context) {
    logger.info('[SystemHandler] 获取系统状态');

    try {
      const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsage = (usedMemory / totalMemory) * 100;

      const status = {
        cpu: {
          usage: cpuUsage.toFixed(2),
          cores: os.cpus().length,
          model: os.cpus()[0].model
        },
        memory: {
          total: totalMemory,
          used: usedMemory,
          free: freeMemory,
          usagePercent: memoryUsage.toFixed(2)
        },
        system: {
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          uptime: os.uptime()
        },
        timestamp: Date.now()
      };

      return status;
    } catch (error) {
      logger.error('[SystemHandler] 获取系统状态失败:', error);
      throw new Error(`Get status failed: ${error.message}`);
    }
  }

  /**
   * 获取系统信息
   */
  async getInfo(params, context) {
    logger.info('[SystemHandler] 获取系统信息');

    try {
      const info = {
        os: {
          type: os.type(),
          platform: os.platform(),
          arch: os.arch(),
          release: os.release(),
          version: os.version()
        },
        cpu: {
          model: os.cpus()[0].model,
          cores: os.cpus().length,
          speed: os.cpus()[0].speed
        },
        memory: {
          total: os.totalmem(),
          free: os.freemem()
        },
        network: os.networkInterfaces(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        timestamp: Date.now()
      };

      return info;
    } catch (error) {
      logger.error('[SystemHandler] 获取系统信息失败:', error);
      throw new Error(`Get info failed: ${error.message}`);
    }
  }

  /**
   * 截图
   * 使用 Electron desktopCapturer 获取屏幕截图
   */
  async screenshot(params, context) {
    const { display = 0, format = 'png', quality = 80, thumbnail = false } = params;

    logger.info(`[SystemHandler] 截图请求 (display: ${display}, format: ${format})`);

    try {
      const { desktopCapturer, screen } = require('electron');

      // 获取所有显示器
      const displays = screen.getAllDisplays();
      const targetDisplay = displays[display] || displays[0];

      if (!targetDisplay) {
        throw new Error('No display available');
      }

      const { width, height } = targetDisplay.size;

      // 获取屏幕源
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: thumbnail
          ? { width: Math.floor(width / 4), height: Math.floor(height / 4) }
          : { width, height },
      });

      // 找到目标显示器的源
      const source = sources.find(s =>
        s.display_id === targetDisplay.id.toString() ||
        s.name.includes('Screen') ||
        s.name.includes('整个屏幕') ||
        s.name.includes('Entire Screen')
      ) || sources[display] || sources[0];

      if (!source) {
        throw new Error('No screen source found');
      }

      // 获取缩略图作为 NativeImage
      const image = source.thumbnail;

      if (!image || image.isEmpty()) {
        throw new Error('Failed to capture screenshot');
      }

      // 转换为指定格式
      let base64Data;
      let mimeType;

      if (format === 'jpeg' || format === 'jpg') {
        base64Data = image.toJPEG(quality).toString('base64');
        mimeType = 'image/jpeg';
      } else {
        base64Data = image.toPNG().toString('base64');
        mimeType = 'image/png';
      }

      const imageSize = image.getSize();

      logger.info(`[SystemHandler] ✓ 截图成功: ${imageSize.width}x${imageSize.height}`);

      return {
        format: format === 'jpg' ? 'jpeg' : format,
        mimeType,
        data: base64Data,
        width: imageSize.width,
        height: imageSize.height,
        display,
        displayId: targetDisplay.id,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('[SystemHandler] 截图失败:', error);
      throw new Error(`Screenshot failed: ${error.message}`);
    }
  }

  /**
   * 发送通知
   */
  async notify(params, context) {
    const { title, body, urgency = 'normal' } = params;

    // 验证参数
    if (!title || !body) {
      throw new Error('Parameters "title" and "body" are required');
    }

    logger.info(`[SystemHandler] 发送通知: ${title}`);

    try {
      // 使用 Electron 的 Notification API
      const { Notification } = require('electron');

      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
          urgency  // 'normal', 'critical', 'low'
        });

        notification.show();

        return {
          success: true,
          title,
          body,
          timestamp: Date.now()
        };
      } else {
        throw new Error('Notifications not supported on this platform');
      }
    } catch (error) {
      logger.error('[SystemHandler] 发送通知失败:', error);
      throw new Error(`Notify failed: ${error.message}`);
    }
  }

  /**
   * 执行 Shell 命令（高权限操作）
   */
  async execCommand(params, context) {
    const { command, cwd, timeout = 30000 } = params;

    // 验证参数
    if (!command || typeof command !== 'string') {
      throw new Error('Parameter "command" is required and must be a string');
    }

    logger.warn(`[SystemHandler] 执行 Shell 命令: ${command} (来自: ${context.did})`);

    try {
      // 安全检查：禁止某些危险命令
      const dangerousCommands = ['rm -rf /', 'del /f /s /q', 'format', 'mkfs'];
      for (const dangerous of dangerousCommands) {
        if (command.includes(dangerous)) {
          throw new Error(`Dangerous command detected: ${dangerous}`);
        }
      }

      // 执行命令
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || process.cwd(),
        timeout,
        maxBuffer: 1024 * 1024  // 1MB
      });

      return {
        success: true,
        command,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('[SystemHandler] 执行命令失败:', error);

      return {
        success: false,
        command,
        stdout: error.stdout ? error.stdout.toString() : '',
        stderr: error.stderr ? error.stderr.toString() : error.message,
        exitCode: error.code || -1,
        timestamp: Date.now()
      };
    }
  }
}

module.exports = SystemCommandHandler;
