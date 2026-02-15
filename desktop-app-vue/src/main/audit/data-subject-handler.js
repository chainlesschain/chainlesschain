/**
 * GDPR Data Subject Request Handler
 * Handles access, deletion, rectification, and portability requests.
 * Complies with GDPR Article 12-23 (30-day deadline, audit trail preservation).
 * @module audit/data-subject-handler
 */
const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

const REQUEST_TYPES = ['access', 'deletion', 'rectification', 'portability'];
const STATUSES = ['pending', 'in_progress', 'completed', 'rejected'];
const DEADLINE_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PERSONAL_DATA_TABLES = [
  'knowledge_items', 'conversations', 'messages', 'contacts', 'social_posts',
];

class DataSubjectHandler {
  constructor({ database, auditLogger }) {
    this.db = database;
    this.auditLogger = auditLogger;
    this._initialized = false;
  }

  async _ensureTable() {
    if (this._initialized) return;
    try {
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS data_subject_requests (
          id TEXT PRIMARY KEY,
          request_type TEXT NOT NULL CHECK(request_type IN ('access','deletion','rectification','portability')),
          subject_did TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','rejected')),
          request_data TEXT,
          response_data TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          deadline INTEGER NOT NULL
        )`);
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

  async createRequest(requestType, subjectDid, requestData = {}) {
    try {
      await this._ensureTable();
      if (!REQUEST_TYPES.includes(requestType)) {
        return { success: false, error: `Invalid request type: ${requestType}. Must be one of: ${REQUEST_TYPES.join(', ')}` };
      }
      if (!subjectDid || typeof subjectDid !== 'string') {
        return { success: false, error: 'subject_did is required and must be a string' };
      }
      const id = uuidv4();
      const now = Date.now();
      const deadline = now + DEADLINE_MS;
      await this.db.run(
        `INSERT INTO data_subject_requests (id, request_type, subject_did, status, request_data, created_at, deadline)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        [id, requestType, subjectDid, JSON.stringify(requestData), now, deadline]
      );
      await this._audit('dsr_created', { requestId: id, requestType, subjectDid, timestamp: now });
      logger.info(`[DataSubjectHandler] Created ${requestType} request ${id} for subject ${subjectDid}`);
      return {
        success: true,
        data: { id, request_type: requestType, subject_did: subjectDid, status: 'pending', request_data: requestData, created_at: now, deadline },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to create request:', error);
      return { success: false, error: error.message };
    }
  }

