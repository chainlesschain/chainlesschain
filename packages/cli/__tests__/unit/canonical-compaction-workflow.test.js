import "../helpers/test-model-egress.js";
import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";

async function runCase({
  kind = "plan-refusal",
  workflow = true,
  failObserver,
} = {}) {
  const home = mkdtempSync(join(tmpdir(), "workflow-compaction-"));
  vi.stubEnv("CHAINLESSCHAIN_HOME", home);
  try {
    const boundaries = [],
      settlements = [],
      receipts = [],
      events = [],
      order = [];
    const observe = (phase, values) => (event) => {
      order.push(phase);
      values.push(event);
      if (failObserver === phase)
        throw new Error(`${phase} persistence failed`);
    };
    const ctx = SubAgentContext.create({
      role: "reviewer",
      task: "finish requested work",
      cwd: home,
      ...(workflow ? { workflowEffectId: `sha256:${"9".repeat(64)}` } : {}),
      strictUsageTelemetry: true,
      onUsageBoundary: observe("boundary", boundaries),
      onUsageSettlement: observe("settlement", settlements),
      onProviderReceipt: observe("receipt", receipts),
      onProgress: (event) => events.push(event),
    });
    const fitting = ["success", "commit-failure"].includes(kind);
    ctx.messages = [
      { role: "system", content: "System" },
      ...Array.from({ length: 36 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: fitting
          ? i % 2
            ? String.fromCharCode(65 + (i % 26)).repeat(8000)
            : `Question ${i}`
          : `Turn ${i}: ${"content ".repeat(30)}`,
      })),
    ];
    const original = structuredClone(ctx.messages);
    const query = vi.fn(async (_prompt, binding) => ({
      summary: JSON.stringify({
        objective: fitting ? "Continue" : "x".repeat(1800),
        constraints: [],
        keyDecisions: [],
        changedFiles: [],
        tests: [],
        unresolvedSideEffects: [],
        checkpoints: [],
        blockers: [],
        nextSteps: ["Continue"],
      }),
      ...(kind === "missing-usage"
        ? {}
        : { usage: { input_tokens: 123, output_tokens: 45 } }),
      provider: "openai",
      model: "summary-model",
      ...(binding
        ? {
            providerReceipt: {
              protocol: "cc-provider-request-receipt/v1",
              provider: kind === "mismatched-receipt" ? "anthropic" : "openai",
              clientRequestId: binding.providerRequestId,
              requestId: "req_actual_compaction",
              responseId: "resp_actual_compaction",
              requestIdentitySemantics: "trace-only",
              independentlyReadable: false,
            },
          }
        : {}),
    }));
    const chatFn = vi.fn(async () => ({
      message: { role: "assistant", content: "done" },
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const commit = vi.fn(() => {
      if (kind === "commit-failure")
        throw new Error("commit fsync outcome unknown");
      return { hash: "committed-head" };
    });
    let result, error;
    try {
      result = await ctx.run("Continue", {
        provider: "openai",
        model: "summary-model",
        chatFn,
        compactionLlmQuery: query,
        contextMemoryEnv: {
          CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
        },
        contextMemoryModelWindowTokens: fitting ? 8192 : 1024,
        autoMicroCompact: false,
        persistCompaction: false,
        maxOutputTokens: 256,
        onCompaction: commit,
      });
    } catch (caught) {
      error = caught;
    }
    return {
      ctx,
      result,
      error,
      query,
      chatFn,
      commit,
      boundaries,
      settlements,
      receipts,
      events,
      order,
      original,
    };
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
}

it.each(["plan-refusal", "commit-failure"])(
  "workflow %s preserves known usage and receipt without reporting completion",
  async (kind) => {
    const run = await runCase({ kind });
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.chatFn).not.toHaveBeenCalled();
    expect(run.commit).toHaveBeenCalledTimes(kind === "commit-failure" ? 1 : 0);
    expect(run.ctx.status).toBe("failed");
    expect(run.result).toBeUndefined();
    expect(run.error).toMatchObject({
      code:
        kind === "plan-refusal"
          ? "CC_WORKFLOW_COMPACTION_PLAN_REJECTED"
          : "CC_WORKFLOW_COMPACTION_SETTLEMENT_UNKNOWN",
      usageOutcome: "known",
      ...(kind === "plan-refusal"
        ? { contextOutcome: "aborted" }
        : { workflowEffectOutcomeUnknown: true }),
    });
    expect(run.settlements).toHaveLength(1);
    expect(run.receipts).toHaveLength(1);
    expect(run.order).toEqual(["boundary", "receipt", "settlement"]);
    expect(run.settlements[0]).toMatchObject({
      type: "token-usage",
      usage: { input_tokens: 123, output_tokens: 45 },
      providerReceipt: {
        callId: run.boundaries[0].callId,
        callSequence: 1,
        workflowEffectId: run.boundaries[0].workflowEffectId,
        clientRequestId: run.boundaries[0].providerRequestId,
        requestId: "req_actual_compaction",
      },
    });
    expect(run.ctx.messages.slice(0, run.original.length)).toEqual(
      run.original,
    );
  },
);

it.each(["plan-refusal", "commit-failure"])(
  "ordinary %s ends explicitly incomplete",
  async (kind) => {
    const run = await runCase({ kind, workflow: false });
    expect(run.error).toBeUndefined();
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.chatFn).not.toHaveBeenCalled();
    expect(run.result).toMatchObject({
      incomplete: true,
      completionReason:
        kind === "plan-refusal"
          ? "compaction-plan-rejected"
          : "compaction-settlement-failed",
    });
    expect(run.events.filter((e) => e.type === "run-ended")).toHaveLength(1);
    expect(run.settlements).toHaveLength(1);
  },
);

it("successful workflow compaction emits its receipt once before its one usage settlement", async () => {
  const run = await runCase({ kind: "success" });
  expect(run.error).toBeUndefined();
  expect(run.ctx.status).toBe("completed");
  expect(run.result.summary).toBe("done");
  expect(run.result.incomplete).toBeUndefined();
  expect(run.query).toHaveBeenCalledOnce();
  expect(run.commit).toHaveBeenCalledOnce();
  expect(run.chatFn).toHaveBeenCalledOnce();
  expect(run.receipts).toHaveLength(1);
  expect(
    run.settlements.filter((e) => e.source === "semantic-compaction"),
  ).toHaveLength(1);
  expect(run.order.slice(0, 3)).toEqual(["boundary", "receipt", "settlement"]);
});

it.each(["mismatched-receipt", "missing-usage"])(
  "workflow %s stays unknown and cannot complete",
  async (kind) => {
    const run = await runCase({ kind });
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.chatFn).not.toHaveBeenCalled();
    expect(run.commit).not.toHaveBeenCalled();
    expect(run.ctx.status).toBe("failed");
    expect(run.error.workflowEffectOutcomeUnknown).toBe(true);
    expect(run.settlements).toHaveLength(1);
    expect(run.settlements[0].type).toBe("model-usage-unknown");
    expect(run.receipts).toHaveLength(kind === "missing-usage" ? 1 : 0);
  },
);

