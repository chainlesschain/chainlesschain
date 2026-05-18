/**
 * Test Generator Skill Handler
 *
 * Analyzes source files and generates unit test stubs with
 * describe/it structure, mock setup, and edge case coverage.
 * Supports Vitest, Jest, Pytest, and JUnit auto-detection.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Framework detection ────────────────────────────────────────────

function detectFramework(projectRoot) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
    );
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps.vitest) {
      return "vitest";
    }
    if (allDeps.jest) {
      return "jest";
    }
  } catch {
    /* ignore */
  }

  if (
    fs.existsSync(path.join(projectRoot, "pytest.ini")) ||
    fs.existsSync(path.join(projectRoot, "setup.py"))
  ) {
    return "pytest";
  }
  if (
    fs.existsSync(path.join(projectRoot, "pom.xml")) ||
    fs.existsSync(path.join(projectRoot, "build.gradle"))
  ) {
    return "junit";
  }
  return "vitest";
}

// ── Source analysis ────────────────────────────────────────────────

function analyzeSource(content, lang) {
  const functions = [];
  const classes = [];
  const imports = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;

    // Functions
    if (
      (match = line.match(
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
      ))
    ) {
      functions.push({
        name: match[1],
        params: match[2].trim(),
        line: i + 1,
        async: /async/.test(line),
        exported: /export/.test(line),
      });
    } else if (
      (match = line.match(
        /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
      ))
    ) {
      functions.push({
        name: match[1],
        params: match[2].trim(),
        line: i + 1,
        async: /async/.test(line),
        exported: /export/.test(line),
      });
    } else if (
      (match = line.match(/^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/)) &&
      lang !== "python"
    ) {
      functions.push({
        name: match[1],
        params: match[2].trim(),
        line: i + 1,
        async: /async/.test(line),
        method: true,
      });
    }

    // Python defs
    if ((match = line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/))) {
      functions.push({
        name: match[1],
        params: match[2].trim(),
        line: i + 1,
        async: /async/.test(line),
      });
    }

    // Classes
    if ((match = line.match(/class\s+(\w+)/))) {
      classes.push({ name: match[1], line: i + 1 });
    }

    // Imports
    if ((match = line.match(/(?:import|from)\s+['"]([^'"]+)['"]/))) {
      imports.push(match[1]);
    } else if ((match = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/))) {
      imports.push(match[1]);
    }
  }

  return { functions, classes, imports: [...new Set(imports)] };
}

// ── Test generation ────────────────────────────────────────────────

function generateVitestSuite(filePath, analysis, projectRoot) {
  const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  const moduleName = path.basename(filePath, path.extname(filePath));
  const lines = [];

  lines.push(`import { describe, it, expect, beforeEach, vi } from "vitest";`);
  lines.push("");

  // Mock external imports
  const externalImports = analysis.imports.filter(
    (i) => !i.startsWith(".") && !i.startsWith("/"),
  );
  for (const imp of externalImports.slice(0, 5)) {
    lines.push(`// vi.mock("${imp}");`);
  }
  if (externalImports.length > 0) {
    lines.push("");
  }

  // Import module under test
  const importPath = relPath.startsWith("src/")
    ? `../../../${relPath}`
    : relPath;
  lines.push(`// import { ... } from "${importPath}";`);
  lines.push("");

  // Generate describe/it blocks
  if (analysis.classes.length > 0) {
    for (const cls of analysis.classes) {
      lines.push(`describe("${cls.name}", () => {`);
      lines.push(`  let instance;`);
      lines.push("");
      lines.push(`  beforeEach(() => {`);
      lines.push(`    instance = new ${cls.name}();`);
      lines.push(`  });`);
      lines.push("");

      const methods = analysis.functions.filter((f) => f.method);
      for (const fn of methods) {
        lines.push(`  describe("${fn.name}", () => {`);
        lines.push(
          `    it("should work with valid input", ${fn.async ? "async " : ""}() => {`,
        );
        lines.push(`      // TODO: arrange, act, assert`);
        lines.push(
          `      ${fn.async ? "await " : ""}instance.${fn.name}(${fn.params ? "/* " + fn.params + " */" : ""});`,
        );
        lines.push(`    });`);
        lines.push("");
        lines.push(`    it("should handle edge cases", () => {`);
        lines.push(`      // TODO: null/undefined/empty inputs`);
        lines.push(`    });`);
        lines.push(`  });`);
        lines.push("");
      }
      lines.push(`});`);
    }
  }

  const topLevelFns = analysis.functions.filter((f) => !f.method);
  if (topLevelFns.length > 0) {
    lines.push(`describe("${moduleName}", () => {`);
    for (const fn of topLevelFns) {
      lines.push(`  describe("${fn.name}", () => {`);
      lines.push(
        `    it("should return expected result for valid input", ${fn.async ? "async " : ""}() => {`,
      );
      lines.push(
        `      // TODO: const result = ${fn.async ? "await " : ""}${fn.name}(${fn.params ? "/* " + fn.params + " */" : ""});`,
      );
      lines.push(`      // expect(result).toBeDefined();`);
      lines.push(`    });`);
      lines.push("");
      lines.push(`    it("should handle empty/null input", () => {`);
      lines.push(`      // TODO: test edge cases`);
      lines.push(`    });`);

      if (fn.async) {
        lines.push("");
        lines.push(`    it("should handle rejection/error", async () => {`);
        lines.push(`      // TODO: test error paths`);
        lines.push(`    });`);
      }
      lines.push(`  });`);
      lines.push("");
    }
    lines.push(`});`);
  }

  return lines.join("\n");
}

