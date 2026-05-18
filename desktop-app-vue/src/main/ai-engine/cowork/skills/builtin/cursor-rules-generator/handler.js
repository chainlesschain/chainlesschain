/**
 * Cursor Rules Generator Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");
const fs = require("fs");
const path = require("path");

const FORMATS = {
  cursor: { file: ".cursorrules", name: "Cursor" },
  cline: { file: ".clinerules", name: "Cline" },
  claude: { file: "CLAUDE.md", name: "Claude Code" },
  windsurf: { file: ".windsurfrules", name: "Windsurf" },
  copilot: { file: ".github/copilot-instructions.md", name: "GitHub Copilot" },
};

module.exports = {
  async init(skill) {
    logger.info("[CursorRulesGen] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "generate":
          return handleGenerate(parsed.format, context);
        case "detect":
          return handleDetect(parsed.target, context);
        case "export":
          return handleExport(parsed.format, parsed.options, context);
        default:
          return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[CursorRulesGen] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "generate", format: "cursor", target: ".", options: {} };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "generate").toLowerCase();
  const format = (parts[1] || "cursor").toLowerCase();
  const outputMatch = input.match(/--output\s+(\S+)/);

  return {
    action,
    format,
    target: parts[1] || ".",
    options: { output: outputMatch ? outputMatch[1] : null },
  };
}

function handleGenerate(format, context) {
  const cwd = context.cwd || process.cwd();
  const conventions = detectConventions(cwd);
  const rules = generateRules(format, conventions);
  const formatInfo = FORMATS[format] || FORMATS.cursor;

  return {
    success: true,
    action: "generate",
    format: formatInfo.name,
    filename: formatInfo.file,
    rules,
    conventions: conventions.map((c) => `${c.category}: ${c.value}`),
    message: `Generated ${formatInfo.file} with ${conventions.length} detected convention(s).`,
  };
}

function handleDetect(target, context) {
  const cwd = context.cwd || process.cwd();
  const scanPath = path.resolve(cwd, target || ".");
  const conventions = detectConventions(scanPath);

  return {
    success: true,
    action: "detect",
    path: scanPath,
    conventions,
    message: `Detected ${conventions.length} convention(s) in ${target || "."}.`,
  };
}

function handleExport(format, options, context) {
  const result = handleGenerate(format, context);
  if (!result.success) {
    return result;
  }

  if (options.output) {
    const cwd = context.cwd || process.cwd();
    const outPath = path.resolve(cwd, options.output);
    return {
      ...result,
      action: "export",
      outputPath: outPath,
      message: `Rules ready to write to ${options.output}.`,
    };
  }

  return { ...result, action: "export" };
}

function detectConventions(dir) {
  const conventions = [];

  // Package manager
  if (fileExists(dir, "bun.lockb")) {
    conventions.push({ category: "package-manager", value: "bun" });
  } else if (fileExists(dir, "pnpm-lock.yaml")) {
    conventions.push({ category: "package-manager", value: "pnpm" });
  } else if (fileExists(dir, "yarn.lock")) {
    conventions.push({ category: "package-manager", value: "yarn" });
  } else if (fileExists(dir, "package-lock.json")) {
    conventions.push({ category: "package-manager", value: "npm" });
  }

  // Language / Framework
  const pkg = readJSON(dir, "package.json");
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vue) {
      conventions.push({ category: "framework", value: `Vue ${deps.vue}` });
    }
    if (deps.react) {
      conventions.push({ category: "framework", value: `React ${deps.react}` });
    }
    if (deps.next) {
      conventions.push({
        category: "framework",
        value: `Next.js ${deps.next}`,
      });
    }
    if (deps.svelte) {
      conventions.push({ category: "framework", value: "Svelte" });
    }
    if (deps.electron) {
      conventions.push({
        category: "framework",
        value: `Electron ${deps.electron}`,
      });
    }
    if (deps.express) {
      conventions.push({ category: "framework", value: "Express" });
    }
    if (deps.typescript) {
      conventions.push({ category: "language", value: "TypeScript" });
    }
    if (deps.vitest) {
      conventions.push({ category: "testing", value: "Vitest" });
    } else if (deps.jest) {
      conventions.push({ category: "testing", value: "Jest" });
    }
    if (deps.eslint) {
      conventions.push({ category: "linting", value: "ESLint" });
    }
    if (deps.prettier) {
      conventions.push({ category: "formatting", value: "Prettier" });
    }
    if (deps.tailwindcss) {
      conventions.push({ category: "css", value: "Tailwind CSS" });
    }
  }

  if (fileExists(dir, "tsconfig.json")) {
    conventions.push({ category: "language", value: "TypeScript" });
  }
  if (
    fileExists(dir, "pyproject.toml") ||
    fileExists(dir, "requirements.txt")
  ) {
    conventions.push({ category: "language", value: "Python" });
  }
  if (fileExists(dir, "go.mod")) {
    conventions.push({ category: "language", value: "Go" });
  }
  if (fileExists(dir, "Cargo.toml")) {
    conventions.push({ category: "language", value: "Rust" });
  }
  if (fileExists(dir, "pom.xml") || fileExists(dir, "build.gradle")) {
    conventions.push({ category: "language", value: "Java" });
  }

  // Structure
  if (dirExists(dir, "src")) {
    conventions.push({ category: "structure", value: "src/ directory" });
  }
  if (dirExists(dir, "tests") || dirExists(dir, "__tests__")) {
    conventions.push({
      category: "structure",
      value: "dedicated test directory",
    });
  }
  if (fileExists(dir, "docker-compose.yml") || fileExists(dir, "Dockerfile")) {
    conventions.push({ category: "containerization", value: "Docker" });
  }
  if (fileExists(dir, ".github/workflows")) {
    conventions.push({ category: "ci", value: "GitHub Actions" });
  }

  // Commit conventions
  if (
    fileExists(dir, ".commitlintrc.json") ||
    fileExists(dir, "commitlint.config.js")
  ) {
    conventions.push({ category: "commits", value: "Conventional Commits" });
  }

  // Deduplicate by category+value
  const seen = new Set();
  return conventions.filter((c) => {
    const key = `${c.category}:${c.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function generateRules(format, conventions) {
  const sections = [];

  // Header
  sections.push(`# Project Rules\n`);
  sections.push(`## Detected Conventions\n`);
  for (const c of conventions) {
    sections.push(`- **${c.category}**: ${c.value}`);
  }

  // Language rules
  const langs = conventions
    .filter((c) => c.category === "language")
    .map((c) => c.value);
  if (langs.includes("TypeScript")) {
    sections.push(`\n## TypeScript Rules\n`);
    sections.push(`- Use strict TypeScript. Avoid \`any\` type.`);
    sections.push(`- Prefer interfaces over type aliases for object shapes.`);
    sections.push(`- Use \`const\` assertions where appropriate.`);
  }

  // Framework rules
  const frameworks = conventions
    .filter((c) => c.category === "framework")
    .map((c) => c.value);
  for (const fw of frameworks) {
    if (fw.startsWith("Vue")) {
      sections.push(`\n## Vue Rules\n`);
      sections.push(`- Use Composition API with \`<script setup>\`.`);
      sections.push(`- Use Pinia for state management.`);
      sections.push(`- Component names should be PascalCase.`);
    } else if (fw.startsWith("React") || fw.startsWith("Next")) {
      sections.push(`\n## React Rules\n`);
      sections.push(`- Use functional components with hooks.`);
      sections.push(`- Prefer named exports.`);
      sections.push(`- Use React.memo() for expensive renders.`);
    }
  }

  // Testing rules
  const testing = conventions
    .filter((c) => c.category === "testing")
    .map((c) => c.value);
  if (testing.length) {
    sections.push(`\n## Testing Rules\n`);
    sections.push(`- Testing framework: ${testing.join(", ")}`);
    sections.push(`- Write tests for all new features and bug fixes.`);
    sections.push(
      `- Use descriptive test names: \`it("should do X when Y")\`.`,
    );
  }

  // General
  sections.push(`\n## General Rules\n`);
  sections.push(`- Keep functions small and focused.`);
  sections.push(`- Use meaningful variable and function names.`);
  sections.push(`- Avoid over-engineering. Solve the current problem.`);
  sections.push(`- Use early returns to reduce nesting.`);

  const pkgMgr = conventions.find((c) => c.category === "package-manager");
  if (pkgMgr) {
    sections.push(`- Use \`${pkgMgr.value}\` as the package manager.`);
  }

  const commitConv = conventions.find((c) => c.category === "commits");
  if (commitConv) {
    sections.push(
      `- Follow Conventional Commits format: \`feat:\`, \`fix:\`, \`docs:\`, etc.`,
    );
  }

  return sections.join("\n");
}

function fileExists(dir, name) {
  try {
    return fs.existsSync(path.join(dir, name));
  } catch {
    return false;
  }
}

function dirExists(dir, name) {
  try {
    const p = path.join(dir, name);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJSON(dir, name) {
  try {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
