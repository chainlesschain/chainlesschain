const { ipcMain } = require('electron');
const InitialSetupConfig = require('./initial-setup-config');

class InitialSetupIPC {
  constructor(app, database, appConfig, llmConfig) {
    this.app = app;
    this.database = database;
    this.appConfig = appConfig;
    this.llmConfig = llmConfig;
    this.config = new InitialSetupConfig(app.getPath('userData'));

    this.registerHandlers();
  }

  registerHandlers() {
    // 获取设置状态
    ipcMain.handle('initial-setup:get-status', async () => {
      return {
        completed: !this.config.isFirstTimeSetup(),
        completedAt: this.config.get('completedAt'),
        edition: this.config.get('edition'),
      };
    });

    // 获取当前配置
    ipcMain.handle('initial-setup:get-config', async () => {
      return this.config.getAll();
    });

    // 保存配置（不应用）
    ipcMain.handle('initial-setup:save-config', async (_event, config) => {
      Object.keys(config).forEach(key => {
        this.config.set(key, config[key]);
      });
      this.config.save();
      return { success: true };
    });

    // 完成设置并应用到系统
    ipcMain.handle('initial-setup:complete', async (_event, config) => {
      try {
        // 保存配置
        Object.keys(config).forEach(key => {
          this.config.set(key, config[key]);
        });

        // 应用到系统各个配置管理器
        await this.config.applyToSystem(this.appConfig, this.llmConfig, this.database);

        // 标记为已完成
        this.config.markSetupComplete();
        this.config.save();

        return { success: true };
      } catch (error) {
        console.error('完成初始设置失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 重置配置
    ipcMain.handle('initial-setup:reset', async () => {
      this.config.reset();
      return { success: true };
    });
  }
}

module.exports = InitialSetupIPC;
