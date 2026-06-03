/**
 * AIEngineConfig 单元测试
 * 测试AI引擎配置管理系统
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("AIEngineConfig", () => {
  let DEFAULT_CONFIG;
  let PRODUCTION_CONFIG;
  let DEVELOPMENT_CONFIG;
  let TEST_CONFIG;
  let getAIEngineConfig;
  let mergeConfig;

  beforeEach(async () => {
    // Dynamic import
    const module = await import(
      "../../../src/main/ai-engine/ai-engine-config.js"
    );
    DEFAULT_CONFIG = module.DEFAULT_CONFIG;
    PRODUCTION_CONFIG = module.PRODUCTION_CONFIG;
    DEVELOPMENT_CONFIG = module.DEVELOPMENT_CONFIG;
    TEST_CONFIG = module.TEST_CONFIG;
    getAIEngineConfig = module.getAIEngineConfig;
    mergeConfig = module.mergeConfig;
  });

  afterEach(() => {
    // Restore NODE_ENV after each test
    delete process.env.NODE_ENV;
  });

  describe("DEFAULT_CONFIG", () => {
    it("应该包含所有P0优化模块配置", () => {
      expect(DEFAULT_CONFIG.enableSlotFilling).toBe(true);
      expect(DEFAULT_CONFIG.enableToolSandbox).toBe(true);
      expect(DEFAULT_CONFIG.enablePerformanceMonitor).toBe(true);
    });

    it("应该包含所有P1优化模块配置", () => {
      expect(DEFAULT_CONFIG.enableMultiIntent).toBe(true);
      expect(DEFAULT_CONFIG.enableDynamicFewShot).toBe(true);
      expect(DEFAULT_CONFIG.enableHierarchicalPlanning).toBe(true);
      expect(DEFAULT_CONFIG.enableCheckpointValidation).toBe(true);
      expect(DEFAULT_CONFIG.enableSelfCorrection).toBe(true);
    });

    it("应该包含所有P2核心模块配置", () => {
      expect(DEFAULT_CONFIG.enableIntentFusion).toBe(true);
      expect(DEFAULT_CONFIG.enableKnowledgeDistillation).toBe(true);
      expect(DEFAULT_CONFIG.enableStreamingResponse).toBe(true);
    });

    it("应该包含所有P2扩展模块配置", () => {
      expect(DEFAULT_CONFIG.enableTaskDecomposition).toBe(true);
      expect(DEFAULT_CONFIG.enableToolComposition).toBe(true);
      expect(DEFAULT_CONFIG.enableHistoryMemory).toBe(true);
    });

    it("应该包含智能层配置", () => {
      expect(DEFAULT_CONFIG.enableIntelligenceLayer).toBe(true);
    });

    it("应该包含工具沙箱配置", () => {
      expect(DEFAULT_CONFIG.toolSandboxConfig).toBeDefined();
      expect(DEFAULT_CONFIG.toolSandboxConfig.timeout).toBe(30000);
      expect(DEFAULT_CONFIG.toolSandboxConfig.retries).toBe(2);
      expect(DEFAULT_CONFIG.toolSandboxConfig.retryDelay).toBe(1000);
      expect(DEFAULT_CONFIG.toolSandboxConfig.enableValidation).toBe(true);
      expect(DEFAULT_CONFIG.toolSandboxConfig.enableSnapshot).toBe(true);
    });

    it("应该包含性能监控配置", () => {
      expect(DEFAULT_CONFIG.performanceConfig).toBeDefined();
      expect(DEFAULT_CONFIG.performanceConfig.thresholds).toBeDefined();
      expect(DEFAULT_CONFIG.performanceConfig.retentionDays).toBe(30);
      expect(DEFAULT_CONFIG.performanceConfig.autoCleanup).toBe(true);
    });

    it("应该包含性能阈值配置", () => {
      const thresholds = DEFAULT_CONFIG.performanceConfig.thresholds;

      expect(thresholds.intent_recognition).toEqual({
        warning: 1500,
        critical: 3000,
      });
      expect(thresholds.task_planning).toEqual({
        warning: 4000,
        critical: 8000,
      });
      expect(thresholds.tool_execution).toEqual({
        warning: 5000,
        critical: 10000,
      });
      expect(thresholds.rag_retrieval).toEqual({
        warning: 2000,
        critical: 5000,
      });
      expect(thresholds.llm_calls).toEqual({
        warning: 3000,
        critical: 6000,
      });
      expect(thresholds.total_pipeline).toEqual({
        warning: 10000,
        critical: 20000,
      });
    });

    it("应该包含槽位填充配置", () => {
      expect(DEFAULT_CONFIG.slotFillingConfig).toBeDefined();
      expect(DEFAULT_CONFIG.slotFillingConfig.enableLLMInference).toBe(true);
      expect(DEFAULT_CONFIG.slotFillingConfig.enablePreferenceLearning).toBe(
        true,
      );
      expect(DEFAULT_CONFIG.slotFillingConfig.askUserForMissing).toBe(true);
      expect(DEFAULT_CONFIG.slotFillingConfig.maxAskCount).toBe(5);
    });

    it("应该包含多意图识别配置", () => {
      expect(DEFAULT_CONFIG.multiIntentConfig).toBeDefined();
      expect(DEFAULT_CONFIG.multiIntentConfig.sensitivity).toBe("medium");
      expect(DEFAULT_CONFIG.multiIntentConfig.enableLLMSplit).toBe(true);
      expect(DEFAULT_CONFIG.multiIntentConfig.maxIntents).toBe(5);
    });

    it("应该包含动态Few-shot配置", () => {
      expect(DEFAULT_CONFIG.fewShotConfig).toBeDefined();
      expect(DEFAULT_CONFIG.fewShotConfig.defaultExampleCount).toBe(3);
      expect(DEFAULT_CONFIG.fewShotConfig.minConfidence).toBe(0.85);
      expect(DEFAULT_CONFIG.fewShotConfig.cacheExpiry).toBe(3600000);
      expect(DEFAULT_CONFIG.fewShotConfig.adaptiveExampleCount).toBe(true);
    });

    it("应该包含分层任务规划配置", () => {
      expect(DEFAULT_CONFIG.hierarchicalPlanningConfig).toBeDefined();
      expect(DEFAULT_CONFIG.hierarchicalPlanningConfig.defaultGranularity).toBe(
        "auto",
      );
      expect(
        DEFAULT_CONFIG.hierarchicalPlanningConfig.enableComplexityAssessment,
      ).toBe(true);
      expect(
        DEFAULT_CONFIG.hierarchicalPlanningConfig.enableDurationEstimation,
      ).toBe(true);
    });

    it("应该包含检查点校验配置", () => {
      expect(DEFAULT_CONFIG.checkpointValidationConfig).toBeDefined();
      expect(
        DEFAULT_CONFIG.checkpointValidationConfig.enableLLMQualityCheck,
      ).toBe(true);
      expect(
        DEFAULT_CONFIG.checkpointValidationConfig.qualityCheckTriggers,
      ).toEqual(["CREATE_FILE", "GENERATE_CONTENT", "ANALYZE_DATA"]);
      expect(
        DEFAULT_CONFIG.checkpointValidationConfig.completenessThreshold,
      ).toBe(80);
      expect(
        DEFAULT_CONFIG.checkpointValidationConfig.autoRetryOnFailure,
      ).toBe(true);
    });

    it("应该包含自我修正配置", () => {
      expect(DEFAULT_CONFIG.selfCorrectionConfig).toBeDefined();
      expect(DEFAULT_CONFIG.selfCorrectionConfig.maxRetries).toBe(3);
      expect(DEFAULT_CONFIG.selfCorrectionConfig.enablePatternLearning).toBe(
        true,
      );
      expect(DEFAULT_CONFIG.selfCorrectionConfig.strategies).toContain(
        "add_dependency",
      );
      expect(DEFAULT_CONFIG.selfCorrectionConfig.strategies).toContain(
        "regenerate_params",
      );
    });

    it("应该包含意图融合配置", () => {
      expect(DEFAULT_CONFIG.intentFusionConfig).toBeDefined();
      expect(DEFAULT_CONFIG.intentFusionConfig.enableRuleFusion).toBe(true);
      expect(DEFAULT_CONFIG.intentFusionConfig.enableLLMFusion).toBe(true);
      expect(
        DEFAULT_CONFIG.intentFusionConfig.llmFusionConfidenceThreshold,
      ).toBe(0.8);
      expect(DEFAULT_CONFIG.intentFusionConfig.maxFusionWindow).toBe(5);
    });

    it("应该包含知识蒸馏配置", () => {
      expect(DEFAULT_CONFIG.knowledgeDistillationConfig).toBeDefined();

      // 学生模型配置
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.studentModel,
      ).toBeDefined();
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.studentModel.model,
      ).toBe("qwen2:1.5b");

      // 教师模型配置
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.teacherModel,
      ).toBeDefined();
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.teacherModel.model,
      ).toBe("qwen2:7b");

      // 路由配置
      expect(DEFAULT_CONFIG.knowledgeDistillationConfig.routing).toBeDefined();
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.routing.complexityThreshold,
      ).toBe(0.35);

      // 训练配置
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.training,
      ).toBeDefined();
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.training.minSamples,
      ).toBe(1000);

      // 验证配置
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.validation,
      ).toBeDefined();
      expect(
        DEFAULT_CONFIG.knowledgeDistillationConfig.validation
          .enableQualityCheck,
      ).toBe(true);
    });

    it("应该包含流式响应配置", () => {
      expect(DEFAULT_CONFIG.streamingResponseConfig).toBeDefined();
      expect(DEFAULT_CONFIG.streamingResponseConfig.enableProgress).toBe(true);
      expect(DEFAULT_CONFIG.streamingResponseConfig.enableCancel).toBe(true);
      expect(DEFAULT_CONFIG.streamingResponseConfig.minUpdateInterval).toBe(
        100,
      );
      expect(
        DEFAULT_CONFIG.streamingResponseConfig.enablePartialResults,
      ).toBe(true);
    });

    it("应该包含任务分解增强配置", () => {
      expect(DEFAULT_CONFIG.taskDecompositionConfig).toBeDefined();
      expect(DEFAULT_CONFIG.taskDecompositionConfig.enableLearning).toBe(true);
      expect(
        DEFAULT_CONFIG.taskDecompositionConfig.enableDependencyAnalysis,
      ).toBe(true);
      expect(DEFAULT_CONFIG.taskDecompositionConfig.defaultGranularity).toBe(
        "medium",
      );
    });

    it("应该包含工具组合系统配置", () => {
      expect(DEFAULT_CONFIG.toolCompositionConfig).toBeDefined();
      expect(DEFAULT_CONFIG.toolCompositionConfig.enableAutoComposition).toBe(
        true,
      );
      expect(DEFAULT_CONFIG.toolCompositionConfig.enableOptimization).toBe(
        true,
      );
      expect(DEFAULT_CONFIG.toolCompositionConfig.maxCompositionDepth).toBe(5);
    });

    it("应该包含历史记忆优化配置", () => {
      expect(DEFAULT_CONFIG.historyMemoryConfig).toBeDefined();
      expect(DEFAULT_CONFIG.historyMemoryConfig.enableLearning).toBe(true);
      expect(DEFAULT_CONFIG.historyMemoryConfig.enablePrediction).toBe(true);
      expect(DEFAULT_CONFIG.historyMemoryConfig.historyWindowSize).toBe(1000);
    });
  });

  describe("PRODUCTION_CONFIG", () => {
    it("应该继承DEFAULT_CONFIG", () => {
      expect(PRODUCTION_CONFIG.enableSlotFilling).toBe(
        DEFAULT_CONFIG.enableSlotFilling,
      );
      expect(PRODUCTION_CONFIG.enableToolSandbox).toBe(
        DEFAULT_CONFIG.enableToolSandbox,
      );
    });

    it("应该使用生产环境的沙箱配置", () => {
      expect(PRODUCTION_CONFIG.sandboxConfig.timeout).toBe(60000);
      expect(PRODUCTION_CONFIG.sandboxConfig.retries).toBe(3);
    });

    it("应该使用生产环境的性能监控配置", () => {
      expect(PRODUCTION_CONFIG.performanceConfig.retentionDays).toBe(90);
    });

    it("应该保留其他默认配置", () => {
      expect(PRODUCTION_CONFIG.sandboxConfig.retryDelay).toBe(
        DEFAULT_CONFIG.sandboxConfig.retryDelay,
      );
      expect(PRODUCTION_CONFIG.performanceConfig.autoCleanup).toBe(
        DEFAULT_CONFIG.performanceConfig.autoCleanup,
      );
    });
  });

  describe("DEVELOPMENT_CONFIG", () => {
    it("应该继承DEFAULT_CONFIG", () => {
      expect(DEVELOPMENT_CONFIG.enableSlotFilling).toBe(
        DEFAULT_CONFIG.enableSlotFilling,
      );
    });

    it("应该使用开发环境的沙箱配置", () => {
      expect(DEVELOPMENT_CONFIG.sandboxConfig.timeout).toBe(15000);
      expect(DEVELOPMENT_CONFIG.sandboxConfig.retries).toBe(1);
    });

    it("应该使用开发环境的性能监控配置", () => {
      expect(DEVELOPMENT_CONFIG.performanceConfig.retentionDays).toBe(7);
    });

    it("应该使用更严格的性能阈值", () => {
      const thresholds = DEVELOPMENT_CONFIG.performanceConfig.thresholds;

      expect(thresholds.intent_recognition.warning).toBe(1000);
      expect(thresholds.task_planning.warning).toBe(3000);
      expect(thresholds.tool_execution.warning).toBe(3000);
    });
  });

  describe("TEST_CONFIG", () => {
    it("应该继承DEFAULT_CONFIG", () => {
      expect(TEST_CONFIG.enableSlotFilling).toBe(
        DEFAULT_CONFIG.enableSlotFilling,
      );
    });

    it("应该启用性能监控（测试时也记录）", () => {
      expect(TEST_CONFIG.enablePerformanceMonitor).toBe(true);
    });

    it("应该使用测试环境的沙箱配置", () => {
      expect(TEST_CONFIG.sandboxConfig.timeout).toBe(5000);
      expect(TEST_CONFIG.sandboxConfig.retries).toBe(0);
      expect(TEST_CONFIG.sandboxConfig.enableSnapshot).toBe(false);
    });
  });

  describe("getAIEngineConfig", () => {
    it("应该在production环境返回PRODUCTION_CONFIG", () => {
      process.env.NODE_ENV = "production";

      const config = getAIEngineConfig();

      expect(config.sandboxConfig.timeout).toBe(60000);
      expect(config.performanceConfig.retentionDays).toBe(90);
    });

    it("应该在test环境返回TEST_CONFIG", () => {
      process.env.NODE_ENV = "test";

      const config = getAIEngineConfig();

      expect(config.sandboxConfig.timeout).toBe(5000);
      expect(config.sandboxConfig.retries).toBe(0);
    });

    it("应该在development环境返回DEVELOPMENT_CONFIG", () => {
      process.env.NODE_ENV = "development";

      const config = getAIEngineConfig();

      expect(config.sandboxConfig.timeout).toBe(15000);
      expect(config.performanceConfig.retentionDays).toBe(7);
    });

    it("应该在未设置NODE_ENV时返回DEVELOPMENT_CONFIG", () => {
      delete process.env.NODE_ENV;

      const config = getAIEngineConfig();

      expect(config.sandboxConfig.timeout).toBe(15000);
      expect(config.performanceConfig.retentionDays).toBe(7);
    });
  });

  describe("mergeConfig", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("应该在无用户配置时返回基础配置", () => {
      const config = mergeConfig();

      expect(config.enableSlotFilling).toBe(DEVELOPMENT_CONFIG.enableSlotFilling);
      expect(config.sandboxConfig.timeout).toBe(
        DEVELOPMENT_CONFIG.sandboxConfig.timeout,
      );
    });

    it("应该合并顶层用户配置", () => {
      const userConfig = {
        enableSlotFilling: false,
        enableToolSandbox: false,
      };

      const config = mergeConfig(userConfig);

      expect(config.enableSlotFilling).toBe(false);
      expect(config.enableToolSandbox).toBe(false);
      expect(config.enablePerformanceMonitor).toBe(
        DEVELOPMENT_CONFIG.enablePerformanceMonitor,
      );
    });

    it("应该深度合并sandboxConfig", () => {
      const userConfig = {
        sandboxConfig: {
          timeout: 20000,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.sandboxConfig.timeout).toBe(20000);
      expect(config.sandboxConfig.retries).toBe(
        DEVELOPMENT_CONFIG.sandboxConfig.retries,
      );
      expect(config.sandboxConfig.retryDelay).toBe(
        DEVELOPMENT_CONFIG.sandboxConfig.retryDelay,
      );
    });

    it("应该深度合并performanceConfig", () => {
      const userConfig = {
        performanceConfig: {
          retentionDays: 60,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.performanceConfig.retentionDays).toBe(60);
      expect(config.performanceConfig.autoCleanup).toBe(
        DEVELOPMENT_CONFIG.performanceConfig.autoCleanup,
      );
    });

    it("应该深度合并performanceConfig.thresholds", () => {
      const userConfig = {
        performanceConfig: {
          thresholds: {
            intent_recognition: {
              warning: 500,
              critical: 1000,
            },
          },
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.performanceConfig.thresholds.intent_recognition).toEqual({
        warning: 500,
        critical: 1000,
      });
      expect(config.performanceConfig.thresholds.task_planning).toEqual(
        DEVELOPMENT_CONFIG.performanceConfig.thresholds.task_planning,
      );
    });

    it("应该合并slotFillingConfig", () => {
      const userConfig = {
        slotFillingConfig: {
          maxAskCount: 10,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.slotFillingConfig.maxAskCount).toBe(10);
      expect(config.slotFillingConfig.enableLLMInference).toBe(
        DEVELOPMENT_CONFIG.slotFillingConfig.enableLLMInference,
      );
    });

    it("应该合并multiIntentConfig", () => {
      const userConfig = {
        multiIntentConfig: {
          sensitivity: "high",
          maxIntents: 10,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.multiIntentConfig.sensitivity).toBe("high");
      expect(config.multiIntentConfig.maxIntents).toBe(10);
      expect(config.multiIntentConfig.enableLLMSplit).toBe(
        DEVELOPMENT_CONFIG.multiIntentConfig.enableLLMSplit,
      );
    });

    it("应该合并fewShotConfig", () => {
      const userConfig = {
        fewShotConfig: {
          defaultExampleCount: 5,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.fewShotConfig.defaultExampleCount).toBe(5);
      expect(config.fewShotConfig.minConfidence).toBe(
        DEVELOPMENT_CONFIG.fewShotConfig.minConfidence,
      );
    });

    it("应该合并hierarchicalPlanningConfig", () => {
      const userConfig = {
        hierarchicalPlanningConfig: {
          defaultGranularity: "fine",
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.hierarchicalPlanningConfig.defaultGranularity).toBe("fine");
      expect(
        config.hierarchicalPlanningConfig.enableComplexityAssessment,
      ).toBe(
        DEVELOPMENT_CONFIG.hierarchicalPlanningConfig.enableComplexityAssessment,
      );
    });

    it("应该合并checkpointValidationConfig", () => {
      const userConfig = {
        checkpointValidationConfig: {
          completenessThreshold: 90,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.checkpointValidationConfig.completenessThreshold).toBe(90);
      expect(
        config.checkpointValidationConfig.enableLLMQualityCheck,
      ).toBe(
        DEVELOPMENT_CONFIG.checkpointValidationConfig.enableLLMQualityCheck,
      );
    });

    it("应该合并selfCorrectionConfig", () => {
      const userConfig = {
        selfCorrectionConfig: {
          maxRetries: 5,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.selfCorrectionConfig.maxRetries).toBe(5);
      expect(config.selfCorrectionConfig.enablePatternLearning).toBe(
        DEVELOPMENT_CONFIG.selfCorrectionConfig.enablePatternLearning,
      );
    });

    it("应该合并intentFusionConfig", () => {
      const userConfig = {
        intentFusionConfig: {
          maxFusionWindow: 10,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.intentFusionConfig.maxFusionWindow).toBe(10);
      expect(config.intentFusionConfig.enableRuleFusion).toBe(
        DEVELOPMENT_CONFIG.intentFusionConfig.enableRuleFusion,
      );
    });

    it("应该深度合并knowledgeDistillationConfig", () => {
      const userConfig = {
        knowledgeDistillationConfig: {
          studentModel: {
            model: "qwen2:0.5b",
          },
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.knowledgeDistillationConfig.studentModel.model).toBe(
        "qwen2:0.5b",
      );
      expect(
        config.knowledgeDistillationConfig.studentModel.temperature,
      ).toBe(DEVELOPMENT_CONFIG.knowledgeDistillationConfig.studentModel.temperature);
    });

    it("应该深度合并knowledgeDistillationConfig.routing", () => {
      const userConfig = {
        knowledgeDistillationConfig: {
          routing: {
            complexityThreshold: 0.5,
          },
        },
      };

      const config = mergeConfig(userConfig);

      expect(
        config.knowledgeDistillationConfig.routing.complexityThreshold,
      ).toBe(0.5);
      expect(
        config.knowledgeDistillationConfig.routing.studentAccuracyThreshold,
      ).toBe(
        DEVELOPMENT_CONFIG.knowledgeDistillationConfig.routing
          .studentAccuracyThreshold,
      );
    });

    it("应该深度合并knowledgeDistillationConfig.training", () => {
      const userConfig = {
        knowledgeDistillationConfig: {
          training: {
            minSamples: 2000,
          },
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.knowledgeDistillationConfig.training.minSamples).toBe(
        2000,
      );
      expect(
        config.knowledgeDistillationConfig.training.maxTrainingSamples,
      ).toBe(
        DEVELOPMENT_CONFIG.knowledgeDistillationConfig.training
          .maxTrainingSamples,
      );
    });

    it("应该深度合并knowledgeDistillationConfig.validation", () => {
      const userConfig = {
        knowledgeDistillationConfig: {
          validation: {
            fallbackThreshold: 0.8,
          },
        },
      };

      const config = mergeConfig(userConfig);

      expect(
        config.knowledgeDistillationConfig.validation.fallbackThreshold,
      ).toBe(0.8);
      expect(
        config.knowledgeDistillationConfig.validation.enableQualityCheck,
      ).toBe(
        DEVELOPMENT_CONFIG.knowledgeDistillationConfig.validation
          .enableQualityCheck,
      );
    });

    it("应该合并streamingResponseConfig", () => {
      const userConfig = {
        streamingResponseConfig: {
          minUpdateInterval: 200,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.streamingResponseConfig.minUpdateInterval).toBe(200);
      expect(config.streamingResponseConfig.enableProgress).toBe(
        DEVELOPMENT_CONFIG.streamingResponseConfig.enableProgress,
      );
    });

    it("应该合并taskDecompositionConfig", () => {
      const userConfig = {
        taskDecompositionConfig: {
          maxTasksPerDecomposition: 15,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.taskDecompositionConfig.maxTasksPerDecomposition).toBe(15);
      expect(config.taskDecompositionConfig.enableLearning).toBe(
        DEVELOPMENT_CONFIG.taskDecompositionConfig.enableLearning,
      );
    });

    it("应该合并toolCompositionConfig", () => {
      const userConfig = {
        toolCompositionConfig: {
          maxCompositionDepth: 10,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.toolCompositionConfig.maxCompositionDepth).toBe(10);
      expect(config.toolCompositionConfig.enableAutoComposition).toBe(
        DEVELOPMENT_CONFIG.toolCompositionConfig.enableAutoComposition,
      );
    });

    it("应该合并historyMemoryConfig", () => {
      const userConfig = {
        historyMemoryConfig: {
          historyWindowSize: 2000,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.historyMemoryConfig.historyWindowSize).toBe(2000);
      expect(config.historyMemoryConfig.enableLearning).toBe(
        DEVELOPMENT_CONFIG.historyMemoryConfig.enableLearning,
      );
    });

    it("应该处理空用户配置对象", () => {
      const userConfig = {};

      const config = mergeConfig(userConfig);

      expect(config.enableSlotFilling).toBe(DEVELOPMENT_CONFIG.enableSlotFilling);
      expect(config.sandboxConfig.timeout).toBe(
        DEVELOPMENT_CONFIG.sandboxConfig.timeout,
      );
    });

    it("应该处理undefined用户配置", () => {
      const config = mergeConfig(undefined);

      expect(config.enableSlotFilling).toBe(DEVELOPMENT_CONFIG.enableSlotFilling);
    });

    it("应该优先使用用户配置值", () => {
      const userConfig = {
        enableSlotFilling: false,
        sandboxConfig: {
          timeout: 50000,
          retries: 5,
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.enableSlotFilling).toBe(false);
      expect(config.sandboxConfig.timeout).toBe(50000);
      expect(config.sandboxConfig.retries).toBe(5);
    });

    it("应该处理部分嵌套配置", () => {
      const userConfig = {
        knowledgeDistillationConfig: {
          studentModel: {
            temperature: 0.3,
          },
        },
      };

      const config = mergeConfig(userConfig);

      // 用户提供的值
      expect(
        config.knowledgeDistillationConfig.studentModel.temperature,
      ).toBe(0.3);

      // 保留的默认值
      expect(config.knowledgeDistillationConfig.studentModel.model).toBe(
        DEVELOPMENT_CONFIG.knowledgeDistillationConfig.studentModel.model,
      );
      expect(
        config.knowledgeDistillationConfig.teacherModel,
      ).toEqual(DEVELOPMENT_CONFIG.knowledgeDistillationConfig.teacherModel);
    });
  });

  describe("边界情况", () => {
    it("应该处理空performanceConfig.thresholds", () => {
      const userConfig = {
        performanceConfig: {
          thresholds: {},
        },
      };

      const config = mergeConfig(userConfig);

      expect(config.performanceConfig.thresholds.intent_recognition).toEqual(
        DEVELOPMENT_CONFIG.performanceConfig.thresholds.intent_recognition,
      );
    });

    it("应该处理空knowledgeDistillationConfig", () => {
      const userConfig = {
        knowledgeDistillationConfig: {},
      };

      const config = mergeConfig(userConfig);

      expect(config.knowledgeDistillationConfig.studentModel).toEqual(
        DEVELOPMENT_CONFIG.knowledgeDistillationConfig.studentModel,
      );
    });
  });
});
