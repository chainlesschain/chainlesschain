/**
 * Integration (P0-2): the headless runner records an irreversible tool call as
 * an in-flight side-effect and, on `--resume` after a mid-flight crash, surfaces
 * it for verification instead of letting the model blindly replay it.
 *
 * Run 1 yields a `tool-executing` for `git push` but NEVER the matching
 * `tool-result` (simulating a worker killed mid-flight); the ledger op stays
 * `started` and is persisted. Run 2 resumes the same session and must inject a
 * "Recovery notice" system message + emit a stderr warning.
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import {
  SideEffectLedger,
  countDuplicateCommittedEffects,
} from "../../src/lib/side-effect-ledger.js";

/** Rebuild the latest persisted ledger from an in-memory event log. */
function latestLedger(events) {
  const snap = [...events]
    .reverse()
    .find((e) => e.type === "side_effect_ledger");
  return snap ? SideEffectLedger.fromJSON(snap.data) : new SideEffectLedger();
}

function makeStore() {
  const events = [];
  let started = false;
  return {
    events,
    deps: {
      sessionExists: () => started,
      rebuildMessages: () => [
        { role: "user", content: "push the branch" },
        { role: "assistant", content: "pushing" },
      ],
      startSession: () => {
        started = true;
      },
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendTokenUsage: () => {},
      appendCompactEvent: () => {},
      appendToolCallCompact: () => {},
      appendEvent: (_sid, type, data) => {
        events.push({ type, data });
      },
      readEvents: () => events.slice(),
      getLastSessionId: () => "sid",
      verifySession: () => ({ status: "ok" }),
    },
  };
}

function baseDeps(store, agentLoop, now = () => 1000) {
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: () => {},
    now,
    agentLoop,
    ...store.deps,
  };
}

