/**
 * 数据库加密 IPC 处理程序
 */

const { logger } = require("../utils/logger.js");
const defaultIpcMain = require("electron").ipcMain;
const path = require("path");
const EncryptionConfigManager = require("./config-manager");

class DatabaseEncryptionIPC {
  constructor(app, options = {}) {
    this.app = app;
    this.ipcMain = options.ipcMain || defaultIpcMain;
    this.configManager = null;
    this.databaseManager = null;
    this.setupHandlers();
  }

  /**
   * 初始化配置管理器
   */
  initConfigManager() {
    if (!this.configManager) {
      const configPath = path.join(
        this.app.getPath("userData"),
        "encryption-config.json",
      );
      this.configManager = new EncryptionConfigManager(configPath);
    }
    return this.configManager;
  }

  /**
   * 设置数据库管理器引用
   */
  setDatabaseManager(dbManager) {
    this.databaseManager = dbManager;
  }

  /**
   * 设置 IPC 处理程序
   */
  setupHandlers() {
    // 获取加密状态
    this.ipcMain.handle("database:get-encryption-status", async () => {
      try {
        const config = this.initConfigManager();

        return {
          isEncrypted: config.isEncryptionEnabled(),
          method: config.getEncryptionMethod(),
          engine: this.databaseManager?.adapter?.getEngine() || "sql.js",
          firstTimeSetup: config.isFirstTimeSetup(),
          developmentMode: config.isDevelopmentMode(),
          canSkipPassword: config.canSkipPassword(),
        };
      } catch (error) {
        logger.error("[DatabaseEncryptionIPC] 获取加密状态失败:", error);
        return {
          isEncrypted: false,
          method: null,
          engine: "sql.js",
          firstTimeSetup: true,
          developmentMode: false,
          canSkipPassword: false,
          error: error.message,
        };
      }
    });

    // 设置数据库加密
    this.ipcMain.handle(
      "database:setup-encryption",
      async (_event, options) => {
        try {
          const config = this.initConfigManager();

          // 开发模式：如果跳过密码，禁用加密
          if (config.isDevelopmentMode() && options.skipPassword) {
            config.setMultiple({
              encryptionEnabled: false,
              encryptionMethod: "password",
              firstTimeSetup: false,
            });

            logger.info("[DatabaseEncryptionIPC] 开发模式：跳过密码，禁用加密");

            return {
              success: true,
              message: "开发模式：已跳过密码设置",
            };
          }

          // 保存配置
          config.setMultiple({
            encryptionEnabled: true,
            encryptionMethod: options.method || "password",
            firstTimeSetup: false,
          });

          logger.info("[DatabaseEncryptionIPC] 加密配置已保存:", {
            method: options.method,
            enabled: true,
          });

          return {
            success: true,
            message: "加密设置成功，将在下次启动时生效",
          };
        } catch (error) {
          logger.error("[DatabaseEncryptionIPC] 设置加密失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // 修改加密密码
    this.ipcMain.handle(
      "database:change-encryption-password",
      async (_event, data) => {
        try {
          const { oldPassword, newPassword } = data;

          if (!oldPassword || !newPassword) {
            throw new Error("旧密码和新密码不能为空");
          }

          if (!this.databaseManager || !this.databaseManager.adapter) {
            throw new Error("数据库未使用加密适配器");
          }

          // 调用适配器的 changePassword 方法
          const result = await this.databaseManager.adapter.changePassword(
            oldPassword,
            newPassword,
            this.databaseManager.db,
          );

          return {
            success: true,
            message: result.message || "密码修改成功",
          };
        } catch (error) {
          logger.error("[DatabaseEncryptionIPC] 修改密码失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // 启用加密
    this.ipcMain.handle("database:enable-encryption", async () => {
      try {
        const config = this.initConfigManager();
        config.setEncryptionEnabled(true);

        return {
          success: true,
          message: "加密已启用，将在下次启动时生效",
          requiresRestart: true,
        };
      } catch (error) {
        logger.error("[DatabaseEncryptionIPC] 启用加密失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 禁用加密
    this.ipcMain.handle("database:disable-encryption", async () => {
      try {
        const config = this.initConfigManager();
        config.setEncryptionEnabled(false);

        return {
          success: true,
          message: "加密已禁用，将在下次启动时生效",
          requiresRestart: true,
          warning: "禁用加密会降低数据安全性",
        };
      } catch (error) {
        logger.error("[DatabaseEncryptionIPC] 禁用加密失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取加密配置
    this.ipcMain.handle("database:get-encryption-config", async () => {
      try {
        const config = this.initConfigManager();
        return {
          success: true,
          config: config.getAll(),
        };
      } catch (error) {
        logger.error("[DatabaseEncryptionIPC] 获取配置失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 更新加密配置
    this.ipcMain.handle(
      "database:update-encryption-config",
      async (_event, newConfig) => {
        try {
          const config = this.initConfigManager();
          config.setMultiple(newConfig);

          return {
            success: true,
            message: "配置已更新",
          };
        } catch (error) {
          logger.error("[DatabaseEncryptionIPC] 更新配置失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // 重置加密配置
    this.ipcMain.handle("database:reset-encryption-config", async () => {
      try {
        const config = this.initConfigManager();
        config.reset();

        return {
          success: true,
          message: "配置已重置",
        };
      } catch (error) {
        logger.error("[DatabaseEncryptionIPC] 重置配置失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    logger.info("[DatabaseEncryptionIPC] IPC 处理程序已注册");
  }

  /**
   * 发送加密状态变更事件
   */
  notifyEncryptionStatusChanged(status) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send(
        "database:encryption-status-changed",
        status,
      );
    }
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }
}

module.exports = DatabaseEncryptionIPC;
