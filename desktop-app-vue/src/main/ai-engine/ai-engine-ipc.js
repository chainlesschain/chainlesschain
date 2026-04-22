"use strict";

const { ipcMain: electronIpcMain } = require("electron");
const { logger } = require("../utils/logger.js");

const AI_ENGINE_IPC_CHANNELS = [
  "ai:processInput",
  "ai:getHistory",
  "ai:clearHistory",
  "ai:getAvailableTools",
  "web-engine:generate",
  "web-engine:getTemplates",
  "web-engine:startPreview",
  "web-engine:stopPreview",
  "web-engine:restartPreview",
  "web-engine:getPreviewStatus",
  "web-engine:changePreviewPort",
  "document-engine:generate",
  "document-engine:getTemplates",
  "data-engine:readCSV",
  "data-engine:writeCSV",
  "data-engine:readExcel",
  "data-engine:writeExcel",
  "data-engine:analyze",
  "data-engine:generateChart",
  "data-engine:generateReport",
  "git-auto-commit:start",
  "git-auto-commit:stop",
  "git-auto-commit:stopAll",
  "git-auto-commit:setInterval",
  "git-auto-commit:setEnabled",
  "git-auto-commit:getWatchedProjects",
  "aiEngine:recognizeIntent",
  "aiEngine:generatePPT",
  "aiEngine:generateWord",
];

/* v8 ignore start */
function createDefaultAIEngineRuntime() {
  return {
    createIntentLLMManager: async () => {
      const { getLLMConfig } = require("../llm/llm-config");
      const { LLMManager } = require("../llm/llm-manager");

      const llmConfig = getLLMConfig();
      const llmManager = new LLMManager(llmConfig.getManagerConfig());
      await llmManager.initialize();
      return llmManager;
    },
    recognizeProjectIntent: async (userInput, llmManager) => {
      const { recognizeProjectIntent } = require("./intent-recognizer");
      return recognizeProjectIntent(userInput, llmManager);
    },
    createPPTEngine: () => {
      const PPTEngine = require("../engines/ppt-engine");
      return new PPTEngine();
    },
    wordEngine: require("../engines/word-engine"),
    path: require("path"),
  };
}
/* v8 ignore stop */

function removeExistingHandlers(ipc) {
  if (typeof ipc.removeHandler !== "function") {
    return;
  }

  AI_ENGINE_IPC_CHANNELS.forEach((channel) => {
    try {
      ipc.removeHandler(channel);
    } catch (_error) {
      // Ignore missing handlers.
    }
  });
}

class AIEngineIPC {
  constructor(
    aiEngineManager,
    webEngineManager,
    documentEngineManager,
    dataEngineManager,
    gitAutoCommit,
    options = {},
  ) {
    this.aiEngineManager = aiEngineManager;
    this.webEngineManager = webEngineManager;
    this.documentEngineManager = documentEngineManager;
    this.dataEngineManager = dataEngineManager;
    this.gitAutoCommit = gitAutoCommit;
    this.ipcMain = options.ipcMain || null;
    this.runtime = options.runtime || {};
    this.mainWindow = options.mainWindow || null;
  }

  getRuntime(runtimeOverrides = {}) {
    return {
      ...createDefaultAIEngineRuntime(),
      ...this.runtime,
      ...runtimeOverrides,
    };
  }

