const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");
const { WebAuthnPasskeyManager } = require("./webauthn-passkey-manager");

let manager = null;

function registerWebAuthnIPC(dependencies = {}) {
  logger.info("[WebAuthn IPC] Registering handlers...");
  const { database, mainWindow } = dependencies;

  if (!manager) {
    manager = new WebAuthnPasskeyManager();
  }

  ipcMain.handle(
    "webauthn:register-begin",
    async (event, { rpId, rpName, userId, userName, options }) => {
      try {
        if (!manager.initialized) {
          await manager.initialize(database, {});
        }
        const result = await manager.beginRegistration(
          rpId,
          rpName,
          userId,
          userName,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[WebAuthn IPC] register-begin failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "webauthn:register-complete",
    async (event, { ceremonyId, attestationResponse }) => {
      try {
        if (!manager.initialized) {
          await manager.initialize(database, {});
        }
        const result = await manager.completeRegistration(
          ceremonyId,
          attestationResponse,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[WebAuthn IPC] register-complete failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "webauthn:authenticate-begin",
    async (event, { rpId, userId, options }) => {
      try {
        if (!manager.initialized) {
          await manager.initialize(database, {});
        }
        const result = await manager.beginAuthentication(rpId, userId, options);
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[WebAuthn IPC] authenticate-begin failed:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "webauthn:authenticate-complete",
    async (event, { ceremonyId, assertionResponse }) => {
      try {
        if (!manager.initialized) {
          await manager.initialize(database, {});
        }
        const result = await manager.completeAuthentication(
          ceremonyId,
          assertionResponse,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[WebAuthn IPC] authenticate-complete failed:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("webauthn:list-passkeys", async (event, { rpId, userId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, {});
      }
      const result = await manager.listPasskeys(rpId, userId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WebAuthn IPC] list-passkeys failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("webauthn:delete-passkey", async (event, { credentialId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, {});
      }
      const result = await manager.deletePasskey(credentialId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WebAuthn IPC] delete-passkey failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("webauthn:bind-did", async (event, { credentialId, did }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, {});
      }
      const result = await manager.bindDID(credentialId, did);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WebAuthn IPC] bind-did failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("webauthn:unbind-did", async (event, { credentialId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, {});
      }
      const result = await manager.unbindDID(credentialId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WebAuthn IPC] unbind-did failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("webauthn:get-stats", async () => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, {});
      }
      const result = await manager.getStats();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WebAuthn IPC] get-stats failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("webauthn:get-config", async () => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, {});
      }
      const result = await manager.getConfig();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WebAuthn IPC] get-config failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Forward events to renderer
  if (manager) {
    manager.on("passkey:registered", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("webauthn:passkey-registered", data);
      }
    });
    manager.on("passkey:authenticated", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("webauthn:passkey-authenticated", data);
      }
    });
  }

  logger.info("[WebAuthn IPC] Registered 10 handlers");
}

module.exports = { registerWebAuthnIPC, getManager: () => manager };
