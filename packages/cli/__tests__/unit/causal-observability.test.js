import { describe, expect, it } from "vitest";
import {
  buildCausalObservabilityReport,
  causalSessionIds,
  createCausalObservabilityLimitTracker,
  createVerifiedSessionObservabilityProjection,
  nearestRankPercentile,
  normalizeCausalRequest,
  projectVerifiedDelivery,
  projectVerifiedSession,
  selectCausalDeliveries,
} from "../../src/lib/causal-observability.js";
import { createDeliveryFlow } from "../../src/lib/delivery-coordinator.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const HASH = "c".repeat(64);
const DIGEST = `sha256:${"d".repeat(64)}`;
const NOW = "2026-08-12T00:00:00.000Z";
const SCOPE = {
  workspaceId: "workspace-a",
  teamId: "team-a",
  policyId: "policy-a",
};

function modelUsageStarted(callId, overrides = {}) {
  return {
    type: "model_usage_started",
    data: {
      callId,
      provider: "openai",
      model: "gpt-5-mini",
      source: "model",
      ...overrides,
    },
  };
}

function events(extra = []) {
  return [
    {
      type: "session_start",
      timestamp: Date.parse(NOW),
      data: {
        provider: "openai",
        model: "gpt-5-mini",
        observabilityScope: SCOPE,
      },
    },
    {
      type: "token_usage",
      timestamp: Date.parse(NOW) + 1,
      data: {
        provider: "openai",
        model: "gpt-5-mini",
        input_tokens: 1000,
        output_tokens: 500,
      },
    },
    {
      type: "tool_call",
      timestamp: Date.parse(NOW) + 2,
      data: { tool: "read_file", duration_ms: 20, is_error: true },
    },
    {
      type: "tool_call",
      timestamp: Date.parse(NOW) + 3,
      data: { tool: "read_file", duration_ms: 80, is_error: false },
    },
    {
      type: "llm_retry",
      timestamp: Date.parse(NOW) + 4,
      data: {
        provider: "openai",
        model: "gpt-5-mini",
        reason: "rate_limit",
        duration_ms: 25,
      },
    },
    ...extra,
  ];
}

function session(sessionId = "session-a", extra = []) {
  const evs = events(extra);
  return projectVerifiedSession(sessionId, evs, {
    headHash: HASH,
    eventCount: evs.length,
  });
}

function delivery(
  sessionBinding = { sessionId: "session-a", headHash: HASH, eventCount: 5 },
) {
  return projectVerifiedDelivery(
    createDeliveryFlow(
      deliveryInput({
        flowId: "delivery-a",
        causality: { scope: SCOPE, sessions: [sessionBinding] },
      }),
      { now: NOW },
    ),
  );
}

function deliveryInput(overrides = {}) {
  return {
    commitSha: HEAD,
    diff: {
      baseCommitSha: BASE,
      headCommitSha: HEAD,
      digest: DIGEST,
      changedFiles: ["src/secret-name.js"],
    },
    environment: {
      os: "linux",
      arch: "x64",
      runtime: "node",
      runtimeVersion: "22.12.0",
      dependencyDigest: DIGEST,
    },
    requiredGates: [{ id: "cli-ci", always: true, matrix: ["linux"] }],
    analysis: {
      confidence: 1,
      dependencyGraphComplete: true,
      languageServicesComplete: true,
      testHistoryComplete: true,
      classifications: [
        {
          path: "src/secret-name.js",
          language: "javascript",
          ecosystem: "npm",
          confidence: 1,
        },
      ],
    },
    unverified: [],
    sideEffects: [],
    ...overrides,
  };
}

