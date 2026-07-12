/**
 * side-effect-ledger — two-phase accounting (prepare→start→commit|fail|unknown)
 * and an HONEST crash-recovery planner: a started-but-unsettled non-idempotent
 * op must be INSPECTED, never blindly redone.
 */
import { describe, it, expect } from "vitest";
import {
  SideEffectLedger,
  SIDE_EFFECT_STATE,
  RECOVERY_ACTION,
  kindIsIdempotent,
  planOpRecovery,
  reconcileSideEffects,
} from "../../src/lib/side-effect-ledger.js";

describe("kindIsIdempotent", () => {
  it("treats external effects as non-idempotent and reads/compute as idempotent", () => {
    expect(kindIsIdempotent("git-push")).toBe(false);
    expect(kindIsIdempotent("package-install")).toBe(false);
    expect(kindIsIdempotent("file-write")).toBe(false); // raw write: conservative
    expect(kindIsIdempotent("file-write-checkpointed")).toBe(true);
    expect(kindIsIdempotent("read")).toBe(true);
    expect(kindIsIdempotent("unheard-of")).toBe(false); // unknown → conservative
  });
});

describe("SideEffectLedger lifecycle", () => {
  it("walks prepare→start→commit and stamps timestamps from an injected clock", () => {
    let t = 100;
    const l = new SideEffectLedger({ clock: () => (t += 1) });
    l.prepare("op1", { kind: "git-push", key: "origin/main" });
    expect(l.get("op1").state).toBe(SIDE_EFFECT_STATE.PREPARED);
    expect(l.get("op1").idempotent).toBe(false);
    expect(l.get("op1").preparedAt).toBe(101);
    l.start("op1");
    expect(l.get("op1").state).toBe(SIDE_EFFECT_STATE.STARTED);
    l.commit("op1"); // start() does not stamp; only prepare + settle do
    expect(l.get("op1").state).toBe(SIDE_EFFECT_STATE.COMMITTED);
    expect(l.get("op1").settledAt).toBe(102);
  });

  it("rejects illegal transitions (commit before start, re-settle)", () => {
    const l = new SideEffectLedger();
    l.prepare("op1", { kind: "file-write" });
    l.commit("op1"); // not started yet → ignored
    expect(l.get("op1").state).toBe(SIDE_EFFECT_STATE.PREPARED);
    l.start("op1").commit("op1");
    l.fail("op1", "too late"); // already committed → ignored
    expect(l.get("op1").state).toBe(SIDE_EFFECT_STATE.COMMITTED);
    expect(l.get("op1").reason).toBeNull();
  });

  it("prepare is idempotent — a retry loop can't reset a committed op", () => {
    const l = new SideEffectLedger();
    l.prepare("op1", { kind: "git-push" });
    l.start("op1").commit("op1");
    l.prepare("op1", { kind: "git-push" }); // no-op
    expect(l.get("op1").state).toBe(SIDE_EFFECT_STATE.COMMITTED);
  });

  it("honors an explicit idempotent override over the kind default", () => {
    const l = new SideEffectLedger();
    l.prepare("op1", { kind: "git-push", idempotent: true });
    expect(l.get("op1").idempotent).toBe(true);
  });

  it("unknown() settles an unsettled op but never a committed one", () => {
    const l = new SideEffectLedger();
    l.prepare("a", { kind: "git-push" }).start("a");
    l.unknown("a", "crash");
    expect(l.get("a").state).toBe(SIDE_EFFECT_STATE.UNKNOWN);
    expect(l.get("a").reason).toBe("crash");
    l.prepare("b", { kind: "read" }).start("b").commit("b");
    l.unknown("b", "nope"); // committed → ignored
    expect(l.get("b").state).toBe(SIDE_EFFECT_STATE.COMMITTED);
  });

  it("unsettled() surfaces exactly the prepared/started ops", () => {
    const l = new SideEffectLedger();
    l.prepare("a", { kind: "git-push" }); // prepared
    l.prepare("b", { kind: "git-push" }).start("b"); // started
    l.prepare("c", { kind: "git-push" }).start("c").commit("c"); // committed
    expect(l.unsettled().map((o) => o.opId)).toEqual(["a", "b"]);
  });

  it("round-trips through JSON (state, idempotent, reason preserved)", () => {
    const l = new SideEffectLedger();
    l.prepare("a", { kind: "git-push", meta: { remote: "origin" } }).start("a");
    l.prepare("b", { kind: "file-write-checkpointed" });
    const back = SideEffectLedger.fromJSON(
      JSON.parse(JSON.stringify(l.toJSON())),
    );
    expect(back.get("a").state).toBe(SIDE_EFFECT_STATE.STARTED);
    expect(back.get("a").idempotent).toBe(false);
    expect(back.get("a").meta.remote).toBe("origin");
    expect(back.get("b").idempotent).toBe(true);
  });
});

describe("planOpRecovery / reconcileSideEffects", () => {
  it("skips committed, redoes prepared, inspects a started non-idempotent op", () => {
    const l = new SideEffectLedger();
    l.prepare("done", { kind: "git-push" }).start("done").commit("done");
    l.prepare("intent", { kind: "git-push" }); // prepared only
    l.prepare("midair", { kind: "git-push" }).start("midair"); // crashed mid-flight
    const r = reconcileSideEffects(l);
    expect(r.skip).toEqual(["done"]);
    expect(r.redo).toEqual(["intent"]);
    expect(r.inspect).toEqual(["midair"]);
    const midair = r.plans.find((p) => p.opId === "midair");
    expect(midair.reason).toMatch(/may have applied|do not repeat/);
  });

  it("redoes a started idempotent op (safe to re-run)", () => {
    const l = new SideEffectLedger();
    l.prepare("cp", { kind: "file-write-checkpointed" }).start("cp");
    expect(planOpRecovery(l.get("cp")).action).toBe(RECOVERY_ACTION.REDO);
  });

  it("inspects a cleanly-failed non-idempotent op, redoes a failed idempotent one", () => {
    const l = new SideEffectLedger();
    l.prepare("push", { kind: "git-push" }).start("push").fail("push", "net");
    l.prepare("read", { kind: "read" }).start("read").fail("read", "eof");
    expect(planOpRecovery(l.get("push")).action).toBe(RECOVERY_ACTION.INSPECT);
    expect(planOpRecovery(l.get("read")).action).toBe(RECOVERY_ACTION.REDO);
  });

  it("acceptance: file-write / git-push / package-install crashed mid-flight are all inspect, not redo", () => {
    const l = new SideEffectLedger();
    for (const kind of ["file-write", "git-push", "package-install"]) {
      l.prepare(kind, { kind }).start(kind); // died before commit
    }
    const r = reconcileSideEffects(l);
    expect(r.inspect.sort()).toEqual(
      ["file-write", "git-push", "package-install"].sort(),
    );
    expect(r.redo).toEqual([]);
  });

  it("reconciles a plain {ops} shape too (no class instance required)", () => {
    const r = reconcileSideEffects({
      ops: [
        { opId: "x", state: SIDE_EFFECT_STATE.COMMITTED, idempotent: false },
      ],
    });
    expect(r.skip).toEqual(["x"]);
  });
});
