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

describe("E2E: Context Engineering CLI integration", () => {
  describe("agent command --session option", () => {
    it("agent --help shows --session option", () => {
      const result = run("agent --help");
      expect(result).toContain("--session");
      expect(result).toContain("Resume a previous agent session");
    });

    it("agent --help still shows existing options", () => {
      const result = run("agent --help");
      expect(result).toContain("--model");
      expect(result).toContain("--provider");
      expect(result).toContain("--base-url");
      expect(result).toContain("--api-key");
      expect(result).toContain("agentic AI session");
    });
  });

  describe("chat command --session option", () => {
    it("chat --help shows --session option", () => {
      const result = run("chat --help");
      expect(result).toContain("--session");
      expect(result).toContain("--agent");
    });

    it("chat --help still shows existing options", () => {
      const result = run("chat --help");
      expect(result).toContain("--model");
      expect(result).toContain("--provider");
    });
  });

  describe("module imports are valid", () => {
    it("cli-context-engineering module is importable", async () => {
      const mod = await import("../../src/lib/cli-context-engineering.js");
      expect(mod.CLIContextEngineering).toBeDefined();
      expect(mod._deps).toBeDefined();
      expect(typeof mod.CLIContextEngineering).toBe("function");
    });

    it("CLIContextEngineering constructs without db", () => {
      // Dynamic import to test from e2e context
      return import("../../src/lib/cli-context-engineering.js").then((mod) => {
        const engine = new mod.CLIContextEngineering({ db: null });
        expect(engine.db).toBeNull();
        expect(engine.errorHistory).toEqual([]);
        expect(engine.taskContext).toBeNull();
      });
    });

    it("CLIContextEngineering builds messages without db", () => {
      return import("../../src/lib/cli-context-engineering.js").then((mod) => {
        // Mock readUserProfile to avoid filesystem dependency in CI
        const origReadProfile = mod._deps.readUserProfile;
        mod._deps.readUserProfile = () => "";
        try {
          const engine = new mod.CLIContextEngineering({ db: null });
          const result = engine.buildOptimizedMessages(
            [
              { role: "system", content: "test system prompt" },
              { role: "user", content: "hello" },
            ],
            { userQuery: "hello" },
          );
          expect(result.length).toBe(2);
          expect(result[0].role).toBe("system");
          expect(result[1].role).toBe("user");
        } finally {
          mod._deps.readUserProfile = origReadProfile;
        }
      });
    });

    it("CLIContextEngineering smartCompact works", () => {
      return import("../../src/lib/cli-context-engineering.js").then((mod) => {
        const engine = new mod.CLIContextEngineering({ db: null });
        const messages = [
          { role: "system", content: "sys" },
          ...Array.from({ length: 20 }, (_, i) => [
            { role: "user", content: `q${i}` },
            { role: "assistant", content: `a${i}` },
          ]).flat(),
        ];
        const compacted = engine.smartCompact(messages, { keepPairs: 3 });
        // 1 system + 3 pairs * 2 = 7
        expect(compacted.length).toBe(7);
        expect(compacted[0].content).toBe("sys");
      });
    });

    it("CLIContextEngineering task management works", () => {
      return import("../../src/lib/cli-context-engineering.js").then((mod) => {
        const engine = new mod.CLIContextEngineering({ db: null });
        engine.setTask("Test task", ["Step 1", "Step 2"]);
        expect(engine.taskContext.objective).toBe("Test task");
        expect(engine.taskContext.steps).toHaveLength(2);
        engine.updateTaskProgress(1);
        expect(engine.taskContext.currentStep).toBe(1);
        engine.clearTask();
        expect(engine.taskContext).toBeNull();
      });
    });

    it("CLIContextEngineering error recording works", () => {
      return import("../../src/lib/cli-context-engineering.js").then((mod) => {
        const engine = new mod.CLIContextEngineering({ db: null });
        engine.recordError({ step: "test", message: "err1" });
        engine.recordError({
          step: "test",
          message: "err2",
          resolution: "fixed",
        });
        expect(engine.errorHistory).toHaveLength(2);
        const stats = engine.getStats();
        expect(stats.errorCount).toBe(2);
        expect(stats.hasDb).toBe(false);
      });
    });
  });

  describe("agent-repl module exports", () => {
    it("exports startAgentRepl with correct signature", async () => {
      const mod = await import("../../src/repl/agent-repl.js");
      expect(typeof mod.startAgentRepl).toBe("function");
    });
  });
});
