/**
 * REPL remote-approval race (gap-analysis 批26 — 批17/18 REPL 收口):
 * the interactive terminal prompt races a paired device's decision.
 *
 * Key interactive semantics under test:
 *   - local answer wins  → the device card is settled too (resolveLocally)
 *   - remote answer wins → the local prompt handle is canceled + noted
 *   - remote timeout / bridge close are NOT decisions — the terminal stays
 *     authoritative (headless fail-closed timeout must not leak in here)
 */

import { describe, it, expect, vi } from "vitest";
import {
  describeAskContext,
  raceLocalAndRemote,
} from "../../src/repl/remote-approval.js";

function fakeBridge({ requestId = "req-1" } = {}) {
  let settleRemote;
  const resolveLocally = vi.fn(() => true);
  const bridge = {
    requestDecision({ onRequestId } = {}) {
      if (requestId) onRequestId?.(requestId);
      return new Promise((resolve) => {
        settleRemote = resolve;
      });
    },
    resolveLocally,
  };
  return {
    bridge,
    resolveLocally,
    remote: (decision) => settleRemote(decision),
  };
}

function pendingLocal() {
  let settle;
  const cancel = vi.fn();
  return {
    local: {
      promise: new Promise((resolve) => {
        settle = resolve;
      }),
      cancel,
    },
    answer: (approved) => settle(approved),
    cancel,
  };
}

describe("describeAskContext", () => {
  it("prefers args.command as detail", () => {
    expect(
      describeAskContext({
        tool: "run_shell",
        args: { command: "npm publish" },
        riskLevel: "high",
      }),
    ).toEqual({
      tool: "run_shell",
      action: "high-risk",
      detail: "npm publish",
    });
  });

  it("falls back to args.path, then a JSON slice", () => {
    expect(
      describeAskContext({ tool: "write_file", args: { path: "/etc/x" } })
        .detail,
    ).toBe("/etc/x");
    const sliced = describeAskContext({
      tool: "edit_file",
      args: { big: "x".repeat(5000) },
    }).detail;
    expect(sliced.length).toBe(2000);
  });

  it("maps rule → ask-rule action and reason verbatim; empty ctx is all-null", () => {
    expect(
      describeAskContext({ tool: "run_shell", rule: "Bash(rm:*)" }).action,
    ).toBe("ask-rule:Bash(rm:*)");
    expect(
      describeAskContext({ tool: "write_file", reason: "sensitive file" })
        .action,
    ).toBe("sensitive file");
    expect(describeAskContext({})).toEqual({
      tool: null,
      action: null,
      detail: null,
    });
  });
});

describe("raceLocalAndRemote", () => {
  it("local answer wins → returns it and settles the device card", async () => {
    const { bridge, resolveLocally } = fakeBridge();
    const { local, answer } = pendingLocal();
    const race = raceLocalAndRemote({ bridge, ask: {}, local });
    answer(true);
    await expect(race).resolves.toBe(true);
    expect(resolveLocally).toHaveBeenCalledWith("req-1", true);
  });

  it("remote answer wins → cancels the local prompt and reports the source", async () => {
    const { bridge, remote } = fakeBridge();
    const { local, cancel } = pendingLocal();
    const out = [];
    const race = raceLocalAndRemote({
      bridge,
      ask: {},
      local,
      writeOut: (t) => out.push(t),
    });
    remote({ approved: false, via: "remote", from: "device-1" });
    await expect(race).resolves.toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(out.join("")).toContain("denied from paired device");
  });

  it("remote timeout is NOT a decision — the terminal stays authoritative", async () => {
    const { bridge, remote } = fakeBridge();
    const { local, answer, cancel } = pendingLocal();
    const race = raceLocalAndRemote({ bridge, ask: {}, local });
    remote({ approved: false, via: "timeout", from: null });
    // The race must still be waiting on the local prompt.
    answer(true);
    await expect(race).resolves.toBe(true);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("bridge closed mid-ask is NOT a decision either", async () => {
    const { bridge, remote } = fakeBridge();
    const { local, answer } = pendingLocal();
    const race = raceLocalAndRemote({ bridge, ask: {}, local });
    remote({ approved: false, via: "closed", from: null });
    answer(false);
    await expect(race).resolves.toBe(false);
  });

  it("a rejected local prompt denies (never throws out of the confirmer)", async () => {
    const { bridge, resolveLocally } = fakeBridge();
    const local = {
      promise: Promise.reject(new Error("readline torn down")),
      cancel: vi.fn(),
    };
    await expect(raceLocalAndRemote({ bridge, ask: {}, local })).resolves.toBe(
      false,
    );
    expect(resolveLocally).toHaveBeenCalledWith("req-1", false);
  });

  it("tolerates a bridge that never reports a requestId", async () => {
    const { bridge, resolveLocally } = fakeBridge({ requestId: null });
    const { local, answer } = pendingLocal();
    const race = raceLocalAndRemote({ bridge, ask: {}, local });
    answer(true);
    await expect(race).resolves.toBe(true);
    expect(resolveLocally).not.toHaveBeenCalled();
  });
});
