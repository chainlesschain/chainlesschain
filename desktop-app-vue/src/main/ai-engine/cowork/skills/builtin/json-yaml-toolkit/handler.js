/**
 * JSON/YAML Toolkit Skill Handler
 *
 * Parses, validates, formats, converts, queries, compares, and generates
 * JSON Schema for JSON/YAML/TOML data files.
 * Modes: --format, --minify, --validate, --convert, --query, --diff, --gen-schema
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Format Detection ────────────────────────────────────────────────

function detectFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    return "json";
  }
  if (ext === ".yaml" || ext === ".yml") {
    return "yaml";
  }
  if (ext === ".toml") {
    return "toml";
  }
  return "json";
}

// ── Simple YAML Parser ──────────────────────────────────────────────

function parseSimpleYaml(content) {
  const lines = content.split(/\r?\n/);
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    i++;

    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const trimmed = line.trim();

    // Pop stack to find parent at correct indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item: "- value" or "- key: value"
    if (trimmed.startsWith("- ")) {
      const itemContent = trimmed.substring(2).trim();
      if (!Array.isArray(parent)) {
        // Convert parent key to array if needed
        const parentContainer =
          stack.length > 1 ? stack[stack.length - 2].obj : root;
        const lastKey = Object.keys(parentContainer).pop();
        if (lastKey !== undefined) {
          parentContainer[lastKey] = [];
          stack[stack.length - 1].obj = parentContainer[lastKey];
        }
      }
      const arr = stack[stack.length - 1].obj;
      if (Array.isArray(arr)) {
        if (itemContent.includes(": ")) {
          const colonIdx = itemContent.indexOf(": ");
          const k = itemContent.substring(0, colonIdx).trim();
          const v = parseYamlValue(itemContent.substring(colonIdx + 2).trim());
          const obj = {};
          obj[k] = v;
          arr.push(obj);
          stack.push({ obj, indent: indent + 2 });
        } else {
          arr.push(parseYamlValue(itemContent));
        }
      }
      continue;
    }

    // Key-value pair: "key: value"
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.substring(0, colonIdx).trim();
      const rest = trimmed.substring(colonIdx + 1).trim();

      if (rest === "" || rest === "|" || rest === ">") {
        // Nested object or block scalar
        if (rest === "|" || rest === ">") {
          // Block scalar: collect indented lines
          let block = "";
          while (i < lines.length) {
            const nextLine = lines[i];
            const nextIndentMatch = nextLine.match(/^(\s*)/);
            const nextIndent = nextIndentMatch ? nextIndentMatch[1].length : 0;
            if (nextLine.trim() === "" || nextIndent > indent) {
              block += (block ? "\n" : "") + nextLine.trimStart();
              i++;
            } else {
              break;
            }
          }
          parent[key] = block;
        } else {
          parent[key] = {};
          stack.push({ obj: parent[key], indent });
        }
      } else {
        parent[key] = parseYamlValue(rest);
      }
    }
  }

  return root;
}

function parseYamlValue(val) {
  if (val === "true" || val === "True" || val === "TRUE") {
    return true;
  }
  if (val === "false" || val === "False" || val === "FALSE") {
    return false;
  }
  if (val === "null" || val === "Null" || val === "~") {
    return null;
  }
  if (/^-?\d+$/.test(val)) {
    return parseInt(val, 10);
  }
  if (/^-?\d+\.\d+$/.test(val)) {
    return parseFloat(val);
  }
  // Quoted strings
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1);
  }
  // Inline array [a, b, c]
  if (val.startsWith("[") && val.endsWith("]")) {
    return val
      .slice(1, -1)
      .split(",")
      .map((s) => parseYamlValue(s.trim()));
  }
  return val;
}

// ── Simple YAML Serializer ──────────────────────────────────────────

function serializeToYaml(obj, indent) {
  indent = indent || 0;
  const prefix = "  ".repeat(indent);
  const lines = [];

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length > 0) {
          lines.push(
            prefix + "- " + keys[0] + ": " + formatYamlValue(item[keys[0]]),
          );
          for (let k = 1; k < keys.length; k++) {
            lines.push(
              prefix + "  " + keys[k] + ": " + formatYamlValue(item[keys[k]]),
            );
          }
        } else {
          lines.push(prefix + "- {}");
        }
      } else {
        lines.push(prefix + "- " + formatYamlValue(item));
      }
    }
  } else if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "object" && value !== null) {
        lines.push(prefix + key + ":");
        lines.push(serializeToYaml(value, indent + 1));
      } else {
        lines.push(prefix + key + ": " + formatYamlValue(value));
      }
    }
  } else {
    lines.push(prefix + formatYamlValue(obj));
  }

  return lines.join("\n");
}

function formatYamlValue(val) {
  if (val === null || val === undefined) {
    return "null";
  }
  if (typeof val === "boolean") {
    return val ? "true" : "false";
  }
  if (typeof val === "number") {
    return String(val);
  }
  if (typeof val === "string") {
    if (val === "" || /[:#{}[\],&*?|>!'"%@`]/.test(val) || val.includes("\n")) {
      return (
        '"' +
        val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") +
        '"'
      );
    }
    return val;
  }
  if (Array.isArray(val)) {
    return "[" + val.map(formatYamlValue).join(", ") + "]";
  }
  return String(val);
}

// ── Simple TOML Parser ──────────────────────────────────────────────

function parseSimpleToml(content) {
  const result = {};
  let currentSection = result;
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    // Section header [section] or [section.subsection]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const parts = sectionMatch[1].split(".");
      currentSection = result;
      for (const part of parts) {
        if (!currentSection[part]) {
          currentSection[part] = {};
        }
        currentSection = currentSection[part];
      }
      continue;
    }

    // Key = value
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      const key = line.substring(0, eqIdx).trim();
      const val = line.substring(eqIdx + 1).trim();
      currentSection[key] = parseTomlValue(val);
    }
  }

  return result;
}

function parseTomlValue(val) {
  if (val === "true") {
    return true;
  }
  if (val === "false") {
    return false;
  }
  if (/^-?\d+$/.test(val)) {
    return parseInt(val, 10);
  }
  if (/^-?\d+\.\d+$/.test(val)) {
    return parseFloat(val);
  }
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1);
  }
  if (val.startsWith("[") && val.endsWith("]")) {
    return val
      .slice(1, -1)
      .split(",")
      .map((s) => parseTomlValue(s.trim()));
  }
  return val;
}

// ── File Helpers ────────────────────────────────────────────────────

function resolveFilePath(filePath, projectRoot) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(projectRoot, filePath);
}

function parseFile(filePath, format) {
  const content = fs.readFileSync(filePath, "utf-8");
  if (format === "json") {
    return JSON.parse(content);
  }
  if (format === "yaml") {
    return parseSimpleYaml(content);
  }
  if (format === "toml") {
    return parseSimpleToml(content);
  }
  throw new Error("Unsupported format: " + format);
}

function extractFilePath(input, flagPattern) {
  const cleaned = input.replace(flagPattern, "").trim();
  const parts = cleaned.split(/\s+/);
  for (const part of parts) {
    if (!part.startsWith("--")) {
      return part;
    }
  }
  return parts[0] || "";
}

// ── JSONPath Query ──────────────────────────────────────────────────

function queryJsonPath(obj, pathExpr) {
  // Strip leading $. or $
  let expr = pathExpr;
  if (expr.startsWith("$.")) {
    expr = expr.substring(2);
  } else if (expr.startsWith("$")) {
    expr = expr.substring(1);
  }
  if (!expr) {
    return [obj];
  }

  // Tokenize: split on . but respect [...]
  const tokens = [];
  let current = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "." && !current.includes("[")) {
      if (current) {
        tokens.push(current);
      }
      current = "";
    } else if (ch === "[") {
      if (current) {
        tokens.push(current);
      }
      current = "[";
    } else if (ch === "]") {
      current += "]";
      tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) {
    tokens.push(current);
  }

  let results = [obj];

  for (const token of tokens) {
    const nextResults = [];
    // Wildcard array: [*]
    if (token === "[*]") {
      for (const item of results) {
        if (Array.isArray(item)) {
          nextResults.push(...item);
        } else if (typeof item === "object" && item !== null) {
          nextResults.push(...Object.values(item));
        }
      }
    }
    // Array index: [0], [1], etc.
    else if (/^\[\d+\]$/.test(token)) {
      const idx = parseInt(token.slice(1, -1), 10);
      for (const item of results) {
        if (Array.isArray(item) && idx < item.length) {
          nextResults.push(item[idx]);
        }
      }
    }
    // Key with bracket notation: ["key"]
    else if (/^\["[^"]+"\]$/.test(token)) {
      const key = token.slice(2, -2);
      for (const item of results) {
        if (typeof item === "object" && item !== null && key in item) {
          nextResults.push(item[key]);
        }
      }
    }
    // Regular key
    else {
      for (const item of results) {
        if (typeof item === "object" && item !== null && token in item) {
          nextResults.push(item[token]);
        }
      }
    }
    results = nextResults;
  }

  return results;
}

// ── Deep Diff ───────────────────────────────────────────────────────

function deepDiff(obj1, obj2, basePath) {
  basePath = basePath || "$";
  const diffs = [];

  if (obj1 === obj2) {
    return diffs;
  }

  const type1 = Array.isArray(obj1) ? "array" : typeof obj1;
  const type2 = Array.isArray(obj2) ? "array" : typeof obj2;

  if (type1 !== type2 || (type1 !== "object" && type1 !== "array")) {
    if (obj1 !== obj2) {
      diffs.push({
        path: basePath,
        type: "changed",
        oldVal: obj1,
        newVal: obj2,
      });
    }
    return diffs;
  }

  if (type1 === "array") {
    const maxLen = Math.max(obj1.length, obj2.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = basePath + "[" + i + "]";
      if (i >= obj1.length) {
        diffs.push({ path: itemPath, type: "added", newVal: obj2[i] });
      } else if (i >= obj2.length) {
        diffs.push({ path: itemPath, type: "removed", oldVal: obj1[i] });
      } else {
        diffs.push(...deepDiff(obj1[i], obj2[i], itemPath));
      }
    }
    return diffs;
  }

  // Objects
  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
  for (const key of allKeys) {
    const keyPath = basePath + "." + key;
    if (!(key in obj1)) {
      diffs.push({ path: keyPath, type: "added", newVal: obj2[key] });
    } else if (!(key in obj2)) {
      diffs.push({ path: keyPath, type: "removed", oldVal: obj1[key] });
    } else {
      diffs.push(...deepDiff(obj1[key], obj2[key], keyPath));
    }
  }

  return diffs;
}

// ── JSON Schema Generator ───────────────────────────────────────────

function generateSchema(value) {
  if (value === null || value === undefined) {
    return { type: "null" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }
  if (typeof value === "string") {
    return { type: "string" };
  }
  if (Array.isArray(value)) {
    const schema = { type: "array" };
    if (value.length > 0) {
      // Infer items schema from first element
      schema.items = generateSchema(value[0]);
    }
    return schema;
  }
  if (typeof value === "object") {
    const schema = {
      type: "object",
      properties: {},
      required: [],
    };
    for (const [key, val] of Object.entries(value)) {
      schema.properties[key] = generateSchema(val);
      // All keys present in the sample are considered required
      schema.required.push(key);
    }
    if (schema.required.length === 0) {
      delete schema.required;
    }
    return schema;
  }
  return {};
}

// ── Basic JSON Schema Validator ─────────────────────────────────────

function validateSchema(data, schema, basePath) {
  basePath = basePath || "$";
  const errors = [];

  if (!schema || typeof schema !== "object") {
    return errors;
  }

  // Type check
  if (schema.type) {
    const actualType = getJsonType(data);
    const allowedTypes = Array.isArray(schema.type)
      ? schema.type
      : [schema.type];
    if (!allowedTypes.includes(actualType)) {
      errors.push({
        path: basePath,
        message:
          "Expected type " + allowedTypes.join("|") + " but got " + actualType,
      });
      return errors;
    }
  }

  // Enum check
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push({
      path: basePath,
      message: "Value must be one of: " + schema.enum.join(", "),
    });
  }

  // Object checks
  if (schema.type === "object" && typeof data === "object" && data !== null) {
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in data)) {
          errors.push({
            path: basePath + "." + req,
            message: "Required property missing: " + req,
          });
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          errors.push(
            ...validateSchema(data[key], propSchema, basePath + "." + key),
          );
        }
      }
    }
  }

  // Array checks
  if (schema.type === "array" && Array.isArray(data)) {
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        errors.push(
          ...validateSchema(data[i], schema.items, basePath + "[" + i + "]"),
        );
      }
    }
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path: basePath,
        message: "Array too short: min " + schema.minItems,
      });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        path: basePath,
        message: "Array too long: max " + schema.maxItems,
      });
    }
  }

  // String checks
  if (schema.type === "string" && typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path: basePath,
        message: "String too short: min " + schema.minLength,
      });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        path: basePath,
        message: "String too long: max " + schema.maxLength,
      });
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(data)) {
          errors.push({
            path: basePath,
            message: "String does not match pattern: " + schema.pattern,
          });
        }
      } catch (_e) {
        /* ignore invalid regex */
      }
    }
  }

  // Number checks
  if (
    (schema.type === "number" || schema.type === "integer") &&
    typeof data === "number"
  ) {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({
        path: basePath,
        message: "Value below minimum: " + schema.minimum,
      });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({
        path: basePath,
        message: "Value above maximum: " + schema.maximum,
      });
    }
  }

  return errors;
}

