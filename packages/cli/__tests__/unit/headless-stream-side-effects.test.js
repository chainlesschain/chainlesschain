/**
 * Stream-mode side-effect ledger (P0-2) — the stream twin of the single-prompt
 * runner and the WS bridge. Two halves under test:
 *
 *  RECORD: a dangerous tool in a PERSISTED stream session is recorded
 *  prepare→start (snapshot persisted BEFORE it settles) and commit/fail on its
 *  tool-result, so a worker killed mid-flight leaves a reconcilable marker.
 *
 *  RECONCILE: resuming a session whose ledger holds a started-but-unsettled op
 *  emits a visible `raw`/`side_effect_recovery` line (the IDE panels map `raw`
 *  → an info line, zero IDE changes) AND injects a verify-before-replay system
 *  note ahead of the replayed history. A clean or absent ledger emits nothing.
 *
 * All ledger I/O is injected via `deps` (no disk, no vi.mock — CJS inlining
 * makes vi.mock useless here; see cli-dev.md `_deps` pattern).
 */
import { describe, it, expect, vi } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { SideEffectLedger } from "../../src/lib/side-effect-ledger.js";

function harness({ over = {}, options = {}, loop } = {}) {
  const lines = [];
  const seenTurns = [];
  const agentLoop =
    loop ||
    async function* (messages) {
      seenTurns.push(
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
      yield { type: "response-complete", content: "ok-reply" };
      yield { type: "run-ended", reason: "complete" };
    };
  async function* input() {
    yield JSON.stringify({ type: "user", text: "hello there" }) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    agentLoop,
    input: input(),
    sessionExists: () => false,
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    rebuildMessages: () => [],
    ...over,
  };
  const run = () =>
    runAgentHeadlessStream({ expandFileRefs: false, ...options }, deps);
  const events = () =>
    lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
  return { run, events, seenTurns };
}

/** A turn-capturing loop that also exercises one tool round-trip. */
function toolLoop(
  seenTurns,
  { tool, args, error = null, result = { ok: true } },
) {
  return async function* (messages) {
    seenTurns.push(messages.map((m) => ({ role: m.role, content: m.content })));
    yield { type: "tool-executing", tool, args };
    yield {
      type: "tool-result",
      tool,
      ...(error ? { error, result } : { result }),
    };
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", reason: "complete" };
  };
}

describe("stream side-effect ledger — resume reconcile + recovery notice", () => {
  it("resume with an interrupted (started) op emits the raw recovery line and the system note", async () => {
    const ledger = new SideEffectLedger();
    ledger
      .prepare("old:0", { kind: "git-push", key: "git push origin main" })
      .start("old:0");
    const loadSideEffectLedger = vi.fn(() => ledger);
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        sessionExists: () => true,
        rebuildMessages: () => [
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
        ],
        loadSideEffectLedger,
        persistSideEffectLedger: vi.fn(),
      },
    });
    await h.run();
    expect(loadSideEffectLedger).toHaveBeenCalledWith("chat-abc");

    // Visible notice: same raw info-line contract as provider_fallback.
    const ev = h
      .events()
      .find((e) => e.type === "raw" && e.subtype === "side_effect_recovery");
    expect(ev).toBeTruthy();
    expect(ev.count).toBe(1);
    expect(ev.items).toEqual([
      {
        kind: "git-push",
        key: "git push origin main",
        reason: expect.stringMatching(/started but not confirmed/),
      },
    ]);
    expect(ev.text).toContain("1 interrupted side-effect(s)");
    expect(ev.session_id).toBe("chat-abc");
    // init stays the first NDJSON line; the notice follows it.
    const all = h.events();
    expect(all[0].subtype).toBe("init");
    expect(
      all.findIndex((e) => e.subtype === "side_effect_recovery"),
    ).toBeGreaterThan(0);

    // Model-facing note: injected BEFORE the replayed history (runner parity).
    const roles = h.seenTurns[0].map((m) => m.role);
    expect(roles).toEqual(["system", "system", "user", "assistant", "user"]);
    expect(h.seenTurns[0][1].content).toContain("Recovery notice");
    expect(h.seenTurns[0][1].content).toContain("[git-push]");
  });

  it("resume with a clean (all committed) ledger emits no notice and injects no note", async () => {
    const ledger = new SideEffectLedger();
    ledger
      .prepare("old:0", { kind: "git-push", key: "git push origin main" })
      .start("old:0")
      .commit("old:0");
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        sessionExists: () => true,
        rebuildMessages: () => [
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
        ],
        loadSideEffectLedger: () => ledger,
        persistSideEffectLedger: vi.fn(),
      },
    });
    await h.run();
    expect(
      h.events().find((e) => e.subtype === "side_effect_recovery"),
    ).toBeUndefined();
    const roles = h.seenTurns[0].map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
  });

  it("an anonymous (non-persisted) run never touches the ledger and emits no notice", async () => {
    const loadSideEffectLedger = vi.fn(() => new SideEffectLedger());
    const h = harness({
      over: { loadSideEffectLedger, persistSideEffectLedger: vi.fn() },
    });
    await h.run();
    expect(loadSideEffectLedger).not.toHaveBeenCalled();
    expect(
      h.events().find((e) => e.subtype === "side_effect_recovery"),
    ).toBeUndefined();
  });

  it("a broken injected loader never fails the stream", async () => {
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        sessionExists: () => true,
        rebuildMessages: () => [{ role: "user", content: "q" }],
        loadSideEffectLedger: () => {
          throw new Error("disk full");
        },
        persistSideEffectLedger: vi.fn(),
      },
    });
    const outcome = await h.run();
    expect(outcome.exitCode).toBe(0);
    expect(
      h.events().find((e) => e.subtype === "side_effect_recovery"),
    ).toBeUndefined();
  });
});

