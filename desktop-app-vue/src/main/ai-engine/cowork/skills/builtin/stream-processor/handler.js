/**
 * Stream Processor Skill Handler
 *
 * Standalone stream processing skill: reads files line by line,
 * applies per-line transformations and filtering, aggregates results.
 */

const { logger } = require("../../../../../utils/logger.js");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ============================================================
// Mode detection
// ============================================================

const MODE_MAP = {
  ".log": "log",
  ".txt": "log",
  ".csv": "csv",
  ".tsv": "csv",
  ".jsonl": "json",
  ".ndjson": "json",
  ".json": "json",
};

function detectMode(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MODE_MAP[ext] || "log";
}

// ============================================================
// Parse arguments
// ============================================================

function parseArgs(input) {
  const args = { source: null, mode: null, filter: null };
  if (!input) {
    return args;
  }

  const parts = input.trim().split(/\s+/);
  const nonFlags = [];
  let i = 0;

  while (i < parts.length) {
    if (parts[i] === "--mode" && parts[i + 1]) {
      args.mode = parts[i + 1];
      i += 2;
    } else if (parts[i] === "--filter" && parts[i + 1]) {
      args.filter = parts[i + 1];
      i += 2;
    } else if (parts[i].startsWith("--")) {
      i++;
    } else {
      nonFlags.push(parts[i]);
      i++;
    }
  }

  args.source = nonFlags.join(" ") || null;
  return args;
}

// ============================================================
// Processing
// ============================================================

async function processFile(filePath, mode, filterPattern) {
  const stats = {
    totalLines: 0,
    matchedLines: 0,
    mode,
    patterns: {},
    fields: {},
    csvHeaders: null,
    sampleLines: [],
  };

  let filterRe = null;
  if (filterPattern) {
    try {
      filterRe = new RegExp(filterPattern, "i");
    } catch {
      filterRe = null;
    }
  }

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let lineNum = 0;

    rl.on("line", (line) => {
      lineNum++;
      stats.totalLines++;

      // Apply filter
      if (filterRe && !filterRe.test(line)) {
        return;
      }
      stats.matchedLines++;

      // Process by mode
      if (mode === "csv") {
        processCsvLine(line, lineNum, stats);
      } else if (mode === "json") {
        processJsonLine(line, stats);
      } else {
        processLogLine(line, stats);
      }

      // Collect sample
      if (stats.sampleLines.length < 5) {
        stats.sampleLines.push(line.substring(0, 200));
      }
    });

    rl.on("close", () => resolve(stats));
    rl.on("error", (err) => reject(err));
  });
}

function processLogLine(line, stats) {
  // Extract log level patterns like [ERROR], [WARN], INFO, etc.
  const levelMatch = line.match(
    /\[(ERROR|WARN|INFO|DEBUG|TRACE)\]|^(ERROR|WARN|INFO|DEBUG|TRACE)\b/i,
  );
  if (levelMatch) {
    const level = (levelMatch[1] || levelMatch[2]).toUpperCase();
    stats.patterns[level] = (stats.patterns[level] || 0) + 1;
  }

  // Extract common patterns (first meaningful segment)
  const msgMatch = line.match(/(?:\]|\d{2}:\d{2}:\d{2})\s+(.{10,60})/);
  if (msgMatch) {
    const msg = msgMatch[1].trim().substring(0, 60);
    stats.patterns[msg] = (stats.patterns[msg] || 0) + 1;
  }
}

function processCsvLine(line, lineNum, stats) {
  const separator = line.includes("\t") ? "\t" : ",";
  const fields = line.split(separator);

  if (lineNum === 1) {
    stats.csvHeaders = fields.map((f) => f.trim().replace(/^"|"$/g, ""));
    stats.fields._columnCount = fields.length;
    return;
  }

  // Track value distribution for first few fields
  const headers = stats.csvHeaders || [];
  for (let i = 0; i < Math.min(fields.length, 3); i++) {
    const header = headers[i] || `col${i}`;
    if (!stats.fields[header]) {
      stats.fields[header] = {};
    }
    const val =
      fields[i]?.trim().replace(/^"|"$/g, "").substring(0, 50) || "(empty)";
    stats.fields[header][val] = (stats.fields[header][val] || 0) + 1;
  }
}

