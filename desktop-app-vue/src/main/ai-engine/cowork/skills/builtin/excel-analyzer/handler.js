/**
 * Excel Analyzer Skill Handler
 *
 * Deep analysis of Excel files: sheets, formulas, data validation, summaries.
 * Enhanced: pivot tables, chart data preparation, file comparison.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const _deps = { fs, path, logger };

// ── Helpers ─────────────────────────────────────────

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

function getCellType(cell) {
  if (!cell || cell.value === null || cell.value === undefined) {
    return "empty";
  }
  if (cell.type === 2) {
    return "formula";
  } // ExcelJS formula type
  if (typeof cell.value === "number") {
    return "number";
  }
  if (cell.value instanceof Date) {
    return "date";
  }
  if (typeof cell.value === "boolean") {
    return "boolean";
  }
  if (typeof cell.value === "object" && cell.value.formula) {
    return "formula";
  }
  return "string";
}

// ── Analysis Functions ──────────────────────────────

async function listSheets(filePath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = [];
  workbook.eachSheet((sheet) => {
    sheets.push({
      name: sheet.name,
      rows: sheet.rowCount,
      columns: sheet.columnCount,
      state: sheet.state || "visible",
    });
  });

  return { file: path.basename(filePath), sheetCount: sheets.length, sheets };
}

async function analyzeSheet(filePath, sheetName) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.worksheets[0];

  if (!sheet) {
    return { error: `Sheet "${sheetName}" not found` };
  }

  const headers = [];
  const columnStats = {};
  const headerRow = sheet.getRow(1);

  headerRow.eachCell((cell, colNum) => {
    const name = String(cell.value || `Column${colNum}`);
    headers.push(name);
    columnStats[name] = {
      types: {},
      nullCount: 0,
      uniqueValues: new Set(),
      numericValues: [],
    };
  });

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    headers.forEach((header, idx) => {
      const cell = row.getCell(idx + 1);
      const type = getCellType(cell);
      const stats = columnStats[header];
      if (!stats) {
        return;
      }

      stats.types[type] = (stats.types[type] || 0) + 1;
      if (type === "empty") {
        stats.nullCount++;
      } else {
        stats.uniqueValues.add(String(cell.value));
        if (type === "number") {
          stats.numericValues.push(cell.value);
        }
      }
    });
  }

  const columns = headers.map((h) => {
    const s = columnStats[h];
    const numVals = s.numericValues;
    return {
      name: h,
      types: s.types,
      nullCount: s.nullCount,
      uniqueCount: s.uniqueValues.size,
      stats:
        numVals.length > 0
          ? {
              min: Math.min(...numVals),
              max: Math.max(...numVals),
              avg: numVals.reduce((a, b) => a + b, 0) / numVals.length,
              sum: numVals.reduce((a, b) => a + b, 0),
            }
          : null,
    };
  });

  return {
    sheet: sheet.name,
    rows: sheet.rowCount - 1,
    columns: headers.length,
    columnDetails: columns,
  };
}

async function auditFormulas(filePath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const formulas = [];
  const errors = [];

  workbook.eachSheet((sheet) => {
    sheet.eachRow((row, rowNum) => {
      row.eachCell((cell, colNum) => {
        const formula =
          cell.value && typeof cell.value === "object"
            ? cell.value.formula
            : null;
        if (formula) {
          formulas.push({
            sheet: sheet.name,
            cell: `${String.fromCharCode(64 + colNum)}${rowNum}`,
            formula,
          });

          // Check for error values
          if (
            cell.value.result &&
            typeof cell.value.result === "object" &&
            cell.value.result.error
          ) {
            errors.push({
              sheet: sheet.name,
              cell: `${String.fromCharCode(64 + colNum)}${rowNum}`,
              formula,
              error: cell.value.result.error,
            });
          }
        }
      });
    });
  });

  return {
    file: path.basename(filePath),
    totalFormulas: formulas.length,
    errors: errors.length,
    formulas: formulas.slice(0, 50),
    errorDetails: errors,
  };
}

async function validateData(filePath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const issues = [];

  workbook.eachSheet((sheet) => {
    const colTypes = {};

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) {
        return;
      } // skip header
      row.eachCell((cell, colNum) => {
        const type = getCellType(cell);
        if (type === "empty") {
          return;
        }

        if (!colTypes[colNum]) {
          colTypes[colNum] = {};
        }
        colTypes[colNum][type] = (colTypes[colNum][type] || 0) + 1;
      });
    });

    // Flag columns with mixed types
    Object.entries(colTypes).forEach(([col, types]) => {
      const typeNames = Object.keys(types).filter((t) => t !== "empty");
      if (typeNames.length > 1) {
        issues.push({
          sheet: sheet.name,
          column: Number(col),
          issue: "mixed_types",
          types,
          message: `Column ${col} has mixed types: ${typeNames.join(", ")}`,
        });
      }
    });
  });

  return {
    file: path.basename(filePath),
    totalIssues: issues.length,
    issues,
    valid: issues.length === 0,
  };
}

// ── Pivot Table ─────────────────────────────────────

async function pivotTable(filePath, groupByCol, aggMode) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: "No sheets found" };
  }

  const headers = [];
  sheet.getRow(1).eachCell((cell, colNum) => {
    headers.push({ name: String(cell.value || `Col${colNum}`), col: colNum });
  });

  const groupCol = headers.find(
    (h) => h.name.toLowerCase() === (groupByCol || "").toLowerCase(),
  );
  if (!groupCol) {
    return {
      error: `Column "${groupByCol}" not found. Available: ${headers.map((h) => h.name).join(", ")}`,
    };
  }

  // Find numeric columns for aggregation
  const numericCols = [];
  for (const h of headers) {
    if (h.col === groupCol.col) {
      continue;
    }
    const cell = sheet.getRow(2).getCell(h.col);
    if (typeof cell.value === "number") {
      numericCols.push(h);
    }
  }

  const groups = {};
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const key = String(row.getCell(groupCol.col).value || "");
    if (!groups[key]) {
      groups[key] = {};
    }

    for (const nc of numericCols) {
      const val = row.getCell(nc.col).value;
      if (typeof val === "number") {
        if (!groups[key][nc.name]) {
          groups[key][nc.name] = [];
        }
        groups[key][nc.name].push(val);
      }
    }
  }

  const mode = (aggMode || "sum").toLowerCase();
  const pivotData = {};
  for (const [key, cols] of Object.entries(groups)) {
    pivotData[key] = {};
    for (const [colName, values] of Object.entries(cols)) {
      switch (mode) {
        case "avg":
          pivotData[key][colName] =
            values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case "count":
          pivotData[key][colName] = values.length;
          break;
        case "min":
          pivotData[key][colName] = Math.min(...values);
          break;
        case "max":
          pivotData[key][colName] = Math.max(...values);
          break;
        default:
          pivotData[key][colName] = values.reduce((a, b) => a + b, 0);
      }
    }
  }

  return {
    file: _deps.path.basename(filePath),
    groupBy: groupCol.name,
    aggregation: mode,
    numericColumns: numericCols.map((c) => c.name),
    groups: Object.keys(pivotData).length,
    data: pivotData,
  };
}

// ── Chart Data Preparation ──────────────────────────

async function chartData(filePath, xCol, yCols) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: "No sheets found" };
  }

  const headers = [];
  sheet.getRow(1).eachCell((cell, colNum) => {
    headers.push({ name: String(cell.value || `Col${colNum}`), col: colNum });
  });

  const xHeader = headers.find(
    (h) => h.name.toLowerCase() === (xCol || "").toLowerCase(),
  );
  if (!xHeader) {
    return {
      error: `X column "${xCol}" not found. Available: ${headers.map((h) => h.name).join(", ")}`,
    };
  }

  const yNames = (yCols || "").split(",").map((s) => s.trim().toLowerCase());
  const yHeaders =
    yNames.length > 0 && yNames[0]
      ? headers.filter((h) => yNames.includes(h.name.toLowerCase()))
      : headers.filter((h) => h.col !== xHeader.col);

  if (yHeaders.length === 0) {
    return { error: "No Y columns found." };
  }

  const labels = [];
  const datasets = {};
  for (const yh of yHeaders) {
    datasets[yh.name] = [];
  }

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    labels.push(String(row.getCell(xHeader.col).value || ""));
    for (const yh of yHeaders) {
      const val = row.getCell(yh.col).value;
      datasets[yh.name].push(typeof val === "number" ? val : null);
    }
  }

  return {
    file: _deps.path.basename(filePath),
    xAxis: xHeader.name,
    labels,
    datasets: Object.entries(datasets).map(([name, data]) => ({ name, data })),
  };
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[excel-analyzer] handler initialized for "${skill?.name || "excel-analyzer"}"`,
    );
  },

  async execute(task, context, skill) {
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

    if (!input) {
      return {
        success: true,
        result: { usage: true },
        message:
          "## Excel Analyzer\n\nUsage:\n- `--analyze <file>` — Full analysis\n- `--sheets <file>` — List sheets\n- `--formulas <file>` — Audit formulas\n- `--validate <file>` — Data validation\n- `--summary <file>` — Pivot summary",
      };
    }

    try {
      // Parse action
      const actionMatch = input.match(/^--(\w[\w-]*)/);
      const action = actionMatch ? actionMatch[1] : "analyze";

      // Parse file and sheet
      const sheetMatch = input.match(/--sheet\s+(\S+)/);
      const sheetName = sheetMatch ? sheetMatch[1] : null;

      const fileMatch = input
        .replace(/--\w[\w-]*\s+\S+/g, "")
        .replace(/^--\w[\w-]*/, "")
        .trim()
        .split(/\s+/)[0];
      if (!fileMatch) {
        return {
          success: false,
          error: "No file specified",
          message: "Please provide an Excel file.",
        };
      }

      const filePath = resolvePath(fileMatch, projectRoot);
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found",
          message: `Not found: ${filePath}`,
        };
      }

      switch (action) {
        case "pivot": {
          const groupMatch = input.match(/--group-by\s+(\S+)/);
          const aggMatch = input.match(/--agg\s+(\S+)/);
          const result = await pivotTable(
            filePath,
            groupMatch?.[1],
            aggMatch?.[1],
          );
          if (result.error) {
            return {
              success: false,
              error: result.error,
              message: result.error,
            };
          }
          const rows = Object.entries(result.data).slice(0, 30);
          return {
            success: true,
            result,
            message: `## Pivot Table: ${result.file}\n\nGroup by: **${result.groupBy}** | Aggregation: **${result.aggregation}**\nNumeric columns: ${result.numericColumns.join(", ")}\nGroups: ${result.groups}\n\n| ${result.groupBy} | ${result.numericColumns.join(" | ")} |\n|${"----|".repeat(result.numericColumns.length + 1)}\n${rows.map(([k, v]) => `| ${k} | ${result.numericColumns.map((c) => (v[c] !== undefined ? Number(v[c]).toFixed(2) : "—")).join(" | ")} |`).join("\n")}`,
          };
        }

        case "chart-data": {
          const xMatch = input.match(/--x\s+(\S+)/);
          const yMatch = input.match(/--y\s+(\S+)/);
          const result = await chartData(filePath, xMatch?.[1], yMatch?.[1]);
          if (result.error) {
            return {
              success: false,
              error: result.error,
              message: result.error,
            };
          }
          return {
            success: true,
            result,
            message: `## Chart Data: ${result.file}\n\nX-axis: **${result.xAxis}** (${result.labels.length} points)\nSeries: ${result.datasets.map((d) => d.name).join(", ")}\n\nData prepared for chart generation.`,
          };
        }

        case "sheets": {
          const result = await listSheets(filePath);
          return {
            success: true,
            result,
            message: `## Sheets in ${result.file}\n\n| Sheet | Rows | Columns | State |\n|-------|------|---------|-------|\n${result.sheets.map((s) => `| ${s.name} | ${s.rows} | ${s.columns} | ${s.state} |`).join("\n")}`,
          };
        }

        case "formulas": {
          const result = await auditFormulas(filePath);
          const top10 = result.formulas.slice(0, 10);
          return {
            success: true,
            result,
            message: `## Formula Audit: ${result.file}\n\n**Total formulas**: ${result.totalFormulas}\n**Errors**: ${result.errors}\n\n${top10.length > 0 ? `### Sample Formulas\n| Sheet | Cell | Formula |\n|-------|------|---------|\n${top10.map((f) => `| ${f.sheet} | ${f.cell} | \`${f.formula}\` |`).join("\n")}` : "No formulas found."}${result.errorDetails.length > 0 ? `\n\n### Errors\n${result.errorDetails.map((e) => `- **${e.cell}** (${e.sheet}): ${e.error} — \`${e.formula}\``).join("\n")}` : ""}`,
          };
        }

        case "validate": {
          const result = await validateData(filePath);
          return {
            success: true,
            result,
            message: `## Data Validation: ${result.file}\n\n**Status**: ${result.valid ? "✅ Valid" : `⚠️ ${result.totalIssues} issues found`}\n\n${result.issues.map((i) => `- **${i.sheet}** column ${i.column}: ${i.message}`).join("\n") || "No issues detected."}`,
          };
        }

        case "analyze":
        case "summary":
        default: {
          const analysis = await analyzeSheet(filePath, sheetName);
          if (analysis.error) {
            return {
              success: false,
              error: analysis.error,
              message: analysis.error,
            };
          }

          return {
            success: true,
            result: analysis,
            message: `## Analysis: ${path.basename(filePath)} — ${analysis.sheet}\n\n**${analysis.rows} rows × ${analysis.columns} columns**\n\n| Column | Types | Nulls | Unique | Stats |\n|--------|-------|-------|--------|-------|\n${analysis.columnDetails.map((c) => `| ${c.name} | ${Object.keys(c.types).join(", ")} | ${c.nullCount} | ${c.uniqueCount} | ${c.stats ? `min=${c.stats.min.toFixed(1)}, max=${c.stats.max.toFixed(1)}, avg=${c.stats.avg.toFixed(1)}` : "—"} |`).join("\n")}`,
          };
        }
      }
    } catch (error) {
      logger.error(`[excel-analyzer] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Excel analysis failed: ${error.message}`,
      };
    }
  },

  _deps,
};
