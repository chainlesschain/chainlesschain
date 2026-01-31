#!/usr/bin/env node
/**
 * Cowork Documentation Generator
 *
 * Automated documentation generation system using Cowork multi-agent collaboration
 * - API documentation from source code
 * - User guides from features
 * - Architecture documentation from codebase analysis
 * - Release notes from git history
 *
 * Usage: node scripts/cowork-doc-generator.js [options]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const glob = require("glob");

console.log("📚 Cowork Documentation Generator\n");
console.log("=".repeat(60));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const docType = args.includes("--type")
  ? args[args.indexOf("--type") + 1]
  : "all";
const outputDir = args.includes("--output")
  ? args[args.indexOf("--output") + 1]
  : "docs/generated";

/**
 * Documentation generation configuration
 */
const docConfig = {
  api: {
    enabled: true,
    sourcePatterns: [
      "src/main/**/*.js",
      "src/renderer/stores/**/*.js",
      "src/renderer/utils/**/*.js",
    ],
    outputPath: "docs/api/generated",
    template: "api-doc-template.md",
  },
  userGuide: {
    enabled: true,
    sourcePatterns: ["src/renderer/pages/**/*.vue", "src/renderer/components/**/*.vue"],
    outputPath: "docs/user-guide",
    template: "user-guide-template.md",
  },
  architecture: {
    enabled: true,
    sourcePatterns: ["src/main/**/*.js", "src/renderer/**/*.js"],
    outputPath: "docs/architecture",
    template: "architecture-template.md",
  },
  releaseNotes: {
    enabled: true,
    gitRange: "HEAD~10..HEAD", // Last 10 commits
    outputPath: "docs/releases",
    template: "release-notes-template.md",
  },
  changelog: {
    enabled: true,
    gitRange: "v0.26.0..HEAD",
    outputPath: "CHANGELOG.md",
    groupByType: true, // Group by feat/fix/docs/etc
  },
};

/**
 * Get files matching pattern using glob
 */
