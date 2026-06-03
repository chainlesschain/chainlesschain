/**
 * Project Onboarding Skill Handler
 *
 * Analyzes project structure, README, dependencies, and key files to generate
 * a comprehensive onboarding document. Inspired by Continue.dev's /onboard.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  "coverage",
  ".cache",
]);
const CODE_EXTS = new Set([
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "vue",
  "py",
  "java",
  "kt",
  "go",
  "rs",
  "swift",
]);

module.exports = {
  async init(skill) {
    logger.info("[OnboardProject] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[OnboardProject] Action: ${action}`, { options });

    try {
      switch (action) {
        case "contributor":
          return await handleContributor(options.targetDir, options.depth);
        case "reviewer":
          return await handleReviewer(options.targetDir);
        default:
          return await handleOnboard(
            options.targetDir,
            options.depth,
            options.focus,
          );
      }
    } catch (error) {
      logger.error(`[OnboardProject] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Onboarding failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    targetDir: context.workspacePath || process.cwd(),
    depth: 2,
    focus: null,
  };
  let action = "onboard";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--for-contributor") {
      action = "contributor";
    } else if (p === "--for-reviewer") {
      action = "reviewer";
    } else if (p === "--depth") {
      options.depth = parseInt(parts[++i]) || 2;
    } else if (p === "--focus") {
      options.focus = parts[++i];
    } else if (p && !p.startsWith("-")) {
      const resolved = path.resolve(options.targetDir, p);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        options.targetDir = resolved;
      }
    }
  }

  return { action, options };
}

function detectProjectInfo(dir) {
  const info = {
    name: path.basename(dir),
    version: null,
    description: null,
    techStack: [],
    scripts: {},
  };

  // package.json
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      info.name = pkg.name || info.name;
      info.version = pkg.version;
      info.description = pkg.description;
      info.scripts = pkg.scripts || {};

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.electron) {
        info.techStack.push(
          `Electron ${deps.electron.replace(/[^0-9.]/g, "")}`,
        );
      }
      if (deps.vue) {
        info.techStack.push(`Vue ${deps.vue.replace(/[^0-9.]/g, "")}`);
      }
      if (deps.react) {
        info.techStack.push(`React ${deps.react.replace(/[^0-9.]/g, "")}`);
      }
      if (deps.typescript) {
        info.techStack.push("TypeScript");
      }
      if (deps.vitest) {
        info.techStack.push("Vitest");
      }
      if (deps.jest) {
        info.techStack.push("Jest");
      }
      if (deps.pinia) {
        info.techStack.push("Pinia");
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // pom.xml
  if (fs.existsSync(path.join(dir, "pom.xml"))) {
    info.techStack.push("Maven/Java");
  }
  // requirements.txt
  if (fs.existsSync(path.join(dir, "requirements.txt"))) {
    info.techStack.push("Python");
  }
  // go.mod
  if (fs.existsSync(path.join(dir, "go.mod"))) {
    info.techStack.push("Go");
  }
  // Cargo.toml
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    info.techStack.push("Rust");
  }
  // docker-compose.yml
  if (fs.existsSync(path.join(dir, "docker-compose.yml"))) {
    info.techStack.push("Docker");
  }

  return info;
}

function countFiles(dir, maxDepth = 6, depth = 0) {
  const counts = { total: 0, byExt: {} };
  if (depth > maxDepth || !fs.existsSync(dir)) {
    return counts;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return counts;
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !IGNORE_DIRS.has(entry.name) &&
      !entry.name.startsWith(".")
    ) {
      const sub = countFiles(path.join(dir, entry.name), maxDepth, depth + 1);
      counts.total += sub.total;
      for (const [ext, count] of Object.entries(sub.byExt)) {
        counts.byExt[ext] = (counts.byExt[ext] || 0) + count;
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1);
      if (CODE_EXTS.has(ext)) {
        counts.total++;
        counts.byExt[ext] = (counts.byExt[ext] || 0) + 1;
      }
    }
  }
  return counts;
}

function scanTopLevelStructure(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (e) =>
        e.isDirectory() && !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name),
    )
    .map((e) => {
      const subDir = path.join(dir, e.name);
      const subCounts = countFiles(subDir, 4);
      return { name: e.name, fileCount: subCounts.total };
    })
    .filter((d) => d.fileCount > 0)
    .sort((a, b) => b.fileCount - a.fileCount);
}

function findKeyFiles(dir) {
  const keyPatterns = [
    "index.js",
    "index.ts",
    "main.js",
    "main.ts",
    "app.js",
    "app.ts",
    "database.js",
    "database.ts",
    "router/index.ts",
    "router/index.js",
    "package.json",
    "tsconfig.json",
    ".env.example",
    "docker-compose.yml",
    "Dockerfile",
    "README.md",
  ];

  const found = [];
  for (const pattern of keyPatterns) {
    const fullPath = path.join(dir, pattern);
    if (fs.existsSync(fullPath)) {
      found.push(pattern);
    }
  }
  return found;
}

function readReadmeSnippet(dir) {
  const readmePath = path.join(dir, "README.md");
  if (!fs.existsSync(readmePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(readmePath, "utf-8");
    const lines = content.split("\n").slice(0, 20);
    return lines.join("\n");
  } catch {
    return null;
  }
}

async function handleOnboard(targetDir, depth, focus) {
  const info = detectProjectInfo(targetDir);
  const fileCounts = countFiles(targetDir);
  const structure = scanTopLevelStructure(targetDir);
  const keyFiles = findKeyFiles(targetDir);
  const readmeSnippet = readReadmeSnippet(targetDir);

  const sections = [];
  sections.push(`# Project Onboarding: ${info.name}`);
  sections.push("");
  sections.push("## Quick Summary");
  sections.push(
    `- **Name**: ${info.name}${info.version ? ` v${info.version}` : ""}`,
  );
  if (info.description) {
    sections.push(`- **Purpose**: ${info.description}`);
  }
  sections.push(`- **Tech Stack**: ${info.techStack.join(", ") || "Unknown"}`);
  sections.push(`- **Source Files**: ${fileCounts.total} files`);

  if (Object.keys(fileCounts.byExt).length > 0) {
    const extSummary = Object.entries(fileCounts.byExt)
      .sort(([, a], [, b]) => b - a)
      .map(([ext, count]) => `${ext}: ${count}`)
      .join(", ");
    sections.push(`- **By Language**: ${extSummary}`);
  }

  sections.push("");
  sections.push("## Directory Structure");
  for (const dir of structure.slice(0, 15)) {
    sections.push(`- \`${dir.name}/\` (${dir.fileCount} files)`);
  }

  sections.push("");
  sections.push("## Key Files");
  for (const f of keyFiles) {
    sections.push(`- \`${f}\``);
  }

  if (Object.keys(info.scripts).length > 0) {
    sections.push("");
    sections.push("## Available Scripts");
    const importantScripts = [
      "dev",
      "build",
      "test",
      "start",
      "lint",
      "format",
    ];
    for (const key of importantScripts) {
      if (info.scripts[key]) {
        sections.push(`- \`npm run ${key}\` → \`${info.scripts[key]}\``);
      }
    }
  }

  if (readmeSnippet) {
    sections.push("");
    sections.push("## From README");
    sections.push(readmeSnippet);
  }

  const report = sections.join("\n");

  return {
    success: true,
    result: { info, fileCounts, structure, keyFiles },
    message: report,
  };
}

async function handleContributor(targetDir, depth) {
  const info = detectProjectInfo(targetDir);
  const fileCounts = countFiles(targetDir);
  const keyFiles = findKeyFiles(targetDir);

  const sections = [];
  sections.push(`# Contributor Guide: ${info.name}`);
  sections.push("");
  sections.push("## Getting Started");
  sections.push("```bash");
  sections.push(`git clone <repo-url>`);
  sections.push(`cd ${info.name}`);

  if (
    info.scripts.install ||
    fs.existsSync(path.join(targetDir, "package.json"))
  ) {
    sections.push("npm install");
  }
  if (info.scripts.dev) {
    sections.push(`npm run dev    # ${info.scripts.dev}`);
  }
  sections.push("```");

  sections.push("");
  sections.push("## Tech Stack");
  for (const tech of info.techStack) {
    sections.push(`- ${tech}`);
  }

  sections.push("");
  sections.push("## Testing");
  const testScripts = Object.entries(info.scripts).filter(([k]) =>
    k.startsWith("test"),
  );
  if (testScripts.length > 0) {
    for (const [key, cmd] of testScripts) {
      sections.push(`- \`npm run ${key}\` → \`${cmd}\``);
    }
  } else {
    sections.push("- No test scripts found in package.json");
  }

  sections.push("");
  sections.push("## Commit Convention");
  sections.push(
    "Use semantic commits: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`",
  );
  sections.push("Example: `feat(auth): add SSO login support`");

  sections.push("");
  sections.push("## Key Entry Points");
  for (const f of keyFiles.slice(0, 10)) {
    sections.push(`- \`${f}\``);
  }

  sections.push("");
  sections.push(`## Code Stats`);
  sections.push(`- ${fileCounts.total} source files`);

  return {
    success: true,
    result: { info, fileCounts },
    message: sections.join("\n"),
  };
}

async function handleReviewer(targetDir) {
  const info = detectProjectInfo(targetDir);
  const structure = scanTopLevelStructure(targetDir);
  const fileCounts = countFiles(targetDir);

  const sections = [];
  sections.push(`# Code Review Guide: ${info.name}`);
  sections.push("");
  sections.push("## Architecture Overview");
  sections.push(`- **Stack**: ${info.techStack.join(", ")}`);
  sections.push(`- **Size**: ${fileCounts.total} source files`);

  sections.push("");
  sections.push("## High-Impact Directories");
  for (const dir of structure.slice(0, 10)) {
    sections.push(
      `- \`${dir.name}/\` (${dir.fileCount} files) - Review priority: ${dir.fileCount > 50 ? "HIGH" : dir.fileCount > 20 ? "MEDIUM" : "LOW"}`,
    );
  }

  sections.push("");
  sections.push("## Review Checklist");
  sections.push("- [ ] Security: No secrets in code, input validation present");
  sections.push("- [ ] Error handling: All async operations have try/catch");
  sections.push("- [ ] Tests: New code has corresponding tests");
  sections.push("- [ ] Performance: No N+1 queries, proper caching");
  sections.push("- [ ] Types: TypeScript types are accurate");
  sections.push("- [ ] Naming: Consistent with project conventions");

  return {
    success: true,
    result: { info, structure },
    message: sections.join("\n"),
  };
}
