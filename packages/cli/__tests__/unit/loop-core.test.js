/**
 * cc loop — core driver (src/lib/loop.js).
 *
 * Drives runLoop with a fake (no-op) sleep and a canned runIteration so the
 * loop semantics — iteration counting, the four stop conditions, run-at-least-
 * once, and the "no trailing sleep" guarantee — are exercised without timers
 * or subprocesses. parseDuration/formatDuration get their own table cases.
 */
import { describe, expect, it, vi } from "vitest";
import {
  runLoop,
  parseDuration,
  formatDuration,
  makeSleep,
  parseLoopDirectives,
  summarizeLoopEvents,
} from "../../src/lib/loop.js";

const noSleep = vi.fn(async () => {});

describe("parseDuration", () => {
  it("parses suffixed durations to ms", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1.5h")).toBe(5_400_000);
  });

  it("treats a bare number as seconds", () => {
    expect(parseDuration("30")).toBe(30_000);
    // numeric input is also seconds — consistent with the string path:
    // parseDuration(45) === parseDuration("45") === parseDuration("45s")
    expect(parseDuration(45)).toBe(45_000);
    expect(parseDuration(45)).toBe(parseDuration("45"));
  });

  it("throws on garbage", () => {
    expect(() => parseDuration("soon")).toThrow(/invalid duration/);
    expect(() => parseDuration("5x")).toThrow(/invalid duration/);
  });
});

describe("formatDuration", () => {
  it("renders compact human strings", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(300_000)).toBe("5m");
    expect(formatDuration(5_400_000)).toBe("1.5h");
  });
});

describe("runLoop stop conditions", () => {
  it("stops after maxIterations and sleeps between but not after", async () => {
    const sleep = vi.fn(async () => {});
    const runIteration = vi.fn(async () => ({ exitCode: 1 }));
    const out = await runLoop({
      runIteration,
      intervalMs: 1000,
      maxIterations: 3,
      sleep,
    });
    expect(out.iterations).toBe(3);
    expect(out.stoppedBy).toBe("max-iterations");
    expect(runIteration).toHaveBeenCalledTimes(3);
    // 3 runs → 2 inter-run sleeps, never a trailing one.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("stops on the first exit-0 when untilExitZero is set", async () => {
    const runIteration = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1 })
      .mockResolvedValueOnce({ exitCode: 1 })
      .mockResolvedValueOnce({ exitCode: 0 });
    const out = await runLoop({
      runIteration,
      intervalMs: 0,
      untilExitZero: true,
      sleep: noSleep,
    });
    expect(out.iterations).toBe(3);
    expect(out.stoppedBy).toBe("exit-zero");
  });

  it("stops when output matches untilRegex", async () => {
    const runIteration = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, output: "working..." })
      .mockResolvedValueOnce({ exitCode: 0, output: "status: DONE" });
    const out = await runLoop({
      runIteration,
      intervalMs: 0,
      untilRegex: /DONE/,
      sleep: noSleep,
    });
    expect(out.iterations).toBe(2);
    expect(out.stoppedBy).toBe("match");
  });

  it("runs at least once even if shouldStop is already true after round 1", async () => {
    let stop = false;
    const runIteration = vi.fn(async () => {
      stop = true; // request stop during the first round
      return { exitCode: 0 };
    });
    const out = await runLoop({
      runIteration,
      intervalMs: 0,
      shouldStop: () => stop,
      sleep: noSleep,
    });
    expect(out.iterations).toBe(1);
    expect(out.stoppedBy).toBe("signal");
  });

  it("exit-0 takes precedence over a lower-priority max-iterations on the same round", async () => {
    const out = await runLoop({
      runIteration: async () => ({ exitCode: 0 }),
      intervalMs: 0,
      untilExitZero: true,
      maxIterations: 1,
      sleep: noSleep,
    });
    expect(out.stoppedBy).toBe("exit-zero");
  });

  it("rejects a missing runIteration", async () => {
    await expect(runLoop({ intervalMs: 0 })).rejects.toThrow(/runIteration/);
  });
});