function getSourceFiles(patterns) {
  const allFiles = [];

  patterns.forEach((pattern) => {
    try {
      // Use glob.sync for reliable pattern matching
      const found = glob.sync(pattern, {
        cwd: process.cwd(),
        absolute: true,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.cache/**'
        ]
      });

      allFiles.push(...found);
    } catch (error) {
      console.error(`   ❌ Error processing pattern ${pattern}:`, error.message);
    }
  });

  // Remove duplicates
  return [...new Set(allFiles)];
}

/**
 * Recursively find files matching pattern
 */
function findFilesRecursive(dir, pattern) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules, .git, etc
      if (!item.startsWith(".") && item !== "node_modules") {
        files.push(...findFilesRecursive(fullPath, pattern));
      }
    } else {
      // Simple pattern matching
      const regex = new RegExp(
        pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")
      );
      if (regex.test(item)) {
        files.push(fullPath);
      }
    }
  });

  return files;
}

/**
 * Extract JSDoc comments from source file
 */
function extractJSDoc(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const jsdocPattern = /\/\*\*([\s\S]*?)\*\//g;
    const matches = [];
    let match;

    while ((match = jsdocPattern.exec(content)) !== null) {
      const comment = match[1];
      const startPos = match.index + match[0].length;

      // Get the next line after JSDoc (likely function/class declaration)
      const nextLineMatch = content.slice(startPos).match(/\n\s*(\w+.*?)(?:\{|\n)/);
      const declaration = nextLineMatch ? nextLineMatch[1].trim() : "";

      matches.push({
        comment: comment.trim(),
        declaration,
        file: path.relative(process.cwd(), filePath),
      });
    }

    return matches;
  } catch (error) {
    console.error(`   ❌ Error reading ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Extract Vue component documentation
 */
function extractVueDoc(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // Extract component name
    const nameMatch = content.match(/<template[^>]*>\s*<!--\s*@component\s+(\w+)/);
    const componentName =
      nameMatch?.[1] ||
      path.basename(filePath, ".vue");

    // Extract props
    const propsMatch = content.match(/props:\s*\{([\s\S]*?)\}/);
    const props = propsMatch
      ? extractPropsFromString(propsMatch[1])
      : [];

    // Extract emits
    const emitsMatch = content.match(/emits:\s*\[([\s\S]*?)\]/);
    const emits = emitsMatch
      ? emitsMatch[1]
          .split(",")
          .map((e) => e.trim().replace(/['"]/g, ""))
          .filter(Boolean)
      : [];

    // Extract description from template comment
    const descMatch = content.match(/<!--\s*([\s\S]*?)\s*-->/);
    const description = descMatch ? descMatch[1].trim() : "";

    return {
      name: componentName,
      file: path.relative(process.cwd(), filePath),
      description,
      props,
      emits,
    };
  } catch (error) {
    console.error(`   ❌ Error reading Vue file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Extract props from props object string
 */
function extractPropsFromString(propsStr) {
  const props = [];
  const propPattern = /(\w+):\s*\{([^}]*)\}/g;
  let match;

  while ((match = propPattern.exec(propsStr)) !== null) {
    const propName = match[1];
    const propDef = match[2];

    const typeMatch = propDef.match(/type:\s*(\w+)/);
    const requiredMatch = propDef.match(/required:\s*(true|false)/);
    const defaultMatch = propDef.match(/default:\s*([^,\n]+)/);

    props.push({
      name: propName,
      type: typeMatch?.[1] || "Unknown",
      required: requiredMatch?.[1] === "true",
      default: defaultMatch?.[1]?.trim(),
    });
  }

  return props;
}

/**
 * Get git commits for changelog
 */
function getGitCommits(range) {
  try {
    const command = `git log ${range} --pretty=format:"%H|%an|%ad|%s" --date=short`;
    const output = execSync(command, { encoding: "utf-8", cwd: process.cwd() });

    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, message] = line.split("|");
        return { hash, author, date, message };
      });
  } catch (error) {
    console.error("   ❌ Error getting git commits:", error.message);
    return [];
  }
}

/**
 * Group commits by type (feat, fix, docs, etc)
 */
function groupCommitsByType(commits) {
  const groups = {
    feat: [],
    fix: [],
    docs: [],
    style: [],
    refactor: [],
    perf: [],
    test: [],
    chore: [],
    other: [],
  };

  commits.forEach((commit) => {
    const typeMatch = commit.message.match(/^(\w+)(?:\([^)]+\))?:/);
    const type = typeMatch?.[1] || "other";

    if (groups[type]) {
      groups[type].push(commit);
    } else {
      groups.other.push(commit);
    }
  });

  return groups;
}

/**
 * Generate API documentation
 */
function generateAPIDocs() {
  console.log("\n📖 Generating API Documentation...");

  const files = getSourceFiles(docConfig.api.sourcePatterns);
  console.log(`   Found ${files.length} source files`);

  const allDocs = [];

  files.forEach((file) => {
    const docs = extractJSDoc(file);
    allDocs.push(...docs);
  });

  console.log(`   Extracted ${allDocs.length} API documentation entries`);

  // Group by file
  const docsByFile = {};
  allDocs.forEach((doc) => {
    if (!docsByFile[doc.file]) {
      docsByFile[doc.file] = [];
    }
    docsByFile[doc.file].push(doc);
  });

  // Generate markdown
  const outputPath = path.join(process.cwd(), docConfig.api.outputPath);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  let totalFiles = 0;

  Object.entries(docsByFile).forEach(([file, docs]) => {
    const fileName = path.basename(file, path.extname(file));
    const outputFile = path.join(outputPath, `${fileName}.md`);

    let content = `# ${fileName}\n\n`;
    content += `**Source**: \`${file}\`\n\n`;
    content += `**Generated**: ${new Date().toISOString()}\n\n`;
    content += `---\n\n`;

    docs.forEach((doc) => {
      content += `## ${doc.declaration}\n\n`;
      content += `\`\`\`javascript\n${doc.declaration}\n\`\`\`\n\n`;
      content += `${doc.comment}\n\n`;
      content += `---\n\n`;
    });

    if (!dryRun) {
      fs.writeFileSync(outputFile, content, "utf-8");
    }

    totalFiles++;
    console.log(`   ✅ Generated: ${path.relative(process.cwd(), outputFile)}`);
  });

  console.log(`\n   📊 Summary: ${totalFiles} API documentation files generated`);
}

