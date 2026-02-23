/**
 * Governance Engine
 * Manages proposals, voting, and decision execution within communities.
 * Implements weighted voting based on member roles.
 *
 * @module governance-engine
 * @version 0.42.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Proposal type constants
 */
const ProposalType = {
  RULE_CHANGE: "rule_change",
  ROLE_CHANGE: "role_change",
  BAN: "ban",
  CHANNEL: "channel",
  OTHER: "other",
};

/**
 * Proposal status constants
 */
const ProposalStatus = {
  DISCUSSION: "discussion",
  VOTING: "voting",
  PASSED: "passed",
  REJECTED: "rejected",
  EXECUTED: "executed",
};

/**
 * Vote option constants
 */
const VoteOption = {
  APPROVE: "approve",
  REJECT: "reject",
  ABSTAIN: "abstain",
};

/**
 * Vote weight by role
 */
const VOTE_WEIGHT = {
  owner: 3,
  admin: 2,
  moderator: 1,
  member: 1,
};

/**
 * Pass threshold (66%)
 */
const PASS_THRESHOLD = 0.66;

class GovernanceEngine extends EventEmitter {
  constructor(database, didManager, communityManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.communityManager = communityManager;

    this.initialized = false;
  }

  /**
   * Initialize the governance engine
   */
  async initialize() {
    logger.info("[GovernanceEngine] Initializing governance engine...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[GovernanceEngine] Governance engine initialized successfully");
    } catch (error) {
      logger.error("[GovernanceEngine] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS governance_proposals (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL,
        proposer_did TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        proposal_type TEXT CHECK(proposal_type IN ('rule_change', 'role_change', 'ban', 'channel', 'other')),
        status TEXT DEFAULT 'discussion' CHECK(status IN ('discussion', 'voting', 'passed', 'rejected', 'executed')),
        discussion_end INTEGER,
        voting_end INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_proposals_community ON governance_proposals(community_id);
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON governance_proposals(status);
      CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON governance_proposals(proposer_did);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS governance_votes (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        voter_did TEXT NOT NULL,
        vote TEXT CHECK(vote IN ('approve', 'reject', 'abstain')),
        weight INTEGER DEFAULT 1,
        created_at INTEGER,
        UNIQUE(proposal_id, voter_did)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_votes_proposal ON governance_votes(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_votes_voter ON governance_votes(voter_did);
    `);

    logger.info("[GovernanceEngine] Database tables initialized");
  }

  /**
   * Get the current user DID
   */
  getCurrentDid() {
    return this.didManager?.getCurrentIdentity()?.did || null;
  }

  /**
   * Create a new proposal
   * @param {Object} options - Proposal options
   * @param {string} options.communityId - Community ID
   * @param {string} options.title - Proposal title
   * @param {string} options.description - Proposal description
   * @param {string} options.proposalType - Proposal type
   * @param {number} options.discussionDuration - Discussion period in milliseconds (default 24h)
   * @param {number} options.votingDuration - Voting period in milliseconds (default 48h)
   */
  async createProposal({
    communityId,
    title,
    description = "",
    proposalType = ProposalType.OTHER,
    discussionDuration = 24 * 60 * 60 * 1000,
    votingDuration = 48 * 60 * 60 * 1000,
  }) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    if (!title || title.trim().length === 0) {
      throw new Error("Proposal title cannot be empty");
    }

    try {
      const db = this.database.db;

      // Check if user is a member of the community
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!member) {
        throw new Error("You are not a member of this community");
      }

      const proposalId = uuidv4();
      const now = Date.now();
      const discussionEnd = now + discussionDuration;
      const votingEnd = discussionEnd + votingDuration;

      db.prepare(`
        INSERT INTO governance_proposals (
          id, community_id, proposer_did, title, description,
          proposal_type, status, discussion_end, voting_end,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        proposalId,
        communityId,
        currentDid,
        title.trim(),
        description,
        proposalType,
        ProposalStatus.DISCUSSION,
        discussionEnd,
        votingEnd,
        now,
        now,
      );

      this.database.saveToFile();

      const proposal = {
        id: proposalId,
        community_id: communityId,
        proposer_did: currentDid,
        title: title.trim(),
        description,
        proposal_type: proposalType,
        status: ProposalStatus.DISCUSSION,
        discussion_end: discussionEnd,
        voting_end: votingEnd,
        created_at: now,
        updated_at: now,
      };

      logger.info("[GovernanceEngine] Proposal created:", proposalId);
      this.emit("proposal:created", { proposal });

      return proposal;
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to create proposal:", error);
      throw error;
    }
  }

  /**
   * Cast a vote on a proposal
   * @param {string} proposalId - Proposal ID
   * @param {string} vote - Vote option ('approve', 'reject', 'abstain')
   */
  async castVote(proposalId, vote) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    if (!Object.values(VoteOption).includes(vote)) {
      throw new Error("Invalid vote option. Must be 'approve', 'reject', or 'abstain'");
    }

    try {
      const db = this.database.db;

      const proposal = db.prepare("SELECT * FROM governance_proposals WHERE id = ?").get(proposalId);
      if (!proposal) {
        throw new Error("Proposal not found");
      }

      // Auto-transition from discussion to voting if discussion period has ended
      const now = Date.now();
      if (proposal.status === ProposalStatus.DISCUSSION && now >= proposal.discussion_end) {
        db.prepare(
          "UPDATE governance_proposals SET status = ?, updated_at = ? WHERE id = ?",
        ).run(ProposalStatus.VOTING, now, proposalId);
        proposal.status = ProposalStatus.VOTING;
      }

      if (proposal.status !== ProposalStatus.VOTING) {
        throw new Error("Proposal is not in voting phase");
      }

      if (now > proposal.voting_end) {
        throw new Error("Voting period has ended");
      }

      // Check if user is a member of the community
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(proposal.community_id, currentDid);

      if (!member) {
        throw new Error("You are not a member of this community");
      }

      // Determine vote weight based on role
      const weight = VOTE_WEIGHT[member.role] || 1;

      // Insert or update vote (UNIQUE constraint on proposal_id + voter_did)
      const existingVote = db.prepare(
        "SELECT * FROM governance_votes WHERE proposal_id = ? AND voter_did = ?",
      ).get(proposalId, currentDid);

      if (existingVote) {
        db.prepare(
          "UPDATE governance_votes SET vote = ?, weight = ?, created_at = ? WHERE id = ?",
        ).run(vote, weight, now, existingVote.id);
      } else {
        db.prepare(`
          INSERT INTO governance_votes (id, proposal_id, voter_did, vote, weight, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), proposalId, currentDid, vote, weight, now);
      }

      this.database.saveToFile();

      logger.info("[GovernanceEngine] Vote cast:", currentDid, vote, "on proposal:", proposalId);
      this.emit("proposal:vote-cast", { proposalId, voterDid: currentDid, vote, weight });

      return { success: true, weight };
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to cast vote:", error);
      throw error;
    }
  }

  /**
   * Get proposals for a community
   * @param {string} communityId - Community ID
   * @param {Object} options - Query options
   */
  async getProposals(communityId, { status = null, limit = 50, offset = 0 } = {}) {
    try {
      const db = this.database.db;

      let query = `
        SELECT gp.*,
          (SELECT COUNT(*) FROM governance_votes WHERE proposal_id = gp.id) as vote_count
        FROM governance_proposals gp
        WHERE gp.community_id = ?
      `;
      const params = [communityId];

      if (status) {
        query += " AND gp.status = ?";
        params.push(status);
      }

      query += " ORDER BY gp.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const proposals = db.prepare(query).all(...params);

      // Auto-update statuses based on time
      const now = Date.now();
      for (const proposal of proposals) {
        if (proposal.status === ProposalStatus.DISCUSSION && now >= proposal.discussion_end) {
          db.prepare(
            "UPDATE governance_proposals SET status = ?, updated_at = ? WHERE id = ?",
          ).run(ProposalStatus.VOTING, now, proposal.id);
          proposal.status = ProposalStatus.VOTING;
        }
        if (proposal.status === ProposalStatus.VOTING && now >= proposal.voting_end) {
          // Auto-tally votes
          const result = await this.tallyVotes(proposal.id);
          proposal.status = result.passed ? ProposalStatus.PASSED : ProposalStatus.REJECTED;
        }
      }

      return proposals || [];
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to get proposals:", error);
      return [];
    }
  }

  /**
   * Get a proposal by ID
   * @param {string} proposalId - Proposal ID
   */
  async getProposalById(proposalId) {
    try {
      const db = this.database.db;

      const proposal = db.prepare("SELECT * FROM governance_proposals WHERE id = ?").get(proposalId);
      if (!proposal) {
        return null;
      }

      // Get vote counts
      const votes = db.prepare(`
        SELECT vote, SUM(weight) as total_weight, COUNT(*) as count
        FROM governance_votes
        WHERE proposal_id = ?
        GROUP BY vote
      `).all(proposalId);

      proposal.votes_summary = {};
      for (const v of votes) {
        proposal.votes_summary[v.vote] = {
          count: v.count,
          weight: v.total_weight,
        };
      }

      // Check current user's vote
      const currentDid = this.getCurrentDid();
      if (currentDid) {
        const myVote = db.prepare(
          "SELECT * FROM governance_votes WHERE proposal_id = ? AND voter_did = ?",
        ).get(proposalId, currentDid);
        proposal.my_vote = myVote ? myVote.vote : null;
      }

      return proposal;
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to get proposal:", error);
      return null;
    }
  }

  /**
   * Get votes for a proposal
   * @param {string} proposalId - Proposal ID
   */
  async getVotes(proposalId) {
    try {
      const db = this.database.db;

      const stmt = db.prepare(`
        SELECT gv.*, c.nickname as voter_nickname
        FROM governance_votes gv
        LEFT JOIN contacts c ON gv.voter_did = c.did
        WHERE gv.proposal_id = ?
        ORDER BY gv.created_at ASC
      `);

      const votes = stmt.all(proposalId);
      return votes || [];
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to get votes:", error);
      return [];
    }
  }

  /**
   * Tally votes for a proposal and determine the outcome
   * @param {string} proposalId - Proposal ID
   */
  async tallyVotes(proposalId) {
    try {
      const db = this.database.db;

      const proposal = db.prepare("SELECT * FROM governance_proposals WHERE id = ?").get(proposalId);
      if (!proposal) {
        throw new Error("Proposal not found");
      }

      const votes = db.prepare("SELECT * FROM governance_votes WHERE proposal_id = ?").all(proposalId);

      let approveWeight = 0;
      let rejectWeight = 0;
      let abstainWeight = 0;
      let totalWeight = 0;

      for (const vote of votes) {
        totalWeight += vote.weight;
        switch (vote.vote) {
          case VoteOption.APPROVE:
            approveWeight += vote.weight;
            break;
          case VoteOption.REJECT:
            rejectWeight += vote.weight;
            break;
          case VoteOption.ABSTAIN:
            abstainWeight += vote.weight;
            break;
        }
      }

      // Calculate pass ratio (excluding abstentions)
      const effectiveWeight = approveWeight + rejectWeight;
      const passRatio = effectiveWeight > 0 ? approveWeight / effectiveWeight : 0;
      const passed = passRatio >= PASS_THRESHOLD;

      const newStatus = passed ? ProposalStatus.PASSED : ProposalStatus.REJECTED;
      const now = Date.now();

      db.prepare(
        "UPDATE governance_proposals SET status = ?, updated_at = ? WHERE id = ?",
      ).run(newStatus, now, proposalId);

      this.database.saveToFile();

      const result = {
        proposalId,
        passed,
        status: newStatus,
        approveWeight,
        rejectWeight,
        abstainWeight,
        totalWeight,
        passRatio: Math.round(passRatio * 100) / 100,
        threshold: PASS_THRESHOLD,
        voterCount: votes.length,
      };

      logger.info("[GovernanceEngine] Votes tallied for proposal:", proposalId, "Result:", newStatus);
      this.emit("proposal:tallied", result);

      return result;
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to tally votes:", error);
      throw error;
    }
  }

  /**
   * Execute a passed proposal (marks it as executed)
   * @param {string} proposalId - Proposal ID
   */
  async executeProposal(proposalId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const proposal = db.prepare("SELECT * FROM governance_proposals WHERE id = ?").get(proposalId);
      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== ProposalStatus.PASSED) {
        throw new Error("Only passed proposals can be executed");
      }

      // Check if user has admin/owner permissions
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(proposal.community_id, currentDid);

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new Error("Insufficient permissions to execute proposals");
      }

      const now = Date.now();
      db.prepare(
        "UPDATE governance_proposals SET status = ?, updated_at = ? WHERE id = ?",
      ).run(ProposalStatus.EXECUTED, now, proposalId);

      this.database.saveToFile();

      logger.info("[GovernanceEngine] Proposal executed:", proposalId);
      this.emit("proposal:executed", { proposalId, executedBy: currentDid });

      return { success: true };
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to execute proposal:", error);
      throw error;
    }
  }

  /**
   * Close voting on a proposal manually
   * @param {string} proposalId - Proposal ID
   */
  async closeVoting(proposalId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const proposal = db.prepare("SELECT * FROM governance_proposals WHERE id = ?").get(proposalId);
      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== ProposalStatus.VOTING) {
        throw new Error("Proposal is not in voting phase");
      }

      // Check admin/owner permissions
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(proposal.community_id, currentDid);

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new Error("Insufficient permissions to close voting");
      }

      // Tally the votes
      const result = await this.tallyVotes(proposalId);

      logger.info("[GovernanceEngine] Voting closed for proposal:", proposalId);
      return result;
    } catch (error) {
      logger.error("[GovernanceEngine] Failed to close voting:", error);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async close() {
    logger.info("[GovernanceEngine] Closing governance engine");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  GovernanceEngine,
  ProposalType,
  ProposalStatus,
  VoteOption,
  VOTE_WEIGHT,
  PASS_THRESHOLD,
};
