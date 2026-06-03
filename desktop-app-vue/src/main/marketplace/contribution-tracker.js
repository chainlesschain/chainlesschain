/**
 * Contribution Tracker
 *
 * Track skill/gene/compute/data contributions:
 * - Contribution recording
 * - Quality scoring
 * - Leaderboard
 *
 * @module marketplace/contribution-tracker
 * @version 3.1.0
 */

import { logger } from "../utils/logger.js";

const CONTRIBUTION_TYPE = {
  SKILL: "skill",
  GENE: "gene",
  COMPUTE: "compute",
  DATA: "data",
  REVIEW: "review",
};

class ContributionTracker {
  constructor(database) {
    this.database = database;
    this._contributions = [];
  }

  async getContributions(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM contributions WHERE 1=1";
        const params = [];
        if (filter.type) {
          sql += " AND type = ?";
          params.push(filter.type);
        }
        if (filter.contributorDid) {
          sql += " AND contributor_did = ?";
          params.push(filter.contributorDid);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        return this.database.db.prepare(sql).all(...params);
      } catch (err) {
        logger.error("[ContributionTracker] Failed to get contributions:", err);
      }
    }
    return this._contributions.slice(0, filter.limit || 50);
  }

  async scoreContribution(contributionId, score) {
    if (!contributionId) {
      throw new Error("Contribution ID is required");
    }
    if (score < 0 || score > 1) {
      throw new Error("Score must be between 0 and 1");
    }
    if (this.database && this.database.db) {
      this.database.db
        .prepare("UPDATE contributions SET quality_score = ? WHERE id = ?")
        .run(score, contributionId);
    }
    return { contributionId, qualityScore: score, updatedAt: Date.now() };
  }

  async getLeaderboard(limit = 10) {
    if (this.database && this.database.db) {
      try {
        return this.database.db
          .prepare(
            `SELECT contributor_did, COUNT(*) as count, SUM(tokens_earned) as total_earned, AVG(quality_score) as avg_quality
           FROM contributions GROUP BY contributor_did ORDER BY total_earned DESC LIMIT ?`,
          )
          .all(limit);
      } catch (err) {
        logger.error("[ContributionTracker] Failed to get leaderboard:", err);
      }
    }
    return [];
  }

  async close() {
    this._contributions = [];
    logger.info("[ContributionTracker] Closed");
  }
}

let _instance = null;
function getContributionTracker(database) {
  if (!_instance) {
    _instance = new ContributionTracker(database);
  }
  return _instance;
}

export { ContributionTracker, getContributionTracker, CONTRIBUTION_TYPE };
export default ContributionTracker;
