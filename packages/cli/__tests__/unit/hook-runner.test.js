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
import runner from "../../src/lib/hook-runner.cjs";

const { runCommandHook, runHooks, tryParseDecision, _deps } = runner;

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
});

describe("runCommandHook — input + protocol", () => {
  it("writes the JSON payload to stdin", () => {
    stub({ status: 0 });
    runCommandHook("guard.sh", { tool_name: "Bash", x: 1 }, { event: "PreToolUse" });
    expect(calls[0].opts.input).toBe(JSON.stringify({ tool_name: "Bash", x: 1 }));
    expect(calls[0].opts.env.CLAUDE_HOOK_EVENT).toBe("PreToolUse");
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
      stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } }),
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
});

describe("tryParseDecision", () => {
  it("returns null for non-JSON stdout", () => {
    expect(tryParseDecision("just text")).toBeNull();
    expect(tryParseDecision("")).toBeNull();
  });
  it("approve → allow", () => {
    expect(tryParseDecision('{"decision":"approve"}').decision).toBe("allow");
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
