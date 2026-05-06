/**
 * ChainlessChain 自动更新模块
 * 基于 electron-updater 实现自动更新功能
 */

const { autoUpdater } = require("electron-updater");
const { dialog, BrowserWindow } = require("electron");

// v5.0.3.35 — electron-log 是 optional logger（electron-updater 文档明确支持
// winston / 任意 `{info,warn,error}` shape）。v5.0.3.34 的诊断 dialog 暴露
// 用户的 packaged install 里 require("electron-log") 抛 ENOENT — 它既不是
// desktop-app-vue 的直接依赖，electron-updater 6.x 也不再带它作 transitive
// dep，所以 packaged 时整个 auto-updater 模块 load 不进来，`autoUpdater`
// 在 enhanced-tray-manager 里始终 undefined，自动更新链路从未真正生效。
// 修复：require 走 try/catch，缺失时 fallback console，autoUpdater.logger
// 仍可用，更新流程不再依赖 electron-log 是否被打进 asar。同时 package.json
// 加了直接依赖，正常情况会有真文件日志（fallback 只是兜底）。
let log;
try {
  log = require("electron-log");
  autoUpdater.logger = log;
  // electron-log 5.x 默认 transports 已覆盖 file，这里保持显式 level 不变。
  // require 失败时跳过——electron-updater 自带最低限度 console 输出。
  if (
    autoUpdater.logger &&
    autoUpdater.logger.transports &&
    autoUpdater.logger.transports.file
  ) {
    autoUpdater.logger.transports.file.level = "info";
  }
} catch (err) {
  // Console-based fallback so existing `log.info(...)` call sites below work.
  // electron-updater itself doesn't require electron-log — it just uses
  // whatever satisfies `{info,warn,error}`. So we DON'T set autoUpdater.logger
  // in this branch, letting electron-updater's internal default take over.
  log = {
    info: (...a) => console.log("[auto-updater]", ...a),
    warn: (...a) => console.warn("[auto-updater]", ...a),
    error: (...a) => console.error("[auto-updater]", ...a),
  };
  log.warn(
    "electron-log not found, using console fallback (file logs disabled):",
    err && err.message,
  );
}

class AutoUpdater {
  constructor() {
    this.mainWindow = null;
    this.updateCheckInterval = null;
    this.checkIntervalHours = 4; // 每4小时检查一次更新

    // 配置 autoUpdater
    this.setupAutoUpdater();
  }

  /**
   * 初始化自动更新器
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
  init(mainWindow) {
    this.mainWindow = mainWindow;

    // 应用启动时检查更新
    if (!process.env.NODE_ENV || process.env.NODE_ENV === "production") {
      // 延迟3秒后检查更新，避免影响启动速度
      setTimeout(() => {
        this.checkForUpdates();
      }, 3000);

      // 设置定期检查
      this.setupPeriodicCheck();
    }
  }

  /**
   * 配置 autoUpdater 事件处理
   */
  setupAutoUpdater() {
    // 检查更新错误
    autoUpdater.on("error", (error) => {
      log.error("更新检查错误:", error);
      this.sendStatusToWindow("更新检查失败");
    });

    // 开始检查更新
    autoUpdater.on("checking-for-update", () => {
      log.info("正在检查更新...");
      this.sendStatusToWindow("正在检查更新...");
    });

    // 发现新版本
    autoUpdater.on("update-available", (info) => {
      log.info("发现新版本:", info.version);
      this.sendStatusToWindow("发现新版本");

      // 显示更新提示
      this.showUpdateAvailableDialog(info);
    });

    // 没有可用更新
    autoUpdater.on("update-not-available", (info) => {
      log.info("当前是最新版本");
      this.sendStatusToWindow("当前是最新版本");
    });

    // 更新下载进度
    autoUpdater.on("download-progress", (progressObj) => {
      let logMessage = `下载速度: ${progressObj.bytesPerSecond}`;
      logMessage += ` - 已下载 ${progressObj.percent}%`;
      logMessage += ` (${progressObj.transferred}/${progressObj.total})`;

      log.info(logMessage);
      this.sendStatusToWindow("正在下载更新", progressObj);
    });

    // 更新下载完成
    autoUpdater.on("update-downloaded", (info) => {
      log.info("更新下载完成");
      this.sendStatusToWindow("更新下载完成");

      // 显示安装提示
      this.showUpdateReadyDialog(info);
    });
  }

  /**
   * 手动检查更新
   */
  async checkForUpdates() {
    try {
      log.info("手动检查更新");
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.error("检查更新失败:", error);
    }
  }

  /**
   * 设置定期检查
   */
  setupPeriodicCheck() {
    // 清除之前的定时器
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }

    // 设置新的定时器
    const intervalMs = this.checkIntervalHours * 60 * 60 * 1000;
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMs);
  }

  /**
   * 发送状态到渲染进程
   */
  sendStatusToWindow(status, data = null) {
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send("update-status", {
        status,
        data,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * 显示"发现新版本"对话框
   */
  showUpdateAvailableDialog(info) {
    const options = {
      type: "info",
      title: "发现新版本",
      message: `ChainlessChain v${info.version} 可用`,
      detail: `当前版本: v${require("../../../package.json").version}\n新版本: v${info.version}\n\n是否立即下载更新？`,
      buttons: ["立即下载", "稍后提醒"],
      defaultId: 0,
      cancelId: 1,
    };

    if (this.mainWindow) {
      dialog.showMessageBox(this.mainWindow, options).then((result) => {
        if (result.response === 0) {
          // 立即下载
          log.info("用户选择立即下载更新");
          autoUpdater.downloadUpdate();
        } else {
          log.info("用户选择稍后更新");
        }
      });
    }
  }

  /**
   * 显示"更新就绪"对话框
   */
  showUpdateReadyDialog(info) {
    const options = {
      type: "info",
      title: "更新已下载",
      message: "新版本已下载完成",
      detail: `ChainlessChain v${info.version} 已准备好安装。\n\n是否立即重启应用以安装更新？`,
      buttons: ["立即重启", "稍后重启"],
      defaultId: 0,
      cancelId: 1,
    };

    if (this.mainWindow) {
      dialog.showMessageBox(this.mainWindow, options).then((result) => {
        if (result.response === 0) {
          // 立即重启安装
          log.info("用户选择立即重启安装更新");
          autoUpdater.quitAndInstall(false, true);
        } else {
          log.info("用户选择稍后重启");
          // 下次启动时会自动安装
        }
      });
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return {
      currentVersion: require("../../../package.json").version,
      checkIntervalHours: this.checkIntervalHours,
      updateServer: autoUpdater.getFeedURL(),
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
    };
  }

  /**
   * 设置更新服务器 URL
   * @param {string} url - 更新服务器 URL
   */
  setFeedURL(url) {
    try {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: url,
      });
      log.info("更新服务器URL已设置:", url);
    } catch (error) {
      log.error("设置更新服务器URL失败:", error);
    }
  }
}

// 导出单例
const updater = new AutoUpdater();

module.exports = updater;
