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
const { types: utilTypes } = require("node:util");
const {
  getSecureConfigStorage,
  validateApiKeyFormat,
  sanitizeConfig,
  isSensitiveField,
  getProviderSensitiveFields,
  SENSITIVE_FIELDS,
} = require("./secure-config-storage");
const { createSecureStoragePrivacy } = require("./secure-storage-privacy");
const {
  createSecureStorageIpcAuthorization,
} = require("./secure-storage-ipc-authorization");

const SAFE_SENSITIVE_FIELDS = new Set(SENSITIVE_FIELDS);
const SAFE_PROVIDERS = new Set(
  SENSITIVE_FIELDS.map((fieldPath) => fieldPath.split(".")[0]),
);
const SAFE_API_KEY_PROVIDERS = new Set(
  SENSITIVE_FIELDS.filter((fieldPath) => fieldPath.endsWith(".apiKey")).map(
    (fieldPath) => fieldPath.split(".")[0],
  ),
);

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !utilTypes.isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function resolveSensitiveField(provider, key) {
  if (typeof provider !== "string" || !SAFE_PROVIDERS.has(provider)) {
    throw new TypeError("Invalid secure storage provider");
  }
  const fieldPath = key === undefined ? `${provider}.apiKey` : key;
  if (
    typeof fieldPath !== "string" ||
    !SAFE_SENSITIVE_FIELDS.has(fieldPath) ||
    fieldPath.split(".")[0] !== provider
  ) {
    throw new TypeError("Invalid secure storage field");
  }
  return fieldPath;
}

function validateSensitiveValue(provider, value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 65_536) {
    return { valid: false };
  }
  return validateApiKeyFormat(provider, value);
}

function readOwnData(record, key) {
  if (!isPlainRecord(record)) {
    throw new TypeError("Invalid secure storage record");
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) {
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw new TypeError("Invalid secure storage field descriptor");
  }
  return descriptor.value;
}

function readSensitiveValue(config, fieldPath) {
  const direct = readOwnData(config, fieldPath);
  if (direct !== undefined) {
    return direct;
  }

  let value = config;
  for (const key of fieldPath.split(".")) {
    value = readOwnData(value, key);
    if (value === undefined) {
      return undefined;
    }
  }
  return value;
}

function projectStoredSecrets(config) {
  if (!isPlainRecord(config)) {
    throw new TypeError("Invalid secure storage configuration");
  }
  const projected = Object.create(null);
  for (const fieldPath of SENSITIVE_FIELDS) {
    const value = readSensitiveValue(config, fieldPath);
    if (typeof value === "string" && value.length > 0) {
      projected[fieldPath] = value;
    }
  }
  return projected;
}

function projectSensitiveFieldMap(value) {
  if (!isPlainRecord(value)) {
    throw new TypeError("Invalid secure storage field map");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > SENSITIVE_FIELDS.length) {
    throw new TypeError("Invalid secure storage field count");
  }

  const projected = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !SAFE_SENSITIVE_FIELDS.has(key) ||
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length > 65_536
    ) {
      throw new TypeError("Invalid secure storage field map");
    }
    projected[key] = descriptor.value;
  }
  return projected;
}

