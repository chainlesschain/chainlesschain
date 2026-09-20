/**
 * 安全存储 IPC 处理器
 *
 * 提供渲染进程访问安全存储的接口
 *
 * @module secure-storage-ipc
 */

const {
  ipcMain: defaultIpcMain,
  dialog: defaultDialog,
  BrowserWindow: DefaultBrowserWindow,
} = require("electron");
const path = require("path");
const {
  getSecureConfigStorage,
  validateApiKeyFormat,
  sanitizeConfig,
  isSensitiveField,
  getProviderSensitiveFields,
  SENSITIVE_FIELDS,
} = require("./secure-config-storage");
const { createSecureStoragePrivacy } = require("./secure-storage-privacy");

function backupIdFromPath(value) {
  if (typeof value !== "string") return "";
  return path.posix.basename(value.replaceAll("\\", "/"));
}

/**
 * 注册安全存储 IPC 处理器
 */
function registerSecureStorageIPC(dependencies = {}) {
  const storage = dependencies.storage || getSecureConfigStorage();
  const ipcMain = dependencies.ipcMain || defaultIpcMain;
  const dialog = dependencies.dialog || defaultDialog;
  const BrowserWindow = dependencies.BrowserWindow || DefaultBrowserWindow;
  const privacy = dependencies.privacy || createSecureStoragePrivacy("ipc");

  /**
   * 获取存储信息
   */
  ipcMain.handle("secure-storage:get-info", async () => {
    try {
      const info = storage.getStorageInfo();
      return {
        success: true,
        data: {
          exists: info.exists === true,
          safeStorageAvailable: info.safeStorageAvailable === true,
          encryptionType: ["safeStorage", "aes", "legacy"].includes(
            info.encryptionType,
          )
            ? info.encryptionType
            : null,
          version: Number.isSafeInteger(info.version) ? info.version : null,
          backupCount: Number.isSafeInteger(info.backupCount)
            ? info.backupCount
            : 0,
        },
      };
    } catch {
      return privacy.failure("get-info");
    }
  });

  /**
   * 保存敏感配置
   */
  ipcMain.handle("secure-storage:save", async (_event, config) => {
    try {
      const result = storage.save(config);
      return {
        success: result,
        error: result ? null : "保存失败",
      };
    } catch {
      return privacy.failure("save");
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
        data: { configured: config != null },
      };
    } catch {
      return privacy.failure("load");
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
    } catch {
      return privacy.failure("exists");
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
    } catch {
      return privacy.failure("delete");
    }
  });

  /**
   * 验证 API Key 格式
   */
  ipcMain.handle(
    "secure-storage:validate-api-key",
    async (_event, { provider, apiKey }) => {
      try {
        const result = validateApiKeyFormat(provider, apiKey);
        return {
          success: true,
          data: { valid: result.valid === true },
        };
      } catch {
        return privacy.failure("validate-api-key");
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
        data: backupPath ? { backupId: backupIdFromPath(backupPath) } : null,
        error: backupPath ? null : "没有配置可备份",
      };
    } catch {
      return privacy.failure("create-backup");
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
        data: backups.map((backup) => ({
          backupId: backupIdFromPath(backup.filename || backup.path || ""),
        })),
      };
    } catch {
      return privacy.failure("list-backups");
    }
  });

  /**
   * 从备份恢复
   */
  ipcMain.handle("secure-storage:restore-backup", async (_event, backupId) => {
    try {
      const backup = storage
        .listBackups()
        .find(
          (candidate) =>
            backupIdFromPath(candidate.filename || candidate.path || "") ===
            backupId,
        );
      if (!backup) {
        return {
          success: false,
          error: "Backup not found",
          code: "CC_SECURE_STORAGE_BACKUP_NOT_FOUND",
        };
      }
      const result = storage.restoreFromBackup(backup.path);
      return {
        success: result,
        error: result ? null : "恢复失败",
      };
    } catch {
      return privacy.failure("restore-backup");
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
        data: exportResult ? { exported: true } : null,
        error: exportResult ? null : "导出失败",
      };
    } catch {
      return privacy.failure("export");
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
    } catch {
      return privacy.failure("import");
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
    } catch {
      return privacy.failure("migrate-to-safe-storage");
    }
  });

  /**
   * 清除缓存
   */
  ipcMain.handle("secure-storage:clear-cache", async () => {
    try {
      storage.clearCache();
      return { success: true };
    } catch {
      return privacy.failure("clear-cache");
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
    async (_event, provider) => {
      return {
        success: true,
        data: getProviderSensitiveFields(provider),
      };
    },
  );

  /**
   * 检查字段是否敏感
   */
  ipcMain.handle("secure-storage:is-sensitive", async (_event, fieldPath) => {
    return {
      success: true,
      data: isSensitiveField(fieldPath),
    };
  });

  /**
   * 脱敏配置
   */
  ipcMain.handle("secure-storage:sanitize", async (_event, config) => {
    try {
      const sanitized = sanitizeConfig(config);
      return {
        success: true,
        data: sanitized,
      };
    } catch {
      return privacy.failure("sanitize");
    }
  });

  /**
   * 设置单个 API Key
   */
  ipcMain.handle(
    "secure-storage:set-api-key",
    async (_event, { provider, key, value }) => {
      try {
        // 验证格式
        const validation = validateApiKeyFormat(provider, value);
        if (!validation.valid) {
          return {
            success: false,
            error: "API Key format invalid",
            code: "CC_SECURE_STORAGE_INVALID_API_KEY",
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
      } catch {
        return privacy.failure("set-api-key");
      }
    },
  );

  /**
   * 获取单个 API Key（脱敏）
   */
  ipcMain.handle(
    "secure-storage:get-api-key-masked",
    async (_event, { provider, key }) => {
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

        return {
          success: true,
          data: { configured: typeof value === "string" && value.length > 0 },
        };
      } catch {
        return privacy.failure("get-api-key-status");
      }
    },
  );

  /**
   * 删除单个 API Key
   */
  ipcMain.handle(
    "secure-storage:delete-api-key",
    async (_event, { provider, key }) => {
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
      } catch {
        return privacy.failure("delete-api-key");
      }
    },
  );

  /**
   * 批量设置 API Keys
   */
  ipcMain.handle(
    "secure-storage:batch-set-api-keys",
    async (_event, apiKeys) => {
      try {
        const config = storage.load() || {};
        const errors = [];

        for (const [fieldPath, value] of Object.entries(apiKeys)) {
          // 提取提供商名称进行验证
          const provider = fieldPath.split(".")[0];
          const validation = validateApiKeyFormat(provider, value);

          if (!validation.valid) {
            errors.push(fieldPath);
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
            invalidCount: errors.length,
            error: "One or more API Keys have an invalid format",
            code: "CC_SECURE_STORAGE_INVALID_API_KEY",
          };
        }

        const saveResult = storage.save(config);
        return {
          success: saveResult,
          error: saveResult ? null : "保存失败",
        };
      } catch {
        return privacy.failure("batch-set-api-keys");
      }
    },
  );

  /**
   * 检查提供商是否已配置 API Key
   */
  ipcMain.handle("secure-storage:has-api-key", async (_event, provider) => {
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
    } catch {
      return privacy.failure("has-api-key");
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
    } catch {
      return privacy.failure("get-configured-providers");
    }
  });

  privacy.event("ipc-registered");
}

/**
 * 注销 IPC 处理器
 */
function unregisterSecureStorageIPC(dependencies = {}) {
  const ipcMain = dependencies.ipcMain || defaultIpcMain;
  const privacy = dependencies.privacy || createSecureStoragePrivacy("ipc");
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

  privacy.event("ipc-unregistered");
}

module.exports = {
  registerSecureStorageIPC,
  unregisterSecureStorageIPC,
};
