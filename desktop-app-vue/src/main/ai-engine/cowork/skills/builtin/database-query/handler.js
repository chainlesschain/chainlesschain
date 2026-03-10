/**
 * Database Query Helper Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) {
    logger.info("[DatabaseQuery] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "generate":
          return handleGenerate(parsed.description, parsed.options);
        case "optimize":
          return handleOptimize(parsed.query);
        case "schema":
          return handleSchema(parsed.target, context);
        case "migrate":
          return handleMigrate(parsed.description, parsed.options);
        case "explain":
          return handleExplain(parsed.query);
        default:
          return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[DatabaseQuery] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return {
      action: "schema",
      target: "",
      description: "",
      query: "",
      options: {},
    };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "generate").toLowerCase();
  const rest = parts.slice(1).join(" ").replace(/"/g, "");
  const dialectMatch = input.match(/--dialect\s+(\S+)/);

  return {
    action,
    target: parts[1] || "",
    description: rest,
    query: rest,
    options: { dialect: dialectMatch ? dialectMatch[1] : "sqlite" },
  };
}

function handleGenerate(description, options) {
  const dialect = options.dialect || "sqlite";
  const lower = (description || "").toLowerCase();

  // Detect common patterns and generate SQL
  let sql = "";
  const suggestions = [];

  if (lower.includes("count")) {
    const table = extractTableName(lower);
    const condition = extractCondition(lower);
    sql = `SELECT COUNT(*) as total FROM ${table}${condition ? ` WHERE ${condition}` : ""};`;
  } else if (lower.includes("join")) {
    sql = generateJoinQuery(lower, dialect);
  } else if (lower.includes("group") || lower.includes("aggregate")) {
    const table = extractTableName(lower);
    sql = `SELECT column_name, COUNT(*) as count\nFROM ${table}\nGROUP BY column_name\nORDER BY count DESC;`;
    suggestions.push(
      "Replace 'column_name' with the actual column to group by.",
    );
  } else if (lower.includes("insert")) {
    const table = extractTableName(lower);
    sql = `INSERT INTO ${table} (column1, column2)\nVALUES (?, ?);`;
    suggestions.push("Use parameterized queries to prevent SQL injection.");
  } else if (lower.includes("update")) {
    const table = extractTableName(lower);
    sql = `UPDATE ${table}\nSET column1 = ?\nWHERE id = ?;`;
    suggestions.push("Always include a WHERE clause in UPDATE statements.");
  } else if (lower.includes("delete")) {
    const table = extractTableName(lower);
    sql = `DELETE FROM ${table}\nWHERE condition = ?;`;
    suggestions.push(
      "Always include a WHERE clause. Consider soft-delete with a 'deleted_at' column.",
    );
  } else {
    const table = extractTableName(lower);
    const condition = extractCondition(lower);
    sql = `SELECT *\nFROM ${table}${condition ? `\nWHERE ${condition}` : ""}\nORDER BY created_at DESC\nLIMIT 100;`;
    suggestions.push("Avoid SELECT * in production — specify needed columns.");
  }

  return {
    success: true,
    action: "generate",
    sql,
    dialect,
    suggestions,
    message: `SQL generated (${dialect} dialect).`,
  };
}

function handleOptimize(query) {
  const suggestions = [];
  const upper = (query || "").toUpperCase();

  if (upper.includes("SELECT *")) {
    suggestions.push("Replace SELECT * with specific columns to reduce I/O.");
  }
  if (upper.includes("LIKE '%")) {
    suggestions.push(
      "Leading wildcard LIKE '%...' prevents index usage. Consider full-text search.",
    );
  }
  if (!upper.includes("LIMIT") && upper.includes("SELECT")) {
    suggestions.push("Add LIMIT to prevent unbounded result sets.");
  }
  if (upper.includes("ORDER BY") && !upper.includes("INDEX")) {
    suggestions.push("Ensure ORDER BY columns have indexes.");
  }
  if ((upper.match(/JOIN/g) || []).length > 3) {
    suggestions.push(
      "Multiple JOINs detected. Consider denormalization or materialized views.",
    );
  }
  if (upper.includes("DISTINCT")) {
    suggestions.push(
      "DISTINCT can be expensive. Check if duplicates indicate a JOIN issue.",
    );
  }
  if (upper.includes("IN (SELECT")) {
    suggestions.push(
      "Subquery in IN clause may be slow. Consider using EXISTS or JOIN.",
    );
  }
  if (upper.includes("OR ")) {
    suggestions.push(
      "OR conditions may prevent index usage. Consider UNION for complex OR chains.",
    );
  }
  if (!upper.includes("WHERE") && upper.includes("UPDATE")) {
    suggestions.push("CRITICAL: UPDATE without WHERE affects all rows!");
  }
  if (!upper.includes("WHERE") && upper.includes("DELETE")) {
    suggestions.push("CRITICAL: DELETE without WHERE deletes all rows!");
  }

  const indexSuggestions = extractIndexSuggestions(query);

  return {
    success: true,
    action: "optimize",
    original: query,
    suggestions,
    indexSuggestions,
    message: `${suggestions.length} optimization suggestion(s), ${indexSuggestions.length} index suggestion(s).`,
  };
}

function handleSchema(target, context) {
  // Try to introspect via app database
  let db = null;
  try {
    const { getDatabase } = require("../../../../database.js");
    db = getDatabase();
  } catch {
    /* no database available */
  }

  if (db) {
    try {
      if (target && target !== "schema") {
        const info = db.prepare(`PRAGMA table_info(${target})`).all();
        const indexes = db.prepare(`PRAGMA index_list(${target})`).all();
        return {
          success: true,
          action: "schema",
          table: target,
          columns: info,
          indexes,
          message: `Schema for "${target}": ${info.length} column(s), ${indexes.length} index(es).`,
        };
      }
      // List all tables
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all();
      return {
        success: true,
        action: "schema",
        tables: tables.map((t) => t.name),
        message: `${tables.length} table(s) in database.`,
      };
    } catch (err) {
      return { success: false, error: `Database query failed: ${err.message}` };
    }
  }

  return {
    success: true,
    action: "schema",
    message:
      "No database connection available. Provide a table name for schema template generation.",
    template: getSchemaTemplate(target),
  };
}

