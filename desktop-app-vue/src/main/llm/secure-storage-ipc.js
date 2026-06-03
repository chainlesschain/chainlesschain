/**
 * 安全存储 IPC 处理器
 *
 * 提供渲染进程访问安全存储的接口
 *
 * @module secure-storage-ipc
 */

const { logger } = require("../utils/logger.js");
const { ipcMain, dialog, BrowserWindow } = require("electron");
const path = require("path");
const {
  getSecureConfigStorage,
  validateApiKeyFormat,
  sanitizeConfig,
  extractSensitiveFields,
  mergeSensitiveFields,
  isSensitiveField,
  getProviderSensitiveFields,
  SENSITIVE_FIELDS,
} = require("./secure-config-storage");

/**
 * 注册安全存储 IPC 处理器
 */
function registerSecureStorageIPC() {
  const storage = getSecureConfigStorage();

  /**
   * 获取存储信息
   */
  ipcMain.handle("secure-storage:get-info", async () => {
    try {
      return {
        success: true,
        data: storage.getStorageInfo(),
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 获取存储信息失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 保存敏感配置
   */
  ipcMain.handle("secure-storage:save", async (event, config) => {
    try {
      const result = storage.save(config);
      return {
        success: result,
        error: result ? null : "保存失败",
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 保存配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 加载敏感配置
   */
  ipcMain.handle("secure-storage:load", async () => {
    try {
      const config = storage.load();
      return {
        success: true,
        data: config,
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 加载配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 检查配置是否存在
   */
  ipcMain.handle("secure-storage:exists", async () => {
    try {
      return {
        success: true,
        data: storage.exists(),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 删除配置
   */
  ipcMain.handle("secure-storage:delete", async () => {
    try {
      const result = storage.delete();
      return {
        success: result,
        error: result ? null : "删除失败",
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 删除配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 验证 API Key 格式
   */
  ipcMain.handle(
    "secure-storage:validate-api-key",
    async (event, { provider, apiKey }) => {
      try {
        const result = validateApiKeyFormat(provider, apiKey);
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 创建备份
   */
  ipcMain.handle("secure-storage:create-backup", async () => {
    try {
      const backupPath = storage.createBackup();
      return {
        success: !!backupPath,
        data: backupPath,
        error: backupPath ? null : "没有配置可备份",
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 创建备份失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 列出备份
   */
  ipcMain.handle("secure-storage:list-backups", async () => {
    try {
      const backups = storage.listBackups();
      return {
        success: true,
        data: backups,
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 列出备份失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 从备份恢复
   */
  ipcMain.handle("secure-storage:restore-backup", async (event, backupPath) => {
    try {
      const result = storage.restoreFromBackup(backupPath);
      return {
        success: result,
        error: result ? null : "恢复失败",
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 恢复备份失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 导出配置（需要密码）
   */
  ipcMain.handle("secure-storage:export", async (event, { password }) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);

      // 选择导出路径
      const result = await dialog.showSaveDialog(window, {
        title: "导出安全配置",
        defaultPath: "chainlesschain-secrets.enc",
        filters: [
          { name: "加密配置", extensions: ["enc"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          error: "用户取消",
        };
      }

      const exportResult = storage.exportWithPassword(
        password,
        result.filePath,
      );
      return {
        success: exportResult,
        data: result.filePath,
        error: exportResult ? null : "导出失败",
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 导出配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 导入配置（需要密码）
   */
  ipcMain.handle("secure-storage:import", async (event, { password }) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);

      // 选择导入文件
      const result = await dialog.showOpenDialog(window, {
        title: "导入安全配置",
        filters: [
          { name: "加密配置", extensions: ["enc"] },
          { name: "所有文件", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });

      if (result.canceled || !result.filePaths.length) {
        return {
          success: false,
          error: "用户取消",
        };
      }

      const importResult = storage.importWithPassword(
        password,
        result.filePaths[0],
      );
      return {
        success: importResult,
        error: importResult ? null : "导入失败，请检查密码是否正确",
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 导入配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 迁移到 safeStorage
   */
  ipcMain.handle("secure-storage:migrate-to-safe-storage", async () => {
    try {
      const result = storage.migrateToSafeStorage();
      return {
        success: result,
        error: result ? null : "safeStorage 不可用",
      };
    } catch (error) {
      logger.error("[SecureStorageIPC] 迁移失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清除缓存
   */
  ipcMain.handle("secure-storage:clear-cache", async () => {
    try {
      storage.clearCache();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取敏感字段列表
   */
  ipcMain.handle("secure-storage:get-sensitive-fields", async () => {
    return {
      success: true,
      data: SENSITIVE_FIELDS,
    };
  });

  /**
   * 获取提供商的敏感字段
   */
  ipcMain.handle(
    "secure-storage:get-provider-fields",
    async (event, provider) => {
      return {
        success: true,
        data: getProviderSensitiveFields(provider),
      };
    },
  );

  /**
   * 检查字段是否敏感
   */
  ipcMain.handle("secure-storage:is-sensitive", async (event, fieldPath) => {
    return {
      success: true,
      data: isSensitiveField(fieldPath),
    };
  });

  /**
   * 脱敏配置
   */
  ipcMain.handle("secure-storage:sanitize", async (event, config) => {
    try {
      const sanitized = sanitizeConfig(config);
      return {
        success: true,
        data: sanitized,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 设置单个 API Key
   */
  ipcMain.handle(
    "secure-storage:set-api-key",
    async (event, { provider, key, value }) => {
      try {
        // 验证格式
        const validation = validateApiKeyFormat(provider, value);
        if (!validation.valid) {
          return {
            success: false,
            error: validation.message,
          };
        }

        // 加载现有配置
        const config = storage.load() || {};

        // 设置新值
        const fieldPath = key || `${provider}.apiKey`;
        const keys = fieldPath.split(".");
        let target = config;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!(keys[i] in target) || typeof target[keys[i]] !== "object") {
            target[keys[i]] = {};
          }
          target = target[keys[i]];
        }

        target[keys[keys.length - 1]] = value;

        // 保存
        const saveResult = storage.save(config);
        return {
          success: saveResult,
          error: saveResult ? null : "保存失败",
        };
      } catch (error) {
        logger.error("[SecureStorageIPC] 设置 API Key 失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 获取单个 API Key（脱敏）
   */
  ipcMain.handle(
    "secure-storage:get-api-key-masked",
    async (event, { provider, key }) => {
      try {
        const config = storage.load();
        if (!config) {
          return {
            success: true,
            data: null,
          };
        }

        const fieldPath = key || `${provider}.apiKey`;
        const keys = fieldPath.split(".");
        let value = config;

        for (const k of keys) {
          if (value && typeof value === "object" && k in value) {
            value = value[k];
          } else {
            return {
              success: true,
              data: null,
            };
          }
        }

        // 脱敏处理
        if (value && typeof value === "string" && value.length > 8) {
          value =
            value.substring(0, 4) + "****" + value.substring(value.length - 4);
        } else if (value) {
          value = "********";
        }

        return {
          success: true,
          data: value,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 删除单个 API Key
   */
  ipcMain.handle(
    "secure-storage:delete-api-key",
    async (event, { provider, key }) => {
      try {
        const config = storage.load();
        if (!config) {
          return { success: true };
        }

        const fieldPath = key || `${provider}.apiKey`;
        const keys = fieldPath.split(".");
        let target = config;

        for (let i = 0; i < keys.length - 1; i++) {
          if (target && typeof target === "object" && keys[i] in target) {
            target = target[keys[i]];
          } else {
            return { success: true };
          }
        }

        if (target && typeof target === "object") {
          delete target[keys[keys.length - 1]];
        }

        const saveResult = storage.save(config);
        return {
          success: saveResult,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 批量设置 API Keys
   */
  ipcMain.handle(
    "secure-storage:batch-set-api-keys",
    async (event, apiKeys) => {
      try {
        const config = storage.load() || {};
        const errors = [];

        for (const [fieldPath, value] of Object.entries(apiKeys)) {
          // 提取提供商名称进行验证
          const provider = fieldPath.split(".")[0];
          const validation = validateApiKeyFormat(provider, value);

          if (!validation.valid) {
            errors.push({ field: fieldPath, error: validation.message });
            continue;
          }

          // 设置值
          const keys = fieldPath.split(".");
          let target = config;

          for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in target) || typeof target[keys[i]] !== "object") {
              target[keys[i]] = {};
            }
            target = target[keys[i]];
          }

          target[keys[keys.length - 1]] = value;
        }

        if (errors.length > 0) {
          return {
            success: false,
            errors: errors,
            error: `${errors.length} 个 API Key 格式验证失败`,
          };
        }

        const saveResult = storage.save(config);
        return {
          success: saveResult,
          error: saveResult ? null : "保存失败",
        };
      } catch (error) {
        logger.error("[SecureStorageIPC] 批量设置 API Keys 失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 检查提供商是否已配置 API Key
   */
  ipcMain.handle("secure-storage:has-api-key", async (event, provider) => {
    try {
      const config = storage.load();
      if (!config) {
        return {
          success: true,
          data: false,
        };
      }

      const apiKey = config[provider]?.apiKey;
      return {
        success: true,
        data: !!apiKey && apiKey.length > 0,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取所有已配置的提供商
   */
  ipcMain.handle("secure-storage:get-configured-providers", async () => {
    try {
      const config = storage.load();
      if (!config) {
        return {
          success: true,
          data: [],
        };
      }

      const providers = [];
      const providerNames = new Set(
        SENSITIVE_FIELDS.map((f) => f.split(".")[0]),
      );

      for (const provider of providerNames) {
        if (config[provider]?.apiKey) {
          providers.push({
            name: provider,
            hasApiKey: true,
            hasSafeStorage: storage.safeStorageAvailable,
          });
        }
      }

      return {
        success: true,
        data: providers,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  logger.info("[SecureStorageIPC] IPC 处理器已注册");
}

/**
 * 注销 IPC 处理器
 */
function unregisterSecureStorageIPC() {
  const channels = [
    "secure-storage:get-info",
    "secure-storage:save",
    "secure-storage:load",
    "secure-storage:exists",
    "secure-storage:delete",
    "secure-storage:validate-api-key",
    "secure-storage:create-backup",
    "secure-storage:list-backups",
    "secure-storage:restore-backup",
    "secure-storage:export",
    "secure-storage:import",
    "secure-storage:migrate-to-safe-storage",
    "secure-storage:clear-cache",
    "secure-storage:get-sensitive-fields",
    "secure-storage:get-provider-fields",
    "secure-storage:is-sensitive",
    "secure-storage:sanitize",
    "secure-storage:set-api-key",
    "secure-storage:get-api-key-masked",
    "secure-storage:delete-api-key",
    "secure-storage:batch-set-api-keys",
    "secure-storage:has-api-key",
    "secure-storage:get-configured-providers",
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  logger.info("[SecureStorageIPC] IPC 处理器已注销");
}

module.exports = {
  registerSecureStorageIPC,
  unregisterSecureStorageIPC,
};
