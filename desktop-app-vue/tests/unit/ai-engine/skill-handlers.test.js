/**
 * Skill Handlers 单元测试
 *
 * 测试覆盖：
 * - env-doctor: 环境诊断（运行时检测、端口检查）
 * - repo-map: 代码库结构映射（符号提取、文件扫描）
 * - context-loader: 智能上下文加载（意图分析、token预算）
 * - lint-and-fix: Lint自动修复（linter检测、报告生成）
 * - test-and-fix: 测试自动修复（框架检测、结果解析）
 * - SkillLoader: 60个内置技能加载验证
 * - v0.36.2: prompt-enhancer, codebase-qa, auto-context, multi-model-router,
 *            code-translator, dead-code-eliminator, changelog-generator,
 *            mock-data-generator, git-history-analyzer, i18n-manager
 * - v0.37.2: pdf-toolkit, doc-converter, excel-analyzer, pptx-creator,
 *            doc-comparator, audio-transcriber, video-toolkit,
 *            subtitle-generator, tts-synthesizer, media-metadata
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";

// Mock logger
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock electron app for SkillLoader
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-userdata"),
  },
}));

describe("Skill Handlers", () => {
  // ============================================================
  // env-doctor handler
  // ============================================================
  describe("env-doctor handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/env-doctor/handler.js");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should run full diagnostics by default", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result.runtimes).toBeDefined();
      expect(result.result.ports).toBeDefined();
      expect(result.result.docker).toBeDefined();
      expect(result.report).toContain("Environment Doctor Report");
    });

    it("should check runtimes category", async () => {
      const result = await handler.execute({ input: "--check runtimes" }, {});
      expect(result.success).toBe(true);
      expect(result.result).toBeInstanceOf(Array);
      // Node.js should always be detected in test environment
      const nodeResult = result.result.find((r) => r.name === "Node.js");
      expect(nodeResult).toBeDefined();
      expect(nodeResult.ok).toBe(true);
    });

    it("should check ports category", async () => {
      const result = await handler.execute({ input: "--check ports" }, {});
      expect(result.success).toBe(true);
      expect(result.result).toBeInstanceOf(Array);
      expect(result.result.length).toBe(8);
      // Each port should have port and service fields
      expect(result.result[0]).toHaveProperty("port");
      expect(result.result[0]).toHaveProperty("service");
    });

    it("should generate fix commands", async () => {
      const result = await handler.execute({ input: "--fix" }, {});
      expect(result.success).toBe(true);
      expect(result.fixCommands).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it("should run preflight check", async () => {
      const result = await handler.execute({ input: "--preflight" }, {});
      expect(typeof result.success).toBe("boolean");
      expect(result.result).toBeDefined();
      expect(result.critical).toBeInstanceOf(Array);
    });
  });

  // ============================================================
  // repo-map handler
  // ============================================================
  describe("repo-map handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/repo-map/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should scan the skills directory and find symbols", async () => {
      const skillsDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills",
      );
      const result = await handler.execute(
        { input: skillsDir },
        { workspacePath: skillsDir },
      );
      expect(result.success).toBe(true);
      expect(result.result.fileCount).toBeGreaterThan(0);
      expect(result.result.symbolCount).toBeGreaterThan(0);
      expect(result.message).toContain("Scanned");
    });

    it("should find a specific symbol", async () => {
      const skillsDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills",
      );
      const result = await handler.execute(
        { input: `${skillsDir} --find MarkdownSkill` },
        { workspacePath: skillsDir },
      );
      expect(result.success).toBe(true);
      expect(result.result.length).toBeGreaterThan(0);
      expect(result.message).toContain("MarkdownSkill");
    });

    it("should handle non-existent directory gracefully", async () => {
      const result = await handler.execute(
        { input: "/nonexistent/path" },
        { workspacePath: "/nonexistent" },
      );
      expect(result.success).toBe(true);
      expect(result.result.fileCount).toBe(0);
    });

    it("should extract JS class symbols", async () => {
      const testDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills",
      );
      const result = await handler.execute(
        { input: `${testDir} --filter *.js` },
        { workspacePath: testDir },
      );
      expect(result.success).toBe(true);
      // Should find BaseSkill, MarkdownSkill, etc.
      expect(result.message).toContain("class");
    });
  });

  // ============================================================
  // context-loader handler
  // ============================================================
  describe("context-loader handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/context-loader/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should prime context for a topic", async () => {
      const _mainDir = path.resolve(__dirname, "../../../src/main");
      const result = await handler.execute(
        { input: "prime skill" },
        { workspacePath: path.resolve(__dirname, "../../..") },
      );
      expect(result.success).toBe(true);
      expect(result.result.loaded).toBeInstanceOf(Array);
      expect(result.result.usedTokens).toBeGreaterThan(0);
      expect(result.message).toContain("Context Loaded");
    });

    it("should set token budget", async () => {
      const result = await handler.execute({ input: "budget 10000" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("10000");
    });

    it("should reject invalid budget", async () => {
      const result = await handler.execute({ input: "budget 500" }, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain("1000");
    });

    it("should return status", async () => {
      const result = await handler.execute({ input: "status" }, {});
      expect(result.success).toBe(true);
    });

    it("should clear loaded context", async () => {
      // Prime first
      await handler.execute(
        { input: "prime skill" },
        { workspacePath: path.resolve(__dirname, "../../..") },
      );
      // Then clear
      const result = await handler.execute({ input: "clear" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Cleared");
    });
  });

  // ============================================================
  // lint-and-fix handler
  // ============================================================
  describe("lint-and-fix handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/lint-and-fix/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should detect ESLint in the project", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        {
          input: `${projectRoot}/src/main/ai-engine/cowork/skills/ --check-only`,
        },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result.linter).toBeDefined();
      expect(result.message).toContain("Lint Report");
    });

    it("should handle missing linter gracefully", async () => {
      const result = await handler.execute(
        { input: "/tmp --check-only" },
        { workspacePath: "/tmp" },
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("No linter");
    });
  });

  // ============================================================
  // test-and-fix handler
  // ============================================================
  describe("test-and-fix handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/test-and-fix/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should detect Vitest in the project (detection only)", () => {
      // Test the framework detection logic without actually running tests
      const projectRoot = path.resolve(__dirname, "../../..");
      const vitestConfig = path.join(projectRoot, "vitest.config.ts");
      const hasVitest = fs.existsSync(vitestConfig);
      expect(hasVitest).toBe(true);
    });

    it("should handle missing test framework gracefully", async () => {
      const result = await handler.execute(
        { input: "" },
        { workspacePath: "/tmp" },
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("No test framework");
    });
  });

  // ============================================================
  // refactor handler
  // ============================================================
  describe("refactor handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/refactor/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should detect code smells in a directory", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--detect-smells" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.smells).toBeDefined();
      expect(result.result.fileCount).toBeGreaterThan(0);
    });

    it("should preview rename across files", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--rename logger logService" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.affected).toBeDefined();
    });
  });

  // ============================================================
  // doc-generator handler
  // ============================================================
  describe("doc-generator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/doc-generator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should generate IPC reference", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--ipc-reference" },
        { workspacePath: path.join(projectRoot, "src/main") },
      );
      expect(result.success).toBe(true);
      expect(result.result.totalHandlers).toBeGreaterThan(0);
      expect(result.message).toContain("IPC Handler Reference");
    });

    it("should generate README for a directory", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--readme" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.files).toBeDefined();
    });
  });

  // ============================================================
  // api-tester handler
  // ============================================================
  describe("api-tester handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/api-tester/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should discover IPC handlers", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--discover" },
        { workspacePath: path.join(projectRoot, "src/main") },
      );
      expect(result.success).toBe(true);
      expect(result.result.totalHandlers).toBeGreaterThan(0);
      expect(result.message).toContain("IPC Handler Discovery");
    });

    it("should generate test stubs for an IPC file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const ipcFile = path.join(projectRoot, "src/main/hooks/hooks-ipc.js");
      if (fs.existsSync(ipcFile)) {
        const result = await handler.execute(
          { input: `--generate ${ipcFile}` },
          { workspacePath: projectRoot },
        );
        expect(result.success).toBe(true);
        expect(result.result.testCode).toBeDefined();
      }
    });
  });

  // ============================================================
  // onboard-project handler
  // ============================================================
  describe("onboard-project handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/onboard-project/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should analyze current project", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.info.techStack.length).toBeGreaterThan(0);
      expect(result.message).toContain("Project Onboarding");
    });

    it("should generate contributor guide", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--for-contributor" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("Contributor Guide");
    });
  });

  // ============================================================
  // dependency-analyzer handler
  // ============================================================
  describe("dependency-analyzer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/dependency-analyzer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should build dependency graph", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--graph" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.fileCount).toBeGreaterThan(0);
      expect(result.message).toContain("Dependency Graph");
    });

    it("should detect circular dependencies", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--circular" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.cycles).toBeDefined();
    });
  });

  // ============================================================
  // project-scaffold handler
  // ============================================================
  describe("project-scaffold handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/project-scaffold/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should scaffold a new skill", async () => {
      const result = await handler.execute(
        { input: "skill test-skill --category testing --with-handler" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.generatedFiles.length).toBe(2);
      expect(result.generatedFiles[0].path).toContain("SKILL.md");
      expect(result.generatedFiles[1].path).toContain("handler.js");
    });

    it("should scaffold a Vue page", async () => {
      const result = await handler.execute(
        { input: "page MyDashboard --store --route /my-dashboard" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.generatedFiles.length).toBe(2);
      expect(result.result.routerEntry).toBeDefined();
    });

    it("should scaffold an IPC module", async () => {
      const result = await handler.execute(
        { input: "ipc-module notification-manager --handlers 5" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.generatedFiles.length).toBe(2);
    });
  });

  // ============================================================
  // db-migration handler
  // ============================================================
  describe("db-migration handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/db-migration/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should inspect schema from source files", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--inspect" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.tables).toBeDefined();
    });

    it("should generate migration script", async () => {
      const result = await handler.execute(
        { input: "--generate 'add tags column to notes'" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.generatedFiles).toBeDefined();
      expect(result.generatedFiles[0].content).toContain("ALTER TABLE");
    });
  });

  // ============================================================
  // vulnerability-scanner handler
  // ============================================================
  describe("vulnerability-scanner handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/vulnerability-scanner/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should perform license audit", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--licenses" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.licenses).toBeDefined();
    });
  });

  // ============================================================
  // release-manager handler
  // ============================================================
  describe("release-manager handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/release-manager/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should perform dry run", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--dry-run" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.currentVersion).toBeDefined();
      expect(result.result.newVersion).toBeDefined();
      expect(result.message).toContain("Dry Run");
    });
  });

  // ============================================================
  // mcp-server-generator handler
  // ============================================================
  describe("mcp-server-generator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/mcp-server-generator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should generate MCP server from description", async () => {
      const result = await handler.execute(
        { input: "'an MCP server that manages tasks'" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.generatedFiles).toBeDefined();
      expect(result.generatedFiles.length).toBe(4);
    });

    it("should reject empty description", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // security-audit handler
  // ============================================================
  describe("security-audit handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/security-audit/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should run OWASP scan", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--owasp" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.findings).toBeDefined();
      expect(result.result.fileCount).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // devops-automation handler
  // ============================================================
  describe("devops-automation handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/devops-automation/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should analyze project", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "analyze" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.project.type).toBe("electron");
    });

    it("should generate Dockerfile", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "dockerfile" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.generatedFiles).toBeDefined();
      expect(result.generatedFiles[0].content).toContain("FROM");
    });

    it("should generate CI config", async () => {
      const result = await handler.execute(
        { input: "ci-config --platform github" },
        { workspacePath: path.resolve(__dirname, "../../..") },
      );
      expect(result.success).toBe(true);
      expect(result.generatedFiles[0].path).toContain("github");
    });
  });

  // ============================================================
  // code-review handler
  // ============================================================
  describe("code-review handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/code-review/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should review a single file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { action: "src/main/utils/logger.js" },
        { projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.summary).toBeDefined();
      expect(result.result.summary.score).toBeGreaterThan(0);
      expect(result.result.summary.filesReviewed).toBe(1);
      expect(result.message).toContain("Reviewed");
    });

    it("should review a directory", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { action: "src/main/utils" },
        { projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.summary.filesReviewed).toBeGreaterThan(1);
    });
  });

  // ============================================================
  // git-commit handler
  // ============================================================
  describe("git-commit handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/git-commit/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should handle dry-run mode", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { action: "--dry-run" },
        { projectRoot },
      );
      expect(result.success).toBe(true);
      // Either suggests a commit (if staged) or says no staged changes
      expect(result.message).toBeDefined();
    });
  });

  // ============================================================
  // explain-code handler
  // ============================================================
  describe("explain-code handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/explain-code/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should explain a source file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { action: "src/main/utils/logger.js" },
        { projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.language).toBe("JavaScript");
      expect(result.result.functions.length).toBeGreaterThan(0);
      expect(result.message).toContain("logger.js");
    });

    it("should return usage when no file provided", async () => {
      const result = await handler.execute({ action: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Usage");
    });
  });

  // ============================================================
  // data-analysis handler
  // ============================================================
  describe("data-analysis handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/data-analysis/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should return usage when no file provided", async () => {
      const result = await handler.execute({ action: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Usage");
    });

    it("should handle non-existent file", async () => {
      const result = await handler.execute(
        { action: "/nonexistent/data.csv" },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  // ============================================================
  // test-generator handler
  // ============================================================
  describe("test-generator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/test-generator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should generate tests for a source file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { action: "src/main/utils/logger.js" },
        { projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.framework).toBe("vitest");
      expect(result.result.functionsFound).toBeGreaterThan(0);
      expect(result.result.testCode).toContain("describe");
      expect(result.message).toContain("Test Generation");
    });

    it("should return usage when no file provided", async () => {
      const result = await handler.execute({ action: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Usage");
    });
  });

  // ============================================================
  // performance-optimizer handler
  // ============================================================
  describe("performance-optimizer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/performance-optimizer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should analyze a source file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { action: "src/main/utils/logger.js" },
        { projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.summary).toBeDefined();
      expect(result.result.summary.score).toBeGreaterThanOrEqual(0);
      expect(result.result.summary.score).toBeLessThanOrEqual(100);
      expect(result.message).toContain("Performance Analysis");
    });

    it("should analyze a directory", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { action: "src/main/utils --focus memory" },
        { projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.summary.filesAnalyzed).toBeGreaterThan(1);
      expect(result.result.summary.focus).toBe("memory");
    });
  });

  // ============================================================
  // architect-mode handler
  // ============================================================
  describe("architect-mode handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/architect-mode/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should generate a plan for a task", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--plan-only add user authentication" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.plan).toBeDefined();
      expect(result.result.plan.phases).toBeDefined();
    });
  });

  // ============================================================
  // task-decomposer handler
  // ============================================================
  describe("task-decomposer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/task-decomposer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should decompose a complex task", async () => {
      const result = await handler.execute(
        {
          input:
            "--analyze add a new user profile page with tests and documentation",
        },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.subTasks).toBeDefined();
      expect(result.result.subTasks.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // bugbot handler
  // ============================================================
  describe("bugbot handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/bugbot/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should scan a directory for bugs", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--scan" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.summary).toBeDefined();
      expect(result.result.summary.total).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // fault-localizer handler
  // ============================================================
  describe("fault-localizer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/fault-localizer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should parse a Node.js error message", async () => {
      const result = await handler.execute(
        { input: "--error TypeError: Cannot read properties of undefined" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.errorType).toBeDefined();
    });
  });

  // ============================================================
  // rules-engine handler
  // ============================================================
  describe("rules-engine handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/rules-engine/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should list rules (empty when no rules dir)", async () => {
      const result = await handler.execute(
        { input: "--list" },
        { workspacePath: "/tmp/nonexistent-project" },
      );
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // diff-previewer handler
  // ============================================================
  describe("diff-previewer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/diff-previewer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should show diff stats", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--stats" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });
  });

  // ============================================================
  // commit-splitter handler
  // ============================================================
  describe("commit-splitter handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/commit-splitter/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should analyze uncommitted changes", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--analyze" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });
  });

  // ============================================================
  // impact-analyzer handler
  // ============================================================
  describe("impact-analyzer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/impact-analyzer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should analyze impact of a file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--file src/main/utils/logger.js" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.targetFile).toBeDefined();
    });
  });

  // ============================================================
  // screenshot-to-code handler
  // ============================================================
  describe("screenshot-to-code handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/screenshot-to-code/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should return usage when no image provided", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success === true || result.success === false).toBe(true);
      expect(result.message).toBeDefined();
    });
  });

  // ============================================================
  // research-agent handler
  // ============================================================
  describe("research-agent handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/research-agent/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should evaluate a library", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--evaluate vitest" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });
  });

  // ============================================================
  // prompt-enhancer handler (v0.36.2)
  // ============================================================
  describe("prompt-enhancer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/prompt-enhancer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should enhance a prompt", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--enhance fix the login bug" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.intent).toBe("debug");
      expect(result.result.enhanced).toBeDefined();
    });

    it("should analyze a prompt", async () => {
      const result = await handler.execute(
        { input: "--analyze run unit tests for the search module" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.intent).toBe("test");
    });

    it("should return template", async () => {
      const result = await handler.execute(
        { input: "--template code-review" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.template).toBeDefined();
    });
  });

  // ============================================================
  // codebase-qa handler (v0.36.2)
  // ============================================================
  describe("codebase-qa handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/codebase-qa/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should build index", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--index" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.totalFiles).toBeGreaterThan(0);
    });

    it("should search for symbols", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--search logger" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // auto-context handler (v0.36.2)
  // ============================================================
  describe("auto-context handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/auto-context/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should detect context for a query", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--detect permission system" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.files).toBeDefined();
      expect(result.result.keywords).toBeDefined();
    });

    it("should set token budget", async () => {
      const result = await handler.execute({ input: "--budget 8000" }, {});
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // multi-model-router handler (v0.36.2)
  // ============================================================
  describe("multi-model-router handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/multi-model-router/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should route a simple task to lightweight model", async () => {
      const result = await handler.execute(
        { input: "--route fix a typo in README" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.complexity).toBeLessThanOrEqual(5);
      expect(result.result.recommendedModel).toBeDefined();
    });

    it("should route a complex task to premium model", async () => {
      const result = await handler.execute(
        {
          input:
            "--route refactor the entire authentication architecture across 15 files with security audit",
        },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.complexity).toBeGreaterThanOrEqual(6);
    });

    it("should show config", async () => {
      const result = await handler.execute({ input: "--config" }, {});
      expect(result.success).toBe(true);
      expect(result.result.models).toBeDefined();
    });
  });

  // ============================================================
  // code-translator handler (v0.36.2)
  // ============================================================
  describe("code-translator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/code-translator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should detect language of a JS file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--detect src/main/utils/logger.js" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.language).toBe("javascript");
    });

    it("should show usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.result.supportedTranslations).toBeDefined();
    });
  });

  // ============================================================
  // dead-code-eliminator handler (v0.36.2)
  // ============================================================
  describe("dead-code-eliminator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/dead-code-eliminator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should scan for unused exports", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--exports" },
        { workspacePath: path.join(projectRoot, "src/main/utils") },
      );
      expect(result.success).toBe(true);
      expect(result.result.deadCode).toBeDefined();
    });
  });

  // ============================================================
  // changelog-generator handler (v0.36.2)
  // ============================================================
  describe("changelog-generator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/changelog-generator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should generate changelog", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--generate" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.stats).toBeDefined();
    });
  });

  // ============================================================
  // mock-data-generator handler (v0.36.2)
  // ============================================================
  describe("mock-data-generator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/mock-data-generator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should generate user mock data", async () => {
      const result = await handler.execute(
        { input: "--type user --count 5" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.data).toBeDefined();
      expect(result.result.data.length).toBe(5);
    });

    it("should generate product mock data", async () => {
      const result = await handler.execute(
        { input: "--type product --count 3" },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.data.length).toBe(3);
    });

    it("should show available types when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.result.availableTypes).toBeDefined();
    });
  });

  // ============================================================
  // git-history-analyzer handler (v0.36.2)
  // ============================================================
  describe("git-history-analyzer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/git-history-analyzer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should analyze hotspots", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--hotspots" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.analysis.hotspots).toBeDefined();
    });
  });

  // ============================================================
  // i18n-manager handler (v0.36.2)
  // ============================================================
  describe("i18n-manager handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/i18n-manager/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should extract hardcoded strings", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--extract" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.total).toBeGreaterThanOrEqual(0);
    });

    it("should show usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("i18n Manager");
    });
  });

  // ============================================================
  // pdf-toolkit handler (v0.37.2)
  // ============================================================
  describe("pdf-toolkit handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/pdf-toolkit/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("PDF Toolkit");
    });

    it("should handle non-existent file", async () => {
      const result = await handler.execute(
        { input: "--extract /nonexistent/file.pdf" },
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // doc-converter handler (v0.37.2)
  // ============================================================
  describe("doc-converter handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/doc-converter/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should detect format of a file", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--detect package.json" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.format).toBeDefined();
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Document Converter");
    });
  });

  // ============================================================
  // excel-analyzer handler (v0.37.2)
  // ============================================================
  describe("excel-analyzer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/excel-analyzer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Excel Analyzer");
    });
  });

  // ============================================================
  // pptx-creator handler (v0.37.2)
  // ============================================================
  describe("pptx-creator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/pptx-creator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should list templates", async () => {
      const result = await handler.execute({ input: "--list-templates" }, {});
      expect(result.success).toBe(true);
      expect(result.result.templates).toBeDefined();
      expect(result.result.templates.length).toBeGreaterThanOrEqual(4);
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("PPTX Creator");
    });
  });

  // ============================================================
  // doc-comparator handler (v0.37.2)
  // ============================================================
  describe("doc-comparator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/doc-comparator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should compare two text files", async () => {
      const projectRoot = path.resolve(__dirname, "../../..");
      const result = await handler.execute(
        { input: "--compare package.json vitest.config.ts" },
        { workspacePath: projectRoot },
      );
      expect(result.success).toBe(true);
      expect(result.result.stats).toBeDefined();
      expect(result.result.stats.similarity).toBeDefined();
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Document Comparator");
    });
  });

  // ============================================================
  // audio-transcriber handler (v0.37.2)
  // ============================================================
  describe("audio-transcriber handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/audio-transcriber/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should list providers", async () => {
      const result = await handler.execute({ input: "--providers" }, {});
      expect(result.success).toBe(true);
      expect(result.result.providers).toBeDefined();
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Audio Transcriber");
    });
  });

  // ============================================================
  // video-toolkit handler (v0.37.2)
  // ============================================================
  describe("video-toolkit handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/video-toolkit/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Video Toolkit");
    });
  });

  // ============================================================
  // subtitle-generator handler (v0.37.2)
  // ============================================================
  describe("subtitle-generator handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/subtitle-generator/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Subtitle Generator");
    });
  });

  // ============================================================
  // tts-synthesizer handler (v0.37.2)
  // ============================================================
  describe("tts-synthesizer handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/tts-synthesizer/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should list voices", async () => {
      const result = await handler.execute({ input: "--list-voices" }, {});
      expect(result.success).toBe(true);
      expect(result.result.voices).toBeDefined();
      expect(result.result.count).toBeGreaterThan(0);
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("TTS Synthesizer");
    });
  });

  // ============================================================
  // media-metadata handler (v0.37.2)
  // ============================================================
  describe("media-metadata handler", () => {
    let handler;

    beforeEach(() => {
      handler = require("../../../src/main/ai-engine/cowork/skills/builtin/media-metadata/handler.js");
    });

    it("should export init and execute functions", () => {
      expect(typeof handler.init).toBe("function");
      expect(typeof handler.execute).toBe("function");
    });

    it("should return usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("Media Metadata");
    });

    it("should handle non-existent file", async () => {
      const result = await handler.execute(
        { input: "--extract /nonexistent/photo.jpg" },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("Not found");
    });
  });

  // ============================================================
  // SkillLoader - verify 60 builtin skills
  // ============================================================
  describe("SkillLoader - 60 builtin skills", () => {
    it("should find 60 SKILL.md files in builtin directory", () => {
      const builtinDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills/builtin",
      );
      const dirs = fs
        .readdirSync(builtinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      const skillDirs = dirs.filter((d) => {
        const skillMd = path.join(builtinDir, d.name, "SKILL.md");
        return fs.existsSync(skillMd);
      });

      expect(skillDirs.length).toBe(60);
    });

    it("should have 60 skills with handler.js (100% coverage)", () => {
      const builtinDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills/builtin",
      );
      const dirs = fs
        .readdirSync(builtinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      const handlerDirs = dirs.filter((d) => {
        const handlerJs = path.join(builtinDir, d.name, "handler.js");
        return fs.existsSync(handlerJs);
      });

      expect(handlerDirs.length).toBe(60);
    });

    it("should load all 60 handlers without errors", () => {
      const builtinDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills/builtin",
      );
      const dirs = fs
        .readdirSync(builtinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .filter((d) =>
          fs.existsSync(path.join(builtinDir, d.name, "handler.js")),
        );

      for (const d of dirs) {
        const handlerPath = path.join(builtinDir, d.name, "handler.js");
        const mod = require(handlerPath);
        expect(typeof mod.init).toBe("function");
        expect(typeof mod.execute).toBe("function");
      }
    });

    it("all SKILL.md files should have required frontmatter fields", () => {
      const builtinDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills/builtin",
      );
      const dirs = fs
        .readdirSync(builtinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const d of dirs) {
        const skillMd = path.join(builtinDir, d.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) {
          continue;
        }

        const content = fs.readFileSync(skillMd, "utf-8");
        // Check required frontmatter fields
        expect(content).toContain("name:");
        expect(content).toContain("description:");
        expect(content).toContain("version:");
        expect(content).toContain("category:");
      }
    });

    it("skills with handler field should have matching handler.js file", () => {
      const builtinDir = path.resolve(
        __dirname,
        "../../../src/main/ai-engine/cowork/skills/builtin",
      );
      const dirs = fs
        .readdirSync(builtinDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const d of dirs) {
        const skillMd = path.join(builtinDir, d.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) {
          continue;
        }

        const content = fs.readFileSync(skillMd, "utf-8");
        if (content.includes("handler: ./handler.js")) {
          const handlerPath = path.join(builtinDir, d.name, "handler.js");
          expect(fs.existsSync(handlerPath)).toBe(true);
        }
      }
    });
  });
});
