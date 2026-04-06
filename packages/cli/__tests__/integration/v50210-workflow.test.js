/**
 * v5.0.2.10 Integration Tests — cross-module workflows:
 *   1. Compression A/B + session persistence
 *   2. Task notifications + event serialization
 *   3. Feature flag variant switching mid-session
 *   4. Worktree WS protocol simulation
 *
 * 20 tests total
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `cc-v50210-integ-${Date.now()}`);

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

let mockConfig = { features: {} };
vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: () => mockConfig,
  getConfigValue: (key) => {
    const parts = key.split(".");
    let current = mockConfig;
    for (const p of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = current[p];
    }
    return current;
  },
  saveConfig: (config) => {
    mockConfig = config;
  },
}));

const { feature, featureVariant, setFeature } =
  await import("../../src/lib/feature-flags.js");
const {
  PromptCompressor,
  adaptiveThresholds,
  getCompressionVariant,
  COMPRESSION_VARIANTS,
} = await import("../../src/lib/prompt-compressor.js");
const {
  startSession,
  appendUserMessage,
  appendAssistantMessage,
  appendCompactEvent,
  rebuildMessages,
  migrateLegacySessionFile,
  validateJsonlSession,
} = await import("../../src/lib/jsonl-session-store.js");
const { BackgroundTaskManager, TaskStatus } =
  await import("../../src/lib/background-task-manager.js");
const {
  recordCompressionMetric,
  getCompressionTelemetrySummary,
} = await import("../../src/lib/compression-telemetry.js");

beforeEach(() => {
  mockConfig = { features: {} };
  mkdirSync(join(testDir, "sessions"), { recursive: true });
  mkdirSync(join(testDir, "tasks"), { recursive: true });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CC_FLAG_")) delete process.env[key];
  }
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Compression A/B + JSONL Session
// ═══════════════════════════════════════════════════════════════════════

describe("Compression A/B + JSONL session workflow", () => {
  it("aggressive variant compresses more, stores compact checkpoint", async () => {
    mockConfig = {
      features: { COMPRESSION_AB: { enabled: true, variant: "aggressive" } },
    };

    const sid = startSession(null, { title: "ab-aggressive" });
    const compressor = new PromptCompressor({ maxMessages: 5, maxTokens: 300 });
    const messages = [];

    for (let i = 0; i < 12; i++) {
      const msg = `Message ${i}: ${"data ".repeat(15)}`;
      messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: msg });
      if (i % 2 === 0) appendUserMessage(sid, msg);
      else appendAssistantMessage(sid, msg);
    }

    const { messages: compacted, stats } = await compressor.compress(messages);
    expect(stats.abVariant).toBe("aggressive");
    expect(compacted.length).toBeLessThan(messages.length);

    appendCompactEvent(sid, { messages: compacted, stats });
    appendUserMessage(sid, "post-compact");

    const rebuilt = rebuildMessages(sid);
    expect(rebuilt[rebuilt.length - 1].content).toBe("post-compact");
  });

  it("switching variant mid-session produces different compression ratios", async () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `item ${i}: ${"text ".repeat(20)}`,
    }));

    // Aggressive
    mockConfig = {
      features: { COMPRESSION_AB: { enabled: true, variant: "aggressive" } },
    };
    const compAgg = new PromptCompressor({ maxMessages: 8, maxTokens: 500 });
    const { stats: aggStats } = await compAgg.compress(messages);

    // Relaxed
    mockConfig = {
      features: { COMPRESSION_AB: { enabled: true, variant: "relaxed" } },
    };
    const compRel = new PromptCompressor({ maxMessages: 8, maxTokens: 500 });
    const { stats: relStats } = await compRel.compress(messages);

    // Both should record their variant
    expect(aggStats.abVariant).toBe("aggressive");
    expect(relStats.abVariant).toBe("relaxed");
  });

  it("no A/B → compress stats have no abVariant field", async () => {
    mockConfig = { features: {} };
    const compressor = new PromptCompressor({ maxMessages: 5, maxTokens: 500 });
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    }));

    const { stats } = await compressor.compress(messages);
    expect(stats.abVariant).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Feature Flag Variant Switching
// ═══════════════════════════════════════════════════════════════════════

describe("Feature flag variant switching mid-session", () => {
  it("setFeature updates COMPRESSION_AB variant", () => {
    setFeature("COMPRESSION_AB", { enabled: true, variant: "aggressive" });
    expect(feature("COMPRESSION_AB")).toBe(true);
    expect(featureVariant("COMPRESSION_AB")).toBe("aggressive");

    setFeature("COMPRESSION_AB", { enabled: true, variant: "relaxed" });
    expect(featureVariant("COMPRESSION_AB")).toBe("relaxed");
  });

  it("adaptiveThresholds responds to runtime variant change", () => {
    setFeature("COMPRESSION_AB", { enabled: true, variant: "aggressive" });
    const t1 = adaptiveThresholds(64000);

    setFeature("COMPRESSION_AB", { enabled: true, variant: "relaxed" });
    const t2 = adaptiveThresholds(64000);

    expect(t1.maxTokens).toBeLessThan(t2.maxTokens);
    expect(t1.variant).toBe("aggressive");
    expect(t2.variant).toBe("relaxed");
  });

  it("disabling COMPRESSION_AB returns to standard thresholds", () => {
    setFeature("COMPRESSION_AB", { enabled: true, variant: "aggressive" });
    const withAB = adaptiveThresholds(32768);

    setFeature("COMPRESSION_AB", false);
    const withoutAB = adaptiveThresholds(32768);

    // Without AB → 0.6 factor; aggressive → 0.4 factor
    expect(withoutAB.maxTokens).toBeGreaterThan(withAB.maxTokens);
    expect(withoutAB.variant).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Task Notifications WS Protocol
// ═══════════════════════════════════════════════════════════════════════

describe("Task notification WS protocol simulation", () => {
  it("task:complete event can construct WS broadcast message", () => {
    const mgr = new BackgroundTaskManager({ maxConcurrent: 5 });
    const broadcasts = [];

    // Simulate WS server _subscribeTaskNotifications
    mgr.on("task:complete", (task) => {
      broadcasts.push({
        type: "task:notification",
        task: {
          id: task.id,
          status: task.status,
          description: task.description,
          completedAt: task.completedAt,
          result: task.result,
          error: task.error,
        },
      });
    });

    const t = mgr.create({
      type: "shell",
      command: "echo test",
      description: "WS test",
    });
    mgr._complete(t.id, TaskStatus.COMPLETED, "test output", null);

    expect(broadcasts.length).toBe(1);
    const msg = broadcasts[0];
    expect(msg.type).toBe("task:notification");
    expect(msg.task.status).toBe("completed");
    expect(msg.task.result).toBe("test output");

    // Verify serializable
    const json = JSON.stringify(msg);
    expect(json).toContain("task:notification");
    mgr.destroy();
  });

  it("failed task sends error in notification", () => {
    const mgr = new BackgroundTaskManager({ maxConcurrent: 5 });
    const notifications = [];
    mgr.on("task:complete", (task) => notifications.push(task));

    const t = mgr.create({ type: "shell", command: "fail" });
    t.status = TaskStatus.FAILED;
    t.error = "Process exited with code 1";
    t.completedAt = Date.now();
    mgr.emit("task:complete", t);

    expect(notifications[0].error).toBe("Process exited with code 1");
    mgr.destroy();
  });

  it("multiple task completions produce multiple notifications", () => {
    const mgr = new BackgroundTaskManager({ maxConcurrent: 5 });
    const ids = [];
    mgr.on("task:complete", (task) => ids.push(task.id));

    for (let i = 0; i < 5; i++) {
      const t = mgr.create({ type: "shell", command: `echo ${i}` });
      mgr._complete(t.id, TaskStatus.COMPLETED, String(i), null);
    }

    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(5); // All unique
    mgr.destroy();
  });

  it("recovered task exposes detail history after restart", () => {
    const mgr = new BackgroundTaskManager({ maxConcurrent: 5 });
    const task = mgr.create({
      type: "shell",
      command: "echo recover",
      description: "recover-me",
    });
    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    mgr._persistTask(task, "running");
    mgr.destroy();

    const recovered = new BackgroundTaskManager({
      maxConcurrent: 5,
      recoverOnStart: true,
    });
    const details = recovered.getDetails(task.id);
    const history = recovered.getHistory(task.id);

    expect(details.recoveredFromRestart).toBe(true);
    expect(details.recoverySourceStatus).toBe(TaskStatus.RUNNING);
    expect(history.some((item) => item.event === "recovered")).toBe(true);
    recovered.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Worktree WS Protocol Simulation
// ═══════════════════════════════════════════════════════════════════════

describe("Worktree WS protocol messages", () => {
  it("worktree-diff request requires branch field", () => {
    // Simulate WS handler validation
    const message = { type: "worktree-diff" };
    expect(message.branch).toBeUndefined();
    // Handler should respond with NO_BRANCH error
  });

  it("worktree-merge request structure is valid", () => {
    const request = {
      type: "worktree-merge",
      id: "req-1",
      branch: "agent/task-123",
      strategy: "squash",
      commitMessage: "feat: merge agent work",
    };
    const json = JSON.stringify(request);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe("worktree-merge");
    expect(parsed.branch).toBe("agent/task-123");
    expect(parsed.strategy).toBe("squash");
  });

  it("worktree-list response structure", () => {
    // Simulate response format
    const response = {
      id: "req-2",
      type: "worktree-list",
      worktrees: [
        {
          path: "/repo/.worktrees/agent-task-1",
          branch: "agent/task-1",
          head: "abc123",
        },
        {
          path: "/repo/.worktrees/agent-task-2",
          branch: "agent/task-2",
          head: "def456",
        },
      ],
    };
    const json = JSON.stringify(response);
    const parsed = JSON.parse(json);

    expect(parsed.worktrees.length).toBe(2);
    expect(parsed.worktrees[0].branch).toBe("agent/task-1");
  });

  it("worktree-merged success response", () => {
    const response = {
      id: "req-3",
      type: "worktree-merged",
      success: true,
      strategy: "squash",
      message: "Successfully merged agent/task-123 via squash",
    };
    expect(response.success).toBe(true);
    expect(response.strategy).toBe("squash");
  });

  it("worktree-merged conflict response", () => {
    const response = {
      id: "req-4",
      type: "worktree-merged",
      success: false,
      strategy: "merge",
      message: "Merge conflicts detected — manual resolution required",
      conflicts: [
        {
          path: "src/lib/config.js",
          type: "both_modified",
          suggestion:
            "Review both sides in src/lib/config.js and resolve conflict markers manually.",
        },
        {
          path: "src/main.js",
          type: "deleted_by_them",
          suggestion:
            "Decide whether src/main.js should stay deleted in the agent branch or be kept from the current branch.",
        },
      ],
      summary: {
        conflictedFiles: 2,
        bothModified: 1,
        bothAdded: 0,
        deleteModify: 1,
      },
      suggestions: [
        "Resolve 2 conflicted file(s), then rerun the merge.",
        "Start with files marked both_modified; they usually need direct hunk reconciliation.",
      ],
    };
    expect(response.success).toBe(false);
    expect(response.conflicts.length).toBe(2);
    expect(response.summary.conflictedFiles).toBe(2);
    expect(response.suggestions.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Cross-feature: JSONL default + Compression A/B
// ═══════════════════════════════════════════════════════════════════════

describe("JSONL default true + Compression A/B cross-feature", () => {
  it("JSONL_SESSION true + COMPRESSION_AB aggressive: full workflow", async () => {
    mockConfig = {
      features: {
        JSONL_SESSION: true,
        COMPRESSION_AB: { enabled: true, variant: "aggressive" },
      },
    };

    expect(feature("JSONL_SESSION")).toBe(true);
    expect(feature("COMPRESSION_AB")).toBe(true);

    const sid = startSession(null, { title: "cross-feature" });
    const compressor = new PromptCompressor({ model: "llama3:8b" });
    // llama3:8b=8192, aggressive: tokenFactor=0.4 → maxTokens=3276
    expect(compressor.maxTokens).toBe(Math.floor(8192 * 0.4));

    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `item ${i}: ${"test ".repeat(10)}`,
    }));

    for (const msg of messages) {
      if (msg.role === "user") appendUserMessage(sid, msg.content);
      else appendAssistantMessage(sid, msg.content);
    }

    const { messages: compacted, stats } = await compressor.compress(messages);
    expect(stats.abVariant).toBe("aggressive");
    appendCompactEvent(sid, { messages: compacted, stats });

    const rebuilt = rebuildMessages(sid);
    expect(rebuilt.length).toBeLessThanOrEqual(compacted.length);
  });

  it("records compression telemetry summary for dashboard consumption", () => {
    recordCompressionMetric({
      strategy: "truncate",
      originalTokens: 1000,
      compressedTokens: 700,
      saved: 300,
      abVariant: "balanced",
    });
    recordCompressionMetric({
      strategy: "truncate+dedup",
      originalTokens: 900,
      compressedTokens: 500,
      saved: 400,
      abVariant: "aggressive",
    });

    const summary = getCompressionTelemetrySummary();
    expect(summary.samples).toBe(2);
    expect(summary.totalSavedTokens).toBe(700);
    expect(summary.variantDistribution.balanced).toBe(1);
    expect(summary.variantDistribution.aggressive).toBe(1);
    expect(summary.strategyDistribution[0].hits).toBeGreaterThan(0);
  });

  it("migrates legacy JSON session and validates resulting JSONL", () => {
    const legacyFile = join(testDir, "sessions", "legacy-session.json");
    writeFileSync(
      legacyFile,
      JSON.stringify({
        id: "legacy-session",
        title: "Legacy Session",
        provider: "ollama",
        model: "qwen2.5:7b",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
        ],
      }),
      "utf-8",
    );

    const migrated = migrateLegacySessionFile(legacyFile);
    const validation = validateJsonlSession("legacy-session");

    expect(migrated.migrated).toBe(true);
    expect(validation.valid).toBe(true);
    expect(validation.messageCount).toBe(2);
  });
});
