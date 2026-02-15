/**
 * Enterprise Audit System IPC Handlers
 *
 * Provides IPC endpoints for the enterprise audit system including
 * audit logging, compliance management, data subject requests (DSR),
 * and data retention policy management.
 *
 * Endpoints (18 handlers):
 *
 * Audit Log:
 * - audit:query-logs - Query audit logs with filters
 * - audit:get-log-detail - Get detailed audit log entry
 * - audit:export-logs - Export logs in JSON or CSV format
 * - audit:get-statistics - Get audit statistics for a time range
 *
 * Compliance:
 * - compliance:get-policies - List compliance policies
 * - compliance:create-policy - Create a new compliance policy
 * - compliance:update-policy - Update an existing policy
 * - compliance:delete-policy - Delete a compliance policy
 * - compliance:check-compliance - Run compliance check for a framework
 * - compliance:generate-report - Generate compliance report
 *
 * Data Subject Requests (DSR):
 * - dsr:create-request - Create a new data subject request
 * - dsr:list-requests - List DSR requests with filters
 * - dsr:get-request-detail - Get detailed DSR information
 * - dsr:process-request - Process a pending DSR
 * - dsr:approve-request - Approve a DSR with response data
 * - dsr:export-subject-data - Export all data for a subject
 *
 * Retention:
 * - retention:apply-policy - Apply a data retention policy
 * - retention:preview-deletion - Preview what would be deleted
 *
 * @module audit/audit-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger');

/**
 * Register audit system IPC handlers
 * @param {Object} dependencies - Injected dependencies
 * @param {Object} dependencies.database - Database instance
 */