describe("parseLoopDirectives", () => {
  it("reads a next-interval directive", () => {
    expect(parseLoopDirectives("blah\n[[loop:next 5m]]")).toEqual({
      done: false,
      nextDelayMs: 300_000,
    });
  });

  it("reads a stop directive (and stop wins over next)", () => {
    expect(parseLoopDirectives("done.\n[[loop:stop]]").done).toBe(true);
    const both = parseLoopDirectives("[[loop:next 1m]] [[loop:stop]]");
    expect(both.done).toBe(true);
  });

  it("tolerates whitespace and is case-insensitive", () => {
    expect(parseLoopDirectives("[[ LOOP:NEXT  30s ]]").nextDelayMs).toBe(
      30_000,
    );
  });

  it("ignores a malformed interval (falls back to default)", () => {
    expect(parseLoopDirectives("[[loop:next soon]]").nextDelayMs).toBe(null);
  });

  it("returns no-op for output with no directive", () => {
    expect(parseLoopDirectives("just some text")).toEqual({
      done: false,
      nextDelayMs: null,
    });
  });
});

describe("runLoop dynamic signals", () => {
  it("stops when an iteration reports done", async () => {
    const runIteration = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0 })
      .mockResolvedValueOnce({ exitCode: 0, done: true });
    const out = await runLoop({
      runIteration,
      intervalMs: 0,
      sleep: noSleep,
    });
    expect(out.iterations).toBe(2);
    expect(out.stoppedBy).toBe("done");
  });

  it("uses a per-iteration nextDelayMs over the fixed interval", async () => {
    const sleep = vi.fn(async () => {});
    const runIteration = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, nextDelayMs: 42 })
      .mockResolvedValueOnce({ exitCode: 0 }); // no override → falls back
    await runLoop({
      runIteration,
      intervalMs: 9999,
      maxIterations: 2,
      sleep,
    });
    // Only one inter-run sleep (between rounds 1 and 2), and it honored 42.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(42);
  });
});

describe("runLoop startIndex (resume)", () => {
  it("counts iterations cumulatively from startIndex", async () => {
    const runIteration = vi.fn(async () => ({ exitCode: 1 }));
    const out = await runLoop({
      runIteration,
      intervalMs: 0,
      maxIterations: 5,
      startIndex: 3, // 3 already done in a prior run
      sleep: noSleep,
    });
    // 3 prior + 2 new = 5 → hits the cumulative cap after 2 fresh rounds.
    expect(runIteration).toHaveBeenCalledTimes(2);
    expect(out.iterations).toBe(5);
    expect(out.stoppedBy).toBe("max-iterations");
  });
});

describe("summarizeLoopEvents", () => {
  it("extracts config, completed count, and last exit code", () => {
    const events = [
      { type: "session_start", data: {} },
      {
        type: "loop_config",
        data: { execMode: true, operands: ["npm", "test"] },
      },
      { type: "loop_iteration", data: { n: 1, exitCode: 1 } },
      { type: "loop_iteration", data: { n: 2, exitCode: 0 } },
      { type: "loop_end", data: { stoppedBy: "max-iterations" } },
    ];
    const s = summarizeLoopEvents(events);
    expect(s.config).toEqual({ execMode: true, operands: ["npm", "test"] });
    expect(s.completedIterations).toBe(2);
    expect(s.lastExitCode).toBe(0);
  });

  it("uses the last loop_config when several exist", () => {
    const events = [
      { type: "loop_config", data: { every: "5m" } },
      { type: "loop_config", data: { every: "1m" } },
    ];
    expect(summarizeLoopEvents(events).config).toEqual({ every: "1m" });
  });

  it("returns null config for a session with no loop", () => {
    const s = summarizeLoopEvents([{ type: "user_message", data: {} }]);
    expect(s.config).toBe(null);
    expect(s.completedIterations).toBe(0);
  });
});

describe("makeSleep", () => {
  it("resolves immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const sleep = makeSleep(ac.signal);
    await expect(sleep(10_000)).resolves.toBeUndefined();
  });

  it("resolves immediately for a zero delay", async () => {
    const sleep = makeSleep();
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
