/**
 * EvoMap Asset Bridge
 *
 * Bidirectional sync between ChainlessChain and EvoMap Hub.
 * Handles publish (local → Hub), fetch (Hub → local), and import
 * (fetched assets → skills/instincts).
 *
 * @module evomap/evomap-asset-bridge
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");

/**
 * EvoMapAssetBridge - Bidirectional sync engine
 */
class EvoMapAssetBridge extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.client = null;
    this.nodeManager = null;
    this.synthesizer = null;
    this.skillRegistry = null;
    this.instinctManager = null;
    this.hookSystem = null;
    this.initialized = false;

    this._config = null;
    this._pendingReviews = new Map();
  }

  /**
   * Initialize the asset bridge
   * @param {Object} deps - Dependency injection
   */
  async initialize(deps) {
    if (this.initialized) {
      logger.warn("[EvoMapAssetBridge] Already initialized");
      return;
    }

    this.db = deps.database;
    this.client = deps.client;
    this.nodeManager = deps.nodeManager;
    this.synthesizer = deps.synthesizer;
    this.skillRegistry = deps.skillRegistry || null;
    this.instinctManager = deps.instinctManager || null;
    this.hookSystem = deps.hookSystem || null;

    // Load config
    this._loadConfig();

    // Register hooks for auto-publish
    if (this.hookSystem) {
      this._registerHooks();
    }

    this.initialized = true;
    logger.info("[EvoMapAssetBridge] Initialized");
  }

  /**
   * Update configuration
   * @param {Object} config - EvoMap config
   */
  setConfig(config) {
    this._config = config;
    if (this.synthesizer) {
      this.synthesizer.setConfig(config);
    }
  }

  /**
   * Get current configuration
   * @returns {Object}
   */
  getConfig() {
    return this._config || {};
  }

  // ============================================================
  // PUBLISH Flow
  // ============================================================

  /**
   * Publish a Gene+Capsule+EvolutionEvent bundle to the Hub
   * @param {Object} gene - Gene asset
   * @param {Object} capsule - Capsule asset
   * @param {Object} [evolutionEvent] - EvolutionEvent asset
   * @returns {Promise<Object>} { success, assetIds }
   */
  async publishBundle(gene, capsule, evolutionEvent) {
    const config = this._config || {};
    const privacyConfig = config.privacyFilter || {};

    // Set executor node ID on capsule
    if (capsule && this.nodeManager) {
      capsule.executor_node_id = this.nodeManager.getOrCreateNodeId();
    }

    // Validate locally
    const assets = [gene, capsule];
    if (evolutionEvent) {
      assets.push(evolutionEvent);
    }

    // Check for secrets before publishing
    for (const asset of assets) {
      const content = JSON.stringify(asset);
      if (this.synthesizer && this.synthesizer.containsSecrets(content)) {
        const error = "Content contains potential secrets, publish blocked";
        logger.warn(`[EvoMapAssetBridge] ${error}`);
        return { success: false, error };
      }
    }

    // Dry-run validation
    const validateResult = await this.client.validate(assets);
    if (!validateResult.success) {
      this._logSync("publish", gene.asset_id, "failed", {
        error: validateResult.error,
        phase: "validation",
      });
      return {
        success: false,
        error: `Validation failed: ${validateResult.error}`,
      };
    }

    // Review gate
    if (privacyConfig.requireReview !== false) {
      const reviewId = uuidv4();
      this._pendingReviews.set(reviewId, {
        gene,
        capsule,
        evolutionEvent,
        assets,
      });

      this.emit("publish-review-requested", {
        reviewId,
        gene,
        capsule,
        assetCount: assets.length,
      });

      // Store for later approval
      return {
        success: true,
        pendingReview: true,
        reviewId,
        message: "Publish pending user approval",
      };
    }

    // Direct publish (requireReview is false)
    return await this._executePublish(assets, gene.asset_id);
  }

  /**
   * Approve a pending publish
   * @param {string} reviewId - Review ID from publish-review-requested event
   * @returns {Promise<Object>}
   */
  async approvePublish(reviewId) {
    const pending = this._pendingReviews.get(reviewId);
    if (!pending) {
      return { success: false, error: "Review not found or already processed" };
    }

    this._pendingReviews.delete(reviewId);
    return await this._executePublish(pending.assets, pending.gene.asset_id);
  }

  /**
   * Reject a pending publish
   * @param {string} reviewId
   * @returns {Object}
   */
  rejectPublish(reviewId) {
    const deleted = this._pendingReviews.delete(reviewId);
    return {
      success: deleted,
      message: deleted ? "Publish rejected" : "Review not found",
    };
  }

  /**
   * Execute the actual publish after validation/approval
   * @private
   * @param {Array} assets - Assets to publish
   * @param {string} primaryAssetId - Primary asset ID for logging
   * @returns {Promise<Object>}
   */
  async _executePublish(assets, primaryAssetId) {
    const result = await this.client.publish(assets);

    if (!result.success) {
      this._logSync("publish", primaryAssetId, "failed", {
        error: result.error,
      });
      return result;
    }

    // Store published assets locally
    const now = new Date().toISOString();
    for (const asset of assets) {
      try {
        this.db.run(
          `INSERT OR REPLACE INTO evomap_assets
           (asset_id, type, status, direction, content, summary, created_at, updated_at)
           VALUES (?, ?, 'promoted', 'published', ?, ?, ?, ?)`,
          [
            asset.asset_id,
            asset.type,
            JSON.stringify(asset),
            asset.summary || asset.result_summary || "",
            now,
            now,
          ],
        );
      } catch (err) {
        logger.warn(
          `[EvoMapAssetBridge] Failed to store published asset: ${err.message}`,
        );
      }
    }

    this._logSync("publish", primaryAssetId, "success", {
      asset_ids: assets.map((a) => a.asset_id),
    });

    this.emit("asset-published", {
      assetIds: assets.map((a) => a.asset_id),
      count: assets.length,
    });

    logger.info(`[EvoMapAssetBridge] Published ${assets.length} assets`);

    return {
      success: true,
      data: {
        assetIds: assets.map((a) => a.asset_id),
        count: assets.length,
      },
    };
  }

  /**
   * Publish an instinct by ID
   * @param {string} instinctId - Instinct ID
   * @returns {Promise<Object>}
   */
  async publishInstinct(instinctId) {
    if (!this.instinctManager) {
      return { success: false, error: "InstinctManager not available" };
    }

    // Load instinct from database
    let instinct;
    try {
      instinct = this.db
        .prepare("SELECT * FROM instincts WHERE id = ?")
        .get(instinctId);
    } catch (error) {
      return { success: false, error: `Instinct not found: ${error.message}` };
    }

    if (!instinct) {
      return { success: false, error: "Instinct not found" };
    }

    if (!this.synthesizer) {
      return { success: false, error: "Synthesizer not available" };
    }

    const bundle = this.synthesizer.synthesizeFromInstinct(instinct);
    const result = await this.publishBundle(
      bundle.gene,
      bundle.capsule,
      bundle.evolutionEvent,
    );

    // Link to local source
    if (result.success && !result.pendingReview) {
      this._linkLocalSource(bundle.gene.asset_id, instinctId, "instinct");
    }

    return result;
  }

  /**
   * Publish a decision by ID
   * @param {string} decisionId - Decision record ID
   * @returns {Promise<Object>}
   */
  async publishDecision(decisionId) {
    let decision;
    try {
      decision = this.db
        .prepare("SELECT * FROM decision_records WHERE id = ?")
        .get(decisionId);
    } catch (error) {
      return { success: false, error: `Decision not found: ${error.message}` };
    }

    if (!decision) {
      return { success: false, error: "Decision not found" };
    }

    if (!this.synthesizer) {
      return { success: false, error: "Synthesizer not available" };
    }

    const bundle = this.synthesizer.synthesizeFromDecision(decision);
    const result = await this.publishBundle(
      bundle.gene,
      bundle.capsule,
      bundle.evolutionEvent,
    );

    if (result.success && !result.pendingReview) {
      this._linkLocalSource(bundle.gene.asset_id, decisionId, "decision");
    }

    return result;
  }

  /**
   * Auto-publish eligible instincts and decisions
   * @returns {Promise<Object>} { published, skipped, errors }
   */
  async autoPublishEligible() {
    const config = this._config || {};
    const thresholds = config.publishThresholds || {};
    const minConfidence = thresholds.minInstinctConfidence || 0.7;
    const minSuccessRate = thresholds.minDecisionSuccessRate || 0.7;

    const results = { published: 0, skipped: 0, errors: 0 };

    // Scan eligible instincts
    try {
      const instincts = this.db
        .prepare("SELECT * FROM instincts WHERE confidence >= ?")
        .all(minConfidence);

      for (const instinct of instincts) {
        // Check if already published
        const existing = this.db
          .prepare(
            "SELECT 1 FROM evomap_assets WHERE local_source_id = ? AND local_source_type = 'instinct' AND direction = 'published'",
          )
          .get(instinct.id);

        if (existing) {
          results.skipped++;
          continue;
        }

        try {
          const result = await this.publishInstinct(instinct.id);
          if (result.success) {
            results.published++;
          } else {
            results.errors++;
          }
        } catch (err) {
          logger.warn(
            `[EvoMapAssetBridge] Auto-publish instinct error: ${err.message}`,
          );
          results.errors++;
        }
      }
    } catch (error) {
      logger.warn(
        "[EvoMapAssetBridge] Auto-publish instinct scan error:",
        error.message,
      );
    }

    // Scan eligible decisions
    try {
      const decisions = this.db
        .prepare("SELECT * FROM decision_records WHERE success_rate >= ?")
        .all(minSuccessRate);

      for (const decision of decisions) {
        const existing = this.db
          .prepare(
            "SELECT 1 FROM evomap_assets WHERE local_source_id = ? AND local_source_type = 'decision' AND direction = 'published'",
          )
          .get(decision.id);

        if (existing) {
          results.skipped++;
          continue;
        }

        try {
          const result = await this.publishDecision(decision.id);
          if (result.success) {
            results.published++;
          } else {
            results.errors++;
          }
        } catch (err) {
          logger.warn(
            `[EvoMapAssetBridge] Auto-publish decision error: ${err.message}`,
          );
          results.errors++;
        }
      }
    } catch (error) {
      logger.warn(
        "[EvoMapAssetBridge] Auto-publish decision scan error:",
        error.message,
      );
    }

    logger.info(
      `[EvoMapAssetBridge] Auto-publish complete: ${results.published} published, ${results.skipped} skipped, ${results.errors} errors`,
    );

    return results;
  }

  // ============================================================
  // FETCH Flow
  // ============================================================

  /**
   * Fetch relevant assets from Hub
   * @param {string[]} signals - Signal keywords
   * @param {string} [type] - Asset type filter
   * @returns {Promise<Object>} { assets[] }
   */
  async fetchRelevantAssets(signals, type) {
    const config = this._config || {};
    const limit = config.fetchLimit || 20;

    const result = await this.client.searchAssets(signals, type, "relevance");

    if (!result.success) {
      this._logSync("fetch", null, "failed", { error: result.error });
      return result;
    }

    const assets = result.data?.assets || result.data || [];
    const now = new Date().toISOString();

    // Cache fetched assets locally
    for (const asset of assets) {
      try {
        const existing = this.db
          .prepare("SELECT fetch_count FROM evomap_assets WHERE asset_id = ?")
          .get(asset.asset_id);

        if (existing) {
          this.db.run(
            `UPDATE evomap_assets SET fetch_count = fetch_count + 1, updated_at = ?
             WHERE asset_id = ?`,
            [now, asset.asset_id],
          );
        } else {
          this.db.run(
            `INSERT INTO evomap_assets
             (asset_id, type, status, direction, content, summary, gdi_score, fetch_count, created_at, updated_at)
             VALUES (?, ?, ?, 'fetched', ?, ?, ?, 1, ?, ?)`,
            [
              asset.asset_id,
              asset.type || "Gene",
              asset.status || "promoted",
              JSON.stringify(asset),
              asset.summary || "",
              asset.gdi_score || null,
              now,
              now,
            ],
          );
        }
      } catch (err) {
        logger.warn(
          `[EvoMapAssetBridge] Failed to cache asset: ${err.message}`,
        );
      }
    }

    this._logSync("fetch", null, "success", { count: assets.length, signals });

    this.emit("asset-fetched", { count: assets.length, signals });

    return { success: true, data: { assets: assets.slice(0, limit) } };
  }

  // ============================================================
  // Import Flow
  // ============================================================

  /**
   * Import a fetched Gene as a local skill
   * @param {string} assetId - Asset ID from evomap_assets cache
   * @returns {Promise<Object>}
   */
  async importAsSkill(assetId) {
    const row = this._getLocalAsset(assetId);
    if (!row) {
      return { success: false, error: "Asset not found in local cache" };
    }

    let asset;
    try {
      asset = JSON.parse(row.content);
    } catch (err) {
      return { success: false, error: "Failed to parse cached asset" };
    }

    if (asset.type !== "Gene") {
      return {
        success: false,
        error: "Only Gene assets can be imported as skills",
      };
    }

    // Convert Gene → SKILL.md format
    const strategy = asset.strategy || {};
    const skillName = (asset.summary || "imported-gene")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .substring(0, 50);

    const skillContent = [
      "---",
      `name: ${skillName}`,
      `version: 1.0.0`,
      `description: "${(asset.summary || "").replace(/"/g, '\\"')}"`,
      `author: evomap-community`,
      `tags: [evomap, ${asset.category || "general"}]`,
      "---",
      "",
      `# ${asset.summary || skillName}`,
      "",
      strategy.description || "",
      "",
      strategy.instructions || "",
    ].join("\n");

    // Save to managed skills directory
    try {
      const { app } = require("electron");
      const skillsDir = path.join(
        app.getPath("userData"),
        ".chainlesschain",
        "skills",
      );
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
      }

      const skillPath = path.join(skillsDir, `${skillName}.md`);
      fs.writeFileSync(skillPath, skillContent, "utf8");

      // Update local asset status
      this.db.run(
        `UPDATE evomap_assets SET status = 'imported', updated_at = ? WHERE asset_id = ?`,
        [new Date().toISOString(), assetId],
      );

      this._logSync("import", assetId, "success", {
        type: "skill",
        path: skillPath,
      });
      this.emit("import-completed", { assetId, type: "skill", skillName });

      logger.info(`[EvoMapAssetBridge] Imported Gene as skill: ${skillName}`);

      return { success: true, data: { skillName, skillPath } };
    } catch (error) {
      logger.error(
        `[EvoMapAssetBridge] Import as skill failed: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Import a fetched Capsule as a local instinct
   * @param {string} capsuleAssetId - Asset ID
   * @returns {Promise<Object>}
   */
  async importAsInstinct(capsuleAssetId) {
    if (!this.instinctManager) {
      return { success: false, error: "InstinctManager not available" };
    }

    const row = this._getLocalAsset(capsuleAssetId);
    if (!row) {
      return { success: false, error: "Asset not found in local cache" };
    }

    let asset;
    try {
      asset = JSON.parse(row.content);
    } catch (err) {
      return { success: false, error: "Failed to parse cached asset" };
    }

    try {
      const instinct = this.instinctManager.addInstinct(
        asset.result_summary || asset.summary || "Imported from EvoMap",
        Math.min(asset.confidence || 0.5, 0.7), // cap imported confidence
        "general",
        {
          source: "evomap-import",
          examples: asset.signals_observed || [],
        },
      );

      this.db.run(
        `UPDATE evomap_assets SET status = 'imported', updated_at = ? WHERE asset_id = ?`,
        [new Date().toISOString(), capsuleAssetId],
      );

      this._logSync("import", capsuleAssetId, "success", {
        type: "instinct",
        instinctId: instinct?.id,
      });
      this.emit("import-completed", {
        assetId: capsuleAssetId,
        type: "instinct",
      });

      logger.info(`[EvoMapAssetBridge] Imported Capsule as instinct`);

      return { success: true, data: { instinctId: instinct?.id } };
    } catch (error) {
      logger.error(
        `[EvoMapAssetBridge] Import as instinct failed: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Context Building (for LLM injection)
  // ============================================================

  /**
   * Build EvoMap context string for LLM prompt injection
   * @param {string} taskHint - Task description or keywords
   * @param {number} [limit=3] - Max assets to include
   * @returns {string|null} Markdown context block or null
   */
  buildEvoMapContext(taskHint, limit = 3) {
    if (!taskHint || !this.db) {
      return null;
    }

    try {
      // Extract keywords from task hint
      const keywords = taskHint
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3);

      if (keywords.length === 0) {
        return null;
      }

      // Search fetched assets matching keywords
      const allFetched = this.db
        .prepare(
          "SELECT asset_id, type, summary, content, gdi_score FROM evomap_assets WHERE direction = 'fetched' ORDER BY gdi_score DESC, updated_at DESC LIMIT 50",
        )
        .all();

      const scored = allFetched
        .map((row) => {
          const text =
            `${row.summary || ""} ${row.content || ""}`.toLowerCase();
          const matchCount = keywords.filter((kw) => text.includes(kw)).length;
          return { ...row, matchCount };
        })
        .filter((r) => r.matchCount > 0)
        .sort(
          (a, b) =>
            b.matchCount - a.matchCount ||
            (b.gdi_score || 0) - (a.gdi_score || 0),
        )
        .slice(0, limit);

      if (scored.length === 0) {
        return null;
      }

      const lines = [
        "## EvoMap Community Knowledge",
        "",
        "The following strategies have been validated by the global agent community:",
        "",
      ];

      for (const asset of scored) {
        lines.push(`- **[${asset.type}]** ${asset.summary || asset.asset_id}`);
        try {
          const parsed = JSON.parse(asset.content);
          if (parsed.strategy?.description) {
            lines.push(`  ${parsed.strategy.description.substring(0, 200)}`);
          }
        } catch (_e) {
          // skip
        }
        lines.push("");
      }

      return lines.join("\n");
    } catch (error) {
      logger.warn(
        "[EvoMapAssetBridge] buildEvoMapContext error:",
        error.message,
      );
      return null;
    }
  }

  // ============================================================
  // Local Asset Queries
  // ============================================================

  /**
   * Get local assets with optional filters
   * @param {Object} [filters] - { direction, type, status, limit }
   * @returns {Array}
   */
  getLocalAssets(filters = {}) {
    try {
      let sql = "SELECT * FROM evomap_assets WHERE 1=1";
      const params = [];

      if (filters.direction) {
        sql += " AND direction = ?";
        params.push(filters.direction);
      }
      if (filters.type) {
        sql += " AND type = ?";
        params.push(filters.type);
      }
      if (filters.status) {
        sql += " AND status = ?";
        params.push(filters.status);
      }

      sql += " ORDER BY updated_at DESC";

      if (filters.limit) {
        sql += " LIMIT ?";
        params.push(filters.limit);
      }

      return this.db.prepare(sql).all(...params);
    } catch (error) {
      logger.warn("[EvoMapAssetBridge] getLocalAssets error:", error.message);
      return [];
    }
  }

  /**
   * Get sync log entries
   * @param {number} [limit=50]
   * @returns {Array}
   */
  getSyncLog(limit = 50) {
    try {
      return this.db
        .prepare(
          "SELECT * FROM evomap_sync_log ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit);
    } catch (error) {
      logger.warn("[EvoMapAssetBridge] getSyncLog error:", error.message);
      return [];
    }
  }

  // ============================================================
  // Hooks Integration
  // ============================================================

  /**
   * Register hooks for auto-publish triggers
   * @private
   */
  _registerHooks() {
    if (!this.hookSystem) {
      return;
    }

    try {
      // Monitor successful orchestrate completions
      this.hookSystem.register({
        event: "PostToolUse",
        type: "Async",
        priority: 1000, // MONITOR priority
        handler: async (context) => {
          const config = this._config || {};
          if (!config.autoPublish) {
            return;
          }

          // Check for orchestrate success
          if (
            context.toolName === "orchestrate" &&
            context.result?.success &&
            context.result?.verdict === "READY"
          ) {
            try {
              await this.autoPublishEligible();
            } catch (err) {
              logger.warn(
                "[EvoMapAssetBridge] Auto-publish hook error:",
                err.message,
              );
            }
          }
        },
      });

      logger.info("[EvoMapAssetBridge] Hooks registered");
    } catch (error) {
      logger.warn(
        "[EvoMapAssetBridge] Hook registration failed:",
        error.message,
      );
    }
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  /**
   * Get a local asset by ID
   * @private
   * @param {string} assetId
   * @returns {Object|null}
   */
  _getLocalAsset(assetId) {
    try {
      return this.db
        .prepare("SELECT * FROM evomap_assets WHERE asset_id = ?")
        .get(assetId);
    } catch (_e) {
      return null;
    }
  }

  /**
   * Link a local source to an EvoMap asset
   * @private
   * @param {string} assetId
   * @param {string} sourceId
   * @param {string} sourceType
   */
  _linkLocalSource(assetId, sourceId, sourceType) {
    try {
      this.db.run(
        `UPDATE evomap_assets SET local_source_id = ?, local_source_type = ? WHERE asset_id = ?`,
        [sourceId, sourceType, assetId],
      );
    } catch (_e) {
      // non-critical
    }
  }

  /**
   * Log a sync action
   * @private
   * @param {string} action
   * @param {string|null} assetId
   * @param {string} status
   * @param {Object} details
   */
  _logSync(action, assetId, status, details = {}) {
    try {
      this.db.run(
        `INSERT INTO evomap_sync_log (id, action, asset_id, status, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          action,
          assetId,
          status,
          JSON.stringify(details),
          new Date().toISOString(),
        ],
      );
    } catch (_e) {
      // non-critical
    }
  }

  /**
   * Load config from unified config manager
   * @private
   */
  _loadConfig() {
    try {
      const {
        getUnifiedConfigManager,
      } = require("../config/unified-config-manager.js");
      const configManager = getUnifiedConfigManager();
      this._config = configManager.get("evomap") || {};
    } catch (_e) {
      this._config = {};
    }

    if (this.synthesizer) {
      this.synthesizer.setConfig(this._config);
    }
  }
}

// ==================== Singleton Support ====================

let _instance = null;

/**
 * Get or create a singleton EvoMapAssetBridge instance
 * @returns {EvoMapAssetBridge}
 */
function getEvoMapAssetBridge() {
  if (!_instance) {
    _instance = new EvoMapAssetBridge();
  }
  return _instance;
}

module.exports = {
  EvoMapAssetBridge,
  getEvoMapAssetBridge,
};
