/**
 * Recording Storage - Database persistence for browser recordings
 *
 * @module browser/recording/recording-storage
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../utils/logger');

/**
 * Recording Storage class
 */
class RecordingStorage {
  constructor(db) {
    this.db = db;
  }

  // ==================== Recording CRUD ====================

  /**
   * Save a recording
   * @param {Object} recording - Recording data
   * @returns {Promise<Object>} Saved recording
   */
  async saveRecording(recording) {
    const id = recording.id || uuidv4();
    const now = Date.now();

    const sql = `
      INSERT INTO browser_recordings (
        id, name, description, url, events, screenshots,
        duration, event_count, tags, workflow_id, recording_options,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      recording.name || `Recording ${new Date().toLocaleString()}`,
      recording.description || null,
      recording.startUrl || recording.url,
      JSON.stringify(recording.events || []),
      JSON.stringify(recording.screenshots || []),
      recording.duration || 0,
      recording.events?.length || recording.eventCount || 0,
      JSON.stringify(recording.tags || []),
      recording.workflowId || null,
      JSON.stringify(recording.options || {}),
      now,
      now
    ];

    try {
      this.db.run(sql, params);
      logger.info('[RecordingStorage] Recording saved', { id, name: recording.name });

      return {
        id,
        name: recording.name,
        url: recording.startUrl || recording.url,
        eventCount: recording.events?.length || 0,
        duration: recording.duration,
        createdAt: now
      };
    } catch (error) {
      logger.error('[RecordingStorage] Failed to save recording', { error: error.message });
      throw error;
    }
  }

  /**
   * Get recording by ID
   * @param {string} id - Recording ID
   * @returns {Promise<Object|null>} Recording or null
   */
  async getRecording(id) {
    const sql = `SELECT * FROM browser_recordings WHERE id = ?`;

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind([id]);

      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return this._deserializeRecording(row);
      }

      stmt.free();
      return null;
    } catch (error) {
      logger.error('[RecordingStorage] Failed to get recording', { id, error: error.message });
      throw error;
    }
  }

  /**
   * List recordings
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Recording list
   */
  async listRecordings(options = {}) {
    const { tags, search, limit = 50, offset = 0 } = options;

    let sql = `SELECT * FROM browser_recordings WHERE 1=1`;
    const params = [];

    if (search) {
      sql += ` AND (name LIKE ? OR description LIKE ? OR url LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (tags && tags.length > 0) {
      const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ');
      sql += ` AND (${tagConditions})`;
      tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);

      const recordings = [];
      while (stmt.step()) {
        recordings.push(this._deserializeRecording(stmt.getAsObject()));
      }
      stmt.free();

      return recordings;
    } catch (error) {
      logger.error('[RecordingStorage] Failed to list recordings', { error: error.message });
      throw error;
    }
  }

