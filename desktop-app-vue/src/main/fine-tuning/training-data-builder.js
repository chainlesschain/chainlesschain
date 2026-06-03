'use strict';

/**
 * Training Data Builder - Extract and format training data from knowledge base
 *
 * Extracts conversation pairs, notes, and custom data from the local SQLite
 * database, then converts them into standard fine-tuning formats (JSONL, Alpaca).
 *
 * @module fine-tuning/training-data-builder
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');

class TrainingDataBuilder {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database manager instance
   */
  constructor({ database } = {}) {
    this.database = database || null;
  }

  /**
   * Extract training data from chat conversations.
   *
   * Pairs consecutive user messages with assistant responses to form
   * instruction/input/output triples suitable for supervised fine-tuning.
   *
   * @param {Object} [filters={}] - Optional filters
   * @param {string} [filters.conversationId] - Limit to a specific conversation
   * @param {number} [filters.minLength] - Minimum response length in characters
   * @param {number} [filters.limit] - Maximum number of pairs to return
   * @param {number} [filters.since] - Unix timestamp lower bound
   * @returns {Array<{instruction: string, input: string, output: string}>}
   */
  extractFromConversations(filters = {}) {
    if (!this.database) {
      logger.warn('[TrainingDataBuilder] No database available');
      return [];
    }

    try {
      const db = this.database.db || this.database;

      let query = `
        SELECT m.role, m.content, m.conversation_id, m.created_at
        FROM chat_messages m
      `;
      const conditions = [];
      const params = [];

      if (filters.conversationId) {
        conditions.push('m.conversation_id = ?');
        params.push(filters.conversationId);
      }
      if (filters.since) {
        conditions.push('m.created_at >= ?');
        params.push(filters.since);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY m.conversation_id, m.created_at ASC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit * 2); // We need pairs, so fetch double
      }

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);

      const pairs = [];
      let currentUserMessage = null;

      for (const row of rows) {
        if (row.role === 'user') {
          currentUserMessage = row.content || '';
        } else if (row.role === 'assistant' && currentUserMessage !== null) {
          const output = row.content || '';

          if (filters.minLength && output.length < filters.minLength) {
            currentUserMessage = null;
            continue;
          }

          pairs.push({
            instruction: currentUserMessage,
            input: '',
            output: output,
          });

          currentUserMessage = null;
        }
      }

      const result = filters.limit ? pairs.slice(0, filters.limit) : pairs;
      logger.info(`[TrainingDataBuilder] Extracted ${result.length} conversation pairs`);
      return result;
    } catch (error) {
      logger.error('[TrainingDataBuilder] Failed to extract conversations:', error.message);
      return [];
    }
  }

  /**
   * Extract training data from notes.
   *
   * Converts notes into Q&A-style training pairs by using the title as the
   * instruction and the note body as the output.
   *
   * @param {Object} [filters={}] - Optional filters
   * @param {string} [filters.category] - Filter by note category
   * @param {number} [filters.minLength] - Minimum content length
   * @param {number} [filters.limit] - Maximum number of pairs
   * @param {number} [filters.since] - Unix timestamp lower bound
   * @returns {Array<{instruction: string, input: string, output: string}>}
   */
  extractFromNotes(filters = {}) {
    if (!this.database) {
      logger.warn('[TrainingDataBuilder] No database available');
      return [];
    }

    try {
      const db = this.database.db || this.database;

      let query = 'SELECT title, content, category, created_at FROM notes';
      const conditions = [];
      const params = [];

      if (filters.category) {
        conditions.push('category = ?');
        params.push(filters.category);
      }
      if (filters.since) {
        conditions.push('created_at >= ?');
        params.push(filters.since);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);

      const pairs = [];

      for (const row of rows) {
        const title = (row.title || '').trim();
        const content = (row.content || '').trim();

        if (!title || !content) {
          continue;
        }

        if (filters.minLength && content.length < filters.minLength) {
          continue;
        }

        pairs.push({
          instruction: title,
          input: '',
          output: content,
        });
      }

      logger.info(`[TrainingDataBuilder] Extracted ${pairs.length} note pairs`);
      return pairs;
    } catch (error) {
      logger.error('[TrainingDataBuilder] Failed to extract notes:', error.message);
      return [];
    }
  }

  /**
   * Write training data as a JSONL file.
   *
   * Each line contains a JSON object with instruction, input, and output fields.
   *
   * @param {Array<{instruction: string, input: string, output: string}>} data
   * @param {string} outputPath - Destination file path
   * @returns {{ path: string, recordCount: number, sizeBytes: number }}
   */
  formatAsJSONL(data, outputPath) {
    if (!data || data.length === 0) {
      logger.warn('[TrainingDataBuilder] No data to write for JSONL');
      return { path: outputPath, recordCount: 0, sizeBytes: 0 };
    }

    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const lines = data.map((item) =>
        JSON.stringify({
          instruction: item.instruction,
          input: item.input || '',
          output: item.output,
        })
      );

      const content = lines.join('\n') + '\n';
      fs.writeFileSync(outputPath, content, 'utf-8');

      const stats = fs.statSync(outputPath);

      logger.info(`[TrainingDataBuilder] Wrote ${data.length} records to JSONL: ${outputPath}`);
      return {
        path: outputPath,
        recordCount: data.length,
        sizeBytes: stats.size,
      };
    } catch (error) {
      logger.error('[TrainingDataBuilder] Failed to write JSONL:', error.message);
      throw error;
    }
  }

  /**
   * Write training data in Alpaca format (JSON array).
   *
   * Writes a single JSON file containing an array of
   * { instruction, input, output } objects.
   *
   * @param {Array<{instruction: string, input: string, output: string}>} data
   * @param {string} outputPath - Destination file path
   * @returns {{ path: string, recordCount: number, sizeBytes: number }}
   */
  formatAsAlpaca(data, outputPath) {
    if (!data || data.length === 0) {
      logger.warn('[TrainingDataBuilder] No data to write for Alpaca');
      return { path: outputPath, recordCount: 0, sizeBytes: 0 };
    }

    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const alpacaData = data.map((item) => ({
        instruction: item.instruction,
        input: item.input || '',
        output: item.output,
      }));

      const content = JSON.stringify(alpacaData, null, 2);
      fs.writeFileSync(outputPath, content, 'utf-8');

      const stats = fs.statSync(outputPath);

      logger.info(`[TrainingDataBuilder] Wrote ${data.length} records to Alpaca: ${outputPath}`);
      return {
        path: outputPath,
        recordCount: data.length,
        sizeBytes: stats.size,
      };
    } catch (error) {
      logger.error('[TrainingDataBuilder] Failed to write Alpaca format:', error.message);
      throw error;
    }
  }

  /**
   * Validate training data quality.
   *
   * Checks for empty fields, minimum lengths, and duplicates, returning
   * a structured report with valid flag, errors, warnings, and stats.
   *
   * @param {Array<{instruction: string, input: string, output: string}>} data
   * @returns {{ valid: boolean, errors: string[], warnings: string[], stats: Object }}
   */
  validateData(data) {
    const errors = [];
    const warnings = [];
    const stats = {
      totalRecords: 0,
      validRecords: 0,
      emptyInstructions: 0,
      emptyOutputs: 0,
      shortOutputs: 0,
      duplicates: 0,
      avgInstructionLength: 0,
      avgOutputLength: 0,
    };

    if (!Array.isArray(data)) {
      errors.push('Data must be an array');
      return { valid: false, errors, warnings, stats };
    }

    stats.totalRecords = data.length;

    if (data.length === 0) {
      errors.push('Data array is empty');
      return { valid: false, errors, warnings, stats };
    }

    const seenInstructions = new Set();
    let totalInstructionLength = 0;
    let totalOutputLength = 0;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      let itemValid = true;

      if (!item.instruction || item.instruction.trim().length === 0) {
        stats.emptyInstructions++;
        errors.push(`Record ${i}: empty instruction`);
        itemValid = false;
      }

      if (!item.output || item.output.trim().length === 0) {
        stats.emptyOutputs++;
        errors.push(`Record ${i}: empty output`);
        itemValid = false;
      }

      if (item.output && item.output.trim().length > 0 && item.output.trim().length < 10) {
        stats.shortOutputs++;
        warnings.push(`Record ${i}: output is very short (${item.output.trim().length} chars)`);
      }

      if (item.instruction && seenInstructions.has(item.instruction.trim())) {
        stats.duplicates++;
        warnings.push(`Record ${i}: duplicate instruction`);
      }

      if (item.instruction) {
        seenInstructions.add(item.instruction.trim());
        totalInstructionLength += item.instruction.length;
      }

      if (item.output) {
        totalOutputLength += item.output.length;
      }

      if (itemValid) {
        stats.validRecords++;
      }
    }

    stats.avgInstructionLength = data.length > 0
      ? Math.round(totalInstructionLength / data.length)
      : 0;
    stats.avgOutputLength = data.length > 0
      ? Math.round(totalOutputLength / data.length)
      : 0;

    if (stats.validRecords < stats.totalRecords * 0.5) {
      warnings.push('More than 50% of records have quality issues');
    }

    const valid = errors.length === 0;
    logger.info(`[TrainingDataBuilder] Validation: ${stats.validRecords}/${stats.totalRecords} valid, ${errors.length} errors, ${warnings.length} warnings`);

    return { valid, errors, warnings, stats };
  }
}

module.exports = { TrainingDataBuilder };
