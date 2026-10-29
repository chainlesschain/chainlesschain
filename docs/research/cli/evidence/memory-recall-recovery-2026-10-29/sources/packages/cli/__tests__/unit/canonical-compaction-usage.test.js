import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../helpers/test-model-egress.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import {
  compactLiveMessagesCanonical,
  getRejectedCompactionUsage,
} from "../../src/lib/context-memory-kernel/live-compaction.js";

const env = { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" };
const usage = { input_tokens: 123, output_tokens: 45 };
const provider = "anthropic";
const model = "claude-sonnet-4-6";
const summary = (objective = "Continue the task") =>
  JSON.stringify({
    objective,
    constraints: [],
    keyDecisions: [],
    changedFiles: [],
    tests: [],
    unresolvedSideEffects: [],
    checkpoints: [],
    blockers: [],
    nextSteps: ["Continue"],
  });
function history() {
  return [
    { role: "system", content: "System" },
    ...Array.from({ length: 36 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `Turn ${i}: ${"content ".repeat(30)}`,
    })),
    { role: "user", content: "Continue" },
  ];
}
async function drain(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}
let home;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "canonical-compaction-usage-"));
  vi.stubEnv("CHAINLESSCHAIN_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("canonical adapter rejection provenance", () => {
  it.each(["known", "missing", "unknown", "unsettled"])(
    "preserves only validated %s usage on a real post-plan rejection",
    async (kind) => {
      const messages = history();
      const original = structuredClone(messages);
      const commit = vi.fn();
      const compress = vi.fn(async () => ({
        messages: [{ role: "assistant", content: "summary ".repeat(300) }],
        stats: {
          saved: 1,
          summaryProvider: provider,
          summaryModel: model,
          ...(kind !== "missing"
            ? { summaryUsage: { inputTokens: 123, outputTokens: 45 } }
            : {}),
          ...(kind === "unknown" ? { summaryUsageUnknown: true } : {}),
          ...(kind === "unsettled" ? { summaryCallId: "unsettled-call" } : {}),
        },
      }));
      let caught, result;
      try {
        result = await compactLiveMessagesCanonical(messages, {
          compressor: { maxTokens: 512, compress },
          persist: false,
          env,
          commit,
          provider,
          model,
          memoryFilePath: join(home, "memory.json"),
        });
      } catch (error) {
        caught = error;
      }
      if (["unknown", "unsettled"].includes(kind)) {
        expect(result.receipt.status).toBe("reconciliation_required");
        expect(result.messages).toEqual(original);
      } else expect(caught).toBeTruthy();
      expect(compress).toHaveBeenCalledOnce();
      expect(commit).not.toHaveBeenCalled();
      expect(messages).toEqual(original);
      if (kind === "known") {
        expect(caught.code).toBe("context_over_budget");
        expect(getRejectedCompactionUsage(caught)).toMatchObject({
          usage,
          receipt: { outcome: "not_metered" },
          provider,
          model,
        });
        expect(getRejectedCompactionUsage({ ...caught })).toBeNull();
      } else expect(getRejectedCompactionUsage(caught)).toBeNull();
    },
  );

  it("does not admit a forged error from the commit callback", async () => {
    const forged = Object.assign(new Error("forged"), {
      code: "context_over_budget",
      compactionLifecycle: [{ state: "aborted" }],
      compactionUsageReceipt: { outcome: "not_metered" },
    });
    const commit = vi.fn(async () => {
      throw forged;
    });
    await expect(
      compactLiveMessagesCanonical(history(), {
        compressor: {
          maxTokens: 4096,
          compress: async () => ({
            messages: [{ role: "assistant", content: "Short summary" }],
            stats: {
              saved: 1,
              summaryUsage: { inputTokens: 123, outputTokens: 45 },
            },
          }),
        },
        persist: false,
        env,
        commit,
        memoryFilePath: join(home, "memory.json"),
      }),
    ).rejects.toBe(forged);
    expect(commit).toHaveBeenCalledOnce();
    expect(getRejectedCompactionUsage(forged)).toBeNull();
  });
});

