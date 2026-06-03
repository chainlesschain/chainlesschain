import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-inject-"));
  vi.resetModules();
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
  }));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
});

describe("memory-injection.recallStartupMemories", () => {
  it("pulls global and agent-scoped memories and dedupes", async () => {
    const { getMemoryStore } =
      await import("../../src/lib/session-core-singletons.js");
    const store = getMemoryStore();
    store.add({ scope: "global", content: "Prefers TypeScript" });
    store.add({
      scope: "agent",
      scopeId: "coder",
      content: "Uses pnpm for this repo",
    });
    store.add({ scope: "agent", scopeId: "other-agent", content: "noise" });

    const { recallStartupMemories } =
      await import("../../src/lib/memory-injection.js");
    const results = recallStartupMemories({ agentId: "coder", limit: 10 });
    const contents = results.map((m) => m.content);
    expect(contents).toContain("Prefers TypeScript");
    expect(contents).toContain("Uses pnpm for this repo");
    expect(contents).not.toContain("noise");
  });

  it("returns [] when the store is empty", async () => {
    const { recallStartupMemories } =
      await import("../../src/lib/memory-injection.js");
    expect(recallStartupMemories({ agentId: "x" })).toEqual([]);
  });

  it("respects limit", async () => {
    const { getMemoryStore } =
      await import("../../src/lib/session-core-singletons.js");
    const store = getMemoryStore();
    for (let i = 0; i < 20; i++) {
      store.add({ scope: "global", content: `item ${i}`, score: i });
    }
    const { recallStartupMemories } =
      await import("../../src/lib/memory-injection.js");
    const results = recallStartupMemories({ limit: 5 });
    expect(results).toHaveLength(5);
  });
});

describe("memory-injection.formatMemoriesAsSystemPrompt", () => {
  it("returns null when memories is empty", async () => {
    const { formatMemoriesAsSystemPrompt } =
      await import("../../src/lib/memory-injection.js");
    expect(formatMemoriesAsSystemPrompt([])).toBeNull();
    expect(formatMemoriesAsSystemPrompt(null)).toBeNull();
  });

  it("formats memories as bullet list with scope tags", async () => {
    const { formatMemoriesAsSystemPrompt } =
      await import("../../src/lib/memory-injection.js");
    const text = formatMemoriesAsSystemPrompt([
      { id: "1", scope: "global", category: "preference", content: "alpha" },
      {
        id: "2",
        scope: "agent",
        scopeId: "coder-0001",
        category: "task",
        content: "beta",
      },
    ]);
    expect(text).toContain("Relevant memory");
    expect(text).toContain("(global) [preference] alpha");
    expect(text).toContain("(agent:coder-0001) [task] beta");
  });
});

describe("memory-injection.buildMemoryInjection", () => {
  it("returns null when no memories exist", async () => {
    const { buildMemoryInjection } =
      await import("../../src/lib/memory-injection.js");
    expect(buildMemoryInjection({ agentId: "x" })).toBeNull();
  });

  it("produces a system-role message when memories exist", async () => {
    const { getMemoryStore } =
      await import("../../src/lib/session-core-singletons.js");
    getMemoryStore().add({ scope: "global", content: "Likes Vite" });

    const { buildMemoryInjection } =
      await import("../../src/lib/memory-injection.js");
    const msg = buildMemoryInjection({ agentId: null });
    expect(msg).not.toBeNull();
    expect(msg.role).toBe("system");
    expect(msg.count).toBe(1);
    expect(msg.content).toContain("Likes Vite");
  });
});
