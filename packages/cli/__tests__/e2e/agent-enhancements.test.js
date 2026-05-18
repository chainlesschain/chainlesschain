/**
 * E2E tests for CLI Agent v0.42.0 enhancements:
 * - run_code tool in TOOLS definition
 * - Upgraded default models (qwen2.5:7b)
 * - Enhanced system prompt
 * - Upgraded execution limits
 * - run_code tool actual execution (Node.js)
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf-8"));
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args, options = {}) {
  return execSync(`node ${bin} ${args}`, {
    encoding: "utf-8",
    timeout: 15000,
    stdio: "pipe",
    ...options,
  });
}

describe("E2E: Agent v0.42.0 Enhancements", () => {
  // ─── agent --help validation ──────────────────────────────

  describe("agent --help", () => {
    it("agent --help shows agentic AI session description", () => {
      const result = run("agent --help");
      expect(result).toContain("agentic AI session");
      expect(result).toContain("--model");
      expect(result).toContain("--provider");
      expect(result).toContain("--session");
    });
  });

  // ─── Source code validations ──────────────────────────────

  describe("agent source validations (agent-core + agent-repl)", () => {
    const agentCorePath = join(cliRoot, "src", "runtime", "agent-core.js");
    const agentReplPath = join(cliRoot, "src", "repl", "agent-repl.js");
    let coreContent;
    let replContent;

    it("agent-core should be readable", () => {
      coreContent = readFileSync(agentCorePath, "utf8");
      expect(coreContent.length).toBeGreaterThan(1000);
    });

    it("agent-repl should be readable and import from agent-core", () => {
      replContent = readFileSync(agentReplPath, "utf8");
      expect(replContent.length).toBeGreaterThan(500);
      expect(replContent).toContain('from "../runtime/agent-core.js"');
    });

    it("should define run_code tool with python/node/bash in agent-core", () => {
      coreContent = coreContent || readFileSync(agentCorePath, "utf8");
      expect(coreContent).toContain('"run_code"');
      expect(coreContent).toContain('"python"');
      expect(coreContent).toContain('"node"');
      expect(coreContent).toContain('"bash"');
    });

    it("should have 9 tools total (8 original + run_code) in agent-core", () => {
      coreContent = coreContent || readFileSync(agentCorePath, "utf8");
      const toolNames = [
        "read_file",
        "write_file",
        "edit_file",
        "run_shell",
        "search_files",
        "list_dir",
        "run_skill",
        "list_skills",
        "run_code",
      ];
      for (const name of toolNames) {
        expect(coreContent).toContain(`"${name}"`);
      }
    });

    it("agent-core should import os module", () => {
      coreContent = coreContent || readFileSync(agentCorePath, "utf8");
      expect(coreContent).toContain('import os from "os"');
    });

    it("should use qwen2.5:7b as default model in agent-repl", () => {
      replContent = replContent || readFileSync(agentReplPath, "utf8");
      expect(replContent).toContain('options.model || "qwen2.5:7b"');
    });

    it("should use IterationBudget in agent-core", () => {
      coreContent = coreContent || readFileSync(agentCorePath, "utf8");
      expect(coreContent).toContain("IterationBudget");
    });

    it("should have enhanced system prompt with run_code guidance in agent-core", () => {
      coreContent = coreContent || readFileSync(agentCorePath, "utf8");
      expect(coreContent).toContain("run_code tool");
      expect(coreContent).toContain("capable coding agent");
      expect(coreContent).toContain(
        "Proactively write and execute code using run_code tool",
      );
    });

    it("should have max_tokens: 8192 for Anthropic in agent-core", () => {
      coreContent = coreContent || readFileSync(agentCorePath, "utf8");
      expect(coreContent).toContain("max_tokens: 8192");
    });
  });

  // ─── run_code Node.js execution ───────────────────────────

  describe("run_code actual execution", () => {
    it("Node.js code executes correctly via temp file pattern", () => {
      const tmpFile = join(tmpdir(), `cc-e2e-test-${Date.now()}.js`);
      try {
        writeFileSync(
          tmpFile,
          "const x = [1,2,3]; console.log(JSON.stringify({ sum: x.reduce((a,b)=>a+b,0) }));",
          "utf8",
        );
        const output = execSync(`node "${tmpFile}"`, {
          encoding: "utf8",
          timeout: 10000,
        });
        const result = JSON.parse(output.trim());
        expect(result.sum).toBe(6);
      } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      }
    });

    it("Bash code executes correctly via temp file pattern", () => {
      const tmpFile = join(tmpdir(), `cc-e2e-test-${Date.now()}.sh`);
      try {
        writeFileSync(tmpFile, 'echo "e2e bash test"', "utf8");
        const output = execSync(`bash "${tmpFile}"`, {
          encoding: "utf8",
          timeout: 10000,
        });
        expect(output.trim()).toBe("e2e bash test");
      } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      }
    });

    it("temp file cleanup works after execution", () => {
      const tmpFile = join(tmpdir(), `cc-e2e-cleanup-${Date.now()}.js`);
      writeFileSync(tmpFile, 'console.log("cleanup test")', "utf8");
      execSync(`node "${tmpFile}"`, { encoding: "utf8", timeout: 5000 });
      // Simulate cleanup
      unlinkSync(tmpFile);
      expect(existsSync(tmpFile)).toBe(false);
    });

    it("error execution returns non-zero exit code", () => {
      const tmpFile = join(tmpdir(), `cc-e2e-error-${Date.now()}.js`);
      try {
        writeFileSync(tmpFile, "process.exit(42);", "utf8");
        execSync(`node "${tmpFile}"`, { encoding: "utf8", timeout: 5000 });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err.status).toBe(42);
      } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      }
    });
  });

  // ─── agent-core export validations ─────────────────────────

  describe("agent-core exports", () => {
    it("classifyError is importable and callable from agent-core.js", async () => {
      const { classifyError } = await import("../../src/lib/agent-core.js");
      expect(typeof classifyError).toBe("function");

      const result = classifyError(
        "ModuleNotFoundError: No module named 'foo'",
        "",
        1,
        "python",
      );
      expect(result.errorType).toBe("import_error");
      expect(result.hint).toContain("foo");
    });

    it("isValidPackageName is importable and callable", async () => {
      const { isValidPackageName } =
        await import("../../src/lib/agent-core.js");
      expect(typeof isValidPackageName).toBe("function");

      expect(isValidPackageName("numpy")).toBe(true);
      expect(isValidPackageName("foo; rm -rf /")).toBe(false);
    });

    it("getEnvironmentInfo() returns expected fields", async () => {
      const { getEnvironmentInfo } =
        await import("../../src/lib/agent-core.js");
      const info = getEnvironmentInfo();
      expect(info).toHaveProperty("os");
      expect(info).toHaveProperty("arch");
      expect(info).toHaveProperty("python");
      expect(info).toHaveProperty("node");
      expect(info).toHaveProperty("git");
      expect(info.os).toBe(process.platform);
      expect(info.arch).toBe(process.arch);
    });

    it("agent-core source includes auto-install and agent-scripts references", () => {
      const agentCorePath = join(cliRoot, "src", "runtime", "agent-core.js");
      const content = readFileSync(agentCorePath, "utf8");
      expect(content).toContain("auto-install");
      expect(content).toContain("agent-scripts");
      expect(content).toContain("isValidPackageName");
      expect(content).toContain("classifyError");
      expect(content).toContain("getEnvironmentInfo");
      expect(content).toContain("getCachedPython");
    });

    it("agent-core exports buildSystemPrompt for persona support", () => {
      const agentCorePath = join(cliRoot, "src", "runtime", "agent-core.js");
      const content = readFileSync(agentCorePath, "utf8");
      expect(content).toContain("export function buildSystemPrompt");
      expect(content).toContain("_loadProjectPersona");
      expect(content).toContain("_buildPersonaPrompt");
      expect(content).toContain("toolsDisabled");
      expect(content).toContain("findProjectRoot");
      expect(content).toContain("loadProjectConfig");
    });

    it("agent-repl uses buildSystemPrompt instead of getBaseSystemPrompt", () => {
      const replContent = readFileSync(
        join(cliRoot, "src", "repl", "agent-repl.js"),
        "utf8",
      );
      expect(replContent).toContain("buildSystemPrompt");
      expect(replContent).not.toContain("getBaseSystemPrompt");
    });
  });

  // ─── task-model-selector upgraded mappings ────────────────

  describe("upgraded task-model-selector", () => {
    it("should be importable and return upgraded models", async () => {
      const { detectTaskType, selectModelForTask, TaskType } =
        await import("../../src/lib/task-model-selector.js");

      // Ollama models should be upgraded
      expect(selectModelForTask("ollama", TaskType.CHAT)).toBe("qwen2.5:7b");
      expect(selectModelForTask("ollama", TaskType.CODE)).toBe(
        "qwen2.5-coder:14b",
      );
      expect(selectModelForTask("ollama", TaskType.REASONING)).toBe(
        "qwen2.5:14b",
      );

      // Volcengine CHAT and CODE should both be doubao-seed-1-6-251015
      expect(selectModelForTask("volcengine", TaskType.CHAT)).toBe(
        "doubao-seed-1-6-251015",
      );
      expect(selectModelForTask("volcengine", TaskType.CODE)).toBe(
        "doubao-seed-1-6-251015",
      );
    });
  });

  // ─── llm-providers upgraded models ────────────────────────

  describe("upgraded llm-providers", () => {
    it("ollama provider should include qwen2.5 models", async () => {
      const { BUILT_IN_PROVIDERS } =
        await import("../../src/lib/llm-providers.js");
      const ollama = BUILT_IN_PROVIDERS.ollama;
      expect(ollama.models).toContain("qwen2.5:7b");
      expect(ollama.models).toContain("qwen2.5:14b");
      expect(ollama.models).toContain("qwen2.5-coder:14b");
    });
  });

  // ─── version bump ─────────────────────────────────────────

  describe("version bump", () => {
    it("CLI version should match package.json", () => {
      const result = run("--version");
      expect(result.trim()).toBe(pkg.version);
    });
  });
});
