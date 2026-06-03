import { describe, it, expect, vi } from "vitest";
import {
  aggregate,
  _computeNextTriggers,
  _deps,
} from "../../src/lib/cowork-observe.js";
import { _deps as learningDeps } from "../../src/lib/cowork-learning.js";
import { _deps as cronDeps } from "../../src/lib/cowork-cron.js";
import { buildHtml } from "../../src/lib/cowork-observe-html.js";

function installFs({
  history = "",
  schedules = "",
  workflowHistory = "",
} = {}) {
  const files = new Map();
  if (history) {
    files.set("__history__", history);
  }
  if (schedules) {
    files.set("__schedules__", schedules);
  }
  if (workflowHistory) {
    files.set("__wfhist__", workflowHistory);
  }
  const existsImpl = (p) => {
    if (p.endsWith("history.jsonl") && !p.includes("workflow"))
      return files.has("__history__");
    if (p.endsWith("workflow-history.jsonl")) return files.has("__wfhist__");
    if (p.endsWith("schedules.jsonl")) return files.has("__schedules__");
    return false;
  };
  const readImpl = (p) => {
    if (p.endsWith("workflow-history.jsonl"))
      return files.get("__wfhist__") || "";
    if (p.endsWith("history.jsonl")) return files.get("__history__") || "";
    if (p.endsWith("schedules.jsonl")) return files.get("__schedules__") || "";
    throw new Error(`ENOENT: ${p}`);
  };
  _deps.existsSync = vi.fn(existsImpl);
  _deps.readFileSync = vi.fn(readImpl);
  learningDeps.existsSync = vi.fn(existsImpl);
  learningDeps.readFileSync = vi.fn(readImpl);
  cronDeps.existsSync = vi.fn(existsImpl);
  cronDeps.readFileSync = vi.fn(readImpl);
}

function rec(overrides = {}) {
  return JSON.stringify({
    taskId: "t1",
    status: "completed",
    templateId: "tpl-a",
    templateName: "Template A",
    userMessage: "hello",
    timestamp: "2026-04-14T12:00:00Z",
    result: {
      summary: "ok",
      tokenCount: 100,
      iterationCount: 2,
      toolsUsed: [],
    },
    ...overrides,
  });
}

describe("aggregate", () => {
  it("returns empty-ish snapshot for empty history", () => {
    installFs();
    _deps.now = () => new Date("2026-04-15T00:00:00Z");
    const out = aggregate("/proj");
    expect(out.tasks.total).toBe(0);
    expect(out.tasks.successRate).toBe(0);
    expect(out.templates).toEqual([]);
    expect(out.failures).toEqual([]);
    expect(out.workflows).toEqual([]);
    expect(out.schedules.active).toBe(0);
    expect(out.schedules.nextTriggers).toEqual([]);
    expect(out.window.days).toBe(7);
  });

  it("filters history by windowDays", () => {
    _deps.now = () => new Date("2026-04-15T00:00:00Z");
    const h =
      rec({ taskId: "recent", timestamp: "2026-04-14T00:00:00Z" }) +
      "\n" +
      rec({ taskId: "old", timestamp: "2026-04-01T00:00:00Z" }) +
      "\n";
    installFs({ history: h });
    const out = aggregate("/proj", { windowDays: 7 });
    expect(out.tasks.total).toBe(1);
  });

  it("computes successRate and avgTokens", () => {
    _deps.now = () => new Date("2026-04-15T00:00:00Z");
    const h =
      rec({
        taskId: "1",
        status: "completed",
        result: { tokenCount: 100, toolsUsed: [] },
      }) +
      "\n" +
      rec({
        taskId: "2",
        status: "failed",
        result: { tokenCount: 200, toolsUsed: [] },
      }) +
      "\n" +
      rec({
        taskId: "3",
        status: "completed",
        result: { tokenCount: 0, toolsUsed: [] },
      }) +
      "\n";
    installFs({ history: h });
    const out = aggregate("/proj");
    expect(out.tasks.total).toBe(3);
    expect(out.tasks.completed).toBe(2);
    expect(out.tasks.failed).toBe(1);
    expect(out.tasks.successRate).toBeCloseTo(2 / 3, 3);
    // Only records with tokenCount > 0 contribute
    expect(out.tasks.avgTokens).toBe(150);
  });

  it("templates sorted by runs desc (from computeTemplateStats)", () => {
    _deps.now = () => new Date("2026-04-15T00:00:00Z");
    const h =
      rec({ templateId: "a" }) +
      "\n" +
      rec({ templateId: "b" }) +
      "\n" +
      rec({ templateId: "b" }) +
      "\n";
    installFs({ history: h });
    const out = aggregate("/proj");
    expect(out.templates[0].templateId).toBe("b");
  });

  it("failures group and rank", () => {
    _deps.now = () => new Date("2026-04-15T00:00:00Z");
    const h =
      rec({
        templateId: "a",
        status: "failed",
        result: { summary: "timeout" },
      }) +
      "\n" +
      rec({
        templateId: "a",
        status: "failed",
        result: { summary: "timeout" },
      }) +
      "\n" +
      rec({ templateId: "b", status: "failed", result: { summary: "oom" } }) +
      "\n";
    installFs({ history: h });
    const out = aggregate("/proj");
    expect(out.failures[0].templateId).toBe("a");
    expect(out.failures[0].failureCount).toBe(2);
  });

  it("workflows loaded and top-10", () => {
    _deps.now = () => new Date("2026-04-15T00:00:00Z");
    const wfLines = Array.from({ length: 15 }, (_, i) =>
      JSON.stringify({
        runId: `wf-${i}`,
        status: "completed",
        startedAt: `2026-04-${10 + (i % 5)}T00:00:00Z`,
      }),
    ).join("\n");
    installFs({ workflowHistory: wfLines });
    const out = aggregate("/proj");
    expect(out.workflows.length).toBeLessThanOrEqual(10);
  });

  it("schedules.active excludes enabled:false", () => {
    _deps.now = () => new Date("2026-04-15T00:00:00Z");
    const s =
      JSON.stringify({ id: "s1", cron: "* * * * *", enabled: true }) +
      "\n" +
      JSON.stringify({ id: "s2", cron: "* * * * *", enabled: false }) +
      "\n";
    installFs({ schedules: s });
    const out = aggregate("/proj");
    expect(out.schedules.active).toBe(1);
  });
});

