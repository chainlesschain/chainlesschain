import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadHistory,
  computeTemplateStats,
  recommendTemplate,
  summarizeFailures,
  suggestPromptPatch,
  buildPatchForTemplate,
  applyPromptPatch,
  loadUserTemplate,
  MIN_RUNS_FOR_PATCH,
  MIN_FAILURES_FOR_PATCH,
  _deps,
} from "../../src/lib/cowork-learning.js";

function installFakeFs(fileContent) {
  const files = new Map();
  if (fileContent !== undefined) {
    files.set("__HIST__", fileContent);
  }
  _deps.existsSync = vi.fn(() => files.has("__HIST__"));
  _deps.readFileSync = vi.fn(() => files.get("__HIST__") ?? "");
  return files;
}

function rec(overrides = {}) {
  return {
    taskId: "t1",
    status: "completed",
    templateId: "tpl-a",
    templateName: "Template A",
    userMessage: "hello world",
    timestamp: "2026-04-14T12:00:00Z",
    result: {
      summary: "ok",
      tokenCount: 100,
      iterationCount: 2,
      toolsUsed: ["read_file"],
      artifacts: [],
    },
    ...overrides,
  };
}

describe("loadHistory", () => {
  it("returns [] when file missing", () => {
    installFakeFs(undefined);
    expect(loadHistory("/project")).toEqual([]);
  });

  it("parses JSONL and skips malformed lines", () => {
    const content =
      JSON.stringify(rec({ taskId: "a" })) +
      "\n{not json}\n\n" +
      JSON.stringify(rec({ taskId: "b" })) +
      "\n";
    installFakeFs(content);
    const out = loadHistory("/project");
    expect(out).toHaveLength(2);
    expect(out[0].taskId).toBe("a");
    expect(out[1].taskId).toBe("b");
  });
});

describe("computeTemplateStats", () => {
  it("aggregates runs/successes/failures/avg/topTools/lastRunAt", () => {
    const history = [
      rec({
        templateId: "a",
        status: "completed",
        timestamp: "2026-04-10T00:00:00Z",
        result: {
          tokenCount: 100,
          iterationCount: 2,
          toolsUsed: ["read", "write"],
        },
      }),
      rec({
        templateId: "a",
        status: "failed",
        timestamp: "2026-04-12T00:00:00Z",
        result: { tokenCount: 200, iterationCount: 4, toolsUsed: ["read"] },
      }),
      rec({
        templateId: "b",
        status: "completed",
        timestamp: "2026-04-11T00:00:00Z",
        result: { tokenCount: 50, iterationCount: 1, toolsUsed: ["grep"] },
      }),
    ];
    const stats = computeTemplateStats(history);
    expect(stats).toHaveLength(2);
    const a = stats.find((s) => s.templateId === "a");
    expect(a.runs).toBe(2);
    expect(a.successes).toBe(1);
    expect(a.failures).toBe(1);
    expect(a.successRate).toBe(0.5);
    expect(a.avgTokens).toBe(150);
    expect(a.avgIterations).toBe(3);
    expect(a.topTools[0]).toEqual({ tool: "read", count: 2 });
    expect(a.lastRunAt).toBe("2026-04-12T00:00:00Z");
  });

  it("sorts by runs desc then successRate desc", () => {
    const history = [
      rec({ templateId: "a", status: "completed" }),
      rec({ templateId: "b", status: "completed" }),
      rec({ templateId: "b", status: "completed" }),
    ];
    const stats = computeTemplateStats(history);
    expect(stats[0].templateId).toBe("b");
  });

  it("returns [] for empty history", () => {
    expect(computeTemplateStats([])).toEqual([]);
  });
});

describe("recommendTemplate", () => {
  it("returns null for empty query", () => {
    expect(recommendTemplate("", [])).toBeNull();
  });

  it("picks template with highest overlap × successRate", () => {
    const history = [
      rec({
        templateId: "doc",
        status: "completed",
        userMessage: "write documentation for API",
      }),
      rec({
        templateId: "doc",
        status: "completed",
        userMessage: "API documentation update",
      }),
      rec({
        templateId: "code",
        status: "completed",
        userMessage: "refactor the parser",
      }),
    ];
    const out = recommendTemplate("write API documentation", history);
    expect(out).not.toBeNull();
    expect(out.templateId).toBe("doc");
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it("honors minRuns filter", () => {
    const history = [
      rec({ templateId: "rare", status: "completed", userMessage: "foo bar" }),
    ];
    expect(recommendTemplate("foo", history, { minRuns: 5 })).toBeNull();
  });

  it("supports unicode/CJK tokens", () => {
    const history = [
      rec({
        templateId: "zh",
        status: "completed",
        userMessage: "生成周报 文档",
      }),
    ];
    const out = recommendTemplate("生成周报", history);
    expect(out?.templateId).toBe("zh");
  });

  it("returns null when no tokens overlap", () => {
    const history = [
      rec({ templateId: "a", status: "completed", userMessage: "alpha beta" }),
    ];
    expect(recommendTemplate("xyz qqq", history)).toBeNull();
  });
});

describe("summarizeFailures", () => {
  it("groups failures by template, ranks by failureCount", () => {
    const history = [
      rec({ templateId: "a", status: "completed" }),
      rec({
        templateId: "a",
        status: "failed",
        result: { summary: "timeout" },
      }),
      rec({
        templateId: "b",
        status: "failed",
        result: { summary: "parse error" },
      }),
      rec({
        templateId: "b",
        status: "failed",
        result: { summary: "parse error" },
      }),
    ];
    const out = summarizeFailures(history);
    expect(out[0].templateId).toBe("b");
    expect(out[0].failureCount).toBe(2);
    expect(out[0].commonSummaries[0]).toEqual({
      summary: "parse error",
      count: 2,
    });
    expect(out[1].failureCount).toBe(1);
  });

  it("respects examples limit", () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      rec({
        taskId: `t${i}`,
        status: "failed",
        result: { summary: `err${i}` },
      }),
    );
    const out = summarizeFailures(history, { limit: 2 });
    expect(out[0].examples).toHaveLength(2);
    expect(out[0].failureCount).toBe(10);
  });

  it("returns [] when no failures", () => {
    const history = [rec({ status: "completed" })];
    expect(summarizeFailures(history)).toEqual([]);
  });
});
