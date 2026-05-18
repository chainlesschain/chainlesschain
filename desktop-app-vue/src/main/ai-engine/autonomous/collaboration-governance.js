/**
 * Collaboration Governance (v3.0.0)
 *
 * Human-AI collaboration governance:
 * - Decision approval gateway (architecture/migration/security require human OK)
 * - Operation replay and audit trail
 * - Confidence-based gating (low confidence -> pause)
 * - Progressive autonomy (expand AI scope based on track record, levels 0-10)
 *
 * @module ai-engine/autonomous/collaboration-governance
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const DECISION_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  AUTO_APPROVED: "auto_approved",
  EXPIRED: "expired",
};

const DECISION_TYPES = {
  ARCHITECTURE: "architecture",
  MIGRATION: "migration",
  SECURITY: "security",
  DEPLOYMENT: "deployment",
  DATA: "data",
  GENERAL: "general",
};

const AUTONOMY_LEVELS = {
  NONE: 0,
  MINIMAL: 2,
  LOW: 4,
  MEDIUM: 6,
  HIGH: 8,
  FULL: 10,
};

class CollaborationGovernance extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._decisions = new Map();
    this._autonomyLevels = new Map();
    this._confidenceThreshold = 0.7;
    this._autoApproveAbove = 0.95;
    this._initialAutonomyLevel = 2;
    this._maxAutonomyLevel = 10;
    this._requireApprovalFor = [
      DECISION_TYPES.ARCHITECTURE,
      DECISION_TYPES.MIGRATION,
      DECISION_TYPES.SECURITY,
    ];
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS governance_decisions (
        id TEXT PRIMARY KEY,
        decision_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        confidence REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        context TEXT,
        proposed_action TEXT,
        reviewer TEXT,
        review_comment TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        reviewed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_gov_decisions_status ON governance_decisions(status);
      CREATE INDEX IF NOT EXISTS idx_gov_decisions_type ON governance_decisions(decision_type);

      CREATE TABLE IF NOT EXISTS autonomy_levels (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        level INTEGER DEFAULT 2,
        total_decisions INTEGER DEFAULT 0,
        approved_decisions INTEGER DEFAULT 0,
        rejected_decisions INTEGER DEFAULT 0,
        track_record REAL DEFAULT 0,
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_autonomy_levels_scope ON autonomy_levels(scope);
    `);
  }

  async initialize() {
    logger.info("[CollaborationGovernance] Initializing...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const decisions = this.database.db
          .prepare(
            "SELECT * FROM governance_decisions WHERE status = 'pending' ORDER BY created_at DESC",
          )
          .all();
        for (const d of decisions) {
          this._decisions.set(d.id, {
            ...d,
            context: d.context ? JSON.parse(d.context) : {},
          });
        }

        const levels = this.database.db
          .prepare("SELECT * FROM autonomy_levels")
          .all();
        for (const l of levels) {
          this._autonomyLevels.set(l.scope, l);
        }

        logger.info(
          `[CollaborationGovernance] Loaded ${decisions.length} pending decisions, ${levels.length} autonomy levels`,
        );
      } catch (err) {
        logger.error("[CollaborationGovernance] Failed to load:", err);
      }
    }

    this.initialized = true;
    logger.info("[CollaborationGovernance] Initialized");
  }

  async submitDecision({
    decisionType,
    title,
    description,
    confidence,
    context,
    proposedAction,
  } = {}) {
    if (!title) {
      throw new Error("Decision title is required");
    }

    const type = decisionType || DECISION_TYPES.GENERAL;
    const conf = confidence || 0;
    const id = uuidv4();
    const now = Date.now();

    // Check if auto-approval is possible
    let status = DECISION_STATUS.PENDING;
    if (
      conf >= this._autoApproveAbove &&
      !this._requireApprovalFor.includes(type)
    ) {
      status = DECISION_STATUS.AUTO_APPROVED;
    } else if (conf < this._confidenceThreshold) {
      // Low confidence - always requires human review
      status = DECISION_STATUS.PENDING;
    }

    const decision = {
      id,
      decision_type: type,
      title,
      description: description || "",
      confidence: conf,
      status,
      context: context || {},
      proposed_action: proposedAction || "",
      reviewer: null,
      review_comment: null,
      created_at: now,
      reviewed_at: status === DECISION_STATUS.AUTO_APPROVED ? now : null,
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO governance_decisions (id, decision_type, title, description, confidence, status, context, proposed_action, created_at, reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          type,
          title,
          decision.description,
          conf,
          status,
          JSON.stringify(decision.context),
          decision.proposed_action,
          now,
          decision.reviewed_at,
        );
    }

    this._decisions.set(id, decision);
    this.emit("decision-submitted", decision);
    return decision;
  }

  async getPendingDecisions(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM governance_decisions WHERE status = 'pending'";
        const params = [];
        if (filter.decisionType) {
          sql += " AND decision_type = ?";
          params.push(filter.decisionType);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        const rows = this.database.db.prepare(sql).all(...params);
        return rows.map((r) => ({
          ...r,
          context: r.context ? JSON.parse(r.context) : {},
        }));
      } catch (err) {
        logger.error("[CollaborationGovernance] Failed to get pending:", err);
      }
    }
    return Array.from(this._decisions.values())
      .filter((d) => d.status === DECISION_STATUS.PENDING)
      .slice(0, filter.limit || 50);
  }

  async approveDecision({ decisionId, reviewer, comment } = {}) {
    if (!decisionId) {
      throw new Error("Decision ID is required");
    }

    const decision = this._decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }
    if (decision.status !== DECISION_STATUS.PENDING) {
      throw new Error(`Decision is not pending: ${decision.status}`);
    }

    decision.status = DECISION_STATUS.APPROVED;
    decision.reviewer = reviewer || "human";
    decision.review_comment = comment || "";
    decision.reviewed_at = Date.now();

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          "UPDATE governance_decisions SET status = ?, reviewer = ?, review_comment = ?, reviewed_at = ? WHERE id = ?",
        )
        .run(
          decision.status,
          decision.reviewer,
          decision.review_comment,
          decision.reviewed_at,
          decisionId,
        );
    }

    // Update autonomy tracking
    this._updateAutonomyTracking(decision.decision_type, true);

    this.emit("decision-approved", decision);
    logger.info(
      `[CollaborationGovernance] Decision approved: ${decision.title}`,
    );
    return decision;
  }

  async rejectDecision({ decisionId, reviewer, comment } = {}) {
    if (!decisionId) {
      throw new Error("Decision ID is required");
    }

    const decision = this._decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }
    if (decision.status !== DECISION_STATUS.PENDING) {
      throw new Error(`Decision is not pending: ${decision.status}`);
    }

    decision.status = DECISION_STATUS.REJECTED;
    decision.reviewer = reviewer || "human";
    decision.review_comment = comment || "";
    decision.reviewed_at = Date.now();

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          "UPDATE governance_decisions SET status = ?, reviewer = ?, review_comment = ?, reviewed_at = ? WHERE id = ?",
        )
        .run(
          decision.status,
          decision.reviewer,
          decision.review_comment,
          decision.reviewed_at,
          decisionId,
        );
    }

    this._updateAutonomyTracking(decision.decision_type, false);

    this.emit("decision-rejected", decision);
    logger.info(
      `[CollaborationGovernance] Decision rejected: ${decision.title}`,
    );
    return decision;
  }

  async getAutonomyLevel(scope) {
    const s = scope || "global";
    const level = this._autonomyLevels.get(s);
    if (level) {
      return level;
    }

    return {
      scope: s,
      level: this._initialAutonomyLevel,
      total_decisions: 0,
      approved_decisions: 0,
      rejected_decisions: 0,
      track_record: 0,
    };
  }

  async setAutonomyPolicy({ scope, level, requireApprovalFor } = {}) {
    if (level !== undefined) {
      if (level < 0 || level > this._maxAutonomyLevel) {
        throw new Error(
          `Autonomy level must be between 0 and ${this._maxAutonomyLevel}`,
        );
      }
    }

    const s = scope || "global";
    const existing = this._autonomyLevels.get(s) || {
      id: uuidv4(),
      scope: s,
      total_decisions: 0,
      approved_decisions: 0,
      rejected_decisions: 0,
      track_record: 0,
    };

    if (level !== undefined) {
      existing.level = level;
    }
    existing.updated_at = Date.now();

    if (requireApprovalFor) {
      this._requireApprovalFor = requireApprovalFor;
    }

    this._autonomyLevels.set(s, existing);

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT OR REPLACE INTO autonomy_levels (id, scope, level, total_decisions, approved_decisions, rejected_decisions, track_record, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          existing.id,
          s,
          existing.level,
          existing.total_decisions,
          existing.approved_decisions,
          existing.rejected_decisions,
          existing.track_record,
          existing.updated_at,
        );
    }

    this.emit("policy-updated", existing);
    return existing;
  }

  _updateAutonomyTracking(scope, approved) {
    const s = scope || "global";
    let level = this._autonomyLevels.get(s);
    if (!level) {
      level = {
        id: uuidv4(),
        scope: s,
        level: this._initialAutonomyLevel,
        total_decisions: 0,
        approved_decisions: 0,
        rejected_decisions: 0,
        track_record: 0,
      };
    }

    level.total_decisions++;
    if (approved) {
      level.approved_decisions++;
    } else {
      level.rejected_decisions++;
    }

    level.track_record =
      level.total_decisions > 0
        ? level.approved_decisions / level.total_decisions
        : 0;

    // Progressive autonomy: increase level if track record is good
    if (
      level.total_decisions >= 10 &&
      level.track_record > 0.9 &&
      level.level < this._maxAutonomyLevel
    ) {
      level.level = Math.min(level.level + 1, this._maxAutonomyLevel);
    }

    level.updated_at = Date.now();
    this._autonomyLevels.set(s, level);
  }

  async close() {
    this.removeAllListeners();
    this._decisions.clear();
    this._autonomyLevels.clear();
    this.initialized = false;
    logger.info("[CollaborationGovernance] Closed");
  }
}

let _instance = null;

function getCollaborationGovernance(database) {
  if (!_instance) {
    _instance = new CollaborationGovernance(database);
  }
  return _instance;
}

export {
  CollaborationGovernance,
  getCollaborationGovernance,
  DECISION_STATUS,
  DECISION_TYPES,
  AUTONOMY_LEVELS,
};
export default CollaborationGovernance;
