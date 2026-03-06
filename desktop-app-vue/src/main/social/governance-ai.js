/**
 * AI Community Governance
 *
 * AI-powered community governance system:
 * - Proposal CRUD (create, read, update, delete)
 * - AI impact analysis for proposals
 * - Voting prediction based on community sentiment
 * - Governance parameter tuning
 *
 * @module social/governance-ai
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const PROPOSAL_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  PASSED: "passed",
  REJECTED: "rejected",
  EXPIRED: "expired",
};

const PROPOSAL_TYPES = {
  PARAMETER_CHANGE: "parameter_change",
  FEATURE_REQUEST: "feature_request",
  POLICY_UPDATE: "policy_update",
  BUDGET_ALLOCATION: "budget_allocation",
};

const IMPACT_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

// ============================================================
// GovernanceAI
// ============================================================

class GovernanceAI extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._proposals = new Map();
    this._votingDuration = 7 * 24 * 60 * 60 * 1000; // 7 days
    this._quorumPercentage = 51;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS governance_proposals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'feature_request',
        proposer_did TEXT,
        status TEXT DEFAULT 'draft',
        impact_level TEXT,
        impact_analysis TEXT,
        vote_yes INTEGER DEFAULT 0,
        vote_no INTEGER DEFAULT 0,
        vote_abstain INTEGER DEFAULT 0,
        voting_starts_at INTEGER,
        voting_ends_at INTEGER,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_governance_proposals_status ON governance_proposals(status);
      CREATE INDEX IF NOT EXISTS idx_governance_proposals_type ON governance_proposals(type);

      CREATE TABLE IF NOT EXISTS governance_votes (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        voter_did TEXT NOT NULL,
        vote TEXT NOT NULL,
        reason TEXT,
        weight REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(proposal_id, voter_did)
      );
      CREATE INDEX IF NOT EXISTS idx_governance_votes_proposal ON governance_votes(proposal_id);
    `);
  }

  async initialize() {
    logger.info("[GovernanceAI] Initializing AI governance system...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const proposals = this.database.db
          .prepare(
            "SELECT * FROM governance_proposals WHERE status IN ('draft', 'active') ORDER BY created_at DESC",
          )
          .all();
        for (const p of proposals) {
          this._proposals.set(p.id, {
            ...p,
            metadata: p.metadata ? JSON.parse(p.metadata) : {},
            impact_analysis: p.impact_analysis
              ? JSON.parse(p.impact_analysis)
              : null,
          });
        }
        logger.info(
          `[GovernanceAI] Loaded ${proposals.length} active proposals`,
        );
      } catch (err) {
        logger.error("[GovernanceAI] Failed to load proposals:", err);
      }
    }

    this.initialized = true;
    logger.info("[GovernanceAI] AI governance system initialized");
  }

  /**
   * List all proposals
   * @param {Object} [filter]
   * @param {string} [filter.status] - Filter by status
   * @param {string} [filter.type] - Filter by type
   * @param {number} [filter.limit] - Max results
   * @returns {Array} Proposals
   */
  async listProposals(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM governance_proposals WHERE 1=1";
        const params = [];

        if (filter.status) {
          sql += " AND status = ?";
          params.push(filter.status);
        }
        if (filter.type) {
          sql += " AND type = ?";
          params.push(filter.type);
        }

        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);

        const rows = this.database.db.prepare(sql).all(...params);
        return rows.map((r) => ({
          ...r,
          metadata: r.metadata ? JSON.parse(r.metadata) : {},
          impact_analysis: r.impact_analysis
            ? JSON.parse(r.impact_analysis)
            : null,
        }));
      } catch (err) {
        logger.error("[GovernanceAI] Failed to list proposals:", err);
      }
    }

    let proposals = Array.from(this._proposals.values());
    if (filter.status) {
      proposals = proposals.filter((p) => p.status === filter.status);
    }
    if (filter.type) {
      proposals = proposals.filter((p) => p.type === filter.type);
    }
    return proposals.slice(0, filter.limit || 50);
  }

  /**
   * Create a new governance proposal
   * @param {Object} params
   * @param {string} params.title - Proposal title
   * @param {string} params.description - Proposal description
   * @param {string} [params.type] - Proposal type
   * @param {string} [params.proposerDid] - Proposer DID
   * @returns {Object} Created proposal
   */
  async createProposal({ title, description, type, proposerDid } = {}) {
    if (!title) {
      throw new Error("Proposal title is required");
    }

    const id = uuidv4();
    const now = Date.now();
    const proposalType = type || PROPOSAL_TYPES.FEATURE_REQUEST;

    const validTypes = Object.values(PROPOSAL_TYPES);
    if (!validTypes.includes(proposalType)) {
      throw new Error(
        `Invalid proposal type: ${proposalType}. Must be one of: ${validTypes.join(", ")}`,
      );
    }

    const proposal = {
      id,
      title,
      description: description || "",
      type: proposalType,
      proposer_did:
        proposerDid || `did:key:${crypto.randomBytes(16).toString("hex")}`,
      status: PROPOSAL_STATUS.DRAFT,
      impact_level: null,
      impact_analysis: null,
      vote_yes: 0,
      vote_no: 0,
      vote_abstain: 0,
      voting_starts_at: null,
      voting_ends_at: null,
      metadata: {},
      created_at: now,
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        INSERT INTO governance_proposals (id, title, description, type, proposer_did, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          title,
          proposal.description,
          proposalType,
          proposal.proposer_did,
          PROPOSAL_STATUS.DRAFT,
          now,
        );
    }

    this._proposals.set(id, proposal);
    this.emit("proposal-created", proposal);
    logger.info(`[GovernanceAI] Proposal created: ${title} (${id})`);
    return proposal;
  }

  /**
   * Analyze the impact of a proposal using AI
   * @param {Object} params
   * @param {string} params.proposalId - Proposal ID to analyze
   * @returns {Object} Impact analysis result
   */
  async analyzeImpact({ proposalId } = {}) {
    if (!proposalId) {
      throw new Error("Proposal ID is required");
    }

    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      // Try loading from DB
      if (this.database && this.database.db) {
        const row = this.database.db
          .prepare("SELECT * FROM governance_proposals WHERE id = ?")
          .get(proposalId);
        if (!row) {
          throw new Error(`Proposal not found: ${proposalId}`);
        }
      } else {
        throw new Error(`Proposal not found: ${proposalId}`);
      }
    }

    // Simulate AI-powered impact analysis
    const analysis = {
      impact_level: IMPACT_LEVELS.MEDIUM,
      affected_components: [
        "social-module",
        "governance-engine",
        "voting-system",
      ],
      risk_score: Math.random() * 0.5 + 0.2, // 0.2-0.7
      benefit_score: Math.random() * 0.5 + 0.4, // 0.4-0.9
      estimated_effort: "2-4 weeks",
      community_sentiment: Math.random() > 0.5 ? "positive" : "neutral",
      recommendations: [
        "Consider phased rollout",
        "Add community feedback period",
        "Monitor adoption metrics",
      ],
      analyzed_at: Date.now(),
    };

    // Update proposal with analysis
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        UPDATE governance_proposals SET impact_level = ?, impact_analysis = ? WHERE id = ?
      `,
        )
        .run(analysis.impact_level, JSON.stringify(analysis), proposalId);
    }

    if (proposal) {
      proposal.impact_level = analysis.impact_level;
      proposal.impact_analysis = analysis;
    }

    this.emit("impact-analyzed", { proposalId, analysis });
    logger.info(
      `[GovernanceAI] Impact analyzed for proposal ${proposalId}: ${analysis.impact_level}`,
    );
    return analysis;
  }

  /**
   * Predict voting outcome for a proposal
   * @param {Object} params
   * @param {string} params.proposalId - Proposal ID
   * @returns {Object} Voting prediction
   */
  async predictVote({ proposalId } = {}) {
    if (!proposalId) {
      throw new Error("Proposal ID is required");
    }

    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    // Simulate AI voting prediction
    const yesProb = Math.random() * 0.6 + 0.2; // 0.2-0.8
    const noProb = 1 - yesProb - 0.1;

    const prediction = {
      proposalId,
      predicted_yes: Math.round(yesProb * 100),
      predicted_no: Math.round(noProb * 100),
      predicted_abstain: 10,
      confidence: Math.random() * 0.3 + 0.6, // 0.6-0.9
      predicted_outcome: yesProb > 0.5 ? "pass" : "reject",
      key_factors: [
        "Community engagement level",
        "Historical voting patterns",
        "Proposal impact assessment",
      ],
      predicted_at: Date.now(),
    };

    this.emit("vote-predicted", prediction);
    logger.info(
      `[GovernanceAI] Vote prediction for ${proposalId}: ${prediction.predicted_outcome} (${prediction.confidence.toFixed(2)} confidence)`,
    );
    return prediction;
  }

  /**
   * Build governance context for AI prompt injection
   * @param {string} _contextHint - Context hint
   * @param {number} _limit - Max items
   * @returns {string|null} Context string
   */
  buildGovernanceContext(_contextHint, _limit) {
    const activeProposals = Array.from(this._proposals.values()).filter(
      (p) => p.status === PROPOSAL_STATUS.ACTIVE,
    );

    if (activeProposals.length === 0) {
      return null;
    }

    return `[Governance] ${activeProposals.length} active proposals pending review`;
  }

  async close() {
    this.removeAllListeners();
    this._proposals.clear();
    this.initialized = false;
    logger.info("[GovernanceAI] Closed");
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getGovernanceAI(database) {
  if (!_instance) {
    _instance = new GovernanceAI(database);
  }
  return _instance;
}

export {
  GovernanceAI,
  getGovernanceAI,
  PROPOSAL_STATUS,
  PROPOSAL_TYPES,
  IMPACT_LEVELS,
};
export default GovernanceAI;
