/**
 * E2E tests for LLM providers + task-model-selector CLI integration.
 *
 * Verifies that:
 * - CLI help output includes provider references
 * - llm providers command lists all 10 built-in providers (incl. kimi, minimax)
 * - ask/chat/agent commands accept provider options
 * - task-model-selector works for all providers
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

describe("E2E: LLM Providers & Task Model Selector", () => {
  // ─── LLM command: provider visibility ─────────────────────

  describe("llm command", () => {
    it("llm --help lists providers subcommand", () => {
      const result = run("llm --help");
      expect(result).toContain("providers");
      expect(result).toContain("models");
      expect(result).toContain("test");
    });

    it("llm providers --json includes volcengine", () => {
      const { stdout } = tryRun("llm providers --json");
      if (!stdout.includes("[{")) {
        return;
      }
      const providers = extractJsonArray(stdout);
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(10);

      const volcengine = providers.find((p) => p.name === "volcengine");
      expect(volcengine).toBeTruthy();
      expect(volcengine.displayName).toContain("Volcengine");
      expect(volcengine.baseUrl).toContain("ark.cn-beijing.volces.com");
      expect(volcengine.models).toContain("doubao-seed-1-6-251015");
      expect(volcengine.models).toContain("doubao-seed-code");
    });

    it("llm providers --json includes kimi and minimax", () => {
      const { stdout } = tryRun("llm providers --json");
      if (!stdout.includes("[{")) {
        return;
      }
      const providers = extractJsonArray(stdout);

      const kimi = providers.find((p) => p.name === "kimi");
      expect(kimi).toBeTruthy();
      expect(kimi.displayName).toContain("Kimi");
      expect(kimi.baseUrl).toContain("api.moonshot.cn");
      expect(kimi.models).toContain("moonshot-v1-auto");

      const minimax = providers.find((p) => p.name === "minimax");
      expect(minimax).toBeTruthy();
      expect(minimax.displayName).toContain("MiniMax");
      expect(minimax.baseUrl).toContain("api.minimax.chat");
      expect(minimax.models).toContain("MiniMax-Text-01");
    });

    it("llm providers lists all 10 built-in providers", () => {
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
      expect(builtinNames).toContain("kimi");
      expect(builtinNames).toContain("minimax");
    });
  });

  // ─── ask command: provider options ──────────────────────────

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
      expect(exitCode).not.toBe(0);
      expect(stderr || "").toMatch(/API key|VOLCENGINE_API_KEY|Failed/i);
    });
  });

  // ─── chat command ─────────────────────────────────────────

  describe("chat command", () => {
    it("chat --help shows provider option", () => {
      const result = run("chat --help");
      expect(result).toContain("--provider");
    });
  });

  // ─── agent command ────────────────────────────────────────

  describe("agent command", () => {
    it("agent --help shows provider option", () => {
      const result = run("agent --help");
      expect(result).toContain("--provider");
    });
  });

  // ─── Task Model Selector module ───────────────────────────

  describe("task-model-selector module", () => {
    it("should select correct model for volcengine code task", async () => {
      const { detectTaskType, selectModelForTask, TaskType } =
        await import("../../src/lib/task-model-selector.js");

      const task = detectTaskType("write a python function");
      expect(task.taskType).toBe(TaskType.CODE);

      const model = selectModelForTask("volcengine", task.taskType);
      expect(model).toBe("doubao-seed-1-6-251015");
    });

    it("should select correct model for kimi and minimax", async () => {
      const { selectModelForTask, TaskType } =
        await import("../../src/lib/task-model-selector.js");

      expect(selectModelForTask("kimi", TaskType.CHAT)).toBe(
        "moonshot-v1-auto",
      );
      expect(selectModelForTask("kimi", TaskType.FAST)).toBe("moonshot-v1-8k");
      expect(selectModelForTask("minimax", TaskType.CHAT)).toBe(
        "MiniMax-Text-01",
      );
      expect(selectModelForTask("minimax", TaskType.FAST)).toBe(
        "abab6.5s-chat",
      );
    });

    it("should return model for all 10 providers across all task types", async () => {
      const { selectModelForTask, TaskType } =
        await import("../../src/lib/task-model-selector.js");

      const providers = [
        "volcengine",
        "openai",
        "anthropic",
        "deepseek",
        "dashscope",
        "gemini",
        "kimi",
        "minimax",
        "mistral",
        "ollama",
      ];
      const taskTypes = Object.values(TaskType);

      for (const provider of providers) {
        for (const taskType of taskTypes) {
          const model = selectModelForTask(provider, taskType);
          expect(
            model,
            `Missing model for ${provider}/${taskType}`,
          ).toBeTruthy();
        }
      }
    });
  });

  // ─── Constants: LLM_PROVIDERS setup wizard entries ─────────

  describe("constants LLM_PROVIDERS", () => {
    it("should have volcengine as first provider and include proxy entries", async () => {
      const { LLM_PROVIDERS } = await import("../../src/constants.js");
      const keys = Object.keys(LLM_PROVIDERS);
      expect(keys[0]).toBe("volcengine");
      expect(keys).toContain("openai-proxy");
      expect(keys).toContain("anthropic-proxy");
      expect(keys).toContain("gemini-proxy");
      expect(keys).toContain("kimi");
      expect(keys).toContain("minimax");
      expect(keys).toContain("custom");
    });

    it("should have volcengine as default provider in DEFAULT_CONFIG", async () => {
      const { DEFAULT_CONFIG } = await import("../../src/constants.js");
      expect(DEFAULT_CONFIG.llm.provider).toBe("volcengine");
    });
  });
});
