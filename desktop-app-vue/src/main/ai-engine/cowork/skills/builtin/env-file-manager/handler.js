/**
 * Env File Manager Skill Handler
 *
 * Manages .env environment variable files: parse, compare, validate,
 * generate templates, detect missing variables, and check for secrets.
 * Modes: --parse, --compare, --missing, --template, --check, --validate, --merge
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Secret detection patterns ────────────────────────────────────────

const SECRET_PATTERNS = [
  { name: "API Key", pattern: /^[a-zA-Z0-9_-]{20,}$/ },
  { name: "JWT Token", pattern: /^eyJ[a-zA-Z0-9_-]+\./ },
  { name: "AWS Key", pattern: /^AKIA[0-9A-Z]{16}$/ },
  { name: "Base64 Encoded", pattern: /^[A-Za-z0-9+/]{40,}={0,2}$/ },
];

const SENSITIVE_KEYS = [
  "PASSWORD",
  "SECRET",
  "TOKEN",
  "API_KEY",
  "PRIVATE_KEY",
  "ACCESS_KEY",
  "AUTH",
];

// ── Env file parser ──────────────────────────────────────────────────

function parseEnvFile(content) {
  const vars = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error("File not found: " + filePath);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return { content, vars: parseEnvFile(content) };
}

function isSensitiveKey(key) {
  const upper = key.toUpperCase();
  return SENSITIVE_KEYS.some((s) => upper.includes(s));
}

function maskValue(value) {
  if (!value || value.length <= 3) {
    return "***";
  }
  return value.substring(0, 3) + "***";
}

function resolveEnvPath(filePath, projectRoot) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(projectRoot, filePath);
}

// ── Action handlers ──────────────────────────────────────────────────

function handleParse(filePath, projectRoot) {
  const resolved = resolveEnvPath(filePath, projectRoot);
  const { vars } = readEnvFile(resolved);
  const keys = Object.keys(vars);
  const entries = keys.map((key) => {
    const sensitive = isSensitiveKey(key);
    return {
      key,
      value: sensitive ? maskValue(vars[key]) : vars[key],
      sensitive,
    };
  });

  let msg = "Env File: " + filePath + "\n" + "=".repeat(30) + "\n";
  msg += "Variables: " + keys.length + "\n\n";
  for (const entry of entries) {
    const tag = entry.sensitive ? " (sensitive)" : "";
    msg += "  " + entry.key + "=" + entry.value + tag + "\n";
  }

  return {
    success: true,
    result: { file: filePath, count: keys.length, variables: entries },
    message: msg,
  };
}

function handleCompare(file1, file2, projectRoot) {
  const resolved1 = resolveEnvPath(file1, projectRoot);
  const resolved2 = resolveEnvPath(file2, projectRoot);
  const vars1 = readEnvFile(resolved1).vars;
  const vars2 = readEnvFile(resolved2).vars;

  const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)]);
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const key of allKeys) {
    const in1 = key in vars1;
    const in2 = key in vars2;
    if (in1 && !in2) {
      removed.push(key);
    } else if (!in1 && in2) {
      added.push(key);
    } else if (vars1[key] !== vars2[key]) {
      changed.push(key);
    } else {
      unchanged.push(key);
    }
  }

  const totalDiffs = added.length + removed.length + changed.length;
  let msg = "Compare: " + file1 + " vs " + file2 + "\n" + "=".repeat(40) + "\n";
  msg += "Total differences: " + totalDiffs + "\n\n";
  if (added.length > 0) {
    msg += "Added (in " + file2 + " only):\n";
    msg += added.map((k) => "  + " + k).join("\n") + "\n\n";
  }
  if (removed.length > 0) {
    msg += "Removed (in " + file1 + " only):\n";
    msg += removed.map((k) => "  - " + k).join("\n") + "\n\n";
  }
  if (changed.length > 0) {
    msg += "Changed:\n";
    msg +=
      changed
        .map((k) => {
          const v1 = isSensitiveKey(k) ? maskValue(vars1[k]) : vars1[k];
          const v2 = isSensitiveKey(k) ? maskValue(vars2[k]) : vars2[k];
          return "  ~ " + k + ": " + v1 + " -> " + v2;
        })
        .join("\n") + "\n\n";
  }
  msg += "Unchanged: " + unchanged.length + " variables\n";

  return {
    success: true,
    result: {
      file1,
      file2,
      added,
      removed,
      changed,
      unchanged: unchanged.length,
    },
    message: msg,
  };
}

function handleMissing(file, template, projectRoot) {
  const resolvedFile = resolveEnvPath(file, projectRoot);
  const resolvedTemplate = resolveEnvPath(template, projectRoot);
  const fileVars = readEnvFile(resolvedFile).vars;
  const templateVars = readEnvFile(resolvedTemplate).vars;

  const missing = Object.keys(templateVars).filter((k) => !(k in fileVars));

  let msg = "Missing Variables\n" + "=".repeat(30) + "\n";
  msg += "File: " + file + "\n";
  msg += "Template: " + template + "\n\n";
  if (missing.length === 0) {
    msg += "No missing variables. All template keys are present.\n";
  } else {
    msg += missing.length + " missing variable(s):\n";
    msg += missing.map((k) => "  - " + k).join("\n") + "\n";
  }

  return {
    success: true,
    result: { file, template, missing, missingCount: missing.length },
    message: msg,
  };
}

function handleTemplate(file, outputPath, projectRoot) {
  const resolvedFile = resolveEnvPath(file, projectRoot);
  const { content, vars } = readEnvFile(resolvedFile);
  const keys = Object.keys(vars);

  // Build template preserving comments and structure
  const lines = content.split("\n");
  const templateLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      templateLines.push(line);
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      templateLines.push(line);
      continue;
    }
    const key = trimmed.substring(0, eqIndex).trim();
    const placeholder = isSensitiveKey(key) ? "changeme" : "your_value_here";
    templateLines.push(key + "=" + placeholder);
  }

  const templateContent = templateLines.join("\n");
  const resolvedOutput = outputPath
    ? resolveEnvPath(outputPath, projectRoot)
    : null;

  if (resolvedOutput) {
    fs.writeFileSync(resolvedOutput, templateContent, "utf-8");
  }

  const relOutput = outputPath || "(not written)";
  let msg = "Template Generated\n" + "=".repeat(30) + "\n";
  msg += "Source: " + file + "\n";
  msg += "Output: " + relOutput + "\n";
  msg += "Variables: " + keys.length + "\n\n";
  msg += "Preview:\n" + templateContent.substring(0, 1000) + "\n";

  return {
    success: true,
    result: {
      source: file,
      output: relOutput,
      variableCount: keys.length,
      content: templateContent,
    },
    generatedFiles: resolvedOutput
      ? [{ path: relOutput, content: templateContent }]
      : [],
    message: msg,
  };
}

function handleCheck(file, projectRoot) {
  const resolvedFile = resolveEnvPath(file, projectRoot);
  const { vars } = readEnvFile(resolvedFile);
  const warnings = [];

  for (const [key, value] of Object.entries(vars)) {
    if (!value) {
      continue;
    }

    // Check sensitive key names with real-looking values
    if (
      isSensitiveKey(key) &&
      value.length > 5 &&
      value !== "changeme" &&
      value !== "your_value_here"
    ) {
      warnings.push({
        key,
        severity: "HIGH",
        reason: "Sensitive key contains a real-looking value",
        masked: maskValue(value),
      });
    }

    // Check against known secret patterns
    for (const sp of SECRET_PATTERNS) {
      if (sp.pattern.test(value)) {
        // Avoid duplicate warnings for already-flagged sensitive keys
        if (!warnings.some((w) => w.key === key)) {
          warnings.push({
            key,
            severity: "MEDIUM",
            reason: "Value matches " + sp.name + " pattern",
            masked: maskValue(value),
          });
        }
        break;
      }
    }
  }

  let msg = "Security Check: " + file + "\n" + "=".repeat(30) + "\n";
  if (warnings.length === 0) {
    msg += "No security issues found.\n";
  } else {
    msg += warnings.length + " potential issue(s):\n\n";
    for (const w of warnings) {
      msg += "  [" + w.severity + "] " + w.key + " (" + w.masked + ")\n";
      msg += "    Reason: " + w.reason + "\n";
    }
  }

  return {
    success: true,
    result: { file, warnings, issueCount: warnings.length },
    message: msg,
  };
}

function handleValidate(file, projectRoot) {
  const resolvedFile = resolveEnvPath(file, projectRoot);
  const { content, vars } = readEnvFile(resolvedFile);
  const issues = [];
  const lines = content.split("\n");
  const seenKeys = {};

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      issues.push({
        line: i + 1,
        type: "syntax",
        message: "Line has no '=' separator: " + trimmed.substring(0, 50),
      });
      continue;
    }

    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();

    // Check for invalid key names (spaces, special chars)
    if (/\s/.test(key)) {
      issues.push({
        line: i + 1,
        type: "key-format",
        message: "Key contains whitespace: '" + key + "'",
      });
    }
    if (/[^a-zA-Z0-9_]/.test(key)) {
      issues.push({
        line: i + 1,
        type: "key-format",
        message: "Key contains special characters: '" + key + "'",
      });
    }

    // Check for duplicate keys
    if (seenKeys[key]) {
      issues.push({
        line: i + 1,
        type: "duplicate",
        message:
          "Duplicate key '" +
          key +
          "' (first seen on line " +
          seenKeys[key] +
          ")",
      });
    }
    seenKeys[key] = i + 1;

    // Check for empty values
    if (!value) {
      issues.push({
        line: i + 1,
        type: "empty-value",
        message: "Empty value for key '" + key + "'",
      });
    }

    // Check for very long values
    if (value.length > 1000) {
      issues.push({
        line: i + 1,
        type: "long-value",
        message:
          "Very long value for '" + key + "' (" + value.length + " chars)",
      });
    }
  }

  let msg = "Validation: " + file + "\n" + "=".repeat(30) + "\n";
  msg += "Variables: " + Object.keys(vars).length + "\n";
  if (issues.length === 0) {
    msg += "No validation issues found.\n";
  } else {
    msg += issues.length + " issue(s):\n\n";
    for (const issue of issues) {
      msg +=
        "  Line " +
        issue.line +
        " [" +
        issue.type +
        "] " +
        issue.message +
        "\n";
    }
  }

  return {
    success: true,
    result: {
      file,
      variableCount: Object.keys(vars).length,
      issues,
      issueCount: issues.length,
    },
    message: msg,
  };
}

function handleMerge(file1, file2, outputPath, projectRoot) {
  const resolvedFile1 = resolveEnvPath(file1, projectRoot);
  const resolvedFile2 = resolveEnvPath(file2, projectRoot);
  const vars1 = readEnvFile(resolvedFile1).vars;
  const vars2 = readEnvFile(resolvedFile2).vars;

  // Merge: file2 values override file1
  const merged = { ...vars1, ...vars2 };
  const mergedLines = Object.entries(merged).map(
    ([key, value]) => key + "=" + value,
  );
  const mergedContent = mergedLines.join("\n") + "\n";

  const resolvedOutput = outputPath
    ? resolveEnvPath(outputPath, projectRoot)
    : null;

  if (resolvedOutput) {
    fs.writeFileSync(resolvedOutput, mergedContent, "utf-8");
  }

  const fromFile1Only = Object.keys(vars1).filter((k) => !(k in vars2)).length;
  const fromFile2Only = Object.keys(vars2).filter((k) => !(k in vars1)).length;
  const overridden = Object.keys(vars1).filter(
    (k) => k in vars2 && vars1[k] !== vars2[k],
  ).length;

  const relOutput = outputPath || "(not written)";
  let msg = "Merge Result\n" + "=".repeat(30) + "\n";
  msg += "Base: " + file1 + " (" + Object.keys(vars1).length + " vars)\n";
  msg += "Override: " + file2 + " (" + Object.keys(vars2).length + " vars)\n";
  msg += "Output: " + relOutput + "\n\n";
  msg += "Total: " + Object.keys(merged).length + " variables\n";
  msg += "From base only: " + fromFile1Only + "\n";
  msg += "From override only: " + fromFile2Only + "\n";
  msg += "Values overridden: " + overridden + "\n";

  return {
    success: true,
    result: {
      file1,
      file2,
      output: relOutput,
      totalVars: Object.keys(merged).length,
      fromFile1Only,
      fromFile2Only,
      overridden,
      content: mergedContent,
    },
    generatedFiles: resolvedOutput
      ? [{ path: relOutput, content: mergedContent }]
      : [],
    message: msg,
  };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[env-file-manager] init: " + (_skill?.name || "env-file-manager"),
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

    const parseMatch = input.match(/--parse\s+(\S+)/i);
    const compareMatch = input.match(/--compare\s+(\S+)\s+(\S+)/i);
    const missingMatch = input.match(/--missing\s+(\S+)\s+(\S+)/i);
    const templateMatch = input.match(/--template\s+(\S+)/i);
    const outputMatch = input.match(/--output\s+(\S+)/i);
    const checkMatch = input.match(/--check\s+(\S+)/i);
    const validateMatch = input.match(/--validate\s+(\S+)/i);
    const mergeMatch = input.match(/--merge\s+(\S+)\s+(\S+)/i);

    try {
      if (parseMatch) {
        return handleParse(parseMatch[1], projectRoot);
      }

      if (compareMatch) {
        return handleCompare(compareMatch[1], compareMatch[2], projectRoot);
      }

      if (missingMatch) {
        return handleMissing(missingMatch[1], missingMatch[2], projectRoot);
      }

      if (templateMatch) {
        return handleTemplate(
          templateMatch[1],
          outputMatch ? outputMatch[1] : null,
          projectRoot,
        );
      }

      if (checkMatch) {
        return handleCheck(checkMatch[1], projectRoot);
      }

      if (validateMatch) {
        return handleValidate(validateMatch[1], projectRoot);
      }

      if (mergeMatch) {
        return handleMerge(
          mergeMatch[1],
          mergeMatch[2],
          outputMatch ? outputMatch[1] : null,
          projectRoot,
        );
      }

      // No mode specified - show usage
      if (!input) {
        return {
          success: true,
          result: {},
          message:
            "Env File Manager\n" +
            "=".repeat(20) +
            "\nUsage:\n" +
            "  /env-file-manager --parse <file>                     Parse and display variables\n" +
            "  /env-file-manager --compare <file1> <file2>          Compare two env files\n" +
            "  /env-file-manager --missing <file> <template>        Detect missing variables\n" +
            "  /env-file-manager --template <file> --output <file>  Generate .env.example\n" +
            "  /env-file-manager --check <file>                     Check for secrets\n" +
            "  /env-file-manager --validate <file>                  Validate format and values\n" +
            "  /env-file-manager --merge <f1> <f2> --output <file>  Merge env files",
        };
      }

      // Default: try to parse the input as a file path
      return handleParse(input, projectRoot);
    } catch (err) {
      logger.error("[env-file-manager] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Env file management failed: " + err.message,
      };
    }
  },
};
