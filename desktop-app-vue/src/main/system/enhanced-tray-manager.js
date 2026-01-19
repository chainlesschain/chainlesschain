/**
 * 增强的系统托盘管理器
 * 提供丰富的托盘菜单和快捷操作
 */

const { logger, createLogger } = require('../utils/logger.js');
const { Tray, Menu, nativeImage, app } = require("electron");
const path = require("path");

class EnhancedTrayManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.tray = null;
    this.contextMenu = null;
    this.flashInterval = null;
    this.notificationCount = 0;
  }

  /**
   * 创建托盘
   */
  create() {
    try {
      // 创建托盘图标
      const iconPath = this.getIconPath();
      const icon = nativeImage.createFromPath(iconPath);

      this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
      this.tray.setToolTip("ChainlessChain - 个人AI管理系统");

      // 创建上下文菜单
      this.updateContextMenu();

      // 托盘图标点击事件
      this.tray.on("click", () => {
        this.toggleWindow();
      });

      // 双击事件
      this.tray.on("double-click", () => {
        this.showWindow();
      });

      logger.info("[TrayManager] Tray created successfully");
    } catch (error) {
      logger.error("[TrayManager] Failed to create tray:", error);
    }
  }

  /**
   * 获取图标路径
   */
  getIconPath() {
    const platform = process.platform;
    let iconName = "icon.png";

    if (platform === "win32") {
      iconName = "icon.ico";
    } else if (platform === "darwin") {
      iconName = "iconTemplate.png";
    }

    // 尝试多个可能的路径
    const possiblePaths = [
      path.join(__dirname, "../../resources", iconName),
      path.join(__dirname, "../../../resources", iconName),
      path.join(process.resourcesPath, iconName),
      path.join(app.getAppPath(), "resources", iconName),
    ];

    for (const iconPath of possiblePaths) {
      if (require("fs").existsSync(iconPath)) {
        return iconPath;
      }
    }

    // 如果找不到图标，返回默认路径
    return possiblePaths[0];
  }

  /**
   * 更新上下文菜单
   */
  updateContextMenu(options = {}) {
    const menuTemplate = [
      {
        label: "显示主窗口",
        click: () => this.showWindow(),
      },
      {
        type: "separator",
      },
      {
        label: "快速操作",
        submenu: [
          {
            label: "新建笔记",
            accelerator: "CmdOrCtrl+N",
            click: () => this.sendToRenderer("quick-action", "new-note"),
          },
          {
            label: "全局搜索",
            accelerator: "CmdOrCtrl+K",
            click: () => this.sendToRenderer("quick-action", "global-search"),
          },
          {
            label: "开始对话",
            accelerator: "CmdOrCtrl+Shift+C",
            click: () => this.sendToRenderer("quick-action", "new-chat"),
          },
          {
            type: "separator",
          },
          {
            label: "截图识别",
            click: () => this.sendToRenderer("quick-action", "screenshot-ocr"),
          },
          {
            label: "剪贴板导入",
            click: () =>
              this.sendToRenderer("quick-action", "clipboard-import"),
          },
        ],
      },
      {
        label: "同步",
        submenu: [
          {
            label: "立即同步",
            click: () => this.sendToRenderer("sync", "now"),
          },
          {
            label: "自动同步",
            type: "checkbox",
            checked: options.autoSync !== false,
            click: (menuItem) => {
              this.sendToRenderer("sync", "toggle-auto", menuItem.checked);
            },
          },
          {
            type: "separator",
          },
          {
            label: "同步状态",
            enabled: false,
          },
          {
            label: options.syncStatus || "未同步",
            enabled: false,
          },
        ],
      },
      {
        label: "通知",
        submenu: [
          {
            label: `未读通知 (${this.notificationCount})`,
            click: () => this.sendToRenderer("show-notifications"),
          },
          {
            type: "separator",
          },
          {
            label: "通知设置",
            click: () => this.sendToRenderer("open-settings", "notifications"),
          },
        ],
      },
      {
        type: "separator",
      },
      {
        label: "性能监控",
        submenu: [
          {
            label: "查看性能",
            click: () => this.sendToRenderer("show-performance"),
          },
          {
            label: "内存使用",
            enabled: false,
          },
          {
            label: options.memoryUsage || "加载中...",
            enabled: false,
          },
        ],
      },
      {
        label: "设置",
        click: () => this.sendToRenderer("open-settings"),
      },
      {
        type: "separator",
      },
      {
        label: "关于",
        click: () => this.sendToRenderer("show-about"),
      },
      {
        label: "检查更新",
        click: () => this.sendToRenderer("check-update"),
      },
      {
        type: "separator",
      },
      {
        label: "退出",
        accelerator: "CmdOrCtrl+Q",
        click: () => {
          app.quit();
        },
      },
    ];

    this.contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(this.contextMenu);
  }

  /**
   * 切换窗口显示/隐藏
   */
  toggleWindow() {
    if (!this.mainWindow) {return;}

    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.showWindow();
    }
  }

  /**
   * 显示窗口
   */
  showWindow() {
    if (!this.mainWindow) {return;}

    this.mainWindow.show();
    this.mainWindow.focus();

    // 停止闪烁
    this.stopFlashing();
  }

  /**
   * 隐藏窗口
   */
  hideWindow() {
    if (!this.mainWindow) {return;}
    this.mainWindow.hide();
  }

  /**
   * 发送消息到渲染进程
   */
  sendToRenderer(channel, ...args) {
    if (!this.mainWindow || !this.mainWindow.webContents) {return;}

    this.mainWindow.webContents.send(channel, ...args);
  }

  /**
   * 更新通知计数
   */
  setNotificationCount(count) {
    this.notificationCount = count;
    this.updateContextMenu();

    // 更新托盘标题（仅macOS）
    if (process.platform === "darwin" && this.tray) {
      this.tray.setTitle(count > 0 ? `${count}` : "");
    }

    // 如果有新通知，开始闪烁
    if (count > 0 && !this.mainWindow.isFocused()) {
      this.startFlashing();
    }
  }

  /**
   * 开始闪烁托盘图标
   */
  startFlashing() {
    if (this.flashInterval) {return;}

    let isHighlighted = false;
    this.flashInterval = setInterval(() => {
      if (!this.tray) {
        this.stopFlashing();
        return;
      }

      const iconPath = this.getIconPath();
      const icon = nativeImage.createFromPath(iconPath);

      if (isHighlighted) {
        this.tray.setImage(icon.resize({ width: 16, height: 16 }));
      } else {
        // 创建一个高亮版本（可以是不同的图标或添加效果）
        this.tray.setImage(icon.resize({ width: 16, height: 16 }));
      }

      isHighlighted = !isHighlighted;
    }, 500);
  }

  /**
   * 停止闪烁托盘图标
   */
  stopFlashing() {
    if (this.flashInterval) {
      clearInterval(this.flashInterval);
      this.flashInterval = null;

      // 恢复正常图标
      const iconPath = this.getIconPath();
      const icon = nativeImage.createFromPath(iconPath);
      this.tray.setImage(icon.resize({ width: 16, height: 16 }));
    }
  }

  /**
   * 显示气球通知（Windows）
   */
  displayBalloon(title, content, icon = null) {
    if (!this.tray || process.platform !== "win32") {return;}

    this.tray.displayBalloon({
      title,
      content,
      icon: icon || this.getIconPath(),
    });
  }

  /**
   * 更新同步状态
   */
  updateSyncStatus(status) {
    this.updateContextMenu({ syncStatus: status });
  }

  /**
   * 更新内存使用
   */
  updateMemoryUsage(usage) {
    this.updateContextMenu({ memoryUsage: usage });
  }

  /**
   * 销毁托盘
   */
  destroy() {
    this.stopFlashing();

    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = EnhancedTrayManager;
