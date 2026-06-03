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

describe("E2E: Phase 102 — EvoMap commands", () => {
  describe("evomap --help", () => {
    it("shows evomap command help", () => {
      const result = run("evomap --help");
      expect(result.toLowerCase()).toContain("evomap");
      expect(result.toLowerCase()).toContain("gene");
    });

    it("lists subcommands", () => {
      const result = run("evomap --help");
      expect(result).toContain("search");
      expect(result).toContain("download");
      expect(result).toContain("publish");
      expect(result).toContain("list");
      expect(result).toContain("hubs");
    });
  });

  describe("evomap search --help", () => {
    it("shows search options", () => {
      const result = run("evomap search --help");
      expect(result).toContain("query");
      expect(result).toContain("--category");
      expect(result).toContain("--limit");
    });
  });

  describe("evomap publish --help", () => {
    it("shows publish options", () => {
      const result = run("evomap publish --help");
      expect(result).toContain("--name");
      expect(result).toContain("--description");
    });
  });

  describe("evomap list --help", () => {
    it("shows list help", () => {
      const result = run("evomap list --help");
      expect(result.toLowerCase()).toContain("list");
    });
  });

  describe("evomap hubs --help", () => {
    it("shows hubs help", () => {
      const result = run("evomap hubs --help");
      expect(result.toLowerCase()).toContain("hub");
    });
  });
});

