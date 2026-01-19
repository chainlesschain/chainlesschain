/**
 * 插件更新管理器
 *
 * 负责检查、下载和安装插件更新
 * 支持自动更新和手动更新
 */

const { logger, createLogger } = require('../utils/logger.js');
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { getPluginMarketplaceAPI } = require("./marketplace-api");

class PluginUpdateManager extends EventEmitter {
  constructor(pluginManager, config = {}) {
    super();

    this.pluginManager = pluginManager;
    this.marketplaceAPI = getPluginMarketplaceAPI(config.marketplace);

    // 配置
    this.autoCheckEnabled = config.autoCheck !== false;
    this.checkInterval = config.checkInterval || 86400000; // 24小时
    this.autoUpdateEnabled = config.autoUpdate || false;

    // 状态
    this.checking = false;
    this.availableUpdates = new Map();
    this.updateTimer = null;

    // 初始化
    if (this.autoCheckEnabled) {
      this.startAutoCheck();
    }
  }

  /**
   * 启动自动检查
   */
  startAutoCheck() {
    if (this.updateTimer) {
      return;
    }

    logger.info("[PluginUpdateManager] Starting auto-check for updates");

    // 立即检查一次
    this.checkForUpdates().catch((error) => {
      logger.error(
        "[PluginUpdateManager] Initial update check failed:",
        error,
      );
    });

    // 定期检查
    this.updateTimer = setInterval(() => {
      this.checkForUpdates().catch((error) => {
        logger.error(
          "[PluginUpdateManager] Periodic update check failed:",
          error,
        );
      });
    }, this.checkInterval);
  }

