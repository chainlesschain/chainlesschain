/**
 * Data Exporter Skill Handler
 *
 * Multi-format data export and conversion between JSON, CSV, Markdown,
 * HTML, TSV, and TXT. Supports batch conversion and format detection.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── CSV Parsing ──────────────────────────────────────────────────────

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

function parseJSON(content) {
  const data = JSON.parse(content);
  if (Array.isArray(data) && data.length > 0) {
    const headers = [...new Set(data.flatMap((item) => Object.keys(item)))];
    return { headers, rows: data };
  }
  if (Array.isArray(data)) {
    return { headers: [], rows: [] };
  }
  return { headers: Object.keys(data), rows: [data] };
}

// ── Format Detection ─────────────────────────────────────────────────

function detectFormatFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { ".csv": "csv", ".tsv": "tsv", ".json": "json", ".txt": "txt" };
  return map[ext] || "csv";
}

function detectDelimiter(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".tsv" ? "\t" : ",";
}

function isNumeric(val) {
  if (val === "" || val === null || val === undefined) {
    return false;
  }
  return !isNaN(Number(val));
}

// ── Serializers ──────────────────────────────────────────────────────

function toCSV(headers, rows, delimiter) {
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

function toJSON(rows) {
  return JSON.stringify(rows, null, 2);
}

function toMarkdownTable(headers, rows) {
  const escaped = (v) =>
    String(v !== undefined && v !== null ? v : "").replace(/\|/g, "\\|");
  const headerLine = "| " + headers.map(escaped).join(" | ") + " |";
  const separatorLine = "| " + headers.map(() => "---").join(" | ") + " |";
  const dataLines = rows.map(
    (row) => "| " + headers.map((h) => escaped(row[h])).join(" | ") + " |",
  );
  return [headerLine, separatorLine, ...dataLines].join("\n");
}

function toHTMLTable(headers, rows) {
  const esc = (v) =>
    String(v !== undefined && v !== null ? v : "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const style = [
    "<style>",
    "  table { border-collapse: collapse; width: 100%; font-family: sans-serif; }",
    "  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }",
    "  th { background-color: #4a90d9; color: white; }",
    "  tr:nth-child(even) { background-color: #f2f2f2; }",
    "  tr:hover { background-color: #e0e0e0; }",
    "</style>",
  ].join("\n");

  const headerCells = headers.map((h) => "      <th>" + esc(h) + "</th>");
  const bodyRows = rows.map((row) => {
    const cells = headers.map((h) => "      <td>" + esc(row[h]) + "</td>");
    return "    <tr>\n" + cells.join("\n") + "\n    </tr>";
  });

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    "  <title>Data Export</title>",
    style,
    "</head>",
    "<body>",
    "<table>",
    "  <thead>",
    "    <tr>",
    headerCells.join("\n"),
    "    </tr>",
    "  </thead>",
    "  <tbody>",
    bodyRows.join("\n"),
    "  </tbody>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

function toTSV(headers, rows) {
  return toCSV(headers, rows, "\t");
}

function toTXT(headers, rows) {
  const lines = [headers.join("\t")];
  for (const row of rows) {
    lines.push(
      headers.map((h) => String(row[h] !== undefined ? row[h] : "")).join("\t"),
    );
  }
  return lines.join("\n");
}

// ── File Helpers ─────────────────────────────────────────────────────

function resolveFilePath(filePath, projectRoot) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(projectRoot, filePath);
}

function readDataFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const format = detectFormatFromExt(filePath);
  if (format === "json") {
    return { ...parseJSON(content), format: "json" };
  }
  const delimiter = detectDelimiter(filePath);
  return { ...parseCSV(content, delimiter), format };
}

function getOutputPath(inputPath, targetFormat, outputArg, projectRoot) {
  if (outputArg) {
    return resolveFilePath(outputArg, projectRoot);
  }
  const extMap = {
    json: ".json",
    csv: ".csv",
    tsv: ".tsv",
    md: ".md",
    html: ".html",
    txt: ".txt",
  };
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(
    path.dirname(inputPath),
    base + (extMap[targetFormat] || ".txt"),
  );
}

function convertData(headers, rows, targetFormat) {
  switch (targetFormat) {
    case "json":
      return toJSON(rows);
    case "csv":
      return toCSV(headers, rows, ",");
    case "tsv":
      return toTSV(headers, rows);
    case "md":
      return toMarkdownTable(headers, rows);
    case "html":
      return toHTMLTable(headers, rows);
    case "txt":
      return toTXT(headers, rows);
    default:
      throw new Error("Unsupported target format: " + targetFormat);
  }
}

// ── Handler ──────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[data-exporter] handler initialized for "${skill?.name || "data-exporter"}"`,
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
          "Data Exporter",
          "=".repeat(30),
          "Usage:",
          "  /data-exporter --export <file> --to json|csv|md|html|tsv|txt [--output <file>]",
          "  /data-exporter --json-to-csv <file> [--output <file>]",
          "  /data-exporter --csv-to-json <file> [--output <file>]",
          "  /data-exporter --json-to-md <file> [--output <file>]",
          "  /data-exporter --json-to-html <file> [--output <file>]",
          "  /data-exporter --detect <file>",
          "  /data-exporter --batch <dir> --to <format> [--output <dir>]",
        ].join("\n"),
      };
    }

    try {
      // ── --export ───────────────────────────────────────────────
      if (/--export\b/i.test(input)) {
        const fileMatch = input.match(/--export\s+(\S+)/i);
        const toMatch = input.match(/--to\s+(json|csv|md|html|tsv|txt)/i);
        if (!fileMatch || !toMatch) {
          return {
            success: false,
            error: "Missing arguments",
            message:
              "Usage: /data-exporter --export <file> --to json|csv|md|html|tsv|txt [--output <file>]",
          };
        }
        const filePath = resolveFilePath(fileMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const targetFormat = toMatch[1].toLowerCase();
        const { headers, rows } = readDataFile(filePath);
        const outputMatch = input.match(/--output\s+(\S+)/i);
        const outPath = getOutputPath(
          filePath,
          targetFormat,
          outputMatch ? outputMatch[1] : null,
          projectRoot,
        );
        const converted = convertData(headers, rows, targetFormat);
        fs.writeFileSync(outPath, converted, "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            target: path.basename(outPath),
            format: targetFormat,
            rows: rows.length,
            columns: headers.length,
            outputPath: outPath,
          },
          message:
            "Exported " +
            path.basename(filePath) +
            " to " +
            targetFormat.toUpperCase() +
            " (" +
            rows.length +
            " records, " +
            headers.length +
            " columns) -> " +
            path.basename(outPath),
        };
      }

      // ── --json-to-csv ─────────────────────────────────────────
      if (/--json-to-csv\b/i.test(input)) {
        const fileMatch = input.match(/--json-to-csv\s+(\S+)/i);
        if (!fileMatch) {
          return {
            success: false,
            error: "Missing file",
            message:
              "Usage: /data-exporter --json-to-csv <file> [--output <file>]",
          };
        }
        const filePath = resolveFilePath(fileMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const { headers, rows } = parseJSON(content);
        const outputMatch = input.match(/--output\s+(\S+)/i);
        const outPath = getOutputPath(
          filePath,
          "csv",
          outputMatch ? outputMatch[1] : null,
          projectRoot,
        );
        fs.writeFileSync(outPath, toCSV(headers, rows, ","), "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            target: path.basename(outPath),
            rows: rows.length,
            columns: headers.length,
          },
          message:
            "Converted JSON to CSV (" +
            rows.length +
            " records, " +
            headers.length +
            " columns) -> " +
            path.basename(outPath),
        };
      }

      // ── --csv-to-json ─────────────────────────────────────────
      if (/--csv-to-json\b/i.test(input)) {
        const fileMatch = input.match(/--csv-to-json\s+(\S+)/i);
        if (!fileMatch) {
          return {
            success: false,
            error: "Missing file",
            message:
              "Usage: /data-exporter --csv-to-json <file> [--output <file>]",
          };
        }
        const filePath = resolveFilePath(fileMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const delimiter = detectDelimiter(filePath);
        const { headers, rows } = parseCSV(content, delimiter);
        const outputMatch = input.match(/--output\s+(\S+)/i);
        const outPath = getOutputPath(
          filePath,
          "json",
          outputMatch ? outputMatch[1] : null,
          projectRoot,
        );
        fs.writeFileSync(outPath, toJSON(rows), "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            target: path.basename(outPath),
            rows: rows.length,
            columns: headers.length,
          },
          message:
            "Converted CSV to JSON (" +
            rows.length +
            " records, " +
            headers.length +
            " columns) -> " +
            path.basename(outPath),
        };
      }

      // ── --json-to-md ──────────────────────────────────────────
      if (/--json-to-md\b/i.test(input)) {
        const fileMatch = input.match(/--json-to-md\s+(\S+)/i);
        if (!fileMatch) {
          return {
            success: false,
            error: "Missing file",
            message:
              "Usage: /data-exporter --json-to-md <file> [--output <file>]",
          };
        }
        const filePath = resolveFilePath(fileMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const { headers, rows } = parseJSON(content);
        const outputMatch = input.match(/--output\s+(\S+)/i);
        const outPath = getOutputPath(
          filePath,
          "md",
          outputMatch ? outputMatch[1] : null,
          projectRoot,
        );
        fs.writeFileSync(outPath, toMarkdownTable(headers, rows), "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            target: path.basename(outPath),
            rows: rows.length,
            columns: headers.length,
          },
          message:
            "Converted JSON to Markdown table (" +
            rows.length +
            " items, " +
            headers.length +
            " columns) -> " +
            path.basename(outPath),
        };
      }

      // ── --json-to-html ────────────────────────────────────────
      if (/--json-to-html\b/i.test(input)) {
        const fileMatch = input.match(/--json-to-html\s+(\S+)/i);
        if (!fileMatch) {
          return {
            success: false,
            error: "Missing file",
            message:
              "Usage: /data-exporter --json-to-html <file> [--output <file>]",
          };
        }
        const filePath = resolveFilePath(fileMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const { headers, rows } = parseJSON(content);
        const outputMatch = input.match(/--output\s+(\S+)/i);
        const outPath = getOutputPath(
          filePath,
          "html",
          outputMatch ? outputMatch[1] : null,
          projectRoot,
        );
        fs.writeFileSync(outPath, toHTMLTable(headers, rows), "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            target: path.basename(outPath),
            rows: rows.length,
            columns: headers.length,
          },
          message:
            "Converted JSON to HTML table (" +
            rows.length +
            " items, " +
            headers.length +
            " columns) -> " +
            path.basename(outPath),
        };
      }

      // ── --detect ──────────────────────────────────────────────
      if (/--detect\b/i.test(input)) {
        const fileMatch = input.match(/--detect\s+(\S+)/i);
        if (!fileMatch) {
          return {
            success: false,
            error: "Missing file",
            message: "Usage: /data-exporter --detect <file>",
          };
        }
        const filePath = resolveFilePath(fileMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }
        const { headers, rows, format } = readDataFile(filePath);

        // Detect column types
        const columnTypes = {};
        for (const h of headers) {
          const values = rows
            .map((r) => r[h])
            .filter((v) => v !== "" && v !== null && v !== undefined);
          const sample = values.slice(0, 100);
          const numCount = sample.filter((v) => isNumeric(v)).length;
          const ratio = sample.length > 0 ? numCount / sample.length : 0;
          columnTypes[h] = ratio >= 0.8 ? "numeric" : "string";
        }

        const stat = {
          file: path.basename(filePath),
          format: format.toUpperCase(),
          rows: rows.length,
          columns: headers.length,
          headers,
          columnTypes,
          sizeBytes: fs.statSync(filePath).size,
        };

        const typeList = headers
          .map((h) => "  " + h + ": " + columnTypes[h])
          .join("\n");

        return {
          success: true,
          result: stat,
          message: [
            "## Format Detection: " + path.basename(filePath),
            "Format: " +
              stat.format +
              ", Rows: " +
              stat.rows +
              ", Columns: " +
              stat.columns +
              ", Size: " +
              (stat.sizeBytes / 1024).toFixed(1) +
              " KB",
            "",
            "### Columns",
            typeList,
          ].join("\n"),
        };
      }

      // ── --batch ───────────────────────────────────────────────
      if (/--batch\b/i.test(input)) {
        const dirMatch = input.match(/--batch\s+(\S+)/i);
        const toMatch = input.match(/--to\s+(json|csv|md|html|tsv|txt)/i);
        if (!dirMatch || !toMatch) {
          return {
            success: false,
            error: "Missing arguments",
            message:
              "Usage: /data-exporter --batch <dir> --to <format> [--output <dir>]",
          };
        }
        const dirPath = resolveFilePath(dirMatch[1], projectRoot);
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
          return {
            success: false,
            error: "Directory not found",
            message: "Directory not found: " + dirPath,
          };
        }
        const targetFormat = toMatch[1].toLowerCase();
        const outputDirMatch = input.match(/--output\s+(\S+)/i);
        const outputDir = outputDirMatch
          ? resolveFilePath(outputDirMatch[1], projectRoot)
          : dirPath;
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const supportedExts = [".json", ".csv", ".tsv"];
        const files = fs.readdirSync(dirPath).filter((f) => {
          const ext = path.extname(f).toLowerCase();
          return supportedExts.includes(ext);
        });

        const results = [];
        for (const file of files) {
          try {
            const filePath = path.join(dirPath, file);
            const { headers, rows } = readDataFile(filePath);
            const converted = convertData(headers, rows, targetFormat);
            const outPath = getOutputPath(
              filePath,
              targetFormat,
              null,
              projectRoot,
            );
            const finalOut = path.join(outputDir, path.basename(outPath));
            fs.writeFileSync(finalOut, converted, "utf-8");
            results.push({
              file,
              rows: rows.length,
              output: path.basename(finalOut),
              success: true,
            });
          } catch (err) {
            results.push({ file, success: false, error: err.message });
          }
        }

        const successCount = results.filter((r) => r.success).length;
        const resultLines = results.map((r) =>
          r.success
            ? "  " + r.file + " -> " + r.output + " (" + r.rows + " rows)"
            : "  " + r.file + " FAILED: " + r.error,
        );

        return {
          success: true,
          result: {
            directory: dirPath,
            targetFormat,
            total: files.length,
            converted: successCount,
            results,
          },
          message: [
            "## Batch Convert: " + path.basename(dirPath) + "/",
            "Converted " +
              successCount +
              " of " +
              files.length +
              " files to " +
              targetFormat.toUpperCase(),
            "",
            "### Results",
            ...resultLines,
          ].join("\n"),
        };
      }

      // ── Unknown command ───────────────────────────────────────
      return {
        success: false,
        error: "Unknown command",
        message:
          "Unrecognized command: " +
          input +
          "\nRun /data-exporter without arguments to see usage.",
      };
    } catch (err) {
      logger.error("[data-exporter] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Data export failed: " + err.message,
      };
    }
  },
};
