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
const { types: utilTypes } = require("node:util");
const {
  isDesktopGovernedSkillMarketplaceHost,
} = require("./governed-skill-marketplace-host");
const GOVERNED_HOSTS = new WeakMap();

function requestOptions(value, keys) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("governed marketplace request must be a plain object");
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !keys.includes(key) ||
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    ) {
      throw new TypeError(
        "governed marketplace request contains unsupported fields",
      );
    }
  }
  return value;
}

function legacyRecord(value) {
  return {
    ...value,
    installed: false,
    activated: false,
    materialized: false,
    status: "unverified",
    source: "legacy-local",
  };
}

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
  constructor({ database, skillRegistry, governedHost = null }) {
    super();

    this.database = database;
    this.skillRegistry = skillRegistry;
    if (
      governedHost !== null &&
      !isDesktopGovernedSkillMarketplaceHost(governedHost)
    ) {
      throw new TypeError("a branded Desktop marketplace host is required");
    }
    GOVERNED_HOSTS.set(this, governedHost);
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
    if (!db) {
      return;
    }

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
    if (GOVERNED_HOSTS.get(this)) {
      return this.inspectSkill(skillId);
    }
    const cached = await this._getCachedDetails(skillId);
    if (cached) {
      return legacyRecord(cached);
    }

    const db = this.database?.db;
    if (!db) {
      return null;
    }

    const install = db
      .prepare("SELECT * FROM skill_marketplace_installs WHERE skill_id = ?")
      .get(skillId);

    if (install) {
      return legacyRecord(install);
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

  _governedHost() {
    const host = GOVERNED_HOSTS.get(this);
    if (!host) {
      const error = new Error(
        "Governed Skill marketplace is unavailable: configure a signed Desktop deployment",
      );
      error.code = "CC_GOVERNED_MARKETPLACE_UNAVAILABLE";
      throw error;
    }
    return host;
  }

  getGovernanceStatus() {
    const host = GOVERNED_HOSTS.get(this);
    return host
      ? { available: true, tenantId: host.tenantId, target: host.target }
      : { available: false };
  }

  async inspectSkill(skillId, version = null) {
    return this._governedHost().inspect({ skillName: skillId, version });
  }

  async getGovernedState(skillId) {
    return this._governedHost().state({ skillName: skillId });
  }

  async installSkill(skillId, options = {}) {
    const host = this._governedHost();
    requestOptions(options, [
      "version",
      "manifestDigest",
      "expectedStateDigest",
    ]);
    const result = await host.install({
      skillName: skillId,
      version: options.version ?? null,
      manifestDigest: options.manifestDigest,
      expectedStateDigest: options.expectedStateDigest ?? null,
    });
    this.emit("skill-candidate-staged", {
      skillId,
      stateDigest: result.state.stateDigest,
    });
    return result;
  }

  async updateSkill(skillId, options = {}) {
    requestOptions(options, [
      "version",
      "manifestDigest",
      "expectedStateDigest",
    ]);
    if (!options.version || !options.expectedStateDigest) {
      throw new TypeError(
        "governed update requires an exact version and state digest",
      );
    }
    return this.installSkill(skillId, options);
  }

  async rolloutSkill(skillId, options = {}) {
    const host = this._governedHost();
    requestOptions(options, ["expectedStateDigest", "receiptRef"]);
    const state = await host.rollout({ skillName: skillId, ...options });
    this.emit("skill-rollout-advanced", {
      skillId,
      stage: state.stage,
      stateDigest: state.stateDigest,
    });
    return state;
  }

  async uninstallSkill(skillId, options = {}) {
    const host = this._governedHost();
    requestOptions(options, ["expectedStateDigest", "receiptRef"]);
    const state = await host.revoke({ skillName: skillId, ...options });
    this.emit("skill-revoked", { skillId, stateDigest: state.stateDigest });
    return state;
  }

  async rateSkill(skillId, rating, review = "") {
    // Number.isFinite first — a NaN rating slips past `rating < 1 || rating > 5`
    // (NaN comparisons are always false) and would propagate into the
    // skill-rated event / any rating average.
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
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
    const host = GOVERNED_HOSTS.get(this);
    if (host) {
      const { items, total } = await host.list({ offset: 0, limit: 500 });
      if (total > 500) {
        throw new Error(
          "marketplace catalog exceeds the Desktop list limit; use paginated host access",
        );
      }
      return items.map((state) => ({
        id: state.skillName,
        skill_id: state.skillName,
        name: state.skillName,
        version: state.version,
        status: state.stage,
        installed: state.stage === "active" && !state.revoked,
        activated: state.stage === "active" && !state.revoked,
        materialized: Boolean(state.candidateBinding) && !state.revoked,
        stateDigest: state.stateDigest,
        source: "governed-ledger",
      }));
    }
    const db = this.database?.db;
    if (!db) {
      return [];
    }

    return db
      .prepare(
        "SELECT * FROM skill_marketplace_installs ORDER BY installed_at DESC",
      )
      .all()
      .map(legacyRecord);
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
    if (enabled) {
      throw new Error(
        "Automatic activation is unavailable: each update requires verified Pilot stages",
      );
    }
    const db = this.database?.db;
    if (!db) {
      return false;
    }

    const result = db
      .prepare(
        "UPDATE skill_marketplace_installs SET auto_update = ? WHERE skill_id = ?",
      )
      .run(enabled ? 1 : 0, skillId);

    return result.changes > 0;
  }

  async getStats() {
    if (GOVERNED_HOSTS.get(this)) {
      const items = await this.getInstalled();
      return {
        installedCount: items.filter((item) => item.activated).length,
        candidateCount: items.filter((item) => item.status === "candidate")
          .length,
        governedCount: items.length,
        byCategory: [],
      };
    }
    const db = this.database?.db;
    if (!db) {
      return {};
    }

    const installed = db
      .prepare("SELECT COUNT(*) as count FROM skill_marketplace_installs")
      .get();
    const byCategory = db
      .prepare(
        "SELECT category, COUNT(*) as count FROM skill_marketplace_installs GROUP BY category",
      )
      .all();

    return {
      installedCount: 0,
      unverifiedCount: installed?.count || 0,
      byCategory,
    };
  }

  async _getCachedDetails(skillId) {
    const db = this.database?.db;
    if (!db) {
      return null;
    }

    const cached = db
      .prepare("SELECT * FROM skill_marketplace_cache WHERE skill_id = ?")
      .get(skillId);

    if (cached) {
      const now = Math.floor(Date.now() / 1000);
      if (now - cached.cached_at < this.cacheTimeout / 1000) {
        // A corrupt cached details value must not throw out of the cache read —
        // treat it as a miss and fall through to a fresh fetch.
        try {
          return JSON.parse(cached.details);
        } catch {
          return null;
        }
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
