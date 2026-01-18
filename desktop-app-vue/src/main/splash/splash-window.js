/**
 * Splash Window Manager
 * 启动画面窗口管理器
 *
 * 在应用启动时显示一个轻量级的启动画面，展示启动进度和状态
 */

const { BrowserWindow } = require("electron");
const path = require("path");

class SplashWindow {
  constructor() {
    this.window = null;
    this.isCreated = false;
  }

  /**
   * 创建 Splash 窗口
   * @returns {Promise<boolean>} 是否创建成功
   */
  async create() {
    try {
      this.window = new BrowserWindow({
        width: 400,
        height: 300,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        center: true,
        resizable: false,
        skipTaskbar: true,
        show: false, // 先隐藏，加载完成后再显示
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, "splash-preload.js"),
        },
      });

      // 加载 HTML 文件
      const htmlPath = path.join(__dirname, "splash.html");
      await this.window.loadFile(htmlPath);

      // 显示窗口
      this.window.show();
      this.isCreated = true;

      console.log("[Splash] 启动画面已创建");
      return true;
    } catch (error) {
      console.error("[Splash] 创建启动画面失败:", error);
      this.isCreated = false;
      return false;
    }
  }

  /**
   * 更新进度
   * @param {string} step - 当前步骤描述
   * @param {number} percentage - 进度百分比 (0-100)
   */
  updateProgress(step, percentage) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    try {
      this.window.webContents.send("splash:update-progress", {
        step,
        percentage: Math.min(100, Math.max(0, percentage)),
      });
    } catch (error) {
      console.error("[Splash] 更新进度失败:", error);
    }
  }

  /**
   * 显示错误信息
   * @param {string} message - 错误信息
   */
  showError(message) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    try {
      this.window.webContents.send("splash:show-error", { message });
    } catch (error) {
      console.error("[Splash] 显示错误失败:", error);
    }
  }

  /**
   * 关闭 Splash 窗口
   * @param {boolean} fadeOut - 是否使用淡出效果
   */
  close(fadeOut = true) {
    if (!this.window || this.window.isDestroyed()) {
      this.isCreated = false;
      return;
    }

    try {
      if (fadeOut) {
        // 发送淡出信号
        this.window.webContents.send("splash:fade-out");

        // 等待淡出动画完成后关闭
        setTimeout(() => {
          if (this.window && !this.window.isDestroyed()) {
            this.window.close();
            this.window = null;
          }
          this.isCreated = false;
        }, 300);
      } else {
        this.window.close();
        this.window = null;
        this.isCreated = false;
      }

      console.log("[Splash] 启动画面已关闭");
    } catch (error) {
      console.error("[Splash] 关闭启动画面失败:", error);
      this.window = null;
      this.isCreated = false;
    }
  }

  /**
   * 检查窗口是否存在
   * @returns {boolean}
   */
  isActive() {
    return this.isCreated && this.window && !this.window.isDestroyed();
  }
}

module.exports = SplashWindow;
