/**
 * DB Migration Skill Handler
 *
 * Inspects database schema from source code (CREATE TABLE statements),
 * generates migration scripts, detects schema drift, and suggests index optimizations.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
]);

module.exports = {
  async init(skill) {
    logger.info("[DBMigration] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[DBMigration] Action: ${action}`, { options });

    try {
      switch (action) {
        case "inspect":
          return await handleInspect(options.targetDir);
        case "generate":
          return handleGenerate(options.description, options.targetDir);
        case "drift":
          return await handleDrift(options.targetDir);
        case "optimize-indexes":
          return await handleOptimizeIndexes(options.targetDir);
        case "seed":
          return handleSeed(options.tableName);
        default:
          return await handleInspect(options.targetDir);
      }
    } catch (error) {
      logger.error(`[DBMigration] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `DB migration failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    targetDir: context.workspacePath || process.cwd(),
    description: null,
    tableName: null,
  };
  let action = "inspect";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--inspect") {
      action = "inspect";
    } else if (p === "--generate") {
      action = "generate";
      // Collect rest as description
      const rest = parts
        .slice(i + 1)
        .join(" ")
        .replace(/^['"]|['"]$/g, "");
      if (rest) {
        options.description = rest;
      }
      break;
    } else if (p === "--drift") {
      action = "drift";
    } else if (p === "--optimize-indexes") {
      action = "optimize-indexes";
    } else if (p === "--seed") {
      action = "seed";
      options.tableName = parts[++i];
    }
  }

  return { action, options };
}

function findSchemaFiles(dir) {
  const results = [];
  const patterns = [
    "database.js",
    "database.ts",
    "schema.js",
    "schema.ts",
    "migrations",
  ];

  function scan(d, depth) {
    if (depth > 4 || !fs.existsSync(d)) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !IGNORE_DIRS.has(entry.name) &&
        !entry.name.startsWith(".")
      ) {
        scan(path.join(d, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (
          name.includes("database") ||
          name.includes("schema") ||
          name.includes("migration")
        ) {
          const ext = path.extname(name);
          if ([".js", ".ts", ".sql"].includes(ext)) {
            results.push(path.join(d, entry.name));
          }
        }
      }
    }
  }

  scan(dir, 0);
  return results;
}

function extractTables(content) {
  const tables = [];

  // CREATE TABLE pattern
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([^;]+)\)/gi;
  let m;
  while ((m = createRe.exec(content)) !== null) {
    const tableName = m[1];
    const body = m[2];

    const columns = [];
    const columnRe =
      /[`"]?(\w+)[`"]?\s+(TEXT|INTEGER|REAL|BLOB|BOOLEAN|VARCHAR|TIMESTAMP|DATETIME|JSON|BIGINT|SERIAL)(?:\([^)]*\))?/gi;
    let cm;
    while ((cm = columnRe.exec(body)) !== null) {
      columns.push({ name: cm[1], type: cm[2].toUpperCase() });
    }

    tables.push({ name: tableName, columns });
  }

  // db.run("CREATE TABLE ...") pattern in JS
  const jsCreateRe =
    /(?:db\.run|db\.exec|db\.prepare)\s*\(\s*[`'"]([^`'"]*CREATE\s+TABLE[^`'"]*)[`'"]/gi;
  while ((m = jsCreateRe.exec(content)) !== null) {
    const sql = m[1];
    const innerRe =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([^)]+)\)/i;
    const inner = innerRe.exec(sql);
    if (inner && !tables.find((t) => t.name === inner[1])) {
      const columns = [];
      const colRe =
        /[`"]?(\w+)[`"]?\s+(TEXT|INTEGER|REAL|BLOB|BOOLEAN|VARCHAR|TIMESTAMP)[^,]*/gi;
      let cc;
      while ((cc = colRe.exec(inner[2])) !== null) {
        columns.push({ name: cc[1], type: cc[2].toUpperCase() });
      }
      tables.push({ name: inner[1], columns });
    }
  }

  return tables;
}

