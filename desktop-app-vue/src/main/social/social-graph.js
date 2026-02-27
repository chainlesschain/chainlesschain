/**
 * Social Graph
 *
 * Interaction-based relationship graph with frequency tracking,
 * closeness scoring, and community clustering.
 *
 * @module social/social-graph
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const INTERACTION_TYPES = {
  MESSAGE: "message",
  REPLY: "reply",
  LIKE: "like",
  SHARE: "share",
  MENTION: "mention",
  FOLLOW: "follow",
};

const INTERACTION_WEIGHTS = {
  [INTERACTION_TYPES.MESSAGE]: 3,
  [INTERACTION_TYPES.REPLY]: 2,
  [INTERACTION_TYPES.LIKE]: 1,
  [INTERACTION_TYPES.SHARE]: 2,
  [INTERACTION_TYPES.MENTION]: 1.5,
  [INTERACTION_TYPES.FOLLOW]: 2,
};

// ============================================================
// SocialGraph
// ============================================================

class SocialGraph extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[SocialGraph] Initializing social graph...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[SocialGraph] Social graph initialized successfully");
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      logger.warn("[SocialGraph] Database not available, skipping table creation");
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS social_graph_edges (
        id TEXT PRIMARY KEY,
        source_did TEXT NOT NULL,
        target_did TEXT NOT NULL,
        interaction_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        interaction_count INTEGER DEFAULT 1,
        last_interaction_at INTEGER,
        closeness_score REAL DEFAULT 0.0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(source_did, target_did, interaction_type)
      );
      CREATE INDEX IF NOT EXISTS idx_social_graph_source ON social_graph_edges(source_did);
      CREATE INDEX IF NOT EXISTS idx_social_graph_target ON social_graph_edges(target_did);
      CREATE INDEX IF NOT EXISTS idx_social_graph_closeness ON social_graph_edges(closeness_score DESC);
    `);
  }

  /**
   * Record an interaction between two users.
   * @param {string} sourceDid - Source user DID
   * @param {string} targetDid - Target user DID
   * @param {string} interactionType - Type of interaction
   * @returns {Object} Updated edge
   */
  async recordInteraction(sourceDid, targetDid, interactionType) {
    try {
      if (!sourceDid || !targetDid) throw new Error("Both source and target DIDs are required");
      if (sourceDid === targetDid) return { success: true, self: true };

      const type = interactionType || INTERACTION_TYPES.MESSAGE;
      const weight = INTERACTION_WEIGHTS[type] || 1;
      const now = Date.now();

      if (!this.database || !this.database.db) {
        throw new Error("Database not initialized");
      }

      const existing = this.database.db
        .prepare(
          `SELECT * FROM social_graph_edges WHERE source_did = ? AND target_did = ? AND interaction_type = ?`,
        )
        .get(sourceDid, targetDid, type);

      if (existing) {
        const newCount = existing.interaction_count + 1;
        const newCloseness = this._calculateCloseness(newCount, weight, existing.created_at, now);

        this.database.db
          .prepare(
            `UPDATE social_graph_edges SET interaction_count = ?, weight = ?, closeness_score = ?, last_interaction_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(newCount, weight * Math.log2(newCount + 1), newCloseness, now, now, existing.id);

        this.database.saveToFile();
        return { success: true, edgeId: existing.id, count: newCount, closeness: newCloseness };
      }

      const id = uuidv4();
      const closeness = this._calculateCloseness(1, weight, now, now);

      this.database.db
        .prepare(
          `INSERT INTO social_graph_edges (id, source_did, target_did, interaction_type, weight, interaction_count, closeness_score, last_interaction_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, sourceDid, targetDid, type, weight, 1, closeness, now, now, now);

      this.database.saveToFile();
      return { success: true, edgeId: id, count: 1, closeness };
    } catch (error) {
      logger.error("[SocialGraph] Failed to record interaction:", error);
      throw error;
    }
  }

  _calculateCloseness(count, weight, firstInteractionTime, lastInteractionTime) {
    const frequencyScore = Math.log2(count + 1) * weight;
    const daysSinceFirst = Math.max(1, (lastInteractionTime - firstInteractionTime) / (24 * 60 * 60 * 1000));
    const recencyFactor = Math.min(1, 7 / daysSinceFirst); // Decay over 7 days
    return Math.min(1.0, (frequencyScore * 0.7 + recencyFactor * 0.3));
  }

  /**
   * Get the closest contacts for a user.
   * @param {string} did - User DID
   * @param {Object} [options] - Query options
   * @param {number} [options.limit=20] - Max contacts to return
   * @returns {Array} Closest contacts with scores
   */
  async getClosestContacts(did, options = {}) {
    try {
      if (!this.database || !this.database.db) return [];

      const limit = options.limit || 20;

      const rows = this.database.db
        .prepare(
          `SELECT target_did, SUM(closeness_score) as total_closeness, SUM(interaction_count) as total_interactions,
                  MAX(last_interaction_at) as last_interaction
           FROM social_graph_edges
           WHERE source_did = ?
           GROUP BY target_did
           ORDER BY total_closeness DESC
           LIMIT ?`,
        )
        .all(did, limit);

      return rows.map((row) => ({
        did: row.target_did,
        closeness: Math.round(row.total_closeness * 100) / 100,
        totalInteractions: row.total_interactions,
        lastInteraction: row.last_interaction,
      }));
    } catch (error) {
      logger.error("[SocialGraph] Failed to get closest contacts:", error);
      return [];
    }
  }

  /**
   * Get the full graph for a user (nodes + edges).
   * @param {string} did - User DID
   * @param {Object} [options] - Query options
   * @param {number} [options.depth=1] - Graph depth
   * @returns {Object} Graph with nodes and edges
   */
  async getGraph(did, options = {}) {
    try {
      if (!this.database || !this.database.db) return { nodes: [], edges: [] };

      const depth = options.depth || 1;
      const visitedDids = new Set([did]);
      const allEdges = [];
      let currentLevel = [did];

      for (let d = 0; d < depth; d++) {
        if (currentLevel.length === 0) break;

        const placeholders = currentLevel.map(() => "?").join(",");
        const edges = this.database.db
          .prepare(
            `SELECT source_did, target_did, interaction_type, interaction_count, closeness_score
             FROM social_graph_edges
             WHERE source_did IN (${placeholders})
             ORDER BY closeness_score DESC
             LIMIT 100`,
          )
          .all(...currentLevel);

        const nextLevel = [];
        for (const edge of edges) {
          allEdges.push(edge);
          if (!visitedDids.has(edge.target_did)) {
            visitedDids.add(edge.target_did);
            nextLevel.push(edge.target_did);
          }
        }
        currentLevel = nextLevel;
      }

      const nodes = Array.from(visitedDids).map((nodeDid) => ({
        id: nodeDid,
        isCenter: nodeDid === did,
      }));

      return { nodes, edges: allEdges };
    } catch (error) {
      logger.error("[SocialGraph] Failed to get graph:", error);
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Detect community clusters using simple label propagation.
   * @param {string} did - Center user DID
   * @returns {Array} Community clusters
   */
  async detectCommunities(did) {
    try {
      const graph = await this.getGraph(did, { depth: 2 });
      if (graph.nodes.length === 0) return [];

      // Simple clustering: group by interaction frequency
      const adjacency = {};
      for (const edge of graph.edges) {
        if (!adjacency[edge.source_did]) adjacency[edge.source_did] = {};
        adjacency[edge.source_did][edge.target_did] = edge.closeness_score;
      }

      // Label propagation (simplified)
      const labels = {};
      let labelId = 0;
      for (const node of graph.nodes) {
        labels[node.id] = labelId++;
      }

      for (let iteration = 0; iteration < 5; iteration++) {
        for (const node of graph.nodes) {
          const neighbors = adjacency[node.id] || {};
          const labelCounts = {};

          for (const [neighbor, weight] of Object.entries(neighbors)) {
            const neighborLabel = labels[neighbor];
            if (neighborLabel !== undefined) {
              labelCounts[neighborLabel] = (labelCounts[neighborLabel] || 0) + weight;
            }
          }

          if (Object.keys(labelCounts).length > 0) {
            const bestLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0][0];
            labels[node.id] = parseInt(bestLabel, 10);
          }
        }
      }

      // Group by label
      const clusters = {};
      for (const [nodeDid, label] of Object.entries(labels)) {
        if (!clusters[label]) clusters[label] = [];
        clusters[label].push(nodeDid);
      }

      return Object.entries(clusters)
        .filter(([, members]) => members.length > 1)
        .map(([label, members]) => ({
          clusterId: parseInt(label, 10),
          members,
          size: members.length,
        }));
    } catch (error) {
      logger.error("[SocialGraph] Failed to detect communities:", error);
      return [];
    }
  }

  /**
   * Get interaction statistics for a user.
   * @param {string} did - User DID
   * @returns {Object} Interaction stats
   */
  async getStats(did) {
    try {
      if (!this.database || !this.database.db) {
        return { totalContacts: 0, totalInteractions: 0, avgCloseness: 0, byType: {} };
      }

      const stats = this.database.db
        .prepare(
          `SELECT COUNT(DISTINCT target_did) as total_contacts,
                  SUM(interaction_count) as total_interactions,
                  AVG(closeness_score) as avg_closeness
           FROM social_graph_edges WHERE source_did = ?`,
        )
        .get(did);

      const byType = this.database.db
        .prepare(
          `SELECT interaction_type, SUM(interaction_count) as count
           FROM social_graph_edges WHERE source_did = ?
           GROUP BY interaction_type`,
        )
        .all(did);

      const typeMap = {};
      for (const row of byType) {
        typeMap[row.interaction_type] = row.count;
      }

      return {
        totalContacts: stats.total_contacts || 0,
        totalInteractions: stats.total_interactions || 0,
        avgCloseness: Math.round((stats.avg_closeness || 0) * 100) / 100,
        byType: typeMap,
      };
    } catch (error) {
      logger.error("[SocialGraph] Failed to get stats:", error);
      return { totalContacts: 0, totalInteractions: 0, avgCloseness: 0, byType: {} };
    }
  }

  async close() {
    logger.info("[SocialGraph] Closing social graph");
    this.removeAllListeners();
    this.initialized = false;
  }
}

let _instance;
function getSocialGraph() {
  if (!_instance) _instance = new SocialGraph();
  return _instance;
}

export { SocialGraph, getSocialGraph, INTERACTION_TYPES, INTERACTION_WEIGHTS };
