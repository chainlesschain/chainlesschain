/**
 * Phase 31: AI Models — 7 Advanced Features (v1.1.0)
 *
 * Registers IPC for: Benchmark, Memory Augmented Generation,
 * Dual-Model Collaboration, Quantization, Fine-tuning, Whisper,
 * Federated Learning. Total: 56 handlers.
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhase31({ safeRegister, logger, deps, registeredModules }) {
  const { app, database, llmManager, p2pManager } = deps;

  // 🔥 Benchmark System (模型性能基准测试, 9 handlers)
  safeRegister("Benchmark IPC", {
    register: () => {
      const { BenchmarkManager } = require("../../benchmark/benchmark-manager");
      const { registerBenchmarkIPC } = require("../../benchmark/benchmark-ipc");

      const benchmarkManager = new BenchmarkManager({
        database: database || null,
        llmManager: llmManager || null,
      });
      if (database) {
        benchmarkManager
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] BenchmarkManager async init error (non-fatal):",
              err.message,
            ),
          );
      }
      registerBenchmarkIPC({ benchmarkManager });
      if (app) {
        app.benchmarkManager = benchmarkManager;
      }
      registeredModules.benchmarkManager = benchmarkManager;
    },
    handlers: 9,
  });

  // 🔥 Memory Augmented Generation (长期记忆增强, 8 handlers)
  safeRegister("Memory Augmented IPC", {
    register: () => {
      const {
        MemoryAugmentedGeneration,
      } = require("../../llm/memory-augmented-generation");
      const {
        UserPreferenceLearner,
      } = require("../../llm/user-preference-learner");
      const {
        BehaviorPatternAnalyzer,
      } = require("../../llm/behavior-pattern-analyzer");
      const {
        registerMemoryAugIPC,
      } = require("../../llm/memory-augmented-ipc");

      const memoryAugManager = new MemoryAugmentedGeneration({
        database: database || null,
      });
      const preferenceLearner = new UserPreferenceLearner({
        database: database || null,
      });
      const patternAnalyzer = new BehaviorPatternAnalyzer({
        database: database || null,
      });

      if (database) {
        memoryAugManager
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] MemoryAugManager async init error (non-fatal):",
              err.message,
            ),
          );
        preferenceLearner
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] PreferenceLearner async init error (non-fatal):",
              err.message,
            ),
          );
        patternAnalyzer
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] PatternAnalyzer async init error (non-fatal):",
              err.message,
            ),
          );
      }

      registerMemoryAugIPC({
        memoryAugManager,
        preferenceLearner,
        patternAnalyzer,
      });

      if (app) {
        app.memoryAugManager = memoryAugManager;
        app.preferenceLearner = preferenceLearner;
        app.patternAnalyzer = patternAnalyzer;
      }
    },
    handlers: 8,
  });

  // 🔥 Dual-Model Collaboration (Architect+Editor双模型协作, 7 handlers)
  safeRegister("Dual-Model IPC", {
    register: () => {
      const {
        DualModelManager,
      } = require("../../ai-engine/dual-model/dual-model-manager");
      const {
        registerDualModelIPC,
      } = require("../../ai-engine/dual-model/dual-model-ipc");

      const dualModelManager = new DualModelManager({
        database: database || null,
        llmManager: llmManager || null,
      });
      if (database) {
        dualModelManager
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] DualModelManager async init error (non-fatal):",
              err.message,
            ),
          );
      }
      registerDualModelIPC({ dualModelManager });
      if (app) {
        app.dualModelManager = dualModelManager;
      }
    },
    handlers: 7,
  });

  // 🔥 Model Quantization (本地模型量化工具, 8 handlers)
  safeRegister("Quantization IPC", {
    register: () => {
      const {
        QuantizationManager,
      } = require("../../quantization/quantization-manager");
      const {
        registerQuantizationIPC,
      } = require("../../quantization/quantization-ipc");

      const quantizationManager = new QuantizationManager({
        database: database || null,
      });
      if (database) {
        quantizationManager
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] QuantizationManager async init error (non-fatal):",
              err.message,
            ),
          );
      }
      registerQuantizationIPC({ quantizationManager });
      if (app) {
        app.quantizationManager = quantizationManager;
      }
    },
    handlers: 8,
  });

  // 🔥 Model Fine-tuning (LoRA/QLoRA微调, 8 handlers)
  safeRegister("Fine-tuning IPC", {
    register: () => {
      const {
        FineTuningManager,
      } = require("../../fine-tuning/fine-tuning-manager");
      const {
        registerFineTuningIPC,
      } = require("../../fine-tuning/fine-tuning-ipc");

      const fineTuningManager = new FineTuningManager({
        database: database || null,
      });
      if (database) {
        fineTuningManager
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] FineTuningManager async init error (non-fatal):",
              err.message,
            ),
          );
      }
      registerFineTuningIPC({ fineTuningManager });
      if (app) {
        app.fineTuningManager = fineTuningManager;
      }
    },
    handlers: 8,
  });

  // 🔥 Whisper Voice Integration (Whisper语音识别, 6 handlers)
  safeRegister("Whisper IPC", {
    register: () => {
      const { WhisperClient } = require("../../speech/whisper-client");
      const { registerWhisperIPC } = require("../../speech/whisper-ipc");

      const whisperClient = new WhisperClient({});
      registerWhisperIPC({
        whisperClient,
        llmManager: llmManager || null,
        ttsManager: app?.ttsManager || null,
      });
      if (app) {
        app.whisperClient = whisperClient;
      }
    },
    handlers: 6,
  });

  // 🔥 Federated Learning (联邦学习, 10 handlers)
  safeRegister("Federated Learning IPC", {
    register: () => {
      const {
        FederatedLearningManager,
      } = require("../../federated/federated-learning-manager");
      const { registerFederatedIPC } = require("../../federated/federated-ipc");

      const federatedManager = new FederatedLearningManager({
        database: database || null,
        p2pManager: p2pManager || null,
      });
      if (database) {
        federatedManager
          .initialize(database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] FederatedManager async init error (non-fatal):",
              err.message,
            ),
          );
      }
      registerFederatedIPC({ federatedManager });
      if (app) {
        app.federatedManager = federatedManager;
      }
    },
    handlers: 10,
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 31 Complete: AI Models 7 features (56 handlers)!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhase31 };
