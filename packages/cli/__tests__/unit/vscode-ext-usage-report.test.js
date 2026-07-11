import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_MAX_ROWS,
  CACHE_MISS_MAX_READ_RATIO,
  CACHE_MISS_MIN_INPUT_TOKENS,
  LONG_CONTEXT_AVG_INPUT_TOKENS,
  SUBAGENT_SHARE_HINT_THRESHOLD,
  buildSessionListArgs,
  buildUsageArgs,
  deriveUsageHints,
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

// ── Usage attribution (用量归因) — additive `attribution` section ──────────

/** Exact render of usageFixture()+sessionsFixture() BEFORE the attribution
 *  feature landed (captured from the pre-change usage-report.js). An
 *  attribution-less payload (old CLI) must keep producing this byte-for-byte. */
const PRE_ATTRIBUTION_SNAPSHOT = [
  "# ChainlessChain — Token Usage",
  "",
  "**All time:** 1,500 tokens · in 1,000 / out 500 · 12 LLM calls · 4 sessions · 1 unreadable session(s) skipped",
  "",
  "## Activity windows",
  "",
  "Windows bucket by each session's LAST activity time (the usage store has",
  "no per-event timestamps), so a long-running session counts wholly toward",
  "its most recent window — treat these as approximations.",
  "",
  "| Window | Tokens | LLM calls | Sessions |",
  "| --- | ---: | ---: | ---: |",
  "| Last 24 h | 600 | 5 | 1 |",
  "| Last 7 days | 1,000 | 9 | 2 |",
  "| Last 30 days | 1,000 | 9 | 2 |",
  "",
  "## By provider / model",
  "",
  "| Provider | Model | Tokens | In | Out | Calls |",
  "| --- | --- | ---: | ---: | ---: | ---: |",
  "| volcengine | doubao-pro | 1,350 | 900 | 450 | 10 |",
  "",
  "## Top sessions",
  "",
  "| Session | Title | Last activity | Tokens | Calls |",
  "| --- | --- | --- | ---: | ---: |",
  "| `s-recent` | Fix tests | 2026-07-10T10:00:00.000Z | 600 | 5 |",
  "| `s-week` | Refactor \\| pipes | 2026-07-07T12:00:00.000Z | 400 | 4 |",
  "| `s-old` |  | 2026-05-31T12:00:00.000Z | 300 | 2 |",
  "| `s-unknown` |  | ? | 200 | 1 |",
  "",
  "_Per-skill / per-subagent / per-plugin attribution needs CLI-side event tagging (not recorded yet)._",
  "",
].join("\n");

function attributionFixture() {
  return {
    byOrigin: [
      {
        origin: "subagent",
        inputTokens: 70000,
        outputTokens: 4000,
        totalTokens: 74000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 3,
      },
      {
        origin: "main",
        inputTokens: 50000,
        outputTokens: 4000,
        totalTokens: 54000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 8,
      },
      {
        origin: "skill",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        calls: 1,
      },
    ],
    bySkill: [
      {
        skill: "csv-clean",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        calls: 1,
      },
    ],
    bySubagent: [
      {
        subagentId: "sub-1",
        role: "researcher",
        origin: "subagent",
        inputTokens: 70000,
        outputTokens: 4000,
        totalTokens: 74000,
        calls: 3,
      },
    ],
    tools: {
      totalCalls: 7,
      totalErrors: 2,
      byTool: [
        {
          tool: "read_file",
          mcpServer: null,
          calls: 4,
          errors: 1,
          turnTokens: 600,
        },
        {
          tool: "mcp__github__search",
          mcpServer: "github",
          calls: 3,
          errors: 1,
          turnTokens: 150,
        },
      ],
      byMcpServer: [{ server: "github", calls: 3, errors: 1, turnTokens: 150 }],
    },
  };
}

/** usageFixture with cache-reporting totals + an attribution section. */
function attributedUsageFixture() {
  const u = usageFixture();
  u.total = {
    inputTokens: 120000,
    outputTokens: 8000,
    totalTokens: 128000,
    cacheReadTokens: 2000,
    cacheCreationTokens: 5000,
    calls: 2, // avg input/call 60k → above the long-context threshold
  };
  u.attribution = attributionFixture();
  return u;
}

function summarize(usage) {
  return summarizeUsage({ usage, sessions: sessionsFixture(), now: NOW });
}

