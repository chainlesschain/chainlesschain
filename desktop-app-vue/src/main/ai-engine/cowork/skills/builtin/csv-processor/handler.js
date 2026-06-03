/**
 * CSV Processor Skill Handler
 *
 * Reads, analyzes, filters, sorts, converts, and merges CSV files.
 * Modes: --read, --head, --analyze, --filter, --sort, --convert, --merge
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── CSV Parsing ─────────────────────────────────────────────────────

function parseCSVLine(line, delimiter) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(content, delimiter) {
  delimiter = delimiter || ",";
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parseCSVLine(lines[0], delimiter);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function detectDelimiter(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsv") {
    return "\t";
  }
  return ",";
}

// ── Column Analysis ─────────────────────────────────────────────────

function isNumeric(val) {
  if (val === "" || val === null || val === undefined) {
    return false;
  }
  return !isNaN(Number(val));
}

function isDateLike(val) {
  if (typeof val !== "string" || val.length < 6) {
    return false;
  }
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(val);
}

function isBooleanLike(val) {
  const lower = String(val).toLowerCase();
  return ["true", "false", "yes", "no", "0", "1"].includes(lower);
}

function analyzeColumn(values) {
  const total = values.length;
  const empties = values.filter(
    (v) => v === "" || v === null || v === undefined,
  ).length;
  const nonEmpty = values.filter(
    (v) => v !== "" && v !== null && v !== undefined,
  );
  const uniqueCount = new Set(nonEmpty).size;

  // Detect type
  const sampleNonEmpty = nonEmpty.slice(0, 100);
  const numericCount = sampleNonEmpty.filter((v) => isNumeric(v)).length;
  const dateCount = sampleNonEmpty.filter((v) => isDateLike(v)).length;
  const boolCount = sampleNonEmpty.filter((v) => isBooleanLike(v)).length;

  let type = "string";
  if (sampleNonEmpty.length > 0) {
    const ratio = 0.8;
    if (numericCount / sampleNonEmpty.length >= ratio) {
      type = "numeric";
    } else if (dateCount / sampleNonEmpty.length >= ratio) {
      type = "date";
    } else if (boolCount / sampleNonEmpty.length >= ratio) {
      type = "boolean";
    }
  } else {
    type = "empty";
  }

  const result = {
    type,
    total,
    nulls: empties,
    unique: uniqueCount,
  };

  // Numeric statistics
  if (type === "numeric") {
    const nums = nonEmpty.filter((v) => isNumeric(v)).map(Number);
    nums.sort((a, b) => a - b);
    const n = nums.length;
    if (n > 0) {
      const sum = nums.reduce((s, v) => s + v, 0);
      const mean = sum / n;
      const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
      const stddev = Math.sqrt(variance);
      result.min = nums[0];
      result.max = nums[n - 1];
      result.mean = Math.round(mean * 1000) / 1000;
      result.median = nums[Math.floor(n / 2)];
      result.stddev = Math.round(stddev * 1000) / 1000;
    }
  }

  return result;
}

// ── Serialization Helpers ───────────────────────────────────────────

function rowsToCSV(headers, rows, delimiter) {
  delimiter = delimiter || ",";
  const lines = [headers.join(delimiter)];
  for (const row of rows) {
    const vals = headers.map((h) => {
      const v = String(row[h] !== undefined ? row[h] : "");
      if (v.includes(delimiter) || v.includes('"') || v.includes("\n")) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    });
    lines.push(vals.join(delimiter));
  }
  return lines.join("\n");
}

function rowsToJSON(rows) {
  return JSON.stringify(rows, null, 2);
}

// ── Filter Condition Parsing ────────────────────────────────────────

function parseCondition(condition) {
  const operators = ["!=", ">=", "<=", ">", "<", "=", "contains"];
  for (const op of operators) {
    const idx = condition.indexOf(op);
    if (idx > 0) {
      const col = condition.substring(0, idx).trim();
      const val = condition
        .substring(idx + op.length)
        .trim()
        .replace(/^["']|["']$/g, "");
      return { col, op, val };
    }
  }
  return null;
}

function evaluateCondition(row, cond) {
  const cellVal = row[cond.col];
  if (cellVal === undefined) {
    return false;
  }
  const a = String(cellVal);
  const b = cond.val;

  switch (cond.op) {
    case "=":
      return a === b;
    case "!=":
      return a !== b;
    case "contains":
      return a.toLowerCase().includes(b.toLowerCase());
    case ">":
      return isNumeric(a) && isNumeric(b) ? Number(a) > Number(b) : a > b;
    case "<":
      return isNumeric(a) && isNumeric(b) ? Number(a) < Number(b) : a < b;
    case ">=":
      return isNumeric(a) && isNumeric(b) ? Number(a) >= Number(b) : a >= b;
    case "<=":
      return isNumeric(a) && isNumeric(b) ? Number(a) <= Number(b) : a <= b;
    default:
      return false;
  }
}

// ── File Helpers ────────────────────────────────────────────────────

function resolveFilePath(filePath, projectRoot) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(projectRoot, filePath);
}

function readCSVFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const delimiter = detectDelimiter(filePath);
  return parseCSV(content, delimiter);
}

function extractFilePath(input, flagPattern) {
  const cleaned = input.replace(flagPattern, "").trim();
  const parts = cleaned.split(/\s+/);
  // Find first part that looks like a file path (not a flag)
  for (const part of parts) {
    if (!part.startsWith("--")) {
      return part;
    }
  }
  return parts[0] || "";
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[csv-processor] handler initialized for "${skill?.name || "csv-processor"}"`,
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    // No input - show usage
    if (!input) {
      return {
        success: true,
        result: { usage: true },
        message: [
          "CSV Processor",
          "=".repeat(30),
          "Usage:",
          "  /csv-processor --read <file>                       Read CSV summary",
          "  /csv-processor --head <file> --rows N              Preview first N rows",
          "  /csv-processor --analyze <file>                    Statistical analysis",
          '  /csv-processor --filter <file> --where "col>val"   Filter rows',
          "  /csv-processor --sort <file> --by <col> --order asc|desc",
          "  /csv-processor --convert <file> --to json|tsv|csv  Format conversion",
          "  /csv-processor --merge <file1> <file2> --output <file>",
        ].join("\n"),
      };
    }

    try {
      // ── --read ──────────────────────────────────────────────
      if (/--read\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--read/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const { headers, rows } = readCSVFile(filePath);
        const preview = rows.slice(0, 5);

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            rows: rows.length,
            columns: headers.length,
            headers,
            preview,
          },
          message: [
            "## CSV Read: " + path.basename(filePath),
            "**" + rows.length + " rows x " + headers.length + " columns**",
            "",
            "### Headers",
            headers.join(", "),
            "",
            "### Preview (first 5 rows)",
            JSON.stringify(preview, null, 2).substring(0, 2000),
          ].join("\n"),
        };
      }

      // ── --head ──────────────────────────────────────────────
      if (/--head\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--head/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const rowsMatch = input.match(/--rows\s+(\d+)/i);
        const rowCount = rowsMatch
          ? Math.min(parseInt(rowsMatch[1]), 1000)
          : 10;
        const { headers, rows } = readCSVFile(filePath);
        const headRows = rows.slice(0, rowCount);

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            totalRows: rows.length,
            shownRows: headRows.length,
            headers,
            data: headRows,
          },
          message: [
            "## CSV Head: " + path.basename(filePath),
            "Showing " + headRows.length + " of " + rows.length + " rows",
            "",
            JSON.stringify(headRows, null, 2).substring(0, 3000),
          ].join("\n"),
        };
      }

      // ── --analyze ───────────────────────────────────────────
      if (/--analyze\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--analyze/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const { headers, rows } = readCSVFile(filePath);

        const columnAnalysis = {};
        for (const h of headers) {
          const values = rows.map((r) => r[h]);
          columnAnalysis[h] = analyzeColumn(values);
        }

        const statsLines = headers.map((h) => {
          const s = columnAnalysis[h];
          if (s.type === "numeric" && s.mean !== undefined) {
            return (
              "  " +
              h +
              " [numeric]: mean=" +
              s.mean +
              ", stddev=" +
              s.stddev +
              ", min=" +
              s.min +
              ", max=" +
              s.max +
              ", median=" +
              s.median +
              ", nulls=" +
              s.nulls
            );
          }
          return (
            "  " +
            h +
            " [" +
            s.type +
            "]: unique=" +
            s.unique +
            ", nulls=" +
            s.nulls
          );
        });

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            rows: rows.length,
            columns: headers.length,
            headers,
            analysis: columnAnalysis,
          },
          message: [
            "## CSV Analysis: " + path.basename(filePath),
            "**" + rows.length + " rows x " + headers.length + " columns**",
            "",
            "### Column Statistics",
            ...statsLines,
          ].join("\n"),
        };
      }

      // ── --filter ────────────────────────────────────────────
      if (/--filter\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--filter/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const whereMatch = input.match(/--where\s+["']?([^"']+)["']?/i);
        if (!whereMatch) {
          return {
            success: false,
            error: "Missing --where condition",
            message:
              'Usage: /csv-processor --filter <file> --where "column>value"',
          };
        }
        const condition = parseCondition(whereMatch[1].trim());
        if (!condition) {
          return {
            success: false,
            error: "Invalid condition: " + whereMatch[1],
            message: "Supported operators: =, !=, >, <, >=, <=, contains",
          };
        }

        const { headers, rows } = readCSVFile(filePath);
        if (!headers.includes(condition.col)) {
          return {
            success: false,
            error: "Column not found: " + condition.col,
            message:
              "Column '" +
              condition.col +
              "' not found. Available: " +
              headers.join(", "),
          };
        }

        const filtered = rows.filter((row) =>
          evaluateCondition(row, condition),
        );

        // Write output if specified
        const outputMatch = input.match(/--output\s+(\S+)/i);
        if (outputMatch) {
          const outPath = resolveFilePath(outputMatch[1], projectRoot);
          const delimiter = detectDelimiter(outPath);
          fs.writeFileSync(
            outPath,
            rowsToCSV(headers, filtered, delimiter),
            "utf-8",
          );
        }

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            originalRows: rows.length,
            filteredRows: filtered.length,
            condition: condition.col + " " + condition.op + " " + condition.val,
            output: outputMatch ? outputMatch[1] : null,
            preview: filtered.slice(0, 5),
          },
          message: [
            "## CSV Filter: " + path.basename(filePath),
            "Condition: " +
              condition.col +
              " " +
              condition.op +
              " " +
              condition.val,
            "Filtered: " +
              filtered.length +
              " of " +
              rows.length +
              " rows match criteria",
            outputMatch ? "Output: " + outputMatch[1] : "",
            "",
            "### Preview (first 5 matches)",
            JSON.stringify(filtered.slice(0, 5), null, 2).substring(0, 2000),
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      // ── --sort ──────────────────────────────────────────────
      if (/--sort\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--sort/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const byMatch = input.match(/--by\s+(\S+)/i);
        if (!byMatch) {
          return {
            success: false,
            error: "Missing --by column",
            message:
              "Usage: /csv-processor --sort <file> --by <column> [--order asc|desc]",
          };
        }
        const sortCol = byMatch[1];
        const orderMatch = input.match(/--order\s+(asc|desc)/i);
        const order = orderMatch ? orderMatch[1].toLowerCase() : "asc";

        const { headers, rows } = readCSVFile(filePath);
        if (!headers.includes(sortCol)) {
          return {
            success: false,
            error: "Column not found: " + sortCol,
            message:
              "Column '" +
              sortCol +
              "' not found. Available: " +
              headers.join(", "),
          };
        }

        // Auto-detect numeric sort
        const sampleVals = rows.slice(0, 50).map((r) => r[sortCol]);
        const numericRatio =
          sampleVals.filter((v) => isNumeric(v)).length /
          (sampleVals.length || 1);
        const useNumeric = numericRatio >= 0.8;

        const sorted = [...rows].sort((a, b) => {
          const va = a[sortCol] || "";
          const vb = b[sortCol] || "";
          let cmp;
          if (useNumeric) {
            cmp = (Number(va) || 0) - (Number(vb) || 0);
          } else {
            cmp = String(va).localeCompare(String(vb));
          }
          return order === "desc" ? -cmp : cmp;
        });

        // Write output if specified
        const outputMatch = input.match(/--output\s+(\S+)/i);
        if (outputMatch) {
          const outPath = resolveFilePath(outputMatch[1], projectRoot);
          const delimiter = detectDelimiter(outPath);
          fs.writeFileSync(
            outPath,
            rowsToCSV(headers, sorted, delimiter),
            "utf-8",
          );
        }

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            rows: sorted.length,
            sortBy: sortCol,
            order,
            sortType: useNumeric ? "numeric" : "string",
            output: outputMatch ? outputMatch[1] : null,
            preview: sorted.slice(0, 5),
          },
          message: [
            "## CSV Sort: " + path.basename(filePath),
            "Sorted " +
              sorted.length +
              " rows by " +
              sortCol +
              " " +
              order +
              " (" +
              (useNumeric ? "numeric" : "string") +
              ")",
            outputMatch ? "Output: " + outputMatch[1] : "",
            "",
            "### Preview (first 5 rows)",
            JSON.stringify(sorted.slice(0, 5), null, 2).substring(0, 2000),
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      // ── --convert ───────────────────────────────────────────
      if (/--convert\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--convert/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const toMatch = input.match(/--to\s+(json|tsv|csv)/i);
        if (!toMatch) {
          return {
            success: false,
            error: "Missing --to format",
            message: "Usage: /csv-processor --convert <file> --to json|tsv|csv",
          };
        }
        const targetFormat = toMatch[1].toLowerCase();

        // Read source file (could be JSON or CSV/TSV)
        const sourceExt = path.extname(filePath).toLowerCase();
        let headers;
        let rows;

        if (sourceExt === ".json") {
          const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          const arr = Array.isArray(raw) ? raw : [raw];
          if (arr.length === 0) {
            return {
              success: false,
              error: "Empty JSON array",
              message: "JSON file contains no records",
            };
          }
          headers = Object.keys(arr[0]);
          rows = arr;
        } else {
          const data = readCSVFile(filePath);
          headers = data.headers;
          rows = data.rows;
        }

        // Convert
        let output;
        let outExt;
        if (targetFormat === "json") {
          output = rowsToJSON(rows);
          outExt = ".json";
        } else if (targetFormat === "tsv") {
          output = rowsToCSV(headers, rows, "\t");
          outExt = ".tsv";
        } else {
          output = rowsToCSV(headers, rows, ",");
          outExt = ".csv";
        }

        // Write output
        const outputMatch = input.match(/--output\s+(\S+)/i);
        let outPath;
        if (outputMatch) {
          outPath = resolveFilePath(outputMatch[1], projectRoot);
        } else {
          const base = path.basename(filePath, path.extname(filePath));
          outPath = path.join(path.dirname(filePath), base + outExt);
        }
        fs.writeFileSync(outPath, output, "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            target: path.basename(outPath),
            format: targetFormat,
            rows: rows.length,
            columns: headers.length,
          },
          message: [
            "## CSV Convert",
            "Converted " +
              path.basename(filePath) +
              " to " +
              targetFormat.toUpperCase() +
              " (" +
              rows.length +
              " records)",
            "Output: " + outPath,
          ].join("\n"),
        };
      }

      // ── --merge ─────────────────────────────────────────────
      if (/--merge\b/i.test(input)) {
        // Extract two file paths after --merge
        const afterMerge = input.replace(/.*--merge\s+/i, "").trim();
        const parts = afterMerge.split(/\s+/);
        const filePaths = [];
        for (const p of parts) {
          if (p.startsWith("--")) {
            break;
          }
          filePaths.push(p);
        }
        if (filePaths.length < 2) {
          return {
            success: false,
            error: "Two files required for merge",
            message:
              "Usage: /csv-processor --merge <file1> <file2> --output <file>",
          };
        }

        const path1 = resolveFilePath(filePaths[0], projectRoot);
        const path2 = resolveFilePath(filePaths[1], projectRoot);
        if (!fs.existsSync(path1)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + path1,
          };
        }
        if (!fs.existsSync(path2)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + path2,
          };
        }

        const data1 = readCSVFile(path1);
        const data2 = readCSVFile(path2);

        // Merge headers (union)
        const mergedHeaders = [
          ...new Set([...data1.headers, ...data2.headers]),
        ];
        const mergedRows = [];

        for (const row of data1.rows) {
          const merged = {};
          mergedHeaders.forEach((h) => {
            merged[h] = row[h] !== undefined ? row[h] : "";
          });
          mergedRows.push(merged);
        }
        for (const row of data2.rows) {
          const merged = {};
          mergedHeaders.forEach((h) => {
            merged[h] = row[h] !== undefined ? row[h] : "";
          });
          mergedRows.push(merged);
        }

        // Write output
        const outputMatch = input.match(/--output\s+(\S+)/i);
        if (outputMatch) {
          const outPath = resolveFilePath(outputMatch[1], projectRoot);
          const delimiter = detectDelimiter(outPath);
          fs.writeFileSync(
            outPath,
            rowsToCSV(mergedHeaders, mergedRows, delimiter),
            "utf-8",
          );
        }

        return {
          success: true,
          result: {
            file1: path.basename(path1),
            file2: path.basename(path2),
            file1Rows: data1.rows.length,
            file2Rows: data2.rows.length,
            mergedRows: mergedRows.length,
            mergedColumns: mergedHeaders.length,
            output: outputMatch ? outputMatch[1] : null,
          },
          message: [
            "## CSV Merge",
            "Merged " +
              path.basename(path1) +
              " (" +
              data1.rows.length +
              " rows) + " +
              path.basename(path2) +
              " (" +
              data2.rows.length +
              " rows)",
            "Result: " +
              mergedRows.length +
              " rows x " +
              mergedHeaders.length +
              " columns",
            outputMatch ? "Output: " + outputMatch[1] : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      // ── Default: treat input as file path for --read ────────
      const rawPath = input.split(/\s+/)[0];
      const filePath = resolveFilePath(rawPath, projectRoot);
      if (fs.existsSync(filePath)) {
        const { headers, rows } = readCSVFile(filePath);
        const preview = rows.slice(0, 5);
        return {
          success: true,
          result: {
            file: path.basename(filePath),
            rows: rows.length,
            columns: headers.length,
            headers,
            preview,
          },
          message: [
            "## CSV Read: " + path.basename(filePath),
            "**" + rows.length + " rows x " + headers.length + " columns**",
            "",
            "### Headers",
            headers.join(", "),
            "",
            "### Preview (first 5 rows)",
            JSON.stringify(preview, null, 2).substring(0, 2000),
          ].join("\n"),
        };
      }

      return {
        success: false,
        error: "Unknown command or file not found",
        message:
          "File not found or unrecognized command: " +
          input +
          "\nRun /csv-processor without arguments to see usage.",
      };
    } catch (err) {
      logger.error("[csv-processor] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "CSV processing failed: " + err.message,
      };
    }
  },
};
