/**
 * Skill Marketplace Client - 技能市场客户端
 *
 * 提供技能市场的搜索、发布、安装、评价等功能
 * 扩展现有 marketplace-client 模式，专注于技能生态
 *
 * @module marketplace/skill-marketplace-client
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

const SkillMarketStatus = {
  DRAFT: "draft",
  PUBLISHED: "published",
  UNDER_REVIEW: "under_review",
  REJECTED: "rejected",
  DEPRECATED: "deprecated",
};

const SkillMarketCategory = {
  PRODUCTIVITY: "productivity",
  DEVELOPMENT: "development",
  DATA_ANALYSIS: "data-analysis",
  CREATIVE: "creative",
  COMMUNICATION: "communication",
  AUTOMATION: "automation",
  SECURITY: "security",
  TRADING: "trading",
  SOCIAL: "social",
  OTHER: "other",
};

class SkillMarketplaceClient extends EventEmitter {
  constructor({ database, skillRegistry }) {
    super();

    this.database = database;
    this.skillRegistry = skillRegistry;
    this.initialized = false;
    this.apiBaseUrl =
      process.env.SKILL_MARKETPLACE_URL || "http://localhost:8091/api/skills";
    this.cacheTimeout = 300000;
  }

  async initialize() {
    logger.info("[SkillMarketplace] 初始化技能市场客户端...");

    try {
      await this._initializeTables();
      this.initialized = true;
      logger.info("[SkillMarketplace] 技能市场客户端初始化成功");
    } catch (error) {
      logger.error("[SkillMarketplace] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) return;

    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_marketplace_installs (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        author TEXT,
        category TEXT,
        installed_at INTEGER DEFAULT (strftime('%s','now')),
        last_updated INTEGER,
        auto_update INTEGER DEFAULT 1
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_marketplace_cache (
        skill_id TEXT PRIMARY KEY,
        details TEXT,
        cached_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);
  }

  async searchSkills(query, filters = {}) {
    const { category, sort = "popularity", page = 1, pageSize = 20 } = filters;

    const installed = await this.getInstalled();
    const localResults = installed.filter(
      (s) =>
        s.name.toLowerCase().includes((query || "").toLowerCase()) &&
        (!category || s.category === category),
    );

    return {
      results: localResults,
      total: localResults.length,
      page,
      pageSize,
      source: "local",
    };
  }

  async getSkillDetails(skillId) {
    const cached = await this._getCachedDetails(skillId);
    if (cached) return cached;

    const db = this.database?.db;
    if (!db) return null;

    const install = db
      .prepare("SELECT * FROM skill_marketplace_installs WHERE skill_id = ?")
      .get(skillId);

    if (install) {
      return { ...install, installed: true, source: "local" };
    }

    return null;
  }

  async publishSkill(skillPackage) {
    const { name, version, description, category, skillMd } = skillPackage;

    if (!name || !version || !skillMd) {
      throw new Error("Missing required fields: name, version, skillMd");
    }

    const publishId = uuidv4();
    const publishRecord = {
      id: publishId,
      name,
      version,
      description: description || "",
      category: category || SkillMarketCategory.OTHER,
      status: SkillMarketStatus.UNDER_REVIEW,
      published_at: Math.floor(Date.now() / 1000),
    };

    this.emit("skill-published", publishRecord);
    logger.info(`[SkillMarketplace] 技能 ${name}@${version} 已提交发布审核`);

    return publishRecord;
  }

  async installSkill(skillId, skillData = {}) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const installId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT OR REPLACE INTO skill_marketplace_installs
       (id, skill_id, name, version, author, category, installed_at, last_updated, auto_update)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      installId,
      skillId,
      skillData.name || skillId,
      skillData.version || "1.0.0",
      skillData.author || "unknown",
      skillData.category || SkillMarketCategory.OTHER,
      now,
      now,
      1,
    );

    this.emit("skill-installed", { skillId, installId });
    logger.info(`[SkillMarketplace] 技能 ${skillId} 安装成功`);

    return { installId, skillId, status: "installed" };
  }

  async uninstallSkill(skillId) {
    const db = this.database?.db;
    if (!db) return false;

    const result = db
      .prepare("DELETE FROM skill_marketplace_installs WHERE skill_id = ?")
      .run(skillId);

    if (result.changes > 0) {
      this.emit("skill-uninstalled", { skillId });
      logger.info(`[SkillMarketplace] 技能 ${skillId} 已卸载`);
    }

    return result.changes > 0;
  }

  async updateSkill(skillId, newVersion) {
    const db = this.database?.db;
    if (!db) return false;

    const now = Math.floor(Date.now() / 1000);
    const result = db
      .prepare(
        "UPDATE skill_marketplace_installs SET version = ?, last_updated = ? WHERE skill_id = ?",
      )
      .run(newVersion || "latest", now, skillId);

    if (result.changes > 0) {
      this.emit("skill-updated", { skillId, version: newVersion });
    }

    return result.changes > 0;
  }

  async rateSkill(skillId, rating, review = "") {
    if (rating < 1 || rating > 5) {
      throw new Error("Rating must be between 1 and 5");
    }

    const rateRecord = {
      skillId,
      rating,
      review,
      rated_at: Math.floor(Date.now() / 1000),
    };

    this.emit("skill-rated", rateRecord);
    return rateRecord;
  }

  async getMyPublished() {
    return [];
  }

  async getInstalled() {
    const db = this.database?.db;
    if (!db) return [];

    return db
      .prepare(
        "SELECT * FROM skill_marketplace_installs ORDER BY installed_at DESC",
      )
      .all();
  }

  async getCategories() {
    return Object.entries(SkillMarketCategory).map(([key, value]) => ({
      id: value,
      name: key.replace(/_/g, " ").toLowerCase(),
      label: value,
    }));
  }

  async getFeatured() {
    return { featured: [], trending: [], newest: [] };
  }

  async reportSkill(skillId, reason) {
    const report = {
      skillId,
      reason,
      reported_at: Math.floor(Date.now() / 1000),
    };

    this.emit("skill-reported", report);
    logger.info(`[SkillMarketplace] 技能 ${skillId} 已被举报: ${reason}`);
    return report;
  }

  async checkUpdates() {
    const installed = await this.getInstalled();
    return { checked: installed.length, updates: [] };
  }

  async toggleAutoUpdate(skillId, enabled) {
    const db = this.database?.db;
    if (!db) return false;

    const result = db
      .prepare(
        "UPDATE skill_marketplace_installs SET auto_update = ? WHERE skill_id = ?",
      )
      .run(enabled ? 1 : 0, skillId);

    return result.changes > 0;
  }

  async getStats() {
    const db = this.database?.db;
    if (!db) return {};

    const installed = db
      .prepare("SELECT COUNT(*) as count FROM skill_marketplace_installs")
      .get();
    const byCategory = db
      .prepare(
        "SELECT category, COUNT(*) as count FROM skill_marketplace_installs GROUP BY category",
      )
      .all();

    return {
      installedCount: installed?.count || 0,
      byCategory,
    };
  }

  async _getCachedDetails(skillId) {
    const db = this.database?.db;
    if (!db) return null;

    const cached = db
      .prepare("SELECT * FROM skill_marketplace_cache WHERE skill_id = ?")
      .get(skillId);

    if (cached) {
      const now = Math.floor(Date.now() / 1000);
      if (now - cached.cached_at < this.cacheTimeout / 1000) {
        return JSON.parse(cached.details);
      }
    }

    return null;
  }
}

module.exports = {
  SkillMarketplaceClient,
  SkillMarketStatus,
  SkillMarketCategory,
};
