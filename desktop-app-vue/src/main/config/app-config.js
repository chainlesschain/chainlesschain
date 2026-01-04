const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Load dotenv if available (optional in production)
try {
  require('dotenv').config();
} catch (err) {
  // dotenv is optional in production builds
}

/**
 * 应用配置管理器
 * 统一管理所有应用配置，支持环境变量和配置文件
 */
class AppConfig {
  constructor() {
    this.configPath = null;
    this.config = null;
  }

  /**
   * 初始化配置
   */
  initialize() {
    const userDataPath = app.getPath('userData');
    const configDir = path.join(userDataPath, 'config');

    // 确保配置目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.configPath = path.join(configDir, 'app-config.json');

    // 加载配置
    this.loadConfig();

    console.log('[AppConfig] 配置已加载');
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      let savedConfig = {};

      // 如果配置文件存在，读取保存的配置
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        savedConfig = JSON.parse(content);
      }

      // 合并默认配置、环境变量和保存的配置
      this.config = this.mergeConfigs(
        this.getDefaultConfig(),
        this.getEnvConfig(),
        savedConfig
      );

      // 保存合并后的配置
      this.saveConfig();
    } catch (error) {
      console.error('[AppConfig] 加载配置失败:', error);
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    const projectRoot = path.join(__dirname, '..', '..', '..', '..');

    return {
      // 项目存储配置
      project: {
        rootPath: path.join(projectRoot, 'data', 'projects'),
        maxSizeMB: 1000,
        allowedFileTypes: ['html', 'css', 'js', 'json', 'md', 'txt', 'pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'mp3'],
        autoSync: true,
        syncIntervalSeconds: 300,
      },

      // LLM 配置
      llm: {
        provider: 'volcengine',

        // Ollama
        ollamaHost: 'http://localhost:11434',
        ollamaModel: 'qwen2:7b',
        ollamaEmbeddingModel: 'bge-base-zh-v1.5',

        // OpenAI
        openaiApiKey: '',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiModel: 'gpt-3.5-turbo',
        openaiEmbeddingModel: 'text-embedding-ada-002',

        // 火山引擎（豆包）
        volcengineApiKey: '',
        volcengineModel: 'doubao-seed-1.6-lite',
        volcengineEmbeddingModel: 'doubao-embedding-large',

        // 阿里通义千问
        dashscopeApiKey: '',
        dashscopeModel: 'qwen-turbo',
        dashscopeEmbeddingModel: 'text-embedding-v1',

        // 智谱 AI
        zhipuApiKey: '',
        zhipuModel: 'glm-4',
        zhipuEmbeddingModel: 'embedding-2',

        // DeepSeek
        deepseekApiKey: '',
        deepseekModel: 'deepseek-chat',
        deepseekEmbeddingModel: 'text-embedding-ada-002',
      },

      // 向量数据库配置
      vector: {
        qdrantHost: 'http://localhost:6333',
        qdrantPort: 6333,
        qdrantCollection: 'chainlesschain_vectors',
        embeddingModel: 'bge-base-zh-v1.5',
        embeddingDimension: 768,
      },

      // Git 配置
      git: {
        enabled: false,
        autoSync: false,
        autoSyncInterval: 300,
        userName: 'ChainlessChain',
        userEmail: 'bot@chainlesschain.com',
        remoteUrl: '',
      },

      // 数据库配置
      database: {
        sqlcipherKey: '',
      },

      // 后端服务配置
      backend: {
        projectServiceUrl: 'http://localhost:9090',
        aiServiceUrl: 'http://localhost:8001',
      },
    };
  }

  /**
   * 从环境变量获取配置
   */
  getEnvConfig() {
    return {
      project: {
        rootPath: process.env.PROJECTS_ROOT_PATH,
      },
      llm: {
        provider: process.env.LLM_PROVIDER,
        ollamaHost: process.env.OLLAMA_HOST,
        ollamaModel: process.env.OLLAMA_MODEL,
        ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL,
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiBaseUrl: process.env.OPENAI_BASE_URL,
        openaiModel: process.env.OPENAI_MODEL || process.env.LLM_MODEL,
        openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
        volcengineApiKey: process.env.VOLCENGINE_API_KEY,
        volcengineModel: process.env.VOLCENGINE_MODEL,
        volcengineEmbeddingModel: process.env.VOLCENGINE_EMBEDDING_MODEL,
        dashscopeApiKey: process.env.DASHSCOPE_API_KEY,
        dashscopeModel: process.env.DASHSCOPE_MODEL,
        dashscopeEmbeddingModel: process.env.DASHSCOPE_EMBEDDING_MODEL,
        zhipuApiKey: process.env.ZHIPU_API_KEY,
        zhipuModel: process.env.ZHIPU_MODEL,
        zhipuEmbeddingModel: process.env.ZHIPU_EMBEDDING_MODEL,
        deepseekApiKey: process.env.DEEPSEEK_API_KEY,
        deepseekModel: process.env.DEEPSEEK_MODEL,
        deepseekEmbeddingModel: process.env.DEEPSEEK_EMBEDDING_MODEL,
      },
      vector: {
        qdrantHost: process.env.QDRANT_HOST,
        qdrantPort: process.env.QDRANT_PORT,
        qdrantCollection: process.env.QDRANT_COLLECTION,
        embeddingModel: process.env.EMBEDDING_MODEL,
        embeddingDimension: process.env.EMBEDDING_DIMENSION,
      },
      git: {
        enabled: process.env.GIT_ENABLED === 'true',
        autoSync: process.env.GIT_AUTO_SYNC === 'true',
        userName: process.env.GIT_USER_NAME,
        userEmail: process.env.GIT_USER_EMAIL,
        remoteUrl: process.env.GIT_REMOTE_URL,
      },
      database: {
        sqlcipherKey: process.env.SQLCIPHER_KEY,
      },
      backend: {
        projectServiceUrl: process.env.PROJECT_SERVICE_URL,
        aiServiceUrl: process.env.AI_SERVICE_URL,
      },
    };
  }

  /**
   * 深度合并配置对象
   */
  mergeConfigs(...configs) {
    const result = {};

    for (const config of configs) {
      for (const key in config) {
        if (config[key] && typeof config[key] === 'object' && !Array.isArray(config[key])) {
          result[key] = this.mergeConfigs(result[key] || {}, config[key]);
        } else if (config[key] !== undefined && config[key] !== null && config[key] !== '') {
          result[key] = config[key];
        } else if (result[key] === undefined) {
          result[key] = config[key];
        }
      }
    }

    return result;
  }

  /**
   * 保存配置文件
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log('[AppConfig] 配置已保存');
    } catch (error) {
      console.error('[AppConfig] 保存配置失败:', error);
    }
  }

  /**
   * 获取所有配置
   */
  getAllConfig() {
    return JSON.parse(JSON.stringify(this.config)); // 深拷贝
  }

  /**
   * 获取特定配置
   */
  getConfig(category) {
    return this.config[category] ? JSON.parse(JSON.stringify(this.config[category])) : null;
  }

  /**
   * 更新配置
   */
  updateConfig(updates) {
    this.config = this.mergeConfigs(this.config, updates);
    this.saveConfig();
    console.log('[AppConfig] 配置已更新');
  }

  /**
   * 重置为默认配置
   */
  resetConfig() {
    this.config = this.getDefaultConfig();
    this.saveConfig();
    console.log('[AppConfig] 配置已重置为默认值');
  }

  /**
   * 获取项目根路径
   */
  getProjectsRootPath() {
    return this.config?.project?.rootPath || this.getDefaultConfig().project.rootPath;
  }

  /**
   * 解析项目路径（相对路径转绝对路径）
   */
  resolveProjectPath(relativePath) {
    if (!relativePath) return '';

    // 如果已经是绝对路径，直接返回
    if (path.isAbsolute(relativePath) && !relativePath.startsWith('/data/projects')) {
      return relativePath;
    }

    // 如果是 /data/projects/ 开头的相对路径，转换为绝对路径
    if (relativePath.startsWith('/data/projects/')) {
      const projectId = relativePath.replace('/data/projects/', '');
      return path.join(this.getProjectsRootPath(), projectId);
    }

    // 其他情况，拼接到根路径
    return path.join(this.getProjectsRootPath(), relativePath);
  }

  /**
   * 导出配置到 .env 文件
   */
  exportToEnv(envPath) {
    try {
      const envContent = this.generateEnvContent();
      fs.writeFileSync(envPath, envContent, 'utf-8');
      console.log('[AppConfig] 配置已导出到:', envPath);
      return true;
    } catch (error) {
      console.error('[AppConfig] 导出配置失败:', error);
      return false;
    }
  }

  /**
   * 生成 .env 文件内容
   */
  generateEnvContent() {
    const lines = [
      '# ChainlessChain 桌面应用配置',
      '# 自动生成于 ' + new Date().toISOString(),
      '',
      '# ======================================== ',
      '# 项目存储配置',
      '# ======================================== ',
      `PROJECTS_ROOT_PATH=${this.config.project.rootPath}`,
      '',
      '# ======================================== ',
      '# LLM 配置',
      '# ======================================== ',
      `LLM_PROVIDER=${this.config.llm.provider}`,
      '',
      '# Ollama',
      `OLLAMA_HOST=${this.config.llm.ollamaHost}`,
      `OLLAMA_MODEL=${this.config.llm.ollamaModel}`,
      `OLLAMA_EMBEDDING_MODEL=${this.config.llm.ollamaEmbeddingModel}`,
      '',
      '# OpenAI',
      `OPENAI_API_KEY=${this.config.llm.openaiApiKey || ''}`,
      `OPENAI_BASE_URL=${this.config.llm.openaiBaseUrl}`,
      `OPENAI_MODEL=${this.config.llm.openaiModel}`,
      `OPENAI_EMBEDDING_MODEL=${this.config.llm.openaiEmbeddingModel}`,
      '',
      '# 火山引擎（豆包）',
      `VOLCENGINE_API_KEY=${this.config.llm.volcengineApiKey || ''}`,
      `VOLCENGINE_MODEL=${this.config.llm.volcengineModel}`,
      `VOLCENGINE_EMBEDDING_MODEL=${this.config.llm.volcengineEmbeddingModel}`,
      '',
      '# 阿里通义千问',
      `DASHSCOPE_API_KEY=${this.config.llm.dashscopeApiKey || ''}`,
      `DASHSCOPE_MODEL=${this.config.llm.dashscopeModel}`,
      `DASHSCOPE_EMBEDDING_MODEL=${this.config.llm.dashscopeEmbeddingModel}`,
      '',
      '# 智谱 AI',
      `ZHIPU_API_KEY=${this.config.llm.zhipuApiKey || ''}`,
      `ZHIPU_MODEL=${this.config.llm.zhipuModel}`,
      `ZHIPU_EMBEDDING_MODEL=${this.config.llm.zhipuEmbeddingModel}`,
      '',
      '# DeepSeek',
      `DEEPSEEK_API_KEY=${this.config.llm.deepseekApiKey || ''}`,
      `DEEPSEEK_MODEL=${this.config.llm.deepseekModel}`,
      `DEEPSEEK_EMBEDDING_MODEL=${this.config.llm.deepseekEmbeddingModel}`,
      '',
      '# ======================================== ',
      '# 向量数据库配置',
      '# ======================================== ',
      `QDRANT_HOST=${this.config.vector.qdrantHost}`,
      `QDRANT_PORT=${this.config.vector.qdrantPort}`,
      `QDRANT_COLLECTION=${this.config.vector.qdrantCollection}`,
      `EMBEDDING_MODEL=${this.config.vector.embeddingModel}`,
      `EMBEDDING_DIMENSION=${this.config.vector.embeddingDimension}`,
      '',
      '# ======================================== ',
      '# Git 配置',
      '# ======================================== ',
      `GIT_ENABLED=${this.config.git.enabled}`,
      `GIT_AUTO_SYNC=${this.config.git.autoSync}`,
      `GIT_USER_NAME=${this.config.git.userName}`,
      `GIT_USER_EMAIL=${this.config.git.userEmail}`,
      `GIT_REMOTE_URL=${this.config.git.remoteUrl || ''}`,
      '',
      '# ======================================== ',
      '# 数据库配置',
      '# ======================================== ',
      `SQLCIPHER_KEY=${this.config.database.sqlcipherKey || ''}`,
      '',
    ];

    return lines.join('\n');
  }
}

// 单例模式
let appConfigInstance = null;

function getAppConfig() {
  if (!appConfigInstance) {
    appConfigInstance = new AppConfig();
    appConfigInstance.initialize();
  }
  return appConfigInstance;
}

module.exports = {
  AppConfig,
  getAppConfig,
};
