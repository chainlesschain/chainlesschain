/**
 * Data Analysis Skill Handler
 *
 * Loads CSV/JSON/TSV files, computes descriptive statistics, detects
 * anomalies, and recommends ECharts visualization types.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Parsers ────────────────────────────────────────────────────────

function parseCSV(content, delimiter = ",") {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line
      .split(delimiter)
      .map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

function parseJSON(content) {
  const data = JSON.parse(content);
  if (Array.isArray(data) && data.length > 0) {
    return { headers: Object.keys(data[0]), rows: data };
  }
  return { headers: Object.keys(data), rows: [data] };
}

function detectFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") {
    return "csv";
  }
  if (ext === ".tsv") {
    return "tsv";
  }
  if (ext === ".json") {
    return "json";
  }
  return "csv";
}

// ── Statistics ─────────────────────────────────────────────────────

function isNumeric(val) {
  if (val === "" || val === null || val === undefined) {
    return false;
  }
  return !isNaN(Number(val));
}

function computeStats(values) {
  const nums = values.filter((v) => isNumeric(v)).map(Number);
  if (nums.length === 0) {
    return null;
  }
  nums.sort((a, b) => a - b);
  const n = nums.length;
  const sum = nums.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const q25 = nums[Math.floor(n * 0.25)];
  const median = nums[Math.floor(n * 0.5)];
  const q75 = nums[Math.floor(n * 0.75)];

  return {
    count: n,
    mean: Math.round(mean * 1000) / 1000,
    std: Math.round(std * 1000) / 1000,
    min: nums[0],
    max: nums[n - 1],
    q25,
    median,
    q75,
    missing: values.length - n,
  };
}

function recommendChart(header, stats) {
  if (!stats) {
    return "bar";
  } // categorical
  if (stats.count > 50) {
    return "line";
  }
  if (stats.max - stats.min > stats.std * 5) {
    return "scatter";
  }
  return "bar";
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[data-analysis] handler initialized for "${skill?.name || "data-analysis"}"`,
    );
  },

  async execute(task, context, skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    // Parse options
    const columnsMatch = input.match(/--columns\s+(\S+)/);
    const groupByMatch = input.match(/--group-by\s+(\S+)/);
    const outputMatch = input.match(/--output\s+(summary|detailed|chart)/);
    const formatMatch = input.match(/--format\s+(csv|json|tsv)/);
    const selectedColumns = columnsMatch ? columnsMatch[1].split(",") : null;
    const groupBy = groupByMatch ? groupByMatch[1] : null;
    const outputMode = outputMatch ? outputMatch[1] : "summary";
    const cleanInput = input.replace(/--\w+\s+\S+/g, "").trim();

    if (!cleanInput) {
      return {
        success: true,
        result: { message: "Please provide a data file path." },
        message:
          "Usage: /data-analysis <file> [--columns col1,col2] [--group-by col] [--output summary|detailed|chart]",
      };
    }

    try {
      let filePath = cleanInput;
      if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(projectRoot, filePath);
      }
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found",
          message: `Data file not found: ${filePath}`,
        };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const format = formatMatch ? formatMatch[1] : detectFormat(filePath);
      let data;
      if (format === "json") {
        data = parseJSON(content);
      } else {
        data = parseCSV(content, format === "tsv" ? "\t" : ",");
      }

      const { headers, rows } = data;
      const analyzeHeaders = selectedColumns
        ? headers.filter((h) => selectedColumns.includes(h))
        : headers;

      // Compute statistics per column
      const columnStats = {};
      const chartRecommendations = {};
      for (const h of analyzeHeaders) {
        const values = rows.map((r) => r[h]);
        const stats = computeStats(values);
        columnStats[h] = stats || {
          type: "categorical",
          uniqueValues: [...new Set(values)].length,
          count: values.length,
        };
        chartRecommendations[h] = recommendChart(h, stats);
      }

      // Group-by analysis
      let groupedStats = null;
      if (groupBy && headers.includes(groupBy)) {
        const groups = {};
        for (const row of rows) {
          const key = row[groupBy] || "(empty)";
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(row);
        }
        groupedStats = {};
        for (const [key, groupRows] of Object.entries(groups)) {
          groupedStats[key] = { count: groupRows.length };
          for (const h of analyzeHeaders) {
            if (h === groupBy) {
              continue;
            }
            const values = groupRows.map((r) => r[h]);
            const stats = computeStats(values);
            if (stats) {
              groupedStats[key][h] = stats;
            }
          }
        }
      }

      // Data quality
      const quality = {
        totalRows: rows.length,
        totalColumns: headers.length,
        missingCells: 0,
        duplicateRows: 0,
      };
      const seen = new Set();
      for (const row of rows) {
        const key = JSON.stringify(row);
        if (seen.has(key)) {
          quality.duplicateRows++;
        }
        seen.add(key);
        for (const h of headers) {
          if (row[h] === "" || row[h] === null || row[h] === undefined) {
            quality.missingCells++;
          }
        }
      }
      quality.missingRate =
        Math.round(
          (quality.missingCells / (rows.length * headers.length)) * 10000,
        ) /
          100 +
        "%";

      const result = {
        file: path.basename(filePath),
        format,
        overview: quality,
        columns: analyzeHeaders,
        statistics: columnStats,
        chartRecommendations,
        groupedStats,
      };

      const statsLines = analyzeHeaders
        .slice(0, 10)
        .map((h) => {
          const s = columnStats[h];
          if (s.mean !== undefined) {
            return `  ${h}: mean=${s.mean}, std=${s.std}, range=[${s.min}, ${s.max}]`;
          }
          return `  ${h}: categorical (${s.uniqueValues} unique values)`;
        })
        .join("\n");

      const message = [
        `## Data Analysis: ${path.basename(filePath)}`,
        `**${quality.totalRows} rows × ${quality.totalColumns} columns** | Missing: ${quality.missingRate} | Duplicates: ${quality.duplicateRows}`,
        "",
        "### Column Statistics",
        statsLines,
        groupedStats
          ? `\n### Grouped by: ${groupBy} (${Object.keys(groupedStats).length} groups)`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      return { success: true, result, message };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Data analysis failed: ${err.message}`,
      };
    }
  },
};
