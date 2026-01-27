/**
 * 远程桌面命令处理器
 *
 * 处理远程桌面相关命令：
 * - desktop.startSession: 开始远程桌面会话
 * - desktop.stopSession: 停止远程桌面会话
 * - desktop.getFrame: 获取屏幕帧
 * - desktop.sendInput: 发送输入事件（鼠标/键盘）
 * - desktop.getDisplays: 获取显示器列表
 * - desktop.switchDisplay: 切换显示器
 *
 * @module remote/handlers/remote-desktop-handler
 */

const { logger } = require('../../utils/logger');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const { EventEmitter } = require('events');

// 尝试加载 robotjs（可选）
let robot = null;
try {
  robot = require('robotjs');
  logger.info('[RemoteDesktopHandler] robotjs 已加载');
} catch (err) {
  logger.warn('[RemoteDesktopHandler] robotjs 未安装，输入功能将不可用');
}

// 默认配置
const DEFAULT_CONFIG = {
  maxFps: 30,                    // 最大帧率
  quality: 80,                   // JPEG 质量 (1-100)
  format: 'jpeg',                // 图片格式 (jpeg/png)
  width: 1920,                   // 最大宽度
  height: 1080,                  // 最大高度
  enableHardwareAccel: true,     // 启用硬件加速（预留）
  enableDifferentialEncoding: false, // 启用差分编码（预留）
  captureInterval: 33,           // 捕获间隔（ms，33ms ≈ 30fps）
  enableInputControl: true,      // 启用输入控制
  mouseSpeed: 1.0,               // 鼠标速度倍数
  keyboardDelay: 10,             // 键盘延迟（ms）
};

/**
 * 远程桌面命令处理器类
 */
class RemoteDesktopHandler extends EventEmitter {
  constructor(database, options = {}) {
    super();
    this.database = database;
    this.options = { ...DEFAULT_CONFIG, ...options };

    // 活动会话映射 { sessionId: Session }
    this.sessions = new Map();

    // 性能统计
    this.stats = {
      totalFrames: 0,
      totalBytes: 0,
      avgFrameSize: 0,
      avgCaptureTime: 0,
      avgEncodeTime: 0,
    };

    logger.info('[RemoteDesktopHandler] 远程桌面处理器已初始化', {
      maxFps: this.options.maxFps,
      quality: this.options.quality,
      robotjs: robot !== null,
    });
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[RemoteDesktopHandler] 处理命令: ${action}`);

    switch (action) {
      case 'startSession':
        return await this.startSession(params, context);

      case 'stopSession':
        return await this.stopSession(params, context);

      case 'getFrame':
        return await this.getFrame(params, context);

      case 'sendInput':
        return await this.sendInput(params, context);

      case 'getDisplays':
        return await this.getDisplays(params, context);

      case 'switchDisplay':
        return await this.switchDisplay(params, context);

      case 'getStats':
        return await this.getStats(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 开始远程桌面会话
   */
  async startSession(params, context) {
    const { displayId = null, quality, maxFps } = params;

    // 生成会话 ID
    const sessionId = `desktop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`[RemoteDesktopHandler] 开始远程桌面会话: ${sessionId} for ${context.did}`);

