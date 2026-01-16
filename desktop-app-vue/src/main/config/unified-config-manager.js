/**
 * 统一配置管理器
 *
 * 基于 OpenClaude 最佳实践，集中管理所有配置、日志、缓存和会话数据
 *
 * 目录结构：
 * .chainlesschain/
 * ├── config.json              # 核心配置
 * ├── rules.md                 # 项目规则
 * ├── memory/                  # 会话与学习数据
 * │   ├── sessions/            # 会话历史
 * │   ├── preferences/         # 用户偏好
 * │   └── learned-patterns/    # 学习到的模式
 * ├── logs/                    # 操作日志
 * │   ├── error.log
 * │   ├── performance.log
 * │   └── llm-usage.log
 * ├── cache/                   # 缓存数据
 * │   ├── embeddings/          # 向量缓存
 * │   ├── query-results/       # 查询结果缓存
 * │   └── model-outputs/       # 模型输出缓存
 * └── checkpoints/             # 检查点和备份
 *     └── auto-backup/
 *
 * @version 1.0.0
 * @since 2026-01-16
 */

const fs = require('fs');
const path = require('path');

// 统一配置目录（项目根目录下）
const CONFIG_DIR = path.join(process.cwd(), '.chainlesschain');

/**
 * 统一配置管理器类
 */
class UnifiedConfigManager {
  constructor() {
    this.configPath = path.join(CONFIG_DIR, 'config.json');
    this.config = null;
    this.paths = {
      root: CONFIG_DIR,
      config: path.join(CONFIG_DIR, 'config.json'),
      rules: path.join(CONFIG_DIR, 'rules.md'),
      memory: path.join(CONFIG_DIR, 'memory'),
      sessions: path.join(CONFIG_DIR, 'memory', 'sessions'),
      preferences: path.join(CONFIG_DIR, 'memory', 'preferences'),
      learnedPatterns: path.join(CONFIG_DIR, 'memory', 'learned-patterns'),
      logs: path.join(CONFIG_DIR, 'logs'),
      cache: path.join(CONFIG_DIR, 'cache'),
      embeddings: path.join(CONFIG_DIR, 'cache', 'embeddings'),
      queryResults: path.join(CONFIG_DIR, 'cache', 'query-results'),
      modelOutputs: path.join(CONFIG_DIR, 'cache', 'model-outputs'),
      checkpoints: path.join(CONFIG_DIR, 'checkpoints'),
      autoBackup: path.join(CONFIG_DIR, 'checkpoints', 'auto-backup')
    };
  }

  /**
   * 初始化配置管理器
   * - 创建目录结构
   * - 加载配置文件
   * - 合并环境变量
   */
  initialize() {
    // 1. 确保目录结构存在
    this.ensureDirectoryStructure();

    // 2. 加载配置
    this.loadConfig();

    // 3. 验证配置
    this.validateConfig();

    console.log('[UnifiedConfigManager] 配置已加载');
    console.log('[UnifiedConfigManager] 配置目录:', CONFIG_DIR);
  }

  /**
   * 确保目录结构存在
   */
  ensureDirectoryStructure() {
    // 创建所有必需的目录
    Object.values(this.paths).forEach(dirPath => {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });

    // 如果配置文件不存在，从模板复制
    if (!fs.existsSync(this.configPath)) {
      const examplePath = path.join(CONFIG_DIR, 'config.json.example');
      if (fs.existsSync(examplePath)) {
        fs.copyFileSync(examplePath, this.configPath);
        console.log('[UnifiedConfigManager] 已从模板创建配置文件');
      } else {
        // 创建默认配置
        fs.writeFileSync(this.configPath, JSON.stringify(this.getDefaultConfig(), null, 2));
        console.log('[UnifiedConfigManager] 已创建默认配置文件');
      }
    }
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      // 读取配置文件
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      const fileConfig = JSON.parse(configContent);

      // 合并环境变量
      const envConfig = this.getEnvConfig();

      // 深度合并配置
      this.config = this.mergeConfigs(
        this.getDefaultConfig(),
        fileConfig,
        envConfig
      );

      // 保存合并后的配置
      this.saveConfig();
    } catch (error) {
      console.error('[UnifiedConfigManager] 加载配置失败:', error);
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return {
      model: {
        defaultProvider: 'ollama',
        temperature: 0.1,
        maxTokens: 4000,
        enableMemory: true,
        enableStreaming: true
      },
      cost: {
        monthlyBudget: 50,
        alertThreshold: 40,
        preferLocalModels: true
      },
      performance: {
        cacheEnabled: true,
        cacheTTL: 3600,
        contextCompressionThreshold: 10
      },
      quality: {
        preCommitChecks: true,
        autoFix: true,
        securityScanning: true
      },
      logging: {
        level: 'INFO',
        enableFile: true,
        enableConsole: true,
        maxFileSize: 10, // MB
        maxFiles: 30
      },
      paths: {
        logsDir: this.paths.logs,
        cacheDir: this.paths.cache,
        memoryDir: this.paths.memory,
        checkpointsDir: this.paths.checkpoints
      }
    };
  }