describe("headless side-effect ledger — record + resume reconcile", () => {
  it("records a mid-flight git push and flags it for verification on resume", async () => {
    const store = makeStore();

    // ── Run 1: git push starts but the run dies before tool-result ──────────
    const crashLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "git",
        args: { command: "push origin main" },
      };
      // No tool-result — the worker "crashed" mid-push.
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "push it",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 1000,
      },
      baseDeps(store, crashLoop),
    );

    // A started (unsettled) side-effect snapshot must be on disk.
    const snap = [...store.events]
      .reverse()
      .find((e) => e.type === "side_effect_ledger");
    expect(snap).toBeTruthy();
    expect(
      snap.data.ops.some((o) => o.kind === "git-push" && o.state === "started"),
    ).toBe(true);

    // ── Run 2: resume — the recovery notice must reach the model + stderr ────
    let capturedMessages = null;
    let stderr = "";
    const resumeLoop = async function* (messages) {
      capturedMessages = messages;
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 2000,
      },
      {
        ...baseDeps(store, resumeLoop),
        writeErr: (s) => {
          stderr += s;
        },
      },
    );

    expect(stderr).toMatch(/interrupted side-effect/i);
    const recovery = (capturedMessages || []).find(
      (m) => m.role === "system" && /Recovery notice/.test(String(m.content)),
    );
    expect(recovery).toBeTruthy();
    expect(recovery.content).toMatch(/git-push/);
  });

  it("does NOT flag anything when the tool completed cleanly before crash", async () => {
    const store = makeStore();

    // Run 1: git push starts AND completes (tool-result, no error) → committed.
    const okLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "git",
        args: { command: "push origin main" },
      };
      yield { type: "tool-result", tool: "git", result: { ok: true } };
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "push it",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 1000,
      },
      baseDeps(store, okLoop),
    );

    let capturedMessages = null;
    let stderr = "";
    const resumeLoop = async function* (messages) {
      capturedMessages = messages;
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 2000,
      },
      {
        ...baseDeps(store, resumeLoop),
        writeErr: (s) => {
          stderr += s;
        },
      },
    );

    expect(stderr).not.toMatch(/interrupted side-effect/i);
    const recovery = (capturedMessages || []).find(
      (m) => m.role === "system" && /Recovery notice/.test(String(m.content)),
    );
    expect(recovery).toBeFalsy();
  });

  it("does not record side-effects for read-only tools (no false resume warnings)", async () => {
    const store = makeStore();
    const readLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "read_file",
        args: { path: "a.js" },
      };
      yield {
        type: "tool-result",
        tool: "read_file",
        result: { content: "x" },
      };
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "read",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 1000,
      },
      baseDeps(store, readLoop),
    );
    // A read_file must never produce a side_effect_ledger event.
    expect(store.events.some((e) => e.type === "side_effect_ledger")).toBe(
      false,
    );
  });

  it("fails closed before a dangerous tool when the STARTED snapshot cannot persist", async () => {
    const store = makeStore();
    let effectExecuted = false;
    const loop = async function* () {
      yield {
        type: "tool-executing",
        tool: "write_file",
        args: { path: "blocked.txt", content: "must-not-run" },
      };
      effectExecuted = true;
      yield {
        type: "tool-result",
        tool: "write_file",
        result: { ok: true },
      };
    };
    const deps = baseDeps(store, loop);
    deps.appendEvent = (_sessionId, type, data) => {
      if (type === "side_effect_ledger") throw new Error("ledger disk full");
      store.events.push({ type, data });
    };

    const outcome = await runAgentHeadless(
      {
        prompt: "write",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
      },
      deps,
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.result).toMatch(/ledger disk full/);
    expect(effectExecuted).toBe(false);
  });

  it("fails closed before a dangerous tool when prior ledger state cannot be read", async () => {
    const store = makeStore();
    let effectExecuted = false;
    const loop = async function* () {
      yield {
        type: "tool-executing",
        tool: "git",
        args: { command: "push origin main" },
      };
      effectExecuted = true;
      yield {
        type: "tool-result",
        tool: "git",
        result: { ok: true },
      };
    };
    const deps = baseDeps(store, loop);
    deps.readEvents = () => {
      throw new Error("ledger read unavailable");
    };

    const outcome = await runAgentHeadless(
      {
        prompt: "push",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
      },
      deps,
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.result).toMatch(/ledger read unavailable/);
    expect(effectExecuted).toBe(false);
  });

  it("links a revised Diff proposal to the Request Changes ledger record", async () => {
    const store = makeStore();
    const requested = {
      schema: "cc-diff-review/v1",
      reviewId: "drev_request",
      sessionId: "sid",
      turnId: "run-1:t1",
      toolUseId: "call-1",
      path: "/repo/a.js",
      operation: "modify",
      outcome: "changes-requested",
      written: false,
    };
    const accepted = {
      ...requested,
      reviewId: "drev_accept",
      turnId: "run-1:t2",
      toolUseId: "call-2",
      outcome: "accepted",
      written: true,
    };
    const loop = async function* () {
      yield {
        type: "tool-executing",
        tool: "write_file",
        args: { path: "a.js", content: "first" },
      };
      yield {
        type: "tool-result",
        tool: "write_file",
        result: {
          error: "changes requested",
          _diffReviewAudit: requested,
        },
      };
      yield {
        type: "tool-executing",
        tool: "write_file",
        args: { path: "a.js", content: "revised" },
      };
      yield {
        type: "tool-result",
        tool: "write_file",
        result: { ok: true, _diffReviewAudit: accepted },
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "edit",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 1000,
      },
      baseDeps(store, loop),
    );

    const ledger = latestLedger(store.events);
    expect(ledger.list()[0].meta.diffReview.followUp).toMatchObject({
      status: "accepted",
      reviewId: "drev_accept",
      turnId: "run-1:t2",
      toolUseId: "call-2",
      written: true,
    });
    expect(ledger.list()[1].meta.diffReview).toMatchObject({
      reviewId: "drev_accept",
      outcome: "accepted",
    });
  });

  it("kill-point metric: a correct resume yields 0 duplicate committed effects", async () => {
    const store = makeStore();
    // Run 1: git push completes cleanly (committed under idempotency key K).
    const okLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "git",
        args: { command: "push origin main" },
      };
      yield { type: "tool-result", tool: "git", result: { ok: true } };
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "push",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 1000,
      },
      baseDeps(store, okLoop),
    );

    // Run 2: a CORRECT resume — the model heeds the recovery guidance and does
    // NOT re-issue the push.
    const noReplayLoop = async function* () {
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 2000,
      },
      baseDeps(store, noReplayLoop),
    );

    expect(countDuplicateCommittedEffects(latestLedger(store.events))).toBe(0);
  });

  it("kill-point metric: the SAME push committed twice is detected as 1 duplicate", async () => {
    const store = makeStore();
    const pushLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "git",
        args: { command: "push origin main" },
      };
      yield { type: "tool-result", tool: "git", result: { ok: true } };
      yield { type: "run-ended", reason: "complete" };
    };
    // Run 1 commits the push.
    await runAgentHeadless(
      {
        prompt: "push",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 1000,
      },
      baseDeps(store, pushLoop),
    );
    // Run 2 (resume) blindly re-issues the IDENTICAL push — a naive replay the
    // metric must catch (same idempotency key committed a second time). A
    // distinct run clock gives the replay a fresh opId (real runs differ by
    // wall-clock), so it is a genuine second commit, not a no-op.
    await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
      },
      baseDeps(store, pushLoop, () => 2000),
    );

    expect(countDuplicateCommittedEffects(latestLedger(store.events))).toBe(1);
  });
});

