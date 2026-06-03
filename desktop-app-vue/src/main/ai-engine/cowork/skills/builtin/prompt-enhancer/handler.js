/**
 * Prompt Enhancer Skill Handler
 *
 * Analyzes user intent, injects project context, and rewrites prompts
 * for higher-quality AI responses.
 * Modes: --enhance, --analyze, --template
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// Intent classification patterns
const INTENT_PATTERNS = {
  "code-gen":
    /\b(创建|添加|实现|生成|write|add|create|implement|generate|build|make|new)\b/i,
  debug:
    /\b(修复|bug|error|fix|debug|crash|broken|issue|problem|wrong|fail)\b/i,
  explain: /\b(解释|说明|什么是|how|why|explain|describe|understand|what)\b/i,
  refactor:
    /\b(重构|优化|clean|refactor|restructure|simplify|improve|reorganize)\b/i,
  test: /\b(测试|test|coverage|spec|assert|mock|unit|integration|e2e)\b/i,
  deploy: /\b(部署|deploy|release|publish|ci|cd|docker|pipeline|ship)\b/i,
};

// Templates for common scenarios
const PROMPT_TEMPLATES = {
  "code-review": {
    name: "Code Review",
    template:
      "Review {FILE} for: 1) Security vulnerabilities (OWASP Top 10), " +
      "2) Performance issues (N+1 queries, memory leaks, unnecessary re-renders), " +
      "3) Error handling completeness, 4) Code style and naming consistency. " +
      "Output severity-ranked findings with fix suggestions.",
  },
  "bug-fix": {
    name: "Bug Fix",
    template:
      "Debug the issue: {DESCRIPTION}. Steps: 1) Reproduce the bug, " +
      "2) Identify root cause by tracing execution flow, " +
      "3) Check related files for side effects, 4) Propose a minimal fix, " +
      "5) Suggest tests to prevent regression.",
  },
  feature: {
    name: "New Feature",
    template:
      "Implement {FEATURE} in the {TECH_STACK} project. Requirements: " +
      "1) Define the data model/types, 2) Implement backend logic, " +
      "3) Create frontend components, 4) Add IPC handlers if needed, " +
      "5) Write unit tests, 6) Update documentation.",
  },
  refactor: {
    name: "Refactoring",
    template:
      "Refactor {TARGET} to improve {GOAL}. Constraints: " +
      "1) Maintain backward compatibility, 2) Preserve existing tests, " +
      "3) Follow project patterns, 4) Minimize blast radius. " +
      "Show before/after for each change.",
  },
  test: {
    name: "Test Generation",
    template:
      "Write comprehensive tests for {TARGET}. Framework: {FRAMEWORK}. Cover: " +
      "1) Happy path, 2) Edge cases (null, empty, overflow), 3) Error paths, " +
      "4) Async behavior, 5) Mocking external dependencies. Target coverage: {COVERAGE}%.",
  },
  migration: {
    name: "Migration",
    template:
      "Migrate {SOURCE} from {OLD} to {NEW}. Plan: 1) Identify all usages, " +
      "2) Create migration script, 3) Update imports/references, " +
      "4) Run tests, 5) Document breaking changes.",
  },
  architecture: {
    name: "Architecture Design",
    template:
      "Design the architecture for {FEATURE}. Consider: 1) Component boundaries, " +
      "2) Data flow, 3) Error handling strategy, 4) Scalability, " +
      "5) Testing strategy. Output: diagram + implementation plan with file list.",
  },
  documentation: {
    name: "Documentation",
    template:
      "Document {TARGET}: 1) Overview and purpose, " +
      "2) API reference with parameters and return types, " +
      "3) Usage examples (basic + advanced), 4) Configuration options, " +
      "5) Troubleshooting guide.",
  },
  performance: {
    name: "Performance Optimization",
    template:
      "Optimize {TARGET} for {METRIC}. Steps: 1) Profile current performance, " +
      "2) Identify bottlenecks, 3) Apply optimizations (caching, lazy loading, " +
      "batch processing), 4) Benchmark before/after, 5) Document tradeoffs.",
  },
  security: {
    name: "Security Audit",
    template:
      "Audit {TARGET} for security: 1) Input validation, " +
      "2) Authentication/Authorization, 3) Data encryption, " +
      "4) SQL/NoSQL injection, 5) XSS/CSRF, 6) Sensitive data exposure, " +
      "7) Dependencies with known CVEs.",
  },
};

// -- Helpers -----------------------------------------------------------------

function readPackageJson(projectRoot) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
    );
  } catch (_e) {
    return null;
  }
}

function detectTechStack(projectRoot) {
  const pkg = readPackageJson(projectRoot);
  if (!pkg) {
    return [];
  }

  const stack = [];
  const allDeps = Object.assign(
    {},
    pkg.dependencies || {},
    pkg.devDependencies || {},
  );
  const known = {
    electron: "Electron",
    vue: "Vue 3",
    react: "React",
    express: "Express",
    fastapi: "FastAPI",
    vitest: "Vitest",
    jest: "Jest",
    typescript: "TypeScript",
    pinia: "Pinia",
    "ant-design-vue": "Ant Design Vue",
    sqlite3: "SQLite",
    "better-sqlite3": "better-sqlite3",
    sequelize: "Sequelize",
  };

  for (const [dep, label] of Object.entries(known)) {
    if (dep in allDeps) {
      stack.push(label);
    }
  }
  return stack;
}

function scanDirStructure(projectRoot, maxDepth) {
  maxDepth = maxDepth || 2;
  const dirs = [];
  const ignore = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    ".cache",
  ]);

  function walk(dir, depth, prefix) {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    const subdirs = entries
      .filter((e) => e.isDirectory() && !ignore.has(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const sub of subdirs.slice(0, 15)) {
      dirs.push(prefix + sub.name + "/");
      walk(path.join(dir, sub.name), depth + 1, prefix + "  ");
    }
  }

  walk(projectRoot, 0, "");
  return dirs;
}

function classifyIntent(text) {
  const scores = {};
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    const matches = text.match(pattern);
    scores[intent] = matches ? matches.length : 0;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] : "general";
}

function buildContextSnippet(projectRoot, intent) {
  const context = [];
  const techStack = detectTechStack(projectRoot);
  if (techStack.length > 0) {
    context.push("Tech stack: " + techStack.join(", "));
  }

  const pkg = readPackageJson(projectRoot);
  if (pkg) {
    context.push(
      "Project: " + (pkg.name || "unknown") + " v" + (pkg.version || "0.0.0"),
    );
  }

  // Suggest relevant directories based on intent
  const intentDirs = {
    "code-gen": ["src/main", "src/renderer"],
    debug: ["src/main", "src/renderer/stores"],
    explain: ["src/main", "docs"],
    refactor: ["src/main", "src/renderer"],
    test: ["tests", "src/main"],
    deploy: ["docker", ".github"],
  };
  const relevantDirs = intentDirs[intent] || ["src"];
  context.push("Relevant directories: " + relevantDirs.join(", "));

  return context;
}

function enhancePrompt(originalPrompt, projectRoot) {
  const intent = classifyIntent(originalPrompt);
  const context = buildContextSnippet(projectRoot, intent);
  const suggestions = [];

  // Build enhanced prompt
  let enhanced = originalPrompt;

  // Add specificity based on intent
  if (intent === "code-gen" && !originalPrompt.includes("file")) {
    suggestions.push("Specify target file or directory");
  }
  if (intent === "test" && !/vitest|jest|mocha/i.test(originalPrompt)) {
    suggestions.push("Specify test framework (e.g., Vitest)");
    enhanced += ". Use Vitest as the test framework";
  }
  if (intent === "debug" && !originalPrompt.includes("error")) {
    suggestions.push("Include the error message or stack trace");
  }
  if (intent === "refactor" && !originalPrompt.includes("pattern")) {
    suggestions.push("Specify the target design pattern or goal");
  }

  // Inject context
  const contextStr =
    "\n\nProject context:\n" + context.map((c) => "- " + c).join("\n");
  enhanced += contextStr;

  return {
    original: originalPrompt,
    enhanced,
    intent,
    injectedContext: context,
    suggestions,
  };
}

// -- Handler -----------------------------------------------------------------

module.exports = {
  async init(_skill) {
    logger.info(
      "[prompt-enhancer] init: " + (_skill?.name || "prompt-enhancer"),
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

    const enhanceMatch = input.match(/--enhance\s+(.+)/is);
    const analyzeMatch = input.match(/--analyze\s+(.+)/is);
    const templateMatch = input.match(/--template\s+(\S+)/i);

    try {
      if (enhanceMatch) {
        const prompt = enhanceMatch[1].trim();
        const result = enhancePrompt(prompt, projectRoot);

        let msg = "Prompt Enhancement\n" + "=".repeat(40) + "\n";
        msg += "Intent: " + result.intent + "\n";
        msg += "Original: " + result.original + "\n\n";
        msg += "Enhanced:\n" + result.enhanced + "\n";
        if (result.suggestions.length > 0) {
          msg +=
            "\nSuggestions:\n" +
            result.suggestions.map((s) => "  - " + s).join("\n");
        }

        return { success: true, result, message: msg };
      }

      if (analyzeMatch) {
        const prompt = analyzeMatch[1].trim();
        const intent = classifyIntent(prompt);
        const contextItems = buildContextSnippet(projectRoot, intent);
        const suggestions = [];

        if (prompt.split(/\s+/).length < 5) {
          suggestions.push("Add more detail to improve AI response quality");
        }
        if (!/\b(file|directory|function|class|module)\b/i.test(prompt)) {
          suggestions.push("Specify the target file, function, or module");
        }
        if (intent === "general") {
          suggestions.push(
            "Clarify intent: are you generating code, debugging, testing, or explaining?",
          );
        }

        const result = {
          intent,
          contextItems,
          suggestions,
          wordCount: prompt.split(/\s+/).length,
          specificity:
            prompt.length > 50 ? "high" : prompt.length > 20 ? "medium" : "low",
        };

        let msg = "Prompt Analysis\n" + "=".repeat(30) + "\n";
        msg += "Intent: " + intent + "\n";
        msg += "Word count: " + result.wordCount + "\n";
        msg += "Specificity: " + result.specificity + "\n";
        msg +=
          "\nDetected context:\n" +
          contextItems.map((c) => "  - " + c).join("\n");
        if (suggestions.length > 0) {
          msg +=
            "\n\nSuggestions:\n" +
            suggestions.map((s) => "  - " + s).join("\n");
        }

        return { success: true, result, message: msg };
      }

      if (templateMatch) {
        const templateName = templateMatch[1].trim().toLowerCase();
        const template = PROMPT_TEMPLATES[templateName];
        if (!template) {
          const available = Object.keys(PROMPT_TEMPLATES).join(", ");
          return {
            success: false,
            error:
              "Unknown template: " + templateName + ". Available: " + available,
            message:
              "Unknown template: " + templateName + "\nAvailable: " + available,
          };
        }

        const result = {
          templateName,
          template: template.template,
          name: template.name,
        };
        const msg =
          "Template: " +
          template.name +
          "\n" +
          "=".repeat(30) +
          "\n" +
          template.template;
        return { success: true, result, message: msg };
      }

      // No mode specified - show usage and list templates
      if (!input) {
        const templateList = Object.entries(PROMPT_TEMPLATES)
          .map(
            ([key, val]) =>
              "  /prompt-enhancer --template " + key + " -- " + val.name,
          )
          .join("\n");
        return {
          success: true,
          result: { templates: Object.keys(PROMPT_TEMPLATES) },
          message:
            "Prompt Enhancer\n" +
            "=".repeat(30) +
            "\nUsage:\n" +
            "  /prompt-enhancer --enhance <prompt>\n" +
            "  /prompt-enhancer --analyze <prompt>\n" +
            "  /prompt-enhancer --template <name>\n\n" +
            "Available templates:\n" +
            templateList,
        };
      }

      // Default: treat bare input as enhance
      const result = enhancePrompt(input, projectRoot);
      let msg =
        "Prompt Enhancement\n" +
        "=".repeat(40) +
        "\nIntent: " +
        result.intent +
        "\nOriginal: " +
        result.original +
        "\n\nEnhanced:\n" +
        result.enhanced;
      if (result.suggestions.length > 0) {
        msg +=
          "\n\nSuggestions:\n" +
          result.suggestions.map((s) => "  - " + s).join("\n");
      }
      return { success: true, result, message: msg };
    } catch (err) {
      logger.error("[prompt-enhancer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Prompt enhancer failed: " + err.message,
      };
    }
  },
};
