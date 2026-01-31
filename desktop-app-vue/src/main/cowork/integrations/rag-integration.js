/**
 * RAG (Retrieval-Augmented Generation) Integration for Cowork
 *
 * Allows Cowork agents to query the RAG knowledge base for:
 * - Task-relevant information
 * - Historical decisions
 * - Domain knowledge
 * - Best practices
 *
 * @module CoworkRAGIntegration
 */

const { logger, createLogger } = require('../../utils/logger');
const path = require('path');

const ragLogger = createLogger('cowork-rag');

class CoworkRAGIntegration {
  constructor(ragService) {
    this.ragService = ragService;
    this.queryCache = new Map();  // Cache recent queries
    this.cacheExpiry = 5 * 60 * 1000;  // 5 minutes
  }

  /**
   * Query RAG for task-relevant information
   *
   * @param {Object} params - Query parameters
   * @param {string} params.query - Natural language query
   * @param {string} params.teamId - Team ID for context
   * @param {string} params.taskType - Task type (office, coding, etc.)
   * @param {number} params.limit - Max results to return
   * @returns {Promise<Object>} Query results with relevant documents
   */
  async queryKnowledge(params) {
    const { query, teamId, taskType, limit = 5 } = params;

    // Check cache first
    const cacheKey = `${query}:${taskType}:${limit}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      ragLogger.debug(`RAG cache hit for query: ${query.substring(0, 50)}...`);
      return cached.result;
    }

    try {
      ragLogger.info(`Querying RAG for team ${teamId}: ${query.substring(0, 100)}...`);

      // Build enhanced query with context
      const enhancedQuery = this._buildEnhancedQuery(query, taskType);

      // Query RAG service
      const results = await this.ragService.search({
        query: enhancedQuery,
        limit,
        filters: {
          type: taskType,
        },
      });

      // Process and rank results
      const processedResults = this._processResults(results, query);

      // Cache results
      this.queryCache.set(cacheKey, {
        result: processedResults,
        timestamp: Date.now(),
      });

      ragLogger.info(`RAG query returned ${processedResults.documents.length} results`);

      return processedResults;
    } catch (error) {
      ragLogger.error('RAG query failed:', error);
      throw new Error(`Failed to query knowledge base: ${error.message}`);
    }
  }

  /**
   * Query for similar past tasks
   *
   * @param {Object} task - Current task
   * @returns {Promise<Array>} Similar past tasks
   */
  async findSimilarTasks(task) {
    try {
      const query = `Find similar tasks to: ${task.description}. Task type: ${task.type}`;

      const results = await this.queryKnowledge({
        query,
        teamId: task.teamId,
        taskType: task.type,
        limit: 3,
      });

      // Extract task examples from results
      const similarTasks = results.documents
        .filter((doc) => doc.metadata?.taskId)
        .map((doc) => ({
          taskId: doc.metadata.taskId,
          description: doc.metadata.description,
          solution: doc.content,
          similarity: doc.score,
        }));

      return similarTasks;
    } catch (error) {
      ragLogger.error('Failed to find similar tasks:', error);
      return [];
    }
  }

  /**
   * Store task solution in knowledge base
   *
   * @param {Object} params - Storage parameters
   * @param {Object} params.task - Completed task
   * @param {Object} params.solution - Task solution
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<boolean>} Success status
   */
  async storeTaskSolution(params) {
    const { task, solution, metadata = {} } = params;

    try {
      ragLogger.info(`Storing task solution for task ${task.id}`);

      // Create document from task solution
      const document = {
        content: JSON.stringify(solution, null, 2),
        metadata: {
          taskId: task.id,
          teamId: task.teamId,
          description: task.description,
          type: task.type,
          status: task.status,
          completedAt: task.completedAt,
          ...metadata,
        },
        tags: [
          `type:${task.type}`,
          `team:${task.teamId}`,
          'source:cowork',
        ],
      };

      // Add to RAG knowledge base
      await this.ragService.addDocument(document);

      ragLogger.info(`Task solution stored successfully`);

      return true;
    } catch (error) {
      ragLogger.error('Failed to store task solution:', error);
      return false;
    }
  }

  /**
   * Query for domain knowledge
   *
   * @param {string} domain - Domain name (e.g., "Excel formulas", "Python debugging")
   * @param {string} question - Specific question
   * @returns {Promise<Object>} Domain knowledge
   */
  async queryDomainKnowledge(domain, question) {
    try {
      const query = `${domain}: ${question}`;

      const results = await this.queryKnowledge({
        query,
        taskType: domain,
        limit: 3,
      });

      // Extract relevant knowledge
      const knowledge = results.documents.map((doc) => ({
        content: doc.content,
        source: doc.metadata?.source || 'Unknown',
        relevance: doc.score,
      }));

      return {
        domain,
        question,
        knowledge,
      };
    } catch (error) {
      ragLogger.error('Failed to query domain knowledge:', error);
      return {
        domain,
        question,
        knowledge: [],
      };
    }
  }

  /**
   * Build enhanced query with context
   *
   * @private
   * @param {string} query - Original query
   * @param {string} taskType - Task type
   * @returns {string} Enhanced query
   */
  _buildEnhancedQuery(query, taskType) {
    let enhanced = query;

    // Add task type context
    if (taskType) {
      enhanced = `[Task Type: ${taskType}] ${enhanced}`;
    }

    // Add Cowork context
    enhanced = `[Cowork Multi-Agent System] ${enhanced}`;

    return enhanced;
  }

  /**
   * Process and rank RAG results
   *
   * @private
   * @param {Array} results - Raw RAG results
   * @param {string} query - Original query
   * @returns {Object} Processed results
   */
  _processResults(results, query) {
    // Sort by relevance score
    const sorted = [...results].sort((a, b) => b.score - a.score);

    // Extract key information
    const documents = sorted.map((doc) => ({
      id: doc.id,
      content: doc.content,
      score: doc.score,
      metadata: doc.metadata || {},
    }));

    return {
      query,
      totalResults: documents.length,
      documents,
    };
  }

  /**
   * Clear query cache
   */
  clearCache() {
    this.queryCache.clear();
    ragLogger.info('RAG query cache cleared');
  }

  /**
   * Get cache statistics
   *
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      size: this.queryCache.size,
      expiryMs: this.cacheExpiry,
    };
  }
}

module.exports = CoworkRAGIntegration;
