/**
 * Database Adapter
 *
 * Provides abstraction layer for database operations to enable testing
 * without actual database connections.
 */

/**
 * Real Database Adapter using better-sqlite3
 */
class DatabaseAdapter {
  /**
   * @param {object} db - better-sqlite3 database instance
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Prepare SQL statement
   * @param {string} sql - SQL query
   * @returns {object} Statement object
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }

  /**
   * Execute transaction
   * @param {Function} fn - Transaction function
   * @returns {Function} Transaction wrapper
   */
  transaction(fn) {
    return this.db.transaction(fn);
  }

  /**
   * Execute raw SQL (for setup/teardown only)
   * SECURITY: This exec(sql) wrapper validates input to prevent SQL injection
   * Only allows safe DDL operations (CREATE TABLE, DROP TABLE, etc.)
   * @param {string} sql - SQL query
   * @throws {Error} If SQL contains unsafe operations
   */
  exec(sql) {
    // Security: Only allow safe DDL operations
    const sqlUpper = sql.trim().toUpperCase();
    const allowedOperations = [
      "CREATE TABLE",
      "DROP TABLE",
      "CREATE INDEX",
      "DROP INDEX",
      "ALTER TABLE",
    ];

    const isAllowed = allowedOperations.some((op) => sqlUpper.startsWith(op));
    if (!isAllowed) {
      throw new Error(
        "exec() only allows DDL operations (CREATE TABLE, DROP TABLE, CREATE INDEX, DROP INDEX, ALTER TABLE). " +
          "Use prepare() for data operations to prevent SQL injection.",
      );
    }

    // Validated input - safe to execute
    return this.db.exec(sql);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db && this.db.close) {
      this.db.close();
    }
  }
}

/**
 * In-Memory Database Adapter for testing
 *
 * Simulates database operations using in-memory data structures
 */
class InMemoryDatabaseAdapter {
  constructor() {
    // Tables
    this.sessions = new Map();
    this.tags = new Map();
    this.metadata = new Map();
    this.searchHistory = new Map();
    this.compressionLogs = new Map();

    // Auto-increment IDs
    this.nextId = 1;

    // Insertion sequence counter for stable sort tiebreaking
    this._insertSeq = 0;
  }

