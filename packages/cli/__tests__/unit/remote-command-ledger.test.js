import { describe, it, expect } from "vitest";
import { RemoteCommandLedger } from "../../src/harness/remote-command-ledger.js";

function makeClock(start = 1000) {
  const c = { t: start };
  return { now: () => c.t, advance: (ms) => (c.t += ms) };
}

describe("RemoteCommandLedger idempotency (reconnect safety)", () => {
  it("executes a command once and REPLAYS a re-delivery without re-running it", async () => {
    const ledger = new RemoteCommandLedger();
    let runs = 0;
    const cmd = { commandId: "cmd-1", deviceId: "phone", seq: 1 };
    const exec = async () => {
      runs += 1;
      return `ran-${runs}`;
    };

    const first = await ledger.apply(cmd, exec);
    expect(first).toMatchObject({ status: "applied", result: "ran-1" });

    // The client didn't get the ACK and re-sends the SAME command after a
    // reconnect — it must NOT execute again.
    const again = await ledger.apply(cmd, exec);
    expect(again).toMatchObject({ status: "replayed", result: "ran-1" });
    expect(runs).toBe(1); // executed exactly once
  });

  it("does not record a FAILED execution as applied (retry can run again)", async () => {
    const ledger = new RemoteCommandLedger();
    let n = 0;
    const cmd = { commandId: "flaky", deviceId: "d", seq: 1 };
    const exec = async () => {
      n += 1;
      if (n === 1) throw new Error("network blip");
      return "ok";
    };
    const bad = await ledger.apply(cmd, exec);
    expect(bad.status).toBe("rejected");
    // Same commandId retried → runs again (failure wasn't cached) and succeeds.
    const good = await ledger.apply(cmd, exec);
    expect(good).toMatchObject({ status: "applied", result: "ok" });
    expect(n).toBe(2);
  });

  it("executes once under CONCURRENT same-commandId delivery (in-flight race)", async () => {
    const ledger = new RemoteCommandLedger();
    let runs = 0;
    const cmd = { commandId: "cmd-race", deviceId: "phone", seq: 1 };
    // A slow side effect widens the window: two deliveries arrive while the
    // first execute() is still pending (reconnect double-send / two endpoints
    // forwarding the same queued command).
    const exec = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return `ran-${runs}`;
    };

    const [a, b] = await Promise.all([
      ledger.apply(cmd, exec),
      ledger.apply(cmd, exec),
    ]);

    expect(runs).toBe(1); // side effect ran AT MOST ONCE despite the race
    expect(ledger.appliedCount()).toBe(1); // recorded once in the total order
    // Exactly one applied; the concurrent duplicate is replayed with the same result.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["applied", "replayed"]);
    expect(a.result).toBe("ran-1");
    expect(b.result).toBe("ran-1");
    expect(a.applyIndex).toBe(0);
    expect(b.applyIndex).toBe(0);
  });
});

