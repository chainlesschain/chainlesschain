const {
  CodingAgentSessionService,
} = require("../ai-engine/code-agent/coding-agent-session-service.js");
const {
  registerCodingAgentIPCV3,
} = require("../ai-engine/code-agent/coding-agent-ipc-v3.js");

/**
 * Owns the production lifetime of Coding Agent V3.
 *
 * The service intentionally outlives an individual BrowserWindow so background
 * sessions keep running when macOS closes and later recreates the main window.
 * IPC handlers are rebound to the same service for each new window and are
 * removed before the bridge is shut down during application exit.
 */
function createCodingAgentBootstrap(options = {}) {
  const ServiceClass =
    options.ServiceClass || options.serviceClass || CodingAgentSessionService;
  const registerIPC = options.registerIPC || registerCodingAgentIPCV3;
  const service =
    options.service ||
    new ServiceClass({
      mainWindow: options.mainWindow || null,
      repoRoot: options.repoRoot,
      projectRoot: options.projectRoot,
      toolManager: options.toolManager || null,
      mcpManager: options.mcpManager || null,
      enablePhase5Envelopes: options.enablePhase5Envelopes === true,
    });

  let currentWindow = null;
  let removeWindowClosedListener = null;
  let unregisterIPC = null;
  let disposed = false;

  function detachWindow() {
    if (removeWindowClosedListener) {
      removeWindowClosedListener();
      removeWindowClosedListener = null;
    }
    currentWindow = null;
  }

  function attachWindow(mainWindow) {
    if (disposed) {
      throw new Error("Coding Agent V3 bootstrap is already disposed");
    }
    if (!mainWindow) {
      throw new Error("Coding Agent V3 bootstrap requires a main window");
    }

    detachWindow();
    currentWindow = mainWindow;
    service.setMainWindow(mainWindow);

    if (unregisterIPC) {
      unregisterIPC();
    }
    unregisterIPC = registerIPC({
      service,
      ipcMain: options.ipcMain,
    });

    const onClosed = () => {
      if (currentWindow !== mainWindow) {
        return;
      }
      detachWindow();
      service.setMainWindow(null);
    };

    if (typeof mainWindow.once === "function") {
      mainWindow.once("closed", onClosed);
      removeWindowClosedListener = () => {
        if (typeof mainWindow.removeListener === "function") {
          mainWindow.removeListener("closed", onClosed);
        }
      };
    }

    return service;
  }

  async function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;

    detachWindow();
    service.setMainWindow(null);

    if (unregisterIPC) {
      unregisterIPC();
      unregisterIPC = null;
    }

    await service.shutdown();
  }

  if (options.mainWindow) {
    attachWindow(options.mainWindow);
  }

  return {
    service,
    attachWindow,
    dispose,
    isDisposed: () => disposed,
  };
}

module.exports = {
  createCodingAgentBootstrap,
};