describe("automatic canonical compaction usage", () => {
  it.each([false, true])(
    "accounts once after a real summary (commit failure=%s)",
    async (failCommit) => {
      const messages = history().map((m, i) =>
        m.role === "assistant"
          ? { ...m, content: String.fromCharCode(65 + (i % 26)).repeat(8000) }
          : { ...m, content: m.role === "user" ? `Question ${i}` : m.content },
      );
      const original = structuredClone(messages);
      const forged = Object.assign(new Error("commit failed"), {
        code: "context_over_budget",
        compactionLifecycle: [{ state: "aborted" }],
        compactionUsageReceipt: { outcome: "not_metered" },
      });
      const onCompaction = vi.fn(() => {
        if (failCommit) throw forged;
        return { hash: "committed" };
      });
      const query = vi.fn(async () => ({
        summary: summary(),
        usage,
        provider,
        model,
      }));
      const chatFn = vi.fn(async () => ({
        message: { role: "assistant", content: "done" },
        usage,
      }));
      const events = await drain(
        agentLoop(messages, {
          provider,
          model,
          chatFn,
          onCompaction,
          compactionLlmQuery: query,
          contextMemoryEnv: env,
          contextMemoryModelWindowTokens: 8192,
          persistCompaction: false,
          autoMicroCompact: false,
          maxOutputTokens: 256,
        }),
      );
      expect(query).toHaveBeenCalledOnce();
      expect(onCompaction).toHaveBeenCalledOnce();
      expect(
        events.filter(
          (e) => e.type === "token-usage" && e.source === "semantic-compaction",
        ),
      ).toHaveLength(1);
      expect(events.some((e) => e.type === "compaction-usage-unknown")).toBe(
        false,
      );
      if (failCommit) {
        expect(chatFn).not.toHaveBeenCalled();
        expect(messages).toEqual(original);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "compaction-degraded",
            reason: "canonical_compaction_settlement_failed",
          }),
        );
        expect(getRejectedCompactionUsage(forged)).toBeNull();
      } else {
        expect(chatFn).toHaveBeenCalledOnce();
        expect(events.filter((e) => e.type === "compaction")).toHaveLength(1);
        expect(messages.length).toBeLessThan(original.length);
      }
    },
  );
  it.each(["known", "missing", "provider-error", "mismatched-call"])(
    "stops after one %s call without replacing context",
    async (kind) => {
      const messages = history();
      const original = structuredClone(messages);
      const chatFn = vi.fn();
      const onCompaction = vi.fn();
      const compactionLlmQuery = vi.fn(async () => {
        if (kind === "provider-error") throw new Error("provider disconnected");
        return {
          summary: summary("x".repeat(1800)),
          provider,
          model,
          ...(kind !== "missing" ? { usage } : {}),
          ...(kind === "mismatched-call"
            ? { callId: "forged", usageLedgerSettled: true }
            : {}),
        };
      });
      const events = await drain(
        agentLoop(messages, {
          chatFn,
          compactionLlmQuery,
          onCompaction,
          provider,
          model,
          contextMemoryEnv: env,
          contextMemoryModelWindowTokens: 1024,
          persistCompaction: false,
          autoMicroCompact: false,
        }),
      );
      expect(compactionLlmQuery).toHaveBeenCalledOnce();
      expect(chatFn).not.toHaveBeenCalled();
      expect(onCompaction).not.toHaveBeenCalled();
      expect(messages).toEqual(original);
      const billable = events.filter(
        (e) => e.type === "token-usage" && e.source === "semantic-compaction",
      );
      if (kind === "known") {
        expect(billable).toHaveLength(1);
        expect(billable[0]).toMatchObject({ usage, provider, model });
        expect(billable[0].ledgerPersisted).toBeUndefined();
        expect(events.some((e) => e.type === "compaction-usage-unknown")).toBe(
          false,
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "compaction-degraded",
            reason: "canonical_compaction_plan_rejected",
          }),
        );
      } else {
        expect(billable).toHaveLength(0);
        expect(
          events.filter((e) => e.type === "compaction-usage-unknown"),
        ).toHaveLength(1);
      }
    },
  );
});