function backupIdFromPath(value) {
  if (typeof value !== "string") {
    return "";
  }
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
  const authorization =
    dependencies.authorization ||
    createSecureStorageIpcAuthorization({
      getMainWindow: dependencies.getMainWindow,
      getCurrentIdentity: dependencies.getCurrentIdentity,
      authorizePurpose: dependencies.authorizePurpose,
    });
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = channel.replace(/^secure-storage:/u, "");
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          await authorization.authorize(event, operation);
        } catch {
          return privacy.authorizationFailure(operation);
        }
        try {
          return await handler(event, args[0]);
        } catch {
          return privacy.failure(operation);
        }
      });
    },
  };

  /**
   * 获取存储信息
   */
  authorizedIpcMain.handle("secure-storage:get-info", async () => {
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
  authorizedIpcMain.handle("secure-storage:save", async (_event, config) => {
    try {
      const result = storage.save(projectSensitiveFieldMap(config));
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
  authorizedIpcMain.handle("secure-storage:load", async () => {
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
  authorizedIpcMain.handle("secure-storage:exists", async () => {
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
  authorizedIpcMain.handle("secure-storage:delete", async () => {
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
  authorizedIpcMain.handle(
    "secure-storage:validate-api-key",
    async (_event, { provider, apiKey }) => {
      try {
        const result = SAFE_API_KEY_PROVIDERS.has(provider)
          ? validateSensitiveValue(provider, apiKey)
          : { valid: false };
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
  authorizedIpcMain.handle("secure-storage:create-backup", async () => {
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
  authorizedIpcMain.handle("secure-storage:list-backups", async () => {
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
  authorizedIpcMain.handle(
    "secure-storage:restore-backup",
    async (_event, backupId) => {
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
    },
  );

  /**
   * 导出配置（需要密码）
   */
  authorizedIpcMain.handle(
    "secure-storage:export",
    async (event, { password }) => {
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
    },
  );

  /**
   * 导入配置（需要密码）
   */
  authorizedIpcMain.handle(
    "secure-storage:import",
    async (event, { password }) => {
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
    },
  );

  /**
   * 迁移到 safeStorage
   */
  authorizedIpcMain.handle(
    "secure-storage:migrate-to-safe-storage",
    async () => {
      try {
        const result = storage.migrateToSafeStorage();
        return {
          success: result,
          error: result ? null : "safeStorage 不可用",
        };
      } catch {
        return privacy.failure("migrate-to-safe-storage");
      }
    },
  );

  /**
   * 清除缓存
   */
  authorizedIpcMain.handle("secure-storage:clear-cache", async () => {
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
  authorizedIpcMain.handle("secure-storage:get-sensitive-fields", async () => {
    return {
      success: true,
      data: SENSITIVE_FIELDS,
    };
  });

  /**
   * 获取提供商的敏感字段
   */
  authorizedIpcMain.handle(
    "secure-storage:get-provider-fields",
    async (_event, provider) => {
      return {
        success: true,
        data: SAFE_PROVIDERS.has(provider)
          ? getProviderSensitiveFields(provider)
          : [],
      };
    },
  );

  /**
   * 检查字段是否敏感
   */
  authorizedIpcMain.handle(
    "secure-storage:is-sensitive",
    async (_event, fieldPath) => {
      return {
        success: true,
        data: isSensitiveField(fieldPath),
      };
    },
  );

  /**
   * 脱敏配置
   */
  authorizedIpcMain.handle(
    "secure-storage:sanitize",
    async (_event, config) => {
      try {
        const sanitized = sanitizeConfig(config);
        return {
          success: true,
          data: sanitized,
        };
      } catch {
        return privacy.failure("sanitize");
      }
    },
  );

  /**
   * 设置单个 API Key
   */
  authorizedIpcMain.handle(
    "secure-storage:set-api-key",
    async (_event, { provider, key, value }) => {
      try {
        const fieldPath = resolveSensitiveField(provider, key);
        // 验证格式
        const validation = validateSensitiveValue(provider, value);
        if (!validation.valid) {
          return {
            success: false,
            error: "API Key format invalid",
            code: "CC_SECURE_STORAGE_INVALID_API_KEY",
          };
        }

        // 加载现有配置
        const config = projectStoredSecrets(storage.load() || {});
        config[fieldPath] = value;

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
  authorizedIpcMain.handle(
    "secure-storage:get-api-key-masked",
    async (_event, { provider, key }) => {
      try {
        const fieldPath = resolveSensitiveField(provider, key);
        const config = storage.load();
        if (!config) {
          return {
            success: true,
            data: null,
          };
        }

        const value = readSensitiveValue(config, fieldPath);

        return {
          success: true,
          data: { configured: typeof value === "string" && value.length > 0 },
        };
      } catch {
        return privacy.failure("get-api-key-masked");
      }
    },
  );

  /**
   * 删除单个 API Key
   */
  authorizedIpcMain.handle(
    "secure-storage:delete-api-key",
    async (_event, { provider, key }) => {
      try {
        const fieldPath = resolveSensitiveField(provider, key);
        const config = storage.load();
        if (!config) {
          return { success: true };
        }

        const projected = projectStoredSecrets(config);
        delete projected[fieldPath];

        const saveResult = storage.save(projected);
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
  authorizedIpcMain.handle(
    "secure-storage:batch-set-api-keys",
    async (_event, apiKeys) => {
      try {
        const projectedApiKeys = projectSensitiveFieldMap(apiKeys);
        const errors = [];

        for (const [fieldPath, value] of Object.entries(projectedApiKeys)) {
          // 提取提供商名称进行验证
          const provider = fieldPath.split(".")[0];
          const validation = validateSensitiveValue(provider, value);

          if (!validation.valid) {
            errors.push(fieldPath);
            continue;
          }
        }

        if (errors.length > 0) {
          return {
            success: false,
            invalidCount: errors.length,
            error: "One or more API Keys have an invalid format",
            code: "CC_SECURE_STORAGE_INVALID_API_KEY",
          };
        }

        const config = projectStoredSecrets(storage.load() || {});
        Object.assign(config, projectedApiKeys);
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
  authorizedIpcMain.handle(
    "secure-storage:has-api-key",
    async (_event, provider) => {
      try {
        if (!SAFE_API_KEY_PROVIDERS.has(provider)) {
          return { success: true, data: false };
        }
        const config = storage.load();
        if (!config) {
          return {
            success: true,
            data: false,
          };
        }

        const apiKey = readSensitiveValue(config, `${provider}.apiKey`);
        return {
          success: true,
          data: !!apiKey && apiKey.length > 0,
        };
      } catch {
        return privacy.failure("has-api-key");
      }
    },
  );

  /**
   * 获取所有已配置的提供商
   */
  authorizedIpcMain.handle(
    "secure-storage:get-configured-providers",
    async () => {
      try {
        const config = storage.load();
        if (!config) {
          return {
            success: true,
            data: [],
          };
        }

        const providers = [];
        for (const provider of SAFE_API_KEY_PROVIDERS) {
          if (readSensitiveValue(config, `${provider}.apiKey`)) {
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
    },
  );

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
