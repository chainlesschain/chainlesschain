/**
 * 应用更新检查器
 * 检查应用更新并提供下载功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const { app, dialog, shell } = require("electron");
const https = require("https");
const fs = require("fs");
const path = require("path");

class UpdateChecker {
  constructor() {
    this.currentVersion = app.getVersion();
    this.updateCheckUrl =
      "https://api.github.com/repos/your-org/chainlesschain/releases/latest";
    this.isChecking = false;
    this.lastCheckTime = 0;
    this.checkInterval = 24 * 60 * 60 * 1000; // 24小时
  }

  /**
   * 检查更新
   */
  async checkForUpdates(showNoUpdateDialog = false) {
    if (this.isChecking) {
      logger.info("[UpdateChecker] Already checking for updates");
      return null;
    }

    this.isChecking = true;

    try {
      logger.info("[UpdateChecker] Checking for updates...");
      logger.info("[UpdateChecker] Current version:", this.currentVersion);

      const latestRelease = await this.fetchLatestRelease();

      if (!latestRelease) {
        if (showNoUpdateDialog) {
          dialog.showMessageBox({
            type: "info",
            title: "检查更新",
            message: "无法获取更新信息",
            detail: "请检查网络连接或稍后再试",
            buttons: ["确定"],
          });
        }
        return null;
      }

      const latestVersion = latestRelease.tag_name.replace(/^v/, "");
      logger.info("[UpdateChecker] Latest version:", latestVersion);

      if (this.compareVersions(latestVersion, this.currentVersion) > 0) {
        logger.info("[UpdateChecker] New version available");
        this.lastCheckTime = Date.now();

        // 显示更新对话框
        const result = await this.showUpdateDialog(latestRelease);

        if (result === "download") {
          await this.downloadUpdate(latestRelease);
        } else if (result === "view") {
          shell.openExternal(latestRelease.html_url);
        }

        return latestRelease;
      } else {
        logger.info("[UpdateChecker] Already up to date");
        this.lastCheckTime = Date.now();

        if (showNoUpdateDialog) {
          dialog.showMessageBox({
            type: "info",
            title: "检查更新",
            message: "已是最新版本",
            detail: `当前版本: ${this.currentVersion}`,
            buttons: ["确定"],
          });
        }

        return null;
      }
    } catch (error) {
      logger.error("[UpdateChecker] Check for updates error:", error);

      if (showNoUpdateDialog) {
        dialog.showMessageBox({
          type: "error",
          title: "检查更新失败",
          message: "检查更新时发生错误",
          detail: error.message,
          buttons: ["确定"],
        });
      }

      return null;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 获取最新发布版本
   */
  fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          "User-Agent": "ChainlessChain-UpdateChecker",
        },
      };

      https
        .get(this.updateCheckUrl, options, (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            try {
              if (res.statusCode === 200) {
                const release = JSON.parse(data);
                resolve(release);
              } else {
                logger.error("[UpdateChecker] HTTP error:", res.statusCode);
                resolve(null);
              }
            } catch (error) {
              logger.error("[UpdateChecker] Parse error:", error);
              resolve(null);
            }
          });
        })
        .on("error", (error) => {
          logger.error("[UpdateChecker] Request error:", error);
          reject(error);
        });
    });
  }

  /**
   * 比较版本号
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) {return 1;}
      if (part1 < part2) {return -1;}
    }

    return 0;
  }

  /**
   * 显示更新对话框
   */
  async showUpdateDialog(release) {
    const version = release.tag_name;
    const releaseNotes = release.body || "暂无更新说明";

    const result = await dialog.showMessageBox({
      type: "info",
      title: "发现新版本",
      message: `ChainlessChain ${version} 可用`,
      detail: `当前版本: ${this.currentVersion}\n\n更新内容:\n${releaseNotes.substring(0, 500)}${releaseNotes.length > 500 ? "..." : ""}`,
      buttons: ["下载更新", "查看详情", "稍后提醒"],
      defaultId: 0,
      cancelId: 2,
    });

    if (result.response === 0) {
      return "download";
    } else if (result.response === 1) {
      return "view";
    } else {
      return "later";
    }
  }

  /**
   * 下载更新
   */
  async downloadUpdate(release) {
    try {
      // 查找适合当前平台的资源
      const asset = this.findAssetForPlatform(release.assets);

      if (!asset) {
        dialog
          .showMessageBox({
            type: "warning",
            title: "下载更新",
            message: "未找到适合当前平台的安装包",
            detail: "请访问 GitHub 页面手动下载",
            buttons: ["打开 GitHub", "取消"],
          })
          .then((result) => {
            if (result.response === 0) {
              shell.openExternal(release.html_url);
            }
          });
        return;
      }

      // 打开下载链接
      shell.openExternal(asset.browser_download_url);

      dialog.showMessageBox({
        type: "info",
        title: "下载更新",
        message: "正在浏览器中下载更新",
        detail: "下载完成后请手动安装",
        buttons: ["确定"],
      });
    } catch (error) {
      logger.error("[UpdateChecker] Download update error:", error);

      dialog.showMessageBox({
        type: "error",
        title: "下载失败",
        message: "下载更新时发生错误",
        detail: error.message,
        buttons: ["确定"],
      });
    }
  }

  /**
   * 查找适合当前平台的资源
   */
  findAssetForPlatform(assets) {
    const platform = process.platform;
    const arch = process.arch;

    let patterns = [];

    if (platform === "win32") {
      patterns = [/\.exe$/i, /windows.*\.zip$/i, /win.*\.zip$/i];
    } else if (platform === "darwin") {
      patterns = [/\.dmg$/i, /mac.*\.zip$/i, /darwin.*\.zip$/i];
    } else if (platform === "linux") {
      patterns = [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i, /linux.*\.zip$/i];
    }

    for (const pattern of patterns) {
      const asset = assets.find((a) => pattern.test(a.name));
      if (asset) {return asset;}
    }

    return null;
  }

  /**
   * 自动检查更新
   */
  startAutoCheck() {
    // 立即检查一次
    setTimeout(() => {
      this.checkForUpdates(false);
    }, 5000); // 启动5秒后检查

    // 定期检查
    setInterval(
      () => {
        const now = Date.now();
        if (now - this.lastCheckTime >= this.checkInterval) {
          this.checkForUpdates(false);
        }
      },
      60 * 60 * 1000,
    ); // 每小时检查一次是否需要更新
  }

  /**
   * 获取更新信息
   */
  getUpdateInfo() {
    return {
      currentVersion: this.currentVersion,
      lastCheckTime: this.lastCheckTime,
      isChecking: this.isChecking,
    };
  }
}

// 创建单例
let updateChecker = null;

function getUpdateChecker() {
  if (!updateChecker) {
    updateChecker = new UpdateChecker();
  }
  return updateChecker;
}

module.exports = { UpdateChecker, getUpdateChecker };