  async listRequests(filters = {}) {
    try {
      await this._ensureTable();
      const conditions = [];
      const params = [];
      if (filters.status) {
        if (!STATUSES.includes(filters.status)) return { success: false, error: `Invalid status filter: ${filters.status}` };
        conditions.push('status = ?');
        params.push(filters.status);
      }
      if (filters.type) {
        if (!REQUEST_TYPES.includes(filters.type)) return { success: false, error: `Invalid type filter: ${filters.type}` };
        conditions.push('request_type = ?');
        params.push(filters.type);
      }
      if (filters.subject) {
        conditions.push('subject_did = ?');
        params.push(filters.subject);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countRow = await this.db.get(`SELECT COUNT(*) as total FROM data_subject_requests ${whereClause}`, params);
      const total = countRow ? countRow.total : 0;
      const page = Math.max(1, filters.page || 1);
      const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
      const offset = (page - 1) * pageSize;
      const rows = await this.db.all(
        `SELECT * FROM data_subject_requests ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );
      const requests = (rows || []).map((row) => this._parseRow(row));
      return {
        success: true,
        data: { requests, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to list requests:', error);
      return { success: false, error: error.message };
    }
  }

  async getRequestDetail(id) {
    try {
      await this._ensureTable();
      if (!id) return { success: false, error: 'Request ID is required' };
      const row = await this.db.get('SELECT * FROM data_subject_requests WHERE id = ?', [id]);
      if (!row) return { success: false, error: `Request not found: ${id}` };
      const request = this._parseRow(row);
      const isOverdue = request.status !== 'completed' && request.status !== 'rejected' && Date.now() > request.deadline;
      return {
        success: true,
        data: { ...request, is_overdue: isOverdue, days_remaining: isOverdue ? 0 : Math.ceil((request.deadline - Date.now()) / DAY_MS) },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to get request detail:', error);
      return { success: false, error: error.message };
    }
  }

  async processRequest(id) {
    try {
      await this._ensureTable();
      const existing = await this.db.get('SELECT * FROM data_subject_requests WHERE id = ?', [id]);
      if (!existing) return { success: false, error: `Request not found: ${id}` };
      if (existing.status !== 'pending') {
        return { success: false, error: `Cannot process request with status '${existing.status}'. Only 'pending' requests can be processed.` };
      }
      await this.db.run(`UPDATE data_subject_requests SET status = 'in_progress' WHERE id = ?`, [id]);
      await this._audit('dsr_processing', { requestId: id, requestType: existing.request_type, subjectDid: existing.subject_did, timestamp: Date.now() });
      logger.info(`[DataSubjectHandler] Processing request ${id}`);
      return { success: true, data: { id, status: 'in_progress' } };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to process request:', error);
      return { success: false, error: error.message };
    }
  }

  async approveRequest(id, responseData = {}) {
    try {
      await this._ensureTable();
      const existing = await this.db.get('SELECT * FROM data_subject_requests WHERE id = ?', [id]);
      if (!existing) return { success: false, error: `Request not found: ${id}` };
      if (existing.status !== 'pending' && existing.status !== 'in_progress') {
        return { success: false, error: `Cannot approve request with status '${existing.status}'. Must be 'pending' or 'in_progress'.` };
      }
      const subjectDid = existing.subject_did;
      const requestType = existing.request_type;
      let actionResult = {};

      switch (requestType) {
        case 'access': {
          const result = await this.exportSubjectData(subjectDid);
          if (!result.success) return { success: false, error: `Failed to gather subject data: ${result.error}` };
          actionResult = { exported_data: result.data };
          break;
        }
        case 'deletion': {
          const result = await this.deleteSubjectData(subjectDid);
          if (!result.success) return { success: false, error: `Failed to delete subject data: ${result.error}` };
          actionResult = { deletion_summary: result.data };
          break;
        }
        case 'rectification': {
          const result = await this._performRectification(subjectDid, responseData);
          if (!result.success) return { success: false, error: `Rectification failed: ${result.error}` };
          actionResult = { rectification_summary: result.data };
          break;
        }
        case 'portability': {
          const result = await this.exportSubjectData(subjectDid);
          if (!result.success) return { success: false, error: `Failed to export subject data: ${result.error}` };
          actionResult = { portable_data: result.data, format: 'application/json', exported_at: Date.now() };
          break;
        }
        default:
          return { success: false, error: `Unknown request type: ${requestType}` };
      }

      const now = Date.now();
      const fullResponseData = { ...responseData, action_result: actionResult, completed_at: now };
      await this.db.run(
        `UPDATE data_subject_requests SET status = 'completed', response_data = ?, completed_at = ? WHERE id = ?`,
        [JSON.stringify(fullResponseData), now, id]
      );
      await this._audit('dsr_approved', { requestId: id, requestType, subjectDid, timestamp: now });
      logger.info(`[DataSubjectHandler] Approved ${requestType} request ${id} for subject ${subjectDid}`);
      return {
        success: true,
        data: { id, status: 'completed', request_type: requestType, response_data: fullResponseData, completed_at: now },
      };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to approve request:', error);
      return { success: false, error: error.message };
    }
  }

  async rejectRequest(id, reason) {
    try {
      await this._ensureTable();
      if (!reason || typeof reason !== 'string') return { success: false, error: 'Rejection reason is required' };
      const existing = await this.db.get('SELECT * FROM data_subject_requests WHERE id = ?', [id]);
      if (!existing) return { success: false, error: `Request not found: ${id}` };
      if (existing.status === 'completed' || existing.status === 'rejected') {
        return { success: false, error: `Cannot reject request with status '${existing.status}'.` };
      }
      const now = Date.now();
      const responseData = JSON.stringify({ rejection_reason: reason, rejected_at: now });
      await this.db.run(
        `UPDATE data_subject_requests SET status = 'rejected', response_data = ?, completed_at = ? WHERE id = ?`,
        [responseData, now, id]
      );
      await this._audit('dsr_rejected', { requestId: id, requestType: existing.request_type, subjectDid: existing.subject_did, reason, timestamp: now });
      logger.info(`[DataSubjectHandler] Rejected request ${id}: ${reason}`);
      return { success: true, data: { id, status: 'rejected', reason, completed_at: now } };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to reject request:', error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Data Operations
  // ========================================

  async exportSubjectData(subjectDid) {
    try {
      if (!subjectDid) return { success: false, error: 'subject_did is required' };
      const exportData = { subject_did: subjectDid, exported_at: Date.now(), tables: {} };
      for (const table of PERSONAL_DATA_TABLES) {
        try {
          const rows = await this.db.all(
            `SELECT * FROM ${table} WHERE subject_did = ? OR user_did = ? OR did = ?`,
            [subjectDid, subjectDid, subjectDid]
          );
          exportData.tables[table] = rows || [];
        } catch (tableError) {
          logger.warn(`[DataSubjectHandler] Could not query table '${table}': ${tableError.message}`);
          exportData.tables[table] = { error: 'Table not accessible', message: tableError.message };
        }
      }
      // Export DSR history for transparency
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
      logger.info(`[DataSubjectHandler] Exported data for subject ${subjectDid} from ${PERSONAL_DATA_TABLES.length} tables`);
      return { success: true, data: exportData };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to export subject data:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteSubjectData(subjectDid) {
    try {
      if (!subjectDid) return { success: false, error: 'subject_did is required' };
      const deletionSummary = { subject_did: subjectDid, deleted_at: Date.now(), tables: {}, total_deleted: 0 };
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
          logger.warn(`[DataSubjectHandler] Could not delete from table '${table}': ${tableError.message}`);
          deletionSummary.tables[table] = { error: tableError.message, deleted: 0 };
        }
      }
      // Audit trail intentionally preserved (GDPR legal requirement)
      await this._audit('dsr_data_deleted', { subjectDid, summary: deletionSummary, timestamp: Date.now() });
      logger.info(`[DataSubjectHandler] Deleted ${deletionSummary.total_deleted} records for subject ${subjectDid}`);
      return { success: true, data: deletionSummary };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to delete subject data:', error);
      return { success: false, error: error.message };
    }
  }

  async getOverdueRequests() {
    try {
      await this._ensureTable();
      const now = Date.now();
      const rows = await this.db.all(
        `SELECT * FROM data_subject_requests WHERE status IN ('pending', 'in_progress') AND deadline < ? ORDER BY deadline ASC`,
        [now]
      );
      const requests = (rows || []).map((row) => {
        const parsed = this._parseRow(row);
        return { ...parsed, days_overdue: Math.ceil((now - parsed.deadline) / DAY_MS) };
      });
      logger.info(`[DataSubjectHandler] Found ${requests.length} overdue requests`);
      return { success: true, data: { overdue_count: requests.length, requests } };
    } catch (error) {
      logger.error('[DataSubjectHandler] Failed to get overdue requests:', error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Internal Helpers
  // ========================================

  async _performRectification(subjectDid, rectificationData) {
    try {
      const updates = rectificationData.updates;
      if (!updates || typeof updates !== 'object') {
        return { success: false, error: 'Rectification requires an "updates" object mapping tables to field changes' };
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
          if (!record.id || !record.fields || typeof record.fields !== 'object') continue;
          const setClauses = [];
          const values = [];
          for (const [field, value] of Object.entries(record.fields)) {
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
              `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ? AND (subject_did = ? OR user_did = ? OR did = ?)`,
              [...values, subjectDid, subjectDid]
            );
            tableUpdated += result ? (result.changes || 0) : 0;
          } catch (updateError) {
            logger.warn(`[DataSubjectHandler] Failed to update record ${record.id} in ${table}: ${updateError.message}`);
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

  async _audit(action, details) {
    if (this.auditLogger) {
      await this.auditLogger.log({ action, ...details });
    }
  }

  _parseRow(row) {
    if (!row) return null;
    return { ...row, request_data: this._safeJsonParse(row.request_data), response_data: this._safeJsonParse(row.response_data) };
  }

  _safeJsonParse(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return str; }
  }
}

module.exports = { DataSubjectHandler };