  /**
   * 停止自动检查
   */
  stopAutoCheck() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
      logger.info("[PluginUpdateManager] Stopped auto-check for updates");
    }
  }

  /**
   * 检查所有插件的更新
   */
  async checkForUpdates(force = false) {
    if (this.checking && !force) {
      logger.info("[PluginUpdateManager] Update check already in progress");
      return this.availableUpdates;
    }

    this.checking = true;
    this.emit("check-start");

    try {
      logger.info("[PluginUpdateManager] Checking for plugin updates...");

      // 获取已安装的插件
      const installedPlugins = this.pluginManager.getPlugins();

      if (installedPlugins.length === 0) {
        logger.info("[PluginUpdateManager] No plugins installed");
        this.checking = false;
        this.emit("check-complete", []);
        return new Map();
      }

      // 调用市场API检查更新
      const updates = await this.marketplaceAPI.checkUpdates(installedPlugins);

      // 清空旧的更新列表
      this.availableUpdates.clear();

      // 处理更新信息
      for (const update of updates) {
        this.availableUpdates.set(update.pluginId, {
          pluginId: update.pluginId,
          currentVersion: update.currentVersion,
          latestVersion: update.latestVersion,
          changelog: update.changelog,
          releaseDate: update.releaseDate,
          critical: update.critical || false,
          downloadUrl: update.downloadUrl,
        });

        logger.info(
          `[PluginUpdateManager] Update available for ${update.pluginId}: ${update.currentVersion} -> ${update.latestVersion}`,
        );
      }

      this.emit("check-complete", Array.from(this.availableUpdates.values()));

      // 如果启用自动更新，自动安装非关键更新
      if (this.autoUpdateEnabled && this.availableUpdates.size > 0) {
        await this.autoInstallUpdates();
      }

      return this.availableUpdates;
    } catch (error) {
      logger.error("[PluginUpdateManager] Check for updates failed:", error);
      this.emit("check-error", error);
      throw error;
    } finally {
      this.checking = false;
    }
  }

  /**
   * 自动安装更新
   */
  async autoInstallUpdates() {
    logger.info("[PluginUpdateManager] Auto-installing updates...");

    const updates = Array.from(this.availableUpdates.values());

    for (const update of updates) {
      try {
        // 只自动安装非关键更新
        if (!update.critical) {
          await this.updatePlugin(update.pluginId);
        }
      } catch (error) {
        logger.error(
          `[PluginUpdateManager] Auto-update failed for ${update.pluginId}:`,
          error,
        );
      }
    }
  }

  /**
   * 更新单个插件
   */
  async updatePlugin(pluginId, version = "latest") {
    logger.info(`[PluginUpdateManager] Updating plugin: ${pluginId}`);

    this.emit("update-start", pluginId);

    try {
      // 获取插件信息
      const plugin = await this.pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`Plugin not found: ${pluginId}`);
      }

      // 下载新版本
      logger.info(
        `[PluginUpdateManager] Downloading ${pluginId} ${version}...`,
      );
      const pluginData = await this.marketplaceAPI.downloadPlugin(
        pluginId,
        version,
      );

      // 保存到临时文件
      const tempDir = path.join(process.cwd(), ".temp-updates");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFile = path.join(tempDir, `${pluginId}-${Date.now()}.zip`);
      fs.writeFileSync(tempFile, pluginData);

      // 卸载旧版本
      logger.info(
        `[PluginUpdateManager] Uninstalling old version of ${pluginId}...`,
      );
      await this.pluginManager.uninstallPlugin(pluginId);

      // 安装新版本
      logger.info(
        `[PluginUpdateManager] Installing new version of ${pluginId}...`,
      );
      await this.pluginManager.installPlugin(tempFile);

      // 清理临时文件
      fs.unlinkSync(tempFile);

      // 从更新列表中移除
      this.availableUpdates.delete(pluginId);

      logger.info(`[PluginUpdateManager] Successfully updated ${pluginId}`);
      this.emit("update-complete", pluginId);

      return true;
    } catch (error) {
      logger.error(
        `[PluginUpdateManager] Update failed for ${pluginId}:`,
        error,
      );
      this.emit("update-error", pluginId, error);
      throw error;
    }
  }

  /**
   * 批量更新插件
   */
  async updateMultiplePlugins(pluginIds) {
    logger.info(
      `[PluginUpdateManager] Updating ${pluginIds.length} plugins...`,
    );

    const results = {
      success: [],
      failed: [],
    };

    for (const pluginId of pluginIds) {
      try {
        await this.updatePlugin(pluginId);
        results.success.push(pluginId);
      } catch (error) {
        results.failed.push({
          pluginId,
          error: error.message,
        });
      }
    }

    logger.info(
      `[PluginUpdateManager] Batch update complete: ${results.success.length} succeeded, ${results.failed.length} failed`,
    );

    return results;
  }

  /**
   * 更新所有插件
   */
  async updateAllPlugins() {
    const pluginIds = Array.from(this.availableUpdates.keys());
    return await this.updateMultiplePlugins(pluginIds);
  }

  /**
   * 获取可用更新列表
   */
  getAvailableUpdates() {
    return Array.from(this.availableUpdates.values());
  }

  /**
   * 检查特定插件是否有更新
   */
  hasUpdate(pluginId) {
    return this.availableUpdates.has(pluginId);
  }

  /**
   * 获取特定插件的更新信息
   */
  getUpdateInfo(pluginId) {
    return this.availableUpdates.get(pluginId);
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
   * 设置自动检查
   */
  setAutoCheck(enabled) {
    this.autoCheckEnabled = enabled;

    if (enabled) {
      this.startAutoCheck();
    } else {
      this.stopAutoCheck();
    }
  }

  /**
   * 设置自动更新
   */
  setAutoUpdate(enabled) {
    this.autoUpdateEnabled = enabled;
    logger.info(
      `[PluginUpdateManager] Auto-update ${enabled ? "enabled" : "disabled"}`,
    );
  }

  /**
   * 获取更新统计
   */
  getUpdateStats() {
    const updates = Array.from(this.availableUpdates.values());

    return {
      total: updates.length,
      critical: updates.filter((u) => u.critical).length,
      normal: updates.filter((u) => !u.critical).length,
    };
  }

  /**
   * 清理
   */
  destroy() {
    this.stopAutoCheck();
    this.availableUpdates.clear();
    this.removeAllListeners();
  }
}

module.exports = PluginUpdateManager;
