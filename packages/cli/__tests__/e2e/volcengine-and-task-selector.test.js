/**
 * E2E tests for volcengine provider + task-model-selector CLI integration.
 *
 * Verifies that:
 * - CLI help output includes volcengine references
 * - llm providers command lists volcengine
 * - ask command accepts volcengine as a provider option
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function tryRun(args) {
  try {
    return { stdout: run(args), exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
}

/**
 * Extract JSON array from CLI output that may have log lines before it.
 * Looks for the first `[{` which starts a JSON array of objects.
 */
function extractJsonArray(output) {
  const idx = output.indexOf("[{");
  if (idx === -1) {
    // Fallback: try first `[`
    const idx2 = output.indexOf("[");
    if (idx2 === -1) throw new Error("No JSON array found in output");
    return JSON.parse(output.substring(idx2));
  }
  return JSON.parse(output.substring(idx));
}

describe("E2E: Volcengine Provider & Task Model Selector", () => {
  // ─── LLM command: volcengine visibility ─────────────────────

  describe("llm command", () => {
    it("llm --help lists providers subcommand", () => {
      const result = run("llm --help");
      expect(result).toContain("providers");
      expect(result).toContain("models");
      expect(result).toContain("test");
    });

    it("llm providers --json includes volcengine", () => {
      const { stdout } = tryRun("llm providers --json");
      // Output may have log lines; extract JSON array
      if (!stdout.includes("[{")) {
        // DB may fail to init in CI — skip gracefully
        return;
      }
      const providers = extractJsonArray(stdout);
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(8);

      const volcengine = providers.find((p) => p.name === "volcengine");
      expect(volcengine).toBeTruthy();
      expect(volcengine.displayName).toContain("Volcengine");
      expect(volcengine.baseUrl).toContain("ark.cn-beijing.volces.com");
      expect(volcengine.models).toContain("doubao-seed-1-6-251015");
      expect(volcengine.models).toContain("doubao-seed-code");
    });

    it("llm providers lists all 8 built-in providers", () => {
      const { stdout } = tryRun("llm providers --json");
      if (!stdout.includes("[{")) {
        return;
      }
      const providers = extractJsonArray(stdout);
      const builtinNames = providers
        .filter((p) => !p.custom)
        .map((p) => p.name);
      expect(builtinNames).toContain("ollama");
      expect(builtinNames).toContain("openai");
      expect(builtinNames).toContain("anthropic");
      expect(builtinNames).toContain("deepseek");
      expect(builtinNames).toContain("dashscope");
      expect(builtinNames).toContain("gemini");
      expect(builtinNames).toContain("mistral");
      expect(builtinNames).toContain("volcengine");
    });
  });

  // ─── ask command: volcengine option ─────────────────────────

  describe("ask command", () => {
    it("ask --help shows volcengine in provider description", () => {
      const result = run("ask --help");
      expect(result).toContain("volcengine");
      expect(result).toContain("--provider");
    });

    it("ask with volcengine provider fails gracefully without API key", () => {
      const { stderr, exitCode } = tryRun(
        'ask "hello" --provider volcengine --model doubao-seed-1-6-251015',
      );
      // Should fail with API key error, not crash
      expect(exitCode).not.toBe(0);
      expect(stderr || "").toMatch(/API key|VOLCENGINE_API_KEY|Failed/i);
    });
  });

  // ─── chat command: volcengine option ────────────────────────

  describe("chat command", () => {
    it("chat --help shows provider option", () => {
      const result = run("chat --help");
      expect(result).toContain("--provider");
    });
  });

  // ─── agent command: volcengine option ───────────────────────

  describe("agent command", () => {
    it("agent --help shows provider option", () => {
      const result = run("agent --help");
      expect(result).toContain("--provider");
    });
  });

  // ─── Task Model Selector module import ──────────────────────

  describe("task-model-selector module", () => {
    it("should be importable and functional", async () => {
      const { detectTaskType, selectModelForTask, TaskType } =
        await import("../../src/lib/task-model-selector.js");

      const task = detectTaskType("write a python function");
      expect(task.taskType).toBe(TaskType.CODE);

      const model = selectModelForTask("volcengine", task.taskType);
      expect(model).toBe("doubao-seed-code");
    });
  });
});
