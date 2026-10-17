import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgentHeadless } from "../helpers/test-model-egress.js";
import { openDecisionProviderAuthority } from "../../src/lib/decision-layer/provider-authority.js";
import { runMeteredDirectModelCall } from "../../src/lib/direct-model-usage.js";
import {
  openSessionBudget,
  SessionBudgetSidecarStore,
} from "../../src/lib/session-budget-runtime.js";
import {
  readProductionSessionBudget,
  resolveSessionBudgetRootOptions,
} from "../../src/lib/session-budget-production-root.js";
import { _registerTestScopedSessionAntiRollbackDirectory } from "../../src/lib/session-anti-rollback-anchor.js";
import {
  appendEvent,
  findLatestEvent,
  sessionPath,
  startSession,
} from "../../src/harness/jsonl-session-store.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function makeBudgetStore() {
  return new SessionBudgetSidecarStore({
    resolvePath: (sessionId) => path.join(home, `${sessionId}.budget.json`),
    allowUnsupportedPlatformForTests: true,
  });
}

let home;
let previousHome;
let previousAnchorHome;

beforeEach(() => {
  previousHome = process.env.CHAINLESSCHAIN_HOME;
  previousAnchorHome = process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-decision-resume-"));
  process.env.CHAINLESSCHAIN_HOME = home;
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = `${home}-anchors`;
  _registerTestScopedSessionAntiRollbackDirectory({
    homeDir: home,
    anchorBase: `${home}-anchors`,
  });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
  else process.env.CHAINLESSCHAIN_HOME = previousHome;
  if (previousAnchorHome === undefined)
    delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  else process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = previousAnchorHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(`${home}-anchors`, { recursive: true, force: true });
});

function makeRun(decide, sessionId, resume = false) {
  const decisions = [];
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: () => {},
    writeErr: () => {},
    decisionProvider: openDecisionProviderAuthority({
      provider: "typesafe",
      model: "jev-test",
      decide,
    }),
    agentLoop: async function* (_messages, options) {
      decisions.push(
        await options.skillDecisionRuntime.suggest({
          query: "repair tests",
          candidates: [
            {
              id: "repair-tests",
              displayName: "Repair tests",
              description: "Repair failing tests",
              digest: digest("repair-tests"),
            },
          ],
          turnId: "turn-1",
        }),
      );
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    },
  };
  const options = {
    prompt: "repair tests",
    sessionId,
    ...(resume ? { resume: sessionId } : { persistSession: true }),
    decisionMode: "suggest",
    hermeticExecution: true,
  };
  return { options, deps, decisions };
}

const validAnswer = {
  provider: "typesafe",
  model: "jev-test",
  answers: {
    needs_skill: { type: "noul", noul: 0.95 },
    best_skill: {
      type: "choice",
      choice: "c1",
      confidence: 0.9,
      probabilities: { c1: 0.96, none: 0.04 },
    },
    fits_c1: { type: "noul", noul: 0.94 },
  },
  usage: { input_tokens: 12, output_tokens: 4 },
};

