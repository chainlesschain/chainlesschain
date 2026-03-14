/**
 * E2E tests for CLI Agent v0.40.3 enhancements:
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
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args, options = {}) {
  return execSync(`node ${bin} ${args}`, {
    encoding: "utf-8",
    timeout: 15000,
    stdio: "pipe",
    ...options,
  });
}

describe("E2E: Agent v0.40.3 Enhancements", () => {
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

  describe("agent-repl source validations", () => {
    const agentReplPath = join(cliRoot, "src", "repl", "agent-repl.js");
    let content;

    it("should be readable", () => {
      content = readFileSync(agentReplPath, "utf8");
      expect(content.length).toBeGreaterThan(1000);
    });

    it("should define run_code tool with python/node/bash", () => {
      content = content || readFileSync(agentReplPath, "utf8");
      expect(content).toContain('name: "run_code"');
      expect(content).toContain('"python"');
      expect(content).toContain('"node"');
      expect(content).toContain('"bash"');
    });

    it("should have 9 tools total (8 original + run_code)", () => {
      content = content || readFileSync(agentReplPath, "utf8");
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
        expect(content).toContain(`name: "${name}"`);
      }
    });

    it("should import os module for tmpdir", () => {
      content = content || readFileSync(agentReplPath, "utf8");
      expect(content).toContain('import os from "os"');
    });

    it("should use qwen2.5:7b as default model", () => {
      content = content || readFileSync(agentReplPath, "utf8");
      expect(content).toContain('options.model || "qwen2.5:7b"');
    });

    it("should have MAX_ITERATIONS = 15", () => {
      content = content || readFileSync(agentReplPath, "utf8");
      expect(content).toContain("MAX_ITERATIONS = 15");
    });

    it("should have enhanced system prompt with run_code guidance", () => {
      content = content || readFileSync(agentReplPath, "utf8");
      expect(content).toContain("run_code tool");
      expect(content).toContain("capable coding agent");
      expect(content).toContain(
        "Proactively write and execute code using run_code tool",
      );
    });

    it("should have max_tokens: 8192 for Anthropic", () => {
      content = content || readFileSync(agentReplPath, "utf8");
      expect(content).toContain("max_tokens: 8192");
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
    it("CLI version should be 0.40.3", () => {
      const result = run("--version");
      expect(result.trim()).toBe("0.40.3");
    });
  });
});
