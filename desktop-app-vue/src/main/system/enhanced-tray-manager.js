/**
 * 增强的系统托盘管理器
 * 提供丰富的托盘菜单和快捷操作
 */

const { logger } = require("../utils/logger.js");
const { Tray, Menu, nativeImage, app, dialog } = require("electron");
const path = require("path");

class EnhancedTrayManager {
  /**
   * @param {BrowserWindow} mainWindow
   * @param {Object} [options]
   * @param {() => ({ broadcast: (frame: any) => void } | null)} [options.getWebShellHandle]
   *   Lazy getter for the web-shell handle. When the embedded web-panel is
   *   the loaded renderer (Phase 1.6 default), the V5/V6 IPC `tray:action`
   *   channel has no listener — dispatchTrayAction additionally broadcasts
   *   through this handle's ws-server so the SPA can route on it. Returns
   *   null when web-shell is disabled (V5/V6 shell active). v5.0.3.34.
   */
  constructor(mainWindow, options = {}) {
    this.mainWindow = mainWindow;
    this.tray = null;
    this.contextMenu = null;
    this.flashInterval = null;
    this.notificationCount = 0;
    this.getWebShellHandle =
      typeof options.getWebShellHandle === "function"
        ? options.getWebShellHandle
        : () => null;
  }