describe("headless decision usage recovery with real JSONL", () => {
  it("charges known decision usage to the production session budget root", async () => {
    const sessionId = "decision-production-budget-known";
    const budgetStore = makeBudgetStore();
    const decide = vi.fn().mockResolvedValue(validAnswer);
    const run = makeRun(decide, sessionId);
    run.options.sessionBudgetRoot = resolveSessionBudgetRootOptions({
      sessionMaxTurns: 2,
      sessionMaxTokens: 40,
    });
    run.deps.sessionBudgetStore = budgetStore;
    run.deps.sessionBudgetRegistry = new Map();

    expect(await runAgentHeadless(run.options, run.deps)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    expect(run.decisions[0]).toMatchObject({ status: "suggestion" });
    expect(decide).toHaveBeenCalledOnce();
    expect(
      findLatestEvent(sessionId, "session_start")?.data.sessionBudgetRoot,
    ).toMatchObject({
      enabled: true,
      limits: { maxTurns: 2, maxTokens: 40 },
    });
    expect(
      readProductionSessionBudget(sessionId, { store: budgetStore }),
    ).toMatchObject({
      usageUnknown: false,
      totals: { turns: 1, tokens: 16 },
      recoveryRequired: false,
    });

    const resumed = makeRun(decide, sessionId, true);
    resumed.deps.sessionBudgetStore = budgetStore;
    resumed.deps.sessionBudgetRegistry = new Map();
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      {
        exitCode: 0,
        isError: false,
      },
    );
    expect(resumed.decisions[0]).toMatchObject({ status: "suggestion" });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(
      readProductionSessionBudget(sessionId, { store: budgetStore }),
    ).toMatchObject({
      totals: { turns: 2, tokens: 32 },
      recoveryRequired: false,
    });

    const exhausted = makeRun(decide, sessionId, true);
    exhausted.deps.sessionBudgetStore = budgetStore;
    exhausted.deps.sessionBudgetRegistry = new Map();
    expect(
      await runAgentHeadless(exhausted.options, exhausted.deps),
    ).toMatchObject({
      exitCode: 1,
      isError: true,
    });
    expect(exhausted.decisions).toHaveLength(0);
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("keeps the production budget root in recovery when decision usage is unknown", async () => {
    const sessionId = "decision-production-budget-unknown";
    const budgetStore = makeBudgetStore();
    const decide = vi
      .fn()
      .mockResolvedValue({ ...validAnswer, usage: undefined });
    const run = makeRun(decide, sessionId);
    run.options.sessionBudgetRoot = resolveSessionBudgetRootOptions({
      sessionMaxTurns: 2,
      sessionMaxTokens: 40,
    });
    run.deps.sessionBudgetStore = budgetStore;
    run.deps.sessionBudgetRegistry = new Map();

    expect(await runAgentHeadless(run.options, run.deps)).toMatchObject({
      exitCode: 1,
      isError: true,
    });
    expect(decide).toHaveBeenCalledOnce();
    expect(
      readProductionSessionBudget(sessionId, { store: budgetStore }),
    ).toMatchObject({
      usageUnknown: true,
      recoveryRequired: true,
      pendingRecovery: [expect.objectContaining({ kind: "usage-settlement" })],
    });

    const resumed = makeRun(decide, sessionId, true);
    resumed.deps.sessionBudgetStore = budgetStore;
    resumed.deps.sessionBudgetRegistry = new Map();
    await expect(
      runAgentHeadless(resumed.options, resumed.deps),
    ).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_RECOVERY_REQUIRED",
    });
    expect(resumed.decisions).toHaveLength(0);
    expect(decide).toHaveBeenCalledOnce();
  });

  it("refuses a changed budget declaration before another decision", async () => {
    const sessionId = "decision-production-budget-mismatch";
    const budgetStore = makeBudgetStore();
    const decide = vi.fn().mockResolvedValue(validAnswer);
    const first = makeRun(decide, sessionId);
    first.options.sessionBudgetRoot = resolveSessionBudgetRootOptions({
      sessionMaxTurns: 2,
      sessionMaxTokens: 40,
    });
    first.deps.sessionBudgetStore = budgetStore;
    first.deps.sessionBudgetRegistry = new Map();
    expect(await runAgentHeadless(first.options, first.deps)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    const before = readProductionSessionBudget(sessionId, {
      store: budgetStore,
    });

    const resumed = makeRun(decide, sessionId, true);
    resumed.options.sessionBudgetRoot = resolveSessionBudgetRootOptions({
      sessionMaxTurns: 3,
      sessionMaxTokens: 40,
    });
    resumed.deps.sessionBudgetStore = budgetStore;
    resumed.deps.sessionBudgetRegistry = new Map();
    await expect(
      runAgentHeadless(resumed.options, resumed.deps),
    ).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_CONFIG_MISMATCH",
    });
    expect(resumed.decisions).toHaveLength(0);
    expect(decide).toHaveBeenCalledOnce();
    expect(
      readProductionSessionBudget(sessionId, { store: budgetStore }).revision,
    ).toBe(before.revision);
  });

  it("refuses a budgeted session whose sidecar disappeared", async () => {
    const sessionId = "decision-production-budget-missing-sidecar";
    const budgetStore = makeBudgetStore();
    const decide = vi.fn().mockResolvedValue(validAnswer);
    const first = makeRun(decide, sessionId);
    first.options.sessionBudgetRoot = resolveSessionBudgetRootOptions({
      sessionMaxTurns: 2,
      sessionMaxTokens: 40,
    });
    first.deps.sessionBudgetStore = budgetStore;
    first.deps.sessionBudgetRegistry = new Map();
    expect(await runAgentHeadless(first.options, first.deps)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    fs.rmSync(budgetStore.pathForSession(sessionId));

    const resumed = makeRun(decide, sessionId, true);
    resumed.deps.sessionBudgetStore = budgetStore;
    resumed.deps.sessionBudgetRegistry = new Map();
    await expect(
      runAgentHeadless(resumed.options, resumed.deps),
    ).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_SIDECAR_REQUIRED",
    });
    expect(resumed.decisions).toHaveLength(0);
    expect(decide).toHaveBeenCalledOnce();
  });

  it("refuses to add a budget root to an existing unbudgeted transcript", async () => {
    const sessionId = "decision-budget-late-declaration";
    startSession(sessionId);
    const budgetStore = makeBudgetStore();
    const decide = vi.fn();
    const resumed = makeRun(decide, sessionId, true);
    resumed.options.sessionBudgetRoot = resolveSessionBudgetRootOptions({
      sessionMaxTurns: 2,
    });
    resumed.deps.sessionBudgetStore = budgetStore;
    resumed.deps.sessionBudgetRegistry = new Map();

    await expect(
      runAgentHeadless(resumed.options, resumed.deps),
    ).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_JSONL_REQUIRED",
    });
    expect(decide).not.toHaveBeenCalled();
    expect(
      readProductionSessionBudget(sessionId, { store: budgetStore }),
    ).toBeNull();
  });

  it("refuses an orphan budget sidecar without a canonical transcript", async () => {
    const sessionId = "decision-budget-orphan-sidecar";
    const budgetStore = makeBudgetStore();
    const orphan = openSessionBudget(sessionId, {
      store: budgetStore,
      registry: new Map(),
      limits: { maxTurns: 1 },
    });
    orphan.close();
    const decide = vi.fn();
    const run = makeRun(decide, sessionId);
    run.deps.sessionBudgetStore = budgetStore;
    run.deps.sessionBudgetRegistry = new Map();

    await expect(runAgentHeadless(run.options, run.deps)).rejects.toMatchObject(
      {
        code: "CC_SESSION_BUDGET_JSONL_REQUIRED",
      },
    );
    expect(decide).not.toHaveBeenCalled();
    expect(findLatestEvent(sessionId, "session_start")).toBeNull();
  });

  it("blocks a resumed decision when a durable start has no settlement", async () => {
    const sessionId = "decision-usage-started-only";
    startSession(sessionId);
    appendEvent(sessionId, "model_usage_started", {
      callId: "direct-crash-before-settlement",
      provider: "typesafe",
      model: "jev-test",
      source: "model",
      operationId: "decision:crashed",
    });

    const decide = vi.fn().mockResolvedValue(validAnswer);
    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      {
        exitCode: 0,
        isError: false,
      },
    );
    expect(resumed.decisions[0]).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
      selectedDigest: null,
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not settle a decision start with another operation's token row", async () => {
    const sessionId = "decision-usage-wrong-settlement";
    startSession(sessionId);
    appendEvent(sessionId, "model_usage_started", {
      callId: "direct-same-call-id",
      provider: "typesafe",
      model: "jev-test",
      source: "model",
      operationId: "decision:crashed",
    });
    appendEvent(sessionId, "token_usage", {
      callId: "direct-same-call-id",
      provider: "typesafe",
      model: "jev-test",
      source: "model",
      operationId: "agent:other",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const decide = vi.fn().mockResolvedValue(validAnswer);
    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      {
        exitCode: 0,
        isError: false,
      },
    );
    expect(resumed.decisions[0]).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not treat a malformed token row as a decision settlement", async () => {
    const sessionId = "decision-usage-malformed-settlement";
    startSession(sessionId);
    const identity = {
      callId: "direct-malformed-settlement",
      provider: "typesafe",
      model: "jev-test",
      source: "model",
      operationId: "decision:crashed",
    };
    appendEvent(sessionId, "model_usage_started", identity);
    appendEvent(sessionId, "token_usage", identity);

    const decide = vi.fn().mockResolvedValue(validAnswer);
    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      {
        exitCode: 0,
        isError: false,
      },
    );
    expect(resumed.decisions[0]).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("resumes after a durably canceled pre-dispatch decision without unknown usage", async () => {
    const sessionId = "decision-usage-not-dispatched";
    startSession(sessionId);
    const controller = new AbortController();
    const reason = new DOMException("user canceled", "AbortError");
    const call = vi.fn();
    await expect(
      runMeteredDirectModelCall({
        sessionId,
        persist: (type, data) => {
          appendEvent(sessionId, type, data);
          if (type === "model_usage_started") controller.abort(reason);
        },
        provider: "typesafe",
        model: "jev-test",
        operationId: "decision:pre-dispatch",
        dispatchSignal: controller.signal,
        call,
      }),
    ).rejects.toBe(reason);
    expect(call).not.toHaveBeenCalled();
    expect(findLatestEvent(sessionId, "model_usage_unknown")).toBeNull();
    expect(findLatestEvent(sessionId, "token_usage")?.data).toMatchObject({
      settlementOrigin: "local-no-dispatch",
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const decide = vi.fn().mockResolvedValue(validAnswer);
    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      {
        exitCode: 0,
        isError: false,
      },
    );
    expect(resumed.decisions[0]).toMatchObject({ status: "suggestion" });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("does not confuse an unrelated model usage event with decision usage", async () => {
    const sessionId = "decision-usage-unrelated";
    startSession(sessionId);
    await runMeteredDirectModelCall({
      sessionId,
      persist: (type, data) => appendEvent(sessionId, type, data),
      provider: "main-model",
      model: "main-model-test",
      operationId: "agent:main",
      call: async () => ({}),
    });
    expect(findLatestEvent(sessionId, "model_usage_unknown")).not.toBeNull();

    const decide = vi.fn().mockResolvedValue(validAnswer);
    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      { exitCode: 0, isError: false },
    );
    expect(resumed.decisions[0]).toMatchObject({ status: "suggestion" });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("blocks resumed decision calls after unknown usage in a verified transcript", async () => {
    const sessionId = "decision-usage-resume";
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ...validAnswer, usage: undefined })
      .mockResolvedValue(validAnswer);
    const first = makeRun(decide, sessionId);
    expect(await runAgentHeadless(first.options, first.deps)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    expect(first.decisions[0]).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown",
    });
    expect(
      findLatestEvent(sessionId, "model_usage_unknown", (event) =>
        event.data?.operationId?.startsWith("decision:"),
      ),
    ).not.toBeNull();

    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      {
        exitCode: 0,
        isError: false,
      },
    );
    expect(resumed.decisions[0]).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
      selectedDigest: null,
    });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("does not use a tampered transcript to authorize another decision", async () => {
    const sessionId = "decision-usage-tampered";
    const decide = vi.fn().mockResolvedValue({
      ...validAnswer,
      usage: undefined,
    });
    const first = makeRun(decide, sessionId);
    expect(await runAgentHeadless(first.options, first.deps)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    const file = sessionPath(sessionId);
    const transcript = fs.readFileSync(file, "utf8");
    expect(transcript).toContain("model_usage_unknown");
    fs.writeFileSync(
      file,
      transcript.replace("model_usage_unknown", "model_usage_settled"),
    );

    const resumed = makeRun(decide, sessionId, true);
    const result = await runAgentHeadless(resumed.options, resumed.deps);
    expect(result).toMatchObject({ exitCode: 1, isError: true });
    expect(resumed.decisions).toHaveLength(0);
    expect(decide).toHaveBeenCalledOnce();
  });
});