describe("causal observability", () => {
  it("builds a deterministic secret-free graph and enforces budgets", () => {
    const projectedSession = session();
    const report = buildCausalObservabilityReport({
      deliveries: [delivery()],
      sessionsById: new Map([[projectedSession.id, projectedSession]]),
      filter: { workspaceId: "workspace-a" },
      budgets: {
        maxTokens: 1000,
        maxUsd: 10,
        maxRetries: 0,
        maxToolP95Ms: 50,
      },
      generatedAt: NOW,
    });

    expect(report).toMatchObject({
      schema: "chainlesschain.causal-observability-report",
      totals: {
        sessions: 1,
        deliveries: 1,
        totalTokens: 1500,
        llmRetries: 1,
        toolCalls: 2,
        toolRetryCalls: 0,
        toolP95DurationMs: 80,
        toolTimingCoverage: 1,
      },
      budget: { status: "exceeded" },
      authority: {
        assurance: "declared-association-bound-to-verified-inputs",
        evidenceGaps: [],
      },
    });
    expect(report.reportDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.graph.edges).toContainEqual({
      from: "session:session-a",
      to: "delivery:delivery-a",
      relation: "contributed_to",
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("secret-name.js");
    expect(serialized).not.toContain('"args"');
  });

  it("deduplicates one session associated with multiple deliveries", () => {
    const projectedSession = session();
    const second = { ...delivery(), id: "delivery-b" };
    const report = buildCausalObservabilityReport({
      deliveries: [delivery(), second],
      sessionsById: new Map([[projectedSession.id, projectedSession]]),
      generatedAt: NOW,
    });
    expect(report.totals).toMatchObject({
      sessions: 1,
      deliveries: 2,
      totalTokens: 1500,
    });
    expect(report.budget.status).toBe("not_evaluated");
  });

  it("fails a zero-USD hard budget for a real sub-microdollar call", () => {
    const evs = [
      {
        ...events()[0],
        data: {
          ...events()[0].data,
          usageTelemetryProtocol: "call-ledger",
          usageTelemetryVersion: 1,
        },
      },
      modelUsageStarted("tiny-call", { model: "gpt-5-nano" }),
      {
        type: "token_usage",
        data: {
          callId: "tiny-call",
          provider: "openai",
          model: "gpt-5-nano",
          source: "model",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ];
    const projected = projectVerifiedSession("tiny-cost-session", evs, {
      headHash: HASH,
      eventCount: evs.length,
    });
    const report = buildCausalObservabilityReport({
      deliveries: [
        delivery({
          sessionId: "tiny-cost-session",
          headHash: HASH,
          eventCount: evs.length,
        }),
      ],
      sessionsById: new Map([[projected.id, projected]]),
      budgets: { maxUsd: 0 },
      generatedAt: NOW,
    });

    expect(report.totals.estimatedUsd).toBe(5e-8);
    expect(report.budget).toMatchObject({ status: "exceeded" });
    expect(report.budget.alerts).toContainEqual(
      expect.objectContaining({
        code: "usd-budget",
        status: "exceeded",
        actual: 5e-8,
        limit: 0,
      }),
    );
  });

  it("fails closed on stale authority binding or mismatched scope", () => {
    const projectedSession = session();
    expect(() =>
      buildCausalObservabilityReport({
        deliveries: [
          delivery({
            sessionId: "session-a",
            headHash: "e".repeat(64),
            eventCount: 5,
          }),
        ],
        sessionsById: new Map([[projectedSession.id, projectedSession]]),
        generatedAt: NOW,
      }),
    ).toThrow(/authority binding changed/);
    expect(() =>
      buildCausalObservabilityReport({
        deliveries: [{ ...delivery(), scope: { ...SCOPE, teamId: "other" } }],
        sessionsById: new Map([[projectedSession.id, projectedSession]]),
        generatedAt: NOW,
      }),
    ).toThrow(/scope mismatch/);
    expect(() =>
      buildCausalObservabilityReport({
        deliveries: [delivery()],
        sessionsById: new Map([
          [
            projectedSession.id,
            {
              ...projectedSession,
              usage: {
                ...projectedSession.usage,
                pricingTableDigest: `sha256:${"f".repeat(64)}`,
              },
            },
          ],
        ]),
        generatedAt: NOW,
      }),
    ).toThrow(/pricing table mismatch/);
  });

  it("does not pass USD or latency budgets with incomplete evidence", () => {
    const evs = events([
      {
        type: "token_usage",
        data: {
          provider: "unknown-provider",
          model: "unknown-model",
          input_tokens: 10,
          output_tokens: 1,
        },
      },
      { type: "tool_call", data: { tool: "untimed" } },
    ]);
    const projectedSession = projectVerifiedSession("session-a", evs, {
      headHash: HASH,
      eventCount: evs.length,
    });
    const projectedDelivery = delivery({
      sessionId: "session-a",
      headHash: HASH,
      eventCount: evs.length,
    });
    const report = buildCausalObservabilityReport({
      deliveries: [projectedDelivery],
      sessionsById: new Map([[projectedSession.id, projectedSession]]),
      budgets: { maxUsd: 100, maxToolP95Ms: 1000 },
      generatedAt: NOW,
    });
    expect(report.budget.status).toBe("unknown");
    expect(report.budget.alerts.map((alert) => alert.code)).toEqual([
      "usd-budget-usage-unknown",
      "tool-latency-budget-unobserved",
    ]);
  });

  it("uses a missing-as-zero P95 lower bound for incomplete timing budgets", () => {
    const buildTimedReport = (timedCalls) => {
      const sessionId = `session-timed-${timedCalls}`;
      const evs = [
        {
          ...events()[0],
          data: {
            ...events()[0].data,
            usageTelemetryProtocol: "call-ledger",
            usageTelemetryVersion: 1,
          },
        },
        modelUsageStarted("model-call"),
        {
          type: "token_usage",
          data: {
            callId: "model-call",
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ];
      for (let index = 0; index < 20; index += 1) {
        const id = `tool-${index}`;
        evs.push(
          { type: "tool_call_started", data: { id, tool: "read" } },
          {
            type: "tool_call",
            data: {
              id,
              tool: "read",
              ...(index < timedCalls ? { duration_ms: 1_000 } : {}),
            },
          },
        );
      }
      const projected = projectVerifiedSession(sessionId, evs, {
        headHash: HASH,
        eventCount: evs.length,
      });
      const projectedDelivery = delivery({
        sessionId,
        headHash: HASH,
        eventCount: evs.length,
      });
      const report = buildCausalObservabilityReport({
        deliveries: [projectedDelivery],
        sessionsById: new Map([[sessionId, projected]]),
        budgets: { maxToolP95Ms: 500 },
        generatedAt: NOW,
      });
      return { projected, report };
    };

    const sparse = buildTimedReport(1);
    expect(sparse.projected.tools).toMatchObject({
      p95DurationMs: 1_000,
      p95DurationLowerBoundMs: 0,
      timingCoverage: 0.05,
      telemetryComplete: true,
    });
    expect(sparse.report.budget.alerts).toContainEqual(
      expect.objectContaining({
        code: "tool-latency-budget-unobserved",
        status: "unknown",
        actual: 1_000,
        lowerBound: 0,
      }),
    );
    expect(sparse.report.budget.status).toBe("unknown");

    const dense = buildTimedReport(19);
    expect(dense.projected.tools).toMatchObject({
      p95DurationMs: 1_000,
      p95DurationLowerBoundMs: 1_000,
      timingCoverage: 0.95,
      telemetryComplete: true,
    });
    expect(dense.report.budget.alerts).toContainEqual(
      expect.objectContaining({
        code: "tool-latency-budget-unobserved",
        status: "exceeded",
        actual: 1_000,
        lowerBound: 1_000,
      }),
    );
    expect(dense.report.budget.status).toBe("exceeded");
  });

  it("rejects forged session tool timing fields before budget evaluation", () => {
    const makeProjection = (sessionId, { includeTool, durationMs } = {}) => {
      const evs = [
        {
          ...events()[0],
          data: {
            ...events()[0].data,
            usageTelemetryProtocol: "call-ledger",
            usageTelemetryVersion: 1,
          },
        },
        modelUsageStarted("model-call"),
        {
          type: "token_usage",
          data: {
            callId: "model-call",
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ];
      if (includeTool) {
        evs.push(
          {
            type: "tool_call_started",
            data: { id: "tool-call", tool: "read" },
          },
          {
            type: "tool_call",
            data: {
              id: "tool-call",
              tool: "read",
              ...(durationMs == null ? {} : { duration_ms: durationMs }),
            },
          },
        );
      }
      return {
        eventCount: evs.length,
        projected: projectVerifiedSession(sessionId, evs, {
          headHash: HASH,
          eventCount: evs.length,
        }),
      };
    };
    const expectRejected = ({ projected, eventCount }, toolsPatch) => {
      const tools =
        typeof toolsPatch === "function"
          ? toolsPatch(projected.tools)
          : { ...projected.tools, ...toolsPatch };
      const forged = {
        ...projected,
        tools,
      };
      expect(() =>
        buildCausalObservabilityReport({
          deliveries: [
            delivery({
              sessionId: projected.id,
              headHash: HASH,
              eventCount,
            }),
          ],
          sessionsById: new Map([[projected.id, forged]]),
          budgets: { maxToolP95Ms: 500 },
          generatedAt: NOW,
        }),
      ).toThrow(/tool/i);
    };

    const untimed = makeProjection("session-untimed", {
      includeTool: true,
    });
    expectRejected(untimed, {
      p50DurationMs: 1_000,
      p95DurationMs: 1_000,
    });
    expectRejected(untimed, { p95DurationLowerBoundMs: 1_000 });

    const timed = makeProjection("session-complete-timing", {
      includeTool: true,
      durationMs: 1_000,
    });
    expectRejected(timed, { p95DurationLowerBoundMs: 0 });
    expectRejected(timed, { timingCoverage: 0 });
    expectRejected(timed, {
      byTool: [{ ...timed.projected.tools.byTool[0], durationMs: 999 }],
    });

    const empty = makeProjection("session-no-tools");
    expectRejected(empty, { p95DurationLowerBoundMs: 0 });
    expectRejected(empty, (tools) => {
      const missingLowerBound = { ...tools };
      delete missingLowerBound.p95DurationLowerBoundMs;
      return missingLowerBound;
    });
  });

  it("rejects empty authority and malicious token counts", () => {
    expect(() =>
      projectVerifiedSession("missing", [], { headHash: null, eventCount: 0 }),
    ).toThrow(/no verified transcript authority/);
    const evs = events([
      {
        type: "token_usage",
        data: {
          provider: "openai",
          model: "gpt-5-mini",
          input_tokens: -2000,
          output_tokens: 0,
        },
      },
    ]);
    expect(() =>
      projectVerifiedSession("session-a", evs, {
        headHash: HASH,
        eventCount: evs.length,
      }),
    ).toThrow(/session usage/);
  });

  it("counts cache tokens in token budgets and treats cache-only unknown pricing as unknown", () => {
    const evs = [
      events()[0],
      {
        type: "token_usage",
        data: {
          provider: "unknown-provider",
          model: "unknown-model",
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 5,
        },
      },
    ];
    const projectedSession = projectVerifiedSession("session-a", evs, {
      headHash: HASH,
      eventCount: evs.length,
    });
    const projectedDelivery = delivery({
      sessionId: "session-a",
      headHash: HASH,
      eventCount: evs.length,
    });
    const report = buildCausalObservabilityReport({
      deliveries: [projectedDelivery],
      sessionsById: new Map([[projectedSession.id, projectedSession]]),
      budgets: { maxTokens: 10, maxUsd: 1 },
      generatedAt: NOW,
    });
    expect(report.totals).toMatchObject({
      totalTokens: 0,
      cacheReadTokens: 7,
      cacheCreationTokens: 5,
      budgetTokens: 12,
      unpricedTokens: 12,
    });
    expect(report.budget.status).toBe("exceeded");
    expect(report.budget.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "token-budget-usage-unknown",
          metric: "budgetTokens",
          status: "exceeded",
        }),
        expect.objectContaining({
          code: "usd-budget-usage-unknown",
          status: "unknown",
          unpricedTokens: 12,
        }),
      ]),
    );
  });

  it("rejects projection count mismatches and non-finite estimated costs", () => {
    const projection =
      createVerifiedSessionObservabilityProjection("session-a");
    projection.accept(events()[0]);
    expect(() => projection.finish({ headHash: HASH, eventCount: 2 })).toThrow(
      /event count does not match projection/,
    );

    const overflowEvents = [
      events()[0],
      {
        type: "token_usage",
        data: {
          provider: "openai",
          model: "gpt-5-mini",
          input_tokens: Number.MAX_SAFE_INTEGER,
          output_tokens: 0,
        },
      },
    ];
    expect(() =>
      projectVerifiedSession(
        "session-overflow",
        overflowEvents,
        { headHash: HASH, eventCount: overflowEvents.length },
        {
          pricingTable: {
            openai: [
              {
                match: "gpt-5-mini",
                in: Number.MAX_VALUE,
                out: Number.MAX_VALUE,
              },
            ],
          },
        },
      ),
    ).toThrow(/invalid priced/);
  });

  it("deduplicates identical delivery authority and rejects conflicting flow ids", () => {
    const first = delivery();
    expect(selectCausalDeliveries([first, first])).toHaveLength(1);
    expect(() =>
      selectCausalDeliveries([
        first,
        {
          ...first,
          authority: {
            ...first.authority,
            stateDigest: `sha256:${"e".repeat(64)}`,
          },
        },
      ]),
    ).toThrow(/conflicting state/);
  });

  it("keeps legacy unscoped deliveries visible only to an unfiltered report", () => {
    const legacy = projectVerifiedDelivery(
      createDeliveryFlow(
        {
          ...deliveryInput(),
          flowId: "legacy-delivery",
        },
        { now: NOW },
      ),
    );
    const report = buildCausalObservabilityReport({
      deliveries: [legacy],
      generatedAt: NOW,
    });
    expect(report.authority).toMatchObject({
      completeness: "partial",
      evidenceGaps: [
        {
          code: "delivery-session-link-missing",
          deliveryId: "legacy-delivery",
        },
      ],
    });
    expect(
      selectCausalDeliveries([legacy], { workspaceId: "workspace-a" }),
    ).toEqual([]);
  });

  it("rejects conflicting token aliases and tuple-key collisions cannot change pricing", () => {
    const conflicting = [
      events()[0],
      {
        type: "token_usage",
        data: {
          provider: "openai",
          model: "gpt-5-mini",
          input_tokens: 0,
          inputTokens: 1_000_000,
          output_tokens: 0,
          total_tokens: 0,
          totalTokens: 999,
        },
      },
    ];
    expect(() =>
      projectVerifiedSession("session-a", conflicting, {
        headHash: HASH,
        eventCount: conflicting.length,
      }),
    ).toThrow(/aliases are inconsistent/);

    const colliding = [
      events()[0],
      {
        type: "token_usage",
        data: {
          provider: "a",
          model: "b/c",
          input_tokens: 1,
          output_tokens: 0,
        },
      },
      {
        type: "token_usage",
        data: {
          provider: "a/b",
          model: "c",
          input_tokens: 1_000_000,
          output_tokens: 0,
        },
      },
    ];
    const projected = projectVerifiedSession(
      "session-a",
      colliding,
      { headHash: HASH, eventCount: colliding.length },
      {
        pricingTable: {
          "a/b": [{ match: "c", in: 10, out: 0 }],
        },
      },
    );
    expect(projected.usage.byModel).toHaveLength(2);
    expect(projected.usage.estimatedUsd).toBe(10);
    expect(projected.usage.unpriced).toHaveLength(1);
  });

  it("rejects ambiguous usage authorities and only applies complete session defaults", () => {
    const start = events()[0];
    for (const data of [
      { usage: null },
      { tokenUsage: "invalid" },
      { usage: { input_tokens: 1 }, tokenUsage: { input_tokens: 1 } },
      { usage: { input_tokens: 1 }, input_tokens: 1 },
      { input_tokens: 1, prompt_tokens: 1 },
      {
        provider: "openai",
        usage: {
          provider: "anthropic",
          model: "gpt-5-mini",
          input_tokens: 1,
        },
      },
      {
        model: "gpt-5-mini",
        usage: {
          provider: "openai",
          model: "gpt-5",
          input_tokens: 1,
        },
      },
    ]) {
      const evs = [start, { type: "token_usage", data }];
      expect(() =>
        projectVerifiedSession("session-a", evs, {
          headHash: HASH,
          eventCount: evs.length,
        }),
      ).toThrow(/usage|authorit|alias|ambiguous/i);
    }

    const defaultedEvents = [
      start,
      {
        type: "token_usage",
        data: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    ];
    const defaulted = projectVerifiedSession(
      "session-defaulted",
      defaultedEvents,
      { headHash: HASH, eventCount: defaultedEvents.length },
    );
    expect(defaulted.usage.byModel[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      matched: true,
    });

    const partialEvents = [
      start,
      {
        type: "token_usage",
        data: { provider: "openai", input_tokens: 1, output_tokens: 0 },
      },
    ];
    const partial = projectVerifiedSession("session-partial", partialEvents, {
      headHash: HASH,
      eventCount: partialEvents.length,
    });
    expect(partial.usage.byModel[0]).toMatchObject({
      provider: "openai",
      model: null,
      matched: false,
    });
  });

  it("tracks unknown model usage without retaining reasons and keeps strict token/USD budgets unknown", () => {
    const evs = [
      {
        ...events()[0],
        data: {
          ...events()[0].data,
          usageTelemetryProtocol: "call-ledger",
          usageTelemetryVersion: 1,
        },
      },
      modelUsageStarted("known-call"),
      {
        type: "token_usage",
        data: {
          callId: "known-call",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { type: "model_usage_started", data: { callId: "unknown-call" } },
      {
        type: "model_usage_unknown",
        data: { callId: "unknown-call", reason: "secret-model-reason" },
      },
      {
        type: "compaction_usage_unknown",
        data: { reason: "secret-compaction-reason" },
      },
      { type: "model_usage_started", data: { callId: "unsettled-call" } },
      { type: "llm_retry", data: { reason: "timeout" } },
    ];
    const projectedSession = projectVerifiedSession("session-a", evs, {
      headHash: HASH,
      eventCount: evs.length,
    });
    expect(projectedSession.usage).toMatchObject({
      telemetryComplete: false,
      unknownEvidence: { count: 4 },
    });
    expect(projectedSession.usage.unknownEvidence.byCode).toEqual([
      { code: "compaction-usage-unknown", count: 1 },
      { code: "llm-retry-usage-unknown", count: 1 },
      { code: "model-usage-unknown", count: 1 },
      { code: "model-usage-unsettled", count: 1 },
    ]);
    expect(JSON.stringify(projectedSession)).not.toContain("secret-");

    const projectedDelivery = delivery({
      sessionId: "session-a",
      headHash: HASH,
      eventCount: evs.length,
    });
    const report = buildCausalObservabilityReport({
      deliveries: [projectedDelivery],
      sessionsById: new Map([["session-a", projectedSession]]),
      budgets: { maxTokens: 1_000, maxUsd: 1_000, maxRetryRatio: 1 },
      generatedAt: NOW,
    });
    expect(report.totals).toMatchObject({
      unknownUsageEvents: 4,
      usageTelemetryComplete: false,
    });
    expect(report.budget.status).toBe("unknown");
    expect(report.budget.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "token-budget-usage-unknown",
          status: "unknown",
        }),
        expect.objectContaining({
          code: "usd-budget-usage-unknown",
          status: "unknown",
        }),
        expect.objectContaining({
          code: "retry-ratio-budget-usage-unknown",
          status: "unknown",
        }),
      ]),
    );
  });

  it("enforces call-ledger settlement uniqueness and protocol authority", () => {
    const protocolStart = {
      ...events()[0],
      data: {
        ...events()[0].data,
        usageTelemetryProtocol: "call-ledger",
        usageTelemetryVersion: 1,
      },
    };
    const known = {
      type: "token_usage",
      data: {
        callId: "call-a",
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    };
    for (const extra of [
      [modelUsageStarted("call-a"), known, known],
      [
        modelUsageStarted("call-a"),
        { type: "model_usage_unknown", data: { callId: "call-a" } },
        known,
      ],
      [
        modelUsageStarted("call-a"),
        known,
        { type: "model_usage_unknown", data: { callId: "call-a" } },
      ],
      [known],
    ]) {
      const evs = [protocolStart, ...extra];
      expect(() =>
        projectVerifiedSession("session-a", evs, {
          headHash: HASH,
          eventCount: evs.length,
        }),
      ).toThrow(/callId|settlement|start/i);
    }

    for (const extra of [
      [
        modelUsageStarted("identity-call"),
        {
          type: "token_usage",
          data: {
            callId: "identity-call",
            provider: "anthropic",
            model: "claude-sonnet",
            source: "model",
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ],
      [
        modelUsageStarted("identity-call"),
        {
          type: "model_usage_unknown",
          data: {
            callId: "identity-call",
            provider: "openai",
            model: "gpt-5-mini",
            source: "semantic-compaction",
          },
        },
      ],
      [
        { type: "model_usage_started", data: { callId: "identity-call" } },
        {
          type: "token_usage",
          data: {
            callId: "identity-call",
            provider: "openai",
            model: "gpt-5-mini",
            source: "model",
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ],
    ]) {
      const evs = [protocolStart, ...extra];
      expect(() =>
        projectVerifiedSession("session-identity", evs, {
          headHash: HASH,
          eventCount: evs.length,
        }),
      ).toThrow(/changed provider\/model\/source identity/);
    }

    const missing = projectVerifiedSession(
      "protocol-without-start",
      [protocolStart],
      { headHash: HASH, eventCount: 1 },
    );
    expect(missing.usage).toMatchObject({
      telemetryComplete: false,
      unknownEvidence: {
        byCode: [{ code: "call-ledger-evidence-missing", count: 1 }],
      },
    });

    const legacyEvents = [
      events()[0],
      modelUsageStarted("legacy-call"),
      {
        type: "token_usage",
        data: {
          callId: "legacy-call",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ];
    const legacy = projectVerifiedSession("legacy-call-ledger", legacyEvents, {
      headHash: HASH,
      eventCount: legacyEvents.length,
    });
    expect(legacy.usage.unknownEvidence.byCode).toContainEqual({
      code: "call-ledger-protocol-undeclared",
      count: 1,
    });
    expect(legacy.authority.usageTelemetry).toEqual({
      protocolDeclared: false,
      protocol: null,
      version: null,
      assurance: "recorded-events-only",
    });
    expect(legacy.usage.telemetryComplete).toBe(false);
  });

  it("rejects a late session_start that launders earlier telemetry into the call-ledger protocol", () => {
    const lateProtocolStart = {
      ...events()[0],
      data: {
        ...events()[0].data,
        usageTelemetryProtocol: "call-ledger",
        usageTelemetryVersion: 1,
      },
    };
    const laundered = [
      modelUsageStarted("before-protocol-authority"),
      {
        type: "token_usage",
        data: {
          callId: "before-protocol-authority",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      lateProtocolStart,
    ];

    expect(() =>
      projectVerifiedSession("late-protocol-authority", laundered, {
        headHash: HASH,
        eventCount: laundered.length,
      }),
    ).toThrow(/session_start.*first|exactly one session_start/i);
  });

  it("rejects call-ledger settlements that omit a required token counter", () => {
    const protocolStart = {
      ...events()[0],
      data: {
        ...events()[0].data,
        usageTelemetryProtocol: "call-ledger",
        usageTelemetryVersion: 1,
      },
    };
    for (const usage of [
      {},
      { input_tokens: 1 },
      { output_tokens: 1 },
      { cache_read_input_tokens: 1 },
    ]) {
      const evs = [
        protocolStart,
        modelUsageStarted("incomplete-call"),
        {
          type: "token_usage",
          data: { callId: "incomplete-call", usage },
        },
      ];
      expect(() =>
        projectVerifiedSession("incomplete-usage", evs, {
          headHash: HASH,
          eventCount: evs.length,
        }),
      ).toThrow(/inputTokens|outputTokens.*required/i);
    }
  });

  it("rejects coercive or oversized duration telemetry", () => {
    for (const duration_ms of [
      "1",
      Number.POSITIVE_INFINITY,
      -1,
      604_800_001,
    ]) {
      const evs = [
        events()[0],
        { type: "tool_call", data: { tool: "read", duration_ms } },
      ];
      expect(() =>
        projectVerifiedSession("session-a", evs, {
          headHash: HASH,
          eventCount: evs.length,
        }),
      ).toThrow(/duration/);
    }
  });

  it("tracks unsettled and conflicting tool-call ledger evidence", () => {
    const start = {
      ...events()[0],
      data: {
        ...events()[0].data,
        usageTelemetryProtocol: "call-ledger",
        usageTelemetryVersion: 1,
      },
    };
    const evs = [
      start,
      modelUsageStarted("model-a"),
      {
        type: "token_usage",
        data: {
          callId: "model-a",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: "tool_call_started", data: { id: "tool-a", tool: "read" } },
    ];
    const projected = projectVerifiedSession("session-a", evs, {
      headHash: HASH,
      eventCount: evs.length,
    });
    expect(projected.tools).toMatchObject({
      telemetryComplete: false,
      unknownEvents: 1,
    });
    const projectedDelivery = delivery({
      sessionId: "session-a",
      headHash: HASH,
      eventCount: evs.length,
    });
    const report = buildCausalObservabilityReport({
      deliveries: [projectedDelivery],
      sessionsById: new Map([["session-a", projected]]),
      budgets: { maxToolP95Ms: 1_000 },
      generatedAt: NOW,
    });
    expect(report.authority.toolTelemetry).toEqual({
      complete: false,
      unknownEvents: 1,
    });
    expect(report.budget.alerts).toContainEqual(
      expect.objectContaining({
        code: "tool-latency-budget-unobserved",
        status: "unknown",
        unknownToolEvents: 1,
      }),
    );

    const conflicting = [
      start,
      { type: "tool_call_started", data: { id: "tool-a", tool: "read" } },
      { type: "tool_call", data: { id: "tool-a", tool: "read" } },
      { type: "tool_call", data: { id: "tool-a", tool: "read" } },
    ];
    expect(() =>
      projectVerifiedSession("session-conflict", conflicting, {
        headHash: HASH,
        eventCount: conflicting.length,
      }),
    ).toThrow(/conflicting settlement/);

    const renamed = [
      start,
      { type: "tool_call_started", data: { id: "tool-a", tool: "read" } },
      { type: "tool_call", data: { id: "tool-a", tool: "write" } },
    ];
    expect(() =>
      projectVerifiedSession("session-renamed", renamed, {
        headHash: HASH,
        eventCount: renamed.length,
      }),
    ).toThrow(/changed tool identity/);
  });

  it("rejects unknown request, filter and budget keys", () => {
    expect(() =>
      normalizeCausalRequest({
        deliveryStates: ["delivery.json"],
        deliveryState: ["typo.json"],
      }),
    ).toThrow(/unsupported key/);
    expect(() =>
      normalizeCausalRequest({
        deliveryStates: ["delivery.json"],
        filter: { workpaceId: "typo" },
      }),
    ).toThrow(/unsupported key/);
    expect(() =>
      normalizeCausalRequest({
        deliveryStates: ["delivery.json"],
        budgets: { maxToken: 1 },
      }),
    ).toThrow(/unsupported key/);
  });

  it("caps delivery gate matrices, preview artifacts and aggregate report rows", () => {
    const raw = createDeliveryFlow(deliveryInput(), { now: NOW });
    expect(() =>
      projectVerifiedDelivery({
        ...raw,
        gateSelection: {
          ...raw.gateSelection,
          selectedGateIds: Array.from({ length: 257 }, (_, i) => `gate-${i}`),
        },
      }),
    ).toThrow(/256 selected gate limit/);
    expect(() =>
      projectVerifiedDelivery({
        ...raw,
        gateResults: [
          {
            id: "gate",
            status: "passed",
            commitSha: HEAD,
            matrix: Array.from({ length: 1025 }, (_, i) => ({
              id: `cell-${i}`,
              status: "passed",
              commitSha: HEAD,
            })),
          },
        ],
      }),
    ).toThrow(/1024 gate matrix cell limit/);
    expect(() =>
      projectVerifiedDelivery({
        ...raw,
        previewArtifacts: Array.from({ length: 257 }, () => ({
          kind: "image",
        })),
      }),
    ).toThrow(/256 preview artifact limit/);

    const tracker = createCausalObservabilityLimitTracker();
    const projected = projectVerifiedDelivery(raw);
    const dense = {
      ...projected,
      gates: {
        selectedIds: Array.from({ length: 255 }, (_, i) => `gate-${i}`),
        results: [
          {
            matrix: Array.from({ length: 1024 }, () => ({})),
          },
        ],
      },
      artifacts: {
        ...projected.artifacts,
        preview: Array.from({ length: 256 }, () => ({})),
      },
    };
    for (let i = 0; i < 16; i += 1) tracker.acceptDelivery(dense);
    expect(() => tracker.acceptDelivery(dense)).toThrow(
      /causal report exceeds/,
    );
  });

  it("rejects malformed delivery strings and unverified report projections", () => {
    const raw = createDeliveryFlow(deliveryInput(), { now: NOW });
    expect(() =>
      projectVerifiedDelivery({ ...raw, status: "active\nsecret" }),
    ).toThrow(/status/);
    expect(() =>
      projectVerifiedDelivery({ ...raw, commitSha: "not-a-commit" }),
    ).toThrow(/commit SHA/);
    expect(() => projectVerifiedDelivery({ ...raw, revision: "1" })).toThrow(
      /safe integer/,
    );

    const projectedSession = session();
    expect(() =>
      buildCausalObservabilityReport({
        deliveries: [
          {
            ...delivery(),
            authority: { ...delivery().authority, verified: false },
          },
        ],
        sessionsById: new Map([[projectedSession.id, projectedSession]]),
        generatedAt: NOW,
      }),
    ).toThrow(/delivery authority is not verified/);
    expect(() =>
      buildCausalObservabilityReport({
        deliveries: [delivery()],
        sessionsById: new Map([["wrong-map-key", projectedSession]]),
        generatedAt: NOW,
      }),
    ).toThrow(/map key does not match/);
    expect(() =>
      buildCausalObservabilityReport({
        deliveries: [delivery()],
        sessionsById: new Map([
          [
            projectedSession.id,
            {
              ...projectedSession,
              authority: { ...projectedSession.authority, verified: false },
            },
          ],
        ]),
        generatedAt: NOW,
      }),
    ).toThrow(/session authority is not verified/);

    for (const usagePatch of [
      { inputTokens: -1 },
      { estimatedUsd: "1" },
      { unknownEvidence: { count: -1, byCode: [] } },
    ]) {
      expect(() =>
        buildCausalObservabilityReport({
          deliveries: [delivery()],
          sessionsById: new Map([
            [
              projectedSession.id,
              {
                ...projectedSession,
                usage: { ...projectedSession.usage, ...usagePatch },
              },
            ],
          ]),
          generatedAt: NOW,
        }),
      ).toThrow(/usage|estimated USD|safe integer/i);
    }
  });

  it("rejects coercive request budgets and preflights the report session cap", () => {
    for (const maxTokens of ["", "1", false, 1.5]) {
      expect(() =>
        normalizeCausalRequest({
          deliveryStates: ["delivery.json"],
          budgets: { maxTokens },
        }),
      ).toThrow(/maxTokens/);
    }
    const deliveries = Array.from({ length: 513 }, (_, index) => ({
      associations: [{ sessionId: `session-${index}` }],
    }));
    expect(() => causalSessionIds(deliveries)).toThrow(/512 session limit/);
  });

  it("does not accept unselected session projections in a report", () => {
    const projected = session();
    expect(() =>
      buildCausalObservabilityReport({
        deliveries: [],
        sessionsById: new Map([[projected.id, projected]]),
        generatedAt: NOW,
      }),
    ).toThrow(/unselected session/);
  });

  it("binds tool retries to failure state observed at call start", () => {
    const start = {
      ...events()[0],
      data: {
        ...events()[0].data,
        usageTelemetryProtocol: "call-ledger",
        usageTelemetryVersion: 1,
      },
    };
    const evs = [
      start,
      modelUsageStarted("model-call"),
      {
        type: "token_usage",
        data: {
          callId: "model-call",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: "tool_call_started", data: { id: "a", tool: "read" } },
      { type: "tool_call_started", data: { id: "b", tool: "read" } },
      {
        type: "tool_call",
        data: { id: "a", tool: "read", is_error: true },
      },
      {
        type: "tool_call",
        data: { id: "b", tool: "read", is_error: false },
      },
      { type: "tool_call_started", data: { id: "c", tool: "read" } },
      {
        type: "tool_call",
        data: { id: "c", tool: "read", is_error: false },
      },
    ];
    const parallelOnly = evs.slice(0, 7);
    const parallelProjected = projectVerifiedSession(
      "session-parallel",
      parallelOnly,
      {
        headHash: HASH,
        eventCount: parallelOnly.length,
      },
    );
    expect(parallelProjected.tools).toMatchObject({
      totalCalls: 2,
      totalErrors: 1,
      retryCalls: 0,
      telemetryComplete: true,
    });

    const projected = projectVerifiedSession("session-a", evs, {
      headHash: HASH,
      eventCount: evs.length,
    });
    expect(projected.tools).toMatchObject({
      totalCalls: 3,
      totalErrors: 1,
      retryCalls: 1,
      telemetryComplete: true,
      unknownEvents: 0,
    });
    expect(projected.tools.byTool[0]).toMatchObject({
      tool: "read",
      calls: 3,
      errors: 1,
      retries: 1,
    });

    const legacy = [
      start,
      modelUsageStarted("legacy-model-call"),
      {
        type: "token_usage",
        data: {
          callId: "legacy-model-call",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: "tool_call", data: { tool: "read", is_error: true } },
      { type: "tool_call", data: { tool: "read", is_error: false } },
    ];
    const legacyProjected = projectVerifiedSession("session-legacy", legacy, {
      headHash: HASH,
      eventCount: legacy.length,
    });
    expect(legacyProjected.tools).toMatchObject({
      totalCalls: 2,
      retryCalls: 0,
      telemetryComplete: false,
      unknownEvents: 2,
    });
  });

  it("uses nearest-rank percentile boundaries", () => {
    expect(nearestRankPercentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
    expect(nearestRankPercentile([], 0.95)).toBeNull();
  });
});