  /**
   * 创建托盘
   */
  create() {
    try {
      // 创建托盘图标
      const iconPath = this.getIconPath();
      const icon = nativeImage.createFromPath(iconPath);

      // Don't .resize() — that squashes multi-layer ICO into single 16x16
      // raster, which Windows then upscales for high-DPI screens (1.5x/2x
      // scaling is common) producing a blurry icon. Let Tray() consume the
      // multi-resolution nativeImage and pick the right layer per DPI.
      this.tray = new Tray(icon);
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

    // 候选路径顺序：
    //   1. assets/ (dev 模式：desktop-app-vue/assets/icon.ico — git 里真实存在)
    //   2. process.resourcesPath (packaged 模式：electron-builder.yml 已把
    //      assets/icon.ico 拷到 <install>/resources/icon.ico)
    //   3. 历史 resources/ 路径兜底（实际没人用，留着防止 regression）
    const possiblePaths = [
      path.join(__dirname, "../../../assets", iconName),
      path.join(process.resourcesPath, iconName),
      path.join(__dirname, "../../resources", iconName),
      path.join(__dirname, "../../../resources", iconName),
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
            click: () => this.dispatchTrayAction("quick-action", "new-note"),
          },
          {
            label: "全局搜索",
            accelerator: "CmdOrCtrl+K",
            click: () =>
              this.dispatchTrayAction("quick-action", "global-search"),
          },
          {
            label: "开始对话",
            accelerator: "CmdOrCtrl+Shift+C",
            click: () => this.dispatchTrayAction("quick-action", "new-chat"),
          },
          {
            type: "separator",
          },
          {
            label: "截图识别",
            click: () =>
              this.dispatchTrayAction("quick-action", "screenshot-ocr"),
          },
          {
            label: "剪贴板导入",
            click: () =>
              this.dispatchTrayAction("quick-action", "clipboard-import"),
          },
        ],
      },
      {
        label: "同步",
        submenu: [
          {
            label: "立即同步",
            click: () => this.dispatchTrayAction("sync", { mode: "now" }),
          },
          {
            label: "自动同步",
            type: "checkbox",
            // 默认 false：renderer 端 syncScheduler 也默认 disabled，与持久化
            // localStorage `cc.sync.autoSync` 保持一致。renderer toggle 后下
            // 次 updateContextMenu 时通过 options.autoSync 反映回来。
            checked: options.autoSync === true,
            click: (menuItem) => {
              this.dispatchTrayAction("sync", {
                mode: "toggle-auto",
                value: menuItem.checked,
              });
            },
          },
          {
            type: "separator",
          },
          {
            label: "同步设置…",
            click: () => this.dispatchTrayAction("open-settings", "sync"),
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
            click: () => this.dispatchTrayAction("show-notifications"),
          },
          {
            type: "separator",
          },
          {
            label: "通知设置",
            click: () =>
              this.dispatchTrayAction("open-settings", "notifications"),
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
            click: () => this.dispatchTrayAction("show-performance"),
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
        click: () => this.dispatchTrayAction("open-settings"),
      },
      {
        type: "separator",
      },
      {
        // 关于 → 主进程原生 dialog（不绕 renderer，简单可靠）
        label: "关于",
        click: () => this.showAboutDialog(),
      },
      {
        // 检查更新 → 直接调 auto-updater 单例。原实现 sendToRenderer
        // ("check-update") 但 renderer 全代码库没人监听该 channel，所以
        // 点了等于哑响。autoUpdater 模块自己会在主进程弹原生 dialog。
        label: "检查更新",
        click: () => this.triggerCheckForUpdates(),
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
    if (!this.mainWindow) {
      return;
    }

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
    if (!this.mainWindow) {
      return;
    }

    this.mainWindow.show();
    this.mainWindow.focus();

    // 停止闪烁
    this.stopFlashing();
  }

  /**
   * 隐藏窗口
   */
  hideWindow() {
    if (!this.mainWindow) {
      return;
    }
    this.mainWindow.hide();
  }

  /**
   * 发送消息到渲染进程（legacy，per-channel）
   */
  sendToRenderer(channel, ...args) {
    if (!this.mainWindow || !this.mainWindow.webContents) {
      return;
    }

    this.mainWindow.webContents.send(channel, ...args);
  }

  /**
   * 统一通过 "tray:action" channel 派发托盘事件给渲染进程。
   * Payload 形如 { type, payload }：renderer 监听单一 channel，按 type 分发。
   * 之前每个菜单项各发一个独立 channel（quick-action / sync / show-notifications
   * 等），renderer 一个都没监听，全部点了无效。统一通道后只要 App.vue 接住
   * "tray:action" 一个即可处理所有菜单项。
   */
  dispatchTrayAction(type, payload = null) {
    if (!this.mainWindow || !this.mainWindow.webContents) {
      logger.warn(`[TrayManager] dispatchTrayAction(${type}): no mainWindow`);
      return;
    }
    // Renderer 可能被隐藏到托盘 — 先把窗口拉出来，否则用户点了菜单看不
    // 到任何 UI 反馈，体验上跟"没反应"等价。
    if (!this.mainWindow.isVisible()) {
      this.mainWindow.show();
    }
    this.mainWindow.focus();
    // V5/V6 Vue renderer 路径 — App.vue 注册了 `tray:action` IPC listener。
    // 在 web-shell 模式下加载的是 web-panel HTML（preload 是空的），这条
    // send 实际无人接，但保留它是因为 send 本身不会抛错，且未来从 web-shell
    // 切回 V5/V6 后立即生效。
    this.mainWindow.webContents.send("tray:action", { type, payload });
    // v5.0.3.34 — web-shell 路径：通过 ws-server 广播给 web-panel SPA。
    // web-panel 的 wsStore.onMessage 监听 type==="tray:action" 后路由到
    // 对应 web-panel 路由 (/notes /chat /dashboard /project-settings 等)。
    // 当 V5/V6 渲染器活跃时 getWebShellHandle 返回 null → 跳过；当 web-shell
    // 活跃但还没有 web-panel 客户端连上时 broadcast 是 no-op (server.clients
    // 为空)。两种情况都不抛错，只是发不出去——和 IPC send 给隐藏窗口同样
    // 的容忍度。
    const webShell = this.getWebShellHandle();
    if (webShell && typeof webShell.broadcast === "function") {
      try {
        webShell.broadcast({ type: "tray:action", payload: { type, payload } });
      } catch (err) {
        logger.warn(
          `[TrayManager] web-shell broadcast(${type}) failed:`,
          err.message,
        );
      }
    }
  }

  /**
   * "关于" 菜单 → 主进程原生 dialog（不需要 renderer 配合）。
   */
  showAboutDialog() {
    let productVersion = "—";
    let appVersion = "—";
    // 优先读 build-time 烧进 dist/main/build-info.json 的常量。原因：
    // packaged 模式下 enhanced-tray-manager.js 在 app.asar 内，相对路径
    // ../../../../package.json 走出 asar，require 必失败，产品版本永远
    // 显示 "—"。build-info.json 由 scripts/build-main.js 在 build 末尾
    // 写入，dev 模式 (`npm run dev` 会跑 build:main)、packaged 模式都会
    // 存在；只在直接 import src 跑测试时不存在 → 走下面 fallback。
    try {
      const info = require("../build-info.json");
      productVersion = info.productVersion || "—";
      appVersion = info.appVersion || "—";
    } catch {
      try {
        productVersion =
          require("../../../../package.json").productVersion || "—";
      } catch {
        // ignore — root package.json not reachable in packaged builds
      }
      try {
        appVersion = require("../../../package.json").version || "—";
      } catch {
        // ignore
      }
    }
    const message = "ChainlessChain";
    const detail =
      `产品版本：${productVersion}\n` +
      `桌面版：${appVersion}\n` +
      `Electron：${process.versions.electron}\n` +
      `Node：${process.versions.node}\n` +
      `Chrome：${process.versions.chrome}\n\n` +
      `https://github.com/chainlesschain/chainlesschain`;
    dialog
      .showMessageBox(this.mainWindow, {
        type: "info",
        title: "关于 ChainlessChain",
        message,
        detail,
        buttons: ["确定"],
        defaultId: 0,
      })
      .catch((err) => {
        logger.warn("[TrayManager] showAboutDialog failed:", err.message);
      });
  }

  /**
   * "检查更新" 菜单 → 调 auto-updater 单例。模块在 dev (NODE_ENV !==
   * "production") 下 autoUpdater.checkForUpdates() 会返回 null/no-op，
   * 所以这里给一个 fallback 提示，避免用户在 dev 模式下点了又是哑响。
   */
  triggerCheckForUpdates() {
    let autoUpdater;
    let requireError = null;
    try {
      autoUpdater = require("./auto-updater.js");
    } catch (err) {
      requireError = err;
      logger.warn("[TrayManager] auto-updater require failed:", err.message);
    }
    const hasUpdater =
      autoUpdater && typeof autoUpdater.checkForUpdates === "function";
    const isProd =
      process.env.NODE_ENV === "production" || app.isPackaged === true;
    if (hasUpdater && isProd) {
      autoUpdater.checkForUpdates().catch((err) => {
        logger.warn("[TrayManager] checkForUpdates failed:", err.message);
      });
      return;
    }
    // v5.0.3.34 — 当用户在 packaged 安装版上仍看到这个 dialog（v5.0.3.32
    // 已修 NODE_ENV / app.isPackaged 二选一的判断），把诊断信息直接打到
    // detail 里，下次点击就能看出是哪一条 fail 的（autoUpdater require
    // 抛了？isPackaged === false？checkForUpdates 不是函数？），不必再
    // 让用户在 log 文件里挖。生产环境下三个值都正确时本来就走不到这里。
    const lines = [
      "自动更新仅在 packaged 安装版生效。下方为诊断字段，packaged 装的应" +
        "全部正确——若仍弹出此 dialog，截图反馈：",
      `NODE_ENV: ${process.env.NODE_ENV || "(undefined)"}`,
      `app.isPackaged: ${app.isPackaged}`,
      `autoUpdater loaded: ${autoUpdater ? "yes" : "NO"}`,
      `checkForUpdates fn: ${hasUpdater ? "yes" : "NO"}`,
    ];
    if (requireError) {
      lines.push(`require error: ${requireError.message}`);
    }
    dialog
      .showMessageBox(this.mainWindow, {
        type: "info",
        title: "检查更新",
        message: "未触发自动更新",
        detail: lines.join("\n"),
        buttons: ["确定"],
      })
      .catch(() => {});
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
    if (this.flashInterval) {
      return;
    }

    let isHighlighted = false;
    this.flashInterval = setInterval(() => {
      if (!this.tray) {
        this.stopFlashing();
        return;
      }

      const iconPath = this.getIconPath();
      const icon = nativeImage.createFromPath(iconPath);

      if (isHighlighted) {
        this.tray.setImage(icon);
      } else {
        // 创建一个高亮版本（可以是不同的图标或添加效果）
        this.tray.setImage(icon);
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
      this.tray.setImage(icon);
    }
  }

  /**
   * 显示气球通知（Windows）
   */
  displayBalloon(title, content, icon = null) {
    if (!this.tray || process.platform !== "win32") {
      return;
    }

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