function extractIndexes(content) {
  const indexes = [];
  const indexRe =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s+ON\s+[`"]?(\w+)[`"]?\s*\(([^)]+)\)/gi;
  let m;
  while ((m = indexRe.exec(content)) !== null) {
    indexes.push({ name: m[1], table: m[2], columns: m[3].trim() });
  }
  return indexes;
}

async function handleInspect(targetDir) {
  const schemaFiles = findSchemaFiles(targetDir);
  if (schemaFiles.length === 0) {
    return {
      success: true,
      result: { tables: [] },
      message: "No database schema files found.",
    };
  }

  const allTables = [];
  const allIndexes = [];

  for (const file of schemaFiles) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const tables = extractTables(content);
    const indexes = extractIndexes(content);

    for (const t of tables) {
      if (!allTables.find((at) => at.name === t.name)) {
        t.source = path.relative(targetDir, file);
        allTables.push(t);
      }
    }
    allIndexes.push(...indexes);
  }

  const totalColumns = allTables.reduce((s, t) => s + t.columns.length, 0);

  const report =
    `Schema Inspection Report\n${"=".repeat(30)}\n` +
    `Sources: ${schemaFiles.length} files\n` +
    `Tables: ${allTables.length}, Columns: ${totalColumns}, Indexes: ${allIndexes.length}\n\n` +
    allTables
      .map(
        (t) =>
          `### ${t.name} (${t.columns.length} columns)\n` +
          `Source: ${t.source}\n` +
          t.columns.map((c) => `  - ${c.name} ${c.type}`).join("\n"),
      )
      .join("\n\n") +
    (allIndexes.length > 0
      ? `\n\nIndexes:\n` +
        allIndexes
          .map((i) => `  ${i.name} ON ${i.table}(${i.columns})`)
          .join("\n")
      : "");

  return {
    success: true,
    result: {
      tables: allTables,
      indexes: allIndexes,
      schemaFiles: schemaFiles.map((f) => path.relative(targetDir, f)),
    },
    message: report,
  };
}

function handleGenerate(description, targetDir) {
  if (!description) {
    return {
      success: false,
      message: "Usage: --generate 'description of the change'",
    };
  }

  const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .substring(0, 40);
  const migrationName = `${timestamp}_${slug}`;

  // Simple heuristic: extract table and column names from description
  const addColumnMatch = description.match(
    /add\s+(\w+)\s+(?:column\s+)?(?:to\s+)?(\w+)/i,
  );
  const createTableMatch = description.match(/create\s+(?:table\s+)?(\w+)/i);

  let upSQL, downSQL;

  if (addColumnMatch) {
    const column = addColumnMatch[1];
    const table = addColumnMatch[2];
    upSQL = `ALTER TABLE ${table} ADD COLUMN ${column} TEXT;`;
    downSQL = `-- SQLite does not support DROP COLUMN directly\n-- ALTER TABLE ${table} DROP COLUMN ${column};`;
  } else if (createTableMatch) {
    const table = createTableMatch[1];
    upSQL = `CREATE TABLE IF NOT EXISTS ${table} (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`;
    downSQL = `DROP TABLE IF EXISTS ${table};`;
  } else {
    upSQL = `-- TODO: Implement migration for: ${description}\n-- UP migration here`;
    downSQL = `-- TODO: Implement rollback for: ${description}\n-- DOWN migration here`;
  }

  const migration = `-- Migration: ${migrationName}\n-- Created: ${new Date().toISOString().split("T")[0]}\n-- Description: ${description}\n\n-- UP\n${upSQL}\n\n-- DOWN\n${downSQL}\n`;

  return {
    success: true,
    result: { migrationName, upSQL, downSQL },
    generatedFiles: [
      { path: `migrations/${migrationName}.sql`, content: migration },
    ],
    message: `Migration Generated: ${migrationName}\n${"=".repeat(40)}\n\n\`\`\`sql\n${migration}\`\`\`\n\nNote: Preview only. Save to appropriate directory.`,
  };
}