function generatePytestSuite(filePath, analysis, projectRoot) {
  const moduleName = path.basename(filePath, path.extname(filePath));
  const lines = [];

  lines.push(`import pytest`);
  lines.push(`# from ${moduleName} import ...`);
  lines.push("");

  for (const fn of analysis.functions) {
    if (fn.name.startsWith("_")) {
      continue;
    } // skip private
    lines.push(
      `class Test${fn.name.charAt(0).toUpperCase() + fn.name.slice(1)}:`,
    );
    lines.push(`    def test_valid_input(self):`);
    lines.push(`        # result = ${fn.name}(${fn.params || ""})`);
    lines.push(`        # assert result is not None`);
    lines.push(`        pass`);
    lines.push("");
    lines.push(`    def test_edge_cases(self):`);
    lines.push(`        # Test with empty, None, boundary values`);
    lines.push(`        pass`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[test-generator] handler initialized for "${skill?.name || "test-generator"}"`,
    );
  },

  async execute(task, context, skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    const fwMatch = input.match(/--framework\s+(\S+)/);
    const coverageMode = /--coverage/.test(input);
    const cleanInput = input
      .replace(/--\w+\s+\S+/g, "")
      .replace(/--coverage/g, "")
      .trim();

    if (!cleanInput) {
      return {
        success: true,
        result: { message: "Please provide a source file path." },
        message:
          "Usage: /test-generator <source_file> [--framework vitest|jest|pytest|junit] [--coverage]",
      };
    }

    try {
      let filePath = cleanInput;
      if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(projectRoot, filePath);
      }
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found",
          message: `Source file not found: ${filePath}`,
        };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const ext = path.extname(filePath).toLowerCase();
      const lang = [".py"].includes(ext)
        ? "python"
        : [".java", ".kt"].includes(ext)
          ? "java"
          : "javascript";
      const framework = fwMatch ? fwMatch[1] : detectFramework(projectRoot);

      const analysis = analyzeSource(content, lang);

      let testCode;
      if (framework === "pytest") {
        testCode = generatePytestSuite(filePath, analysis, projectRoot);
      } else {
        testCode = generateVitestSuite(filePath, analysis, projectRoot);
      }

      // Suggest test file path
      const srcDir = path.dirname(filePath);
      const baseName = path.basename(filePath, path.extname(filePath));
      const testExt = lang === "python" ? ".py" : path.extname(filePath);
      const testFileName =
        lang === "python"
          ? `test_${baseName}${testExt}`
          : `${baseName}.test${testExt}`;
      const suggestedPath = path.join(srcDir, "__tests__", testFileName);

      const result = {
        sourceFile: path.relative(projectRoot, filePath),
        framework,
        functionsFound: analysis.functions.length,
        classesFound: analysis.classes.length,
        externalDependencies: analysis.imports.length,
        testCasesGenerated:
          analysis.functions.length * 2 + analysis.classes.length,
        suggestedTestPath: path.relative(projectRoot, suggestedPath),
        testCode,
        coverageMode,
      };

      const message = [
        `## Test Generation: ${path.basename(filePath)}`,
        `Framework: **${framework}** | ${analysis.functions.length} functions, ${analysis.classes.length} classes`,
        `Generated **${result.testCasesGenerated} test cases** → \`${result.suggestedTestPath}\``,
        "",
        "```" + (lang === "python" ? "python" : "javascript"),
        testCode.slice(0, 2000),
        "```",
      ].join("\n");

      return { success: true, result, message };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Test generation failed: ${err.message}`,
      };
    }
  },
};
