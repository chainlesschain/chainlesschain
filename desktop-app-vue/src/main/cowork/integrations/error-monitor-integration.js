/**
 * ErrorMonitor Integration for Cowork
 *
 * Sends Cowork errors to the ErrorMonitor system for AI-powered diagnosis
 * and automatic fix suggestions.
 *
 * @module CoworkErrorMonitorIntegration
 */

const { logger, createLogger } = require('../../utils/logger');

const errorLogger = createLogger('cowork-error-monitor');

class CoworkErrorMonitorIntegration {
  constructor(errorMonitor) {
    this.errorMonitor = errorMonitor;
    this.errorCategories = {
      TASK_EXECUTION: 'task_execution',
      PERMISSION_DENIED: 'permission_denied',
      FILE_OPERATION: 'file_operation',
      DATABASE: 'database',
      IPC: 'ipc',
      AGENT_COMMUNICATION: 'agent_communication',
      SKILL_EXECUTION: 'skill_execution',
    };
  }

  /**
   * Report Cowork error to ErrorMonitor
   *
   * @param {Object} params - Error parameters
   * @param {Error} params.error - Error object
   * @param {string} params.category - Error category
   * @param {Object} params.context - Error context
   * @param {string} params.severity - Error severity (low, medium, high, critical)
   * @returns {Promise<Object>} Error report result
   */
  async reportError(params) {
    const { error, category, context = {}, severity = 'medium' } = params;

    try {
      errorLogger.info(`Reporting error to ErrorMonitor: ${error.message}`);

      // Build error report
      const report = {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        category,
        severity,
        context: {
          ...context,
          component: 'cowork',
          timestamp: Date.now(),
        },
        metadata: {
          teamId: context.teamId,
          taskId: context.taskId,
          agentId: context.agentId,
          operation: context.operation,
        },
      };

      // Send to ErrorMonitor
      const result = await this.errorMonitor.report(report);

      // Log diagnosis if available
      if (result.diagnosis) {
        errorLogger.info(`ErrorMonitor diagnosis: ${result.diagnosis.summary}`);
        if (result.diagnosis.suggestedFix) {
          errorLogger.info(`Suggested fix: ${result.diagnosis.suggestedFix}`);
        }
      }

      return result;
    } catch (reportError) {
      errorLogger.error('Failed to report error to ErrorMonitor:', reportError);
      // Don't throw - error reporting should not break the system
      return { success: false, error: reportError.message };
    }
  }

  /**
   * Report task execution failure
   *
   * @param {Object} task - Failed task
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result with fix suggestions
   */
  async reportTaskFailure(task, error) {
    return await this.reportError({
      error,
      category: this.errorCategories.TASK_EXECUTION,
      context: {
        teamId: task.teamId,
        taskId: task.id,
        taskDescription: task.description,
        taskType: task.type,
        taskInput: task.input,
      },
      severity: task.priority === 'high' || task.priority === 'critical' ? 'high' : 'medium',
    });
  }

  /**
   * Report permission denial
   *
   * @param {Object} params - Permission denial parameters
   * @returns {Promise<Object>} Report result
   */
  async reportPermissionDenied(params) {
    const { teamId, filePath, permission, reason } = params;

    const error = new Error(`Permission denied: ${reason}`);

    return await this.reportError({
      error,
      category: this.errorCategories.PERMISSION_DENIED,
      context: {
        teamId,
        filePath,
        requestedPermission: permission,
        denialReason: reason,
      },
      severity: 'low',  // Permission denials are expected behavior
    });
  }

  /**
   * Report file operation failure
   *
   * @param {Object} params - File operation parameters
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result
   */
  async reportFileOperationFailure(params, error) {
    const { teamId, operation, filePath } = params;

    return await this.reportError({
      error,
      category: this.errorCategories.FILE_OPERATION,
      context: {
        teamId,
        operation,
        filePath,
      },
      severity: 'medium',
    });
  }

  /**
   * Report database error
   *
   * @param {Error} error - Database error
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Report result
   */
  async reportDatabaseError(error, context = {}) {
    return await this.reportError({
      error,
      category: this.errorCategories.DATABASE,
      context: {
        ...context,
        database: 'cowork_sqlite',
      },
      severity: 'high',  // Database errors are serious
    });
  }

  /**
   * Report IPC communication error
   *
   * @param {Error} error - IPC error
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Report result
   */
  async reportIPCError(error, context = {}) {
    return await this.reportError({
      error,
      category: this.errorCategories.IPC,
      context: {
        ...context,
        channel: context.ipcChannel,
      },
      severity: 'high',
    });
  }

  /**
   * Report agent communication failure
   *
   * @param {Object} params - Communication parameters
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result
   */
  async reportAgentCommunicationFailure(params, error) {
    const { teamId, fromAgent, toAgent, messageType } = params;

    return await this.reportError({
      error,
      category: this.errorCategories.AGENT_COMMUNICATION,
      context: {
        teamId,
        fromAgent,
        toAgent,
        messageType,
      },
      severity: 'medium',
    });
  }

  /**
   * Report skill execution failure
   *
   * @param {Object} params - Skill execution parameters
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result
   */
  async reportSkillExecutionFailure(params, error) {
    const { skillName, operation, input } = params;

    return await this.reportError({
      error,
      category: this.errorCategories.SKILL_EXECUTION,
      context: {
        skillName,
        operation,
        input: JSON.stringify(input).substring(0, 500),  // Truncate large inputs
      },
      severity: 'medium',
    });
  }

  /**
   * Get error statistics from ErrorMonitor
   *
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} Error statistics
   */
  async getErrorStats(filters = {}) {
    try {
      const stats = await this.errorMonitor.getStats({
        ...filters,
        component: 'cowork',
      });

      return stats;
    } catch (error) {
      errorLogger.error('Failed to get error stats:', error);
      return {
        total: 0,
        byCategory: {},
        bySeverity: {},
      };
    }
  }

  /**
   * Get AI diagnosis for recent errors
   *
   * @param {number} limit - Number of recent errors to analyze
   * @returns {Promise<Array>} Diagnoses
   */
  async getRecentDiagnoses(limit = 10) {
    try {
      const diagnoses = await this.errorMonitor.getRecentDiagnoses({
        component: 'cowork',
        limit,
      });

      return diagnoses;
    } catch (error) {
      errorLogger.error('Failed to get recent diagnoses:', error);
      return [];
    }
  }

  /**
   * Apply suggested fix for an error
   *
   * @param {string} errorId - Error ID
   * @returns {Promise<Object>} Fix application result
   */
  async applySuggestedFix(errorId) {
    try {
      errorLogger.info(`Applying suggested fix for error: ${errorId}`);

      const result = await this.errorMonitor.applyFix(errorId);

      if (result.success) {
        errorLogger.info(`Fix applied successfully`);
      } else {
        errorLogger.warn(`Fix failed: ${result.reason}`);
      }

      return result;
    } catch (error) {
      errorLogger.error('Failed to apply fix:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = CoworkErrorMonitorIntegration;
