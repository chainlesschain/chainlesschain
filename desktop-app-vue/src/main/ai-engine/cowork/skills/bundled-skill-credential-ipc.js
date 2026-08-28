"use strict";

const crypto = require("node:crypto");
const {
  getBundledSkillCredentialStore,
  validateCredentialKey,
  validateCredentialValue,
} = require("./bundled-skill-credential-store");

const BUNDLED_SKILL_CREDENTIAL_CHANNELS = Object.freeze([
  "skills:credential-status",
  "skills:set-credential",
  "skills:clear-credential",
]);

function approvalError(message) {
  const error = new Error(message);
  error.code = "CC_BUNDLED_SKILL_CREDENTIAL_APPROVAL_REQUIRED";
  error.prevented = true;
  return error;
}

async function authorizeCredentialMutation({
  hookSystem,
  operation,
  key,
  value,
}) {
  if (!hookSystem || typeof hookSystem.trigger !== "function") {
    throw approvalError("Credential approval system is unavailable");
  }

  const params = { operation, key };
  if (operation === "set") {
    params.valueSha256 = crypto
      .createHash("sha256")
      .update(value)
      .digest("hex");
    params.valueBytes = Buffer.byteLength(value, "utf8");
  }
  const preResult = await hookSystem.trigger("PreToolUse", {
    toolName: "skill:credential-authority",
    params,
  });
  const failedHook = preResult?.hookResults?.find(
    (result) => result.result === "error",
  );
  if (!preResult || preResult.prevented || failedHook) {
    throw approvalError(
      preResult?.preventReason ||
        `Credential mutation approval failed: ${failedHook?.hookName || "unknown"}`,
    );
  }
}

function errorResponse(error) {
  return {
    success: false,
    error: error?.message || "Bundled Skill credential operation failed",
    ...(error?.prevented === true ? { prevented: true } : {}),
  };
}

function registerBundledSkillCredentialIPC(options = {}) {
  const ipcMain = options.ipcMain || require("electron").ipcMain;
  const credentialStore =
    options.credentialStore || getBundledSkillCredentialStore();
  const { hookSystem } = options;

  ipcMain.handle("skills:credential-status", async () => {
    try {
      return { success: true, configured: credentialStore.status() };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle("skills:set-credential", async (_event, payload = {}) => {
    try {
      const key = validateCredentialKey(payload.key);
      const value = validateCredentialValue(payload.value);
      await authorizeCredentialMutation({
        hookSystem,
        operation: "set",
        key,
        value,
      });
      credentialStore.set(key, value);
      return { success: true, configured: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle("skills:clear-credential", async (_event, payload = {}) => {
    try {
      const key = validateCredentialKey(payload.key);
      await authorizeCredentialMutation({
        hookSystem,
        operation: "clear",
        key,
      });
      credentialStore.clear(key);
      return { success: true, configured: false };
    } catch (error) {
      return errorResponse(error);
    }
  });

  return credentialStore;
}

function unregisterBundledSkillCredentialIPC(options = {}) {
  const ipcMain = options.ipcMain || require("electron").ipcMain;
  for (const channel of BUNDLED_SKILL_CREDENTIAL_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

module.exports = {
  BUNDLED_SKILL_CREDENTIAL_CHANNELS,
  authorizeCredentialMutation,
  registerBundledSkillCredentialIPC,
  unregisterBundledSkillCredentialIPC,
};
