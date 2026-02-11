/**
 * 显示器信息远程处理器
 *
 * 处理来自 Android 端的显示器相关命令：
 * - display.getDisplays: 获取显示器列表 (PUBLIC)
 * - display.getPrimary: 获取主显示器信息 (PUBLIC)
 * - display.getResolution: 获取分辨率 (PUBLIC)
 * - display.getBrightness: 获取亮度 (PUBLIC)
 * - display.setBrightness: 设置亮度 (NORMAL)
 * - display.getScaling: 获取缩放比例 (PUBLIC)
 * - display.getRefreshRate: 获取刷新率 (PUBLIC)
 * - display.getColorDepth: 获取色深 (PUBLIC)
 * - display.screenshot: 截取屏幕 (NORMAL)
 * - display.getWindowList: 获取窗口列表 (NORMAL)
 *
 * @module remote/handlers/display-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const { screen, desktopCapturer, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const os = require("os");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * 验证亮度值
 * @param {any} value - 输入值
 * @returns {number|null} 有效的亮度值 (0-100) 或 null
 */
function validateBrightness(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0 || num > 100) {
    return null;
  }
  return num;
}

/**
 * 显示器信息处理器类
 */
class DisplayHandler {
  constructor(options = {}) {
    this.options = {
      screenshotFormat: options.screenshotFormat || "png",
      screenshotQuality: options.screenshotQuality || 90,
      maxScreenshotSize: options.maxScreenshotSize || 4096,
      ...options,
    };

    logger.info("[DisplayHandler] 显示器信息处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[DisplayHandler] 处理命令: ${action}`);

    switch (action) {
      case "getDisplays":
        return await this.getDisplays(params, context);

      case "getPrimary":
        return await this.getPrimary(params, context);

      case "getResolution":
        return await this.getResolution(params, context);

      case "getBrightness":
        return await this.getBrightness(params, context);

      case "setBrightness":
        return await this.setBrightness(params, context);

      case "getScaling":
        return await this.getScaling(params, context);

      case "getRefreshRate":
        return await this.getRefreshRate(params, context);

      case "getColorDepth":
        return await this.getColorDepth(params, context);

      case "screenshot":
        return await this.screenshot(params, context);

      case "getWindowList":
        return await this.getWindowList(params, context);

      case "getCursorPosition":
        return await this.getCursorPosition(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取所有显示器列表
   */
  async getDisplays(params = {}, context) {
    logger.debug(`[DisplayHandler] 获取显示器列表`);

    try {
      const displays = screen.getAllDisplays();

      const result = displays.map((display, index) => ({
        id: display.id,
        label: display.label || `Display ${index + 1}`,
        bounds: display.bounds,
        workArea: display.workArea,
        size: display.size,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        colorSpace: display.colorSpace,
        colorDepth: display.colorDepth,
        internal: display.internal,
        accelerometerSupport: display.accelerometerSupport,
        touchSupport: display.touchSupport,
        monochrome: display.monochrome,
      }));

      return {
        success: true,
        displays: result,
        total: result.length,
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取显示器列表失败:", error);
      throw new Error(`Failed to get displays: ${error.message}`);
    }
  }

  /**
   * 获取主显示器信息
   */
  async getPrimary(params = {}, context) {
    logger.debug(`[DisplayHandler] 获取主显示器信息`);

    try {
      const primary = screen.getPrimaryDisplay();

      return {
        success: true,
        display: {
          id: primary.id,
          label: primary.label || "Primary Display",
          bounds: primary.bounds,
          workArea: primary.workArea,
          size: primary.size,
          scaleFactor: primary.scaleFactor,
          rotation: primary.rotation,
          colorSpace: primary.colorSpace,
          colorDepth: primary.colorDepth,
          internal: primary.internal,
        },
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取主显示器信息失败:", error);
      throw new Error(`Failed to get primary display: ${error.message}`);
    }
  }

  /**
   * 获取分辨率信息
   */
  async getResolution(params = {}, context) {
    const { displayId } = params;

    logger.debug(`[DisplayHandler] 获取分辨率`);

    try {
      let display;
      if (displayId) {
        const displays = screen.getAllDisplays();
        display = displays.find((d) => d.id === displayId);
        if (!display) {
          throw new Error(`Display ${displayId} not found`);
        }
      } else {
        display = screen.getPrimaryDisplay();
      }

      return {
        success: true,
        resolution: {
          width: display.size.width,
          height: display.size.height,
          scaleFactor: display.scaleFactor,
          effectiveWidth: Math.round(display.size.width * display.scaleFactor),
          effectiveHeight: Math.round(
            display.size.height * display.scaleFactor,
          ),
          aspectRatio: this._calculateAspectRatio(
            display.size.width,
            display.size.height,
          ),
        },
        displayId: display.id,
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取分辨率失败:", error);
      throw new Error(`Failed to get resolution: ${error.message}`);
    }
  }

  _calculateAspectRatio(width, height) {
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
  }

  /**
   * 获取亮度
   */
  async getBrightness(params = {}, context) {
    logger.debug(`[DisplayHandler] 获取亮度`);

    try {
      let brightness = null;

      if (isWindows) {
        brightness = await this._getWindowsBrightness();
      } else if (isMac) {
        brightness = await this._getMacBrightness();
      } else if (isLinux) {
        brightness = await this._getLinuxBrightness();
      }

      return {
        success: true,
        brightness,
        platform: process.platform,
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取亮度失败:", error);
      return {
        success: true,
        brightness: null,
        error: error.message,
        platform: process.platform,
      };
    }
  }

  async _getWindowsBrightness() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"',
      );
      return parseInt(stdout.trim()) || null;
    } catch {
      // 可能不是笔记本电脑
      return null;
    }
  }

  async _getMacBrightness() {
    try {
      const { stdout } = await execAsync(
        "brightness -l 2>/dev/null | grep brightness | head -1 | awk '{print $2}'",
      );
      const value = parseFloat(stdout.trim());
      return isNaN(value) ? null : Math.round(value * 100);
    } catch {
      return null;
    }
  }

  async _getLinuxBrightness() {
    try {
      const { stdout: max } = await execAsync(
        "cat /sys/class/backlight/*/max_brightness 2>/dev/null | head -1",
      );
      const { stdout: current } = await execAsync(
        "cat /sys/class/backlight/*/brightness 2>/dev/null | head -1",
      );

      const maxVal = parseInt(max.trim());
      const currentVal = parseInt(current.trim());

      if (maxVal > 0) {
        return Math.round((currentVal / maxVal) * 100);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 设置亮度
   */
  async setBrightness(params, context) {
    const { brightness } = params;

    const validBrightness = validateBrightness(brightness);
    if (validBrightness === null) {
      throw new Error(
        'Parameter "brightness" must be a number between 0 and 100',
      );
    }

    logger.info(`[DisplayHandler] 设置亮度: ${validBrightness}%`);

    try {
      if (isWindows) {
        await this._setWindowsBrightness(validBrightness);
      } else if (isMac) {
        await this._setMacBrightness(validBrightness);
      } else if (isLinux) {
        await this._setLinuxBrightness(validBrightness);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        brightness: validBrightness,
        message: `Brightness set to ${validBrightness}%`,
      };
    } catch (error) {
      logger.error("[DisplayHandler] 设置亮度失败:", error);
      throw new Error(`Failed to set brightness: ${error.message}`);
    }
  }

  async _setWindowsBrightness(brightness) {
    await execAsync(
      `powershell -command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${brightness})"`,
    );
  }

  async _setMacBrightness(brightness) {
    const value = brightness / 100;
    await execAsync(`brightness ${value}`);
  }

  async _setLinuxBrightness(brightness) {
    const { stdout: max } = await execAsync(
      "cat /sys/class/backlight/*/max_brightness 2>/dev/null | head -1",
    );
    const maxVal = parseInt(max.trim());
    if (maxVal > 0) {
      const newValue = Math.round((brightness / 100) * maxVal);
      await execAsync(
        `echo ${newValue} | sudo tee /sys/class/backlight/*/brightness`,
      );
    }
  }

  /**
   * 获取缩放比例
   */
  async getScaling(params = {}, context) {
    const { displayId } = params;

    logger.debug(`[DisplayHandler] 获取缩放比例`);

    try {
      let display;
      if (displayId) {
        const displays = screen.getAllDisplays();
        display = displays.find((d) => d.id === displayId);
        if (!display) {
          throw new Error(`Display ${displayId} not found`);
        }
      } else {
        display = screen.getPrimaryDisplay();
      }

      return {
        success: true,
        scaling: {
          factor: display.scaleFactor,
          percentage: Math.round(display.scaleFactor * 100),
        },
        displayId: display.id,
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取缩放比例失败:", error);
      throw new Error(`Failed to get scaling: ${error.message}`);
    }
  }

  /**
   * 获取刷新率
   */
  async getRefreshRate(params = {}, context) {
    logger.debug(`[DisplayHandler] 获取刷新率`);

    try {
      let refreshRate = null;

      if (isWindows) {
        refreshRate = await this._getWindowsRefreshRate();
      } else if (isMac) {
        refreshRate = await this._getMacRefreshRate();
      } else if (isLinux) {
        refreshRate = await this._getLinuxRefreshRate();
      }

      return {
        success: true,
        refreshRate,
        unit: "Hz",
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取刷新率失败:", error);
      return {
        success: true,
        refreshRate: null,
        error: error.message,
      };
    }
  }

  async _getWindowsRefreshRate() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "(Get-CimInstance Win32_VideoController).CurrentRefreshRate"',
      );
      return parseInt(stdout.trim()) || null;
    } catch {
      return null;
    }
  }

  async _getMacRefreshRate() {
    try {
      const { stdout } = await execAsync(
        "system_profiler SPDisplaysDataType | grep 'UI Looks like' -A 1 | tail -1",
      );
      const match = stdout.match(/(\d+)\s*Hz/i);
      return match ? parseInt(match[1]) : 60; // Default to 60Hz
    } catch {
      return 60;
    }
  }

  async _getLinuxRefreshRate() {
    try {
      const { stdout } = await execAsync(
        "xrandr 2>/dev/null | grep '*' | awk '{print $2}'",
      );
      const match = stdout.match(/([\d.]+)/);
      return match ? Math.round(parseFloat(match[1])) : null;
    } catch {
      return null;
    }
  }

  /**
   * 获取色深
   */
  async getColorDepth(params = {}, context) {
    const { displayId } = params;

    logger.debug(`[DisplayHandler] 获取色深`);

    try {
      let display;
      if (displayId) {
        const displays = screen.getAllDisplays();
        display = displays.find((d) => d.id === displayId);
        if (!display) {
          throw new Error(`Display ${displayId} not found`);
        }
      } else {
        display = screen.getPrimaryDisplay();
      }

      return {
        success: true,
        colorDepth: display.colorDepth || 24,
        bitsPerPixel: display.colorDepth || 24,
        displayId: display.id,
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取色深失败:", error);
      throw new Error(`Failed to get color depth: ${error.message}`);
    }
  }

  /**
   * 截取屏幕
   */
  async screenshot(params = {}, context) {
    const {
      displayId,
      format = this.options.screenshotFormat,
      quality = this.options.screenshotQuality,
      savePath,
    } = params;

    logger.info(`[DisplayHandler] 截取屏幕 (format: ${format})`);

    try {
      // 获取目标显示器
      let display;
      if (displayId) {
        const displays = screen.getAllDisplays();
        display = displays.find((d) => d.id === displayId);
        if (!display) {
          throw new Error(`Display ${displayId} not found`);
        }
      } else {
        display = screen.getPrimaryDisplay();
      }

      // 使用 desktopCapturer 截图
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.min(display.size.width, this.options.maxScreenshotSize),
          height: Math.min(display.size.height, this.options.maxScreenshotSize),
        },
      });

      // 找到对应的源
      const source =
        sources.find((s) => s.display_id === display.id.toString()) ||
        sources[0];

      if (!source) {
        throw new Error("No screen source found");
      }

      // 获取缩略图
      const thumbnail = source.thumbnail;

      // 转换格式
      let imageData;
      if (format === "png") {
        imageData = thumbnail.toPNG();
      } else if (format === "jpeg" || format === "jpg") {
        imageData = thumbnail.toJPEG(quality);
      } else {
        imageData = thumbnail.toPNG();
      }

      // 保存或返回
      if (savePath) {
        await fs.writeFile(savePath, imageData);
        return {
          success: true,
          saved: true,
          path: savePath,
          size: imageData.length,
          format,
          dimensions: {
            width: thumbnail.getSize().width,
            height: thumbnail.getSize().height,
          },
        };
      } else {
        // 返回 base64
        const base64 = imageData.toString("base64");
        return {
          success: true,
          saved: false,
          data: base64,
          dataUrl: `data:image/${format};base64,${base64}`,
          size: imageData.length,
          format,
          dimensions: {
            width: thumbnail.getSize().width,
            height: thumbnail.getSize().height,
          },
        };
      }
    } catch (error) {
      logger.error("[DisplayHandler] 截取屏幕失败:", error);
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  /**
   * 获取窗口列表
   */
  async getWindowList(params = {}, context) {
    logger.debug(`[DisplayHandler] 获取窗口列表`);

    try {
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 150, height: 150 },
      });

      const windows = sources.map((source) => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id,
        appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
      }));

      return {
        success: true,
        windows,
        total: windows.length,
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取窗口列表失败:", error);
      throw new Error(`Failed to get window list: ${error.message}`);
    }
  }

  /**
   * 获取鼠标位置
   */
  async getCursorPosition(params = {}, context) {
    logger.debug(`[DisplayHandler] 获取鼠标位置`);

    try {
      const point = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(point);

      return {
        success: true,
        cursor: {
          x: point.x,
          y: point.y,
        },
        displayId: display.id,
        inWorkArea: this._pointInRect(point, display.workArea),
      };
    } catch (error) {
      logger.error("[DisplayHandler] 获取鼠标位置失败:", error);
      throw new Error(`Failed to get cursor position: ${error.message}`);
    }
  }

  _pointInRect(point, rect) {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[DisplayHandler] 资源已清理");
  }
}

module.exports = { DisplayHandler };