describe("attribution parsing (additive section)", () => {
  it("absent attribution → summary.attribution is null (old CLI)", () => {
    expect(summarize(usageFixture()).attribution).toBeNull();
  });

  it("malformed attribution → null, no throw", () => {
    const u = usageFixture();
    u.attribution = "garbage";
    expect(summarize(u).attribution).toBeNull();
  });

  it("normalizes present attribution and drops junk rows", () => {
    const u = attributedUsageFixture();
    u.attribution.byOrigin.push(null, "junk");
    u.attribution.tools.byTool.push(42);
    const a = summarize(u).attribution;
    expect(a.byOrigin).toHaveLength(3);
    expect(a.bySkill[0].skill).toBe("csv-clean");
    expect(a.bySubagent[0].subagentId).toBe("sub-1");
    expect(a.tools).toMatchObject({ totalCalls: 7, totalErrors: 2 });
    expect(a.tools.byTool).toHaveLength(2);
    expect(a.tools.byMcpServer).toHaveLength(1);
  });

  it("survives a JSON round-trip through parseUsageJson", () => {
    const parsed = parseUsageJson(JSON.stringify(attributedUsageFixture()));
    expect(summarize(parsed).attribution.byOrigin[0].origin).toBe("subagent");
  });
});

describe("attribution absent → byte-identical legacy output", () => {
  it("old-CLI payload renders exactly the pre-change snapshot", () => {
    const md = usageToMarkdown(summarize(usageFixture()));
    expect(md).toBe(PRE_ATTRIBUTION_SNAPSHOT);
  });
});

describe("attribution rendering", () => {
  const md = usageToMarkdown(summarize(attributedUsageFixture()));

  it("renders By origin with share percentages", () => {
    expect(md).toContain("## By origin");
    expect(md).toContain("| subagent | 74,000 | 57.8% | 70,000 | 4,000 | 3 |");
    expect(md).toContain("| main | 54,000 | 42.2% | 50,000 | 4,000 | 8 |");
  });

  it("renders By skill and By subagent tables", () => {
    expect(md).toContain("## By skill");
    expect(md).toContain("| csv-clean | 15 | 10 | 5 | 1 |");
    expect(md).toContain("## By subagent");
    expect(md).toContain("| sub-1 | researcher | subagent | 74,000 | 3 |");
  });

  it("renders Tool calls with MCP server buckets and the non-summable caveat", () => {
    expect(md).toContain("## Tool calls");
    expect(md).toContain("**7 calls · 2 errors** across 2 tool(s).");
    expect(md).toContain("| read_file |  | 4 | 1 | 600 |");
    expect(md).toContain("| mcp__github__search | github | 3 | 1 | 150 |");
    expect(md).toContain("### MCP servers");
    expect(md).toContain("| github | 3 | 1 | 150 |");
    expect(md).toContain("do not sum that column across rows");
    expect(md).toContain("approximation");
  });

  it("drops the stale 'needs CLI-side event tagging' footer when attribution is rendered", () => {
    expect(md).not.toContain("needs CLI-side event tagging");
  });

  it("renders empty-state placeholders when attribution arrays are empty", () => {
    const u = attributedUsageFixture();
    u.attribution = { byOrigin: [], bySkill: [], bySubagent: [], tools: {} };
    const empty = usageToMarkdown(summarize(u));
    expect(empty).toContain("_No attributed token_usage events recorded._");
    expect(empty).toContain(
      "_No skill-attributed usage (isolated skill runs) recorded._",
    );
    expect(empty).toContain("_No sub-agent-attributed usage recorded._");
    expect(empty).toContain("_No tool_call events recorded._");
  });

  it("caps long tables at ATTRIBUTION_MAX_ROWS and folds the rest into an 'others' row", () => {
    const u = attributedUsageFixture();
    u.attribution.bySkill = Array.from(
      { length: ATTRIBUTION_MAX_ROWS + 2 },
      (_, i) => ({
        skill: `skill-${i}`,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        calls: 1,
      }),
    );
    u.attribution.tools.byTool = Array.from(
      { length: ATTRIBUTION_MAX_ROWS + 3 },
      (_, i) => ({
        tool: `tool-${i}`,
        mcpServer: null,
        calls: 2,
        errors: 1,
        turnTokens: 50,
      }),
    );
    const capped = usageToMarkdown(summarize(u));
    expect(capped).toContain(`| skill-${ATTRIBUTION_MAX_ROWS - 1} |`);
    expect(capped).not.toContain(`| skill-${ATTRIBUTION_MAX_ROWS} |`);
    // skills others row: 2 folded rows, columns summed.
    expect(capped).toContain("| _…2 more_ | 30 | 20 | 10 | 2 |");
    // tools others row: calls/errors summed, turnTokens NEVER summed (—).
    expect(capped).toContain(`| tool-${ATTRIBUTION_MAX_ROWS - 1} |`);
    expect(capped).not.toContain(`| tool-${ATTRIBUTION_MAX_ROWS} |`);
    expect(capped).toContain("| _…3 more_ | | 6 | 3 | — |");
  });

  it("escapes hostile skill/tool/subagent names (pipes, backticks, newlines)", () => {
    const u = attributedUsageFixture();
    u.attribution.bySkill[0].skill = "evil|skill`\nnext";
    u.attribution.tools.byTool[0].tool = "bad|tool";
    u.attribution.bySubagent[0].subagentId = "sub|1";
    const hostile = usageToMarkdown(summarize(u));
    expect(hostile).toContain("evil\\|skill\\` next");
    expect(hostile).toContain("| bad\\|tool |");
    expect(hostile).toContain("| sub\\|1 |");
    // no raw newline smuggled into a table row
    expect(hostile).not.toContain("evil|skill");
  });
});

