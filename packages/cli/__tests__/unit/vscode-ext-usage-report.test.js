import { describe, expect, it } from "vitest";

import {
  buildSessionListArgs,
  buildUsageArgs,
  parseSessionListJson,
  parseUsageJson,
  summarizeUsage,
  usageToMarkdown,
} from "../../../vscode-extension/src/usage-report.js";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function usageFixture() {
  return {
    total: {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      calls: 12,
    },
    skipped: 1,
    sessions: [
      {
        sessionId: "s-recent",
        total: { totalTokens: 600, calls: 5 },
        byModel: [],
      },
      {
        sessionId: "s-week",
        total: { totalTokens: 400, calls: 4 },
        byModel: [],
      },
      {
        sessionId: "s-old",
        total: { totalTokens: 300, calls: 2 },
        byModel: [],
      },
      {
        sessionId: "s-unknown",
        total: { totalTokens: 200, calls: 1 },
        byModel: [],
      },
    ],
    byModel: [
      {
        provider: "volcengine",
        model: "doubao-pro",
        inputTokens: 900,
        outputTokens: 450,
        totalTokens: 1350,
        calls: 10,
      },
    ],
  };
}

function sessionsFixture() {
  return [
    // 2 hours old → in every window.
    {
      id: "s-recent",
      title: "Fix tests",
      updatedAt: "2026-07-10T10:00:00.000Z",
    },
    // 3 days old → 7d + 30d, not 24h.
    {
      id: "s-week",
      title: "Refactor | pipes",
      updatedAt: "2026-07-07T12:00:00.000Z",
    },
    // 40 days old → no window (all-time only).
    { id: "s-old", title: "", updatedAt: "2026-05-31T12:00:00.000Z" },
    // s-unknown intentionally absent — no timestamp.
  ];
}

describe("usage report parsing", () => {
  it("builds the CLI argv", () => {
    expect(buildUsageArgs()).toEqual([
      "session",
      "usage",
      "--json",
      "--limit",
      "1000",
    ]);
    expect(buildSessionListArgs(50)).toEqual([
      "session",
      "list",
      "--json",
      "-n",
      "50",
    ]);
  });

  it("parses tolerantly", () => {
    expect(parseUsageJson("not json")).toBeNull();
    expect(parseUsageJson(JSON.stringify({ nope: 1 }))).toBeNull();
    expect(parseUsageJson(JSON.stringify(usageFixture()))).toMatchObject({
      total: { totalTokens: 1500 },
    });
    expect(parseSessionListJson("nope")).toEqual([]);
    expect(
      parseSessionListJson(
        JSON.stringify([{ id: "a", updated_at: "2026-07-10" }, { bad: 1 }]),
      ),
    ).toEqual([{ id: "a", title: "", updatedAt: "2026-07-10" }]);
  });
});

describe("summarizeUsage windows", () => {
  it("buckets by session last-activity, cumulative windows", () => {
    const s = summarizeUsage({
      usage: usageFixture(),
      sessions: sessionsFixture(),
      now: NOW,
    });
    // 24h: only s-recent.
    expect(s.windows.last24h).toEqual({
      totalTokens: 600,
      calls: 5,
      sessions: 1,
    });
    // 7d: s-recent + s-week (cumulative).
    expect(s.windows.last7d).toEqual({
      totalTokens: 1000,
      calls: 9,
      sessions: 2,
    });
    // 30d: same two (s-old is 40 days out; s-unknown has no timestamp).
    expect(s.windows.last30d).toEqual({
      totalTokens: 1000,
      calls: 9,
      sessions: 2,
    });
    // All-time total is the CLI's own rollup, untouched.
    expect(s.total.totalTokens).toBe(1500);
    expect(s.skipped).toBe(1);
    expect(s.sessionCount).toBe(4);
    // Top sessions sorted by tokens, carrying joined titles.
    expect(s.topSessions.map((x) => x.id)).toEqual([
      "s-recent",
      "s-week",
      "s-old",
      "s-unknown",
    ]);
    expect(s.topSessions[0].title).toBe("Fix tests");
    expect(summarizeUsage({ usage: null })).toBeNull();
  });
});

describe("usageToMarkdown", () => {
  it("renders all sections with escaped table cells", () => {
    const md = usageToMarkdown(
      summarizeUsage({
        usage: usageFixture(),
        sessions: sessionsFixture(),
        now: NOW,
      }),
    );
    expect(md).toContain("# ChainlessChain — Token Usage");
    expect(md).toContain("**All time:** 1,500 tokens");
    expect(md).toContain("| Last 24 h | 600 | 5 | 1 |");
    expect(md).toContain("| volcengine | doubao-pro | 1,350 |");
    // A `|` in a session title must not break the markdown table.
    expect(md).toContain("Refactor \\| pipes");
    expect(md).toContain("per-plugin attribution");
    expect(usageToMarkdown(null)).toBeNull();
  });
});