    try {
      // 创建会话
      const session = {
        sessionId,
        deviceDid: context.did,
        displayId: displayId || undefined,
        quality: quality || this.options.quality,
        maxFps: maxFps || this.options.maxFps,
        captureInterval: Math.floor(1000 / (maxFps || this.options.maxFps)),
        status: 'active',
        startedAt: Date.now(),
        lastFrameAt: null,
        frameCount: 0,
        bytesSent: 0,
      };

      this.sessions.set(sessionId, session);

      // 保存到数据库（可选）
      try {
        this.database
          .prepare(
            `
            INSERT INTO remote_desktop_sessions
            (id, device_did, display_id, quality, max_fps, status, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            sessionId,
            context.did,
            displayId || null,
            session.quality,
            session.maxFps,
            'active',
            Date.now()
          );
      } catch (error) {
        logger.warn('[RemoteDesktopHandler] 保存会话到数据库失败:', error);
      }

      // 获取显示器信息
      const displays = await this.getAvailableDisplays();

      return {
        sessionId,
        quality: session.quality,
        maxFps: session.maxFps,
        captureInterval: session.captureInterval,
        displays,
        inputControlEnabled: this.options.enableInputControl && robot !== null,
      };
    } catch (error) {
      logger.error('[RemoteDesktopHandler] 开始会话失败:', error);
      throw new Error(`Failed to start session: ${error.message}`);
    }
  }

  /**
   * 停止远程桌面会话
   */
  async stopSession(params, context) {
    const { sessionId } = params;

    // 验证参数
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Parameter "sessionId" is required and must be a string');
    }

    // 获取会话
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 验证设备
    if (session.deviceDid !== context.did) {
      throw new Error('Permission denied: device DID mismatch');
    }

    logger.info(`[RemoteDesktopHandler] 停止远程桌面会话: ${sessionId}`);

    // 更新会话状态
    session.status = 'stopped';
    session.stoppedAt = Date.now();
    session.duration = session.stoppedAt - session.startedAt;

    // 更新数据库
    try {
      this.database
        .prepare(
          `
          UPDATE remote_desktop_sessions
          SET status = ?, stopped_at = ?, duration = ?, frame_count = ?, bytes_sent = ?
          WHERE id = ?
        `
        )
        .run(
          'stopped',
          session.stoppedAt,
          session.duration,
          session.frameCount,
          session.bytesSent,
          sessionId
        );
    } catch (error) {
      logger.warn('[RemoteDesktopHandler] 更新数据库失败:', error);
    }

    // 移除会话
    this.sessions.delete(sessionId);

    return {
      sessionId,
      duration: session.duration,
      frameCount: session.frameCount,
      bytesSent: session.bytesSent,
      avgFps: session.duration > 0 ? (session.frameCount / (session.duration / 1000)).toFixed(2) : 0,
    };
  }

  /**
   * 获取屏幕帧
   */
  async getFrame(params, context) {
    const { sessionId, displayId } = params;

    // 验证参数
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Parameter "sessionId" is required and must be a string');
    }

    // 获取会话
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 验证设备
    if (session.deviceDid !== context.did) {
      throw new Error('Permission denied: device DID mismatch');
    }

    // 检查会话状态
    if (session.status !== 'active') {
      throw new Error(`Session is not active: ${session.status}`);
    }

    // 限制帧率
    const now = Date.now();
    if (session.lastFrameAt && (now - session.lastFrameAt) < session.captureInterval) {
      const waitTime = session.captureInterval - (now - session.lastFrameAt);
      throw new Error(`Frame rate limit exceeded. Wait ${waitTime}ms`);
    }

    logger.debug(`[RemoteDesktopHandler] 捕获屏幕帧 for session ${sessionId}`);

    const captureStart = Date.now();

    try {
      // 捕获屏幕
      const targetDisplay = displayId !== undefined ? displayId : session.displayId;
      const screenshotBuffer = await screenshot({
        screen: targetDisplay,
        format: 'png', // screenshot-desktop 返回 PNG
      });

      const captureTime = Date.now() - captureStart;

      // 编码和压缩
      const encodeStart = Date.now();

      let processedBuffer;
      let width;
      let height;

      if (this.options.format === 'jpeg') {
        // 转换为 JPEG 并调整大小
        const sharpInstance = sharp(screenshotBuffer);
        const metadata = await sharpInstance.metadata();

        width = metadata.width;
        height = metadata.height;

        // 调整大小（如果超过最大尺寸）
        if (width > this.options.width || height > this.options.height) {
          sharpInstance.resize(this.options.width, this.options.height, {
            fit: 'inside',
            withoutEnlargement: true,
          });
        }

        processedBuffer = await sharpInstance
          .jpeg({ quality: session.quality })
          .toBuffer();
      } else {
        // PNG 格式
        const sharpInstance = sharp(screenshotBuffer);
        const metadata = await sharpInstance.metadata();

        width = metadata.width;
        height = metadata.height;

        if (width > this.options.width || height > this.options.height) {
          sharpInstance.resize(this.options.width, this.options.height, {
            fit: 'inside',
            withoutEnlargement: true,
          });
        }

        processedBuffer = await sharpInstance.png().toBuffer();
      }

      const encodeTime = Date.now() - encodeStart;

      // 转换为 Base64
      const frameData = processedBuffer.toString('base64');
      const frameSize = frameData.length;

      // 更新会话统计
      session.lastFrameAt = now;
      session.frameCount++;
      session.bytesSent += frameSize;

      // 更新全局统计
      this.stats.totalFrames++;
      this.stats.totalBytes += frameSize;
      this.stats.avgFrameSize = this.stats.totalBytes / this.stats.totalFrames;
      this.stats.avgCaptureTime =
        (this.stats.avgCaptureTime * (this.stats.totalFrames - 1) + captureTime) /
        this.stats.totalFrames;
      this.stats.avgEncodeTime =
        (this.stats.avgEncodeTime * (this.stats.totalFrames - 1) + encodeTime) /
        this.stats.totalFrames;

      logger.debug(
        `[RemoteDesktopHandler] 帧捕获完成: ${frameSize} bytes, capture: ${captureTime}ms, encode: ${encodeTime}ms`
      );

      return {
        sessionId,
        frameData,
        width,
        height,
        format: this.options.format,
        size: frameSize,
        timestamp: now,
        captureTime,
        encodeTime,
      };
    } catch (error) {
      logger.error('[RemoteDesktopHandler] 捕获屏幕帧失败:', error);
      throw new Error(`Failed to capture frame: ${error.message}`);
    }
  }

  /**
   * 发送输入事件（鼠标/键盘）
   */
  async sendInput(params, context) {
    const { sessionId, type, data } = params;

    // 验证参数
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Parameter "sessionId" is required and must be a string');
    }

    if (!type || typeof type !== 'string') {
      throw new Error('Parameter "type" is required and must be a string');
    }

    // 获取会话
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 验证设备
    if (session.deviceDid !== context.did) {
      throw new Error('Permission denied: device DID mismatch');
    }

    // 检查输入控制是否启用
    if (!this.options.enableInputControl) {
      throw new Error('Input control is disabled');
    }

    if (!robot) {
      throw new Error('Input control is not available (robotjs not installed)');
    }

    logger.debug(`[RemoteDesktopHandler] 发送输入事件: ${type}`, data);

    try {
      switch (type) {
        case 'mouse_move':
          return await this.handleMouseMove(data);

        case 'mouse_click':
          return await this.handleMouseClick(data);

        case 'mouse_scroll':
          return await this.handleMouseScroll(data);

        case 'key_press':
          return await this.handleKeyPress(data);

        case 'key_type':
          return await this.handleKeyType(data);

        default:
          throw new Error(`Unknown input type: ${type}`);
      }
    } catch (error) {
      logger.error('[RemoteDesktopHandler] 发送输入失败:', error);
      throw new Error(`Failed to send input: ${error.message}`);
    }
  }

  /**
   * 处理鼠标移动
   */
  async handleMouseMove(data) {
    const { x, y } = data;

    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new Error('Invalid mouse coordinates');
    }

    robot.moveMouse(
      Math.floor(x * this.options.mouseSpeed),
      Math.floor(y * this.options.mouseSpeed)
    );

    return { success: true };
  }

  /**
   * 处理鼠标点击
   */
  async handleMouseClick(data) {
    const { button = 'left', double = false } = data;

    if (double) {
      robot.mouseClick(button, true); // double click
    } else {
      robot.mouseClick(button, false); // single click
    }

    return { success: true };
  }

  /**
   * 处理鼠标滚动
   */
  async handleMouseScroll(data) {
    const { dx = 0, dy = 0 } = data;

    if (dy !== 0) {
      robot.scrollMouse(Math.floor(dx), Math.floor(dy));
    }

    return { success: true };
  }

  /**
   * 处理按键
   */
  async handleKeyPress(data) {
    const { key, modifiers = [] } = data;

    if (!key || typeof key !== 'string') {
      throw new Error('Invalid key');
    }

    // 按下修饰键
    for (const modifier of modifiers) {
      robot.keyToggle(modifier, 'down');
    }

    // 按下目标键
    robot.keyTap(key);

    // 释放修饰键
    for (const modifier of modifiers.reverse()) {
      robot.keyToggle(modifier, 'up');
    }

    return { success: true };
  }

  /**
   * 处理文本输入
   */
  async handleKeyType(data) {
    const { text } = data;

    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text');
    }

    robot.typeString(text);

    // 添加延迟
    if (this.options.keyboardDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.keyboardDelay));
    }

    return { success: true };
  }

  /**
   * 获取显示器列表
   */
  async getDisplays(params, context) {
    logger.debug('[RemoteDesktopHandler] 获取显示器列表');

    try {
      const displays = await this.getAvailableDisplays();

      return {
        displays,
        count: displays.length,
      };
    } catch (error) {
      logger.error('[RemoteDesktopHandler] 获取显示器列表失败:', error);
      throw new Error(`Failed to get displays: ${error.message}`);
    }
  }

  /**
   * 切换显示器
   */
  async switchDisplay(params, context) {
    const { sessionId, displayId } = params;

    // 验证参数
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Parameter "sessionId" is required and must be a string');
    }

    if (typeof displayId !== 'number') {
      throw new Error('Parameter "displayId" is required and must be a number');
    }

    // 获取会话
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 验证设备
    if (session.deviceDid !== context.did) {
      throw new Error('Permission denied: device DID mismatch');
    }

    logger.info(`[RemoteDesktopHandler] 切换显示器: ${sessionId} -> display ${displayId}`);

    // 更新会话
    session.displayId = displayId;

    return {
      sessionId,
      displayId,
    };
  }

  /**
   * 获取性能统计
   */
  async getStats(params, context) {
    return {
      totalFrames: this.stats.totalFrames,
      totalBytes: this.stats.totalBytes,
      avgFrameSize: Math.floor(this.stats.avgFrameSize),
      avgCaptureTime: Math.floor(this.stats.avgCaptureTime),
      avgEncodeTime: Math.floor(this.stats.avgEncodeTime),
      activeSessions: this.sessions.size,
    };
  }

  /**
   * 获取可用显示器列表
   */
  async getAvailableDisplays() {
    try {
      // screenshot-desktop 会返回所有显示器
      const displays = await screenshot.listDisplays();

      return displays.map((display, index) => ({
        id: display.id || index,
        name: display.name || `Display ${index + 1}`,
        width: display.width || null,
        height: display.height || null,
        primary: display.primary || false,
      }));
    } catch (error) {
      logger.warn('[RemoteDesktopHandler] 获取显示器列表失败，返回默认值:', error);
      // 返回默认显示器
      return [
        {
          id: 0,
          name: 'Primary Display',
          width: null,
          height: null,
          primary: true,
        },
      ];
    }
  }

  /**
   * 清理过期会话（可定期调用）
   */
  async cleanupExpiredSessions(maxAge = 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.startedAt > maxAge) {
        logger.info(`[RemoteDesktopHandler] 清理过期会话: ${sessionId}`);

        // 更新数据库
        try {
          this.database
            .prepare(
              `
              UPDATE remote_desktop_sessions
              SET status = 'expired'
              WHERE id = ?
            `
            )
            .run(sessionId);
        } catch (error) {
          logger.error('[RemoteDesktopHandler] 更新数据库失败:', error);
        }

        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[RemoteDesktopHandler] 清理了 ${cleaned} 个过期会话`);
    }

    return cleaned;
  }
}

module.exports = { RemoteDesktopHandler };
