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

function baseDeps(store, agentLoop) {
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: () => {},
    now: () => 1000,
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
});