describe("stream side-effect ledger — turn-time recording", () => {
  it("records a dangerous tool prepare→start (persisted pre-settle) then commit", async () => {
    const ledger = new SideEffectLedger();
    // Capture the ledger STATE at each persist call: the started snapshot must
    // land BEFORE the effect settles (the crash-safety invariant).
    const persistedStates = [];
    const persistSideEffectLedger = vi.fn((id, l) => {
      persistedStates.push(l.list().map((o) => o.state));
    });
    const seenTurns = [];
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        loadSideEffectLedger: () => ledger,
        persistSideEffectLedger,
      },
      loop: toolLoop(seenTurns, {
        tool: "write_file",
        args: { path: "a.txt", content: "x" },
      }),
    });
    await h.run();
    expect(persistSideEffectLedger).toHaveBeenCalledTimes(2);
    expect(persistSideEffectLedger.mock.calls[0][0]).toBe("chat-abc");
    expect(persistedStates).toEqual([["started"], ["committed"]]);
    const op = ledger.list()[0];
    expect(op.kind).toBe("file-write");
    expect(op.key).toBe("a.txt");
    expect(op.meta.tool).toBe("write_file");
    expect(op.meta.idempotencyKey).toBeTruthy();
  });

  it("a failing dangerous tool settles as failed with the error reason", async () => {
    const ledger = new SideEffectLedger();
    const seenTurns = [];
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        loadSideEffectLedger: () => ledger,
        persistSideEffectLedger: vi.fn(),
      },
      loop: toolLoop(seenTurns, {
        tool: "run_shell",
        args: { command: "npm publish" },
        error: "boom",
      }),
    });
    await h.run();
    const op = ledger.list()[0];
    expect(op.state).toBe("failed");
    expect(op.reason).toBe("boom");
  });

  it("persists a Diff Review audit on the matching file-write effect", async () => {
    const ledger = new SideEffectLedger();
    const audit = {
      schema: "cc-diff-review/v1",
      reviewId: "drev_123",
      sessionId: "chat-abc",
      turnId: "run-1:t2",
      toolUseId: "call-7",
      outcome: "accepted",
    };
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        loadSideEffectLedger: () => ledger,
        persistSideEffectLedger: vi.fn(),
      },
      loop: toolLoop([], {
        tool: "write_file",
        args: { path: "a.txt", content: "x" },
        result: { ok: true, _diffReviewAudit: audit },
      }),
    });
    await h.run();
    expect(ledger.list()[0]).toMatchObject({
      state: "committed",
      meta: { diffReview: audit },
    });
  });

  it("persists the actual review outcome after Request Changes", async () => {
    const ledger = new SideEffectLedger();
    const requested = {
      schema: "cc-diff-review/v1",
      reviewId: "drev_request",
      sessionId: "chat-abc",
      turnId: "run-1:t1",
      toolUseId: "call-1",
      path: "/repo/a.txt",
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
        args: { path: "a.txt", content: "first" },
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
        args: { path: "a.txt", content: "revised" },
      };
      yield {
        type: "tool-result",
        tool: "write_file",
        result: { ok: true, _diffReviewAudit: accepted },
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        loadSideEffectLedger: () => ledger,
        persistSideEffectLedger: vi.fn(),
      },
      loop,
    });
    await h.run();

    expect(ledger.list()[0]).toMatchObject({
      state: "failed",
      meta: {
        diffReview: {
          reviewId: "drev_request",
          followUp: {
            status: "accepted",
            reviewId: "drev_accept",
            turnId: "run-1:t2",
            toolUseId: "call-2",
            written: true,
          },
        },
      },
    });
    expect(ledger.list()[1]).toMatchObject({
      state: "committed",
      meta: {
        diffReview: {
          ...accepted,
          followUpOfReviewId: "drev_request",
        },
      },
    });
  });

  it("records when the turn completes without another Diff proposal", async () => {
    const ledger = new SideEffectLedger();
    const requested = {
      schema: "cc-diff-review/v1",
      reviewId: "drev_request",
      sessionId: "chat-abc",
      turnId: "run-1:t1",
      toolUseId: "call-1",
      path: "/repo/a.txt",
      operation: "modify",
      outcome: "changes-requested",
      written: false,
    };
    const h = harness({
      options: { sessionId: "chat-abc" },
      over: {
        loadSideEffectLedger: () => ledger,
        persistSideEffectLedger: vi.fn(),
      },
      loop: toolLoop([], {
        tool: "write_file",
        args: { path: "a.txt", content: "first" },
        result: {
          error: "changes requested",
          _diffReviewAudit: requested,
        },
      }),
    });
    await h.run();

    expect(ledger.list()[0].meta.diffReview.followUp).toEqual({
      status: "completed-without-reproposal",
      turnId: null,
      reason: null,
    });
  });

  it("read-only tools and non-persisted sessions record nothing", async () => {
    // Persisted session, non-dangerous tool → classify returns null.
    const ledger = new SideEffectLedger();
    const persistA = vi.fn();
    const hA = harness({
      options: { sessionId: "chat-abc" },
      over: {
        loadSideEffectLedger: () => ledger,
        persistSideEffectLedger: persistA,
      },
      loop: toolLoop([], { tool: "read_file", args: { path: "a.txt" } }),
    });
    await hA.run();
    expect(persistA).not.toHaveBeenCalled();
    expect(ledger.list()).toHaveLength(0);

    // Anonymous session, dangerous tool → ledger inactive entirely.
    const persistB = vi.fn();
    const hB = harness({
      over: { persistSideEffectLedger: persistB },
      loop: toolLoop([], {
        tool: "write_file",
        args: { path: "a.txt", content: "x" },
      }),
    });
    await hB.run();
    expect(persistB).not.toHaveBeenCalled();
  });
});
