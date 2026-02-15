/**
 * Data Subject Request Handler
 *
 * Handles GDPR Data Subject Requests (DSR) including:
 * - Access requests (right to access)
 * - Deletion requests (right to erasure / right to be forgotten)
 * - Rectification requests (right to rectification)
 * - Portability requests (right to data portability)
 *
 * Complies with GDPR Article 12-23 requirements including
 * 30-day response deadline and audit trail preservation.
 *
 * @module audit/data-subject-handler
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

const REQUEST_TYPES = ['access', 'deletion', 'rectification', 'portability'];
const STATUSES = ['pending', 'in_progress', 'completed', 'rejected'];
const DEADLINE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// Tables that contain personal data subject to DSR operations
const PERSONAL_DATA_TABLES = [
  'knowledge_items',
  'conversations',
  'messages',
  'contacts',
  'social_posts',
];

class DataSubjectHandler {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database instance with run/get/all methods
   * @param {Object} options.auditLogger - Audit logger for recording DSR operations
   */
  constructor({ database, auditLogger }) {
    this.db = database;
    this.auditLogger = auditLogger;
    this._initialized = false;
  }

  /**
   * Initialize the data_subject_requests table if it does not exist.
   */
  async _ensureTable() {
    if (this._initialized) return;

    try {
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS data_subject_requests (
          id TEXT PRIMARY KEY,
          request_type TEXT NOT NULL CHECK(request_type IN ('access', 'deletion', 'rectification', 'portability')),
          subject_did TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'rejected')),
          request_data TEXT,
          response_data TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          deadline INTEGER NOT NULL
        )
      `);
      this._initialized = true;
      logger.info('[DataSubjectHandler] Table initialized');
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to initialize table:', error);
      throw error;
    }
  }

  // ========================================
  // Request Lifecycle
  // ========================================

  /**
   * Create a new Data Subject Request.
   *
   * @param {string} requestType - One of 'access', 'deletion', 'rectification', 'portability'
   * @param {string} subjectDid - DID identifier of the data subject
   * @param {Object} [requestData={}] - Additional request details
   * @returns {Promise<Object>} Result with the created request
   */
  async createRequest(requestType, subjectDid, requestData = {}) {
    try {
      await this._ensureTable();

      if (!REQUEST_TYPES.includes(requestType)) {
        return {
          success: false,
          error: `Invalid request type: ${requestType}. Must be one of: ${REQUEST_TYPES.join(', ')}`,
        };
      }

      if (!subjectDid || typeof subjectDid !== 'string') {
        return { success: false, error: 'subject_did is required and must be a string' };
      }

      const id = uuidv4();
      const now = Date.now();
      const deadline = now + DEADLINE_MS;

      await this.db.run(
        `INSERT INTO data_subject_requests
          (id, request_type, subject_did, status, request_data, created_at, deadline)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        [id, requestType, subjectDid, JSON.stringify(requestData), now, deadline]
      );

      if (this.auditLogger) {
        await this.auditLogger.log({
          action: 'dsr_created',
          requestId: id,
          requestType,
          subjectDid,
          timestamp: now,
        });
      }

      logger.info(
        `[DataSubjectHandler] Created ${requestType} request ${id} for subject ${subjectDid}`
      );

      return {
        success: true,
        data: {
          id,
          request_type: requestType,
          subject_did: subjectDid,
          status: 'pending',
          request_data: requestData,
          created_at: now,
          deadline,
        },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to create request:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * List Data Subject Requests with optional filtering and pagination.
   *
   * @param {Object} [filters={}] - Filter criteria
   * @param {string} [filters.status] - Filter by status
   * @param {string} [filters.type] - Filter by request type
   * @param {string} [filters.subject] - Filter by subject DID
   * @param {number} [filters.page=1] - Page number (1-based)
   * @param {number} [filters.pageSize=20] - Number of results per page
   * @returns {Promise<Object>} Paginated list of requests
   */
  async listRequests(filters = {}) {
    try {
      await this._ensureTable();

      const conditions = [];
      const params = [];

      if (filters.status) {
        if (!STATUSES.includes(filters.status)) {
          return { success: false, error: `Invalid status filter: ${filters.status}` };
        }
        conditions.push('status = ?');
        params.push(filters.status);
      }

      if (filters.type) {
        if (!REQUEST_TYPES.includes(filters.type)) {
          return { success: false, error: `Invalid type filter: ${filters.type}` };
        }
        conditions.push('request_type = ?');
        params.push(filters.type);
      }

      if (filters.subject) {
        conditions.push('subject_did = ?');
        params.push(filters.subject);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countRow = await this.db.get(
        `SELECT COUNT(*) as total FROM data_subject_requests ${whereClause}`,
        params
      );
      const total = countRow ? countRow.total : 0;

      // Pagination
      const page = Math.max(1, filters.page || 1);
      const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
      const offset = (page - 1) * pageSize;

      const paginatedParams = [...params, pageSize, offset];
      const rows = await this.db.all(
        `SELECT * FROM data_subject_requests ${whereClause}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        paginatedParams
      );

      // Parse JSON fields
      const requests = (rows || []).map((row) => this._parseRow(row));

      return {
        success: true,
        data: {
          requests,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to list requests:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get full detail of a single Data Subject Request.
   *
   * @param {string} id - Request ID
   * @returns {Promise<Object>} Request detail
   */
  async getRequestDetail(id) {
    try {
      await this._ensureTable();

      if (!id) {
        return { success: false, error: 'Request ID is required' };
      }

      const row = await this.db.get(
        'SELECT * FROM data_subject_requests WHERE id = ?',
        [id]
      );

      if (!row) {
        return { success: false, error: `Request not found: ${id}` };
      }

      const request = this._parseRow(row);
      const isOverdue = request.status !== 'completed' &&
        request.status !== 'rejected' &&
        Date.now() > request.deadline;

      return {
        success: true,
        data: {
          ...request,
          is_overdue: isOverdue,
          days_remaining: isOverdue ? 0 : Math.ceil((request.deadline - Date.now()) / (24 * 60 * 60 * 1000)),
        },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to get request detail:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start processing a request (set status to 'in_progress').
   *
   * @param {string} id - Request ID
   * @returns {Promise<Object>} Updated request
   */
  async processRequest(id) {
    try {
      await this._ensureTable();

      const existing = await this.db.get(
        'SELECT * FROM data_subject_requests WHERE id = ?',
        [id]
      );

      if (!existing) {
        return { success: false, error: `Request not found: ${id}` };
      }

      if (existing.status !== 'pending') {
        return {
          success: false,
          error: `Cannot process request with status '${existing.status}'. Only 'pending' requests can be processed.`,
        };
      }

      await this.db.run(
        `UPDATE data_subject_requests SET status = 'in_progress' WHERE id = ?`,
        [id]
      );

      if (this.auditLogger) {
        await this.auditLogger.log({
          action: 'dsr_processing',
          requestId: id,
          requestType: existing.request_type,
          subjectDid: existing.subject_did,
          timestamp: Date.now(),
        });
      }

      logger.info(`[DataSubjectHandler] Processing request ${id}`);

      return {
        success: true,
        data: { id, status: 'in_progress' },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to process request:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Approve and complete a Data Subject Request.
   *
   * Executes the appropriate action based on request type:
   * - access: gathers all user data
   * - deletion: removes all user data (preserving audit trail)
   * - rectification: updates specified fields
   * - portability: exports data as JSON package
   *
   * @param {string} id - Request ID
   * @param {Object} [responseData={}] - Response or action-specific data
   * @returns {Promise<Object>} Completion result
   */
  async approveRequest(id, responseData = {}) {
    try {
      await this._ensureTable();

      const existing = await this.db.get(
        'SELECT * FROM data_subject_requests WHERE id = ?',
        [id]
      );

      if (!existing) {
        return { success: false, error: `Request not found: ${id}` };
      }

      if (existing.status !== 'pending' && existing.status !== 'in_progress') {
        return {
          success: false,
          error: `Cannot approve request with status '${existing.status}'. Must be 'pending' or 'in_progress'.`,
        };
      }

      const subjectDid = existing.subject_did;
      const requestType = existing.request_type;
      let actionResult = {};

      // Execute the appropriate action based on request type
      switch (requestType) {
        case 'access': {
          const exportResult = await this.exportSubjectData(subjectDid);
          if (!exportResult.success) {
            return { success: false, error: `Failed to gather subject data: ${exportResult.error}` };
          }
          actionResult = { exported_data: exportResult.data };
          break;
        }

        case 'deletion': {
          const deleteResult = await this.deleteSubjectData(subjectDid);
          if (!deleteResult.success) {
            return { success: false, error: `Failed to delete subject data: ${deleteResult.error}` };
          }
          actionResult = { deletion_summary: deleteResult.data };
          break;
        }

        case 'rectification': {
          const rectifyResult = await this._performRectification(subjectDid, responseData);
          if (!rectifyResult.success) {
            return { success: false, error: `Rectification failed: ${rectifyResult.error}` };
          }
          actionResult = { rectification_summary: rectifyResult.data };
          break;
        }

        case 'portability': {
          const exportResult = await this.exportSubjectData(subjectDid);
          if (!exportResult.success) {
            return { success: false, error: `Failed to export subject data: ${exportResult.error}` };
          }
          actionResult = {
            portable_data: exportResult.data,
            format: 'application/json',
            exported_at: Date.now(),
          };
          break;
        }

        default:
          return { success: false, error: `Unknown request type: ${requestType}` };
      }

      const now = Date.now();
      const fullResponseData = {
        ...responseData,
        action_result: actionResult,
        completed_at: now,
      };

      await this.db.run(
        `UPDATE data_subject_requests
         SET status = 'completed', response_data = ?, completed_at = ?
         WHERE id = ?`,
        [JSON.stringify(fullResponseData), now, id]
      );

      if (this.auditLogger) {
        await this.auditLogger.log({
          action: 'dsr_approved',
          requestId: id,
          requestType,
          subjectDid,
          timestamp: now,
        });
      }

      logger.info(
        `[DataSubjectHandler] Approved ${requestType} request ${id} for subject ${subjectDid}`
      );

      return {
        success: true,
        data: {
          id,
          status: 'completed',
          request_type: requestType,
          response_data: fullResponseData,
          completed_at: now,
        },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to approve request:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject a Data Subject Request with a reason.
   *
   * @param {string} id - Request ID
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} Rejection result
   */
  async rejectRequest(id, reason) {
    try {
      await this._ensureTable();

      if (!reason || typeof reason !== 'string') {
        return { success: false, error: 'Rejection reason is required' };
      }

      const existing = await this.db.get(
        'SELECT * FROM data_subject_requests WHERE id = ?',
        [id]
      );

      if (!existing) {
        return { success: false, error: `Request not found: ${id}` };
      }

      if (existing.status === 'completed' || existing.status === 'rejected') {
        return {
          success: false,
          error: `Cannot reject request with status '${existing.status}'.`,
        };
      }

      const now = Date.now();
      const responseData = JSON.stringify({ rejection_reason: reason, rejected_at: now });

      await this.db.run(
        `UPDATE data_subject_requests
         SET status = 'rejected', response_data = ?, completed_at = ?
         WHERE id = ?`,
        [responseData, now, id]
      );

      if (this.auditLogger) {
        await this.auditLogger.log({
          action: 'dsr_rejected',
          requestId: id,
          requestType: existing.request_type,
          subjectDid: existing.subject_did,
          reason,
          timestamp: now,
        });
      }

      logger.info(
        `[DataSubjectHandler] Rejected request ${id}: ${reason}`
      );

      return {
        success: true,
        data: {
          id,
          status: 'rejected',
          reason,
          completed_at: now,
        },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to reject request:', error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Data Operations
  // ========================================

  /**
   * Export all personal data for a given subject.
   *
   * Queries multiple tables that may contain personal data:
   * knowledge_items, conversations, messages, contacts, social_posts.
   *
   * @param {string} subjectDid - DID identifier of the data subject
   * @returns {Promise<Object>} Structured JSON containing all subject data
   */
  async exportSubjectData(subjectDid) {
    try {
      if (!subjectDid) {
        return { success: false, error: 'subject_did is required' };
      }

      const exportData = {
        subject_did: subjectDid,
        exported_at: Date.now(),
        tables: {},
      };

      for (const table of PERSONAL_DATA_TABLES) {
        try {
          const rows = await this.db.all(
            `SELECT * FROM ${table} WHERE subject_did = ? OR user_did = ? OR did = ?`,
            [subjectDid, subjectDid, subjectDid]
          );
          exportData.tables[table] = rows || [];
        } catch (tableError) {
          // Table may not exist or may not have the expected columns
          logger.warn(
            `[DataSubjectHandler] Could not query table '${table}': ${tableError.message}`
          );
          exportData.tables[table] = { error: 'Table not accessible', message: tableError.message };
        }
      }

      // Also export any DSR history for this subject (transparency)
      try {
        const dsrHistory = await this.db.all(
          'SELECT id, request_type, status, created_at, completed_at FROM data_subject_requests WHERE subject_did = ?',
          [subjectDid]
        );
        exportData.dsr_history = dsrHistory || [];
      } catch (dsrError) {
        logger.warn(`[DataSubjectHandler] Could not export DSR history: ${dsrError.message}`);
        exportData.dsr_history = [];
      }

      logger.info(
        `[DataSubjectHandler] Exported data for subject ${subjectDid} from ${PERSONAL_DATA_TABLES.length} tables`
      );

      return { success: true, data: exportData };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to export subject data:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete all personal data for a given subject.
   *
   * Removes data from all personal data tables but preserves
   * the audit trail (DSR records) as required by law.
   *
   * @param {string} subjectDid - DID identifier of the data subject
   * @returns {Promise<Object>} Deletion summary with counts per table
   */
  async deleteSubjectData(subjectDid) {
    try {
      if (!subjectDid) {
        return { success: false, error: 'subject_did is required' };
      }

      const deletionSummary = {
        subject_did: subjectDid,
        deleted_at: Date.now(),
        tables: {},
        total_deleted: 0,
      };

      for (const table of PERSONAL_DATA_TABLES) {
        try {
          const result = await this.db.run(
            `DELETE FROM ${table} WHERE subject_did = ? OR user_did = ? OR did = ?`,
            [subjectDid, subjectDid, subjectDid]
          );
          const deletedCount = result ? (result.changes || 0) : 0;
          deletionSummary.tables[table] = { deleted: deletedCount };
          deletionSummary.total_deleted += deletedCount;
        } catch (tableError) {
          logger.warn(
            `[DataSubjectHandler] Could not delete from table '${table}': ${tableError.message}`
          );
          deletionSummary.tables[table] = { error: tableError.message, deleted: 0 };
        }
      }

      // Audit trail is intentionally preserved (legal requirement under GDPR)
      // data_subject_requests records are NOT deleted

      if (this.auditLogger) {
        await this.auditLogger.log({
          action: 'dsr_data_deleted',
          subjectDid,
          summary: deletionSummary,
          timestamp: Date.now(),
        });
      }

      logger.info(
        `[DataSubjectHandler] Deleted ${deletionSummary.total_deleted} records for subject ${subjectDid}`
      );

      return { success: true, data: deletionSummary };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to delete subject data:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find all requests that are past their 30-day GDPR deadline.
   *
   * @returns {Promise<Object>} List of overdue requests
   */
  async getOverdueRequests() {
    try {
      await this._ensureTable();

      const now = Date.now();
      const rows = await this.db.all(
        `SELECT * FROM data_subject_requests
         WHERE status IN ('pending', 'in_progress') AND deadline < ?
         ORDER BY deadline ASC`,
        [now]
      );

      const requests = (rows || []).map((row) => {
        const parsed = this._parseRow(row);
        return {
          ...parsed,
          days_overdue: Math.ceil((now - parsed.deadline) / (24 * 60 * 60 * 1000)),
        };
      });

      logger.info(`[DataSubjectHandler] Found ${requests.length} overdue requests`);

      return {
        success: true,
        data: {
          overdue_count: requests.length,
          requests,
        },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to get overdue requests:', error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Internal Helpers
  // ========================================

  /**
   * Perform rectification by updating specified fields for a subject.
   *
   * @param {string} subjectDid - DID of the data subject
   * @param {Object} rectificationData - Fields to update, keyed by table name
   * @param {Object} [rectificationData.updates] - Map of table -> [{id, fields: {key: value}}]
   * @returns {Promise<Object>} Rectification summary
   * @private
   */
  async _performRectification(subjectDid, rectificationData) {
    try {
      const updates = rectificationData.updates;
      if (!updates || typeof updates !== 'object') {
        return {
          success: false,
          error: 'Rectification requires an "updates" object mapping tables to field changes',
        };
      }

      const summary = { tables: {}, total_updated: 0 };

      for (const [table, records] of Object.entries(updates)) {
        if (!PERSONAL_DATA_TABLES.includes(table)) {
          summary.tables[table] = { error: `Table '${table}' is not a recognized personal data table` };
          continue;
        }

        if (!Array.isArray(records)) {
          summary.tables[table] = { error: 'Records must be an array' };
          continue;
        }

        let tableUpdated = 0;

        for (const record of records) {
          if (!record.id || !record.fields || typeof record.fields !== 'object') {
            continue;
          }

          const setClauses = [];
          const values = [];

          for (const [field, value] of Object.entries(record.fields)) {
            // Prevent SQL injection by only allowing alphanumeric field names
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
              logger.warn(`[DataSubjectHandler] Skipping invalid field name: ${field}`);
              continue;
            }
            setClauses.push(`${field} = ?`);
            values.push(value);
          }

          if (setClauses.length === 0) continue;

          values.push(record.id, subjectDid);

          try {
            const result = await this.db.run(
              `UPDATE ${table} SET ${setClauses.join(', ')}
               WHERE id = ? AND (subject_did = ? OR user_did = ? OR did = ?)`,
              [...values, subjectDid, subjectDid]
            );
            tableUpdated += result ? (result.changes || 0) : 0;
          } catch (updateError) {
            logger.warn(
              `[DataSubjectHandler] Failed to update record ${record.id} in ${table}: ${updateError.message}`
            );
          }
        }

        summary.tables[table] = { updated: tableUpdated };
        summary.total_updated += tableUpdated;
      }

      return { success: true, data: summary };
    } catch (error) {
      logger.error('[DataSubjectHandler] Rectification failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse a database row, deserializing JSON fields.
   *
   * @param {Object} row - Raw database row
   * @returns {Object} Parsed row with deserialized JSON fields
   * @private
   */
  _parseRow(row) {
    if (!row) return null;

    return {
      ...row,
      request_data: this._safeJsonParse(row.request_data),
      response_data: this._safeJsonParse(row.response_data),
    };
  }

  /**
   * Safely parse a JSON string, returning null on failure.
   *
   * @param {string|null} str - JSON string to parse
   * @returns {Object|null} Parsed object or null
   * @private
   */
  _safeJsonParse(str) {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}

module.exports = { DataSubjectHandler };
