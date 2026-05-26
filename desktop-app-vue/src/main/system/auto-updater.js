/**
 * ChainlessChain 自动更新模块
 * 基于 electron-updater 实现自动更新功能
 */

const { autoUpdater } = require("electron-updater");
const { dialog, BrowserWindow, ipcMain, app } = require("electron");

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

const { classifyUpdateError } = require("./update-error-classifier.js");

class AutoUpdater {
  constructor() {
    this.mainWindow = null;
    this.updateCheckInterval = null;
    this.checkIntervalHours = 4; // 每4小时检查一次更新
    // v5.0.3.36 — true 表示当前 in-flight 的检查是用户主动从托盘触发的，
    // update-not-available / error 事件需要弹 native dialog 给 feedback；
    // false 表示后台静默自检（启动 3s + 每 4h），不弹任何 UI。在事件回调
    // 里读完立即重置，避免下一次自检"借用"上一次的 manual 标志。
    this._manualCheckPending = false;
    // v5.0.3.44 — 当前 in-flight 下载状态，供渲染端 notifier 同步初始 UI
    // 用（例如 notifier 在下载中段挂载时还是要看到进度条而不是空 idle）。
    this._lastStatus = { status: "idle", data: null, info: null };
    this._ipcRegistered = false;

    // 配置 autoUpdater
    this.setupAutoUpdater();
  }

  /**
   * 初始化自动更新器
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
  init(mainWindow) {
    this.mainWindow = mainWindow;

    // 注册 IPC handlers — renderer 通知器驱动手动检查 / 下载 / 安装
    this.registerIpcHandlers();

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
   * 注册 IPC handlers（幂等）：渲染端 notifier 通过 electronAPI.appUpdate.*
   * 触发检查 / 下载 / 安装；onStatus 订阅走 webContents.send(update-status)
   * 单向广播，不在这里注册。
   */
  registerIpcHandlers() {
    if (this._ipcRegistered) {
      return;
    }
    this._ipcRegistered = true;

    ipcMain.handle("app-update:check", async () => {
      const isProd =
        process.env.NODE_ENV === "production" || app.isPackaged === true;
      if (!isProd) {
        return { ok: false, reason: "dev-mode", isProd: false };
      }
      await this.checkForUpdates(true);
      return { ok: true };
    });

    ipcMain.handle("app-update:download", async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (err) {
        log.error("downloadUpdate failed:", err);
        return { ok: false, error: String((err && err.message) || err) };
      }
    });

    ipcMain.handle("app-update:install", async () => {
      try {
        autoUpdater.quitAndInstall(false, true);
        return { ok: true };
      } catch (err) {
        log.error("quitAndInstall failed:", err);
        return { ok: false, error: String((err && err.message) || err) };
      }
    });

