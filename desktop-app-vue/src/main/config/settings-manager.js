/**
 * 应用设置管理器
 * 统一管理应用配置和用户偏好设置
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

class SettingsManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.settingsPath =
      options.settingsPath ||
      path.join(app.getPath("userData"), "settings.json");
    this.defaults = options.defaults || this.getDefaultSettings();
    this.settings = {};
    this.watchers = new Map(); // key -> callback[]

    // 加载设置
    this.loadSettings();

    // 监听文件变化
    this.watchSettingsFile();
  }

  /**
   * 获取默认设置
   */
  getDefaultSettings() {
    return {
      // 应用版本设置
      app: {
        edition: "personal", // personal | enterprise
      },

      // 企业版配置
      enterprise: {
        serverUrl: "",
        tenantId: "",
        apiKey: "",
      },

      // 通用设置
      general: {
        language: "zh-CN",
        theme: "auto",
        autoStart: false,
        minimizeToTray: true,
        closeToTray: true,
        startMinimized: false,
      },

      // 编辑器设置
      editor: {
        fontSize: 14,
        fontFamily: "Consolas, Monaco, monospace",
        lineHeight: 1.6,
        tabSize: 2,
        wordWrap: true,
        autoSave: true,
        autoSaveDelay: 2000,
        spellCheck: true,
      },

      // 快捷键设置
      shortcuts: {
        "show-hide-window": "CommandOrControl+Shift+Space",
        "new-note": "CommandOrControl+N",
        "global-search": "CommandOrControl+K",
        screenshot: "CommandOrControl+Shift+S",
        "clipboard-history": "CommandOrControl+Shift+V",
      },

      // 项目配置
      project: {
        rootPath: "",
        maxSizeMB: 1000,
        allowedFileTypes: [],
        autoSync: true,
        syncIntervalSeconds: 300,
      },

      // LLM 配置
      llm: {
        provider: "ollama",
        priority: ["ollama", "volcengine", "deepseek"],
        autoFallback: true,
        autoSelect: false,
        selectionStrategy: "balanced",
        ollamaHost: "http://localhost:11434",
        ollamaModel: "qwen2:7b",
        ollamaEmbeddingModel: "nomic-embed-text",
        openaiApiKey: "",
        openaiBaseUrl: "https://api.openai.com/v1",
        openaiModel: "gpt-3.5-turbo",
        openaiEmbeddingModel: "text-embedding-3-small",
        anthropicApiKey: "",
        anthropicBaseUrl: "https://api.anthropic.com",
        anthropicModel: "claude-3-5-sonnet-20241022",
        anthropicEmbeddingModel: "",
        volcengineApiKey: "",
        volcengineModel: "doubao-seed-1-6-251015",
        volcengineEmbeddingModel: "doubao-embedding-text-240715",
        dashscopeApiKey: "",
        dashscopeModel: "qwen-turbo",
        dashscopeEmbeddingModel: "text-embedding-v2",
        zhipuApiKey: "",
        zhipuModel: "glm-4",
        zhipuEmbeddingModel: "embedding-2",
        deepseekApiKey: "",
        deepseekModel: "deepseek-chat",
        deepseekEmbeddingModel: "",
      },

      // 向量数据库配置
      vector: {
        qdrantHost: "http://localhost:6333",
        qdrantPort: 6333,
        qdrantCollection: "chainlesschain_vectors",
        embeddingModel: "bge-base-zh-v1.5",
        embeddingDimension: 768,
      },

      // Git 同步配置
      git: {
        enabled: false,
        autoSync: false,
        autoSyncInterval: 300,
        userName: "",
        userEmail: "",
        remoteUrl: "",
      },

      // 后端服务配置
      backend: {
        projectServiceUrl: "http://localhost:9090",
        aiServiceUrl: "http://localhost:8001",
      },

      // 数据库配置
      database: {
        sqlcipherKey: "",
      },

      // P2P 网络配置
      p2p: {
        transports: {
          webrtc: { enabled: true },
          websocket: { enabled: true },
          tcp: { enabled: true },
          autoSelect: true,
        },
        stun: {
          servers: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
          ],
        },
        turn: {
          enabled: false,
          servers: [],
        },
        webrtc: {
          port: 9095,
          iceTransportPolicy: "all",
          iceCandidatePoolSize: 10,
        },
        relay: {
          enabled: true,
          maxReservations: 2,
          autoUpgrade: true,
        },
        nat: {
          autoDetect: true,
          detectionInterval: 3600000,
        },
        connection: {
          dialTimeout: 30000,
          maxRetries: 3,
          healthCheckInterval: 60000,
        },
        websocket: {
          port: 9001,
        },
        compatibility: {
          detectLegacy: true,
        },
      },

      // 语音识别配置
      speech: {
        defaultEngine: "webspeech",
        webSpeech: {
          lang: "zh-CN",
          continuous: true,
          interimResults: true,
          maxAlternatives: 1,
        },
        whisperAPI: {
          apiKey: "",
          baseURL: "https://api.openai.com/v1",
          model: "whisper-1",
          language: "zh",
          temperature: 0,
          responseFormat: "json",
          timeout: 60000,
        },
        whisperLocal: {
          serverUrl: "http://localhost:8002",
          modelSize: "base",
          device: "auto",
          timeout: 120000,
        },
        audio: {
          targetFormat: "wav",
          targetSampleRate: 16000,
          targetChannels: 1,
          maxFileSize: 26214400, // 25MB
          maxDuration: 3600,
          segmentDuration: 300,
          supportedFormats: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"],
        },
        storage: {
          savePath: "",
          keepOriginal: true,
          keepProcessed: false,
          autoCleanup: true,
          cleanupAfterDays: 30,
        },
        knowledgeIntegration: {
          autoSaveToKnowledge: true,
          autoAddToIndex: true,
          defaultType: "note",
        },
        performance: {
          maxConcurrentJobs: 2,
          enableCache: true,
          cacheExpiration: 3600000,
        },
      },

      // 同步设置
      sync: {
        enabled: false,
        autoSync: true,
        syncInterval: 300000, // 5分钟
        conflictResolution: "ask", // ask, local, remote
      },

      // 备份设置
      backup: {
        enabled: true,
        autoBackup: true,
        backupInterval: 86400000, // 24小时
        maxBackups: 10,
      },

      // 隐私设置
      privacy: {
        analytics: true,
        crashReports: true,
        errorReporting: true,
        clipboardHistory: true,
      },

      // 性能设置
      performance: {
        hardwareAcceleration: true,
        gpuRasterization: true,
        maxMemory: 512, // MB
        cacheSize: 100, // MB
      },

      // 通知设置
      notifications: {
        enabled: true,
        sound: true,
        badge: true,
        desktop: true,
      },

      // 高级设置
      advanced: {
        devTools: false,
        experimentalFeatures: false,
        debugMode: false,
        logLevel: "info",
      },
    };
  }

  /**
   * 加载设置
   */
  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const content = fs.readFileSync(this.settingsPath, "utf8");
        const loaded = JSON.parse(content);

        // 合并默认设置和加载的设置
        this.settings = this.mergeSettings(this.defaults, loaded);

        console.log("[SettingsManager] Settings loaded");
      } else {
        // 使用默认设置
        this.settings = JSON.parse(JSON.stringify(this.defaults));
        this.saveSettings();
      }
    } catch (error) {
      console.error("[SettingsManager] Load settings error:", error);
      this.settings = JSON.parse(JSON.stringify(this.defaults));
    }
  }

  /**
   * 保存设置
   */
  saveSettings() {
    try {
      const content = JSON.stringify(this.settings, null, 2);
      fs.writeFileSync(this.settingsPath, content, "utf8");
      console.log("[SettingsManager] Settings saved");

      // 触发保存事件
      this.emit("saved", this.settings);

      return true;
    } catch (error) {
      console.error("[SettingsManager] Save settings error:", error);
      return false;
    }
  }

  /**
   * 合并设置
   */
  mergeSettings(defaults, loaded) {
    const merged = JSON.parse(JSON.stringify(defaults));

    for (const key in loaded) {
      if (typeof loaded[key] === "object" && !Array.isArray(loaded[key])) {
        merged[key] = this.mergeSettings(merged[key] || {}, loaded[key]);
      } else {
        merged[key] = loaded[key];
      }
    }

    return merged;
  }

  /**
   * 获取设置值
   */
  get(key, defaultValue = undefined) {
    const keys = key.split(".");
    let value = this.settings;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * 设置值
   */
  set(key, value) {
    const keys = key.split(".");
    const lastKey = keys.pop();
    let target = this.settings;

    // 导航到目标对象
    for (const k of keys) {
      if (!(k in target)) {
        target[k] = {};
      }
      target = target[k];
    }

    // 保存旧值
    const oldValue = target[lastKey];

    // 设置新值
    target[lastKey] = value;

    // 保存到文件
    this.saveSettings();

    // 触发变化事件
    this.emit("changed", key, value, oldValue);

    // 触发特定键的监听器
    this.notifyWatchers(key, value, oldValue);

    return true;
  }

  /**
   * 删除设置
   */
  delete(key) {
    const keys = key.split(".");
    const lastKey = keys.pop();
    let target = this.settings;

    for (const k of keys) {
      if (!(k in target)) {
        return false;
      }
      target = target[k];
    }

    if (lastKey in target) {
      delete target[lastKey];
      this.saveSettings();
      this.emit("deleted", key);
      return true;
    }

    return false;
  }

  /**
   * 检查设置是否存在
   */
  has(key) {
    const keys = key.split(".");
    let value = this.settings;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return false;
      }
    }

    return true;
  }

  /**
   * 获取所有设置
   */
  getAll() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  /**
   * 批量设置
   */
  setMultiple(settings) {
    for (const [key, value] of Object.entries(settings)) {
      this.set(key, value);
    }
  }

  /**
   * 重置为默认设置
   */
  reset() {
    this.settings = JSON.parse(JSON.stringify(this.defaults));
    this.saveSettings();
    this.emit("reset");
    console.log("[SettingsManager] Settings reset to defaults");
  }

  /**
   * 重置特定分类
   */
  resetCategory(category) {
    if (category in this.defaults) {
      this.settings[category] = JSON.parse(
        JSON.stringify(this.defaults[category]),
      );
      this.saveSettings();
      this.emit("categoryReset", category);
      console.log("[SettingsManager] Category reset:", category);
    }
  }

  /**
   * 监听设置变化
   */
  watch(key, callback) {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, []);
    }

    this.watchers.get(key).push(callback);

    // 返回取消监听的函数
    return () => {
      const callbacks = this.watchers.get(key);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    };
  }

  /**
   * 通知监听器
   */
  notifyWatchers(key, newValue, oldValue) {
    // 通知精确匹配的监听器
    if (this.watchers.has(key)) {
      for (const callback of this.watchers.get(key)) {
        try {
          callback(newValue, oldValue, key);
        } catch (error) {
          console.error("[SettingsManager] Watcher error:", error);
        }
      }
    }

    // 通知父级监听器
    const parts = key.split(".");
    for (let i = parts.length - 1; i > 0; i--) {
      const parentKey = parts.slice(0, i).join(".");
      if (this.watchers.has(parentKey)) {
        for (const callback of this.watchers.get(parentKey)) {
          try {
            callback(this.get(parentKey), undefined, parentKey);
          } catch (error) {
            console.error("[SettingsManager] Watcher error:", error);
          }
        }
      }
    }
  }

  /**
   * 监听设置文件变化
   */
  watchSettingsFile() {
    try {
      fs.watch(this.settingsPath, (eventType) => {
        if (eventType === "change") {
          console.log("[SettingsManager] Settings file changed externally");
          this.loadSettings();
          this.emit("externalChange");
        }
      });
    } catch (error) {
      console.error("[SettingsManager] Watch settings file error:", error);
    }
  }

  /**
   * 导出设置
   */
  export(outputPath) {
    try {
      const exportData = {
        settings: this.settings,
        version: app.getVersion(),
        exportTime: new Date().toISOString(),
      };

      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
      console.log("[SettingsManager] Settings exported to:", outputPath);
      return true;
    } catch (error) {
      console.error("[SettingsManager] Export settings error:", error);
      return false;
    }
  }

  /**
   * 导入设置
   */
  import(inputPath) {
    try {
      const content = fs.readFileSync(inputPath, "utf8");
      const data = JSON.parse(content);

      if (data.settings) {
        this.settings = this.mergeSettings(this.defaults, data.settings);
        this.saveSettings();
        this.emit("imported");
        console.log("[SettingsManager] Settings imported from:", inputPath);
        return true;
      }

      return false;
    } catch (error) {
      console.error("[SettingsManager] Import settings error:", error);
      return false;
    }
  }

  /**
   * 验证设置
   */
  validate() {
    const errors = [];

    // 验证语言
    const validLanguages = ["zh-CN", "en-US", "zh-TW", "ja-JP", "ko-KR"];
    if (!validLanguages.includes(this.get("general.language"))) {
      errors.push("Invalid language setting");
    }

    // 验证主题
    const validThemes = ["light", "dark", "auto"];
    if (!validThemes.includes(this.get("general.theme"))) {
      errors.push("Invalid theme setting");
    }

    // 验证字体大小
    const fontSize = this.get("editor.fontSize");
    if (fontSize < 10 || fontSize > 32) {
      errors.push("Font size out of range (10-32)");
    }

    // 验证同步间隔
    const syncInterval = this.get("sync.syncInterval");
    if (syncInterval < 60000) {
      // 最小1分钟
      errors.push("Sync interval too short (minimum 1 minute)");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取设置摘要
   */
  getSummary() {
    return {
      language: this.get("general.language"),
      theme: this.get("general.theme"),
      autoStart: this.get("general.autoStart"),
      syncEnabled: this.get("sync.enabled"),
      backupEnabled: this.get("backup.enabled"),
      analyticsEnabled: this.get("privacy.analytics"),
    };
  }
}

// 创建全局实例
let settingsManager = null;

function getSettingsManager(options) {
  if (!settingsManager) {
    settingsManager = new SettingsManager(options);
  }
  return settingsManager;
}

module.exports = { SettingsManager, getSettingsManager };