function handleMigrate(description, options) {
  const dialect = options.dialect || "sqlite";
  const lower = (description || "").toLowerCase();
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  let up = "";
  let down = "";

  if (
    lower.includes("add column") ||
    (lower.includes("add") && lower.includes("column"))
  ) {
    const table = extractTableName(lower);
    const col = extractColumnName(lower);
    up = `ALTER TABLE ${table} ADD COLUMN ${col} TEXT;`;
    down =
      dialect === "sqlite"
        ? `-- SQLite doesn't support DROP COLUMN before 3.35.0\n-- ALTER TABLE ${table} DROP COLUMN ${col};`
        : `ALTER TABLE ${table} DROP COLUMN ${col};`;
  } else if (lower.includes("create table") || lower.includes("new table")) {
    const table = extractTableName(lower);
    up = `CREATE TABLE IF NOT EXISTS ${table} (\n  id INTEGER PRIMARY KEY${dialect === "sqlite" ? "" : " AUTOINCREMENT"},\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`;
    down = `DROP TABLE IF EXISTS ${table};`;
  } else if (lower.includes("add index") || lower.includes("create index")) {
    const table = extractTableName(lower);
    const col = extractColumnName(lower);
    up = `CREATE INDEX IF NOT EXISTS idx_${table}_${col} ON ${table}(${col});`;
    down = `DROP INDEX IF EXISTS idx_${table}_${col};`;
  } else {
    up = `-- Migration: ${description}\n-- TODO: Add UP migration SQL`;
    down = `-- Rollback: ${description}\n-- TODO: Add DOWN migration SQL`;
  }

  return {
    success: true,
    action: "migrate",
    filename: `${timestamp}_migration.sql`,
    up,
    down,
    dialect,
    message: `Migration generated (${dialect}).`,
  };
}

function handleExplain(query) {
  const upper = (query || "").toUpperCase().trim();
  const analysis = [];

  if (upper.startsWith("SELECT")) {
    if (upper.includes("WHERE")) {
      analysis.push("WHERE clause present — check indexed columns.");
    }
    if (upper.includes("JOIN")) {
      analysis.push("JOIN detected — ensure join columns are indexed.");
    }
    if (upper.includes("ORDER BY")) {
      analysis.push("ORDER BY present — can be expensive without index.");
    }
    if (upper.includes("GROUP BY")) {
      analysis.push("GROUP BY present — temporary table may be created.");
    }
    if (upper.includes("HAVING")) {
      analysis.push(
        "HAVING filters after GROUP BY — consider WHERE for pre-filtering.",
      );
    }
    if (upper.includes("SUBSELECT") || upper.includes("(SELECT")) {
      analysis.push(
        "Subquery detected — consider CTE or JOIN for better plans.",
      );
    }
  }

  const explainQuery = `EXPLAIN QUERY PLAN\n${query}`;

  return {
    success: true,
    action: "explain",
    original: query,
    explainQuery,
    analysis,
    message: `${analysis.length} observation(s). Run EXPLAIN QUERY PLAN in your database for full details.`,
  };
}

function extractTableName(text) {
  const match = text.match(/(?:from|table|into|update)\s+(\w+)/i);
  return match ? match[1] : "table_name";
}

function extractColumnName(text) {
  const match = text.match(/column\s+(\w+)/i);
  return match ? match[1] : "column_name";
}

function extractCondition(text) {
  if (text.includes("this week")) {
    return "created_at >= date('now', '-7 days')";
  }
  if (text.includes("today")) {
    return "created_at >= date('now')";
  }
  if (text.includes("this month")) {
    return "created_at >= date('now', 'start of month')";
  }
  if (text.includes("active")) {
    return "status = 'active'";
  }
  if (text.includes("pending")) {
    return "status = 'pending'";
  }
  return null;
}

function extractIndexSuggestions(query) {
  const suggestions = [];
  const whereMatch = query.match(/WHERE\s+(.+?)(?:ORDER|GROUP|LIMIT|$)/is);
  if (whereMatch) {
    const cols = whereMatch[1].match(/(\w+)\s*[=<>!]/g);
    if (cols) {
      for (const col of cols) {
        const name = col.replace(/\s*[=<>!].*/, "").trim();
        if (name && !["AND", "OR", "NOT"].includes(name.toUpperCase())) {
          suggestions.push(
            `CREATE INDEX idx_table_${name} ON table_name(${name});`,
          );
        }
      }
    }
  }
  return suggestions;
}

function generateJoinQuery(lower, dialect) {
  const tables = lower.match(/(\w+)\s+(?:and|with)\s+(\w+)/);
  if (tables) {
    return `SELECT a.*, b.*\nFROM ${tables[1]} a\nINNER JOIN ${tables[2]} b ON a.${tables[2]}_id = b.id\nLIMIT 100;`;
  }
  return "SELECT a.*, b.*\nFROM table1 a\nINNER JOIN table2 b ON a.table2_id = b.id\nLIMIT 100;";
}

function getSchemaTemplate(table) {
  return `CREATE TABLE ${table || "example"} (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`;
}
