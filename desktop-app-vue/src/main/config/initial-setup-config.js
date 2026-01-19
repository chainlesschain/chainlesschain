const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
  setupCompleted: false,
  completedAt: null,
  edition: "personal",
  paths: {
    projectRoot: "",
    database: "",
  },
  llm: {
    provider: "ollama",
    apiKey: "",
    baseUrl: "",
    model: "",
  },
  enterprise: {
    serverUrl: "",
    apiKey: "",
    tenantId: "",
  },
};

class InitialSetupConfig {
  constructor(userDataPath) {
    this.configPath = path.join(userDataPath, "initial-setup-config.json");
    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf8");
        // 使用深拷贝确保DEFAULT_CONFIG不被修改
        const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        return { ...defaultConfig, ...JSON.parse(data) };
      }
    } catch (error) {
      console.error("加载初始设置配置失败:", error);
    }
    // 使用深拷贝返回默认配置
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  save() {
    try {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        "utf8",
      );
    } catch (error) {
      console.error("保存初始设置配置失败:", error);
      throw error;
    }
  }

  isFirstTimeSetup() {
    return !this.config.setupCompleted;
  }

  markSetupComplete() {
    this.config.setupCompleted = true;
    this.config.completedAt = new Date().toISOString();
  }

  getAll() {
    return { ...this.config };
  }

  get(key) {
    const keys = key.split(".");
    let value = this.config;
    for (const k of keys) {
      value = value?.[k];
    }
    return value;
  }

  set(key, value) {
    const keys = key.split(".");
    let obj = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) {obj[keys[i]] = {};}
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }

  /**
   * 应用配置到系统各个配置管理器
   */
  async applyToSystem(appConfig, llmConfig, database) {
    // 1. 应用版本设置到 app-config
    if (this.config.edition) {
      appConfig.set("app.edition", this.config.edition);
    }

    // 2. 应用项目路径
    if (this.config.paths?.projectRoot) {
      await database.setSetting(
        "project.rootPath",
        this.config.paths.projectRoot,
      );
    }

    // 3. 应用数据库路径
    if (this.config.paths?.database) {
      appConfig.setDatabasePath(this.config.paths.database);
    }

    // 4. 应用 LLM 配置
    if (this.config.llm && this.config.llm.provider) {
      llmConfig.set("provider", this.config.llm.provider);

      const provider = this.config.llm.provider;
      if (this.config.llm.apiKey) {
        llmConfig.set(`${provider}.apiKey`, this.config.llm.apiKey);
      }
      if (this.config.llm.baseUrl) {
        llmConfig.set(`${provider}.baseURL`, this.config.llm.baseUrl);
      }
      if (this.config.llm.model) {
        llmConfig.set(`${provider}.model`, this.config.llm.model);
      }

      llmConfig.save();
    }

    // 5. 应用企业版配置
    if (this.config.edition === "enterprise" && this.config.enterprise) {
      await database.setSetting(
        "enterprise.serverUrl",
        this.config.enterprise.serverUrl,
      );
      await database.setSetting(
        "enterprise.tenantId",
        this.config.enterprise.tenantId,
      );
      // API Key 应加密存储
      if (this.config.enterprise.apiKey) {
        await database.setSetting(
          "enterprise.apiKey",
          this.config.enterprise.apiKey,
        );
      }
    }

    appConfig.save();
  }

  reset() {
    // 使用JSON深拷贝确保嵌套对象也被重置
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.save();
  }
}

module.exports = InitialSetupConfig;
