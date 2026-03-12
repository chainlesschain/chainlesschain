/**
 * CLI Content Recommender — tool similarity, chain detection, and skill matching.
 *
 * Uses TF-IDF for tool feature extraction and cosine similarity,
 * plus sequential chain frequency for next-tool prediction.
 * BM25 for skill recommendation.
 */

import { BM25Search } from "./bm25-search.js";

// Exported for test injection
export const _deps = {
  BM25Search,
};

export class CLIContentRecommender {
  constructor() {
    this._toolFeatures = new Map(); // tool → feature vector
    this._toolUsageLog = []; // sequential tool usage log
    this._chainFrequency = new Map(); // "toolA→toolB" → count
    this._skillIndex = null;
    this._vocabulary = new Set();
  }

  /**
   * Build TF-IDF feature vectors for tools.
   * @param {Array<{ name: string, description: string }>} tools
   */
  buildToolFeatures(tools) {
    if (!tools || tools.length === 0) return;

    this._vocabulary = new Set();
    const docTokens = [];

    // Tokenize each tool description
    for (const tool of tools) {
      const text = `${tool.name} ${tool.description || ""}`.toLowerCase();
      const tokens = text.split(/\W+/).filter((t) => t.length > 2);
      docTokens.push({ name: tool.name, tokens });
      for (const t of tokens) this._vocabulary.add(t);
    }

    // Calculate TF-IDF
    const N = docTokens.length;
    const df = new Map(); // term → doc frequency

    for (const { tokens } of docTokens) {
      const unique = new Set(tokens);
      for (const t of unique) {
        df.set(t, (df.get(t) || 0) + 1);
      }
    }

    for (const { name, tokens } of docTokens) {
      const tf = new Map();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }

      const vector = new Map();
      for (const [term, count] of tf) {
        const idf = Math.log(N / (df.get(term) || 1));
        vector.set(term, (count / tokens.length) * idf);
      }

      this._toolFeatures.set(name, vector);
    }
  }

  /**
   * Calculate cosine similarity between two tools.
   */
  calculateSimilarity(tool1, tool2) {
    const v1 = this._toolFeatures.get(tool1);
    const v2 = this._toolFeatures.get(tool2);
    if (!v1 || !v2) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const [term, val] of v1) {
      norm1 += val * val;
      if (v2.has(term)) {
        dotProduct += val * v2.get(term);
      }
    }
    for (const [, val] of v2) {
      norm2 += val * val;
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Record a tool usage for chain detection.
   */
  recordToolUse(toolName, context = {}) {
    const entry = {
      tool: toolName,
      timestamp: Date.now(),
      context: context.query || "",
    };
    this._toolUsageLog.push(entry);

    // Update chain frequency (look at previous tool)
    if (this._toolUsageLog.length >= 2) {
      const prev = this._toolUsageLog[this._toolUsageLog.length - 2];
      const key = `${prev.tool}→${toolName}`;
      this._chainFrequency.set(key, (this._chainFrequency.get(key) || 0) + 1);
    }

    // Keep log bounded
    if (this._toolUsageLog.length > 1000) {
      this._toolUsageLog = this._toolUsageLog.slice(-500);
    }
  }

  /**
   * Recommend next tool based on usage chains.
   * @returns {Array<{ tool: string, confidence: number }>}
   */
  recommendNextTool(currentTool, _context = {}) {
    const candidates = [];
    let totalFromCurrent = 0;

    for (const [key, count] of this._chainFrequency) {
      if (key.startsWith(`${currentTool}→`)) {
        const nextTool = key.split("→")[1];
        candidates.push({ tool: nextTool, count });
        totalFromCurrent += count;
      }
    }

    if (totalFromCurrent === 0) return [];

    return candidates
      .map((c) => ({
        tool: c.tool,
        confidence: Math.round((c.count / totalFromCurrent) * 100) / 100,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  /**
   * Recommend a skill based on user query using BM25.
   * @param {string} userQuery
   * @param {Array<{ id: string, description: string, category: string }>} skills
   */
  recommendSkill(userQuery, skills) {
    if (!userQuery || !skills || skills.length === 0) return [];

    // Build BM25 index
    const bm25 = new _deps.BM25Search();
    const docs = skills.map((s) => ({
      id: s.id,
      title: s.id,
      content: `${s.id} ${s.description || ""} ${s.category || ""}`,
    }));
    bm25.indexDocuments(docs);

    const results = bm25.search(userQuery, { topK: 5, threshold: 0.1 });
    return results.map((r) => ({
      skillId: r.doc.id,
      score: r.score,
    }));
  }

  /**
   * Get chain statistics.
   */
  getChainStats() {
    const chains = [...this._chainFrequency.entries()]
      .map(([key, count]) => ({ chain: key, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalUsages: this._toolUsageLog.length,
      uniqueChains: chains.length,
      topChains: chains.slice(0, 10),
    };
  }

  /**
   * Get tool similarity matrix.
   */
  getSimilarityMatrix() {
    const tools = [...this._toolFeatures.keys()];
    const matrix = {};

    for (const t1 of tools) {
      matrix[t1] = {};
      for (const t2 of tools) {
        if (t1 !== t2) {
          matrix[t1][t2] =
            Math.round(this.calculateSimilarity(t1, t2) * 1000) / 1000;
        }
      }
    }

    return matrix;
  }
}
