/**
 * turn-binding-store — persist the explicit turn→checkpoint binding table as a
 * chained session event and rebuild it on resume. Drives persistence through an
 * injected in-memory append/read pair (no fs, no home dir).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  persistTurnBinding,
  loadTurnBindingLog,
  resolveRestorePlanFromSession,
  selectTurnRangeFromSession,
  TURN_BINDING_EVENT,
  TurnBindingPersistenceError,
  _deps,
} from "../../src/lib/turn-binding-store.js";
import { TurnBindingLog, RESTORE_SCOPE } from "../../src/lib/turn-binding.js";

describe("turn-binding-store", () => {
  let events;

  beforeEach(() => {
    // In-memory transcript keyed by sessionId, mimicking the chained store.
    const store = new Map();
    events = store;
    _deps.appendEvent = vi.fn((sessionId, type, data) => {
      if (!store.has(sessionId)) store.set(sessionId, []);
      store.get(sessionId).push({ type, data });
    });
    _deps.readEvents = vi.fn((sessionId) => store.get(sessionId) || []);
  });

  function sampleLog() {
    const log = new TurnBindingLog();
    log.startTurn("turn-2", { conversationOffset: 2 });
    log.recordToolCall("turn-2", "call-a", { name: "write_file" });
    log.bindCheckpoint("turn-2", "cp-1");
    log.startTurn("turn-5", { conversationOffset: 5 });
    log.recordToolCall("turn-5", "call-b", { name: "run_shell" });
    return log;
  }

  it("persists a full snapshot as a chained turn_checkpoint_binding event", () => {
    expect(persistTurnBinding("s1", sampleLog())).toBe(true);
    const written = events.get("s1");
    expect(written).toHaveLength(1);
    expect(written[0].type).toBe(TURN_BINDING_EVENT);
    expect(written[0].data.turns.map((t) => t.turnId)).toEqual([
      "turn-2",
      "turn-5",
    ]);
  });

  it("round-trips: loaded log equals the persisted table", () => {
    persistTurnBinding("s1", sampleLog());
    const loaded = loadTurnBindingLog("s1");
    expect(loaded).toBeInstanceOf(TurnBindingLog);
    const t2 = loaded.get("turn-2");
    expect(t2.fileCheckpointId).toBe("cp-1");
    expect(t2.toolCallIds).toEqual(["call-a"]);
    expect(t2.coverage).toBe("full"); // edit + checkpoint
    expect(loaded.get("turn-5").coverage).toBe("partial"); // ran shell
  });

  it("the newest snapshot wins on load (append-only history)", () => {
    persistTurnBinding("s1", sampleLog());
    const later = new TurnBindingLog();
    later.startTurn("turn-9", { conversationOffset: 9 });
    persistTurnBinding("s1", later);
    const loaded = loadTurnBindingLog("s1");
    expect(loaded.list().map((t) => t.turnId)).toEqual(["turn-9"]);
    expect(loaded.get("turn-2")).toBeNull();
  });

  it("returns an empty log when the session has no binding event", () => {
    _deps.appendEvent("s1", "user_message", { role: "user", content: "hi" });
    expect(loadTurnBindingLog("s1").list()).toEqual([]);
  });

  it("skips a malformed binding event and keeps scanning back", () => {
    persistTurnBinding("s1", sampleLog());
    // A corrupt later snapshot (data.turns missing) must not shadow the good one.
    _deps.appendEvent("s1", TURN_BINDING_EVENT, { turns: null });
    expect(loadTurnBindingLog("s1").get("turn-2").fileCheckpointId).toBe(
      "cp-1",
    );
  });

  it("fails closed for invalid input and unavailable critical storage", () => {
    expect(() => persistTurnBinding("", sampleLog())).toThrow(
      TurnBindingPersistenceError,
    );
    expect(() => persistTurnBinding("s1", null)).toThrow(
      TurnBindingPersistenceError,
    );
    expect(() => persistTurnBinding("s1", { turns: "nope" })).toThrow(
      TurnBindingPersistenceError,
    );
    _deps.appendEvent = vi.fn(() => {
      throw new Error("disk full");
    });
    expect(() => persistTurnBinding("s1", sampleLog())).toThrowError(
      expect.objectContaining({ code: "TURN_BINDING_PERSIST_FAILED" }),
    );
  });

  it("supports an explicit advisory fallback", () => {
    _deps.appendEvent = vi.fn(() => {
      throw new Error("disk full");
    });
    expect(
      persistTurnBinding("s1", sampleLog(), { failIfUnavailable: false }),
    ).toBe(false);
  });

  it("load fails closed when the store read throws", () => {
    _deps.readEvents = vi.fn(() => {
      throw new Error("unreadable");
    });
    expect(() => loadTurnBindingLog("s1")).toThrowError(
      expect.objectContaining({ code: "TURN_BINDING_READ_FAILED" }),
    );
    expect(
      loadTurnBindingLog("s1", { failIfUnavailable: false }).list(),
    ).toEqual([]);
  });

  it("resolveRestorePlanFromSession yields an honest plan for a persisted turn", () => {
    persistTurnBinding("s1", sampleLog());
    const plan = resolveRestorePlanFromSession(
      "s1",
      "turn-5",
      RESTORE_SCOPE.BOTH,
    );
    expect(plan.coverage).toBe("partial");
    expect(plan.warnings.join(" ")).toMatch(/checkpoint|side-effect/);
  });

  it("resolveRestorePlanFromSession refuses an unknown turn without throwing", () => {
    persistTurnBinding("s1", sampleLog());
    const plan = resolveRestorePlanFromSession("s1", "turn-999");
    expect(plan.warnings).toContain("unknown turn — nothing to restore");
  });

  it("selectTurnRangeFromSession bounds a range over persisted turns", () => {
    persistTurnBinding("s1", sampleLog());
    const range = selectTurnRangeFromSession("s1", {
      fromTurnId: "turn-2",
      toTurnId: "turn-5",
    });
    expect(range.turns.map((t) => t.turnId)).toEqual(["turn-2", "turn-5"]);
    expect(range.fromOffset).toBe(2);
    expect(range.toOffset).toBe(5);
  });
});
