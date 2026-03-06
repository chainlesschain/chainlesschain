/**
 * Skill Creator Handler
 *
 * Create, test, optimize, and validate skills.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const BUILTIN_DIR = path.resolve(__dirname, "..");

module.exports = {
  async init(skill) {
    logger.info("[SkillCreator] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[SkillCreator] Action: ${parsed.action}, Name: ${parsed.name}`);

    try {
      switch (parsed.action) {
        case "create":
          return handleCreate(parsed.name, parsed.description);
        case "test":
          return await handleTest(parsed.name, parsed.testInput, context);
        case "optimize":
          return handleOptimize(parsed.name);
        case "validate":
          return handleValidate(parsed.name);
        case "list-templates":
          return handleListTemplates();
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use create, test, optimize, validate, or list-templates.`,
          };
      }
    } catch (error) {
      logger.error("[SkillCreator] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list-templates" };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "list-templates").toLowerCase();
  const name = parts[1] || "";

  const quotedMatch = trimmed.match(/"([^"]+)"/);
  const description = quotedMatch ? quotedMatch[1] : parts.slice(2).join(" ");

  return {
    action,
    name,
    description,
    testInput: description,
  };
}

function handleCreate(name, description) {
  if (!name) {
    return { success: false, error: "No skill name provided." };
  }

  const skillName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
  const displayName = skillName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const category = guessCategory(description || skillName);

  const skillMd = `---
name: ${skillName}
display-name: ${displayName}
description: ${description || `[Describe what ${displayName} does and when to use it]`}
version: 1.0.0
category: ${category}
user-invocable: true
tags: [${skillName.split("-").join(", ")}]
capabilities: [${skillName}-action]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [${skillName}-tool]
instructions: |
  ${description || `Use this skill when [describe when to use ${displayName}].`}
examples:
  - input: "example usage of ${skillName}"
    action: default
author: ChainlessChain
license: MIT
---

# ${displayName}

${description || "[Add skill description here]"}

## Usage

\`\`\`
/${skillName} <action> [options]
\`\`\`

## Actions

| Action | Description |
| --- | --- |
| \`default\` | [Main action description] |

## Examples

\`\`\`
/${skillName} [example]
\`\`\`
`;

  const handlerJs = `/**
 * ${displayName} Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) {
    logger.info("[${displayName.replace(/\s/g, "")}] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";

    logger.info(\`[${displayName.replace(/\s/g, "")}] Input: "\${input}"\`);

    try {
      // TODO: Implement skill logic
      return {
        success: true,
        action: "default",
        input,
        message: "${displayName} executed successfully.",
      };
    } catch (error) {
      logger.error("[${displayName.replace(/\s/g, "")}] Error:", error);
      return { success: false, error: error.message };
    }
  },
};
`;

  const skillDir = path.join(BUILTIN_DIR, skillName);
  const files = {
    "SKILL.md": skillMd,
    "handler.js": handlerJs,
  };

  // Create if directory doesn't exist
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf8");
    fs.writeFileSync(path.join(skillDir, "handler.js"), handlerJs, "utf8");

    return {
      success: true,
      action: "create",
      skillName,
      skillDir,
      files: ["SKILL.md", "handler.js"],
      message: `Skill "${skillName}" created at ${skillDir}/. Edit SKILL.md and handler.js to customize.`,
    };
  }

  return {
    success: true,
    action: "create",
    skillName,
    skillDir,
    files,
    alreadyExists: true,
    message: `Skill "${skillName}" already exists. Returning generated templates without overwriting.`,
  };
}

async function handleTest(name, testInput, context) {
  if (!name) {
    return { success: false, error: "No skill name provided." };
  }

  const skillDir = path.join(BUILTIN_DIR, name);
  const handlerPath = path.join(skillDir, "handler.js");

  if (!fs.existsSync(handlerPath)) {
    return { success: false, error: `Skill handler not found: ${handlerPath}` };
  }

  try {
    const handler = require(handlerPath);
    if (typeof handler.init === "function") {
      await handler.init({});
    }

    const result = await handler.execute(
      { input: testInput || "test", args: testInput || "test" },
      context,
      {},
    );

    return {
      success: true,
      action: "test",
      skillName: name,
      testInput: testInput || "test",
      result,
      message: `Test completed. Result success: ${result?.success}`,
    };
  } catch (error) {
    return {
      success: false,
      action: "test",
      skillName: name,
      error: error.message,
      message: `Test failed: ${error.message}`,
    };
  }
}

function handleOptimize(name) {
  if (!name) {
    return { success: false, error: "No skill name provided." };
  }

  const skillMdPath = path.join(BUILTIN_DIR, name, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    return { success: false, error: `SKILL.md not found for "${name}".` };
  }

  const content = fs.readFileSync(skillMdPath, "utf8");
  const descMatch = content.match(/description:\s*(.+)/);
  const currentDesc = descMatch ? descMatch[1].trim() : "";

  const suggestions = [];
  if (currentDesc.length < 50) {
    suggestions.push(
      "Description is too short. Add more context about WHEN to use this skill.",
    );
  }
  if (!/use when/i.test(currentDesc) && !/trigger/i.test(currentDesc)) {
    suggestions.push(
      'Add trigger keywords. E.g., "Use when user asks to..." or "Triggers on..."',
    );
  }
  if (currentDesc.length > 200) {
    suggestions.push("Description may be too long. Keep under 200 chars for metadata.");
  }

  return {
    success: true,
    action: "optimize",
    skillName: name,
    currentDescription: currentDesc,
    suggestions,
    message:
      suggestions.length > 0
        ? `Found ${suggestions.length} optimization(s).`
        : "Description looks good!",
  };
}

function handleValidate(name) {
  if (!name) {
    return { success: false, error: "No skill name/path provided." };
  }

  const skillDir = path.join(BUILTIN_DIR, name);
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const handlerPath = path.join(skillDir, "handler.js");

  const issues = [];
  const checks = [];

  // Check SKILL.md exists
  if (!fs.existsSync(skillMdPath)) {
    issues.push("SKILL.md not found");
  } else {
    checks.push("SKILL.md exists");
    const content = fs.readFileSync(skillMdPath, "utf8");

    // Check frontmatter
    if (!content.startsWith("---")) {
      issues.push("Missing YAML frontmatter (---) at start");
    } else {
      checks.push("Has YAML frontmatter");
    }

    // Check required fields
    if (!/^name:/m.test(content)) issues.push("Missing 'name' field");
    else checks.push("Has name field");

    if (!/^description:/m.test(content)) issues.push("Missing 'description' field");
    else checks.push("Has description field");

    if (!/^handler:/m.test(content))
      issues.push("Missing 'handler' field");
    else checks.push("Has handler field");
  }

  // Check handler exists
  if (!fs.existsSync(handlerPath)) {
    issues.push("handler.js not found");
  } else {
    checks.push("handler.js exists");

    try {
      const handler = require(handlerPath);
      if (typeof handler.execute !== "function") {
        issues.push("handler.js missing execute() function");
      } else {
        checks.push("Has execute() function");
      }
      if (typeof handler.init !== "function") {
        issues.push("handler.js missing init() function (optional but recommended)");
      } else {
        checks.push("Has init() function");
      }
    } catch (err) {
      issues.push(`handler.js load error: ${err.message}`);
    }
  }

  return {
    success: issues.length === 0,
    action: "validate",
    skillName: name,
    valid: issues.length === 0,
    checks,
    issues,
    message:
      issues.length === 0
        ? `Skill "${name}" is valid.`
        : `Found ${issues.length} issue(s).`,
  };
}

function handleListTemplates() {
  return {
    success: true,
    action: "list-templates",
    templates: [
      { name: "basic", description: "Simple skill with single action" },
      { name: "multi-action", description: "Skill with multiple actions/modes" },
      { name: "api-integration", description: "Skill that calls external APIs" },
      { name: "file-processor", description: "Skill that processes files" },
      { name: "code-analyzer", description: "Skill that analyzes/transforms code" },
    ],
  };
}

function guessCategory(text) {
  const lower = text.toLowerCase();
  if (/search|knowledge|rag|document|research/.test(lower)) return "knowledge";
  if (/automat|workflow|browser|schedule|cron|watch/.test(lower)) return "automation";
  if (/code|test|lint|review|debug|refactor|deploy/.test(lower)) return "development";
  if (/video|image|audio|media|chart/.test(lower)) return "media";
  if (/content|publish|slide|plan|note/.test(lower)) return "productivity";
  return "general";
}
