/**
 * AI引擎优化配置
 * 集中管理槽位填充、工具沙箱、性能监控等优化模块的配置
 *
 * 版本: v0.16.1
 * 更新: 2026-01-01
 */

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 是否启用槽位填充（自动补全缺失参数）
  enableSlotFilling: true,

  // 是否启用工具沙箱（超时保护、自动重试、结果校验）
  enableToolSandbox: true,

  // 是否启用性能监控（P50/P90/P95统计、瓶颈识别）
  enablePerformanceMonitor: true,

  // 工具沙箱配置
  sandboxConfig: {
    timeout: 30000,           // 工具执行超时时间（毫秒）
    retries: 2,               // 失败后重试次数
    retryDelay: 1000,         // 重试延迟（毫秒）
    enableValidation: true,   // 是否启用结果校验
    enableSnapshot: true      // 是否启用快照回滚（文件操作）
  },

  // 性能监控配置
  performanceConfig: {
    // 性能阈值（毫秒）
    thresholds: {
      intent_recognition: {
        warning: 1500,
        critical: 3000
      },
      task_planning: {
        warning: 4000,
        critical: 8000
      },
      tool_execution: {
        warning: 5000,
        critical: 10000
      },
      rag_retrieval: {
        warning: 2000,
        critical: 5000
      },
      llm_calls: {
        warning: 3000,
        critical: 6000
      },
      total_pipeline: {
        warning: 10000,
        critical: 20000
      }
    },

    // 数据保留期（天）
    retentionDays: 30,

    // 是否自动清理旧数据
    autoCleanup: true
  },

  // 槽位填充配置
  slotFillingConfig: {
    // 是否启用LLM增强推断（用于可选槽位）
    enableLLMInference: true,

    // 是否启用用户偏好学习
    enablePreferenceLearning: true,

    // 是否在缺失必需槽位时询问用户
    askUserForMissing: true,

    // 最大询问次数（防止无限循环）
    maxAskCount: 5
  }
};

/**
 * 生产环境配置（更保守）
 */
const PRODUCTION_CONFIG = {
  ...DEFAULT_CONFIG,
  sandboxConfig: {
    ...DEFAULT_CONFIG.sandboxConfig,
    timeout: 60000,           // 生产环境更长的超时时间
    retries: 3                // 更多重试次数
  },
  performanceConfig: {
    ...DEFAULT_CONFIG.performanceConfig,
    retentionDays: 90         // 生产环境保留更久的数据
  }
};

/**
 * 开发环境配置（更激进，快速失败）
 */
const DEVELOPMENT_CONFIG = {
  ...DEFAULT_CONFIG,
  sandboxConfig: {
    ...DEFAULT_CONFIG.sandboxConfig,
    timeout: 15000,           // 开发环境更短的超时
    retries: 1                // 快速失败
  },
  performanceConfig: {
    ...DEFAULT_CONFIG.performanceConfig,
    retentionDays: 7,         // 开发环境数据保留更短
    thresholds: {
      // 开发环境阈值更严格，帮助及早发现性能问题
      intent_recognition: { warning: 1000, critical: 2000 },
      task_planning: { warning: 3000, critical: 6000 },
      tool_execution: { warning: 3000, critical: 5000 },
      rag_retrieval: { warning: 1500, critical: 3000 },
      llm_calls: { warning: 2000, critical: 4000 },
      total_pipeline: { warning: 8000, critical: 15000 }
    }
  }
};

/**
 * 测试环境配置（性能监控关闭，避免干扰测试）
 */
const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  enablePerformanceMonitor: false,  // 测试时不记录性能
  sandboxConfig: {
    ...DEFAULT_CONFIG.sandboxConfig,
    timeout: 5000,
    retries: 0,                       // 测试时不重试
    enableSnapshot: false              // 测试时不创建快照
  }
};

/**
 * 获取当前环境配置
 */
function getAIEngineConfig() {
  const env = process.env.NODE_ENV || 'development';

  switch (env) {
    case 'production':
      return PRODUCTION_CONFIG;
    case 'test':
      return TEST_CONFIG;
    case 'development':
    default:
      return DEVELOPMENT_CONFIG;
  }
}

/**
 * 合并用户自定义配置
 * @param {Object} userConfig - 用户自定义配置
 * @returns {Object} 合并后的配置
 */
function mergeConfig(userConfig = {}) {
  const baseConfig = getAIEngineConfig();

  return {
    ...baseConfig,
    ...userConfig,
    sandboxConfig: {
      ...baseConfig.sandboxConfig,
      ...(userConfig.sandboxConfig || {})
    },
    performanceConfig: {
      ...baseConfig.performanceConfig,
      ...(userConfig.performanceConfig || {}),
      thresholds: {
        ...baseConfig.performanceConfig.thresholds,
        ...(userConfig.performanceConfig?.thresholds || {})
      }
    },
    slotFillingConfig: {
      ...baseConfig.slotFillingConfig,
      ...(userConfig.slotFillingConfig || {})
    }
  };
}

module.exports = {
  DEFAULT_CONFIG,
  PRODUCTION_CONFIG,
  DEVELOPMENT_CONFIG,
  TEST_CONFIG,
  getAIEngineConfig,
  mergeConfig
};