    ipcMain.handle("app-update:get-status", () => this._lastStatus);
  }

  /**
   * 配置 autoUpdater 事件处理
   */
  setupAutoUpdater() {
    // 检查更新错误
    autoUpdater.on("error", (error) => {
      const classified = classifyUpdateError(error);
      this.clearTaskbarProgress();

      // v5.0.3.96 — release-in-progress 不是真错误：用户已经发了新版本但
      // release.yml workflow 还在上传 assets，latest*.yml 暂不可达。后台
      // 自检完全静默（不发 error 状态给 notifier，避免角落弹红卡），手动
      // 检查弹 info dialog 给"稍后再试"提示而不是 stacktrace。
      if (classified.kind === "release-in-progress") {
        log.info(
          "[auto-updater] release-in-progress, skip error:",
          classified.raw,
        );
        if (this._manualCheckPending) {
          this._manualCheckPending = false;
          if (this.mainWindow) {
            dialog
              .showMessageBox(this.mainWindow, {
                type: "info",
                title: classified.title,
                message: classified.message,
                detail: classified.detail,
                buttons: ["确定"],
              })
              .catch(() => {});
          }
        }
        return;
      }

      log.error("更新检查错误:", error);
      this.sendStatusToWindow("error", null, {
        message: classified.detail,
      });
      // v5.0.3.36 — 用户主动触发的检查必须给 feedback；后台自检静默。
      if (this._manualCheckPending) {
        this._manualCheckPending = false;
        if (this.mainWindow) {
          dialog
            .showMessageBox(this.mainWindow, {
              type: "error",
              title: classified.title,
              message: classified.message,
              detail: classified.detail,
              buttons: ["确定"],
            })
            .catch(() => {});
        }
      }
    });

    // 开始检查更新
    autoUpdater.on("checking-for-update", () => {
      log.info("正在检查更新...");
      this.sendStatusToWindow("checking", null, null);
    });

    // 发现新版本
    autoUpdater.on("update-available", (info) => {
      log.info("发现新版本:", info.version);
      this.sendStatusToWindow("available", null, {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });

      // v5.0.3.44 — notifier-only 流程：渲染端 AppUpdateNotifier 已经接管
      // "立即下载 / 稍后再说" 的 UI，原 native dialog 跟它重复弹两次很吵。
      // showUpdateAvailableDialog 函数仍保留（下面），不再调用，方便回退。
      this._manualCheckPending = false;
      // this.showUpdateAvailableDialog(info);
    });

    // 没有可用更新
    autoUpdater.on("update-not-available", (info) => {
      log.info("当前是最新版本");
      this.sendStatusToWindow("not-available", null, null);
      // v5.0.3.36 — 用户主动点了"检查更新"才 feedback；后台 3s/4h 自检静默
      // 不弹（电源管理 / 锁屏唤醒等场景下大量弹窗很骚扰）。
      if (this._manualCheckPending) {
        this._manualCheckPending = false;
        if (this.mainWindow) {
          let appVersion = "";
          try {
            appVersion = require("../../../package.json").version || "";
          } catch {
            // ignore — desktop-app-vue/package.json should always be reachable
          }
          dialog
            .showMessageBox(this.mainWindow, {
              type: "info",
              title: "检查更新",
              message: "当前已是最新版本",
              detail: appVersion ? `当前版本: v${appVersion}` : undefined,
              buttons: ["确定"],
            })
            .catch(() => {});
        }
      }
    });

    // 更新下载进度
    autoUpdater.on("download-progress", (progressObj) => {
      let logMessage = `下载速度: ${progressObj.bytesPerSecond}`;
      logMessage += ` - 已下载 ${progressObj.percent}%`;
      logMessage += ` (${progressObj.transferred}/${progressObj.total})`;

      log.info(logMessage);
      // taskbar / dock 进度条（OS 原生，零渲染端依赖兜底；renderer notifier
      // 是主要 UI，但任务栏即使应用最小化也可见）
      this.setTaskbarProgress(progressObj.percent);
      this.sendStatusToWindow("downloading", progressObj, null);
    });

    // 更新下载完成
    autoUpdater.on("update-downloaded", (info) => {
      log.info("更新下载完成");
      this.clearTaskbarProgress();
      this.sendStatusToWindow("downloaded", null, {
        version: info.version,
        releaseDate: info.releaseDate,
      });

      // v5.0.3.44 — notifier-only：渲染端 AppUpdateNotifier 提供"立即重启 /
      // 下次启动" 按钮，原 native dialog 不再弹。函数保留，方便回退。
      // this.showUpdateReadyDialog(info);
    });
  }

  /**
   * 设置 Windows 任务栏 / macOS Dock 进度条。
   * `percent` 是 0-100 整数 / 浮点；setProgressBar 接收 0-1。
   */
  setTaskbarProgress(percent) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    try {
      const p = Math.max(0, Math.min(1, Number(percent) / 100));
      this.mainWindow.setProgressBar(p);
    } catch (err) {
      log.warn("setProgressBar failed:", err && err.message);
    }
  }

  clearTaskbarProgress() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    try {
      this.mainWindow.setProgressBar(-1);
    } catch (err) {
      log.warn("setProgressBar(-1) failed:", err && err.message);
    }
  }

  /**
   * 检查更新。`manual=true` 表示用户主动从托盘触发，事件回调会弹 native
   * dialog 给 feedback；`manual=false`（默认）是启动 3s 自检 + 每 4h 周期
   * 检查，全程静默不弹任何 UI。
   * @param {boolean} [manual=false]
   */
  async checkForUpdates(manual = false) {
    if (manual) {
      this._manualCheckPending = true;
    }
    try {
      log.info(manual ? "手动检查更新" : "后台检查更新");
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
   * 发送状态到渲染进程。`status` 是 dot-case 枚举：
   *   idle / checking / available / not-available / downloading
   *   / downloaded / error
   * `data` 仅 downloading 状态非空（electron-updater progress object）。
   * `info` 在 available / downloaded / error 携带 {version,releaseNotes,…} / {message}。
   */
  sendStatusToWindow(status, data = null, info = null) {
    const payload = {
      status,
      data,
      info,
      timestamp: new Date().toISOString(),
    };
    this._lastStatus = payload;
    if (this.mainWindow && this.mainWindow.webContents) {
      try {
        this.mainWindow.webContents.send("update-status", payload);
      } catch (err) {
        log.warn("send update-status failed:", err && err.message);
      }
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
