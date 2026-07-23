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
  classifyToolSideEffect,
  countDuplicateCommittedEffects,
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

  it("annotates an in-flight effect with bounded review correlation metadata", () => {
    const l = new SideEffectLedger();
    l.prepare("op1", { kind: "file-write", meta: { tool: "write_file" } })
      .start("op1")
      .annotate("op1", {
        diffReview: {
          schema: "cc-diff-review/v1",
          sessionId: "sess-1",
          turnId: "run-1:t2",
          toolUseId: "call-7",
        },
      })
      .commit("op1");
    const back = SideEffectLedger.fromJSON(
      JSON.parse(JSON.stringify(l.toJSON())),
    );
    expect(back.get("op1").meta).toMatchObject({
      tool: "write_file",
      diffReview: {
        schema: "cc-diff-review/v1",
        sessionId: "sess-1",
        turnId: "run-1:t2",
        toolUseId: "call-7",
      },
    });
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

describe("classifyToolSideEffect", () => {
  it("records file writes as non-idempotent file-write with the path as key", () => {
    for (const tool of ["write_file", "edit_file", "notebook_edit"]) {
      const se = classifyToolSideEffect(tool, { path: "src/a.js" });
      expect(se).toEqual({ kind: "file-write", key: "src/a.js" });
      expect(kindIsIdempotent(se.kind)).toBe(false);
    }
  });

  it("marks edit_file_hashed idempotent (hash-guarded replay is safe)", () => {
    const se = classifyToolSideEffect("edit_file_hashed", { path: "a.js" });
    expect(se.kind).toBe("file-write-checkpointed");
    expect(kindIsIdempotent(se.kind)).toBe(true);
  });

  it("treats opaque shell / run_code as non-idempotent (fail-closed)", () => {
    expect(
      classifyToolSideEffect("run_shell", { command: "npm test" }),
    ).toEqual({ kind: "shell", key: "npm test" });
    expect(kindIsIdempotent("shell")).toBe(false);
    expect(classifyToolSideEffect("run_code", { code: "print(1)" }).kind).toBe(
      "shell",
    );
  });

  it("records only `git push`; other git subcommands are null", () => {
    expect(
      classifyToolSideEffect("git", { command: "push origin main" }),
    ).toEqual({ kind: "git-push", key: "push origin main" });
    for (const command of ["status", "diff --stat", "commit -m x", "pull"]) {
      expect(classifyToolSideEffect("git", { command })).toBeNull();
    }
  });

  it("records publish / schedule / notify / browser_act as network mutations", () => {
    expect(
      classifyToolSideEffect("publish_artifact", { title: "Report" }).kind,
    ).toBe("network-mutation");
    expect(classifyToolSideEffect("schedule", { name: "nightly" }).kind).toBe(
      "network-mutation",
    );
    expect(classifyToolSideEffect("notify", { title: "done" }).kind).toBe(
      "network-mutation",
    );
    expect(
      classifyToolSideEffect("browser_act", { action: "click" }).kind,
    ).toBe("network-mutation");
  });

  it("returns null for read-only / local tools (no false resume warnings)", () => {
    for (const tool of [
      "read_file",
      "search_files",
      "list_dir",
      "code_intelligence",
      "web_search",
      "web_fetch",
      "todo_write",
      "browser_state",
      "spawn_sub_agent",
    ]) {
      expect(classifyToolSideEffect(tool, {})).toBeNull();
    }
    expect(classifyToolSideEffect(null)).toBeNull();
  });

  it("truncates an over-long key with an ellipsis", () => {
    const long = "x".repeat(200);
    const se = classifyToolSideEffect("run_shell", { command: long });
    expect(se.key.length).toBeLessThanOrEqual(81);
    expect(se.key.endsWith("…")).toBe(true);
  });
});

describe("countDuplicateCommittedEffects (resume 0-duplicate metric)", () => {
  it("is 0 when each idempotency key is committed at most once", () => {
    const l = new SideEffectLedger();
    l.prepare("a", { kind: "git-push", meta: { idempotencyKey: "op_x" } })
      .start("a")
      .commit("a");
    l.prepare("b", { kind: "file-write", meta: { idempotencyKey: "op_y" } })
      .start("b")
      .commit("b");
    expect(countDuplicateCommittedEffects(l)).toBe(0);
  });

  it("counts a second commit of the same idempotency key (a naive replay)", () => {
    const l = new SideEffectLedger();
    // Same external effect committed twice under different opIds — what a blind
    // resume-replay would produce; the metric must catch it.
    l.prepare("a1", { kind: "git-push", meta: { idempotencyKey: "op_push" } })
      .start("a1")
      .commit("a1");
    l.prepare("a2", { kind: "git-push", meta: { idempotencyKey: "op_push" } })
      .start("a2")
      .commit("a2");
    expect(countDuplicateCommittedEffects(l)).toBe(1);
  });

  it("ignores unsettled ops and un-keyed ops never collide", () => {
    const l = new SideEffectLedger();
    l.prepare("s", { kind: "git-push" }).start("s"); // started, not committed
    l.prepare("k1", { kind: "file-write" }).start("k1").commit("k1"); // no key → opId
    l.prepare("k2", { kind: "file-write" }).start("k2").commit("k2"); // no key → opId
    expect(countDuplicateCommittedEffects(l)).toBe(0);
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
