/**
 * AI引擎优化配置
 * 集中管理槽位填充、工具沙箱、性能监控等优化模块的配置
 *
 * 版本: v0.18.0 (P2优化)
 * 更新: 2026-01-01
 */

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // P0优化模块（已实现）
  // 是否启用槽位填充（自动补全缺失参数）
  enableSlotFilling: true,

  // 是否启用工具沙箱（超时保护、自动重试、结果校验）
  enableToolSandbox: true,

  // 是否启用性能监控（P50/P90/P95统计、瓶颈识别）
  enablePerformanceMonitor: true,

  // P1优化模块（新增）
  // 是否启用多意图识别
  enableMultiIntent: true,

  // 是否启用动态Few-shot学习
  enableDynamicFewShot: true,

  // 是否启用分层任务规划
  enableHierarchicalPlanning: true,

  // 是否启用检查点校验
  enableCheckpointValidation: true,

  // 是否启用自我修正循环
  enableSelfCorrection: true,

  // P2核心模块（v0.18.0）
  // 是否启用意图融合（合并相似意图，减少LLM调用）
  enableIntentFusion: true,

  // 是否启用知识蒸馏（小模型处理简单任务）
  enableKnowledgeDistillation: true,

  // 是否启用流式响应（实时进度反馈）
  enableStreamingResponse: true,

  // P2扩展模块（v0.20.0）
  // 是否启用任务分解增强
  enableTaskDecomposition: true,

  // 是否启用工具组合系统
  enableToolComposition: true,

  // 是否启用历史记忆优化
  enableHistoryMemory: true,

  // 智能层模块（v0.24.0 Phase 1-4）
  // 是否启用智能层（数据收集、用户画像、ML推荐、混合推荐）
  enableIntelligenceLayer: true,

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
  },

  // P1优化模块配置
  // 多意图识别配置
  multiIntentConfig: {
    // 意图分隔符检测敏感度
    sensitivity: 'medium',  // 'low' | 'medium' | 'high'

    // 是否启用LLM增强拆分
    enableLLMSplit: true,

    // 最大意图数量
    maxIntents: 5
  },

  // 动态Few-shot配置
  fewShotConfig: {
    // 默认示例数量
    defaultExampleCount: 3,

    // 最小置信度阈值（只使用高质量示例）
    minConfidence: 0.85,

    // 缓存过期时间（毫秒）
    cacheExpiry: 3600000,  // 1小时

    // 是否启用自适应示例数量
    adaptiveExampleCount: true
  },

  // 分层任务规划配置
  hierarchicalPlanningConfig: {
    // 默认粒度
    defaultGranularity: 'auto',  // 'coarse' | 'medium' | 'fine' | 'auto'

    // 是否启用复杂度评估
    enableComplexityAssessment: true,

    // 是否启用时长估算
    enableDurationEstimation: true
  },

  // 检查点校验配置
  checkpointValidationConfig: {
    // 是否启用LLM质量检查
    enableLLMQualityCheck: true,

    // 质量检查触发条件
    qualityCheckTriggers: ['CREATE_FILE', 'GENERATE_CONTENT', 'ANALYZE_DATA'],

    // 完整性阈值（%）
    completenessThreshold: 80,

    // 是否在校验失败时自动重试
    autoRetryOnFailure: true
  },

  // 自我修正配置
  selfCorrectionConfig: {
    // 最大修正尝试次数
    maxRetries: 3,

    // 是否启用失败模式学习
    enablePatternLearning: true,

    // 修正策略
    strategies: [
      'add_dependency',
      'regenerate_params',
      'increase_timeout',
      'simplify_task',
      'add_validation',
      'change_tool',
      'split_task',
      'skip_step'
    ]
  },

  // P2优化模块配置（新增 v0.18.0）
  // 意图融合配置
  intentFusionConfig: {
    // 是否启用规则融合（基于规则合并意图）
    enableRuleFusion: true,

    // 是否启用LLM融合（智能判断复杂场景）
    enableLLMFusion: true,

    // LLM融合置信度阈值
    llmFusionConfidenceThreshold: 0.8,

    // 融合策略
    strategies: [
      'same_file_operations',      // 同文件操作合并
      'sequence_operations',        // 顺序操作合并
      'batch_operations',           // 批量操作合并
      'dependency_operations'       // 依赖操作合并
    ],

    // 最大融合窗口（一次最多融合几个意图）
    maxFusionWindow: 5
  },

  // 知识蒸馏配置
  knowledgeDistillationConfig: {
    // 小模型配置
    studentModel: {
      model: 'qwen2:1.5b',
      temperature: 0.5,
      maxTokens: 1024
    },

    // 大模型配置
    teacherModel: {
      model: 'qwen2:7b',
      temperature: 0.7,
      maxTokens: 2048
    },

    // 路由配置
    routing: {
      // 复杂度阈值（0-1，超过此值使用大模型）
      // 调整说明：从 0.5 降低到 0.35，让更多中等复杂度任务使用小模型
      // 这样可以提高小模型使用率，节省成本，同时保证质量
      // 复杂度分布：简单(0.15-0.25) → small, 中等(0.25-0.35) → small, 复杂(0.35+) → large
      complexityThreshold: 0.35,

      // 小模型准确率阈值（低于此值使用大模型）
      studentAccuracyThreshold: 0.85,

      // 置信度阈值（低于此值回退到大模型）
      confidenceThreshold: 0.7
    },

    // 训练配置
    training: {
      // 最少训练样本数
      minSamples: 1000,

      // 训练样本最低置信度
      minConfidence: 0.9,

      // 重训练间隔（毫秒）7天
      retrainInterval: 7 * 24 * 60 * 60 * 1000,

      // 最多训练样本数
      maxTrainingSamples: 10000
    },

    // 质量检查配置
    validation: {
      // 是否启用质量检查
      enableQualityCheck: true,

      // 是否在低置信度时回退
      fallbackOnLowConfidence: true,

      // 回退阈值
      fallbackThreshold: 0.7
    }
  },

  // 流式响应配置
  streamingResponseConfig: {
    // 是否启用进度反馈
    enableProgress: true,

    // 是否启用取消功能
    enableCancel: true,

    // 最小更新间隔（毫秒，避免更新过于频繁）
    minUpdateInterval: 100,

    // 是否启用部分结果流式返回
    enablePartialResults: true,

    // 进度事件类型
    eventTypes: [
      'start',          // 任务开始
      'step_start',     // 步骤开始
      'step_partial',   // 步骤部分结果
      'step_complete',  // 步骤完成
      'step_error',     // 步骤错误
      'complete',       // 任务完成
      'cancel'          // 任务取消
    ]
  },

  // ===== P2扩展模块配置 (v0.20.0) =====

  // 任务分解增强配置
  taskDecompositionConfig: {
    // 是否启用模式学习（从历史中学习分解模式）
    enableLearning: true,

    // 是否启用依赖关系分析
    enableDependencyAnalysis: true,

    // 是否启用动态粒度控制
    enableDynamicGranularity: true,

    // 默认分解粒度 (atomic, fine, medium, coarse, macro)
    defaultGranularity: 'medium',

    // 每次分解的最少子任务数
    minTasksPerDecomposition: 2,

    // 每次分解的最多子任务数
    maxTasksPerDecomposition: 10
  },

  // 工具组合系统配置
  toolCompositionConfig: {
    // 是否启用自动工具组合
    enableAutoComposition: true,

    // 是否启用效果预测
    enableEffectPrediction: true,

    // 是否启用组合优化（并行化检测等）
    enableOptimization: true,

    // 最大组合深度（避免过深嵌套）
    maxCompositionDepth: 5
  },

  // 历史记忆优化配置
  historyMemoryConfig: {
    // 是否启用历史学习
    enableLearning: true,

    // 是否启用成功率预测
    enablePrediction: true,

    // 历史记忆窗口大小（最多记录多少条）
    historyWindowSize: 1000,

    // 进行预测所需的最少样本数
    minSamplesForPrediction: 10
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
  enablePerformanceMonitor: true,  // 测试时不记录性能
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
    },
    // P1优化模块配置
    multiIntentConfig: {
      ...baseConfig.multiIntentConfig,
      ...(userConfig.multiIntentConfig || {})
    },
    fewShotConfig: {
      ...baseConfig.fewShotConfig,
      ...(userConfig.fewShotConfig || {})
    },
    hierarchicalPlanningConfig: {
      ...baseConfig.hierarchicalPlanningConfig,
      ...(userConfig.hierarchicalPlanningConfig || {})
    },
    checkpointValidationConfig: {
      ...baseConfig.checkpointValidationConfig,
      ...(userConfig.checkpointValidationConfig || {})
    },
    selfCorrectionConfig: {
      ...baseConfig.selfCorrectionConfig,
      ...(userConfig.selfCorrectionConfig || {})
    },
    // P2优化模块配置
    intentFusionConfig: {
      ...baseConfig.intentFusionConfig,
      ...(userConfig.intentFusionConfig || {})
    },
    knowledgeDistillationConfig: {
      ...baseConfig.knowledgeDistillationConfig,
      ...(userConfig.knowledgeDistillationConfig || {}),
      studentModel: {
        ...baseConfig.knowledgeDistillationConfig.studentModel,
        ...(userConfig.knowledgeDistillationConfig?.studentModel || {})
      },
      teacherModel: {
        ...baseConfig.knowledgeDistillationConfig.teacherModel,
        ...(userConfig.knowledgeDistillationConfig?.teacherModel || {})
      },
      routing: {
        ...baseConfig.knowledgeDistillationConfig.routing,
        ...(userConfig.knowledgeDistillationConfig?.routing || {})
      },
      training: {
        ...baseConfig.knowledgeDistillationConfig.training,
        ...(userConfig.knowledgeDistillationConfig?.training || {})
      },
      validation: {
        ...baseConfig.knowledgeDistillationConfig.validation,
        ...(userConfig.knowledgeDistillationConfig?.validation || {})
      }
    },
    streamingResponseConfig: {
      ...baseConfig.streamingResponseConfig,
      ...(userConfig.streamingResponseConfig || {})
    },
    // P2扩展模块配置
    taskDecompositionConfig: {
      ...baseConfig.taskDecompositionConfig,
      ...(userConfig.taskDecompositionConfig || {})
    },
    toolCompositionConfig: {
      ...baseConfig.toolCompositionConfig,
      ...(userConfig.toolCompositionConfig || {})
    },
    historyMemoryConfig: {
      ...baseConfig.historyMemoryConfig,
      ...(userConfig.historyMemoryConfig || {})
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
