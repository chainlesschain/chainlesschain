/**
 * Explain Code Skill Handler
 *
 * Parses source files to produce structured explanations: overview,
 * function inventory, dependency list, complexity notes, and a
 * line-by-line breakdown of key sections.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Language detection ─────────────────────────────────────────────

const LANG_MAP = {
  ".js": "JavaScript",
  ".mjs": "JavaScript",
  ".jsx": "React JSX",
  ".ts": "TypeScript",
  ".tsx": "React TSX",
  ".vue": "Vue SFC",
  ".py": "Python",
  ".java": "Java",
  ".go": "Go",
  ".rs": "Rust",
  ".c": "C",
  ".cpp": "C++",
  ".h": "C/C++ Header",
  ".sql": "SQL",
  ".sh": "Shell",
  ".bash": "Bash",
  ".swift": "Swift",
  ".kt": "Kotlin",
};

// ── Extraction helpers ─────────────────────────────────────────────

function extractFunctions(content, lang) {
  const fns = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    // JS/TS: function declarations, arrow exports, methods
    if ((match = line.match(/(?:async\s+)?function\s+(\w+)\s*\(/))) {
      fns.push({ name: match[1], line: i + 1, type: "function" });
    } else if (
      (match = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/))
    ) {
      fns.push({ name: match[1], line: i + 1, type: "arrow" });
    } else if (
      (match = line.match(
        /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)/,
      ))
    ) {
      if (!fns.find((f) => f.name === match[1])) {
        fns.push({ name: match[1], line: i + 1, type: "export" });
      }
    } else if (
      (match = line.match(/^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/)) &&
      lang !== "Python"
    ) {
      fns.push({ name: match[1], line: i + 1, type: "method" });
    }
    // Python: def
    if ((match = line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(/))) {
      fns.push({ name: match[1], line: i + 1, type: "def" });
    }
    // Java/Go: type + name(
    if (
      (match = line.match(
        /(?:public|private|protected|static|func)\s+\w*\s*(\w+)\s*\(/,
      ))
    ) {
      if (!fns.find((f) => f.name === match[1])) {
        fns.push({ name: match[1], line: i + 1, type: "method" });
      }
    }
    // Class declarations
    if ((match = line.match(/class\s+(\w+)/))) {
      fns.push({ name: match[1], line: i + 1, type: "class" });
    }
  }
  return fns;
}

function extractImports(content) {
  const imports = [];
  const lines = content.split("\n");
  for (const line of lines) {
    let match;
    if ((match = line.match(/(?:import|from)\s+['"]([^'"]+)['"]/))) {
      imports.push(match[1]);
    } else if ((match = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/))) {
      imports.push(match[1]);
    } else if ((match = line.match(/^import\s+(\S+)/))) {
      imports.push(match[1]);
    }
  }
  return [...new Set(imports)];
}

function analyzeComplexity(content) {
  const lines = content.split("\n");
  const notes = [];
  const lineCount = lines.length;

  // Nesting depth
  let maxDepth = 0,
    curDepth = 0;
  for (const line of lines) {
    curDepth +=
      (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (curDepth > maxDepth) {
      maxDepth = curDepth;
    }
  }
  if (maxDepth > 6) {
    notes.push(`Deep nesting detected (max depth: ${maxDepth})`);
  }

  // Async patterns
  const asyncCount = (content.match(/\bawait\b/g) || []).length;
  const promiseCount = (content.match(/new Promise|\.then\(/g) || []).length;
  if (asyncCount > 0) {
    notes.push(`Uses async/await (${asyncCount} await calls)`);
  }
  if (promiseCount > 0) {
    notes.push(`Uses Promises (${promiseCount} instances)`);
  }

  // Error handling
  const tryCount = (content.match(/\btry\s*\{/g) || []).length;
  if (tryCount > 0) {
    notes.push(`Has ${tryCount} try-catch block(s)`);
  }

  // Callback patterns
  const cbCount = (content.match(/callback|cb\s*\(/g) || []).length;
  if (cbCount > 0) {
    notes.push(`Uses callbacks (${cbCount} references)`);
  }

  return { lineCount, maxNesting: maxDepth, notes };
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[explain-code] handler initialized for "${skill?.name || "explain-code"}"`,
    );
  },

  async execute(task, context, skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    // Parse options
    const levelMatch = input.match(/--level\s+(brief|normal|detailed)/);
    const focusMatch = input.match(
      /--focus\s+(logic|performance|security|all)/,
    );
    const level = levelMatch ? levelMatch[1] : "normal";
    const focus = focusMatch ? focusMatch[1] : "all";
    const cleanInput = input.replace(/--\w+\s+\S+/g, "").trim();

    try {
      let filePath = cleanInput || null;
      let content;

      if (filePath) {
        if (!path.isAbsolute(filePath)) {
          filePath = path.resolve(projectRoot, filePath);
        }
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: `File not found: ${filePath}`,
          };
        }
        content = fs.readFileSync(filePath, "utf-8");
      } else {
        return {
          success: true,
          result: {
            message: "Please provide a file path or code snippet to explain.",
          },
          message:
            "Usage: /explain-code <file_path> [--level brief|normal|detailed] [--focus logic|performance|security|all]",
        };
      }

      const ext = path.extname(filePath).toLowerCase();
      const lang = LANG_MAP[ext] || ext.slice(1);
      const functions = extractFunctions(content, lang);
      const imports = extractImports(content);
      const complexity = analyzeComplexity(content);

      const explanation = {
        file: path.relative(projectRoot, filePath),
        language: lang,
        overview: {
          lineCount: complexity.lineCount,
          functionCount: functions.filter((f) => f.type !== "class").length,
          classCount: functions.filter((f) => f.type === "class").length,
          importCount: imports.length,
        },
        functions: functions.map((f) => ({
          name: f.name,
          line: f.line,
          type: f.type,
        })),
        imports: imports.slice(0, 20),
        complexity: {
          maxNesting: complexity.maxNesting,
          notes: complexity.notes,
        },
        level,
        focus,
      };

      // Build human-readable summary
      const fnList = functions
        .slice(0, 15)
        .map((f) => `  - ${f.name} (${f.type}, line ${f.line})`)
        .join("\n");
      const impList = imports
        .slice(0, 10)
        .map((i) => `  - ${i}`)
        .join("\n");
      const notesStr = complexity.notes.map((n) => `  - ${n}`).join("\n");

      const message = [
        `## ${path.basename(filePath)} (${lang})`,
        `**${complexity.lineCount} lines** | ${functions.length} functions/classes | ${imports.length} imports`,
        "",
        "### Key Components",
        fnList || "  (none detected)",
        "",
        "### Dependencies",
        impList || "  (none)",
        "",
        "### Complexity Notes",
        notesStr || "  No notable complexity patterns.",
      ].join("\n");

      return { success: true, result: explanation, message };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Explain code failed: ${err.message}`,
      };
    }
  },
};
