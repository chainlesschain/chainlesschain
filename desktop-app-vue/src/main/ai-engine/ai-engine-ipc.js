"use strict";

const { ipcMain: electronIpcMain } = require("electron");
const { logger } = require("../utils/logger.js");
const {
  createAIEngineIpcAuthorization,
} = require("./ai-engine-ipc-authorization");
const {
  validatePPTRequest,
  validateWordRequest,
} = require("./ai-engine-ipc-input");
const { createAIEngineOutputResolver } = require("./ai-engine-ipc-output");

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
    } catch {
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
    this.authorization = options.authorization || null;
    this.getMainWindow = options.getMainWindow;
    this.getCurrentIdentity = options.getCurrentIdentity;
    this.authorizePurpose = options.authorizePurpose;
    this.database = options.database || null;
    this.authorizeProjectOutput = options.authorizeProjectOutput;
    this.outputResolver = options.outputResolver || null;
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
    const runtime = this.getRuntime(options.runtime);
    const authorization =
      options.authorization ||
      this.authorization ||
      createAIEngineIpcAuthorization({
        getMainWindow:
          options.getMainWindow ||
          this.getMainWindow ||
          (() => mainWindow || null),
        getCurrentIdentity:
          options.getCurrentIdentity || this.getCurrentIdentity,
        authorizePurpose:
          options.authorizePurpose === undefined
            ? this.authorizePurpose
            : options.authorizePurpose,
      });
    const outputResolver =
      options.outputResolver ||
      this.outputResolver ||
      createAIEngineOutputResolver({
        database: options.database || this.database,
        authorizeProjectOutput:
          options.authorizeProjectOutput === undefined
            ? this.authorizeProjectOutput
            : options.authorizeProjectOutput,
      });

    if (!authorization || typeof authorization.authorize !== "function") {
      throw new TypeError("AI Engine IPC authorization is required");
    }
    if (!outputResolver || typeof outputResolver.reserve !== "function") {
      throw new TypeError("AI Engine IPC output resolver is required");
    }

    this.ipcMain = ipc;

    const safeHandle = (channel, operation, handler) => {
      ipc.handle(channel, async (event, ...args) => {
        try {
          const authorizationContext = await authorization.authorize(
            event,
            operation,
          );
          return await handler(authorizationContext, ...args);
        } catch {
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

    safeHandle(
      "aiEngine:generatePPT",
      "generate-ppt",
      async (context, request) => {
        const input = validatePPTRequest(request);
        const lease = await outputResolver.reserve(context, {
          projectId: input.projectId,
          title: input.outline.title,
          extension: ".pptx",
        });
        try {
          const pptEngine = runtime.createPPTEngine();
          const result = await pptEngine.generateFromOutline(input.outline, {
            theme: input.theme,
            author: input.author,
            outputPath: lease.outputPath,
          });
          await lease.commit();
          return {
            success: true,
            fileName: lease.fileName,
            path: lease.outputPath,
            slideCount: normalizeCount(result?.slideCount),
          };
        } catch (error) {
          await lease.cleanup();
          throw error;
        }
      },
    );

    safeHandle(
      "aiEngine:generateWord",
      "generate-word",
      async (context, request) => {
        const input = validateWordRequest(request);
        const lease = await outputResolver.reserve(context, {
          projectId: input.projectId,
          title: input.structure.title,
          extension: ".docx",
        });
        try {
          await runtime.wordEngine.writeWord(lease.outputPath, input.structure);
          const output = await lease.commit();
          return {
            success: true,
            fileName: lease.fileName,
            path: lease.outputPath,
            fileSize: normalizeCount(output?.fileSize),
            paragraphCount: normalizeCount(input.structure.paragraphs.length),
          };
        } catch (error) {
          await lease.cleanup();
          throw error;
        }
      },
    );

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
