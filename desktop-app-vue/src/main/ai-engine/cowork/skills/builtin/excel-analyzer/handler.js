/**
 * Excel Analyzer Skill Handler
 *
 * Deep analysis of Excel files: sheets, formulas, data validation, summaries.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

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
};
