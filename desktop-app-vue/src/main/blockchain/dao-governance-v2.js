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
        // DB 列是 snake_case，但内存态/vote()/execute() 用 camelCase。直接存原始行会让
        // votesFor/votesAgainst 为 undefined：execute() 的 `votesFor <= votesAgainst`
        // 在 undefined<=undefined 时为 false，会跳过「未通过」闸而执行未达票数的提案。
        // 故重启加载时统一映射为 camelCase 并给数值兜底（无票数则回 0，execute 正确拦下）。
        this._proposals.set(p.id, {
          ...p,
          votingType: p.voting_type || "simple",
          votesFor: Number(p.votes_for) || 0,
          votesAgainst: Number(p.votes_against) || 0,
          endsAt: p.ends_at,
        });
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
    // Reject NaN/Infinity/negative weight — otherwise it poisons votesFor and a
    // NaN total slips past execute()'s `votesFor <= votesAgainst` guard (NaN
    // comparisons are always false), executing a proposal that never passed.
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(
        "Invalid vote weight: must be a non-negative finite number",
      );
    }

    // 防重复投票：同一提案同一投票人只计一次，否则可反复调用 vote() 把票数刷高、
    // 操纵治理结果（并越过 execute() 的 votesFor<=votesAgainst 闸提走国库）。
    // 票数累加在内存态 proposal 上，故去重登记表也用内存（与计票同生命周期，
    // mock-db 测试下亦生效）；复用此前声明却未接线的 _votes Map。
    const voteKey = `${proposalId}:${voter}`;
    if (this._votes.has(voteKey)) {
      throw new Error("Voter has already voted on this proposal");
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
    // 登记该投票人已就此提案投票（即使下面持久化失败也保留，与内存计票一致）
    this._votes.set(voteKey, { direction, weight: effectiveWeight });

    const voteId = `vote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      this.db
        .prepare(
          "INSERT INTO dao_v2_votes (id, proposal_id, voter, weight, direction) VALUES (?, ?, ?, ?, ?)",
        )
        .run(voteId, proposalId, voter, effectiveWeight, direction);
      // 同步票数到提案行，否则 votes_for/votes_against 永远是 DEFAULT 0，
      // 重启后即便正确映射也会把已通过的提案票数清零（_loadState 依赖此列）。
      this.db
        .prepare(
          "UPDATE dao_v2_proposals SET votes_for = ?, votes_against = ? WHERE id = ?",
        )
        .run(proposal.votesFor, proposal.votesAgainst, proposalId);
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
    // Guard against re-execution: vote totals are immutable, so without a status
    // check execute() would succeed every time it's called (states are only
    // "active" → "executed"), letting a wired allocateFunds double-drain the
    // treasury. executed !== active, so this blocks the double-execute path.
    if (proposal.status !== "active") {
      throw new Error("Proposal not active");
    }
    if (proposal.votesFor <= proposal.votesAgainst) {
      throw new Error("Proposal did not pass");
    }
    proposal.status = "executed";
    proposal.executedAt = new Date().toISOString();
    // Persist the executed status (mirroring vote()/delegate()). The in-memory
    // status guard above is defeated after a restart: _loadProposals reloads from
    // the DB where status would still be "active" if never written, re-enabling a
    // double-execute / treasury double-drain. Writing "executed" flips it so the
    // `status IN ('active','queued')` load filter excludes it on next start.
    try {
      this.db
        .prepare(
          "UPDATE dao_v2_proposals SET status = ?, executed_at = ? WHERE id = ?",
        )
        .run("executed", proposal.executedAt, proposalId);
    } catch (error) {
      logger.error("[DAOv2] Execute persist failed:", error.message);
    }
    this.emit("dao:executed", { proposalId });
    return { proposalId, status: "executed" };
  }

  getTreasury() {
    return this._treasury;
  }

  allocateFunds(proposalId, amount, description) {
    // Validate amount before the balance check (mirrors vote()'s isFinite guard):
    // `balance < NaN` and `balance < -X` are both false, so an unvalidated NaN
    // would corrupt the balance to NaN and a negative would INFLATE the treasury
    // (balance -= -X). Reject non-positive / non-finite amounts.
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid amount: must be a positive finite number");
    }
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