  /**
   * Prepare statement (mock)
   * @param {string} sql - SQL query
   * @returns {object} Mock statement
   */
  prepare(sql) {
    const adapter = this;

    return {
      /**
       * Run statement (INSERT, UPDATE, DELETE)
       */
      run(...params) {
        const result = { changes: 0, lastInsertRowid: null };

        // Parse SQL to determine operation
        const sqlUpper = sql.toUpperCase().trim();

        if (
          sqlUpper.startsWith("INSERT INTO CHAT_SESSIONS") ||
          sqlUpper.startsWith("INSERT INTO LLM_SESSIONS")
        ) {
          const [
            id,
            conversationId,
            title,
            messages,
            compressedHistory,
            metadata,
            createdAt,
            updatedAt,
          ] = params;
          adapter._insertSeq++;
          adapter.sessions.set(id, {
            id,
            conversationId: conversationId || null,
            title: title || "",
            messages: messages || "[]",
            compressedHistory: compressedHistory || null,
            metadata: metadata || "{}",
            created_at: createdAt || Date.now(),
            updated_at: updatedAt || Date.now(),
            _seq: adapter._insertSeq,
          });
          result.changes = 1;
          result.lastInsertRowid = id;
        } else if (
          sqlUpper.startsWith("UPDATE CHAT_SESSIONS") ||
          sqlUpper.startsWith("UPDATE LLM_SESSIONS")
        ) {
          const id = params[params.length - 1]; // Last param is usually ID
          if (adapter.sessions.has(id)) {
            const session = adapter.sessions.get(id);
            // Update fields based on params
            if (params.length >= 5) {
              // LLM_SESSIONS format: title, messages, compressed_history, metadata, updated_at, id
              session.title = params[0];
              session.messages = params[1] || session.messages;
              session.compressedHistory = params[2];
              session.metadata = params[3] || session.metadata;
              session.updated_at = params[4] || Date.now();
            } else if (params.length >= 2) {
              session.title = params[0];
              session.messages = params[1] || session.messages;
              session.updated_at = Date.now();
            }
            result.changes = 1;
          }
        } else if (
          sqlUpper.startsWith("DELETE FROM CHAT_SESSIONS") ||
          sqlUpper.startsWith("DELETE FROM LLM_SESSIONS")
        ) {
          const id = params[0];
          if (adapter.sessions.has(id)) {
            adapter.sessions.delete(id);
            result.changes = 1;
          }
        } else if (sqlUpper.startsWith("INSERT INTO SESSION_TAGS")) {
          const [sessionId, tag] = params;
          const key = `${sessionId}:${tag}`;
          adapter.tags.set(key, { session_id: sessionId, tag });
          result.changes = 1;
        } else if (sqlUpper.startsWith("DELETE FROM SESSION_TAGS")) {
          // Delete tags for session
          const sessionId = params[0];
          for (const [key, value] of adapter.tags) {
            if (value.session_id === sessionId) {
              adapter.tags.delete(key);
              result.changes++;
            }
          }
        } else if (sqlUpper.startsWith("INSERT INTO SESSION_METADATA")) {
          const [sessionId, key, value] = params;
          const metaKey = `${sessionId}:${key}`;
          adapter.metadata.set(metaKey, { session_id: sessionId, key, value });
          result.changes = 1;
        }

        return result;
      },

      /**
       * Get single row
       */
      get(...params) {
        const sqlUpper = sql.toUpperCase().trim();

        if (
          sqlUpper.startsWith("SELECT") &&
          (sqlUpper.includes("FROM LLM_SESSIONS") ||
            sqlUpper.includes("FROM CHAT_SESSIONS"))
        ) {
          const id = params[0];
          const session = adapter.sessions.get(id);

          if (!session) {
            return null;
          }

          // Return in database format
          return {
            id: session.id,
            conversation_id: session.conversationId,
            title: session.title,
            messages:
              typeof session.messages === "string"
                ? session.messages
                : JSON.stringify(session.messages),
            compressed_history: session.compressedHistory,
            metadata:
              typeof session.metadata === "string"
                ? session.metadata
                : JSON.stringify(session.metadata),
            created_at: session.metadata?.createdAt || session.created_at,
            updated_at: session.metadata?.updatedAt || session.updated_at,
          };
        } else if (sqlUpper.includes("FROM SESSION_TAGS")) {
          const sessionId = params[0];
          const tags = [];
          for (const [, value] of adapter.tags) {
            if (value.session_id === sessionId) {
              tags.push(value);
            }
          }
          return tags[0] || null;
        } else if (sqlUpper.includes("FROM SESSION_METADATA")) {
          const [sessionId, key] = params;
          const metaKey = `${sessionId}:${key}`;
          return adapter.metadata.get(metaKey) || null;
        }

        return null;
      },

      /**
       * Get all rows
       */
      all(...params) {
        const sqlUpper = sql.toUpperCase().trim();

        if (
          sqlUpper.startsWith("SELECT") &&
          (sqlUpper.includes("FROM LLM_SESSIONS") ||
            sqlUpper.includes("FROM CHAT_SESSIONS"))
        ) {
          // Return all sessions
          let sessions = Array.from(adapter.sessions.values());

          // Sort by updated_at DESC (most recent first), use _seq as tiebreaker
          sessions.sort((a, b) => {
            const timeDiff = b.updated_at - a.updated_at;
            if (timeDiff !== 0) {
              return timeDiff;
            }
            return (b._seq || 0) - (a._seq || 0);
          });

          // Apply LIMIT and OFFSET (from SQL literals or from params)
          const limitMatch = sql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
          if (limitMatch) {
            const limit = parseInt(limitMatch[1]);
            const offset = limitMatch[2] ? parseInt(limitMatch[2]) : 0;
            sessions = sessions.slice(offset, offset + limit);
          } else if (sql.toUpperCase().includes("LIMIT")) {
            // LIMIT/OFFSET passed as params (LIMIT ? OFFSET ?)
            const limit = params.length > 0 ? parseInt(params[0]) || 50 : 50;
            const offset = params.length > 1 ? parseInt(params[1]) || 0 : 0;
            sessions = sessions.slice(offset, offset + limit);
          }

          // For listSessions query, map to simplified format
          if (
            sqlUpper.includes("CONVERSATION_ID") &&
            !sqlUpper.includes("MESSAGES")
          ) {
            return sessions.map((s) => ({
              id: s.id,
              conversation_id: s.conversationId,
              title: s.title,
              metadata:
                typeof s.metadata === "string"
                  ? s.metadata
                  : JSON.stringify(s.metadata),
              created_at: s.metadata?.createdAt || s.created_at,
              updated_at: s.metadata?.updatedAt || s.updated_at,
            }));
          }

          return sessions;
        } else if (sqlUpper.includes("FROM SESSION_TAGS")) {
          const sessionId = params[0];
          const tags = [];
          for (const [, value] of adapter.tags) {
            if (!sessionId || value.session_id === sessionId) {
              tags.push(value);
            }
          }
          return tags;
        } else if (sqlUpper.includes("FROM SESSION_METADATA")) {
          const sessionId = params[0];
          const metadata = [];
          for (const [, value] of adapter.metadata) {
            if (!sessionId || value.session_id === sessionId) {
              metadata.push(value);
            }
          }
          return metadata;
        }

        return [];
      },
    };
  }

  /**
   * Execute transaction (mock)
   */
  transaction(fn) {
    // In-memory transactions are synchronous, no rollback needed
    return fn;
  }

  /**
   * Execute raw SQL (mock)
   */
  exec(sql) {
    // Parse and execute DDL statements
    const sqlUpper = sql.toUpperCase().trim();

    if (sqlUpper.includes("CREATE TABLE")) {
      // Table creation is implicit
      return;
    } else if (sqlUpper.includes("DROP TABLE")) {
      // Clear all data
      this.clear();
    }
  }

  /**
   * Close connection (no-op for in-memory)
   */
  close() {
    // No-op
  }

  /**
   * Clear all data (for testing)
   */
  clear() {
    this.sessions.clear();
    this.tags.clear();
    this.metadata.clear();
    this.searchHistory.clear();
    this.compressionLogs.clear();
  }
}

module.exports = {
  DatabaseAdapter,
  InMemoryDatabaseAdapter,
};
