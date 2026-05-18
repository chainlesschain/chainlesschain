/**
 * IPC API Doc Generator - IPC Handlers
 *
 * Registers 6 IPC handlers for the API documentation generator,
 * enabling renderer process access to OpenAPI spec generation,
 * handler scanning, and channel introspection.
 *
 * @module ai-engine/cowork/ipc-api-doc-generator-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

/**
 * All IPC channels for the API doc generator
 */
const API_DOCS_CHANNELS = [
  "api-docs:generate",
  "api-docs:scan-handlers",
  "api-docs:get-spec",
  "api-docs:get-channel-info",
  "api-docs:get-stats",
  "api-docs:get-config",
];

/**
 * Register all API doc generator IPC handlers
 * @param {Object} apiDocGenerator - IPCApiDocGenerator instance
 */
function registerApiDocsIPC(apiDocGenerator) {
  if (!apiDocGenerator) {
    logger.warn(
      "[ApiDocsIPC] No API doc generator provided, registering fallbacks",
    );
    for (const channel of API_DOCS_CHANNELS) {
      ipcMain.handle(channel, async () => ({
        success: false,
        error: "IPCApiDocGenerator is not initialized",
        code: "API_DOCS_UNAVAILABLE",
      }));
    }
    return;
  }

  // ============================================================
  // Generation Operations
  // ============================================================

  /**
   * Generate full OpenAPI spec + Markdown docs
   * @param {Object} [options] - Generation options
   */
  ipcMain.handle("api-docs:generate", async (_event, options = {}) => {
    try {
      // Re-scan if requested
      if (options.rescan) {
        await apiDocGenerator.scanAllHandlers();
      }

      const spec = apiDocGenerator.generateOpenAPISpec();
      const markdown = apiDocGenerator.generateMarkdownDocs();
      const stats = apiDocGenerator.getStats();

      return {
        success: true,
        data: {
          openApiSpec: spec,
          markdown,
          stats,
        },
      };
    } catch (error) {
      logger.error("[ApiDocsIPC] generate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Scan and list all IPC handlers (re-scan from disk)
   */
  ipcMain.handle("api-docs:scan-handlers", async () => {
    try {
      const handlers = await apiDocGenerator.scanAllHandlers();
      const result = {};
      for (const [namespace, handlerList] of handlers) {
        result[namespace] = handlerList.map((h) => ({
          channel: h.channel,
          description: h.description,
          params: h.params,
          file: h.file,
          line: h.line,
        }));
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ApiDocsIPC] scan-handlers error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get generated OpenAPI spec (from cache if available)
   * @param {string} [format='json'] - Output format ('json' or 'yaml')
   */
  ipcMain.handle("api-docs:get-spec", async (_event, format = "json") => {
    try {
      const spec = apiDocGenerator.generateOpenAPISpec();
      if (format === "yaml") {
        // Simple YAML-like representation (no external dep)
        return {
          success: true,
          data: JSON.stringify(spec, null, 2),
          format: "json",
          note: "YAML format requires js-yaml package; returning JSON",
        };
      }
      return { success: true, data: spec };
    } catch (error) {
      logger.error("[ApiDocsIPC] get-spec error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get info for a specific IPC channel
   * @param {string} channel - Channel name (e.g., "instinct:get-all")
   */
  ipcMain.handle("api-docs:get-channel-info", async (_event, channel) => {
    try {
      if (!channel) {
        return { success: false, error: "Channel name is required" };
      }
      const info = apiDocGenerator.getChannelInfo(channel);
      if (!info) {
        return {
          success: false,
          error: `Channel "${channel}" not found`,
        };
      }
      return { success: true, data: info };
    } catch (error) {
      logger.error("[ApiDocsIPC] get-channel-info error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Stats & Config
  // ============================================================

  /**
   * Get handler counts by namespace
   */
  ipcMain.handle("api-docs:get-stats", async () => {
    try {
      const stats = apiDocGenerator.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[ApiDocsIPC] get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get generator configuration
   */
  ipcMain.handle("api-docs:get-config", async () => {
    try {
      const config = apiDocGenerator.getConfig();
      return { success: true, data: config };
    } catch (error) {
      logger.error("[ApiDocsIPC] get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[ApiDocsIPC] Registered ${API_DOCS_CHANNELS.length} handlers`);
}

module.exports = { registerApiDocsIPC, API_DOCS_CHANNELS };
