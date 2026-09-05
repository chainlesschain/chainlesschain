"use strict";

const { ipcMain } = require("electron");
const { types: utilTypes } = require("node:util");
const { logger } = require("../utils/logger.js");
const { validateSender } = require("../ipc/ipc-sender-guard");

function inputFields(value, fields) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("marketplace IPC request must be a plain object");
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !fields.includes(key) ||
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    ) {
      throw new TypeError(
        "marketplace IPC request contains unsupported fields",
      );
    }
  }
  return value;
}

function registerSkillMarketplaceIPC({
  skillMarketplace,
  mainWindow,
  ipcMain: targetIpcMain = ipcMain,
}) {
  const market = () => {
    if (!skillMarketplace) {
      throw new Error("SkillMarketplace not initialized");
    }
    return skillMarketplace;
  };
  const _ipcMain = {
    handle(channel, handler) {
      targetIpcMain.handle(channel, (event, ...args) => {
        const contents = mainWindow?.webContents;
        if (
          !contents ||
          event?.sender !== contents ||
          !event.senderFrame ||
          event.senderFrame !== contents.mainFrame ||
          validateSender(event).trusted !== true
        ) {
          throw new Error(
            "marketplace IPC requires the trusted Desktop main frame",
          );
        }
        return handler(event, ...args);
      });
    },
  };

  _ipcMain.handle("skill-market:search", async (_event, { query, filters }) =>
    market().searchSkills(query, filters),
  );
  _ipcMain.handle("skill-market:get-details", async (_event, { skillId }) =>
    market().getSkillDetails(skillId),
  );
  _ipcMain.handle("skill-market:publish", async (_event, { skillPackage }) =>
    market().publishSkill(skillPackage),
  );
  _ipcMain.handle("skill-market:install", async (_event, input) => {
    const { skillId, skillData } = inputFields(input, ["skillId", "skillData"]);
    return market().installSkill(skillId, skillData);
  });
  _ipcMain.handle("skill-market:uninstall", async (_event, input) => {
    const { skillId, expectedStateDigest, receiptRef } = inputFields(input, [
      "skillId",
      "expectedStateDigest",
      "receiptRef",
    ]);
    return market().uninstallSkill(skillId, {
      expectedStateDigest,
      receiptRef,
    });
  });
  _ipcMain.handle("skill-market:update", async (_event, input) => {
    const { skillId, skillData } = inputFields(input, ["skillId", "skillData"]);
    return market().updateSkill(skillId, skillData);
  });
  _ipcMain.handle(
    "skill-market:rate",
    async (_event, { skillId, rating, review }) =>
      market().rateSkill(skillId, rating, review),
  );
  _ipcMain.handle("skill-market:get-my-published", async () =>
    market().getMyPublished(),
  );
  _ipcMain.handle("skill-market:get-installed", async () =>
    market().getInstalled(),
  );
  _ipcMain.handle("skill-market:get-categories", async () =>
    market().getCategories(),
  );
  _ipcMain.handle("skill-market:get-featured", async () =>
    market().getFeatured(),
  );
  _ipcMain.handle("skill-market:report", async (_event, { skillId, reason }) =>
    market().reportSkill(skillId, reason),
  );
  _ipcMain.handle("skill-market:check-updates", async () =>
    market().checkUpdates(),
  );
  _ipcMain.handle(
    "skill-market:auto-update",
    async (_event, { skillId, enabled }) =>
      market().toggleAutoUpdate(skillId, enabled),
  );
  _ipcMain.handle("skill-market:get-stats", async () => market().getStats());

  _ipcMain.handle("skill-market:capabilities", async (_event, input = {}) => {
    inputFields(input, []);
    return market().getGovernanceStatus();
  });
  _ipcMain.handle("skill-market:inspect", async (_event, input) => {
    const { skillId, version } = inputFields(input, ["skillId", "version"]);
    return market().inspectSkill(skillId, version ?? null);
  });
  _ipcMain.handle("skill-market:state", async (_event, input) => {
    const { skillId } = inputFields(input, ["skillId"]);
    return market().getGovernedState(skillId);
  });
  _ipcMain.handle("skill-market:rollout", async (_event, input) => {
    const { skillId, expectedStateDigest, receiptRef } = inputFields(input, [
      "skillId",
      "expectedStateDigest",
      "receiptRef",
    ]);
    return market().rolloutSkill(skillId, { expectedStateDigest, receiptRef });
  });
  _ipcMain.handle("skill-market:revoke", async (_event, input) => {
    const { skillId, expectedStateDigest, receiptRef } = inputFields(input, [
      "skillId",
      "expectedStateDigest",
      "receiptRef",
    ]);
    return market().uninstallSkill(skillId, {
      expectedStateDigest,
      receiptRef,
    });
  });
  logger.info("[SkillMarketplaceIPC] Registered 20 marketplace handlers");
}

module.exports = { registerSkillMarketplaceIPC };
