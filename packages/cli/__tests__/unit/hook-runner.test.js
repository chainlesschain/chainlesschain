/**
 * hook-runner — Claude-Code command-hook JSON/exit-code decision protocol.
 *
 * Covers: stdin gets the JSON payload; exit 2 → block; exit 0 + JSON stdout
 * decisions ({decision}, {hookSpecificOutput.permissionDecision}, continue:false);
 * exit 0 plain → continue; other non-zero → non-blocking; spawn error → non-
 * blocking; runHooks short-circuits on the first block. `_deps.spawnSync` is
 * stubbed (no real process).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import runner from "../../src/lib/hook-runner.cjs";

const {
  runCommandHook,
  runCommandHookAsync,
  runHooks,
  runHooksParallel,
  interpretHookOutcome,
  tryParseDecision,
  HOOK_PAYLOAD_SCHEMA_VERSION,
  _resetHookBreaker,
  _deps,
} = runner;

/** A controllable fake child process for the async `_deps.spawn` path. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdinWrites = [];
  child.stdin = {
    write: (d) => child.stdinWrites.push(String(d)),
    end: () => {},
    on: () => {},
  };
  child.kill = vi.fn();
  child.finish = ({ stdout = "", stderr = "", code = 0 } = {}) => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  };
  child.fail = (err) => child.emit("error", err);
  return child;
}

let calls;
function stub(returns) {
  // returns: {status, stdout, stderr, error}
  _deps.spawnSync = vi.fn((cmd, opts) => {
    calls.push({ cmd, opts });
    return { status: 0, stdout: "", stderr: "", ...returns };
  });
}

beforeEach(() => {
  calls = [];
  _resetHookBreaker(); // failure counters must not leak across cases
});

describe("runCommandHook — input + protocol", () => {
  it("writes the JSON payload to stdin", () => {
    stub({ status: 0 });
    runCommandHook(
      "guard.sh",
      { tool_name: "Bash", x: 1 },
      { event: "PreToolUse" },
    );
    expect(calls[0].opts.input).toBe(
      JSON.stringify({
        tool_name: "Bash",
        x: 1,
        schema_version: HOOK_PAYLOAD_SCHEMA_VERSION,
      }),
    );
    expect(calls[0].opts.env.CLAUDE_HOOK_EVENT).toBe("PreToolUse");
  });

  it("stamps schema_version on every payload (gap 2026-07-11)", () => {
    stub({ status: 0 });
    runCommandHook("guard.sh", {}, {});
    expect(JSON.parse(calls[0].opts.input).schema_version).toBe(1);
    // A caller-provided value is preserved (forward-compat escape hatch).
    runCommandHook("guard.sh", { schema_version: 9 }, {});
    expect(JSON.parse(calls[1].opts.input).schema_version).toBe(9);
  });

  it("exit 2 → block, reason from stderr", () => {
    stub({ status: 2, stderr: "nope, blocked\n" });
    const r = runCommandHook("g.sh", {});
    expect(r.decision).toBe("block");
    expect(r.reason).toBe("nope, blocked");
  });

  it("exit 0 plain → continue", () => {
    stub({ status: 0, stdout: "ok\n" });
    expect(runCommandHook("g.sh", {}).decision).toBe("continue");
  });

  it("exit 0 + {decision:block} → block", () => {
    stub({ status: 0, stdout: '{"decision":"block","reason":"bad"}' });
    const r = runCommandHook("g.sh", {});
    expect(r).toMatchObject({ decision: "block", reason: "bad" });
  });

  it("exit 0 + hookSpecificOutput.permissionDecision=deny → block", () => {
    stub({
      status: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "policy",
        },
      }),
    });
    const r = runCommandHook("g.sh", {});
    expect(r).toMatchObject({ decision: "block", reason: "policy" });
  });

  it("permissionDecision=ask → ask", () => {
    stub({
      status: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: { permissionDecision: "ask" },
      }),
    });
    expect(runCommandHook("g.sh", {}).decision).toBe("ask");
  });

  it("{continue:false} → block", () => {
    stub({ status: 0, stdout: '{"continue":false,"stopReason":"halt"}' });
    expect(runCommandHook("g.sh", {})).toMatchObject({
      decision: "block",
      reason: "halt",
    });
  });

  it("other non-zero → continue (non-blocking error)", () => {
    stub({ status: 1, stderr: "warn" });
    const r = runCommandHook("g.sh", {});
    expect(r.decision).toBe("continue");
    expect(r.nonBlockingError).toBe(true);
  });

  it("spawn error (res.error) → continue, non-blocking", () => {
    stub({ status: null, error: new Error("ENOENT") });
    const r = runCommandHook("missing.sh", {});
    expect(r.decision).toBe("continue");
    expect(r.nonBlockingError).toBe(true);
  });

  it("converts CC seconds timeout to ms via runHooks", () => {
    stub({ status: 0 });
    runHooks([{ command: "g.sh", timeout: 30 }], {});
    expect(calls[0].opts.timeout).toBe(30000);
  });

  it("forces a positive timeout when the config is 0 (Node 0 = no timeout → hang)", () => {
    stub({ status: 0 });
    runHooks([{ command: "g.sh", timeout: 0 }], {});
    expect(calls[0].opts.timeout).toBe(60000); // clamped to default, not 0
  });

  it("forces a positive timeout when the config is non-numeric (NaN → hang)", () => {
    stub({ status: 0 });
    runHooks([{ command: "g.sh", timeout: "soon" }], {});
    expect(calls[0].opts.timeout).toBe(60000);
  });

  it("forces a positive timeout for a direct 0/negative opts.timeout", () => {
    stub({ status: 0 });
    runCommandHook("g.sh", {}, { timeout: 0 });
    expect(calls[0].opts.timeout).toBe(60000);
    calls = [];
    stub({ status: 0 });
    runCommandHook("g.sh", {}, { timeout: -5 });
    expect(calls[0].opts.timeout).toBe(60000);
  });

  it("clamps an absurdly large timeout to the 10-minute ceiling", () => {
    stub({ status: 0 });
    runHooks([{ command: "g.sh", timeout: 99999999 }], {});
    expect(calls[0].opts.timeout).toBe(600000);
  });

  it("preserves a valid in-range timeout unchanged", () => {
    stub({ status: 0 });
    runCommandHook("g.sh", {}, { timeout: 5000 });
    expect(calls[0].opts.timeout).toBe(5000);
  });

  it("exit 0 + JSON decision line followed by diagnostics → block (not dropped)", () => {
    // The common shell-hook shape: emit the decision, then log to stdout.
    stub({
      status: 0,
      stdout: '{"decision":"block","reason":"policy"}\n[hook] denied tool\n',
    });
    const r = runCommandHook("g.sh", {});
    expect(r).toMatchObject({ decision: "block", reason: "policy" });
  });

  it("exit 0 + {-leading but unparseable stdout → continue, flagged malformed", () => {
    stub({ status: 0, stdout: '{"decision":"block"' }); // truncated JSON
    const r = runCommandHook("g.sh", {});
    expect(r.decision).toBe("continue"); // exit code 0 still governs
    expect(r.malformedDecision).toBe(true);
    expect(r.reason).toMatch(/did not parse/i);
  });

  it("exit 0 plain (non-{) stdout is not flagged malformed", () => {
    stub({ status: 0, stdout: "ok\n" });
    const r = runCommandHook("g.sh", {});
    expect(r.decision).toBe("continue");
    expect(r.malformedDecision).toBeUndefined();
    expect(r.reason).toBeNull();
  });
});

describe("per-hook shell selection (P1 #8 — shell: powershell|pwsh)", () => {
  // The PowerShell route calls spawnSync(file, argv, opts) — 3 args.
  function stub3(returns) {
    _deps.spawnSync = vi.fn((cmd, argvOrOpts, maybeOpts) => {
      calls.push({ cmd, argvOrOpts, maybeOpts });
      return { status: 0, stdout: "", stderr: "", ...returns };
    });
  }

  it("shell:powershell → explicit argv (-NoProfile … -Command <cmd>), no shell:true", () => {
    stub3({ status: 0 });
    runCommandHook("Get-Item x.txt", {}, { shell: "powershell" });
    const c = calls[0];
    expect(c.cmd).toBe("powershell.exe");
    expect(c.argvOrOpts[0]).toBe("-NoProfile");
    expect(c.argvOrOpts[c.argvOrOpts.length - 2]).toBe("-Command");
    expect(c.argvOrOpts[c.argvOrOpts.length - 1]).toBe("Get-Item x.txt");
    expect(c.maybeOpts.shell).toBeUndefined();
    // stdin protocol unchanged (payload now carries schema_version)
    expect(c.maybeOpts.input).toBe(JSON.stringify({ schema_version: 1 }));
  });

  it("shell:pwsh → pwsh executable", () => {
    stub3({ status: 0 });
    runCommandHook("Get-Date", {}, { shell: "pwsh" });
    expect(calls[0].cmd).toBe("pwsh");
  });

  it("runHooks threads the hook entry's shell field", () => {
    stub3({ status: 0 });
    runHooks([{ command: "Get-Date", shell: "powershell" }], {});
    expect(calls[0].cmd).toBe("powershell.exe");
  });

  it("no shell field → historical default-shell path (2-arg spawnSync, shell:true)", () => {
    stub({ status: 0 });
    runHooks([{ command: "guard.sh" }], {});
    expect(calls[0].cmd).toBe("guard.sh");
    expect(calls[0].opts.shell).toBe(true);
  });

  it("unknown shell values fall back to the default shell (fail-to-default)", () => {
    stub({ status: 0 });
    runCommandHook("guard.sh", {}, { shell: "fish" });
    expect(calls[0].cmd).toBe("guard.sh");
    expect(calls[0].opts.shell).toBe(true);
  });

  it("decision protocol works identically through the PowerShell route", () => {
    stub3({ status: 2, stderr: "ps blocked\n" });
    const r = runCommandHook("Deny-Thing", {}, { shell: "powershell" });
    expect(r).toMatchObject({ decision: "block", reason: "ps blocked" });
  });
});

describe("tryParseDecision", () => {
  it("returns null for non-JSON stdout", () => {
    expect(tryParseDecision("just text")).toBeNull();
    expect(tryParseDecision("")).toBeNull();
  });
  it("approve → allow", () => {
    expect(tryParseDecision('{"decision":"approve"}').decision).toBe("allow");
  });
  it("recovers the decision from the first line when diagnostics follow", () => {
    const d = tryParseDecision('{"decision":"deny"}\nsome log\nmore log');
    expect(d.decision).toBe("block");
  });
  it("still parses pretty-printed (multi-line) JSON via the whole-text attempt", () => {
    const d = tryParseDecision('{\n  "decision": "block",\n  "reason": "x"\n}');
    expect(d).toMatchObject({ decision: "block", reason: "x" });
  });
  it("returns null for {-leading but unparseable stdout", () => {
    expect(tryParseDecision('{"decision":"block"')).toBeNull(); // truncated
    expect(tryParseDecision("{not json at all")).toBeNull();
  });
});

describe("runHooks — ordered short-circuit", () => {
  it("stops at the first block", () => {
    const seq = [
      { status: 0 },
      { status: 2, stderr: "blocked here" },
      { status: 0 },
    ];
    let i = 0;
    _deps.spawnSync = vi.fn(() => ({ stdout: "", stderr: "", ...seq[i++] }));
    const r = runHooks(
      [{ command: "a" }, { command: "b" }, { command: "c" }],
      {},
    );
    expect(r.decision).toBe("block");
    expect(r.hook).toBe("b");
    expect(r.results).toHaveLength(2); // c never ran
  });

  it("all continue → continue", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    const r = runHooks([{ command: "a" }, { command: "b" }], {});
    expect(r.decision).toBe("continue");
    expect(r.results).toHaveLength(2);
  });
});

describe("runHooks — mergeStrict (strictest-wins, all hooks run)", () => {
  // Map each hook command to a canned spawnSync result so order + which hooks
  // ran is observable.
  const RESULTS = {
    asker: { status: 0, stdout: '{"decision":"ask"}' },
    blocker: { status: 2, stderr: "blocked by policy" },
    allower: { status: 0, stdout: '{"decision":"approve"}' },
    cont: { status: 0, stdout: "" },
  };
  function stubByCommand() {
    _deps.spawnSync = vi.fn((cmd) => {
      calls.push({ cmd });
      return { status: 0, stdout: "", stderr: "", ...(RESULTS[cmd] || {}) };
    });
  }

  it("default (no mergeStrict): an earlier ask MASKS a later block", () => {
    stubByCommand();
    const r = runHooks([{ command: "asker" }, { command: "blocker" }], {});
    expect(r.decision).toBe("ask"); // short-circuits at asker
    expect(calls.map((c) => c.cmd)).toEqual(["asker"]); // blocker never ran
  });

  it("mergeStrict: a later block WINS over an earlier ask", () => {
    stubByCommand();
    const r = runHooks(
      [{ command: "asker" }, { command: "blocker" }],
      {},
      {
        mergeStrict: true,
      },
    );
    expect(r.decision).toBe("block");
    expect(r.hook).toBe("blocker");
    expect(calls.map((c) => c.cmd)).toEqual(["asker", "blocker"]); // both ran
    expect(r.results).toHaveLength(2);
    expect(r.contributing).toHaveLength(2);
  });

  it("mergeStrict: ask beats allow", () => {
    stubByCommand();
    const r = runHooks(
      [{ command: "allower" }, { command: "asker" }],
      {},
      {
        mergeStrict: true,
      },
    );
    expect(r.decision).toBe("ask");
  });

  it("mergeStrict: allow surfaces directly when nothing stricter fires", () => {
    stubByCommand();
    const r = runHooks(
      [{ command: "cont" }, { command: "allower" }],
      {},
      {
        mergeStrict: true,
      },
    );
    expect(r.decision).toBe("allow");
    expect(r.hook).toBe("allower");
  });

  it("mergeStrict: all continue → continue (both ran)", () => {
    stubByCommand();
    const r = runHooks(
      [{ command: "cont" }, { command: "cont" }],
      {},
      {
        mergeStrict: true,
      },
    );
    expect(r.decision).toBe("continue");
    expect(calls).toHaveLength(2);
  });
});

describe("hook circuit breaker (gap 2026-07-11: consecutive-failure trip)", () => {
  it("trips after 3 consecutive non-blocking failures and skips within cooldown", () => {
    stub({ status: 1, stderr: "flaky" });
    for (let i = 0; i < 3; i++) {
      const r = runCommandHook("flaky.sh", {}, {});
      expect(r.nonBlockingError).toBe(true);
    }
    // 4th run: breaker open → skipped, no spawn
    const spawnsBefore = calls.length;
    const r = runCommandHook("flaky.sh", {}, {});
    expect(r.skipped).toBe(true);
    expect(r.breakerOpen).toBe(true);
    expect(r.reason).toMatch(/circuit breaker open/);
    expect(calls.length).toBe(spawnsBefore);
  });

  it("a success closes the breaker (counter resets)", () => {
    stub({ status: 1, stderr: "flaky" });
    runCommandHook("reset.sh", {}, {});
    runCommandHook("reset.sh", {}, {});
    stub({ status: 0 }); // recovers
    calls = [];
    expect(runCommandHook("reset.sh", {}, {}).decision).toBe("continue");
    // two more failures ≠ threshold (counter restarted after the success)
    stub({ status: 1, stderr: "flaky" });
    runCommandHook("reset.sh", {}, {});
    const r = runCommandHook("reset.sh", {}, {});
    expect(r.skipped).toBeUndefined(); // still running, not tripped
  });

  it("half-open after cooldown: one trial runs; success closes it", async () => {
    process.env.CC_HOOK_BREAKER_COOLDOWN_MS = "5";
    try {
      stub({ status: 1, stderr: "down" });
      for (let i = 0; i < 3; i++) runCommandHook("cool.sh", {}, {});
      expect(runCommandHook("cool.sh", {}, {}).skipped).toBe(true);
      await new Promise((r) => setTimeout(r, 10)); // cooldown elapses
      stub({ status: 0 }); // service recovered
      const trial = runCommandHook("cool.sh", {}, {});
      expect(trial.skipped).toBeUndefined();
      expect(trial.decision).toBe("continue");
      // Closed again: subsequent runs execute normally.
      const again = runCommandHook("cool.sh", {}, {});
      expect(again.skipped).toBeUndefined();
    } finally {
      delete process.env.CC_HOOK_BREAKER_COOLDOWN_MS;
    }
  });

  it("blocking decisions never count as failures", () => {
    stub({ status: 2, stderr: "no" });
    for (let i = 0; i < 5; i++) {
      const r = runCommandHook("blocker.sh", {}, {});
      expect(r.decision).toBe("block"); // never skipped — block is the hook WORKING
    }
  });

  it("CC_HOOK_BREAKER_THRESHOLD=0 disables the breaker", () => {
    process.env.CC_HOOK_BREAKER_THRESHOLD = "0";
    try {
      stub({ status: 1, stderr: "flaky" });
      for (let i = 0; i < 6; i++) {
        const r = runCommandHook("nogate.sh", {}, {});
        expect(r.nonBlockingError).toBe(true);
        expect(r.skipped).toBeUndefined();
      }
    } finally {
      delete process.env.CC_HOOK_BREAKER_THRESHOLD;
    }
  });
});

describe("interpretHookOutcome — shared protocol interpreter", () => {
  it("maps spawn error / exit 2 / exit 0 JSON / other exit", () => {
    expect(interpretHookOutcome({ error: new Error("ENOENT") })).toMatchObject({
      decision: "continue",
      nonBlockingError: true,
    });
    expect(interpretHookOutcome({ status: 2, stderr: "nope" })).toMatchObject({
      decision: "block",
      reason: "nope",
    });
    expect(
      interpretHookOutcome({ status: 0, stdout: '{"decision":"ask"}' }),
    ).toMatchObject({ decision: "ask" });
    expect(interpretHookOutcome({ status: 1, stderr: "warn" })).toMatchObject({
      decision: "continue",
      nonBlockingError: true,
    });
  });
});

describe("runCommandHookAsync — async single hook", () => {
  it("writes the JSON payload to stdin and parses an exit-0 decision", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const p = runCommandHookAsync(
      "guard.sh",
      { tool_name: "Bash", x: 1 },
      { event: "PreToolUse" },
    );
    child.finish({ stdout: '{"decision":"block","reason":"bad"}' });
    const r = await p;
    expect(r).toMatchObject({ decision: "block", reason: "bad" });
    expect(child.stdinWrites[0]).toBe(
      JSON.stringify({
        tool_name: "Bash",
        x: 1,
        schema_version: HOOK_PAYLOAD_SCHEMA_VERSION,
      }),
    );
  });

  it("exit 2 → block", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const p = runCommandHookAsync("g.sh", {});
    child.finish({ code: 2, stderr: "blocked here" });
    expect((await p).decision).toBe("block");
  });

  it("spawn 'error' event → non-blocking continue", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const p = runCommandHookAsync("missing.sh", {});
    child.fail(new Error("ENOENT"));
    const r = await p;
    expect(r.decision).toBe("continue");
    expect(r.nonBlockingError).toBe(true);
  });

  it("SIGKILLs and reports non-blocking on timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild(); // never finishes
      _deps.spawn = vi.fn(() => child);
      const p = runCommandHookAsync("hang.sh", {}, { timeout: 5000 });
      await vi.advanceTimersByTimeAsync(5000);
      const r = await p;
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(r.decision).toBe("continue");
      expect(r.nonBlockingError).toBe(true);
      expect(r.reason).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runHooksParallel — concurrent strictest merge", () => {
  const RESULTS = {
    asker: { code: 0, stdout: '{"decision":"ask"}' },
    blocker: { code: 2, stderr: "blocked by policy" },
    allower: { code: 0, stdout: '{"decision":"approve"}' },
    cont: { code: 0, stdout: "" },
  };

  it("spawns all hooks concurrently and takes the strictest decision", async () => {
    const children = {};
    _deps.spawn = vi.fn((cmd) => {
      const c = fakeChild();
      children[cmd] = c;
      return c;
    });
    const p = runHooksParallel(
      [{ command: "asker" }, { command: "blocker" }],
      {},
    );
    // Both spawned up-front (concurrent), before any finishes.
    expect(Object.keys(children).sort()).toEqual(["asker", "blocker"]);
    // Finish out of order — the merge is order-independent.
    children.asker.finish(RESULTS.asker);
    children.blocker.finish(RESULTS.blocker);
    const r = await p;
    expect(r.decision).toBe("block"); // strictest wins over the earlier ask
    expect(r.hook).toBe("blocker");
    expect(r.results).toHaveLength(2);
    expect(r.contributing).toHaveLength(2);
  });

  it("allow surfaces when nothing stricter fires", async () => {
    const children = {};
    _deps.spawn = vi.fn((cmd) => (children[cmd] = fakeChild()));
    const p = runHooksParallel(
      [{ command: "cont" }, { command: "allower" }],
      {},
    );
    children.cont.finish(RESULTS.cont);
    children.allower.finish(RESULTS.allower);
    const r = await p;
    expect(r.decision).toBe("allow");
    expect(r.hook).toBe("allower");
  });

  it("all continue → continue (both ran)", async () => {
    // Same command twice → collect children in an ARRAY so neither is lost.
    const children = [];
    _deps.spawn = vi.fn(() => {
      const c = fakeChild();
      children.push(c);
      return c;
    });
    const p = runHooksParallel([{ command: "cont" }, { command: "cont" }], {});
    children.forEach((c) => c.finish(RESULTS.cont));
    const r = await p;
    expect(r.decision).toBe("continue");
    expect(_deps.spawn).toHaveBeenCalledTimes(2);
  });
});
