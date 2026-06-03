"use strict";

/**
 * IPC handlers for smart contract signing feature
 */

/**
 * Register contract signer IPC handlers
 * @param {Electron.IpcMain} ipcMain
 * @param {import('./contract-signer').ContractSigner} contractSigner
 */
function registerContractSignerIpcHandlers(ipcMain, contractSigner) {
  ipcMain.handle("ukey:tx:prepare", async (event, txParams) => {
    try {
      const signingRequest = await contractSigner.prepareSign(txParams);
      return { success: true, signingRequest };
    } catch (e) {
      console.error("[ContractSignerIPC] prepare error:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(
    "ukey:tx:sign",
    async (
      event,
      { signingRequest, pin, biometricVerified, addToWhitelist },
    ) => {
      try {
        const result = await contractSigner.sign(
          signingRequest,
          pin,
          biometricVerified,
        );
        if (addToWhitelist && signingRequest.txInfo?.to) {
          contractSigner.addToWhitelist(
            signingRequest.txInfo.to,
            signingRequest.txInfo.chain,
            signingRequest.txInfo.contractName || "",
          );
        }
        return { success: true, ...result };
      } catch (e) {
        console.error("[ContractSignerIPC] sign error:", e.message);
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle("ukey:tx:reject", async (event, { signingRequest }) => {
    try {
      contractSigner.reject(signingRequest);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(
    "ukey:risk:whitelist-add",
    async (event, { address, chain, name }) => {
      try {
        contractSigner.addToWhitelist(address, chain, name);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.handle("ukey:risk:blacklist-check", async (event, { address }) => {
    try {
      const isBlacklisted = contractSigner.isBlacklisted(address);
      return { success: true, isBlacklisted };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  console.log("[ContractSignerIPC] Registered 5 contract signer IPC handlers");
}

module.exports = { registerContractSignerIpcHandlers };
