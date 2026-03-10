const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");
const { GraphQLAPIManager } = require("./graphql-api-manager");

let manager = null;

function registerGraphQLIPC(dependencies = {}) {
  logger.info("[GraphQL IPC] Registering handlers...");
  const { database, mainWindow } = dependencies;

  if (!manager) {
    manager = new GraphQLAPIManager();
  }

  // graphql:execute-query
  ipcMain.handle(
    "graphql:execute-query",
    async (event, { query, variables, context }) => {
      try {
        if (!manager.initialized) {
          await manager.initialize(database, dependencies);
        }
        const result = await manager.executeQuery(query, variables, context);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[GraphQL IPC] execute-query failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  // graphql:get-schema
  ipcMain.handle("graphql:get-schema", async () => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, dependencies);
      }
      const sdl = manager.getSchemaSDL();
      return { success: true, data: sdl };
    } catch (error) {
      logger.error("[GraphQL IPC] get-schema failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // graphql:create-api-key
  ipcMain.handle("graphql:create-api-key", async (event, { name, options }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, dependencies);
      }
      const result = manager.createAPIKey(name, options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[GraphQL IPC] create-api-key failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // graphql:revoke-api-key
  ipcMain.handle("graphql:revoke-api-key", async (event, { keyId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, dependencies);
      }
      manager.revokeAPIKey(keyId);
      return { success: true };
    } catch (error) {
      logger.error("[GraphQL IPC] revoke-api-key failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // graphql:list-api-keys
  ipcMain.handle("graphql:list-api-keys", async () => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, dependencies);
      }
      const keys = manager.listAPIKeys();
      return { success: true, data: keys };
    } catch (error) {
      logger.error("[GraphQL IPC] list-api-keys failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // graphql:get-query-log
  ipcMain.handle("graphql:get-query-log", async (event, { filter }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, dependencies);
      }
      const log = manager.getQueryLog(filter || {});
      return { success: true, data: log };
    } catch (error) {
      logger.error("[GraphQL IPC] get-query-log failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // graphql:get-stats
  ipcMain.handle("graphql:get-stats", async () => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, dependencies);
      }
      const stats = manager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[GraphQL IPC] get-stats failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // graphql:get-config
  ipcMain.handle("graphql:get-config", async () => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database, dependencies);
      }
      const config = manager.getConfig();
      return { success: true, data: config };
    } catch (error) {
      logger.error("[GraphQL IPC] get-config failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Forward events
  if (manager) {
    manager.on("query:executed", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("graphql:query-executed", data);
      }
    });
    manager.on("apikey:created", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("graphql:apikey-created", data);
      }
    });
  }

  logger.info("[GraphQL IPC] Registered 8 handlers");
}

module.exports = { registerGraphQLIPC, getManager: () => manager };
