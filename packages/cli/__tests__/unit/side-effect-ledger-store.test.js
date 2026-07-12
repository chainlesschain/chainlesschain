/**
 * side-effect-ledger-store — persist the ledger as a chained session event and
 * rebuild+reconcile it on recovery. Drives the store via an injected in-memory
 * append/read pair (no fs, no home dir).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  persistSideEffectLedger,
  loadSideEffectLedger,
  reconcileSessionSideEffects,
  SIDE_EFFECT_LEDGER_EVENT,
  _deps,
} from "../../src/lib/side-effect-ledger-store.js";
import {
  SideEffectLedger,
  SIDE_EFFECT_STATE,
} from "../../src/lib/side-effect-ledger.js";

describe("side-effect-ledger-store", () => {
  beforeEach(() => {
    const store = new Map();
    _deps.appendEvent = vi.fn((sessionId, type, data) => {
      if (!store.has(sessionId)) store.set(sessionId, []);
      store.get(sessionId).push({ type, data });
    });
    _deps.readEvents = vi.fn((sessionId) => store.get(sessionId) || []);
  });

  function crashedLedger() {
    const l = new SideEffectLedger();
    l.prepare("push", { kind: "git-push" }).start("push"); // died mid-push
    l.prepare("done", { kind: "read" }).start("done").commit("done");
    return l;
  }

  it("persists a full snapshot as a chained side_effect_ledger event", () => {
    expect(persistSideEffectLedger("s1", crashedLedger())).toBe(true);
    expect(_deps.appendEvent).toHaveBeenCalledWith(
      "s1",
      SIDE_EFFECT_LEDGER_EVENT,
      expect.objectContaining({ ops: expect.any(Array) }),
    );
  });

  it("round-trips: loaded ledger keeps unsettled state for recovery", () => {
    persistSideEffectLedger("s1", crashedLedger());
    const loaded = loadSideEffectLedger("s1");
    expect(loaded).toBeInstanceOf(SideEffectLedger);
    expect(loaded.get("push").state).toBe(SIDE_EFFECT_STATE.STARTED);
    expect(loaded.unsettled().map((o) => o.opId)).toEqual(["push"]);
  });

  it("newest snapshot wins on load", () => {
    persistSideEffectLedger("s1", crashedLedger());
    const later = new SideEffectLedger();
    later.prepare("fresh", { kind: "git-push" });
    persistSideEffectLedger("s1", later);
    expect(
      loadSideEffectLedger("s1")
        .list()
        .map((o) => o.opId),
    ).toEqual(["fresh"]);
  });

  it("empty ledger when the session never persisted one", () => {
    _deps.appendEvent("s1", "user_message", { role: "user", content: "hi" });
    expect(loadSideEffectLedger("s1").list()).toEqual([]);
  });

  it("persist is best-effort — bad inputs and a throwing store return false", () => {
    expect(persistSideEffectLedger("", crashedLedger())).toBe(false);
    expect(persistSideEffectLedger("s1", null)).toBe(false);
    expect(persistSideEffectLedger("s1", { ops: "nope" })).toBe(false);
    _deps.appendEvent = vi.fn(() => {
      throw new Error("disk full");
    });
    expect(persistSideEffectLedger("s1", crashedLedger())).toBe(false);
  });

  it("reconcileSessionSideEffects is the recovery entry point — inspect the crashed push, skip the read", () => {
    persistSideEffectLedger("s1", crashedLedger());
    const plan = reconcileSessionSideEffects("s1");
    expect(plan.inspect).toEqual(["push"]);
    expect(plan.skip).toEqual(["done"]);
    expect(plan.redo).toEqual([]);
  });
});
