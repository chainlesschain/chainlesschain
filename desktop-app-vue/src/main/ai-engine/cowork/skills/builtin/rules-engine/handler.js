/**
 * Rules Engine Skill Handler
 *
 * Manages project coding conventions, AI behavior rules, and architectural
 * constraints stored as Markdown files with YAML frontmatter. Supports
 * glob-scoped rule matching, validation, and team sharing.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const RULES_DIR_NAME = ".chainlesschain/rules";

// -- YAML Frontmatter Parser -------------------------------------------

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const yamlStr = match[1];
  const body = match[2].trim();
  const meta = {};

  for (const line of yamlStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // Parse arrays: ["a", "b"] or [a, b]
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }

    meta[key] = value;
  }

  return { meta, body };
}

// -- Glob Matching -----------------------------------------------------

function globToRegex(glob) {
  let regex = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          regex += "(?:.*/)?";
          i += 3;
          continue;
        }
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
    } else if (c === "?") {
      regex += "[^/]";
    } else if (c === "{") {
      regex += "(?:";
    } else if (c === "}") {
      regex += ")";
    } else if (c === ",") {
      regex += "|";
    } else if (".+^$|()[]\\".includes(c)) {
      regex += "\\" + c;
    } else {
      regex += c;
    }
    i++;
  }
  regex += "$";
  return new RegExp(regex);
}

function matchesGlob(filePath, globs) {
  const normalized = filePath.replace(/\\/g, "/");
  for (const glob of globs) {
    if (globToRegex(glob).test(normalized)) {
      return true;
    }
  }
  return false;
}

// -- Rule Loading ------------------------------------------------------

function getRulesDir(projectRoot) {
  return path.join(projectRoot, RULES_DIR_NAME);
}

function loadAllRules(rulesDir) {
  if (!fs.existsSync(rulesDir)) {
    return [];
  }

  const files = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"));
  const rules = [];

  for (const file of files) {
    const filePath = path.join(rulesDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = parseFrontmatter(content);
      if (!parsed) {
        rules.push({ file, error: "Invalid frontmatter format" });
        continue;
      }
      const { meta, body } = parsed;
      rules.push({
        file,
        name: meta.name || path.basename(file, ".md"),
        description: meta.description || "",
        globs: Array.isArray(meta.globs) ? meta.globs : [],
        severity: meta.severity || "info",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        content: body,
        valid: true,
      });
    } catch (err) {
      rules.push({ file, error: err.message });
    }
  }

  return rules;
}

// -- Mode: --list ------------------------------------------------------

function modeList(rulesDir) {
  const rules = loadAllRules(rulesDir);
  if (rules.length === 0) {
    return {
      success: true,
      result: { rules: [], matchedCount: 0 },
      message:
        "No rules found. Run `/rules-engine --init` to create the rules directory with a sample rule.",
    };
  }

  const validRules = rules.filter((r) => r.valid);
  const invalidRules = rules.filter((r) => r.error);

  const table = [
    "| Name | Description | Severity | Globs |",
    "| --- | --- | --- | --- |",
  ];
  for (const r of validRules) {
    table.push(
      `| ${r.name} | ${r.description} | ${r.severity} | ${(r.globs || []).join(", ")} |`,
    );
  }

  let message = `Found ${validRules.length} rule(s).\n\n${table.join("\n")}`;
  if (invalidRules.length > 0) {
    message += `\n\n${invalidRules.length} rule file(s) have errors.`;
  }

  return {
    success: true,
    result: { rules: validRules, matchedCount: validRules.length },
    message,
  };
}

// -- Mode: --check -----------------------------------------------------

function modeCheck(rulesDir, filePath, projectRoot) {
  const rules = loadAllRules(rulesDir).filter((r) => r.valid);
  if (rules.length === 0) {
    return {
      success: true,
      result: { rules: [], matchedCount: 0 },
      message: "No rules found to check against.",
    };
  }

  const relativePath = path
    .relative(projectRoot, path.resolve(projectRoot, filePath))
    .replace(/\\/g, "/");
  const matched = rules.filter(
    (r) => r.globs.length === 0 || matchesGlob(relativePath, r.globs),
  );

  const bySeverity = { error: [], warning: [], info: [] };
  for (const r of matched) {
    (bySeverity[r.severity] || bySeverity.info).push(r);
  }

  let message = `File \`${relativePath}\` matches ${matched.length} rule(s).\n`;
  for (const sev of ["error", "warning", "info"]) {
    if (bySeverity[sev].length > 0) {
      message += `\n### ${sev.toUpperCase()} (${bySeverity[sev].length})\n`;
      for (const r of bySeverity[sev]) {
        message += `- **${r.name}**: ${r.description}\n`;
      }
    }
  }

  return {
    success: true,
    result: {
      rules: matched.map((r) => ({
        name: r.name,
        description: r.description,
        globs: r.globs,
        severity: r.severity,
        content: r.content,
      })),
      matchedCount: matched.length,
    },
    message,
  };
}

// -- Mode: --init ------------------------------------------------------

