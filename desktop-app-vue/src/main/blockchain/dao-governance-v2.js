/**
 * @module blockchain/dao-governance-v2
 * Phase 92: DAO governance with quadratic voting, delegation, treasury
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class DAOGovernanceV2 extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._proposals = new Map();
    this._votes = new Map();
    this._delegations = new Map();
    this._treasury = { balance: 0, allocations: [] };
    this._config = {
      votingPeriod: 604800000,
      quorum: 0.1,
      executionDelay: 86400000,
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadState();
    this.initialized = true;
    logger.info("[DAOv2] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dao_v2_proposals (
          id TEXT PRIMARY KEY, title TEXT, description TEXT, proposer TEXT,
          status TEXT DEFAULT 'draft', votes_for REAL DEFAULT 0, votes_against REAL DEFAULT 0,
          voting_type TEXT DEFAULT 'simple', created_at TEXT DEFAULT (datetime('now')),
          ends_at TEXT, executed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS dao_v2_votes (
          id TEXT PRIMARY KEY, proposal_id TEXT, voter TEXT, weight REAL,
          direction TEXT, delegated_from TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS dao_v2_treasury (
          id TEXT PRIMARY KEY, type TEXT, amount REAL, description TEXT,
          proposal_id TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS dao_v2_delegations (
          delegator TEXT PRIMARY KEY, delegate TEXT, weight REAL DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[DAOv2] Table creation warning:", error.message);
    }
  }

  async _loadState() {
    try {
      const proposals = this.db
        .prepare(
          "SELECT * FROM dao_v2_proposals WHERE status IN ('active', 'queued')",
        )
        .all();
      for (const p of proposals) {
        this._proposals.set(p.id, p);
      }
      const delegations = this.db
        .prepare("SELECT * FROM dao_v2_delegations")
        .all();
      for (const d of delegations) {
        this._delegations.set(d.delegator, {
          delegate: d.delegate,
          weight: d.weight,
        });
      }
    } catch (error) {
      logger.warn("[DAOv2] Failed to load state:", error.message);
    }
  }

  createProposal(title, description, proposer, options = {}) {
    const id = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const proposal = {
      id,
      title,
      description,
      proposer,
      status: "active",
      votingType: options.votingType || "simple",
      votesFor: 0,
      votesAgainst: 0,
      endsAt: new Date(Date.now() + this._config.votingPeriod).toISOString(),
    };
    this._proposals.set(id, proposal);
    try {
      this.db
        .prepare(
          "INSERT INTO dao_v2_proposals (id, title, description, proposer, status, voting_type, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          title,
          description,
          proposer,
          "active",
          proposal.votingType,
          proposal.endsAt,
        );
    } catch (error) {
      logger.error("[DAOv2] Proposal persist failed:", error.message);
    }
    this.emit("dao:proposal-created", { id, title });
    return proposal;
  }

  vote(proposalId, voter, direction, weight = 1) {
    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      throw new Error("Proposal not found");
    }
    if (proposal.status !== "active") {
      throw new Error("Proposal not active");
    }

    let effectiveWeight = weight;
    // Quadratic voting: cost = weight^2
    if (proposal.votingType === "quadratic") {
      effectiveWeight = Math.sqrt(weight);
    }

    // Check delegation
    const delegation = this._delegations.get(voter);
    if (delegation) {
      // Delegated votes go to delegate - noted for future enhancement
    }

    if (direction === "for") {
      proposal.votesFor += effectiveWeight;
    } else if (direction === "against") {
      proposal.votesAgainst += effectiveWeight;
    }

    const voteId = `vote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      this.db
        .prepare(
          "INSERT INTO dao_v2_votes (id, proposal_id, voter, weight, direction) VALUES (?, ?, ?, ?, ?)",
        )
        .run(voteId, proposalId, voter, effectiveWeight, direction);
    } catch (error) {
      logger.error("[DAOv2] Vote persist failed:", error.message);
    }
    this.emit("dao:voted", {
      proposalId,
      voter,
      direction,
      weight: effectiveWeight,
    });
    return { voteId, proposalId, weight: effectiveWeight, direction };
  }

  delegate(delegator, delegate, weight = 1) {
    this._delegations.set(delegator, { delegate, weight });
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO dao_v2_delegations (delegator, delegate, weight) VALUES (?, ?, ?)",
        )
        .run(delegator, delegate, weight);
    } catch (error) {
      logger.error("[DAOv2] Delegation persist failed:", error.message);
    }
    this.emit("dao:delegated", { delegator, delegate });
    return { delegator, delegate, weight };
  }

  execute(proposalId) {
    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      throw new Error("Proposal not found");
    }
    if (proposal.votesFor <= proposal.votesAgainst) {
      throw new Error("Proposal did not pass");
    }
    proposal.status = "executed";
    proposal.executedAt = new Date().toISOString();
    this.emit("dao:executed", { proposalId });
    return { proposalId, status: "executed" };
  }

  getTreasury() {
    return this._treasury;
  }

  allocateFunds(proposalId, amount, description) {
    if (this._treasury.balance < amount) {
      throw new Error("Insufficient treasury balance");
    }
    this._treasury.balance -= amount;
    const allocation = {
      id: `alloc-${Date.now()}`,
      proposalId,
      amount,
      description,
      date: Date.now(),
    };
    this._treasury.allocations.push(allocation);
    this.emit("dao:funds-allocated", { proposalId, amount });
    return allocation;
  }

  getGovernanceStats() {
    const proposals = Array.from(this._proposals.values());
    return {
      totalProposals: proposals.length,
      active: proposals.filter((p) => p.status === "active").length,
      executed: proposals.filter((p) => p.status === "executed").length,
      delegations: this._delegations.size,
      treasury: this._treasury.balance,
    };
  }

  configure(config) {
    Object.assign(this._config, config);
    return this._config;
  }
}

let instance = null;
function getDAOGovernanceV2() {
  if (!instance) {
    instance = new DAOGovernanceV2();
  }
  return instance;
}
module.exports = { DAOGovernanceV2, getDAOGovernanceV2 };