async function handleDrift(targetDir) {
  const inspectResult = await handleInspect(targetDir);
  if (!inspectResult.success || inspectResult.result.tables.length === 0) {
    return {
      success: true,
      result: { drifts: [] },
      message: "No schema found to check for drift.",
    };
  }

  // Check for common drift indicators
  const drifts = [];
  const tables = inspectResult.result.tables;

  // Check if migration files exist
  const migrationsDir = path.join(targetDir, "migrations");
  const hasMigrations = fs.existsSync(migrationsDir);

  if (!hasMigrations) {
    drifts.push({
      type: "missing-migrations",
      detail:
        "No migrations/ directory found. Schema changes may not be tracked.",
    });
  }

  // Check for tables without indexes on foreign key-like columns
  for (const table of tables) {
    const fkColumns = table.columns.filter((c) => c.name.endsWith("_id"));
    for (const fk of fkColumns) {
      const hasIndex = inspectResult.result.indexes.some(
        (i) => i.table === table.name && i.columns.includes(fk.name),
      );
      if (!hasIndex) {
        drifts.push({
          type: "missing-fk-index",
          detail: `Table '${table.name}' column '${fk.name}' looks like a FK but has no index`,
        });
      }
    }
  }

  const report =
    drifts.length > 0
      ? `Schema Drift Report\n${"=".repeat(25)}\n` +
        `Tables checked: ${tables.length}\n` +
        `Issues found: ${drifts.length}\n\n` +
        drifts.map((d, i) => `${i + 1}. [${d.type}] ${d.detail}`).join("\n")
      : `No schema drift detected. ${tables.length} tables checked.`;

  return {
    success: true,
    result: { drifts, tableCount: tables.length },
    message: report,
  };
}

async function handleOptimizeIndexes(targetDir) {
  const inspectResult = await handleInspect(targetDir);
  const tables = inspectResult.result.tables;
  const indexes = inspectResult.result.indexes;
  const suggestions = [];

  for (const table of tables) {
    // Suggest indexes for _id columns
    const fkColumns = table.columns.filter(
      (c) =>
        c.name.endsWith("_id") ||
        c.name === "user_id" ||
        c.name === "created_at",
    );
    for (const col of fkColumns) {
      const hasIndex = indexes.some(
        (i) => i.table === table.name && i.columns.includes(col.name),
      );
      if (!hasIndex) {
        suggestions.push({
          table: table.name,
          column: col.name,
          suggestion: `CREATE INDEX idx_${table.name}_${col.name} ON ${table.name}(${col.name});`,
          reason: col.name.endsWith("_id")
            ? "Foreign key column"
            : "Frequently queried column",
        });
      }
    }
  }

  const report =
    suggestions.length > 0
      ? `Index Optimization Suggestions\n${"=".repeat(35)}\n` +
        `${suggestions.length} suggestions for ${tables.length} tables:\n\n` +
        suggestions
          .map(
            (s) => `${s.table}.${s.column} (${s.reason}):\n  ${s.suggestion}`,
          )
          .join("\n\n")
      : `No index optimizations suggested. ${indexes.length} existing indexes look good.`;

  return {
    success: true,
    result: { suggestions },
    message: report,
  };
}

function handleSeed(tableName) {
  if (!tableName) {
    return { success: false, message: "Usage: --seed <table_name>" };
  }

  const seedData =
    `-- Seed data for ${tableName}\n` +
    `-- Generated: ${new Date().toISOString().split("T")[0]}\n\n` +
    `INSERT INTO ${tableName} (id, created_at, updated_at) VALUES\n` +
    `  (1, datetime('now'), datetime('now')),\n` +
    `  (2, datetime('now'), datetime('now')),\n` +
    `  (3, datetime('now'), datetime('now'));\n`;

  return {
    success: true,
    result: { tableName, rowCount: 3 },
    generatedFiles: [
      { path: `seeds/${tableName}_seed.sql`, content: seedData },
    ],
    message: `Seed Data for ${tableName}\n${"=".repeat(25)}\n\n\`\`\`sql\n${seedData}\`\`\`\n\nNote: Preview only. Customize column values before use.`,
  };
}
