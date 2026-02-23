"use strict";

/**
 * IPC handlers for hardware wallet integration
 */

/**
 * Register hardware wallet IPC handlers
 * @param {Electron.IpcMain} ipcMain
 * @param {import('./hw-wallet-bridge').HWWalletBridge} hwWalletBridge
 * @param {import('./multi-device-signer').MultiDeviceSigner} multiDeviceSigner
 */
function registerHWWalletIpcHandlers(
  ipcMain,
  hwWalletBridge,
  multiDeviceSigner,
) {
  ipcMain.handle("hw-wallet:scan", async () => {
    try {
      const devices = await hwWalletBridge.scan();
      return { success: true, devices };
    } catch (e) {
      console.error("[HWWalletIPC] scan error:", e.message);
      return { success: false, error: e.message, devices: [] };
    }
  });

  ipcMain.handle("hw-wallet:connect", async (event, { deviceId }) => {
    try {
      const device = await hwWalletBridge.connect(deviceId);
      return { success: true, device };
    } catch (e) {
      console.error("[HWWalletIPC] connect error:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("hw-wallet:disconnect", async (event, { deviceId }) => {
    try {
      await hwWalletBridge.disconnect(deviceId);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(
    "hw-wallet:get-address",
    async (event, { deviceId, derivationPath, coinType }) => {
      try {
        const result = await hwWalletBridge.getAddress(
          deviceId,
          derivationPath,
          coinType,
        );
        return { success: true, ...result };
      } catch (e) {
        console.error("[HWWalletIPC] get-address error:", e.message);
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle(
    "hw-wallet:sign-tx",
    async (event, { deviceId, derivationPath, txParams }) => {
      try {
        const result = await hwWalletBridge.signTx(
          deviceId,
          derivationPath,
          txParams,
        );
        return { success: true, ...result };
      } catch (e) {
        console.error("[HWWalletIPC] sign-tx error:", e.message);
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle("hw-wallet:get-info", async (event, { deviceId }) => {
    try {
      const adapter = hwWalletBridge.getAdapter(deviceId);
      const info = await adapter.getDeviceInfo();
      return { success: true, info };
    } catch (e) {
      console.error("[HWWalletIPC] get-info error:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(
    "hw-wallet:multi-sign",
    async (event, { txParams, riskLevel, ukeyPin, hwDeviceId }) => {
      try {
        const result = await multiDeviceSigner.sign(
          txParams,
          riskLevel,
          ukeyPin,
          hwDeviceId,
        );
        return { success: true, ...result };
      } catch (e) {
        console.error("[HWWalletIPC] multi-sign error:", e.message);
        return { success: false, error: e.message };
      }
    },
  );

  console.log("[HWWalletIPC] Registered 7 hardware wallet IPC handlers");
}

module.exports = { registerHWWalletIpcHandlers };
