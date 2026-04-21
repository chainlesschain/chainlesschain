/**
 * @module ai-engine/code-agent/code-generator-v2
 * Phase 86: Full-stack code generation, git-aware context, review, scaffold, CI/CD
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class CodeGeneratorV2 extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._generationHistory = [];
    this._reviewHistory = [];
    this._templates = new Map();
    this._supportedLanguages = [
      "javascript",
      "typescript",
      "python",
      "java",
      "go",
      "rust",
    ];
    this._config = {
      maxGenerationLength: 10000,
      reviewDepth: "standard",
      scaffoldTemplates: ["react", "vue", "express", "fastapi", "spring-boot"],
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._llmManager = deps.llmManager || null;
    this._ensureTables();
    this.initialized = true;
    logger.info("[CodeGeneratorV2] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS code_generations (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          language TEXT,
          output TEXT,
          type TEXT DEFAULT 'generate',
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS code_reviews (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          language TEXT,
          issues TEXT,
          suggestions TEXT,
          score REAL,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[CodeGeneratorV2] Table creation warning:", error.message);
    }
  }

  // Full-stack code generation
  async generate(prompt, options = {}) {
    const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const language = options.language || "javascript";
    const type = options.type || "function";

    let code = null;
    let explanation = null;
    let llmUsed = false;

    if (this._llmManager && typeof this._llmManager.query === "function") {
      try {
        const systemPrompt = `You are a code generator. Output ONLY valid ${language} source for a ${type}, with no prose and no markdown fences.`;
        const llmResult = await this._llmManager.query(prompt, {
          systemPrompt,
          maxTokens: this._config.maxGenerationLength,
        });
        const text = (
          llmResult?.text ??
          llmResult?.message?.content ??
          ""
        ).trim();
        if (text) {
          code = text;
          explanation = `LLM-generated ${language} ${type} for: ${prompt}`;
          llmUsed = true;
        }
      } catch (error) {
        logger.warn(
          "[CodeGeneratorV2] LLM generation failed, falling back to stub:",
          error.message,
        );
      }
    }

    if (!code) {
      code = `// Generated code for: ${prompt}\n// Language: ${language}`;
      explanation = `Code generation for: ${prompt}`;
    }

    const result = {
      id,
      prompt,
      language,
      type,
      output: {
        code,
        explanation,
        tests: options.includeTests ? `// Test stub for: ${prompt}` : null,
      },
      metadata: { options, timestamp: Date.now(), llmUsed },
    };

    this._generationHistory.push(result);
    this._persistGeneration(result);
    this.emit("code:generated", { id, language, type: result.type });
    return result;
  }

  // Code review
  async review(code, options = {}) {
    const id = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const language = options.language || this._detectLanguage(code);

    const issues = [];
    const suggestions = [];

    // Basic static analysis
    if (code.includes("eval(")) {
      issues.push({
        severity: "high",
        message: "Use of eval() detected",
        line: null,
      });
    }
    if (code.includes("TODO")) {
      suggestions.push({
        type: "cleanup",
        message: "Unresolved TODO comments found",
      });
    }
    if (code.length > 500 && !code.includes("//") && !code.includes("/*")) {
      suggestions.push({
        type: "documentation",
        message: "Consider adding comments for readability",
      });
    }

    const result = {
      id,
      language,
      issues,
      suggestions,
      score:
        issues.length === 0 ? 0.95 : Math.max(0.3, 0.95 - issues.length * 0.15),
      summary: `Found ${issues.length} issues and ${suggestions.length} suggestions`,
    };

    this._reviewHistory.push(result);
    this._persistReview(result, code);
    this.emit("code:reviewed", {
      id,
      score: result.score,
      issues: issues.length,
    });
    return result;
  }

  // Auto-fix issues
  async fix(code, issues, options = {}) {
    const id = `fix-${Date.now()}`;
    return {
      id,
      original: code,
      fixed: code, // In production, LLM would fix
      changes: [],
      fixedCount: 0,
    };
  }

  // Project scaffold
  async scaffold(template, options = {}) {
    const id = `scaffold-${Date.now()}`;
    if (!this._config.scaffoldTemplates.includes(template)) {
      throw new Error(
        `Unknown template: ${template}. Available: ${this._config.scaffoldTemplates.join(", ")}`,
      );
    }

    const files = this._generateScaffold(template, options);
    this.emit("code:scaffolded", {
      id,
      template,
      fileCount: files.length,
    });
    return { id, template, files, projectName: options.name || "new-project" };
  }

  _generateScaffold(template, options) {
    const name = options.name || "new-project";
    const scaffolds = {
      react: [
        {
          path: "package.json",
          content: `{"name":"${name}","version":"1.0.0"}`,
        },
        { path: "src/index.tsx", content: "// React entry point" },
        { path: "src/App.tsx", content: "// Main App component" },
      ],
      vue: [
        {
          path: "package.json",
          content: `{"name":"${name}","version":"1.0.0"}`,
        },
        { path: "src/main.ts", content: "// Vue entry point" },
        { path: "src/App.vue", content: "// Main App component" },
      ],
      express: [
        {
          path: "package.json",
          content: `{"name":"${name}","version":"1.0.0"}`,
        },
        { path: "src/index.js", content: "// Express server" },
        { path: "src/routes/index.js", content: "// Routes" },
      ],
      fastapi: [
        { path: "requirements.txt", content: "fastapi\nuvicorn" },
        { path: "main.py", content: "# FastAPI app" },
        { path: "routers/__init__.py", content: "" },
      ],
      "spring-boot": [
        { path: "pom.xml", content: "<!-- Spring Boot POM -->" },
        {
          path: "src/main/java/Application.java",
          content: "// Spring Boot Application",
        },
      ],
    };
    return scaffolds[template] || [];
  }

  // CI/CD configuration
  async configureCICD(projectType, options = {}) {
    const id = `cicd-${Date.now()}`;
    const configs = {
      "github-actions": {
        file: ".github/workflows/ci.yml",
        content: `name: CI\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: Build\n        run: npm ci && npm run build\n      - name: Test\n        run: npm test`,
      },
      "gitlab-ci": {
        file: ".gitlab-ci.yml",
        content: `stages:\n  - build\n  - test\nbuild:\n  stage: build\n  script: npm ci && npm run build\ntest:\n  stage: test\n  script: npm test`,
      },
    };

    const platform = options.platform || "github-actions";
    const config = configs[platform] || configs["github-actions"];
    this.emit("code:cicd-configured", { id, platform });
    return { id, platform, ...config };
  }

  // Git context analysis
  async analyzeGit(repoPath, options = {}) {
    return {
      repoPath,
      branches: [],
      recentCommits: [],
      modifiedFiles: [],
      analysis: "Git analysis requires isomorphic-git integration",
    };
  }

  // Code explanation
  async explain(code, options = {}) {
    const id = `explain-${Date.now()}`;
    const language = options.language || this._detectLanguage(code);
    return {
      id,
      language,
      explanation: `Code explanation for ${language} code (${code.length} chars)`,
      complexity:
        code.split("\n").length > 50
          ? "high"
          : code.split("\n").length > 20
            ? "medium"
            : "low",
    };
  }

  // Refactoring
  async refactor(code, options = {}) {
    const id = `refactor-${Date.now()}`;
    return {
      id,
      original: code,
      refactored: code,
      changes: [],
      strategy: options.strategy || "clean-code",
    };
  }

  _detectLanguage(code) {
    if (code.includes("import React") || code.includes("jsx")) {
      return "javascript";
    }
    if (code.includes("def ") || code.includes("import ")) {
      return "python";
    }
    if (code.includes("func ") || code.includes("package main")) {
      return "go";
    }
    if (code.includes("fn ") || code.includes("let mut")) {
      return "rust";
    }
    if (code.includes("public class") || code.includes("System.out")) {
      return "java";
    }
    return "javascript";
  }

  _persistGeneration(gen) {
    try {
      this.db
        .prepare(
          "INSERT INTO code_generations (id, prompt, language, output, type, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          gen.id,
          gen.prompt,
          gen.language,
          JSON.stringify(gen.output),
          gen.type,
          JSON.stringify(gen.metadata),
        );
    } catch (error) {
      logger.error(
        "[CodeGeneratorV2] Persist generation failed:",
        error.message,
      );
    }
  }

  _persistReview(review, code) {
    try {
      this.db
        .prepare(
          "INSERT INTO code_reviews (id, code, language, issues, suggestions, score) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          review.id,
          code,
          review.language,
          JSON.stringify(review.issues),
          JSON.stringify(review.suggestions),
          review.score,
        );
    } catch (error) {
      logger.error("[CodeGeneratorV2] Persist review failed:", error.message);
    }
  }
}

let instance = null;
function getCodeGeneratorV2() {
  if (!instance) {
    instance = new CodeGeneratorV2();
  }
  return instance;
}

module.exports = { CodeGeneratorV2, getCodeGeneratorV2 };