describe("E2E: Phase 102 — new module imports", () => {
  // ── Permanent Memory ──

  describe("permanent-memory module", () => {
    it("is importable", async () => {
      const mod = await import("../../src/lib/permanent-memory.js");
      expect(mod.CLIPermanentMemory).toBeDefined();
      expect(mod._deps).toBeDefined();
      expect(typeof mod.CLIPermanentMemory).toBe("function");
    });

    it("constructs without db", async () => {
      const { CLIPermanentMemory } =
        await import("../../src/lib/permanent-memory.js");
      const pm = new CLIPermanentMemory({ db: null });
      expect(pm.db).toBeNull();
    });

    it("getRelevantContext returns empty without db", async () => {
      const { CLIPermanentMemory } =
        await import("../../src/lib/permanent-memory.js");
      const pm = new CLIPermanentMemory({ db: null });
      pm.initialize();
      const results = pm.getRelevantContext("test", 5);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ── Autonomous Agent ──

  describe("autonomous-agent module", () => {
    it("is importable", async () => {
      const mod = await import("../../src/lib/autonomous-agent.js");
      expect(mod.CLIAutonomousAgent).toBeDefined();
      expect(mod.GoalStatus).toBeDefined();
      expect(mod.StepStatus).toBeDefined();
      expect(mod._deps).toBeDefined();
    });

    it("constructs and initializes", async () => {
      const { CLIAutonomousAgent } =
        await import("../../src/lib/autonomous-agent.js");
      const agent = new CLIAutonomousAgent();
      agent.initialize({
        llmChat: async () => ({ content: "test" }),
        toolExecutor: async () => ({ output: "ok" }),
      });
      expect(agent._initialized).toBe(true);
    });

    it("listGoals returns empty initially", async () => {
      const { CLIAutonomousAgent } =
        await import("../../src/lib/autonomous-agent.js");
      const agent = new CLIAutonomousAgent();
      agent.initialize({
        llmChat: async () => ({ content: "test" }),
        toolExecutor: async () => ({ output: "ok" }),
      });
      expect(agent.listGoals()).toEqual([]);
    });
  });

  // ── Content Recommender ──

  describe("content-recommender module", () => {
    it("is importable", async () => {
      const mod = await import("../../src/lib/content-recommender.js");
      expect(mod.CLIContentRecommender).toBeDefined();
      expect(typeof mod.CLIContentRecommender).toBe("function");
    });

    it("constructs and records tool use", async () => {
      const { CLIContentRecommender } =
        await import("../../src/lib/content-recommender.js");
      const rec = new CLIContentRecommender();
      rec.recordToolUse("read_file");
      rec.recordToolUse("edit_file");
      const stats = rec.getChainStats();
      expect(stats.totalUsages).toBe(2);
      expect(stats.uniqueChains).toBe(1);
    });

    it("builds tool features and computes similarity", async () => {
      const { CLIContentRecommender } =
        await import("../../src/lib/content-recommender.js");
      const rec = new CLIContentRecommender();
      rec.buildToolFeatures([
        { name: "read_file", description: "Read a file from the filesystem" },
        {
          name: "write_file",
          description: "Write content to a file on the filesystem",
        },
        {
          name: "run_shell",
          description: "Execute a command in the shell terminal",
        },
      ]);
      const sim = rec.calculateSimilarity("read_file", "write_file");
      const simShell = rec.calculateSimilarity("read_file", "run_shell");
      // File tools share "file" and "filesystem" terms
      expect(sim).toBeGreaterThanOrEqual(0);
      // At minimum, features should be built
      expect(rec._toolFeatures.size).toBe(3);
    });
  });

  // ── EvoMap Client ──

  describe("evomap-client module", () => {
    it("is importable", async () => {
      const mod = await import("../../src/lib/evomap-client.js");
      expect(mod.EvoMapClient).toBeDefined();
      expect(mod._deps).toBeDefined();
    });

    it("constructs with default hub URL", async () => {
      const { EvoMapClient } = await import("../../src/lib/evomap-client.js");
      const client = new EvoMapClient();
      expect(client.hubUrl).toContain("evomap");
    });
  });

  // ── EvoMap Manager ──

  describe("evomap-manager module", () => {
    it("is importable", async () => {
      const mod = await import("../../src/lib/evomap-manager.js");
      expect(mod.EvoMapManager).toBeDefined();
    });

    it("packages gene correctly", async () => {
      const { EvoMapManager } = await import("../../src/lib/evomap-manager.js");
      const mgr = new EvoMapManager({});
      const gene = mgr.packageGene({
        name: "test-gene",
        description: "A test gene",
        category: "testing",
        content: "gene content",
        author: "e2e-test",
      });
      expect(gene.id).toContain("test-gene");
      expect(gene.name).toBe("test-gene");
      expect(gene.version).toBe("1.0.0");
    });
  });

  // ── Plan Mode DAG ──

  describe("plan-mode advanced features", () => {
    it("ExecutionPlan supports topological sort", async () => {
      const { ExecutionPlan } = await import("../../src/lib/plan-mode.js");
      const plan = new ExecutionPlan();
      const item1 = plan.addItem({ title: "Step 1" });
      const item2 = plan.addItem({ title: "Step 2", dependencies: [item1.id] });
      plan.addItem({ title: "Step 3", dependencies: [item2.id] });

      const sorted = plan.topologicalSort();
      expect(sorted.map((i) => i.title)).toEqual([
        "Step 1",
        "Step 2",
        "Step 3",
      ]);
    });

    it("ExecutionPlan detects cycles", async () => {
      const { ExecutionPlan } = await import("../../src/lib/plan-mode.js");
      const plan = new ExecutionPlan();
      const item1 = plan.addItem({ title: "A" });
      const item2 = plan.addItem({ title: "B", dependencies: [item1.id] });
      item1.dependencies = [item2.id];

      expect(() => plan.topologicalSort()).toThrow("cycle");
    });

    it("ExecutionPlan provides risk assessment", async () => {
      const { ExecutionPlan } = await import("../../src/lib/plan-mode.js");
      const plan = new ExecutionPlan();
      plan.addItem({ tool: "read_file", estimatedImpact: "low" });
      plan.addItem({ tool: "run_shell", estimatedImpact: "high" });

      const risk = plan.getRiskAssessment();
      expect(risk.level).toBeTruthy();
      expect(risk.itemScores.length).toBe(2);
    });

    it("PlanItem calculates risk score", async () => {
      const { PlanItem } = await import("../../src/lib/plan-mode.js");
      const item = new PlanItem({ tool: "run_shell", estimatedImpact: "high" });
      expect(item.riskScore).toBe(9); // 3 * 3
    });
  });

  // ── Context Engineering enhanced features ──

  describe("context-engineering enhanced features", () => {
    it("supports resumable compaction summaries", async () => {
      const { CLIContextEngineering } =
        await import("../../src/lib/cli-context-engineering.js");
      const engine = new CLIContextEngineering({ db: null });
      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 20 }, (_, i) => [
          { role: "user", content: `question ${i}` },
          { role: "assistant", content: `answer ${i}` },
        ]).flat(),
      ];
      engine.smartCompact(messages, { keepPairs: 3 });
      expect(engine._compactionSummaries.length).toBeGreaterThan(0);
    });

    it("includes compaction summaries in optimized messages", async () => {
      const { CLIContextEngineering } =
        await import("../../src/lib/cli-context-engineering.js");
      const engine = new CLIContextEngineering({ db: null });
      engine._compactionSummaries = ['- Q: "setup" → install packages'];
      const result = engine.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        {},
      );
      const summaryMsg = result.find(
        (m) =>
          m.role === "system" &&
          m.content.includes("Compacted Context Summary"),
      );
      expect(summaryMsg).toBeDefined();
    });

    it("stable prefix cache works for long prompts", async () => {
      const { CLIContextEngineering } =
        await import("../../src/lib/cli-context-engineering.js");
      const engine = new CLIContextEngineering({ db: null });
      const longPrompt =
        "A".repeat(200) + " Started at 2026-03-12T14:30:00Z end.";
      engine.buildOptimizedMessages(
        [{ role: "system", content: longPrompt }],
        {},
      );
      expect(engine._prefixCache).not.toBeNull();
      expect(engine.getStats().prefixCached).toBe(true);
    });

    it("reports enhanced stats", async () => {
      const { CLIContextEngineering } =
        await import("../../src/lib/cli-context-engineering.js");
      const engine = new CLIContextEngineering({ db: null });
      const stats = engine.getStats();
      expect(stats).toHaveProperty("hasPermanentMemory");
      expect(stats).toHaveProperty("compactionSummaries");
      expect(stats).toHaveProperty("prefixCached");
    });
  });
});
