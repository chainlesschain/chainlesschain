"use strict";

const { ipcMain: electronIpcMain } = require("electron");
const { logger } = require("../utils/logger.js");

const AI_ENGINE_IPC_CHANNELS = [
  "aiEngine:generatePPT",
  "aiEngine:generateWord",
];

/* v8 ignore start */
function createDefaultAIEngineRuntime() {
  return {
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

function normalizeCount(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

class AIEngineIPC {
  constructor(
    _aiEngineManager,
    _webEngineManager,
    _documentEngineManager,
    _dataEngineManager,
    _gitAutoCommit,
    options = {},
  ) {
    this.ipcMain = options.ipcMain || null;
    this.runtime = options.runtime || {};
  }

  getRuntime(runtimeOverrides = {}) {
    return {
      ...createDefaultAIEngineRuntime(),
      ...this.runtime,
      ...runtimeOverrides,
    };
  }

  registerHandlers(_mainWindow, options = {}) {
    const ipc = options.ipcMain || this.ipcMain || electronIpcMain;
    const runtime = this.getRuntime(options.runtime);

    this.ipcMain = ipc;

    const safeHandle = (channel, handler) => {
      ipc.handle(channel, async (...args) => {
        try {
          return await handler(...args);
        } catch (_error) {
          logger.error("[AI Engine IPC] operation failed");
          return {
            success: false,
            code: "AI_ENGINE_OPERATION_FAILED",
            error: "AI engine operation failed",
          };
        }
      });
    };

    removeExistingHandlers(ipc);

    safeHandle("aiEngine:generatePPT", async (_event, request = {}) => {
      const pptEngine = runtime.createPPTEngine();
      const result = await pptEngine.generateFromOutline(request.outline, {
        theme: request.theme || "business",
        author: request.author || "作者",
        outputPath: request.outputPath,
      });
      const outputPath = result?.filePath || request.outputPath;

      return {
        success: true,
        fileName: outputPath ? runtime.path.basename(outputPath) : "",
        path: outputPath,
        slideCount: normalizeCount(result?.slideCount),
      };
    });

    safeHandle("aiEngine:generateWord", async (_event, request = {}) => {
      const result = await runtime.wordEngine.writeWord(
        request.outputPath,
        request.structure,
      );
      const outputPath = result?.filePath || request.outputPath;

      return {
        success: true,
        fileName: outputPath ? runtime.path.basename(outputPath) : "",
        path: outputPath,
        fileSize: normalizeCount(result?.fileSize),
        paragraphCount: normalizeCount(request.structure?.paragraphs?.length),
      };
    });

    logger.info(
      `[AI Engine IPC] Registered ${AI_ENGINE_IPC_CHANNELS.length} IPC handlers`,
    );
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
