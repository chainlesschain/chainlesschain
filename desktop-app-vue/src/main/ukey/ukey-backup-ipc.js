"use strict";

/**
 * IPC handlers for U盾 cloud backup feature
 */

/**
 * Register backup IPC handlers
 * @param {Electron.IpcMain} ipcMain
 * @param {import('./cloud-backup-manager').CloudBackupManager} cloudBackupManager
 */
function registerBackupIpcHandlers(ipcMain, cloudBackupManager) {
  ipcMain.handle(
    "ukey:backup:create",
    async (event, { ukeyData, passphrase, strategy }) => {
      try {
        const result = await cloudBackupManager.createBackup(
          Buffer.from(ukeyData || "demo-key-material"),
          passphrase || "",
          { strategy },
        );
        return { success: true, ...result };
      } catch (e) {
        console.error("[BackupIPC] create error:", e.message);
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle(
    "ukey:backup:restore",
    async (event, { backupId, passphrase, minShards }) => {
      try {
        const data = await cloudBackupManager.restoreBackup(
          backupId,
          passphrase || "",
          minShards,
        );
        return { success: true, data: data.toString("hex") };
      } catch (e) {
        console.error("[BackupIPC] restore error:", e.message);
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle("ukey:backup:list", async () => {
    try {
      const versions = await cloudBackupManager.listBackups();
      return { success: true, versions };
    } catch (e) {
      console.error("[BackupIPC] list error:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("ukey:backup:verify", async (event, { backupId }) => {
    try {
      const result = await cloudBackupManager.verifyBackup(backupId);
      return { success: true, ...result };
    } catch (e) {
      console.error("[BackupIPC] verify error:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("ukey:backup:delete", async (event, { backupId }) => {
    try {
      await cloudBackupManager.deleteBackup(backupId);
      return { success: true };
    } catch (e) {
      console.error("[BackupIPC] delete error:", e.message);
      return { success: false, error: e.message };
    }
  });

  console.log("[BackupIPC] Registered 5 backup IPC handlers");
}

module.exports = { registerBackupIpcHandlers };