function getJsonType(val) {
  if (val === null || val === undefined) {
    return "null";
  }
  if (Array.isArray(val)) {
    return "array";
  }
  if (typeof val === "number") {
    return Number.isInteger(val) ? "integer" : "number";
  }
  return typeof val;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[json-yaml-toolkit] handler initialized for "${skill?.name || "json-yaml-toolkit"}"`,
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
          "JSON/YAML Toolkit",
          "=".repeat(30),
          "Usage:",
          "  /json-yaml-toolkit --format <file>                      Format (prettify)",
          "  /json-yaml-toolkit --minify <file>                      Minify JSON",
          "  /json-yaml-toolkit --validate <file>                    Validate syntax",
          "  /json-yaml-toolkit --validate <file> --schema <schema>  Validate with schema",
          "  /json-yaml-toolkit --convert <file> --to json|yaml|toml Convert format",
          '  /json-yaml-toolkit --query <file> --path "$.key"        JSONPath query',
          "  /json-yaml-toolkit --diff <file1> <file2>               Compare files",
          "  /json-yaml-toolkit --gen-schema <file>                  Generate JSON Schema",
        ].join("\n"),
      };
    }

    try {
      // ── --format ────────────────────────────────────────────
      if (/--format\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--format/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }

        const format = detectFormat(filePath);
        const data = parseFile(filePath, format);
        let formatted;

        if (format === "json") {
          formatted = JSON.stringify(data, null, 2);
        } else if (format === "yaml") {
          formatted = serializeToYaml(data);
        } else {
          formatted = JSON.stringify(data, null, 2);
        }

        fs.writeFileSync(filePath, formatted + "\n", "utf-8");

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            format,
            size: formatted.length,
          },
          message: [
            "## Formatted: " + path.basename(filePath),
            "Format: " +
              format.toUpperCase() +
              " | Size: " +
              formatted.length +
              " chars",
            "",
            "Preview:",
            "```" + format,
            formatted.substring(0, 2000),
            "```",
          ].join("\n"),
        };
      }

      // ── --minify ────────────────────────────────────────────
      if (/--minify\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--minify/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }

        const format = detectFormat(filePath);
        const data = parseFile(filePath, format);
        const minified = JSON.stringify(data);

        const outputMatch = input.match(/--output\s+(\S+)/i);
        const outPath = outputMatch
          ? resolveFilePath(outputMatch[1], projectRoot)
          : filePath;
        fs.writeFileSync(outPath, minified, "utf-8");

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            output: path.basename(outPath),
            originalSize: fs.statSync(filePath).size,
            minifiedSize: minified.length,
          },
          message: [
            "## Minified: " + path.basename(filePath),
            "Size: " + minified.length + " chars",
            "Output: " + outPath,
          ].join("\n"),
        };
      }

      // ── --validate ──────────────────────────────────────────
      if (/--validate\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--validate/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }

        const format = detectFormat(filePath);
        let data;
        try {
          data = parseFile(filePath, format);
        } catch (parseErr) {
          return {
            success: true,
            result: {
              valid: false,
              file: path.basename(filePath),
              format,
              error: parseErr.message,
            },
            message: [
              "## Validation Failed: " + path.basename(filePath),
              "Format: " + format.toUpperCase(),
              "Error: " + parseErr.message,
            ].join("\n"),
          };
        }

        // Schema validation if --schema provided
        const schemaMatch = input.match(/--schema\s+(\S+)/i);
        if (schemaMatch) {
          const schemaPath = resolveFilePath(schemaMatch[1], projectRoot);
          if (!fs.existsSync(schemaPath)) {
            return {
              success: false,
              error: "Schema file not found",
              message: "Schema not found: " + schemaPath,
            };
          }
          const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
          const errors = validateSchema(data, schema);

          if (errors.length === 0) {
            return {
              success: true,
              result: {
                valid: true,
                file: path.basename(filePath),
                checks: Object.keys(schema.properties || {}).length || 1,
              },
              message:
                "Valid: all checks passed for " + path.basename(filePath),
            };
          }

          return {
            success: true,
            result: { valid: false, file: path.basename(filePath), errors },
            message: [
              "## Schema Validation Failed: " + path.basename(filePath),
              errors.length + " error(s):",
              ...errors.map((e) => "  - " + e.path + ": " + e.message),
            ].join("\n"),
          };
        }

        // Syntax-only validation
        return {
          success: true,
          result: {
            valid: true,
            file: path.basename(filePath),
            format,
            keys:
              typeof data === "object" && data !== null
                ? Object.keys(data).length
                : 0,
          },
          message: [
            "## Valid: " + path.basename(filePath),
            "Format: " + format.toUpperCase(),
            "Parsed successfully" +
              (typeof data === "object" && data !== null
                ? " (" + Object.keys(data).length + " top-level keys)"
                : ""),
          ].join("\n"),
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

        const toMatch = input.match(/--to\s+(json|yaml|toml)/i);
        if (!toMatch) {
          return {
            success: false,
            error: "Missing --to format",
            message:
              "Usage: /json-yaml-toolkit --convert <file> --to json|yaml|toml",
          };
        }
        const targetFormat = toMatch[1].toLowerCase();
        const sourceFormat = detectFormat(filePath);
        const data = parseFile(filePath, sourceFormat);

        let output;
        let outExt;
        if (targetFormat === "json") {
          output = JSON.stringify(data, null, 2);
          outExt = ".json";
        } else if (targetFormat === "yaml") {
          output = serializeToYaml(data);
          outExt = ".yaml";
        } else {
          // Simple TOML serialization for flat/shallow objects
          output = serializeToToml(data);
          outExt = ".toml";
        }

        const outputMatch = input.match(/--output\s+(\S+)/i);
        let outPath;
        if (outputMatch) {
          outPath = resolveFilePath(outputMatch[1], projectRoot);
        } else {
          const base = path.basename(filePath, path.extname(filePath));
          outPath = path.join(path.dirname(filePath), base + outExt);
        }
        fs.writeFileSync(outPath, output + "\n", "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            sourceFormat,
            target: path.basename(outPath),
            targetFormat,
          },
          message: [
            "## Converted: " +
              sourceFormat.toUpperCase() +
              " -> " +
              targetFormat.toUpperCase(),
            "Source: " + path.basename(filePath),
            "Output: " + outPath,
          ].join("\n"),
        };
      }

      // ── --query ─────────────────────────────────────────────
      if (/--query\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--query/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }

        const pathMatch = input.match(
          /--path\s+["']?([^"'\s]+(?:\.[^"'\s]+)*)["']?/i,
        );
        if (!pathMatch) {
          return {
            success: false,
            error: "Missing --path expression",
            message:
              'Usage: /json-yaml-toolkit --query <file> --path "$.key.path"',
          };
        }

        const format = detectFormat(filePath);
        const data = parseFile(filePath, format);
        const results = queryJsonPath(data, pathMatch[1]);

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            path: pathMatch[1],
            count: results.length,
            results,
          },
          message: [
            "## Query: " + pathMatch[1],
            "File: " +
              path.basename(filePath) +
              " | Matches: " +
              results.length,
            "",
            "Results:",
            JSON.stringify(results, null, 2).substring(0, 3000),
          ].join("\n"),
        };
      }

      // ── --diff ──────────────────────────────────────────────
      if (/--diff\b/i.test(input)) {
        const afterDiff = input.replace(/.*--diff\s+/i, "").trim();
        const parts = afterDiff.split(/\s+/);
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
            error: "Two files required",
            message: "Usage: /json-yaml-toolkit --diff <file1> <file2>",
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

        const format1 = detectFormat(path1);
        const format2 = detectFormat(path2);
        const data1 = parseFile(path1, format1);
        const data2 = parseFile(path2, format2);
        const diffs = deepDiff(data1, data2);

        if (diffs.length === 0) {
          return {
            success: true,
            result: {
              identical: true,
              file1: path.basename(path1),
              file2: path.basename(path2),
            },
            message: "Files are identical (after parsing).",
          };
        }

        const added = diffs.filter((d) => d.type === "added").length;
        const removed = diffs.filter((d) => d.type === "removed").length;
        const changed = diffs.filter((d) => d.type === "changed").length;

        const diffLines = diffs.slice(0, 50).map((d) => {
          if (d.type === "added") {
            return "  + " + d.path + ": " + JSON.stringify(d.newVal);
          }
          if (d.type === "removed") {
            return "  - " + d.path + ": " + JSON.stringify(d.oldVal);
          }
          return (
            "  ~ " +
            d.path +
            ": " +
            JSON.stringify(d.oldVal) +
            " -> " +
            JSON.stringify(d.newVal)
          );
        });

        return {
          success: true,
          result: {
            file1: path.basename(path1),
            file2: path.basename(path2),
            totalDiffs: diffs.length,
            added,
            removed,
            changed,
            diffs: diffs.slice(0, 100),
          },
          message: [
            "## Diff: " + path.basename(path1) + " vs " + path.basename(path2),
            diffs.length +
              " difference(s): " +
              changed +
              " changed, " +
              added +
              " added, " +
              removed +
              " removed",
            "",
            ...diffLines,
            diffs.length > 50 ? "... and " + (diffs.length - 50) + " more" : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      // ── --gen-schema ────────────────────────────────────────
      if (/--gen-schema\b/i.test(input)) {
        const rawPath = extractFilePath(input, /--gen-schema/i);
        const filePath = resolveFilePath(rawPath, projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "File not found: " + filePath,
          };
        }

        const format = detectFormat(filePath);
        const data = parseFile(filePath, format);
        const schema = {
          $schema: "http://json-schema.org/draft-07/schema#",
          ...generateSchema(data),
        };

        // Write schema file
        const outputMatch = input.match(/--output\s+(\S+)/i);
        let outPath;
        if (outputMatch) {
          outPath = resolveFilePath(outputMatch[1], projectRoot);
        } else {
          const base = path.basename(filePath, path.extname(filePath));
          outPath = path.join(path.dirname(filePath), base + ".schema.json");
        }
        const schemaStr = JSON.stringify(schema, null, 2);
        fs.writeFileSync(outPath, schemaStr + "\n", "utf-8");

        return {
          success: true,
          result: {
            source: path.basename(filePath),
            schema,
            output: path.basename(outPath),
          },
          message: [
            "## Generated Schema: " + path.basename(outPath),
            "Source: " +
              path.basename(filePath) +
              " (" +
              format.toUpperCase() +
              ")",
            "",
            "```json",
            schemaStr.substring(0, 3000),
            "```",
          ].join("\n"),
        };
      }

      // ── Default: auto-detect file and format ────────────────
      const rawPath = input.split(/\s+/)[0];
      const filePath = resolveFilePath(rawPath, projectRoot);
      if (fs.existsSync(filePath)) {
        const format = detectFormat(filePath);
        const data = parseFile(filePath, format);
        const formatted =
          format === "json"
            ? JSON.stringify(data, null, 2)
            : serializeToYaml(data);

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            format,
            keys:
              typeof data === "object" && data !== null
                ? Object.keys(data).length
                : 0,
          },
          message: [
            "## Read: " +
              path.basename(filePath) +
              " (" +
              format.toUpperCase() +
              ")",
            "",
            "```" + format,
            formatted.substring(0, 3000),
            "```",
          ].join("\n"),
        };
      }

      return {
        success: false,
        error: "Unknown command or file not found",
        message:
          "File not found or unrecognized command: " +
          input +
          "\nRun /json-yaml-toolkit without arguments to see usage.",
      };
    } catch (err) {
      logger.error("[json-yaml-toolkit] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "JSON/YAML processing failed: " + err.message,
      };
    }
  },
};

// ── Simple TOML Serializer ──────────────────────────────────────────

function serializeToToml(obj, prefix) {
  prefix = prefix || "";
  const lines = [];
  const sections = [];

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sections.push([key, value]);
    } else {
      lines.push(key + " = " + formatTomlValue(value));
    }
  }

  for (const [key, value] of sections) {
    const sectionKey = prefix ? prefix + "." + key : key;
    lines.push("");
    lines.push("[" + sectionKey + "]");
    lines.push(serializeToToml(value, sectionKey));
  }

  return lines.join("\n");
}

function formatTomlValue(val) {
  if (val === null || val === undefined) {
    return '""';
  }
  if (typeof val === "boolean") {
    return val ? "true" : "false";
  }
  if (typeof val === "number") {
    return String(val);
  }
  if (typeof val === "string") {
    return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  if (Array.isArray(val)) {
    return "[" + val.map(formatTomlValue).join(", ") + "]";
  }
  return '"' + String(val) + '"';
}