describe("deriveUsageHints", () => {
  it("returns [] without an attribution section (old CLI — no hints, no guessing)", () => {
    expect(deriveUsageHints(summarize(usageFixture()))).toEqual([]);
    expect(deriveUsageHints(null)).toEqual([]);
  });

  it("subagent-heavy fires above the share threshold and not at/below it", () => {
    const mk = (subTokens, mainTokens) => {
      const u = attributedUsageFixture();
      // keep only cache/long-context-quiet totals so ONLY this hint can fire
      u.total = {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        calls: 12,
      };
      u.attribution = {
        byOrigin: [
          {
            origin: "subagent",
            totalTokens: subTokens,
            inputTokens: 0,
            outputTokens: 0,
            calls: 1,
          },
          {
            origin: "main",
            totalTokens: mainTokens,
            inputTokens: 0,
            outputTokens: 0,
            calls: 1,
          },
        ],
        bySkill: [],
        bySubagent: [],
        tools: {},
      };
      return deriveUsageHints(summarize(u));
    };
    // exactly at threshold (40 of 100) → strict > → no hint
    expect(SUBAGENT_SHARE_HINT_THRESHOLD).toBe(0.4); // keeps 40/100 a true boundary probe
    expect(mk(40, 60)).toEqual([]);
    const fired = mk(41, 59);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain("Sub-agent-heavy: 41%");
    expect(fired[0]).toContain("41 of 100");
  });

  it("cache-miss fires only when cache fields exist, input is large enough, and reads are low", () => {
    const mk = (total) => {
      const u = attributedUsageFixture();
      u.total = total;
      u.attribution = { byOrigin: [], bySkill: [], bySubagent: [], tools: {} };
      return deriveUsageHints(summarize(u));
    };
    const input = CACHE_MISS_MIN_INPUT_TOKENS;
    const lowRead = Math.floor(CACHE_MISS_MAX_READ_RATIO * input) - 1;
    // fires: cache fields present, big input, low reads
    const fired = mk({
      inputTokens: input,
      outputTokens: 0,
      totalTokens: input,
      cacheReadTokens: lowRead,
      cacheCreationTokens: 100,
      calls: 1000,
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain("High cache-miss");
    expect(fired[0]).toContain(`${lowRead.toLocaleString("en-US")} cache-read`);
    // no cache fields at all (old provider) → silent
    expect(
      mk({
        inputTokens: input,
        outputTokens: 0,
        totalTokens: input,
        calls: 1000,
      }),
    ).toEqual([]);
    // cache reported but reads at the ratio → silent
    expect(
      mk({
        inputTokens: input,
        outputTokens: 0,
        totalTokens: input,
        cacheReadTokens: CACHE_MISS_MAX_READ_RATIO * input,
        cacheCreationTokens: 100,
        calls: 1000,
      }),
    ).toEqual([]);
    // input below the floor → silent
    expect(
      mk({
        inputTokens: CACHE_MISS_MIN_INPUT_TOKENS - 1,
        outputTokens: 0,
        totalTokens: CACHE_MISS_MIN_INPUT_TOKENS - 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 100,
        calls: 1000,
      }),
    ).toEqual([]);
  });

  it("long-context fires above the avg-input threshold and not at it", () => {
    const mk = (inputTokens, calls) => {
      const u = attributedUsageFixture();
      u.total = {
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        calls,
      };
      u.attribution = { byOrigin: [], bySkill: [], bySubagent: [], tools: {} };
      return deriveUsageHints(summarize(u));
    };
    expect(mk(LONG_CONTEXT_AVG_INPUT_TOKENS * 2, 2)).toEqual([]); // avg == threshold
    const fired = mk(LONG_CONTEXT_AVG_INPUT_TOKENS * 2 + 2, 2);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain("Long-context");
    expect(fired[0]).toContain(
      (LONG_CONTEXT_AVG_INPUT_TOKENS + 1).toLocaleString("en-US"),
    );
  });

  it("all three hints render into the markdown Hints section", () => {
    const md = usageToMarkdown(summarize(attributedUsageFixture()));
    expect(md).toContain("## Hints");
    expect(md).toContain("- Sub-agent-heavy: 58%");
    expect(md).toContain("- High cache-miss: only 2,000 cache-read");
    expect(md).toContain(
      "- Long-context: average input per LLM call is 60,000",
    );
  });
});