  /**
   * 从环境变量获取配置
   */
  getEnvConfig() {
    return {
      model: {
        defaultProvider: process.env.LLM_PROVIDER,
        temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : undefined,
        maxTokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS) : undefined
      },
      cost: {
        monthlyBudget: process.env.LLM_MONTHLY_BUDGET ? parseFloat(process.env.LLM_MONTHLY_BUDGET) : undefined,
        preferLocalModels: process.env.PREFER_LOCAL_MODELS === 'true' ? true : undefined
      },
      logging: {
        level: process.env.LOG_LEVEL
      }
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
   * 验证配置
   */
  validateConfig() {
    // 验证必需的配置项
    if (!this.config.model || !this.config.model.defaultProvider) {
      console.warn('[UnifiedConfigManager] 缺少 LLM 提供商配置');
    }

    if (!this.config.logging || !this.config.logging.level) {
      console.warn('[UnifiedConfigManager] 缺少日志级别配置');
    }

    // 验证预算设置
    if (this.config.cost.monthlyBudget <= 0) {
      console.warn('[UnifiedConfigManager] 月度预算必须大于 0');
    }
  }

  /**
   * 保存配置文件
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.error('[UnifiedConfigManager] 保存配置失败:', error);
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
    console.log('[UnifiedConfigManager] 配置已更新');
  }

  /**
   * 重置为默认配置
   */
  resetConfig() {
    this.config = this.getDefaultConfig();
    this.saveConfig();
    console.log('[UnifiedConfigManager] 配置已重置为默认值');
  }

  /**
   * 获取路径配置
   */
  getPaths() {
    return { ...this.paths };
  }

  /**
   * 获取日志目录
   */
  getLogsDir() {
    return this.paths.logs;
  }

  /**
   * 获取缓存目录
   */
  getCacheDir() {
    return this.paths.cache;
  }

  /**
   * 获取会话目录
   */
  getSessionsDir() {
    return this.paths.sessions;
  }

  /**
   * 获取检查点目录
   */
  getCheckpointsDir() {
    return this.paths.checkpoints;
  }

  /**
   * 清理缓存
   * @param {string} type - 缓存类型：'all', 'embeddings', 'queryResults', 'modelOutputs'
   */
  clearCache(type = 'all') {
    try {
      const cacheDirs = {
        all: [this.paths.embeddings, this.paths.queryResults, this.paths.modelOutputs],
        embeddings: [this.paths.embeddings],
        queryResults: [this.paths.queryResults],
        modelOutputs: [this.paths.modelOutputs]
      };

      const dirsToClean = cacheDirs[type] || cacheDirs.all;

      dirsToClean.forEach(dir => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          files.forEach(file => {
            const filePath = path.join(dir, file);
            try {
              if (fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
              }
            } catch (err) {
              console.error(`Failed to delete cache file: ${filePath}`, err);
            }
          });
        }
      });

      console.log(`[UnifiedConfigManager] 已清理缓存: ${type}`);
      return { success: true, type };
    } catch (error) {
      console.error('[UnifiedConfigManager] 清理缓存失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 清理旧日志文件
   * @param {number} maxFiles - 保留的最大文件数
   */
  cleanOldLogs(maxFiles = 30) {
    try {
      const logFiles = fs.readdirSync(this.paths.logs)
        .filter(f => f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.paths.logs, f),
          time: fs.statSync(path.join(this.paths.logs, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // 删除超过数量限制的文件
      if (logFiles.length > maxFiles) {
        const filesToDelete = logFiles.slice(maxFiles);
        filesToDelete.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (error) {
            console.error(`Failed to delete log file: ${file.name}`, error);
          }
        });
        console.log(`[UnifiedConfigManager] 已清理 ${filesToDelete.length} 个旧日志文件`);
      }

      return { success: true, cleaned: logFiles.length - maxFiles };
    } catch (error) {
      console.error('[UnifiedConfigManager] 清理日志失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 导出配置
   * @param {string} exportPath - 导出路径
   */
  exportConfig(exportPath) {
    try {
      const exportData = {
        config: this.config,
        paths: this.paths,
        exportedAt: new Date().toISOString()
      };

      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
      console.log('[UnifiedConfigManager] 配置已导出到:', exportPath);
      return { success: true, path: exportPath };
    } catch (error) {
      console.error('[UnifiedConfigManager] 导出配置失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 导入配置
   * @param {string} importPath - 导入路径
   */
  importConfig(importPath) {
    try {
      const content = fs.readFileSync(importPath, 'utf-8');
      const importData = JSON.parse(content);

      if (importData.config) {
        this.config = importData.config;
        this.saveConfig();
        console.log('[UnifiedConfigManager] 配置已从文件导入:', importPath);
        return { success: true };
      } else {
        throw new Error('Invalid config file format');
      }
    } catch (error) {
      console.error('[UnifiedConfigManager] 导入配置失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取配置摘要（用于调试）
   */
  getConfigSummary() {
    return {
      provider: this.config.model.defaultProvider,
      loggingLevel: this.config.logging.level,
      cacheEnabled: this.config.performance.cacheEnabled,
      monthlyBudget: this.config.cost.monthlyBudget,
      configPath: this.configPath,
      paths: {
        logs: this.paths.logs,
        cache: this.paths.cache,
        memory: this.paths.memory
      }
    };
  }
}

// 单例模式
let unifiedConfigInstance = null;

/**
 * 获取统一配置管理器实例
 */
function getUnifiedConfigManager() {
  if (!unifiedConfigInstance) {
    unifiedConfigInstance = new UnifiedConfigManager();
    unifiedConfigInstance.initialize();
  }
  return unifiedConfigInstance;
}

module.exports = {
  UnifiedConfigManager,
  getUnifiedConfigManager,
  CONFIG_DIR
};
