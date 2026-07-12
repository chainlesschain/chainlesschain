/**
 * Unified hook event bus (P2 "Hooks 统一事件总线与 Replay") — versioned
 * envelope + delivery id, strictest-decision merge, same-handler dedup, and the
 * decision-hook-replay-requires-sandbox policy. Pure CJS module.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const bus = require("../../src/lib/hook-event-bus.cjs");

const {
  HOOK_EVENT_TYPES,
  isKnownEvent,
  isDecisionEvent,
  buildHookEnvelope,
  computeEventId,
  mergeHookDecisions,
  normalizeDecision,
  decisionRank,
  dedupeHooks,
  planHookReplay,
  _resetSeq,
} = bus;

beforeEach(() => _resetSeq());

describe("event registry", () => {
  it("unions the live settings events with the new P2 events", () => {
    for (const e of [
      "PreToolUse",
      "UserPromptSubmit",
      "SubagentStart",
      "SubagentStop",
      "ConfigChange",
      "PermissionRequest",
      // new
      "PermissionDenied",
      "TaskCreated",
      "TaskCompleted",
      "InstructionsLoaded",
      "CwdChanged",
      "WorktreeCreate",
      "WorktreeRemove",
      "MCPElicitation",
    ]) {
      expect(isKnownEvent(e)).toBe(true);
    }
    expect(isKnownEvent("NopeEvent")).toBe(false);
  });

  it("classifies flow-gating events as decision events", () => {
    expect(isDecisionEvent(HOOK_EVENT_TYPES.PreToolUse)).toBe(true);
    expect(isDecisionEvent(HOOK_EVENT_TYPES.UserPromptSubmit)).toBe(true);
    expect(isDecisionEvent(HOOK_EVENT_TYPES.PermissionRequest)).toBe(true);
    expect(isDecisionEvent(HOOK_EVENT_TYPES.Stop)).toBe(true);
    // observe-only
    expect(isDecisionEvent(HOOK_EVENT_TYPES.PostToolUse)).toBe(false);
    expect(isDecisionEvent(HOOK_EVENT_TYPES.PermissionDenied)).toBe(false);
    expect(isDecisionEvent(HOOK_EVENT_TYPES.CwdChanged)).toBe(false);
  });
});

describe("buildHookEnvelope", () => {
  it("carries the versioned envelope with delivery/trace/parent ids", () => {
    const env = buildHookEnvelope({
      eventType: "PreToolUse",
      data: { tool_name: "run_shell" },
      sessionId: "s1",
      traceId: "tr-abc",
      parentId: "sub-1",
      seq: 1,
      now: 1000,
    });
    expect(env).toMatchObject({
      schema_version: 1,
      event_type: "PreToolUse",
      trace_id: "tr-abc",
      parent_id: "sub-1",
      session_id: "s1",
      timestamp: 1000,
      data: { tool_name: "run_shell" },
    });
    expect(env.event_id).toMatch(/^evt_[0-9a-f]{16}$/);
  });

  it("delivery id is deterministic in content but unique per delivery (seq)", () => {
    const a = buildHookEnvelope({
      eventType: "Stop",
      data: { x: 1 },
      sessionId: "s",
      seq: 5,
    });
    const b = buildHookEnvelope({
      eventType: "Stop",
      data: { x: 1 },
      sessionId: "s",
      seq: 5,
    });
    const c = buildHookEnvelope({
      eventType: "Stop",
      data: { x: 1 },
      sessionId: "s",
      seq: 6,
    });
    expect(a.event_id).toBe(b.event_id); // same inputs → same id
    expect(a.event_id).not.toBe(c.event_id); // different seq → different id
  });

  it("computeEventId is key-order independent for the data payload", () => {
    expect(computeEventId("E", "s", 1, { a: 1, b: 2 })).toBe(
      computeEventId("E", "s", 1, { b: 2, a: 1 }),
    );
  });

  it("auto-increments the delivery sequence when seq is omitted", () => {
    const a = buildHookEnvelope({ eventType: "Stop", data: {} });
    const b = buildHookEnvelope({ eventType: "Stop", data: {} });
    expect(a.event_id).not.toBe(b.event_id);
  });
});

describe("mergeHookDecisions (strictest-wins, unlike in-order first-wins)", () => {
  it("block beats ask beats allow beats continue", () => {
    expect(
      mergeHookDecisions([
        { decision: "allow", hook: "a" },
        { decision: "ask", hook: "b" },
        { decision: "block", hook: "c", reason: "no" },
      ]).decision,
    ).toBe("block");
    expect(
      mergeHookDecisions([
        { decision: "continue" },
        { decision: "allow", hook: "a" },
        { decision: "ask", hook: "b" },
      ]).decision,
    ).toBe("ask");
  });

  it("normalizes deny→block and approve→allow", () => {
    expect(normalizeDecision("deny")).toBe("block");
    expect(normalizeDecision("approve")).toBe("allow");
    expect(decisionRank("deny")).toBeGreaterThan(decisionRank("ask"));
    const m = mergeHookDecisions([
      { decision: "deny", hook: "x", reason: "r" },
    ]);
    expect(m).toMatchObject({ decision: "block", hook: "x", reason: "r" });
  });

  it("keeps the winning hook's reason and lists all contributors", () => {
    const m = mergeHookDecisions([
      { decision: "allow", hook: "a" },
      { decision: "block", hook: "b", reason: "danger" },
    ]);
    expect(m.hook).toBe("b");
    expect(m.reason).toBe("danger");
    expect(m.contributing).toHaveLength(2);
  });

  it("empty/all-continue → continue", () => {
    expect(mergeHookDecisions([]).decision).toBe("continue");
    expect(mergeHookDecisions([{ decision: "continue" }]).decision).toBe(
      "continue",
    );
  });
});

describe("dedupeHooks (same handler fires once)", () => {
  it("collapses identical command+shell+matcher, first wins", () => {
    const out = dedupeHooks([
      { command: "lint.sh", matcher: "*.js" },
      { command: "lint.sh", matcher: "*.js" }, // dup (e.g. settings + plugin)
      { command: "lint.sh", matcher: "*.ts" }, // different matcher → kept
      { command: "other.sh" },
    ]);
    expect(out.map((h) => `${h.command}:${h.matcher || ""}`)).toEqual([
      "lint.sh:*.js",
      "lint.sh:*.ts",
      "other.sh:",
    ]);
  });
  it("drops entries without a command", () => {
    expect(dedupeHooks([{ matcher: "x" }, null, { command: "ok" }])).toEqual([
      { command: "ok" },
    ]);
  });
});

describe("planHookReplay (decision-hook replay requires an explicit sandbox)", () => {
  const observeEnv = buildHookEnvelope({
    eventType: "PostToolUse",
    data: { tool_name: "read_file" },
    sessionId: "s",
    seq: 1,
  });
  const decisionEnv = buildHookEnvelope({
    eventType: "PreToolUse",
    data: { tool_name: "run_shell" },
    sessionId: "s",
    seq: 2,
  });

  it("replays an observe-only event freely", () => {
    const plan = planHookReplay(observeEnv, {});
    expect(plan.ok).toBe(true);
    expect(plan.requiresSandbox).toBe(false);
    expect(plan.payload).toMatchObject({
      hook_event_name: "PostToolUse",
      replay: true,
      replay_of: observeEnv.event_id,
    });
  });

  it("REFUSES a decision-event replay without a sandbox", () => {
    const plan = planHookReplay(decisionEnv, { sandbox: false });
    expect(plan.ok).toBe(false);
    expect(plan.requiresSandbox).toBe(true);
    expect(plan.reason).toMatch(/requires an explicit sandbox/);
  });

  it("ALLOWS a decision-event replay when explicitly sandboxed", () => {
    const plan = planHookReplay(decisionEnv, { sandbox: true });
    expect(plan.ok).toBe(true);
    expect(plan.sandboxed).toBe(true);
    expect(plan.payload.replay).toBe(true);
  });

  it("rejects an invalid envelope", () => {
    expect(planHookReplay(null).ok).toBe(false);
    expect(planHookReplay({ data: {} }).ok).toBe(false);
  });
});
