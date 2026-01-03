/**
 * 性能配置管理器
 * 提供配置加载、验证、预设切换等功能
 */

const fs = require('fs');
const path = require('path');

class PerformanceConfigManager {
  constructor() {
    this.config = null;
    this.presets = {
      // 预设1: 低端设备模式
      'low-end': {
        graph: {
          lod: {
            maxNodesForFull: 100,
            maxNodesForSimplified: 300,
            clusterThreshold: 500,
            progressiveChunkSize: 50,
          },
          rendering: {
            enableClusteringByDefault: true,
            enableProgressiveByDefault: true,
            targetFPS: 20,
          },
        },
        database: {
          query: {
            defaultLimit: 50,
            maxLimit: 500,
            enableCache: true,
            cacheExpiry: 600000, // 10分钟
          },
          pagination: {
            defaultPageSize: 30,
            messagesPageSize: 30,
            graphPageSize: 300,
          },
        },
        p2p: {
          pool: {
            maxConnections: 50,
            minConnections: 5,
            maxIdleTime: 180000, // 3分钟
          },
        },
        chat: {
          pagination: {
            messagesPerPage: 30,
            initialLoadCount: 20,
          },
        },
      },

      // 预设2: 平衡模式（默认）
      'balanced': {
        graph: {
          lod: {
            maxNodesForFull: 200,
            maxNodesForSimplified: 500,
            clusterThreshold: 1000,
            progressiveChunkSize: 100,
          },
          rendering: {
            enableClusteringByDefault: false,
            enableProgressiveByDefault: true,
            targetFPS: 30,
          },
        },
        database: {
          query: {
            defaultLimit: 100,
            maxLimit: 1000,
            enableCache: true,
            cacheExpiry: 300000, // 5分钟
          },
          pagination: {
            defaultPageSize: 50,
            messagesPageSize: 50,
            graphPageSize: 500,
          },
        },
        p2p: {
          pool: {
            maxConnections: 100,
            minConnections: 10,
            maxIdleTime: 300000, // 5分钟
          },
        },
        chat: {
          pagination: {
            messagesPerPage: 50,
            initialLoadCount: 30,
          },
        },
      },

      // 预设3: 高性能模式
      'high-performance': {
        graph: {
          lod: {
            maxNodesForFull: 300,
            maxNodesForSimplified: 800,
            clusterThreshold: 1500,
            progressiveChunkSize: 150,
          },
          rendering: {
            enableClusteringByDefault: false,
            enableProgressiveByDefault: true,
            targetFPS: 40,
          },
        },
        database: {
          query: {
            defaultLimit: 150,
            maxLimit: 2000,
            enableCache: true,
            cacheExpiry: 180000, // 3分钟
          },
          pagination: {
            defaultPageSize: 100,
            messagesPageSize: 100,
            graphPageSize: 800,
          },
        },
        p2p: {
          pool: {
            maxConnections: 200,
            minConnections: 20,
            maxIdleTime: 600000, // 10分钟
          },
        },
        chat: {
          pagination: {
            messagesPerPage: 100,
            initialLoadCount: 50,
          },
        },
      },

      // 预设4: 极限性能模式
      'extreme': {
        graph: {
          lod: {
            maxNodesForFull: 500,
            maxNodesForSimplified: 1200,
            clusterThreshold: 2000,
            progressiveChunkSize: 200,
          },
          rendering: {
            enableClusteringByDefault: false,
            enableProgressiveByDefault: false,
            targetFPS: 60,
          },
        },
        database: {
          query: {
            defaultLimit: 200,
            maxLimit: 5000,
            enableCache: true,
            cacheExpiry: 120000, // 2分钟
          },
          pagination: {
            defaultPageSize: 150,
            messagesPageSize: 150,
            graphPageSize: 1000,
          },
        },
        p2p: {
          pool: {
            maxConnections: 300,
            minConnections: 30,
            maxIdleTime: 900000, // 15分钟
          },
        },
        chat: {
          pagination: {
            messagesPerPage: 150,
            initialLoadCount: 100,
          },
        },
      },
    };
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, '..', 'config', 'performance.config.js');
      delete require.cache[require.resolve(configPath)];
      this.config = require(configPath);
      return this.config;
    } catch (error) {
      console.error('[PerformanceConfig] 加载配置失败:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return this.presets['balanced'];
  }

  /**
   * 应用预设
   */
  applyPreset(presetName) {
    if (!this.presets[presetName]) {
      throw new Error(`未知的预设: ${presetName}`);
    }

    console.log(`[PerformanceConfig] 应用预设: ${presetName}`);

    const preset = this.presets[presetName];

    // 深度合并预设到当前配置
    this.config = this.deepMerge(this.config || {}, preset);

    return this.config;
  }

  /**
   * 根据系统资源自动选择预设
   */
  autoSelectPreset() {
    const os = require('os');
    const totalMemory = os.totalmem();
    const cpuCount = os.cpus().length;

    // 内存 < 4GB 或 CPU < 4核 -> 低端模式
    if (totalMemory < 4 * 1024 * 1024 * 1024 || cpuCount < 4) {
      console.log('[PerformanceConfig] 自动选择: low-end (内存或CPU不足)');
      return this.applyPreset('low-end');
    }

    // 内存 >= 16GB 且 CPU >= 8核 -> 高性能模式
    if (totalMemory >= 16 * 1024 * 1024 * 1024 && cpuCount >= 8) {
      console.log('[PerformanceConfig] 自动选择: high-performance (高配置系统)');
      return this.applyPreset('high-performance');
    }

    // 其他 -> 平衡模式
    console.log('[PerformanceConfig] 自动选择: balanced (标准配置)');
    return this.applyPreset('balanced');
  }

  /**
   * 验证配置
   */
  validateConfig(config) {
    const errors = [];

    // 验证图谱配置
    if (config.graph) {
      if (config.graph.lod.maxNodesForFull > config.graph.lod.maxNodesForSimplified) {
        errors.push('maxNodesForFull 不能大于 maxNodesForSimplified');
      }

      if (config.graph.lod.maxNodesForSimplified > config.graph.lod.clusterThreshold) {
        errors.push('maxNodesForSimplified 不能大于 clusterThreshold');
      }

      if (config.graph.rendering.targetFPS < 10 || config.graph.rendering.targetFPS > 120) {
        errors.push('targetFPS 应在 10-120 之间');
      }
    }

    // 验证数据库配置
    if (config.database) {
      if (config.database.query.defaultLimit > config.database.query.maxLimit) {
        errors.push('defaultLimit 不能大于 maxLimit');
      }

      if (config.database.query.cacheExpiry < 1000) {
        errors.push('cacheExpiry 不能小于 1000ms');
      }
    }

    // 验证P2P配置
    if (config.p2p) {
      if (config.p2p.pool.minConnections > config.p2p.pool.maxConnections) {
        errors.push('minConnections 不能大于 maxConnections');
      }

      if (config.p2p.pool.maxIdleTime < 10000) {
        errors.push('maxIdleTime 不能小于 10000ms (10秒)');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    if (!this.config) {
      this.loadConfig();
    }
    return this.config;
  }

  /**
   * 获取特定模块配置
   */
  getModuleConfig(moduleName) {
    const config = this.getConfig();
    return config[moduleName] || null;
  }

  /**
   * 更新配置
   */
  updateConfig(updates) {
    this.config = this.deepMerge(this.config || {}, updates);

    // 验证更新后的配置
    const validation = this.validateConfig(this.config);
    if (!validation.valid) {
      console.warn('[PerformanceConfig] 配置验证失败:', validation.errors);
    }

    return this.config;
  }

  /**
   * 保存配置到文件
   */
  saveConfig(config = this.config) {
    try {
      const configPath = path.join(__dirname, '..', 'config', 'performance.config.js');
      const content = `module.exports = ${JSON.stringify(config, null, 2)};`;
      fs.writeFileSync(configPath, content, 'utf8');
      console.log('[PerformanceConfig] 配置已保存');
      return true;
    } catch (error) {
      console.error('[PerformanceConfig] 保存配置失败:', error);
      return false;
    }
  }

  /**
   * 导出配置为JSON
   */
  exportConfig(filepath) {
    try {
      const config = this.getConfig();
      fs.writeFileSync(filepath, JSON.stringify(config, null, 2), 'utf8');
      console.log(`[PerformanceConfig] 配置已导出到: ${filepath}`);
      return true;
    } catch (error) {
      console.error('[PerformanceConfig] 导出配置失败:', error);
      return false;
    }
  }

  /**
   * 从JSON导入配置
   */
  importConfig(filepath) {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const config = JSON.parse(content);

      // 验证配置
      const validation = this.validateConfig(config);
      if (!validation.valid) {
        throw new Error(`配置验证失败: ${validation.errors.join(', ')}`);
      }

      this.config = config;
      console.log(`[PerformanceConfig] 配置已从 ${filepath} 导入`);
      return true;
    } catch (error) {
      console.error('[PerformanceConfig] 导入配置失败:', error);
      return false;
    }
  }

  /**
   * 重置为默认配置
   */
  reset() {
    this.config = this.getDefaultConfig();
    console.log('[PerformanceConfig] 配置已重置为默认值');
    return this.config;
  }

  /**
   * 深度合并对象
   */
  deepMerge(target, source) {
    const output = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }

    return output;
  }

  /**
   * 获取配置摘要
   */
  getConfigSummary() {
    const config = this.getConfig();

    return {
      graph: {
        maxNodes: config.graph?.lod?.clusterThreshold || 'N/A',
        targetFPS: config.graph?.rendering?.targetFPS || 'N/A',
        progressive: config.graph?.rendering?.enableProgressiveByDefault || false,
      },
      database: {
        cacheEnabled: config.database?.query?.enableCache || false,
        pageSize: config.database?.pagination?.defaultPageSize || 'N/A',
      },
      p2p: {
        maxConnections: config.p2p?.pool?.maxConnections || 'N/A',
        healthCheck: config.p2p?.healthCheck?.enabled || false,
      },
      chat: {
        messagesPerPage: config.chat?.pagination?.messagesPerPage || 'N/A',
        virtualScroll: config.chat?.loading?.enableVirtualScroll || false,
      },
    };
  }
}

// 单例模式
let instance = null;

function getPerformanceConfigManager() {
  if (!instance) {
    instance = new PerformanceConfigManager();
  }
  return instance;
}

module.exports = {
  PerformanceConfigManager,
  getPerformanceConfigManager,
};