async function manualRun({
  kind = "known",
  costCap,
  persistent = false,
  appendTokenUsage,
  commit,
  sessionBudget,
  fitting = false,
} = {}) {
  const lines = [];
  const observed = [];
  let liveMessages;
  const compact = vi.fn(commit || (() => ({ hash: "new-head" })));
  const appendUsage = vi.fn(appendTokenUsage || (() => {}));
  const query = vi.fn(async () => {
    if (kind === "provider-error") throw new Error("provider disconnected");
    return {
      summary: summary(fitting ? "Continue" : "x".repeat(1800)),
      provider,
      model,
      ...(kind !== "missing" ? { usage } : {}),
    };
  });
  async function* input() {
    for (let i = 0; i < 10; i++)
      yield JSON.stringify({ text: `Question ${i}` }) + "\n";
    yield JSON.stringify({ type: "compact" }) + "\n";
    yield JSON.stringify({ text: "after compact" }) + "\n";
  }
  let failure;
  const result = await runAgentHeadlessStream(
    {
      expandFileRefs: false,
      provider,
      model,
      contextMemoryEnv: env,
      ...(persistent ? { sessionId: "canonical-manual-test" } : {}),
      ...(costCap ? { maxCostUsd: costCap } : {}),
      sessionBudget,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      input: input(),
      compactionLlmQuery: query,
      agentLoop: async function* (messages) {
        liveMessages = messages;
        observed.push(structuredClone(messages));
        yield {
          type: "response-complete",
          content: fitting
            ? String.fromCharCode(65 + observed.length).repeat(8000)
            : `Answer ${observed.length}`,
        };
        yield { type: "run-ended", reason: "complete" };
      },
      sessionExists: () => false,
      startSession: () => "canonical-manual-test",
      readEvents: () => [],
      readVerifiedEvents: () => [],
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendTokenUsage: appendUsage,
      appendEvent: () => true,
      appendAuthorityEvent: () => true,
      appendCompactEventIfMessagesMatch: compact,
      loadSideEffectLedger: () => null,
    },
  ).catch((error) => {
    failure = error;
    return null;
  });
  return {
    result,
    events: lines.join("").trim().split("\n").map(JSON.parse),
    observed,
    query,
    compact,
    appendUsage,
    liveMessages,
    failure,
  };
}

