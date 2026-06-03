/**
 * SessionManager Integration for Cowork
 *
 * Tracks Cowork team sessions with automatic compression and context management.
 * Integrates with ChainlessChain SessionManager for unified session tracking.
 *
 * @module CoworkSessionIntegration
 */

const { logger, createLogger } = require('../../utils/logger');

const sessionLogger = createLogger('cowork-session');

class CoworkSessionIntegration {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.activeSessions = new Map();  // teamId -> sessionId mapping
  }

  /**
   * Start a new Cowork session for a team
   *
   * @param {Object} team - Team object
   * @returns {Promise<string>} Session ID
   */
  async startSession(team) {
    try {
      sessionLogger.info(`Starting session for team: ${team.name} (${team.id})`);

      // Create session in SessionManager
      const sessionId = await this.sessionManager.createSession({
        type: 'cowork_team',
        title: `${team.name} Collaboration`,
        metadata: {
          teamId: team.id,
          teamName: team.name,
          teamConfig: team.config,
          startedAt: Date.now(),
        },
        tags: [
          'cowork',
          `team:${team.id}`,
          team.config?.category || 'general',
        ],
      });

      // Track active session
      this.activeSessions.set(team.id, sessionId);

      sessionLogger.info(`Session started: ${sessionId}`);

      return sessionId;
    } catch (error) {
      sessionLogger.error('Failed to start session:', error);
      throw error;
    }
  }

  /**
   * Add event to team session
   *
   * @param {string} teamId - Team ID
   * @param {Object} event - Event to add
   * @returns {Promise<void>}
   */
  async addEvent(teamId, event) {
    const sessionId = this.activeSessions.get(teamId);

    if (!sessionId) {
      sessionLogger.warn(`No active session for team: ${teamId}`);
      return;
    }

    try {
      // Format event for session
      const formattedEvent = {
        timestamp: Date.now(),
        type: event.type,
        content: this._formatEventContent(event),
        metadata: event.metadata || {},
      };

      // Add to session
      await this.sessionManager.addEvent(sessionId, formattedEvent);
    } catch (error) {
      sessionLogger.error('Failed to add event to session:', error);
    }
  }

  /**
   * Record agent action in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} action - Agent action
   * @returns {Promise<void>}
   */
  async recordAgentAction(teamId, action) {
    await this.addEvent(teamId, {
      type: 'agent_action',
      content: `Agent ${action.agentName} ${action.action}`,
      metadata: {
        agentId: action.agentId,
        action: action.action,
        result: action.result,
      },
    });
  }

  /**
   * Record task assignment in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} task - Task
   * @returns {Promise<void>}
   */
  async recordTaskAssignment(teamId, task) {
    await this.addEvent(teamId, {
      type: 'task_assignment',
      content: `Task assigned: ${task.description}`,
      metadata: {
        taskId: task.id,
        taskType: task.type,
        priority: task.priority,
        assignedTo: task.assignedTo,
      },
    });
  }

  /**
   * Record task completion in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} task - Completed task
   * @returns {Promise<void>}
   */
  async recordTaskCompletion(teamId, task) {
    await this.addEvent(teamId, {
      type: 'task_completion',
      content: `Task completed: ${task.description}`,
      metadata: {
        taskId: task.id,
        duration: task.completedAt - task.createdAt,
        result: task.result,
      },
    });
  }

  /**
   * Record decision in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} decision - Decision object
   * @returns {Promise<void>}
   */
  async recordDecision(teamId, decision) {
    await this.addEvent(teamId, {
      type: 'team_decision',
      content: `Decision: ${decision.question} → ${decision.result}`,
      metadata: {
        decisionId: decision.id,
        question: decision.question,
        result: decision.result,
        voteCounts: decision.voteCounts,
      },
    });
  }

  /**
   * End team session
   *
   * @param {string} teamId - Team ID
   * @param {Object} summary - Session summary
   * @returns {Promise<void>}
   */
  async endSession(teamId, summary = {}) {
    const sessionId = this.activeSessions.get(teamId);

    if (!sessionId) {
      sessionLogger.warn(`No active session to end for team: ${teamId}`);
      return;
    }

    try {
      sessionLogger.info(`Ending session for team: ${teamId}`);

      // Add summary event
      await this.addEvent(teamId, {
        type: 'session_end',
        content: this._formatSessionSummary(summary),
        metadata: summary,
      });

      // Close session in SessionManager
      await this.sessionManager.closeSession(sessionId);

      // Remove from active sessions
      this.activeSessions.delete(teamId);

      sessionLogger.info(`Session ended: ${sessionId}`);
    } catch (error) {
      sessionLogger.error('Failed to end session:', error);
    }
  }

  /**
   * Get session for team
   *
   * @param {string} teamId - Team ID
   * @returns {Promise<Object|null>} Session object or null
   */
  async getSession(teamId) {
    const sessionId = this.activeSessions.get(teamId);

    if (!sessionId) {
      return null;
    }

    try {
      const session = await this.sessionManager.getSession(sessionId);
      return session;
    } catch (error) {
      sessionLogger.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * Get session history for team
   *
   * @param {string} teamId - Team ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Session history
   */
  async getSessionHistory(teamId, options = {}) {
    try {
      const sessions = await this.sessionManager.querySessions({
        tags: [`team:${teamId}`],
        type: 'cowork_team',
        ...options,
      });

      return sessions;
    } catch (error) {
      sessionLogger.error('Failed to get session history:', error);
      return [];
    }
  }

  /**
   * Compress session using SessionManager auto-compression
   *
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Compression result
   */
  async compressSession(teamId) {
    const sessionId = this.activeSessions.get(teamId);

    if (!sessionId) {
      throw new Error(`No active session for team: ${teamId}`);
    }

    try {
      sessionLogger.info(`Compressing session: ${sessionId}`);

      const result = await this.sessionManager.compressSession(sessionId);

      sessionLogger.info(`Session compressed: saved ${result.compressionRatio}% tokens`);

      return result;
    } catch (error) {
      sessionLogger.error('Failed to compress session:', error);
      throw error;
    }
  }

  /**
   * Search session content
   *
   * @param {string} teamId - Team ID
   * @param {string} query - Search query
   * @returns {Promise<Array>} Search results
   */
  async searchSession(teamId, query) {
    const sessionId = this.activeSessions.get(teamId);

    if (!sessionId) {
      return [];
    }

    try {
      const results = await this.sessionManager.search(sessionId, query);
      return results;
    } catch (error) {
      sessionLogger.error('Failed to search session:', error);
      return [];
    }
  }

  /**
   * Export session
   *
   * @param {string} teamId - Team ID
   * @param {string} format - Export format (json, markdown, pdf)
   * @returns {Promise<Object>} Export result
   */
  async exportSession(teamId, format = 'json') {
    const sessionId = this.activeSessions.get(teamId);

    if (!sessionId) {
      throw new Error(`No active session for team: ${teamId}`);
    }

    try {
      const result = await this.sessionManager.exportSession(sessionId, format);
      return result;
    } catch (error) {
      sessionLogger.error('Failed to export session:', error);
      throw error;
    }
  }

  /**
   * Format event content for session
   *
   * @private
   * @param {Object} event - Event object
   * @returns {string} Formatted content
   */
  _formatEventContent(event) {
    switch (event.type) {
      case 'agent_action':
        return `🤖 ${event.content}`;
      case 'task_assignment':
        return `📋 ${event.content}`;
      case 'task_completion':
        return `✅ ${event.content}`;
      case 'team_decision':
        return `🗳️ ${event.content}`;
      case 'error':
        return `⚠️ ${event.content}`;
      default:
        return event.content;
    }
  }

  /**
   * Format session summary
   *
   * @private
   * @param {Object} summary - Summary object
   * @returns {string} Formatted summary
   */
  _formatSessionSummary(summary) {
    const parts = [];

    parts.push(`## Team Collaboration Session Summary`);

    if (summary.totalTasks) {
      parts.push(`\n**Tasks**: ${summary.completedTasks}/${summary.totalTasks} completed`);
    }

    if (summary.totalAgents) {
      parts.push(`**Agents**: ${summary.totalAgents}`);
    }

    if (summary.decisions) {
      parts.push(`**Decisions Made**: ${summary.decisions}`);
    }

    if (summary.duration) {
      const hours = Math.floor(summary.duration / 3600000);
      const minutes = Math.floor((summary.duration % 3600000) / 60000);
      parts.push(`**Duration**: ${hours}h ${minutes}m`);
    }

    return parts.join('\n');
  }

  /**
   * Get active session count
   *
   * @returns {number} Number of active sessions
   */
  getActiveSessionCount() {
    return this.activeSessions.size;
  }

  /**
   * Check if team has active session
   *
   * @param {string} teamId - Team ID
   * @returns {boolean} True if session is active
   */
  hasActiveSession(teamId) {
    return this.activeSessions.has(teamId);
  }
}

module.exports = CoworkSessionIntegration;
