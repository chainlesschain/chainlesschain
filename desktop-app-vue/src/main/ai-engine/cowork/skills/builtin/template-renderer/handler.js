/**
 * Template Renderer Skill Handler
 *
 * Handlebars template rendering engine with variable substitution,
 * conditionals, loops, batch generation, and custom helpers.
 * Modes: --render, --render-inline, --validate, --extract, --batch, --helpers
 */

const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const { logger } = require("../../../../../utils/logger.js");

// ── Built-in helpers ───────────────────────────────────────────────

const BUILTIN_HELPERS = {
  formatDate: {
    description: "Format a date string (YYYY-MM-DD, MM/DD/YYYY, etc.)",
    fn: function (date, format) {
      if (!date) {
        return "";
      }
      const d = new Date(date);
      if (isNaN(d.getTime())) {
        return String(date);
      }
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");

      if (typeof format !== "string") {
        format = "YYYY-MM-DD";
      }
      return format
        .replace(/YYYY/g, yyyy)
        .replace(/MM/g, mm)
        .replace(/DD/g, dd)
        .replace(/HH/g, hh)
        .replace(/mm/g, mi)
        .replace(/ss/g, ss);
    },
  },
  uppercase: {
    description: "Convert string to uppercase",
    fn: function (str) {
      return typeof str === "string" ? str.toUpperCase() : String(str || "");
    },
  },
  lowercase: {
    description: "Convert string to lowercase",
    fn: function (str) {
      return typeof str === "string" ? str.toLowerCase() : String(str || "");
    },
  },
  capitalize: {
    description: "Capitalize first letter of string",
    fn: function (str) {
      const s = typeof str === "string" ? str : String(str || "");
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
  },
  eq: {
    description: "Equality check (block helper support)",
    fn: function (a, b, options) {
      if (options && options.fn) {
        return a === b ? options.fn(this) : options.inverse(this);
      }
      return a === b;
    },
  },
  gt: {
    description: "Greater than comparison",
    fn: function (a, b, options) {
      if (options && options.fn) {
        return a > b ? options.fn(this) : options.inverse(this);
      }
      return a > b;
    },
  },
  json: {
    description: "JSON stringify an object",
    fn: function (obj) {
      try {
        return JSON.stringify(obj, null, 2);
      } catch (_e) {
        return String(obj);
      }
    },
  },
};

function registerHelpers() {
  for (const [name, helper] of Object.entries(BUILTIN_HELPERS)) {
    Handlebars.registerHelper(name, helper.fn);
  }
}

// ── Variable extraction ────────────────────────────────────────────

const VARIABLE_RE = /\{\{([^}#/!>]+)\}\}/g;

function extractVariables(templateStr) {
  const variables = new Set();
  let match;
  const regex = new RegExp(VARIABLE_RE.source, VARIABLE_RE.flags);
  while ((match = regex.exec(templateStr)) !== null) {
    const raw = match[1].trim();
    // Skip helpers that look like function calls with arguments
    // but keep simple dotted paths (e.g., "user.name")
    const parts = raw.split(/\s+/);
    if (parts.length === 1) {
      // Simple variable like {{name}} or {{user.name}}
      variables.add(parts[0]);
    } else {
      // Helper call like {{formatDate date "YYYY-MM-DD"}}
      // Add arguments that look like variable references (not quoted strings)
      for (let i = 1; i < parts.length; i++) {
        const arg = parts[i].replace(/^["']|["']$/g, "");
        if (arg && !/^["']/.test(parts[i]) && !/^\d+$/.test(arg)) {
          variables.add(arg);
        }
      }
    }
  }
  return [...variables].sort();
}

// ── Data parsing ───────────────────────────────────────────────────

function parseData(dataStr) {
  if (!dataStr) {
    return {};
  }
  try {
    return JSON.parse(dataStr);
  } catch (err) {
    throw new Error(
      "Invalid JSON data: " +
        err.message +
        '. Ensure your --data value is valid JSON, e.g. \'{"key":"value"}\'',
    );
  }
}

// ── Resolve file path ──────────────────────────────────────────────

function resolveFile(filePath, projectRoot) {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath);
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    registerHelpers();
    logger.info(
      "[template-renderer] init: " + (_skill?.name || "template-renderer"),
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

    // Ensure helpers are registered
    registerHelpers();

    const renderMatch = input.match(/--render\s+(\S+)/i);
    const renderInlineMatch = input.match(/--render-inline\s+"([^"]+)"/i);
    const dataMatch = input.match(/--data\s+'([^']+)'/i);
    const validateMatch = input.match(/--validate\s+(\S+)/i);
    const extractMatch = input.match(/--extract\s+(\S+)/i);
    const batchMatch = input.match(/--batch\s+(\S+)/i);
    const dataFileMatch = input.match(/--data-file\s+(\S+)/i);
    const isHelpers = /--helpers/i.test(input);

    try {
      // ── --helpers ──────────────────────────────────────────────
      if (isHelpers) {
        const helperList = Object.entries(BUILTIN_HELPERS)
          .map(([name, h]) => "  " + name + " — " + h.description)
          .join("\n");
        return {
          success: true,
          result: {
            helpers: Object.fromEntries(
              Object.entries(BUILTIN_HELPERS).map(([name, h]) => [
                name,
                h.description,
              ]),
            ),
          },
          message:
            "Available Helpers\n" +
            "=".repeat(30) +
            "\n" +
            helperList +
            "\n\nUse in templates: {{helperName arg1 arg2}}",
        };
      }

      // ── --validate <file> ──────────────────────────────────────
      if (validateMatch) {
        const filePath = resolveFile(validateMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found: " + filePath,
            message: "Template file not found: " + filePath,
          };
        }
        const templateStr = fs.readFileSync(filePath, "utf-8");
        try {
          Handlebars.precompile(templateStr);
          const variables = extractVariables(templateStr);
          return {
            success: true,
            result: {
              valid: true,
              file: path.relative(projectRoot, filePath),
              variables,
            },
            message:
              "Template is valid.\nVariables: " +
              (variables.length > 0 ? variables.join(", ") : "(none)"),
          };
        } catch (compileErr) {
          return {
            success: false,
            error: "Template syntax error: " + compileErr.message,
            result: {
              valid: false,
              file: path.relative(projectRoot, filePath),
            },
            message: "Template validation failed: " + compileErr.message,
          };
        }
      }

      // ── --extract <file> ───────────────────────────────────────
      if (extractMatch) {
        const filePath = resolveFile(extractMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found: " + filePath,
            message: "Template file not found: " + filePath,
          };
        }
        const templateStr = fs.readFileSync(filePath, "utf-8");
        const variables = extractVariables(templateStr);
        return {
          success: true,
          result: {
            file: path.relative(projectRoot, filePath),
            variables,
            count: variables.length,
          },
          message:
            "Variables in " +
            path.basename(filePath) +
            "\n" +
            "=".repeat(30) +
            "\nFound " +
            variables.length +
            " variable(s):\n" +
            (variables.length > 0
              ? variables.map((v) => "  - " + v).join("\n")
              : "  (none)"),
        };
      }

      // ── --render-inline "<template>" --data '<json>' ──────────
      if (renderInlineMatch) {
        const templateStr = renderInlineMatch[1];
        const data = parseData(dataMatch ? dataMatch[1] : null);
        const compiled = Handlebars.compile(templateStr);
        const rendered = compiled(data);
        return {
          success: true,
          result: { rendered, data, template: templateStr },
          message: "Rendered: " + rendered,
        };
      }

      // ── --render <file> --data '<json>' ────────────────────────
      if (renderMatch && !batchMatch) {
        const filePath = resolveFile(renderMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found: " + filePath,
            message: "Template file not found: " + filePath,
          };
        }
        const templateStr = fs.readFileSync(filePath, "utf-8");
        const data = parseData(dataMatch ? dataMatch[1] : null);
        const compiled = Handlebars.compile(templateStr);
        const rendered = compiled(data);
        return {
          success: true,
          result: {
            rendered,
            data,
            file: path.relative(projectRoot, filePath),
          },
          message:
            "Rendered template: " +
            path.basename(filePath) +
            "\n" +
            "=".repeat(30) +
            "\n" +
            rendered.substring(0, 3000),
        };
      }

      // ── --batch <template> --data-file <json-array> ────────────
      if (batchMatch) {
        const templatePath = resolveFile(batchMatch[1], projectRoot);
        if (!fs.existsSync(templatePath)) {
          return {
            success: false,
            error: "Template file not found: " + templatePath,
            message: "Template file not found: " + templatePath,
          };
        }
        if (!dataFileMatch) {
          return {
            success: false,
            error: "Missing --data-file argument for batch mode",
            message: "Batch mode requires --data-file <path-to-json-array>.",
          };
        }
        const dataFilePath = resolveFile(dataFileMatch[1], projectRoot);
        if (!fs.existsSync(dataFilePath)) {
          return {
            success: false,
            error: "Data file not found: " + dataFilePath,
            message: "Data file not found: " + dataFilePath,
          };
        }

        const templateStr = fs.readFileSync(templatePath, "utf-8");
        const rawData = fs.readFileSync(dataFilePath, "utf-8");
        let dataArray;
        try {
          dataArray = JSON.parse(rawData);
        } catch (jsonErr) {
          return {
            success: false,
            error: "Invalid JSON in data file: " + jsonErr.message,
            message: "Failed to parse data file as JSON: " + jsonErr.message,
          };
        }
        if (!Array.isArray(dataArray)) {
          return {
            success: false,
            error: "Data file must contain a JSON array",
            message:
              "Batch mode expects a JSON array in the data file, got " +
              typeof dataArray +
              ".",
          };
        }

        const compiled = Handlebars.compile(templateStr);
        const results = dataArray.map((item, index) => {
          try {
            return { index, rendered: compiled(item), success: true };
          } catch (renderErr) {
            return {
              index,
              rendered: null,
              success: false,
              error: renderErr.message,
            };
          }
        });

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.length - successCount;

        let msg = "Batch Render Results\n" + "=".repeat(30) + "\n";
        msg += "Template: " + path.basename(templatePath) + "\n";
        msg +=
          "Items: " +
          results.length +
          " | Success: " +
          successCount +
          " | Failed: " +
          failCount +
          "\n\n";
        for (const r of results.slice(0, 5)) {
          msg += "--- Item " + r.index + " ---\n";
          msg +=
            (r.success
              ? (r.rendered || "").substring(0, 500)
              : "ERROR: " + r.error) + "\n";
        }
        if (results.length > 5) {
          msg += "\n... and " + (results.length - 5) + " more items";
        }

        return {
          success: true,
          result: { results, successCount, failCount, total: results.length },
          message: msg,
        };
      }

      // ── No mode — show usage ───────────────────────────────────
      if (!input) {
        return {
          success: true,
          result: {},
          message:
            "Template Renderer\n" +
            "=".repeat(20) +
            "\nUsage:\n" +
            "  /template-renderer --render <file> --data '<json>'           Render template file\n" +
            "  /template-renderer --render-inline \"<tpl>\" --data '<json>'   Render inline template\n" +
            "  /template-renderer --validate <file>                         Validate template syntax\n" +
            "  /template-renderer --extract <file>                          Extract variables\n" +
            "  /template-renderer --batch <tpl> --data-file <json-array>    Batch render\n" +
            "  /template-renderer --helpers                                 List available helpers",
        };
      }

      // Default: treat as inline render if it looks like a template
      if (input.includes("{{")) {
        const data = parseData(dataMatch ? dataMatch[1] : null);
        const compiled = Handlebars.compile(input);
        const rendered = compiled(data);
        return {
          success: true,
          result: { rendered, data, template: input },
          message: "Rendered: " + rendered,
        };
      }

      return {
        success: false,
        error:
          "Unknown command. Use --render, --render-inline, --validate, --extract, --batch, or --helpers.",
        message:
          "Unknown command. Run /template-renderer without arguments to see usage.",
      };
    } catch (err) {
      logger.error("[template-renderer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Template rendering failed: " + err.message,
      };
    }
  },
};
