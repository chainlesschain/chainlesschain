/**
 * @module core-db/sql-security
 * SQL injection prevention and parameter validation
 *
 * Extracted from desktop-app-vue/src/main/database/sql-security.js
 */
const { getLogger } = require("../logger-adapter.js");

class SqlSecurity {
  static validateOrder(order) {
    const logger = getLogger();
    const validOrders = ["ASC", "DESC", "asc", "desc"];
    const normalized = String(order || "").toUpperCase();

    if (!validOrders.map((v) => v.toUpperCase()).includes(normalized)) {
      logger.error("[SqlSecurity] Invalid sort order:", order);
      throw new Error(`Invalid sort order: ${order}`);
    }

    return normalized;
  }

  static validateTableName(tableName, allowedTables) {
    const logger = getLogger();
    if (!tableName || typeof tableName !== "string") {
      throw new Error("Invalid table name");
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      logger.error("[SqlSecurity] Invalid table name:", tableName);
      throw new Error(`Invalid table name: ${tableName}`);
    }

    if (allowedTables && !allowedTables.includes(tableName)) {
      logger.error("[SqlSecurity] Table not in whitelist:", tableName);
      throw new Error(`Unauthorized table: ${tableName}`);
    }

    return tableName;
  }

  static validateColumnName(columnName, allowedColumns = null) {
    const logger = getLogger();
    if (!columnName || typeof columnName !== "string") {
      throw new Error("Invalid column name");
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
      logger.error("[SqlSecurity] Invalid column name:", columnName);
      throw new Error(`Invalid column name: ${columnName}`);
    }

    if (allowedColumns && !allowedColumns.includes(columnName)) {
      logger.error("[SqlSecurity] Column not in whitelist:", columnName);
      throw new Error(`Unauthorized column: ${columnName}`);
    }

    return columnName;
  }

  static validateLimit(limit, maxLimit = 1000) {
    const logger = getLogger();
    const num = parseInt(limit, 10);

    if (isNaN(num) || num < 0) {
      throw new Error("LIMIT must be a non-negative integer");
    }

    if (num > maxLimit) {
      logger.warn("[SqlSecurity] LIMIT exceeded max, capping:", {
        limit: num,
        maxLimit,
      });
      return maxLimit;
    }

    return num;
  }

  static validateOffset(offset) {
    const num = parseInt(offset, 10);

    if (isNaN(num) || num < 0) {
      throw new Error("OFFSET must be a non-negative integer");
    }

    return num;
  }

  static containsSqlInjectionPattern(input) {
    if (!input || typeof input !== "string") {
      return false;
    }

    const dangerousPatterns = [
      /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|EXECUTE)\s+/i,
      /UNION\s+SELECT/i,
      /--\s*$/,
      /\/\*.*\*\//,
      /'\s*OR\s*'1'\s*=\s*'1/i,
      /'\s*OR\s*1\s*=\s*1/i,
      /\bxp_\w+/i,
      /\bsp_\w+/i,
      /\bEXEC\s*\(/i,
      /\bEXECUTE\s*\(/i,
    ];

    return dangerousPatterns.some((pattern) => pattern.test(input));
  }

  static sanitizeString(input) {
    if (!input || typeof input !== "string") {
      return "";
    }

    return input.replace(/[^\w\s\-@.]/g, "").substring(0, 1000);
  }

  static buildLikePattern(searchTerm) {
    if (!searchTerm || typeof searchTerm !== "string") {
      return "%";
    }

    const escaped = searchTerm
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .substring(0, 100);

    return `%${escaped}%`;
  }

  static validateSearchKeyword(keyword) {
    const logger = getLogger();
    if (!keyword || typeof keyword !== "string") {
      return "";
    }

    if (this.containsSqlInjectionPattern(keyword)) {
      logger.error("[SqlSecurity] SQL injection pattern detected:", keyword);
      throw new Error("Search keyword contains illegal characters");
    }

    return keyword.substring(0, 200);
  }

  static getAllowedTables() {
    return [
      "projects",
      "project_files",
      "project_tasks",
      "project_conversations",
      "project_templates",
      "notes",
      "note_versions",
      "knowledge_base",
      "chat_conversations",
      "messages",
      "conversation_contexts",
      "social_posts",
      "social_comments",
      "social_likes",
      "social_follows",
      "did_identities",
      "contacts",
      "contact_groups",
      "p2p_messages",
      "p2p_peers",
      "sync_queue",
      "llm_providers",
      "llm_performance_logs",
      "llm_sessions",
      "settings",
      "tags",
      "categories",
      "templates",
      "skills",
      "tools",
      "notifications",
    ];
  }

  static buildSafeWhereClause(filters, allowedFields) {
    const logger = getLogger();
    if (!filters || typeof filters !== "object") {
      return { whereClause: "", params: [] };
    }

    const conditions = [];
    const params = [];

    for (const [field, value] of Object.entries(filters)) {
      if (!allowedFields.includes(field)) {
        logger.warn("[SqlSecurity] Filter field not in whitelist:", field);
        continue;
      }

      try {
        this.validateColumnName(field);
      } catch (_error) {
        logger.error("[SqlSecurity] Invalid column name:", field);
        continue;
      }

      if (value === null) {
        conditions.push(`${field} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map(() => "?").join(", ");
        conditions.push(`${field} IN (${placeholders})`);
        params.push(...value);
      } else {
        conditions.push(`${field} = ?`);
        params.push(value);
      }
    }

    const whereClause =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    return { whereClause, params };
  }
}

module.exports = SqlSecurity;