describe("RemoteCommandLedger total ordering (3-endpoint consistency)", () => {
  it("assigns a single monotonic order across interleaved endpoints", async () => {
    const ledger = new RemoteCommandLedger();
    const run = (id, device, seq) =>
      ledger.apply({ commandId: id, deviceId: device, seq }, async () => id);
    // terminal, web, mobile interleave.
    await run("a", "terminal", 1);
    await run("b", "web", 1);
    await run("c", "mobile", 1);
    await run("d", "terminal", 2);
    expect(ledger.appliedSince(-1).map((e) => e.commandId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    // A reconnecting endpoint at cursor 1 catches up on exactly the tail.
    expect(ledger.appliedSince(1).map((e) => e.commandId)).toEqual(["c", "d"]);
    expect(ledger.cursor()).toBe(3);
  });

  it("rejects a stale per-device sequence with a NEW commandId", async () => {
    const ledger = new RemoteCommandLedger();
    await ledger.apply(
      { commandId: "x1", deviceId: "d", seq: 5 },
      async () => 1,
    );
    // A fresh command from the same device with a lower seq is a protocol
    // violation (a genuine reconnect resends the same commandId, not a new one).
    const stale = await ledger.apply(
      { commandId: "x2", deviceId: "d", seq: 3 },
      async () => 2,
    );
    expect(stale).toMatchObject({
      status: "rejected",
      reason: "stale sequence",
    });
  });
});

describe("RemoteCommandLedger device revocation", () => {
  it("rejects all commands from a revoked device", async () => {
    const ledger = new RemoteCommandLedger();
    let runs = 0;
    const exec = async () => (runs += 1);
    await ledger.apply({ commandId: "ok", deviceId: "trusted", seq: 1 }, exec);
    ledger.revokeDevice("stolen");
    const rejected = await ledger.apply(
      { commandId: "evil", deviceId: "stolen", seq: 1 },
      exec,
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: "device revoked",
    });
    expect(ledger.isRevoked("stolen")).toBe(true);
    expect(runs).toBe(1); // the revoked command never executed
  });

  it("honors a revoked-devices list passed at construction", async () => {
    const ledger = new RemoteCommandLedger({ revokedDevices: ["banned"] });
    const r = await ledger.apply(
      { commandId: "c", deviceId: "banned", seq: 1 },
      async () => 1,
    );
    expect(r.status).toBe("rejected");
  });
});

describe("RemoteCommandLedger validation + snapshot", () => {
  it("rejects a command with no commandId", async () => {
    const ledger = new RemoteCommandLedger();
    const r = await ledger.apply({ deviceId: "d" }, async () => 1);
    expect(r).toMatchObject({ status: "rejected", reason: /commandId/ });
  });

  it("round-trips through snapshot/restore preserving idempotency + revocation", async () => {
    const clock = makeClock();
    const ledger = new RemoteCommandLedger({ now: clock.now });
    await ledger.apply(
      { commandId: "a", deviceId: "d", seq: 1 },
      async () => "A",
    );
    ledger.revokeDevice("bad");

    const restored = RemoteCommandLedger.restore(
      JSON.parse(JSON.stringify(ledger.snapshot())),
    );
    // Already-applied command is still a replay (no re-exec) after restore.
    let ran = false;
    const replay = await restored.apply(
      { commandId: "a", deviceId: "d", seq: 1 },
      async () => {
        ran = true;
        return "A2";
      },
    );
    expect(replay).toMatchObject({ status: "replayed", result: "A" });
    expect(ran).toBe(false);
    expect(restored.isRevoked("bad")).toBe(true);
  });
});

describe("RemoteCommandLedger per-device seq watermark monotonicity", () => {
  it("does not regress the watermark when commands settle out of order", async () => {
    // seq 5 and seq 6 both pass the stale check while in flight; 6 records
    // first, then 5 — a plain set() would drop the watermark back to 5 and a
    // NEW commandId reusing seq 6 would be accepted instead of stale-rejected.
    const ledger = new RemoteCommandLedger();
    let release5;
    const gate5 = new Promise((r) => (release5 = r));
    const p5 = ledger.apply(
      { commandId: "c5", deviceId: "d", seq: 5 },
      async () => {
        await gate5;
        return "r5";
      },
    );
    const r6 = await ledger.apply(
      { commandId: "c6", deviceId: "d", seq: 6 },
      async () => "r6",
    );
    expect(r6.status).toBe("applied");
    release5();
    expect((await p5).status).toBe("applied");

    const reuse = await ledger.apply(
      { commandId: "c7", deviceId: "d", seq: 6 },
      async () => "should-not-run",
    );
    expect(reuse.status).toBe("rejected");
    expect(reuse.reason).toBe("stale sequence");
  });
});

describe("RemoteCommandLedger retention window (bounded growth)", () => {
  it("evicts the oldest entries beyond maxApplied while keeping order semantics", async () => {
    const ledger = new RemoteCommandLedger({ maxApplied: 10 });
    for (let i = 0; i < 40; i++) {
      await ledger.apply(
        { commandId: `c${i}`, deviceId: "d", seq: i },
        async () => i,
      );
    }
    // Bounded: at most maxApplied*1.5 retained (chunked compaction).
    expect(ledger.snapshot().applied.length).toBeLessThanOrEqual(15);
    // Global counters keep counting across eviction.
    expect(ledger.appliedCount()).toBe(40);
    expect(ledger.cursor()).toBe(39);
    expect(ledger.oldestRetainedIndex()).toBeGreaterThan(0);
    // The retained tail replays with its ORIGINAL applyIndex values.
    const tail = ledger.appliedSince(37);
    expect(tail.map((e) => e.applyIndex)).toEqual([38, 39]);
    expect(tail.map((e) => e.commandId)).toEqual(["c38", "c39"]);
    // A recent command still replays idempotently…
    const replay = await ledger.apply(
      { commandId: "c39", deviceId: "d", seq: 39 },
      async () => "again",
    );
    expect(replay.status).toBe("replayed");
    expect(replay.result).toBe(39);
  });

  it("snapshot/restore preserves the window and baseIndex", async () => {
    const ledger = new RemoteCommandLedger({ maxApplied: 10 });
    for (let i = 0; i < 40; i++) {
      await ledger.apply(
        { commandId: `c${i}`, deviceId: "d", seq: i },
        async () => i,
      );
    }
    const restored = RemoteCommandLedger.restore(
      JSON.parse(JSON.stringify(ledger.snapshot())),
    );
    expect(restored.appliedCount()).toBe(40);
    expect(restored.oldestRetainedIndex()).toBe(ledger.oldestRetainedIndex());
    // Window keeps enforcing after restore.
    for (let i = 40; i < 80; i++) {
      await restored.apply(
        { commandId: `c${i}`, deviceId: "d", seq: i },
        async () => i,
      );
    }
    expect(restored.snapshot().applied.length).toBeLessThanOrEqual(15);
    expect(restored.appliedCount()).toBe(80);
  });
});
