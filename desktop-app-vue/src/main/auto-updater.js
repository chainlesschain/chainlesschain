/**
 * ChainlessChain 自动更新模块
 * 基于 electron-updater 实现自动更新功能
 */

const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow } = require('electron');
const log = require('electron-log');

// 配置日志
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

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
    if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
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
    autoUpdater.on('error', (error) => {
      log.error('更新检查错误:', error);
      this.sendStatusToWindow('更新检查失败');
    });

    // 开始检查更新
    autoUpdater.on('checking-for-update', () => {
      log.info('正在检查更新...');
      this.sendStatusToWindow('正在检查更新...');
    });

    // 发现新版本
    autoUpdater.on('update-available', (info) => {
      log.info('发现新版本:', info.version);
      this.sendStatusToWindow('发现新版本');

      // 显示更新提示
      this.showUpdateAvailableDialog(info);
    });

    // 没有可用更新
    autoUpdater.on('update-not-available', (info) => {
      log.info('当前是最新版本');
      this.sendStatusToWindow('当前是最新版本');
    });

    // 更新下载进度
    autoUpdater.on('download-progress', (progressObj) => {
      let logMessage = `下载速度: ${progressObj.bytesPerSecond}`;
      logMessage += ` - 已下载 ${progressObj.percent}%`;
      logMessage += ` (${progressObj.transferred}/${progressObj.total})`;

      log.info(logMessage);
      this.sendStatusToWindow('正在下载更新', progressObj);
    });

    // 更新下载完成
    autoUpdater.on('update-downloaded', (info) => {
      log.info('更新下载完成');
      this.sendStatusToWindow('更新下载完成');

      // 显示安装提示
      this.showUpdateReadyDialog(info);
    });
  }

  /**
   * 手动检查更新
   */
  async checkForUpdates() {
    try {
      log.info('手动检查更新');
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.error('检查更新失败:', error);
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
      this.mainWindow.webContents.send('update-status', {
        status,
        data,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 显示"发现新版本"对话框
   */
  showUpdateAvailableDialog(info) {
    const options = {
      type: 'info',
      title: '发现新版本',
      message: `ChainlessChain v${info.version} 可用`,
      detail: `当前版本: v${require('../../../package.json').version}\n新版本: v${info.version}\n\n是否立即下载更新？`,
      buttons: ['立即下载', '稍后提醒'],
      defaultId: 0,
      cancelId: 1
    };

    if (this.mainWindow) {
      dialog.showMessageBox(this.mainWindow, options).then((result) => {
        if (result.response === 0) {
          // 立即下载
          log.info('用户选择立即下载更新');
          autoUpdater.downloadUpdate();
        } else {
          log.info('用户选择稍后更新');
        }
      });
    }
  }

  /**
   * 显示"更新就绪"对话框
   */
  showUpdateReadyDialog(info) {
    const options = {
      type: 'info',
      title: '更新已下载',
      message: '新版本已下载完成',
      detail: `ChainlessChain v${info.version} 已准备好安装。\n\n是否立即重启应用以安装更新？`,
      buttons: ['立即重启', '稍后重启'],
      defaultId: 0,
      cancelId: 1
    };

    if (this.mainWindow) {
      dialog.showMessageBox(this.mainWindow, options).then((result) => {
        if (result.response === 0) {
          // 立即重启安装
          log.info('用户选择立即重启安装更新');
          autoUpdater.quitAndInstall(false, true);
        } else {
          log.info('用户选择稍后重启');
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
      currentVersion: require('../../../package.json').version,
      checkIntervalHours: this.checkIntervalHours,
      updateServer: autoUpdater.getFeedURL(),
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit
    };
  }

  /**
   * 设置更新服务器 URL
   * @param {string} url - 更新服务器 URL
   */
  setFeedURL(url) {
    try {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: url
      });
      log.info('更新服务器URL已设置:', url);
    } catch (error) {
      log.error('设置更新服务器URL失败:', error);
    }
  }
}

// 导出单例
const updater = new AutoUpdater();

module.exports = updater;