function modeInit(rulesDir) {
  if (fs.existsSync(rulesDir)) {
    const existing = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"));
    return {
      success: true,
      result: { rules: [], matchedCount: 0 },
      message: `Rules directory already exists with ${existing.length} rule file(s): ${rulesDir}`,
    };
  }

  fs.mkdirSync(rulesDir, { recursive: true });

  const sampleLines = [
    "---",
    "name: use-logger-not-console",
    "description: Use the project unified logger instead of console.log",
    'globs: ["src/**/*.js", "src/**/*.ts"]',
    "severity: warning",
    "tags: [quality, logging]",
    "---",
    "",
    "## Rule",
    "",
    "Do not use console.log(), console.warn(), or console.error() directly",
    "in project source code. Use the unified logging module logger instead.",
    "",
    "### Correct",
    "",
    "```js",
    'const { logger } = require("../utils/logger.js");',
    'logger.info("Processing started");',
    'logger.error("Failed to connect", error);',
    "```",
    "",
    "### Incorrect",
    "",
    "```js",
    'console.log("Processing started");  // Use logger.info',
    'console.error("Failed");            // Use logger.error',
    "```",
    "",
    "### Rationale",
    "",
    "The unified logger provides level filtering, formatting, and file output",
    "capabilities essential for debugging and production monitoring.",
    "",
  ];

  fs.writeFileSync(
    path.join(rulesDir, "use-logger-not-console.md"),
    sampleLines.join("\n"),
    "utf-8",
  );
  logger.info(`[rules-engine] Initialized rules directory: ${rulesDir}`);

  return {
    success: true,
    result: { rules: [], matchedCount: 0 },
    message: `Created rules directory with sample rule: ${rulesDir}/use-logger-not-console.md`,
  };
}

// -- Mode: --add -------------------------------------------------------

function modeAdd(rulesDir, name) {
  if (!name || !name.trim()) {
    return {
      success: false,
      error: "Rule name is required",
      message: "Usage: /rules-engine --add <rule-name>",
    };
  }

  const safeName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  const filePath = path.join(rulesDir, `${safeName}.md`);

  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }

  if (fs.existsSync(filePath)) {
    return {
      success: false,
      error: "Rule already exists",
      message: `Rule file already exists: ${filePath}`,
    };
  }

  const templateLines = [
    "---",
    `name: ${safeName}`,
    "description: TODO - describe this rule",
    'globs: ["src/**/*.js", "src/**/*.ts"]',
    "severity: warning",
    "tags: []",
    "---",
    "",
    `## Rule: ${safeName}`,
    "",
    "TODO - Write the rule content here. Describe what is expected, provide",
    "examples of correct and incorrect code, and explain the rationale.",
    "",
  ];

  fs.writeFileSync(filePath, templateLines.join("\n"), "utf-8");
  logger.info(`[rules-engine] Created rule template: ${filePath}`);

  return {
    success: true,
    result: {
      rules: [{ name: safeName, file: `${safeName}.md` }],
      matchedCount: 1,
    },
    message: `Created rule template: ${filePath}\nEdit the file to define your rule.`,
  };
}

// -- Mode: --validate --------------------------------------------------

function modeValidate(rulesDir) {
  if (!fs.existsSync(rulesDir)) {
    return {
      success: false,
      error: "Rules directory does not exist",
      message: `Rules directory not found: ${rulesDir}. Run \`/rules-engine --init\` first.`,
    };
  }

  const rules = loadAllRules(rulesDir);
  const errors = [];

  for (const r of rules) {
    if (r.error) {
      errors.push({ file: r.file, error: r.error });
      continue;
    }
    if (!r.name) {
      errors.push({ file: r.file, error: "Missing 'name' in frontmatter" });
    }
    if (!r.description) {
      errors.push({
        file: r.file,
        error: "Missing 'description' in frontmatter",
      });
    }
    if (!Array.isArray(r.globs) || r.globs.length === 0) {
      errors.push({
        file: r.file,
        error: "Missing or empty 'globs' array - rule will match all files",
      });
    }
    if (!["error", "warning", "info"].includes(r.severity)) {
      errors.push({
        file: r.file,
        error: `Invalid severity '${r.severity}' - must be error, warning, or info`,
      });
    }
    if (!r.content || r.content.length < 10) {
      errors.push({
        file: r.file,
        error: "Rule body is too short or empty",
      });
    }
  }

  const valid = rules.filter(
    (r) => r.valid && !errors.some((e) => e.file === r.file),
  );
  let message = `Validated ${rules.length} rule file(s): ${valid.length} valid, ${errors.length} issue(s).\n`;

  if (errors.length > 0) {
    message += "\n### Issues\n";
    for (const e of errors) {
      message += `- **${e.file}**: ${e.error}\n`;
    }
  }

  return {
    success:
      errors.filter((e) => rules.find((r) => r.file === e.file && r.error))
        .length === 0,
    result: { rules: valid, matchedCount: valid.length, errors },
    message,
  };
}

// -- Handler Entry Point -----------------------------------------------

module.exports = {
  async init(skill) {
    logger.info(
      `[rules-engine] Handler initialized for "${skill?.name || "rules-engine"}"`,
    );
  },

  async execute(task, context, _skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();
    const rulesDir = getRulesDir(projectRoot);

    // Parse mode and target from input
    const parts = input.split(/\s+/);
    const mode = parts[0] || "--list";
    const target = parts.slice(1).join(" ");

    try {
      switch (mode) {
        case "--list":
          return modeList(rulesDir);

        case "--check":
          if (!target) {
            return {
              success: false,
              error: "File path required",
              message: "Usage: /rules-engine --check <file-path>",
            };
          }
          return modeCheck(rulesDir, target, projectRoot);

        case "--init":
          return modeInit(rulesDir);

        case "--add":
          return modeAdd(rulesDir, target);

        case "--validate":
          return modeValidate(rulesDir);

        default:
          // If input looks like a file path, treat as --check
          if (input && !input.startsWith("--")) {
            return modeCheck(rulesDir, input, projectRoot);
          }
          return {
            success: false,
            error: `Unknown mode: ${mode}`,
            message:
              "Available modes: --list, --check <file>, --init, --add <name>, --validate",
          };
      }
    } catch (err) {
      logger.error(`[rules-engine] Error: ${err.message}`);
      return {
        success: false,
        error: err.message,
        message: `Rules engine failed: ${err.message}`,
      };
    }
  },
};
