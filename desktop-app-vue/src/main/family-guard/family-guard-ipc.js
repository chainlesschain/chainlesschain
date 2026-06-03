/**
 * FAMILY-26 家长端 family-guard 仪表板 IPC（只读）。
 *
 * 暴露 3 个 channel 给 renderer 查 family_child_event 镜像表：
 *   - family-guard:list-children       → 有数据的孩子列表
 *   - family-guard:list-child-events   → 某孩子最近事件
 *   - family-guard:app-usage-summary   → 某孩子按 app 聚合时长
 *
 * 镜像表由 mobile-bridge-sync._applyTelemetry 写入（Android child 上行）。
 * database 为 null（未初始化）时各 handler 返回空结果而非抛错（degraded）。
 *
 * @module family-guard/family-guard-ipc
 */

const { logger } = require("../utils/logger.js");
const defaultIpcMain = require("electron").ipcMain;
const defaultIpcGuard = require("../ipc/ipc-guard");
const query = require("./child-event-query");

const MODULE_NAME = "family-guard-ipc";

function registerFamilyGuardIPC({ database, ipcMain, ipcGuard } = {}) {
  ipcMain = ipcMain || defaultIpcMain;
  ipcGuard = ipcGuard || defaultIpcGuard;

  if (ipcGuard.isModuleRegistered(MODULE_NAME)) {
    logger.info("[FamilyGuard IPC] Handlers already registered, skipping...");
    return;
  }

  logger.info("[FamilyGuard IPC] Registering FamilyGuard IPC handlers...");

  ipcMain.handle("family-guard:list-children", async () => {
    try {
      if (!database) {
        return { success: true, data: [] };
      }
      return { success: true, data: query.listChildren(database) };
    } catch (error) {
      logger.error("[FamilyGuard IPC] list-children 失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("family-guard:list-child-events", async (_event, params) => {
    try {
      if (!database) {
        return { success: true, data: [] };
      }
      return {
        success: true,
        data: query.listChildEvents(database, params || {}),
      };
    } catch (error) {
      logger.error("[FamilyGuard IPC] list-child-events 失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("family-guard:app-usage-summary", async (_event, params) => {
    try {
      if (!database) {
        return { success: true, data: { totalMs: 0, apps: [] } };
      }
      return {
        success: true,
        data: query.summarizeAppUsage(database, params || {}),
      };
    } catch (error) {
      logger.error("[FamilyGuard IPC] app-usage-summary 失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcGuard.markModuleRegistered(MODULE_NAME);
  logger.info("[FamilyGuard IPC] FamilyGuard IPC registered (3 handlers)");
}

module.exports = { registerFamilyGuardIPC };
