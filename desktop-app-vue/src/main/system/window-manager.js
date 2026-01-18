/**
 * 窗口管理器
 * 管理多窗口、窗口状态保存和恢复
 */

const { BrowserWindow, screen } = require("electron");
const path = require("path");
const fs = require("fs");

class WindowManager {
  constructor() {
    this.windows = new Map(); // windowId -> window
    this.windowStates = new Map(); // windowId -> state
    this.stateFilePath = path.join(
      require("electron").app.getPath("userData"),
      "window-states.json",
    );

    // 加载保存的窗口状态
    this.loadStates();
  }

  /**
   * 创建窗口
   */
  createWindow(options = {}) {
    const windowId = options.id || `window-${Date.now()}`;
    const savedState = this.windowStates.get(windowId);

    // 合并保存的状态和新选项
    const windowOptions = {
      width: savedState?.width || options.width || 1200,
      height: savedState?.height || options.height || 800,
      x: savedState?.x || options.x,
      y: savedState?.y || options.y,
      minWidth: options.minWidth || 800,
      minHeight: options.minHeight || 600,
      show: false, // 先不显示，等ready-to-show事件
      backgroundColor: options.backgroundColor || "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: options.preload || path.join(__dirname, "../preload/index.js"),
        ...options.webPreferences,
      },
      ...options,
    };

    // 确保窗口在屏幕范围内
    this.ensureWindowInBounds(windowOptions);

    const window = new BrowserWindow(windowOptions);

    // 恢复最大化状态
    if (savedState?.isMaximized) {
      window.maximize();
    }

    // 恢复全屏状态
    if (savedState?.isFullScreen) {
      window.setFullScreen(true);
    }

    // 监听窗口事件
    this.setupWindowListeners(window, windowId);

    // 保存窗口引用
    this.windows.set(windowId, window);

    // ready-to-show 事件
    window.once("ready-to-show", () => {
      window.show();
      if (options.focus !== false) {
        window.focus();
      }
    });

    return { window, windowId };
  }

  /**
   * 设置窗口监听器
   */
  setupWindowListeners(window, windowId) {
    // 窗口移动
    window.on("move", () => {
      this.saveWindowState(window, windowId);
    });

    // 窗口调整大小
    window.on("resize", () => {
      this.saveWindowState(window, windowId);
    });

    // 窗口最大化
    window.on("maximize", () => {
      this.saveWindowState(window, windowId);
    });

    // 窗口取消最大化
    window.on("unmaximize", () => {
      this.saveWindowState(window, windowId);
    });

    // 窗口进入全屏
    window.on("enter-full-screen", () => {
      this.saveWindowState(window, windowId);
    });

    // 窗口退出全屏
    window.on("leave-full-screen", () => {
      this.saveWindowState(window, windowId);
    });

    // 窗口关闭
    window.on("closed", () => {
      this.windows.delete(windowId);
    });
  }

  /**
   * 保存窗口状态
   */
  saveWindowState(window, windowId) {
    if (!window || window.isDestroyed()) return;

    const bounds = window.getBounds();
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
      isMinimized: window.isMinimized(),
    };

    this.windowStates.set(windowId, state);
    this.saveStates();
  }

  /**
   * 确保窗口在屏幕范围内
   */
  ensureWindowInBounds(options) {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    // 如果没有指定位置，居中显示
    if (options.x === undefined || options.y === undefined) {
      const { width, height } = primaryDisplay.workAreaSize;
      options.x = Math.round((width - options.width) / 2);
      options.y = Math.round((height - options.height) / 2);
      return;
    }

    // 检查窗口是否在任何显示器范围内
    let isInBounds = false;
    for (const display of displays) {
      const { x, y, width, height } = display.bounds;
      if (
        options.x >= x &&
        options.x < x + width &&
        options.y >= y &&
        options.y < y + height
      ) {
        isInBounds = true;
        break;
      }
    }

    // 如果不在范围内，重置到主显示器中心
    if (!isInBounds) {
      const { width, height } = primaryDisplay.workAreaSize;
      options.x = Math.round((width - options.width) / 2);
      options.y = Math.round((height - options.height) / 2);
    }
  }

  /**
   * 获取窗口
   */
  getWindow(windowId) {
    return this.windows.get(windowId);
  }

  /**
   * 获取所有窗口
   */
  getAllWindows() {
    return Array.from(this.windows.values());
  }

  /**
   * 关闭窗口
   */
  closeWindow(windowId) {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      window.close();
    }
  }

  /**
   * 关闭所有窗口
   */
  closeAllWindows() {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) {
        window.close();
      }
    }
    this.windows.clear();
  }

  /**
   * 显示窗口
   */
  showWindow(windowId) {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
  }

  /**
   * 隐藏窗口
   */
  hideWindow(windowId) {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      window.hide();
    }
  }

  /**
   * 最小化窗口
   */
  minimizeWindow(windowId) {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      window.minimize();
    }
  }

  /**
   * 最大化窗口
   */
  maximizeWindow(windowId) {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  }

  /**
   * 全屏窗口
   */
  toggleFullScreen(windowId) {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      window.setFullScreen(!window.isFullScreen());
    }
  }

  /**
   * 设置窗口置顶
   */
  setAlwaysOnTop(windowId, flag) {
    const window = this.windows.get(windowId);
    if (window && !window.isDestroyed()) {
      window.setAlwaysOnTop(flag);
    }
  }

  /**
   * 加载窗口状态
   */
  loadStates() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, "utf8");
        const states = JSON.parse(data);
        this.windowStates = new Map(Object.entries(states));
        console.log("[WindowManager] Window states loaded");
      }
    } catch (error) {
      console.error("[WindowManager] Failed to load window states:", error);
    }
  }

  /**
   * 保存窗口状态到文件
   */
  saveStates() {
    try {
      const states = Object.fromEntries(this.windowStates);
      fs.writeFileSync(this.stateFilePath, JSON.stringify(states, null, 2));
    } catch (error) {
      console.error("[WindowManager] Failed to save window states:", error);
    }
  }

  /**
   * 清除保存的状态
   */
  clearStates() {
    this.windowStates.clear();
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.unlinkSync(this.stateFilePath);
      }
    } catch (error) {
      console.error("[WindowManager] Failed to clear window states:", error);
    }
  }

  /**
   * 获取窗口数量
   */
  getWindowCount() {
    return this.windows.size;
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.closeAllWindows();
    this.saveStates();
  }
}

// 创建单例
let windowManager = null;

function getWindowManager() {
  if (!windowManager) {
    windowManager = new WindowManager();
  }
  return windowManager;
}

module.exports = { WindowManager, getWindowManager };
