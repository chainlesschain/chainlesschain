/**
 * Terraform IPC Handlers
 *
 * 4 IPC handlers for Terraform provider management:
 * - List workspaces
 * - Create workspace
 * - Plan/apply/destroy run
 * - List runs
 *
 * @module enterprise/terraform-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "terraform:list-workspaces",
  "terraform:create-workspace",
  "terraform:plan-run",
  "terraform:list-runs",
];

/**
 * Register all Terraform IPC handlers.
 * @param {Object} dependencies
 * @param {Object} dependencies.terraformManager - TerraformManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main (injectable for tests)
 * @param {Object} [dependencies.ipcGuard] - IPC guard (injectable for tests)
 * @returns {Object} { handlerCount }
 */
function registerTerraformIPC({
  terraformManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("terraform-ipc")
  ) {
    logger.info("[Terraform IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Terraform IPC] Registering Terraform IPC handlers...");

  ipcMain.handle("terraform:list-workspaces", async (_event, filter) => {
    try {
      if (!terraformManager) {
        throw new Error("Terraform Manager not initialized");
      }
      const workspaces = await terraformManager.listWorkspaces(filter || {});
      return { success: true, workspaces };
    } catch (error) {
      logger.error("[Terraform IPC] List workspaces failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("terraform:create-workspace", async (_event, params) => {
    try {
      if (!terraformManager) {
        throw new Error("Terraform Manager not initialized");
      }
      const workspace = await terraformManager.createWorkspace(params);
      return { success: true, workspace };
    } catch (error) {
      logger.error("[Terraform IPC] Create workspace failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("terraform:plan-run", async (_event, params) => {
    try {
      if (!terraformManager) {
        throw new Error("Terraform Manager not initialized");
      }
      const run = await terraformManager.planRun(params);
      return { success: true, run };
    } catch (error) {
      logger.error("[Terraform IPC] Plan run failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("terraform:list-runs", async (_event, params) => {
    try {
      if (!terraformManager) {
        throw new Error("Terraform Manager not initialized");
      }
      const runs = await terraformManager.listRuns(params || {});
      return { success: true, runs };
    } catch (error) {
      logger.error("[Terraform IPC] List runs failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("terraform-ipc", CHANNELS);
  }

  logger.info(
    `[Terraform IPC] Registered ${CHANNELS.length} Terraform IPC handlers`,
  );
  return { handlerCount: CHANNELS.length };
}

function unregisterTerraformIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Intentionally empty - handler may not exist
    }
  }
  if (ipcGuard.unregisterModule) {
    ipcGuard.unregisterModule("terraform-ipc");
  }
  logger.info("[Terraform IPC] All handlers unregistered");
}

export { registerTerraformIPC, unregisterTerraformIPC, CHANNELS };