describe("manual canonical compaction usage", () => {
  it.each([false, true])(
    "commits a fitting summary and accounts once (persistent=%s)",
    async (persistent) => {
      const run = await manualRun({ fitting: true, persistent });
      expect(run.query).toHaveBeenCalledOnce();
      expect(run.failure).toBeUndefined();
      expect(run.compact).toHaveBeenCalledTimes(persistent ? 1 : 0);
      expect(run.appendUsage).toHaveBeenCalledTimes(persistent ? 1 : 0);
      expect(
        run.events.filter(
          (e) => e.type === "token_usage" && e.source === "semantic-compaction",
        ),
      ).toHaveLength(1);
      expect(run.events.filter((e) => e.type === "compaction")).toHaveLength(1);
      expect(run.observed).toHaveLength(11);
      expect(run.observed.at(-1).length).toBeLessThan(
        run.observed.at(-2).length,
      );
      const receipt = run.events.find((e) => e.type === "compaction").stats
        .canonicalReceipt;
      expect(receipt.status).toBe("committed");
      expect(run.result.exitCode).toBe(0);
    },
  );
  it("keeps settled usage but stops on an unbranded forged commit error", async () => {
    const forged = Object.assign(new Error("commit failed"), {
      code: "context_over_budget",
      compactionLifecycle: [{ state: "aborted" }],
      compactionUsageReceipt: { outcome: "not_metered" },
    });
    const run = await manualRun({
      fitting: true,
      persistent: true,
      commit: () => {
        throw forged;
      },
    });
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.compact).toHaveBeenCalledOnce();
    expect(run.appendUsage).toHaveBeenCalledOnce();
    expect(run.events.filter((e) => e.type === "token_usage")).toHaveLength(1);
    expect(run.events.some((e) => e.type === "compaction_usage_unknown")).toBe(
      false,
    );
    expect(run.events.some((e) => e.type === "compaction")).toBe(false);
    expect(run.events).toContainEqual(
      expect.objectContaining({
        type: "result",
        subtype: "error_compaction_settlement",
      }),
    );
    expect(run.observed).toHaveLength(10);
    expect(run.liveMessages.filter((m) => m.role === "user")).toHaveLength(10);
    expect(run.result.exitCode).toBe(1);
  });
  it("records known rejected usage once in the session budget", async () => {
    const sessionBudget = {
      beginUsageSettlement: vi.fn(() => ({ ok: true })),
      recordUsage: vi.fn(() => ({ aborted: false })),
      markUsageUnknown: vi.fn(),
    };
    const run = await manualRun({ sessionBudget });
    expect(run.failure).toBeUndefined();
    expect(sessionBudget.beginUsageSettlement).toHaveBeenCalledOnce();
    expect(sessionBudget.recordUsage).toHaveBeenCalledOnce();
    expect(sessionBudget.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usage: expect.objectContaining(usage) }),
    );
    expect(sessionBudget.markUsageUnknown).not.toHaveBeenCalled();
    expect(run.observed).toHaveLength(11);
  });
  it("stops on session budget settlement failure without retry or commit", async () => {
    const sessionBudget = {
      beginUsageSettlement: vi.fn(() => ({ ok: true })),
      recordUsage: vi.fn(() => {
        throw new Error("budget journal failed");
      }),
      markUsageUnknown: vi.fn(),
    };
    const run = await manualRun({
      persistent: true,
      sessionBudget,
      fitting: true,
    });
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.appendUsage).toHaveBeenCalledOnce();
    expect(sessionBudget.recordUsage).toHaveBeenCalledOnce();
    expect(sessionBudget.markUsageUnknown).not.toHaveBeenCalled();
    expect(run.compact).not.toHaveBeenCalled();
    expect(run.observed).toHaveLength(10);
    expect(run.failure).toMatchObject({
      message: "budget journal failed",
      runtimeLedgerPersistence: true,
    });
  });
  it.each([false, true])(
    "settles once and keeps context on a genuine rejection (persistent=%s)",
    async (persistent) => {
      const run = await manualRun({ persistent });
      expect(run.query).toHaveBeenCalledOnce();
      expect(run.compact).not.toHaveBeenCalled();
      expect(run.observed).toHaveLength(11);
      expect(run.observed.at(-1).filter((m) => m.role === "user")).toHaveLength(
        11,
      );
      expect(
        run.events.filter(
          (e) => e.type === "token_usage" && e.source === "semantic-compaction",
        ),
      ).toHaveLength(1);
      expect(run.appendUsage).toHaveBeenCalledTimes(persistent ? 1 : 0);
      expect(run.events).toContainEqual(
        expect.objectContaining({
          type: "compaction-degraded",
          reason: "canonical_compaction_plan_rejected",
        }),
      );
      expect(
        run.events.some((e) => e.type === "compaction_usage_unknown"),
      ).toBe(false);
      expect(run.events.some((e) => e.type === "compaction")).toBe(false);
      expect(run.result.exitCode).toBe(0);
    },
  );
  it.each(["missing", "provider-error"])(
    "stops without another turn when usage is %s",
    async (kind) => {
      const run = await manualRun({ kind });
      expect(run.query).toHaveBeenCalledOnce();
      expect(run.observed).toHaveLength(10);
      expect(run.compact).not.toHaveBeenCalled();
      expect(run.events.filter((e) => e.type === "token_usage")).toHaveLength(
        0,
      );
      expect(
        run.events.filter((e) => e.type === "compaction_usage_unknown"),
      ).toHaveLength(1);
      expect(run.result.exitCode).toBe(1);
    },
  );
  it("counts the rejected summary once against the cost cap", async () => {
    const run = await manualRun({ costCap: 0.0001 });
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.observed).toHaveLength(10);
    expect(run.events.filter((e) => e.type === "token_usage")).toHaveLength(1);
    expect(
      run.events.filter((e) => e.type === "cost_budget_exhausted"),
    ).toHaveLength(1);
    expect(run.result.exitCode).toBe(1);
  });
  it("stops before commit when known usage cannot be persisted", async () => {
    const run = await manualRun({
      persistent: true,
      appendTokenUsage: () => {
        throw new Error("ledger fsync failed");
      },
    });
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.appendUsage).toHaveBeenCalledOnce();
    expect(run.compact).not.toHaveBeenCalled();
    expect(run.observed).toHaveLength(10);
    expect(run.events.some((e) => e.type === "compaction_usage_unknown")).toBe(
      false,
    );
    expect(run.failure).toMatchObject({
      message: "ledger fsync failed",
      runtimeLedgerPersistence: true,
    });
  });
  it("does not attest an asynchronous usage write as settled", async () => {
    const run = await manualRun({
      persistent: true,
      fitting: true,
      appendTokenUsage: () => Promise.reject(new Error("late write failure")),
    });
    expect(run.query).toHaveBeenCalledOnce();
    expect(run.appendUsage).toHaveBeenCalledOnce();
    expect(run.compact).not.toHaveBeenCalled();
    expect(run.observed).toHaveLength(10);
    expect(run.events.some((e) => e.type === "token_usage")).toBe(false);
    expect(run.failure).toMatchObject({ runtimeLedgerPersistence: true });
  });
});
