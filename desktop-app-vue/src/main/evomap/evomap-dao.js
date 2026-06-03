/**
 * EvoMap DAO
 * Gene quality voting, dispute arbitration, standard proposals
 * @module evomap/evomap-dao
 * @version 3.4.0
 */
import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const PROPOSAL_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  PASSED: "passed",
  REJECTED: "rejected",
  EXECUTED: "executed",
};

class EvoMapDAO extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._proposals = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS evomap_governance_proposals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        proposer_did TEXT,
        type TEXT DEFAULT 'standard',
        status TEXT DEFAULT 'draft',
        votes_for INTEGER DEFAULT 0,
        votes_against INTEGER DEFAULT 0,
        quorum_reached INTEGER DEFAULT 0,
        voting_deadline INTEGER,
        executed_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_evomap_gov_status ON evomap_governance_proposals(status);
      CREATE INDEX IF NOT EXISTS idx_evomap_gov_proposer ON evomap_governance_proposals(proposer_did);
    `);
  }

  async initialize() {
    logger.info("[EvoMapDAO] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const proposals = this.database.db
          .prepare(
            "SELECT * FROM evomap_governance_proposals WHERE status IN ('draft','active') ORDER BY created_at DESC",
          )
          .all();
        for (const p of proposals) {
          this._proposals.set(p.id, p);
        }
        logger.info(`[EvoMapDAO] Loaded ${proposals.length} proposals`);
      } catch (err) {
        logger.error("[EvoMapDAO] Failed to load:", err);
      }
    }
    this.initialized = true;
    logger.info("[EvoMapDAO] Initialized");
  }

  async createProposal({
    title,
    description,
    proposerDid,
    type,
    votingDurationMs,
  } = {}) {
    if (!title) {
      throw new Error("Proposal title is required");
    }
    const id = uuidv4();
    const now = Date.now();
    const proposal = {
      id,
      title,
      description: description || "",
      proposer_did: proposerDid || "self",
      type: type || "standard",
      status: PROPOSAL_STATUS.ACTIVE,
      votes_for: 0,
      votes_against: 0,
      quorum_reached: 0,
      voting_deadline: now + (votingDurationMs || 7 * 24 * 60 * 60 * 1000),
      executed_at: null,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO evomap_governance_proposals (id,title,description,proposer_did,type,status,votes_for,votes_against,quorum_reached,voting_deadline,executed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          title,
          proposal.description,
          proposal.proposer_did,
          proposal.type,
          proposal.status,
          0,
          0,
          0,
          proposal.voting_deadline,
          null,
          now,
        );
    }
    this._proposals.set(id, proposal);
    this.emit("proposal-created", proposal);
    logger.info(`[EvoMapDAO] Proposal created: ${title} (${id})`);
    return proposal;
  }

  async castVote({ proposalId, voterDid, vote } = {}) {
    if (!proposalId) {
      throw new Error("Proposal ID is required");
    }
    if (!vote) {
      throw new Error("Vote is required (for/against)");
    }
    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }
    if (proposal.status !== PROPOSAL_STATUS.ACTIVE) {
      throw new Error("Proposal is not active");
    }
    if (vote === "for") {
      proposal.votes_for++;
    } else {
      proposal.votes_against++;
    }
    // Check quorum
    const totalVotes = proposal.votes_for + proposal.votes_against;
    if (totalVotes >= 3) {
      proposal.quorum_reached = 1;
      if (proposal.votes_for > proposal.votes_against) {
        proposal.status = PROPOSAL_STATUS.PASSED;
      } else {
        proposal.status = PROPOSAL_STATUS.REJECTED;
      }
    }
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          "UPDATE evomap_governance_proposals SET votes_for = ?, votes_against = ?, quorum_reached = ?, status = ? WHERE id = ?",
        )
        .run(
          proposal.votes_for,
          proposal.votes_against,
          proposal.quorum_reached,
          proposal.status,
          proposalId,
        );
    }
    this.emit("vote-cast", { proposalId, voterDid, vote });
    return { proposalId, vote, totalVotes, status: proposal.status };
  }

  async getGovernanceDashboard() {
    const proposals = Array.from(this._proposals.values());
    return {
      totalProposals: proposals.length,
      active: proposals.filter((p) => p.status === PROPOSAL_STATUS.ACTIVE)
        .length,
      passed: proposals.filter((p) => p.status === PROPOSAL_STATUS.PASSED)
        .length,
      rejected: proposals.filter((p) => p.status === PROPOSAL_STATUS.REJECTED)
        .length,
      executed: proposals.filter((p) => p.status === PROPOSAL_STATUS.EXECUTED)
        .length,
    };
  }

  async close() {
    this.removeAllListeners();
    this._proposals.clear();
    this.initialized = false;
    logger.info("[EvoMapDAO] Closed");
  }
}

let _instance = null;
function getEvoMapDAO(database) {
  if (!_instance) {
    _instance = new EvoMapDAO(database);
  }
  return _instance;
}

export { EvoMapDAO, getEvoMapDAO, PROPOSAL_STATUS };
export default EvoMapDAO;