describe("_computeNextTriggers", () => {
  it("returns [] when no schedules", () => {
    expect(_computeNextTriggers([], new Date(), 5)).toEqual([]);
  });

  it("returns [] when all schedules disabled", () => {
    const out = _computeNextTriggers(
      [{ id: "s1", cron: "*/15 * * * *", enabled: false }],
      new Date("2026-04-15T12:00:00Z"),
      5,
    );
    expect(out).toEqual([]);
  });

  it("finds next 5 */15 fire times", () => {
    const out = _computeNextTriggers(
      [{ id: "s1", cron: "*/15 * * * *", enabled: true }],
      new Date("2026-04-15T12:00:00Z"),
      5,
    );
    expect(out).toHaveLength(5);
    // Each `at` should land on a :00/:15/:30/:45 boundary
    for (const n of out) {
      const d = new Date(n.at);
      expect([0, 15, 30, 45]).toContain(d.getMinutes());
    }
  });

  it("skips invalid cron entries silently", () => {
    const out = _computeNextTriggers(
      [
        { id: "bad", cron: "not a cron", enabled: true },
        { id: "good", cron: "@hourly", enabled: true },
      ],
      new Date("2026-04-15T12:30:00Z"),
      2,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((n) => n.scheduleId === "good")).toBe(true);
  });
});

describe("buildHtml", () => {
  it("includes <meta charset=UTF-8>", () => {
    const html = buildHtml({
      window: { days: 7, from: "a", to: "b" },
      tasks: { total: 0 },
      templates: [],
      failures: [],
      schedules: { active: 0, nextTriggers: [] },
    });
    expect(html).toMatch(/<meta charset="UTF-8">/);
  });

  it("escapes </script> in injected JSON", () => {
    const html = buildHtml({
      window: {},
      tasks: { total: 0 },
      templates: [
        {
          templateId: "x",
          templateName: "</script><img onerror=alert(1)>",
          runs: 1,
          successRate: 1,
          avgTokens: 0,
        },
      ],
      failures: [],
      schedules: { active: 0, nextTriggers: [] },
    });
    // Extract just the injected JSON payload (between "= " and ";</script>")
    const m = html.match(/__COWORK_OBSERVE__ = (.+?);<\/script>/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/<\/script>/);
    expect(m[1]).toMatch(/\\u003c/);
    // Rendered HTML body does not contain an executable img tag
    expect(html).not.toMatch(/<img onerror/);
  });

  it("renders template and failure tables when data present", () => {
    const html = buildHtml({
      window: { days: 7, from: "a", to: "b" },
      tasks: {
        total: 3,
        completed: 2,
        failed: 1,
        successRate: 0.66,
        avgTokens: 100,
      },
      templates: [
        {
          templateId: "a",
          templateName: "A",
          runs: 3,
          successRate: 0.66,
          avgTokens: 100,
        },
      ],
      failures: [
        {
          templateId: "a",
          templateName: "A",
          failureCount: 1,
          commonSummaries: [{ summary: "oops", count: 1 }],
        },
      ],
      schedules: {
        active: 1,
        nextTriggers: [
          {
            at: "2026-04-15T12:00:00Z",
            cron: "*/15 * * * *",
            scheduleId: "s1",
          },
        ],
      },
    });
    expect(html).toMatch(/Templates/);
    expect(html).toMatch(/Failures/);
    expect(html).toMatch(/Next scheduled/);
    expect(html).toMatch(/oops/);
    expect(html).toMatch(/s1/);
  });
});
