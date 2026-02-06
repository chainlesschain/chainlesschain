/**
 * Smart Diagnostics - AI-powered failure analysis for browser automation
 *
 * @module browser/diagnostics/smart-diagnostics
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * Diagnosis severity levels
 */
const DiagnosisSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Failure categories
 */
const FailureCategory = {
  ELEMENT_NOT_FOUND: 'element_not_found',
  TIMEOUT: 'timeout',
  NAVIGATION: 'navigation',
  NETWORK: 'network',
  AUTHENTICATION: 'authentication',
  VALIDATION: 'validation',
  STATE_MISMATCH: 'state_mismatch',
  VISUAL_REGRESSION: 'visual_regression',
  UNKNOWN: 'unknown'
};

/**
 * Smart Diagnostics Engine
 * Analyzes failures and provides actionable recommendations
 */
class SmartDiagnostics {
  constructor(options = {}) {
    this.options = {
      useAI: options.useAI !== false,
      aiService: options.aiService,    // LLM service for advanced analysis
      collectMetrics: options.collectMetrics !== false,
      ...options
    };

    this.diagnosticRules = this._getDefaultRules();
  }

  /**
   * Analyze a workflow execution failure
   * @param {Object} execution - Workflow execution data
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} Diagnostic report
   */
  async analyzeExecution(execution, context = {}) {
    const startTime = Date.now();

    try {
      const report = {
        executionId: execution.id,
        workflowId: execution.workflowId,
        timestamp: Date.now(),
        summary: null,
        category: null,
        severity: DiagnosisSeverity.INFO,
        details: {},
        recommendations: [],
        aiAnalysis: null
      };

      // Analyze based on execution status
      if (execution.status === 'completed') {
        report.summary = 'Execution completed successfully';
        report.severity = DiagnosisSeverity.INFO;
        return report;
      }

      // Analyze failure
      const failedSteps = execution.results?.filter(r => !r.success) || [];
      const lastError = execution.errorMessage || failedSteps[0]?.error;

      // Categorize the failure
      report.category = this._categorizeFailure(lastError, execution);
      report.severity = this._determineSeverity(report.category, failedSteps.length);

      // Get rule-based diagnosis
      const ruleDiagnosis = this._applyRules(report.category, lastError, execution);
      report.details = ruleDiagnosis.details;
      report.recommendations = ruleDiagnosis.recommendations;

      // Generate summary
      report.summary = this._generateSummary(report.category, lastError, execution);

      // AI-powered analysis if enabled and available
      if (this.options.useAI && this.options.aiService) {
        try {
          report.aiAnalysis = await this._getAIAnalysis(execution, context);
        } catch (error) {
          logger.warn('[SmartDiagnostics] AI analysis failed', { error: error.message });
        }
      }

      report.processingTime = Date.now() - startTime;

      logger.info('[SmartDiagnostics] Analysis completed', {
        executionId: execution.id,
        category: report.category,
        severity: report.severity
      });

      return report;

    } catch (error) {
      logger.error('[SmartDiagnostics] Analysis failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Analyze a step failure
   * @param {Object} step - Step data
   * @param {Object} result - Step result
   * @param {Object} context - Context (page snapshot, etc.)
   * @returns {Promise<Object>} Step diagnosis
   */
  async analyzeStep(step, result, context = {}) {
    const error = result.error || '';
    const category = this._categorizeFailure(error, { step });

    const diagnosis = {
      stepType: step.type,
      action: step.action,
      category,
      severity: this._determineSeverity(category, 1),
      error,
      possibleCauses: this._getPossibleCauses(category, step, error),
      suggestions: this._getSuggestions(category, step, context)
    };

    return diagnosis;
  }

  /**
   * Get performance diagnostics
   * @param {Object} execution - Execution data
   * @returns {Object} Performance report
   */
  getPerformanceReport(execution) {
    const results = execution.results || [];

    // Calculate step durations
    const stepDurations = [];
    for (let i = 1; i < results.length; i++) {
      const duration = results[i].timestamp - results[i - 1].timestamp;
      stepDurations.push({
        stepIndex: i - 1,
        type: results[i - 1].type,
        duration
      });
    }

    // Find slow steps (> 2 seconds)
    const slowSteps = stepDurations.filter(s => s.duration > 2000);

    // Calculate statistics
    const totalDuration = execution.duration || 0;
    const avgStepDuration = stepDurations.length > 0
      ? stepDurations.reduce((sum, s) => sum + s.duration, 0) / stepDurations.length
      : 0;

    return {
      totalDuration,
      stepCount: results.length,
      avgStepDuration: Math.round(avgStepDuration),
      slowSteps: slowSteps.map(s => ({
        ...s,
        suggestion: 'Consider adding explicit waits or optimizing page load'
      })),
      hasPerformanceIssues: slowSteps.length > 0,
      recommendations: this._getPerformanceRecommendations(stepDurations, slowSteps)
    };
  }

  /**
   * Categorize failure type
   * @private
   */
  _categorizeFailure(error, context) {
    if (!error) return FailureCategory.UNKNOWN;

    const errorLower = error.toLowerCase();

    if (errorLower.includes('timeout') || errorLower.includes('waiting for')) {
      return FailureCategory.TIMEOUT;
    }

    if (errorLower.includes('not found') || errorLower.includes('no element') ||
        errorLower.includes('unable to find') || errorLower.includes('locator resolved')) {
      return FailureCategory.ELEMENT_NOT_FOUND;
    }

    if (errorLower.includes('navigation') || errorLower.includes('net::err') ||
        errorLower.includes('page.goto')) {
      return FailureCategory.NAVIGATION;
    }

    if (errorLower.includes('network') || errorLower.includes('fetch') ||
        errorLower.includes('connection')) {
      return FailureCategory.NETWORK;
    }

    if (errorLower.includes('auth') || errorLower.includes('login') ||
        errorLower.includes('permission') || errorLower.includes('403') ||
        errorLower.includes('401')) {
      return FailureCategory.AUTHENTICATION;
    }

    if (errorLower.includes('validation') || errorLower.includes('invalid') ||
        errorLower.includes('required')) {
      return FailureCategory.VALIDATION;
    }

    if (errorLower.includes('expected') || errorLower.includes('assertion') ||
        errorLower.includes('mismatch')) {
      return FailureCategory.STATE_MISMATCH;
    }

    if (errorLower.includes('visual') || errorLower.includes('screenshot') ||
        errorLower.includes('diff')) {
      return FailureCategory.VISUAL_REGRESSION;
    }

    return FailureCategory.UNKNOWN;
  }

  /**
   * Determine severity based on category and impact
   * @private
   */
  _determineSeverity(category, failedStepCount) {
    const severityMap = {
      [FailureCategory.ELEMENT_NOT_FOUND]: DiagnosisSeverity.ERROR,
      [FailureCategory.TIMEOUT]: DiagnosisSeverity.WARNING,
      [FailureCategory.NAVIGATION]: DiagnosisSeverity.ERROR,
      [FailureCategory.NETWORK]: DiagnosisSeverity.WARNING,
      [FailureCategory.AUTHENTICATION]: DiagnosisSeverity.CRITICAL,
      [FailureCategory.VALIDATION]: DiagnosisSeverity.WARNING,
      [FailureCategory.STATE_MISMATCH]: DiagnosisSeverity.ERROR,
      [FailureCategory.VISUAL_REGRESSION]: DiagnosisSeverity.WARNING,
      [FailureCategory.UNKNOWN]: DiagnosisSeverity.ERROR
    };

    let severity = severityMap[category] || DiagnosisSeverity.ERROR;

    // Escalate if multiple failures
    if (failedStepCount > 3 && severity !== DiagnosisSeverity.CRITICAL) {
      severity = DiagnosisSeverity.CRITICAL;
    }

    return severity;
  }

  /**
   * Apply diagnostic rules
   * @private
   */
  _applyRules(category, error, execution) {
    const rules = this.diagnosticRules[category] || this.diagnosticRules[FailureCategory.UNKNOWN];

    return {
      details: {
        category,
        error,
        failedStep: execution.errorStep,
        currentStep: execution.currentStep,
        totalSteps: execution.totalSteps,
        ruleApplied: rules.name
      },
      recommendations: rules.recommendations.map(rec => ({
        title: rec.title,
        description: rec.description,
        priority: rec.priority || 'medium',
        autoFixable: rec.autoFixable || false
      }))
    };
  }

  /**
   * Generate human-readable summary
   * @private
   */
  _generateSummary(category, error, execution) {
    const summaries = {
      [FailureCategory.ELEMENT_NOT_FOUND]:
        `Step ${execution.errorStep + 1} failed: Could not find the target element on the page`,
      [FailureCategory.TIMEOUT]:
        `Step ${execution.errorStep + 1} timed out waiting for the expected condition`,
      [FailureCategory.NAVIGATION]:
        `Navigation failed: Unable to reach the target page`,
      [FailureCategory.NETWORK]:
        `Network error occurred during execution`,
      [FailureCategory.AUTHENTICATION]:
        `Authentication/permission issue prevented execution`,
      [FailureCategory.VALIDATION]:
        `Validation error: Input data did not meet requirements`,
      [FailureCategory.STATE_MISMATCH]:
        `Page state did not match expected conditions`,
      [FailureCategory.VISUAL_REGRESSION]:
        `Visual differences detected compared to baseline`,
      [FailureCategory.UNKNOWN]:
        `Execution failed with unexpected error`
    };

    return summaries[category] || summaries[FailureCategory.UNKNOWN];
  }

  /**
   * Get possible causes for failure
   * @private
   */
  _getPossibleCauses(category, step, error) {
    const causes = {
      [FailureCategory.ELEMENT_NOT_FOUND]: [
        'Element selector may have changed',
        'Element is loaded dynamically and not yet present',
        'Element is in an iframe or shadow DOM',
        'Page structure has been updated'
      ],
      [FailureCategory.TIMEOUT]: [
        'Page load is slow or network latency',
        'Expected condition never became true',
        'Previous step left page in unexpected state',
        'Popup or modal is blocking'
      ],
      [FailureCategory.NAVIGATION]: [
        'URL may be incorrect or changed',
        'Server is not responding',
        'Redirect loop detected',
        'SSL certificate error'
      ],
      [FailureCategory.NETWORK]: [
        'API endpoint may be down',
        'Network connection interrupted',
        'Request was blocked by CORS',
        'Rate limiting triggered'
      ]
    };

    return causes[category] || ['Unknown root cause'];
  }

  /**
   * Get suggestions for fixing the issue
   * @private
   */
  _getSuggestions(category, step, context) {
    const suggestions = {
      [FailureCategory.ELEMENT_NOT_FOUND]: [
        'Update the element selector using a more stable attribute',
        'Add a wait condition before this step',
        'Check if element is inside iframe or shadow DOM',
        'Take a new snapshot to verify page structure'
      ],
      [FailureCategory.TIMEOUT]: [
        'Increase the step timeout',
        'Add explicit wait for page load',
        'Check for blocking modals or overlays',
        'Verify the expected condition is achievable'
      ]
    };

    return suggestions[category] || ['Review the step configuration'];
  }

  /**
   * Get performance recommendations
   * @private
   */
  _getPerformanceRecommendations(stepDurations, slowSteps) {
    const recommendations = [];

    if (slowSteps.length > 0) {
      recommendations.push({
        title: 'Optimize slow steps',
        description: `${slowSteps.length} step(s) took longer than 2 seconds`,
        priority: 'medium'
      });
    }

    const avgDuration = stepDurations.length > 0
      ? stepDurations.reduce((sum, s) => sum + s.duration, 0) / stepDurations.length
      : 0;

    if (avgDuration > 1000) {
      recommendations.push({
        title: 'Consider parallel execution',
        description: 'Average step duration is high, consider running independent steps in parallel',
        priority: 'low'
      });
    }

    return recommendations;
  }

  /**
   * Get AI-powered analysis
   * @private
   */
  async _getAIAnalysis(execution, context) {
    if (!this.options.aiService) return null;

    const prompt = `Analyze this browser automation failure:
Workflow: ${execution.workflowName || execution.workflowId}
Status: ${execution.status}
Error: ${execution.errorMessage}
Failed at step: ${execution.errorStep + 1} of ${execution.totalSteps}

Provide:
1. Root cause analysis
2. Specific fix recommendations
3. Prevention strategies

Be concise and actionable.`;

    try {
      const response = await this.options.aiService.complete(prompt, {
        maxTokens: 500,
        temperature: 0.3
      });

      return {
        analysis: response,
        model: this.options.aiService.model
      };
    } catch (error) {
      logger.warn('[SmartDiagnostics] AI analysis failed', { error: error.message });
      return null;
    }
  }

  /**
   * Get default diagnostic rules
   * @private
   */
  _getDefaultRules() {
    return {
      [FailureCategory.ELEMENT_NOT_FOUND]: {
        name: 'Element Location Issue',
        recommendations: [
          {
            title: 'Update Element Selector',
            description: 'The element selector may be outdated. Use data-testid or other stable attributes.',
            priority: 'high',
            autoFixable: false
          },
          {
            title: 'Add Wait Condition',
            description: 'Element might be loaded dynamically. Add explicit wait before interacting.',
            priority: 'medium',
            autoFixable: true
          },
          {
            title: 'Check Page Structure',
            description: 'Take a new snapshot to verify the page structure matches expectations.',
            priority: 'medium',
            autoFixable: false
          }
        ]
      },
      [FailureCategory.TIMEOUT]: {
        name: 'Timeout Issue',
        recommendations: [
          {
            title: 'Increase Timeout',
            description: 'The default timeout may be too short for this operation.',
            priority: 'medium',
            autoFixable: true
          },
          {
            title: 'Check Network',
            description: 'Slow network or server response might be causing delays.',
            priority: 'medium',
            autoFixable: false
          }
        ]
      },
      [FailureCategory.UNKNOWN]: {
        name: 'Unclassified Error',
        recommendations: [
          {
            title: 'Review Error Message',
            description: 'Examine the full error message for specific details.',
            priority: 'high',
            autoFixable: false
          },
          {
            title: 'Enable Debugging',
            description: 'Run in debug mode to capture more context.',
            priority: 'medium',
            autoFixable: false
          }
        ]
      }
    };
  }
}

module.exports = {
  SmartDiagnostics,
  DiagnosisSeverity,
  FailureCategory
};