  /**
   * Update recording
   * @param {string} id - Recording ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated recording
   */
  async updateRecording(id, updates) {
    const allowed = ['name', 'description', 'tags', 'workflowId'];
    const setClauses = [];
    const params = [];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        const dbKey = key === 'workflowId' ? 'workflow_id' : key;
        if (key === 'tags') {
          setClauses.push(`${dbKey} = ?`);
          params.push(JSON.stringify(updates[key]));
        } else {
          setClauses.push(`${dbKey} = ?`);
          params.push(updates[key]);
        }
      }
    }

    if (setClauses.length === 0) {
      return this.getRecording(id);
    }

    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    const sql = `UPDATE browser_recordings SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      this.db.run(sql, params);
      return this.getRecording(id);
    } catch (error) {
      logger.error('[RecordingStorage] Failed to update recording', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Delete recording
   * @param {string} id - Recording ID
   * @returns {Promise<boolean>}
   */
  async deleteRecording(id) {
    const sql = `DELETE FROM browser_recordings WHERE id = ?`;

    try {
      this.db.run(sql, [id]);
      logger.info('[RecordingStorage] Recording deleted', { id });
      return true;
    } catch (error) {
      logger.error('[RecordingStorage] Failed to delete recording', { id, error: error.message });
      throw error;
    }
  }

  // ==================== Baseline Management ====================

  /**
   * Save screenshot baseline
   * @param {Object} baseline - Baseline data
   * @returns {Promise<Object>} Saved baseline
   */
  async saveBaseline(baseline) {
    const id = baseline.id || uuidv4();
    const now = Date.now();

    const sql = `
      INSERT INTO browser_baselines (
        id, name, description, target_url, element_ref,
        screenshot, thumbnail, width, height, hash,
        workflow_id, tags, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      baseline.name,
      baseline.description || null,
      baseline.targetUrl || null,
      baseline.elementRef || null,
      baseline.screenshot,  // Buffer or base64
      baseline.thumbnail || null,
      baseline.width || null,
      baseline.height || null,
      baseline.hash || null,
      baseline.workflowId || null,
      JSON.stringify(baseline.tags || []),
      now,
      now
    ];

    try {
      this.db.run(sql, params);
      logger.info('[RecordingStorage] Baseline saved', { id, name: baseline.name });

      return { id, name: baseline.name, createdAt: now };
    } catch (error) {
      logger.error('[RecordingStorage] Failed to save baseline', { error: error.message });
      throw error;
    }
  }

  /**
   * Get baseline by ID
   * @param {string} id - Baseline ID
   * @returns {Promise<Object|null>}
   */
  async getBaseline(id) {
    const sql = `SELECT * FROM browser_baselines WHERE id = ?`;

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind([id]);

      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return this._deserializeBaseline(row);
      }

      stmt.free();
      return null;
    } catch (error) {
      logger.error('[RecordingStorage] Failed to get baseline', { id, error: error.message });
      throw error;
    }
  }

  /**
   * List baselines
   * @param {Object} options - Filter options
   * @returns {Promise<Array>}
   */
  async listBaselines(options = {}) {
    const { workflowId, limit = 50, offset = 0 } = options;

    let sql = `SELECT id, name, description, target_url, element_ref, width, height, workflow_id, tags, created_at, updated_at
               FROM browser_baselines WHERE 1=1`;
    const params = [];

    if (workflowId) {
      sql += ` AND workflow_id = ?`;
      params.push(workflowId);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);

      const baselines = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        baselines.push({
          id: row.id,
          name: row.name,
          description: row.description,
          targetUrl: row.target_url,
          elementRef: row.element_ref,
          width: row.width,
          height: row.height,
          workflowId: row.workflow_id,
          tags: JSON.parse(row.tags || '[]'),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        });
      }
      stmt.free();

      return baselines;
    } catch (error) {
      logger.error('[RecordingStorage] Failed to list baselines', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete baseline
   * @param {string} id - Baseline ID
   * @returns {Promise<boolean>}
   */
  async deleteBaseline(id) {
    const sql = `DELETE FROM browser_baselines WHERE id = ?`;

    try {
      this.db.run(sql, [id]);
      return true;
    } catch (error) {
      logger.error('[RecordingStorage] Failed to delete baseline', { id, error: error.message });
      throw error;
    }
  }

  // ==================== Screenshot Diff Storage ====================

  /**
   * Save screenshot diff result
   * @param {Object} diff - Diff data
   * @returns {Promise<Object>}
   */
  async saveDiff(diff) {
    const id = diff.id || uuidv4();
    const now = Date.now();

    const sql = `
      INSERT INTO browser_screenshot_diffs (
        id, baseline_id, execution_id, screenshot, diff_image,
        match_percentage, diff_pixels, status, threshold, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      diff.baselineId,
      diff.executionId || null,
      diff.screenshot,
      diff.diffImage || null,
      diff.matchPercentage,
      diff.diffPixels || 0,
      diff.status,
      diff.threshold || 0.95,
      now
    ];

    try {
      this.db.run(sql, params);
      return { id, status: diff.status, matchPercentage: diff.matchPercentage };
    } catch (error) {
      logger.error('[RecordingStorage] Failed to save diff', { error: error.message });
      throw error;
    }
  }

  /**
   * Get diffs for a baseline
   * @param {string} baselineId - Baseline ID
   * @param {Object} options - Filter options
   * @returns {Promise<Array>}
   */
  async getDiffs(baselineId, options = {}) {
    const { limit = 20 } = options;

    const sql = `
      SELECT id, baseline_id, execution_id, match_percentage, diff_pixels, status, threshold, created_at
      FROM browser_screenshot_diffs
      WHERE baseline_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;

    try {
      const stmt = this.db.prepare(sql);
      stmt.bind([baselineId, limit]);

      const diffs = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        diffs.push({
          id: row.id,
          baselineId: row.baseline_id,
          executionId: row.execution_id,
          matchPercentage: row.match_percentage,
          diffPixels: row.diff_pixels,
          status: row.status,
          threshold: row.threshold,
          createdAt: row.created_at
        });
      }
      stmt.free();

      return diffs;
    } catch (error) {
      logger.error('[RecordingStorage] Failed to get diffs', { error: error.message });
      throw error;
    }
  }

  // ==================== Helper Methods ====================

  _deserializeRecording(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      url: row.url,
      events: JSON.parse(row.events || '[]'),
      screenshots: JSON.parse(row.screenshots || '[]'),
      duration: row.duration,
      eventCount: row.event_count,
      tags: JSON.parse(row.tags || '[]'),
      workflowId: row.workflow_id,
      options: JSON.parse(row.recording_options || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  _deserializeBaseline(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      targetUrl: row.target_url,
      elementRef: row.element_ref,
      screenshot: row.screenshot,
      thumbnail: row.thumbnail,
      width: row.width,
      height: row.height,
      hash: row.hash,
      workflowId: row.workflow_id,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = { RecordingStorage };