/**
 * Generate User Guide documentation
 */
function generateUserGuide() {
  console.log("\n📘 Generating User Guide...");

  const files = getSourceFiles(docConfig.userGuide.sourcePatterns);
  console.log(`   Found ${files.length} Vue components`);

  const components = [];

  files.forEach((file) => {
    const doc = extractVueDoc(file);
    if (doc) {
      components.push(doc);
    }
  });

  console.log(`   Extracted ${components.length} component documentation entries`);

  // Generate component reference
  const outputPath = path.join(process.cwd(), docConfig.userGuide.outputPath);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  const outputFile = path.join(outputPath, "COMPONENT_REFERENCE.md");

  let content = `# Component Reference\n\n`;
  content += `**Generated**: ${new Date().toISOString()}\n\n`;
  content += `**Total Components**: ${components.length}\n\n`;
  content += `---\n\n`;

  // Group by directory
  const componentsByDir = {};
  components.forEach((comp) => {
    const dir = path.dirname(comp.file);
    if (!componentsByDir[dir]) {
      componentsByDir[dir] = [];
    }
    componentsByDir[dir].push(comp);
  });

  Object.entries(componentsByDir).forEach(([dir, comps]) => {
    content += `## ${dir}\n\n`;

    comps.forEach((comp) => {
      content += `### ${comp.name}\n\n`;
      content += `**File**: \`${comp.file}\`\n\n`;

      if (comp.description) {
        content += `**Description**: ${comp.description}\n\n`;
      }

      if (comp.props.length > 0) {
        content += `**Props**:\n\n`;
        content += `| Name | Type | Required | Default |\n`;
        content += `|------|------|----------|----------|\n`;
        comp.props.forEach((prop) => {
          content += `| ${prop.name} | ${prop.type} | ${prop.required ? "✅" : "❌"} | ${prop.default || "-"} |\n`;
        });
        content += `\n`;
      }

      if (comp.emits.length > 0) {
        content += `**Emits**: ${comp.emits.join(", ")}\n\n`;
      }

      content += `---\n\n`;
    });
  });

  if (!dryRun) {
    fs.writeFileSync(outputFile, content, "utf-8");
  }

  console.log(`   ✅ Generated: ${path.relative(process.cwd(), outputFile)}`);
}

/**
 * Generate Changelog
 */
function generateChangelog() {
  console.log("\n📝 Generating Changelog...");

  const commits = getGitCommits(docConfig.changelog.gitRange);
  console.log(`   Found ${commits.length} commits`);

  if (commits.length === 0) {
    console.log("   ⚠️  No commits found in range");
    return;
  }

  const grouped = groupCommitsByType(commits);

  const outputPath = path.join(process.cwd(), docConfig.changelog.outputPath);

  let content = `# Changelog\n\n`;
  content += `**Generated**: ${new Date().toISOString()}\n\n`;
  content += `**Range**: ${docConfig.changelog.gitRange}\n\n`;
  content += `---\n\n`;

  const typeLabels = {
    feat: "✨ Features",
    fix: "🐛 Bug Fixes",
    docs: "📚 Documentation",
    style: "💄 Styles",
    refactor: "♻️ Refactoring",
    perf: "⚡ Performance",
    test: "✅ Tests",
    chore: "🔧 Chores",
    other: "📦 Other",
  };

  Object.entries(grouped).forEach(([type, commits]) => {
    if (commits.length === 0) return;

    content += `## ${typeLabels[type] || type}\n\n`;

    commits.forEach((commit) => {
      const shortHash = commit.hash.slice(0, 7);
      content += `- ${commit.message} (\`${shortHash}\`) - ${commit.date}\n`;
    });

    content += `\n`;
  });

  if (!dryRun) {
    fs.writeFileSync(outputPath, content, "utf-8");
  }

  console.log(`   ✅ Generated: ${path.relative(process.cwd(), outputPath)}`);
}

/**
 * Generate Architecture documentation
 */
