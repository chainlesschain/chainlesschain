/**
 * Skill Marketplace IPC Handlers - 技能市场IPC处理器
 *
 * 提供15个IPC处理器用于技能市场操作
 *
 * @module marketplace/skill-marketplace-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * 注册技能市场IPC处理器
 * @param {Object} deps
 * @param {Object} deps.skillMarketplace - SkillMarketplaceClient 实例
 */
function registerSkillMarketplaceIPC({ skillMarketplace }) {
  const market = skillMarketplace;

  // 1. 搜索技能
  ipcMain.handle("skill-market:search", async (event, { query, filters }) => {
    if (!market) {throw new Error("SkillMarketplace not initialized");}
    return await market.searchSkills(query, filters);
  });

  // 2. 技能详情
  ipcMain.handle("skill-market:get-details", async (event, { skillId }) => {
    if (!market) {throw new Error("SkillMarketplace not initialized");}
    return await market.getSkillDetails(skillId);
  });

  // 3. 发布技能
  ipcMain.handle("skill-market:publish", async (event, { skillPackage }) => {
    if (!market) {throw new Error("SkillMarketplace not initialized");}
    return await market.publishSkill(skillPackage);
  });

  // 4. 安装技能
  ipcMain.handle(
    "skill-market:install",
    async (event, { skillId, skillData }) => {
      if (!market) {throw new Error("SkillMarketplace not initialized");}
      return await market.installSkill(skillId, skillData);
    },
  );

  // 5. 卸载技能
  ipcMain.handle("skill-market:uninstall", async (event, { skillId }) => {
    if (!market) {throw new Error("SkillMarketplace not initialized");}
    return await market.uninstallSkill(skillId);
  });

  // 6. 更新技能
  ipcMain.handle(
    "skill-market:update",
    async (event, { skillId, version }) => {
      if (!market) {throw new Error("SkillMarketplace not initialized");}
      return await market.updateSkill(skillId, version);
    },
  );

  // 7. 评价技能
  ipcMain.handle(
    "skill-market:rate",
    async (event, { skillId, rating, review }) => {
      if (!market) {throw new Error("SkillMarketplace not initialized");}
      return await market.rateSkill(skillId, rating, review);
    },
  );

  // 8. 用户发布的技能
  ipcMain.handle("skill-market:get-my-published", async () => {
    if (!market) {return [];}
    return await market.getMyPublished();
  });

  // 9. 已安装技能列表
  ipcMain.handle("skill-market:get-installed", async () => {
    if (!market) {return [];}
    return await market.getInstalled();
  });

  // 10. 分类列表
  ipcMain.handle("skill-market:get-categories", async () => {
    if (!market) {return [];}
    return await market.getCategories();
  });

  // 11. 精选/热门
  ipcMain.handle("skill-market:get-featured", async () => {
    if (!market) {return { featured: [], trending: [], newest: [] };}
    return await market.getFeatured();
  });

  // 12. 举报技能
  ipcMain.handle(
    "skill-market:report",
    async (event, { skillId, reason }) => {
      if (!market) {throw new Error("SkillMarketplace not initialized");}
      return await market.reportSkill(skillId, reason);
    },
  );

  // 13. 检查更新
  ipcMain.handle("skill-market:check-updates", async () => {
    if (!market) {return { checked: 0, updates: [] };}
    return await market.checkUpdates();
  });

  // 14. 切换自动更新
  ipcMain.handle(
    "skill-market:auto-update",
    async (event, { skillId, enabled }) => {
      if (!market) {return false;}
      return await market.toggleAutoUpdate(skillId, enabled);
    },
  );

  // 15. 市场统计
  ipcMain.handle("skill-market:get-stats", async () => {
    if (!market) {return {};}
    return await market.getStats();
  });

  logger.info("[SkillMarketplaceIPC] 15个技能市场IPC处理器注册成功");
}

module.exports = { registerSkillMarketplaceIPC };
