const { ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const InitialSetupConfig = require("./initial-setup-config");

class InitialSetupIPC {
  constructor(app, database, appConfig, llmConfig) {
    this.app = app;
    this.database = database;
    this.appConfig = appConfig;
    this.llmConfig = llmConfig;
    this.config = new InitialSetupConfig(app.getPath("userData"));

    this.registerHandlers();
  }

  registerHandlers() {
    // 获取设置状态
    ipcMain.handle("initial-setup:get-status", async () => {
      return {
        completed: !this.config.isFirstTimeSetup(),
        completedAt: this.config.get("completedAt"),
        edition: this.config.get("edition"),
      };
    });

    // 获取当前配置
    ipcMain.handle("initial-setup:get-config", async () => {
      return this.config.getAll();
    });

    // 保存配置（不应用）
    ipcMain.handle("initial-setup:save-config", async (_event, config) => {
      Object.keys(config).forEach((key) => {
        this.config.set(key, config[key]);
      });
      this.config.save();
      return { success: true };
    });

    // 完成设置并应用到系统
    ipcMain.handle("initial-setup:complete", async (_event, config) => {
      try {
        // 保存配置
        Object.keys(config).forEach((key) => {
          this.config.set(key, config[key]);
        });

        // 应用到系统各个配置管理器
        await this.config.applyToSystem(
          this.appConfig,
          this.llmConfig,
          this.database,
        );

        // 标记为已完成
        this.config.markSetupComplete();
        this.config.save();

        return { success: true };
      } catch (error) {
        console.error("完成初始设置失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 重置配置
    ipcMain.handle("initial-setup:reset", async () => {
      this.config.reset();
      return { success: true };
    });

    // 导出配置
    ipcMain.handle("initial-setup:export-config", async () => {
      try {
        // 打开保存对话框
        const result = await dialog.showSaveDialog({
          title: "导出全局设置配置",
          defaultPath: path.join(
            this.app.getPath("downloads"),
            "chainlesschain-config.json",
          ),
          filters: [
            { name: "JSON Files", extensions: ["json"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        // 获取当前配置
        const config = this.config.getAll();

        // 移除敏感信息（API密钥）
        const safeConfig = JSON.parse(JSON.stringify(config));
        if (safeConfig.llm && safeConfig.llm.apiKey) {
          safeConfig.llm.apiKey = ""; // 清空API密钥
        }
        if (safeConfig.enterprise && safeConfig.enterprise.apiKey) {
          safeConfig.enterprise.apiKey = ""; // 清空企业API密钥
        }

        // 写入文件
        fs.writeFileSync(
          result.filePath,
          JSON.stringify(safeConfig, null, 2),
          "utf8",
        );

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        console.error("导出配置失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 导入配置
    ipcMain.handle("initial-setup:import-config", async () => {
      try {
        // 打开文件选择对话框
        const result = await dialog.showOpenDialog({
          title: "导入全局设置配置",
          defaultPath: this.app.getPath("downloads"),
          filters: [
            { name: "JSON Files", extensions: ["json"] },
            { name: "All Files", extensions: ["*"] },
          ],
          properties: ["openFile"],
        });

        if (
          result.canceled ||
          !result.filePaths ||
          result.filePaths.length === 0
        ) {
          return { success: false, canceled: true };
        }

        // 读取文件
        const filePath = result.filePaths[0];
        const fileContent = fs.readFileSync(filePath, "utf8");
        const importedConfig = JSON.parse(fileContent);

        // 验证配置格式
        if (!importedConfig || typeof importedConfig !== "object") {
          return {
            success: false,
            error: "配置文件格式无效",
          };
        }

        // 应用导入的配置（合并到当前配置）
        Object.keys(importedConfig).forEach((key) => {
          if (key !== "setupCompleted" && key !== "completedAt") {
            this.config.set(key, importedConfig[key]);
          }
        });

        this.config.save();

        return {
          success: true,
          config: this.config.getAll(),
        };
      } catch (error) {
        console.error("导入配置失败:", error);
        return { success: false, error: error.message };
      }
    });
  }
}

module.exports = InitialSetupIPC;
