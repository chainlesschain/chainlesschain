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

function installFullFakeFs() {
  const files = new Map();
  const appended = new Map();
  _deps.existsSync = vi.fn((p) => files.has(p));
  _deps.readFileSync = vi.fn((p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    return files.get(p);
  });
  _deps.writeFileSync = vi.fn((p, content) => {
    files.set(p, content);
  });
  _deps.mkdirSync = vi.fn(() => {});
  _deps.appendFileSync = vi.fn((p, content) => {
    appended.set(p, (appended.get(p) || "") + content);
    files.set(p, (files.get(p) || "") + content);
  });
  _deps.now = vi.fn(() => new Date("2026-04-15T00:00:00Z"));
  return { files, appended };
}

function mkStats({
  templateId = "t1",
  runs = 15,
  successRate = 0.5,
  templateName = "T",
} = {}) {
  return {
    templateId,
    templateName,
    runs,
    successes: Math.round(runs * successRate),
    failures: runs - Math.round(runs * successRate),
    successRate,
    avgTokens: 100,
    avgIterations: 2,
    topTools: [],
    lastRunAt: null,
  };
}

function mkFailureEntry({
  templateId = "t1",
  failureCount = 5,
  summaries = [],
} = {}) {
  return {
    templateId,
    templateName: "T",
    failureCount,
    commonSummaries: summaries.length
      ? summaries
      : [{ summary: "timeout error occurred", count: failureCount }],
    examples: [],
  };
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

describe("N2: buildPatchForTemplate", () => {
  it("returns null below MIN_RUNS_FOR_PATCH", () => {
    const stats = mkStats({ runs: MIN_RUNS_FOR_PATCH - 1 });
    const failures = mkFailureEntry({ failureCount: 5 });
    expect(buildPatchForTemplate(stats, failures)).toBeNull();
  });

  it("returns null below MIN_FAILURES_FOR_PATCH", () => {
    const stats = mkStats({ runs: 20 });
    const failures = mkFailureEntry({
      failureCount: MIN_FAILURES_FOR_PATCH - 1,
    });
    expect(buildPatchForTemplate(stats, failures)).toBeNull();
  });

  it("returns null when either argument is missing", () => {
    expect(buildPatchForTemplate(null, mkFailureEntry())).toBeNull();
    expect(buildPatchForTemplate(mkStats(), null)).toBeNull();
  });

  it("returns shaped patch above thresholds", () => {
    const stats = mkStats({ runs: 15, successRate: 0.6 });
    const failures = mkFailureEntry({ failureCount: 6 });
    const patch = buildPatchForTemplate(stats, failures);
    expect(patch).not.toBeNull();
    expect(patch.templateId).toBe("t1");
    expect(patch.runs).toBe(15);
    expect(patch.failures).toBe(6);
    expect(patch.failureRate).toBe(0.4);
    expect(typeof patch.patch).toBe("string");
    expect(patch.patch.length).toBeGreaterThan(0);
    expect(Array.isArray(patch.hints)).toBe(true);
    expect(patch.sampleSummaries.length).toBeGreaterThan(0);
  });

  it("classifies confidence: high when runs≥30 and rate≥0.4", () => {
    const stats = mkStats({ runs: 30, successRate: 0.5 });
    const failures = mkFailureEntry({ failureCount: 15 });
    expect(buildPatchForTemplate(stats, failures).confidence).toBe("high");
  });

  it("classifies confidence: medium when runs≥20 and rate≥0.25", () => {
    const stats = mkStats({ runs: 20, successRate: 0.7 });
    const failures = mkFailureEntry({ failureCount: 6 });
    expect(buildPatchForTemplate(stats, failures).confidence).toBe("medium");
  });

  it("classifies confidence: low otherwise", () => {
    const stats = mkStats({ runs: 15, successRate: 0.8 });
    const failures = mkFailureEntry({ failureCount: 3 });
    expect(buildPatchForTemplate(stats, failures).confidence).toBe("low");
  });
});

describe("N2: suggestPromptPatch", () => {
  it("returns [] for empty history", () => {
    expect(suggestPromptPatch([])).toEqual([]);
  });

  it("returns [] when no template qualifies", () => {
    const history = [
      rec({ templateId: "a", status: "completed" }),
      rec({ templateId: "a", status: "failed", result: { summary: "oops" } }),
    ];
    expect(suggestPromptPatch(history)).toEqual([]);
  });

  it("returns sorted patches high→low confidence", () => {
    const history = [];
    for (let i = 0; i < 30; i++) {
      history.push(
        rec({
          templateId: "hi",
          status: i < 15 ? "completed" : "failed",
          result: { summary: "timeout occurred repeatedly" },
        }),
      );
    }
    for (let i = 0; i < 20; i++) {
      history.push(
        rec({
          templateId: "med",
          status: i < 14 ? "completed" : "failed",
          result: { summary: "parse error found" },
        }),
      );
    }
    const out = suggestPromptPatch(history);
    expect(out.length).toBe(2);
    expect(out[0].templateId).toBe("hi");
    expect(out[0].confidence).toBe("high");
    expect(out[1].confidence).toBe("medium");
  });
});

describe("N2: loadUserTemplate", () => {
  it("returns null when file missing", () => {
    installFullFakeFs();
    expect(loadUserTemplate("/proj", "tpl-a")).toBeNull();
  });

  it("returns parsed JSON when present", () => {
    const { files } = installFullFakeFs();
    const doc = { templateId: "tpl-a", systemPromptExtension: "hi" };
    const file = require("path").join(
      "/proj",
      ".chainlesschain",
      "cowork",
      "user-templates",
      "tpl-a.json",
    );
    files.set(file, JSON.stringify(doc));
    const loaded = loadUserTemplate("/proj", "tpl-a");
    expect(loaded).toEqual(doc);
  });

  it("returns null on invalid JSON", () => {
    const { files } = installFullFakeFs();
    const file = require("path").join(
      "/proj",
      ".chainlesschain",
      "cowork",
      "user-templates",
      "bad.json",
    );
    files.set(file, "{not json");
    expect(loadUserTemplate("/proj", "bad")).toBeNull();
  });
});

describe("N2: applyPromptPatch", () => {
  it("throws when patch lacks templateId", () => {
    installFullFakeFs();
    expect(() => applyPromptPatch("/proj", {})).toThrow(/templateId/);
  });

  it("writes user-template JSON and appends audit log", () => {
    const { files, appended } = installFullFakeFs();
    const patch = {
      templateId: "tpl-a",
      templateName: "T A",
      runs: 15,
      failures: 6,
      confidence: "medium",
      patch: "Double-check assumptions.",
    };
    const out = applyPromptPatch("/proj", patch);
    expect(out.templateId).toBe("tpl-a");
    expect(out.systemPromptExtension).toBe("Double-check assumptions.");
    expect(_deps.writeFileSync).toHaveBeenCalled();
    expect(_deps.mkdirSync).toHaveBeenCalled();
    expect(_deps.appendFileSync).toHaveBeenCalled();
    // audit log contains the record
    const logPaths = [...appended.keys()];
    expect(logPaths.some((p) => p.endsWith("learning-patches.jsonl"))).toBe(
      true,
    );
    const written = [...files.entries()].find(([k]) =>
      k.endsWith("tpl-a.json"),
    );
    expect(written).toBeDefined();
    const doc = JSON.parse(written[1]);
    expect(doc.templateId).toBe("tpl-a");
    expect(doc.systemPromptExtension).toBe("Double-check assumptions.");
    expect(doc.updatedAt).toBe("2026-04-15T00:00:00.000Z");
  });

  it("concatenates existing systemPromptExtension", () => {
    const { files } = installFullFakeFs();
    const existingPath = [
      ...["proj", ".chainlesschain", "cowork", "user-templates", "tpl-a.json"],
    ].join(require("path").sep);
    // seed an existing user-template
    files.set(
      require("path").join(
        "/proj",
        ".chainlesschain",
        "cowork",
        "user-templates",
        "tpl-a.json",
      ),
      JSON.stringify({
        templateId: "tpl-a",
        systemPromptExtension: "Old guidance.",
      }),
    );
    const out = applyPromptPatch("/proj", {
      templateId: "tpl-a",
      patch: "New guidance.",
      confidence: "low",
      runs: 10,
      failures: 3,
    });
    expect(out.systemPromptExtension).toBe("Old guidance.\n\nNew guidance.");
  });
});