it.each(["boundary", "receipt", "settlement"])(
  "workflow %s observer failure prevents completion or retry",
  async (failObserver) => {
    const run = await runCase({ failObserver });
    expect(run.error).toBeTruthy();
    expect(run.ctx.status).toBe("failed");
    expect(run.query).toHaveBeenCalledTimes(
      failObserver === "boundary" ? 0 : 1,
    );
    expect(run.chatFn).not.toHaveBeenCalled();
    expect(run.commit).not.toHaveBeenCalled();
    expect(run.settlements).toHaveLength(failObserver === "settlement" ? 1 : 0);
    expect(run.settlements.every((e) => e.type === "token-usage")).toBe(true);
  },
);

it.each(["missing-usage"])(
  "ordinary %s ends explicitly incomplete",
  async (kind) => {
    const run = await runCase({ kind, workflow: false });
    expect(run.error).toBeUndefined();
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.chatFn).not.toHaveBeenCalled();
    expect(run.commit).not.toHaveBeenCalled();
    expect(run.result).toMatchObject({
      incomplete: true,
      completionReason: "compaction-settlement-failed",
    });
    expect(run.events.filter((e) => e.type === "run-ended")).toHaveLength(1);
    expect(run.settlements).toHaveLength(1);
    expect(run.settlements[0].type).toBe("model-usage-unknown");
  },
);