/** Fake background phase reporter (mirrors background-phase-reporter's API). */
function makeFakeReporter(enabled = true) {
  const calls = [];
  return {
    calls,
    enabled,
    reportUncertainSideEffects(n) {
      calls.push(["uncertain", n]);
      return true;
    },
    reportQuestion(q) {
      calls.push(["question", q]);
      return true;
    },
    wrapConfirmer(c) {
      return c;
    },
    beginApproval() {},
    endApproval() {},
    pendingCount() {
      return 0;
    },
  };
}

describe("background state-machine producers (uncertain_side_effect + needs_input)", () => {
  it("a background child resuming with UNKNOWN-outcome ops reports uncertain_side_effect", async () => {
    const store = makeStore();
    const crashLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "git",
        args: { command: "push origin main" },
      };
      yield { type: "run-ended", reason: "complete" }; // no tool-result → started/unsettled
    };
    await runAgentHeadless(
      {
        prompt: "push it",
        sessionId: "sid",
        persistSession: true,
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 1000,
      },
      baseDeps(store, crashLoop),
    );

    const reporter = makeFakeReporter(true);
    const resumeLoop = async function* () {
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "continue",
        resume: "sid",
        outputFormat: "json",
        expandFileRefs: false,
        now: () => 2000,
      },
      {
        ...baseDeps(store, resumeLoop),
        writeErr: () => {},
        backgroundPhaseReporter: reporter,
      },
    );

    expect(reporter.calls).toContainEqual(["uncertain", 1]);
  });

  it("a background child resolves ask_user_question inside the same turn", async () => {
    const store = makeStore();
    const reporter = makeFakeReporter(true);
    const backgroundInteractionClient = {
      request: vi.fn(async () => "yes"),
      close: vi.fn(),
    };
    let loopOptions = null;
    const loop = async function* (_messages, options) {
      loopOptions = options;
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "ask me something",
        outputFormat: "json",
        expandFileRefs: false,
        persistSession: false,
      },
      {
        ...baseDeps(store, loop),
        backgroundPhaseReporter: reporter,
        backgroundInteractionClient,
      },
    );

    expect(loopOptions.interaction).toBeTruthy();
    await expect(
      loopOptions.interaction.askUser({
        question: "Deploy to prod?",
        options: ["yes", "no"],
        toolUseId: "tool-call-1",
        turnId: "turn-1",
      }),
    ).resolves.toBe("yes");
    expect(backgroundInteractionClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "question",
        question: "Deploy to prod?",
        options: ["yes", "no"],
        toolUseId: "tool-call-1",
        turnId: "turn-1",
      }),
    );
    expect(reporter.calls).toContainEqual([
      "question",
      { question: "Deploy to prod?", options: ["yes", "no"] },
    ]);
  });

  it("a non-background run supplies NO interaction (user_not_reachable path unchanged)", async () => {
    const store = makeStore();
    const reporter = makeFakeReporter(false); // disabled — foreground run
    let loopOptions = null;
    const loop = async function* (_messages, options) {
      loopOptions = options;
      yield { type: "run-ended", reason: "complete" };
    };
    await runAgentHeadless(
      {
        prompt: "hello",
        outputFormat: "json",
        expandFileRefs: false,
        persistSession: false,
      },
      { ...baseDeps(store, loop), backgroundPhaseReporter: reporter },
    );

    expect(loopOptions.interaction).toBeUndefined();
    expect(reporter.calls).toEqual([]);
  });
});