function registerAuditIPC(dependencies) {
  const { database } = dependencies;

  // Lazy-initialize managers
  let auditLogger = null;
  let complianceManager = null;
  let dataSubjectHandler = null;

  function getAuditLogger() {
    if (!auditLogger) {
      const { EnterpriseAuditLogger } = require('./enterprise-audit-logger');
      auditLogger = new EnterpriseAuditLogger({ database });
    }
    return auditLogger;
  }

  function getComplianceManager() {
    if (!complianceManager) {
      const { ComplianceManager } = require('./compliance-manager');
      complianceManager = new ComplianceManager({ database });
    }
    return complianceManager;
  }

  function getDataSubjectHandler() {
    if (!dataSubjectHandler) {
      const { DataSubjectHandler } = require('./data-subject-handler');
      dataSubjectHandler = new DataSubjectHandler({ database });
    }
    return dataSubjectHandler;
  }

  logger.info('[Audit IPC] Registering IPC handlers...');

  // ==================== Audit Log ====================

  /**
   * Query audit logs with filters
   * @channel audit:query-logs
   * @param {Object} filters - Query filters
   * @param {string} [filters.eventType] - Filter by event type
   * @param {string} [filters.actorDid] - Filter by actor DID
   * @param {string} [filters.riskLevel] - Filter by risk level
   * @param {number} [filters.startTime] - Start time (timestamp)
   * @param {number} [filters.endTime] - End time (timestamp)
   * @param {number} [filters.page] - Page number
   * @param {number} [filters.pageSize] - Page size
   * @returns {Object} { success, data: { logs, total, page, pageSize } }
   */
  ipcMain.handle('audit:query-logs', async (event, filters) => {
    try {
      const result = await getAuditLogger().query(filters);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Query logs failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get detailed audit log entry by ID
   * @channel audit:get-log-detail
   * @param {string} id - Audit log entry ID
   * @returns {Object} { success, data: logEntry }
   */
  ipcMain.handle('audit:get-log-detail', async (event, id) => {
    try {
      const result = await getAuditLogger().getLogDetail(id);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Get log detail failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export audit logs in specified format
   * @channel audit:export-logs
   * @param {string} format - Export format ('json' or 'csv')
   * @param {Object} filters - Query filters for export scope
   * @returns {Object} { success, data: { filePath, format, count } }
   */
  ipcMain.handle('audit:export-logs', async (event, format, filters) => {
    try {
      const result = await getAuditLogger().exportLogs(format, filters);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Export logs failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get audit statistics for a time range
   * @channel audit:get-statistics
   * @param {Object} timeRange - Time range for statistics
   * @returns {Object} { success, data: statistics }
   */
  ipcMain.handle('audit:get-statistics', async (event, timeRange) => {
    try {
      const result = await getAuditLogger().getStatistics(timeRange);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Get statistics failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ==================== Compliance ====================

  /**
   * Get compliance policies
   * @channel compliance:get-policies
   * @param {Object} filters - Policy filters
   * @returns {Object} { success, data: policies }
   */
  ipcMain.handle('compliance:get-policies', async (event, filters) => {
    try {
      const result = await getComplianceManager().getPolicies(filters);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Get compliance policies failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Create a new compliance policy
   * @channel compliance:create-policy
   * @param {Object} policyData - Policy configuration data
   * @returns {Object} { success, data: createdPolicy }
   */
  ipcMain.handle('compliance:create-policy', async (event, policyData) => {
    try {
      const result = await getComplianceManager().createPolicy(policyData);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Create compliance policy failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update an existing compliance policy
   * @channel compliance:update-policy
   * @param {string} id - Policy ID
   * @param {Object} updates - Fields to update
   * @returns {Object} { success, data: updatedPolicy }
   */
  ipcMain.handle('compliance:update-policy', async (event, id, updates) => {
    try {
      const result = await getComplianceManager().updatePolicy(id, updates);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Update compliance policy failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete a compliance policy
   * @channel compliance:delete-policy
   * @param {string} id - Policy ID to delete
   * @returns {Object} { success, data: deletionResult }
   */
  ipcMain.handle('compliance:delete-policy', async (event, id) => {
    try {
      const result = await getComplianceManager().deletePolicy(id);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Delete compliance policy failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Run compliance check against a framework
   * @channel compliance:check-compliance
   * @param {string} framework - Compliance framework identifier (e.g. 'GDPR', 'SOC2')
   * @returns {Object} { success, data: complianceResult }
   */
  ipcMain.handle('compliance:check-compliance', async (event, framework) => {
    try {
      const result = await getComplianceManager().checkCompliance(framework);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Check compliance failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Generate compliance report for a framework and date range
   * @channel compliance:generate-report
   * @param {string} framework - Compliance framework identifier
   * @param {Object} dateRange - Report date range { startDate, endDate }
   * @returns {Object} { success, data: report }
   */
  ipcMain.handle('compliance:generate-report', async (event, framework, dateRange) => {
    try {
      const result = await getComplianceManager().generateReport(framework, dateRange);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Generate compliance report failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ==================== Data Subject Requests (DSR) ====================

  /**
   * Create a new data subject request
   * @channel dsr:create-request
   * @param {string} requestType - Type of request (e.g. 'access', 'erasure', 'portability')
   * @param {string} subjectDid - DID of the data subject
   * @param {Object} requestData - Additional request details
   * @returns {Object} { success, data: createdRequest }
   */
  ipcMain.handle('dsr:create-request', async (event, requestType, subjectDid, requestData) => {
    try {
      const result = await getDataSubjectHandler().createRequest(requestType, subjectDid, requestData);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Create DSR failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * List data subject requests with filters
   * @channel dsr:list-requests
   * @param {Object} filters - Request filters
   * @returns {Object} { success, data: requests }
   */
  ipcMain.handle('dsr:list-requests', async (event, filters) => {
    try {
      const result = await getDataSubjectHandler().listRequests(filters);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] List DSR requests failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get detailed information about a data subject request
   * @channel dsr:get-request-detail
   * @param {string} id - Request ID
   * @returns {Object} { success, data: requestDetail }
   */
  ipcMain.handle('dsr:get-request-detail', async (event, id) => {
    try {
      const result = await getDataSubjectHandler().getRequestDetail(id);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Get DSR detail failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Process a pending data subject request
   * @channel dsr:process-request
   * @param {string} id - Request ID to process
   * @returns {Object} { success, data: processResult }
   */
  ipcMain.handle('dsr:process-request', async (event, id) => {
    try {
      const result = await getDataSubjectHandler().processRequest(id);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Process DSR failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Approve a data subject request with response data
   * @channel dsr:approve-request
   * @param {string} id - Request ID to approve
   * @param {Object} responseData - Approval response details
   * @returns {Object} { success, data: approvalResult }
   */
  ipcMain.handle('dsr:approve-request', async (event, id, responseData) => {
    try {
      const result = await getDataSubjectHandler().approveRequest(id, responseData);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Approve DSR failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export all data for a specific data subject
   * @channel dsr:export-subject-data
   * @param {string} subjectDid - DID of the data subject
   * @returns {Object} { success, data: exportResult }
   */
  ipcMain.handle('dsr:export-subject-data', async (event, subjectDid) => {
    try {
      const result = await getDataSubjectHandler().exportSubjectData(subjectDid);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Export subject data failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ==================== Retention ====================

  /**
   * Apply a data retention policy
   * @channel retention:apply-policy
   * @param {string} policyId - Retention policy ID to apply
   * @returns {Object} { success, data: applicationResult }
   */
  ipcMain.handle('retention:apply-policy', async (event, policyId) => {
    try {
      const result = await getAuditLogger().applyRetentionPolicy(policyId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Apply retention policy failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Preview what data would be deleted by a retention policy
   * @channel retention:preview-deletion
   * @param {string} policyId - Retention policy ID to preview
   * @returns {Object} { success, data: previewResult }
   */
  ipcMain.handle('retention:preview-deletion', async (event, policyId) => {
    try {
      const result = await getAuditLogger().previewRetentionDeletion(policyId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[Audit IPC] Preview retention deletion failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info('[Audit IPC] Registered 18 IPC handlers');
}

/**
 * Unregister all audit IPC handlers
 */
function unregisterAuditIPC() {
  const channels = [
    // Audit Log
    'audit:query-logs',
    'audit:get-log-detail',
    'audit:export-logs',
    'audit:get-statistics',
    // Compliance
    'compliance:get-policies',
    'compliance:create-policy',
    'compliance:update-policy',
    'compliance:delete-policy',
    'compliance:check-compliance',
    'compliance:generate-report',
    // Data Subject Requests
    'dsr:create-request',
    'dsr:list-requests',
    'dsr:get-request-detail',
    'dsr:process-request',
    'dsr:approve-request',
    'dsr:export-subject-data',
    // Retention
    'retention:apply-policy',
    'retention:preview-deletion',
  ];

  channels.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  logger.info('[Audit IPC] Unregistered all IPC handlers');
}

module.exports = { registerAuditIPC, unregisterAuditIPC };