function generateArchitectureDocs() {
  console.log("\n🏗️ Generating Architecture Documentation...");

  const files = getSourceFiles(docConfig.architecture.sourcePatterns);
  console.log(`   Found ${files.length} source files`);

  // Analyze module structure
  const modules = {
    main: { files: [], size: 0 },
    renderer: { files: [], size: 0 },
    shared: { files: [], size: 0 },
  };

  files.forEach((file) => {
    const stats = fs.statSync(file);
    const size = stats.size;

    // Normalize path for comparison (handle both forward and back slashes)
    const normalizedFile = file.replace(/\\/g, "/");

    if (normalizedFile.includes("src/main")) {
      modules.main.files.push({ file, size });
      modules.main.size += size;
    } else if (normalizedFile.includes("src/renderer")) {
      modules.renderer.files.push({ file, size });
      modules.renderer.size += size;
    } else {
      modules.shared.files.push({ file, size });
      modules.shared.size += size;
    }
  });

  // Generate architecture overview
  const outputPath = path.join(process.cwd(), docConfig.architecture.outputPath);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  const outputFile = path.join(outputPath, "ARCHITECTURE_OVERVIEW.md");

  let content = `# Architecture Overview\n\n`;
  content += `**Generated**: ${new Date().toISOString()}\n\n`;
  content += `---\n\n`;

  content += `## Module Summary\n\n`;
  content += `| Module | Files | Total Size |\n`;
  content += `|--------|-------|------------|\n`;

  Object.entries(modules).forEach(([name, data]) => {
    const sizeMB = (data.size / 1024 / 1024).toFixed(2);
    content += `| ${name} | ${data.files.length} | ${sizeMB} MB |\n`;
  });

  content += `\n`;

  Object.entries(modules).forEach(([name, data]) => {
    content += `## ${name} Module\n\n`;
    content += `**Files**: ${data.files.length}\n\n`;

    // Sort by size descending
    const sorted = data.files.sort((a, b) => b.size - a.size).slice(0, 10);

    content += `**Top 10 Largest Files**:\n\n`;
    sorted.forEach((item, idx) => {
      const sizeKB = (item.size / 1024).toFixed(1);
      const relPath = path.relative(process.cwd(), item.file);
      content += `${idx + 1}. \`${relPath}\` - ${sizeKB} KB\n`;
    });

    content += `\n`;
  });

  if (!dryRun) {
    fs.writeFileSync(outputFile, content, "utf-8");
  }

  console.log(`   ✅ Generated: ${path.relative(process.cwd(), outputFile)}`);
}

/**
 * Generate all documentation
 */
function generateAll() {
  console.log("\n📚 Generating all documentation types...\n");

  if (docConfig.api.enabled) {
    generateAPIDocs();
  }

  if (docConfig.userGuide.enabled) {
    generateUserGuide();
  }

  if (docConfig.changelog.enabled) {
    generateChangelog();
  }

  if (docConfig.architecture.enabled) {
    generateArchitectureDocs();
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log(`\n🎯 Documentation Type: ${docType}`);
    console.log(`📂 Output Directory: ${outputDir}`);
    console.log(`🔧 Dry Run: ${dryRun ? "Yes" : "No"}\n`);
    console.log("=".repeat(60));

    switch (docType) {
      case "api":
        generateAPIDocs();
        break;
      case "user-guide":
        generateUserGuide();
        break;
      case "changelog":
        generateChangelog();
        break;
      case "architecture":
        generateArchitectureDocs();
        break;
      case "all":
        generateAll();
        break;
      default:
        console.error(`❌ Unknown documentation type: ${docType}`);
        console.log("\nAvailable types: api, user-guide, changelog, architecture, all");
        process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Documentation generation complete!\n");

    if (dryRun) {
      console.log("💡 This was a dry run. No files were written.");
      console.log("   Run without --dry-run to generate files.\n");
    }

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Documentation generation failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  generateAPIDocs,
  generateUserGuide,
  generateChangelog,
  generateArchitectureDocs,
  extractJSDoc,
  extractVueDoc,
  getGitCommits,
  groupCommitsByType,
};