function processJsonLine(line, stats) {
  try {
    const obj = JSON.parse(line);
    // Track top-level keys distribution
    for (const key of Object.keys(obj)) {
      if (!stats.fields[key]) {
        stats.fields[key] = {};
      }
      const val = String(obj[key]).substring(0, 50);
      stats.fields[key][val] = (stats.fields[key][val] || 0) + 1;
    }
  } catch {
    // Not valid JSON, count as error
    stats.patterns["(parse error)"] =
      (stats.patterns["(parse error)"] || 0) + 1;
  }
}

// ============================================================
// Formatting
// ============================================================

function formatResult(filePath, stats, filterPattern) {
  const lines = [
    "Stream Processing Report",
    "========================",
    `Source: ${filePath}`,
    `Mode: ${stats.mode}`,
  ];

  if (filterPattern) {
    lines.push(`Filter: ${filterPattern}`);
  }

  lines.push(
    `Lines: ${stats.totalLines.toLocaleString()} total, ${stats.matchedLines.toLocaleString()} matched`,
  );
  lines.push("");

  if (stats.mode === "csv" && stats.csvHeaders) {
    lines.push(
      `Columns (${stats.csvHeaders.length}): ${stats.csvHeaders.join(", ")}`,
    );
    lines.push("");

    // Show field distributions
    for (const [field, dist] of Object.entries(stats.fields)) {
      if (field === "_columnCount") {
        continue;
      }
      const sorted = Object.entries(dist)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      lines.push(`**${field}** (top values):`);
      for (const [val, count] of sorted) {
        lines.push(`  ${val} — ${count}`);
      }
    }
  } else if (stats.mode === "json" && Object.keys(stats.fields).length > 0) {
    lines.push("Field Distribution:");
    for (const [field, dist] of Object.entries(stats.fields)) {
      const uniqueVals = Object.keys(dist).length;
      const topVal = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
      lines.push(
        `  ${field}: ${uniqueVals} unique values (top: "${topVal?.[0]}" × ${topVal?.[1]})`,
      );
    }
  } else if (Object.keys(stats.patterns).length > 0) {
    const sorted = Object.entries(stats.patterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    lines.push("Top Patterns:");
    for (const [pattern, count] of sorted) {
      lines.push(`  ${pattern} — ${count} occurrence(s)`);
    }
  }

  if (stats.sampleLines.length > 0) {
    lines.push("", "Sample Lines:");
    for (const sample of stats.sampleLines) {
      lines.push(`  ${sample}`);
    }
  }

  return lines.join("\n");
}

// ============================================================
// Handler
// ============================================================

async function handler(params) {
  const { input, workspace } = params;

  const args = parseArgs(input);

  if (!args.source) {
    return {
      success: false,
      output:
        "Usage: /stream-processor <source> [--mode log|csv|json] [--filter pattern]",
    };
  }

  // Resolve path
  let filePath = args.source;
  if (workspace && !path.isAbsolute(filePath)) {
    filePath = path.resolve(workspace, filePath);
  }

  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      output: `File not found: ${filePath}`,
    };
  }

  const mode = args.mode || detectMode(filePath);

  try {
    const stats = await processFile(filePath, mode, args.filter);
    const output = formatResult(args.source, stats, args.filter);

    return {
      success: true,
      output,
      data: stats,
    };
  } catch (error) {
    logger.error("[stream-processor handler] Error:", error.message);
    return {
      success: false,
      output: `Stream processing failed: ${error.message}`,
    };
  }
}

module.exports = {
  async init(_skill) {
    logger.info("[stream-processor] Handler initialized");
  },
  async execute(task, context = {}, _skill) {
    const input = task.input || task.args || "";
    return handler({ input, context });
  },
};
