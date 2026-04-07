/**
 * Phase 6 + Phase 7: content & media stack.
 *
 * Phase 6 — File / Office / Template / Knowledge / Prompt / Image
 * Phase 7 — Speech / Video / PDF / Document
 *
 * Mixes safeRegister callsites (Office File, Template, Speech) with
 * direct gated registrations preserved verbatim from the original
 * ipc-registry.js. The direct registrations are intentionally NOT
 * routed through safeRegister so behavior is unchanged from before
 * the extraction.
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases6to7Content({ safeRegister, logger, deps }) {
  const {
    database,
    mainWindow,
    templateManager,
    dbManager,
    versionManager,
    knowledgePaymentManager,
    promptTemplateManager,
    imageUploader,
    llmManager,
    app,
  } = deps;

  // ============================================================
  // 第六阶段模块 (核心功能 - File, Template, Knowledge, Prompt, Image)
  // ============================================================

  // 文件操作 (函数模式 - 中等模块，17 handlers)
  if (database) {
    logger.info("[IPC Registry] Registering File IPC...");
    const { registerFileIPC } = require("../../file/file-ipc");
    const { getProjectConfig } = require("../../project/project-config");

    registerFileIPC({
      database,
      mainWindow,
      getProjectConfig,
    });
    logger.info("[IPC Registry] ✓ File IPC registered (17 handlers)");
  }

  // Office 文件操作 (类模式 - Office 文件处理)
  safeRegister("Office File IPC", {
    register: () => {
      const FileIPC = require("../file-ipc");
      const fileIPC = new FileIPC();
      fileIPC.registerHandlers(mainWindow);
    },
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // 模板管理 (函数模式 - 大模块，20 handlers)
  safeRegister("Template IPC", {
    register: () => {
      const { registerTemplateIPC } = require("../../template/template-ipc");
      registerTemplateIPC({
        templateManager: templateManager || null,
      });
      if (!templateManager) {
        logger.warn(
          "[IPC Registry] ⚠ templateManager not initialized, Template IPC running in degraded mode",
        );
      }
    },
    handlers: 20,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // 知识管理 (函数模式 - 中等模块，17 handlers)
  if (dbManager || versionManager || knowledgePaymentManager) {
    logger.info("[IPC Registry] Registering Knowledge IPC...");
    const { registerKnowledgeIPC } = require("../../knowledge/knowledge-ipc");

    registerKnowledgeIPC({
      dbManager,
      versionManager,
      knowledgePaymentManager,
    });
    logger.info("[IPC Registry] ✓ Knowledge IPC registered (17 handlers)");
  }

  // 提示词模板 (函数模式 - 小模块，11 handlers)
  if (promptTemplateManager) {
    logger.info("[IPC Registry] Registering Prompt Template IPC...");
    const {
      registerPromptTemplateIPC,
    } = require("../../prompt-template/prompt-template-ipc");

    registerPromptTemplateIPC({
      promptTemplateManager,
    });
    logger.info(
      "[IPC Registry] ✓ Prompt Template IPC registered (11 handlers)",
    );
  }

  // 图像管理 (函数模式 - 大模块，22 handlers)
  if (imageUploader) {
    logger.info("[IPC Registry] Registering Image IPC...");
    const { registerImageIPC } = require("../../image/image-ipc");

    registerImageIPC({
      imageUploader,
      llmManager,
      mainWindow,
    });
    logger.info("[IPC Registry] ✓ Image IPC registered (22 handlers)");
  }

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 6 Complete: 5 modules migrated (87 handlers)!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // 第七阶段模块 (媒体处理 - Speech, Video, PDF, Document)
  // ============================================================

  // 语音处理 (函数模式 - 超大模块，34 handlers)
  // 注意：检查 initializeSpeechManager 是否存在
  if (
    app &&
    app.initializeSpeechManager &&
    typeof app.initializeSpeechManager === "function"
  ) {
    safeRegister("Speech IPC", {
      register: () => {
        const { registerSpeechIPC } = require("../../speech/speech-ipc");
        const initializeSpeechManager = app.initializeSpeechManager.bind(app);
        registerSpeechIPC({
          initializeSpeechManager,
        });
      },
      handlers: 34,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });
  } else {
    logger.info(
      "[IPC Registry] ⚠️  Speech IPC skipped (initializeSpeechManager not available)",
    );
  }

  // 视频处理 (函数模式 - 大模块，18 handlers)
  if (app && app.videoImporter) {
    logger.info("[IPC Registry] Registering Video IPC...");
    const { registerVideoIPC } = require("../../video/video-ipc");

    registerVideoIPC({
      videoImporter: app.videoImporter,
      mainWindow,
      llmManager,
    });
    logger.info("[IPC Registry] ✓ Video IPC registered (18 handlers)");
  }

  // PDF 处理 (函数模式 - 小模块，4 handlers)
  safeRegister("PDF IPC", {
    register: () => {
      const { registerPDFIPC } = require("../../pdf/pdf-ipc");
      const { getPDFEngine } = require("../../engines/pdf-engine");
      registerPDFIPC({ getPDFEngine });
    },
    handlers: 4,
  });

  // 文档处理 (函数模式 - 小模块，1 handler)
  safeRegister("Document IPC", {
    register: () => {
      const { registerDocumentIPC } = require("../../document/document-ipc");
      registerDocumentIPC({
        convertSlidesToOutline:
          app && app.convertSlidesToOutline
            ? app.convertSlidesToOutline.bind(app)
            : undefined,
      });
    },
    handlers: 1,
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 7 Complete: 4 modules migrated (57 handlers)!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhases6to7Content };