  registerHandlers(mainWindow, options = {}) {
    const ipc = options.ipcMain || this.ipcMain || electronIpcMain;
    const windowRef = options.mainWindow || mainWindow || this.mainWindow || null;
    const runtime = this.getRuntime(options.runtime);

    this.ipcMain = ipc;
    this.mainWindow = windowRef;

    const safeHandle = (channel, label, handler) => {
      ipc.handle(channel, async (...args) => {
        try {
          return await handler(...args);
        } catch (error) {
          logger.error(`[AI Engine IPC] ${label} failed:`, error);
          return {
            success: false,
            error: error.message || String(error),
          };
        }
      });
    };

    removeExistingHandlers(ipc);

    safeHandle("ai:processInput", "processInput", async (_event, payload = {}) => {
      const { input, context } = payload;
      logger.info("[AI Engine IPC] Processing user input:", input);

      const onStepUpdate = (step) => {
        if (windowRef && windowRef.webContents?.send) {
          windowRef.webContents.send("ai:stepUpdate", step);
        }
      };

      const result = await this.aiEngineManager.processUserInput(
        input,
        context,
        onStepUpdate,
      );

      return {
        success: true,
        result,
      };
    });

    safeHandle("ai:getHistory", "getHistory", async (_event, limit = 10) => {
      const history = this.aiEngineManager.getExecutionHistory(limit);
      return {
        success: true,
        history,
      };
    });

    safeHandle("ai:clearHistory", "clearHistory", async () => {
      this.aiEngineManager.clearHistory();
      return { success: true };
    });

    safeHandle("ai:getAvailableTools", "getAvailableTools", async () => {
      const tools = this.aiEngineManager.getAvailableTools();
      return {
        success: true,
        tools,
      };
    });

    safeHandle("web-engine:generate", "web-engine:generate", async (_event, opts) => {
      logger.info("[Web Engine IPC] Generating web project:", opts);
      return {
        success: true,
        ...(await this.webEngineManager.generateProject(opts)),
      };
    });

    safeHandle("web-engine:getTemplates", "web-engine:getTemplates", async () => {
      return {
        success: true,
        templates: this.webEngineManager.getTemplates(),
      };
    });

    safeHandle(
      "web-engine:startPreview",
      "web-engine:startPreview",
      async (_event, projectPath, port) => {
        return {
          success: true,
          ...(await this.webEngineManager.startPreview(projectPath, port)),
        };
      },
    );

    safeHandle("web-engine:stopPreview", "web-engine:stopPreview", async () => {
      return {
        success: true,
        ...(await this.webEngineManager.stopPreview()),
      };
    });

    safeHandle(
      "web-engine:restartPreview",
      "web-engine:restartPreview",
      async (_event, projectPath) => {
        return {
          success: true,
          ...(await this.webEngineManager.restartPreview(projectPath)),
        };
      },
    );

    safeHandle(
      "web-engine:getPreviewStatus",
      "web-engine:getPreviewStatus",
      async () => {
        return {
          success: true,
          ...this.webEngineManager.getPreviewStatus(),
        };
      },
    );

    safeHandle(
      "web-engine:changePreviewPort",
      "web-engine:changePreviewPort",
      async (_event, newPort) => {
        return {
          success: true,
          ...(await this.webEngineManager.changePreviewPort(newPort)),
        };
      },
    );

    safeHandle(
      "document-engine:generate",
      "document-engine:generate",
      async (_event, opts) => {
        logger.info("[Document Engine IPC] Generating document:", opts);
        return {
          success: true,
          ...(await this.documentEngineManager.generateDocument(opts)),
        };
      },
    );

    safeHandle(
      "document-engine:getTemplates",
      "document-engine:getTemplates",
      async () => {
        return {
          success: true,
          templates: this.documentEngineManager.getTemplates(),
        };
      },
    );

    safeHandle("data-engine:readCSV", "data-engine:readCSV", async (_event, filePath) => {
      return {
        success: true,
        ...(await this.dataEngineManager.readCSV(filePath)),
      };
    });

    safeHandle(
      "data-engine:writeCSV",
      "data-engine:writeCSV",
      async (_event, filePath, data) => {
        return {
          success: true,
          ...(await this.dataEngineManager.writeCSV(filePath, data)),
        };
      },
    );

    safeHandle(
      "data-engine:readExcel",
      "data-engine:readExcel",
      async (_event, filePath) => {
        return {
          success: true,
          ...(await this.dataEngineManager.readExcel(filePath)),
        };
      },
    );

    safeHandle(
      "data-engine:writeExcel",
      "data-engine:writeExcel",
      async (_event, filePath, data) => {
        return {
          success: true,
          ...(await this.dataEngineManager.writeExcel(filePath, data)),
        };
      },
    );

    safeHandle("data-engine:analyze", "data-engine:analyze", async (_event, data, opts) => {
      return {
        success: true,
        ...this.dataEngineManager.analyzeData(data, opts),
      };
    });

    safeHandle(
      "data-engine:generateChart",
      "data-engine:generateChart",
      async (_event, data, opts) => {
        return {
          success: true,
          ...(await this.dataEngineManager.generateChart(data, opts)),
        };
      },
    );

    safeHandle(
      "data-engine:generateReport",
      "data-engine:generateReport",
      async (_event, analysisResults, outputPath) => {
        return {
          success: true,
          ...(await this.dataEngineManager.generateReport(
            analysisResults,
            outputPath,
          )),
        };
      },
    );

    safeHandle(
      "git-auto-commit:start",
      "git-auto-commit:start",
      async (_event, projectId, repoPath) => {
        this.gitAutoCommit.start(projectId, repoPath);
        return { success: true };
      },
    );

    safeHandle("git-auto-commit:stop", "git-auto-commit:stop", async (_event, projectId) => {
      this.gitAutoCommit.stop(projectId);
      return { success: true };
    });

    safeHandle("git-auto-commit:stopAll", "git-auto-commit:stopAll", async () => {
      this.gitAutoCommit.stopAll();
      return { success: true };
    });

    safeHandle(
      "git-auto-commit:setInterval",
      "git-auto-commit:setInterval",
      async (_event, interval) => {
        this.gitAutoCommit.setInterval(interval);
        return { success: true };
      },
    );

    safeHandle(
      "git-auto-commit:setEnabled",
      "git-auto-commit:setEnabled",
      async (_event, enabled) => {
        this.gitAutoCommit.setEnabled(enabled);
        return { success: true };
      },
    );

    safeHandle(
      "git-auto-commit:getWatchedProjects",
      "git-auto-commit:getWatchedProjects",
      async () => {
        return {
          success: true,
          projects: this.gitAutoCommit.getWatchedProjects(),
        };
      },
    );

    safeHandle(
      "aiEngine:recognizeIntent",
      "aiEngine:recognizeIntent",
      async (_event, userInput) => {
        logger.info("[AI Engine IPC] Recognizing intent:", userInput);
        const llmManager = await runtime.createIntentLLMManager();
        const result = await runtime.recognizeProjectIntent(userInput, llmManager);
        logger.info("[AI Engine IPC] Intent recognized:", result);
        return result;
      },
    );

    safeHandle(
      "aiEngine:generatePPT",
      "aiEngine:generatePPT",
      async (_event, options = {}) => {
        logger.info("[AI Engine IPC] Generating PPT:", options);
        const pptEngine = runtime.createPPTEngine();
        const result = await pptEngine.generateFromOutline(options.outline, {
          theme: options.theme || "business",
          author: options.author || "作者",
          outputPath: options.outputPath,
        });

        logger.info("[AI Engine IPC] PPT generated:", result);
        return {
          success: true,
          ...result,
        };
      },
    );

    safeHandle(
      "aiEngine:generateWord",
      "aiEngine:generateWord",
      async (_event, options = {}) => {
        logger.info("[AI Engine IPC] Generating Word document:", options);
        const result = await runtime.wordEngine.writeWord(
          options.outputPath,
          options.structure,
        );

        logger.info("[AI Engine IPC] Word document generated:", result);
        return {
          success: true,
          fileName: runtime.path.basename(options.outputPath),
          path: result.filePath || options.outputPath,
          fileSize: result.fileSize,
          paragraphCount: options.structure?.paragraphs?.length || 0,
        };
      },
    );

    logger.info(`[AI Engine IPC] Registered ${AI_ENGINE_IPC_CHANNELS.length} IPC handlers`);
    return { handlerCount: AI_ENGINE_IPC_CHANNELS.length };
  }

  unregisterHandlers(options = {}) {
    const ipc = options.ipcMain || this.ipcMain || electronIpcMain;
    if (typeof ipc.removeHandler === "function") {
      AI_ENGINE_IPC_CHANNELS.forEach((channel) => {
        ipc.removeHandler(channel);
      });
    }

    logger.info("[AI Engine IPC] Unregistered all IPC handlers");
  }
}

module.exports = AIEngineIPC;
module.exports.AI_ENGINE_IPC_CHANNELS = AI_ENGINE_IPC_CHANNELS;
module.exports.createDefaultAIEngineRuntime = createDefaultAIEngineRuntime;
