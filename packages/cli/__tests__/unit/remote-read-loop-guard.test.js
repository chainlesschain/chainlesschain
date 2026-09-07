import { describe, it, expect } from "vitest";
import {
  RemoteReadLoopGuard,
  remoteReadTarget,
} from "../../src/lib/remote-read-loop-guard.js";

const url =
  "https://github.com/chainlesschain/chainlesschain/actions/runs/34087984148/job/101635686798";
const command =
  "gh run view 34087984148 --job 101635686798 --log --repo chainlesschain/chainlesschain";

describe("remote read target classification", () => {
  it("identifies a GitHub job across web pages, log flags and API routes", () => {
    const expected = remoteReadTarget("web_fetch", { url });
    for (const value of [
      command,
      command.replace("--log", "--log-failed") + " | Select-String FAIL",
      "gh.exe run view 34087984148 -j 101635686798 --log -R chainlesschain/chainlesschain",
      "gh api repos/chainlesschain/chainlesschain/actions/jobs/101635686798/logs",
      "gh api --method GET /repos/chainlesschain/chainlesschain/actions/jobs/101635686798/logs",
    ])
      expect(remoteReadTarget("run_shell", { command: value })).toEqual(
        expected,
      );
    expect(
      remoteReadTarget("web_fetch", {
        url: "https://api.github.com/repos/chainlesschain/chainlesschain/actions/jobs/101635686798/logs",
      }),
    ).toEqual(expected);
  });

  it("keeps repos, jobs and attempts independent", () => {
    const key = remoteReadTarget("run_shell", { command }).key;
    for (const value of [
      command.replace("101635686798", "101635686799"),
      command.replace("chainlesschain/chainlesschain", "another/repo"),
      command + " --attempt 2",
    ])
      expect(remoteReadTarget("run_shell", { command: value }).key).not.toBe(
        key,
      );
    expect(remoteReadTarget("web_fetch", { url: url + "?attempt=2" })).toEqual(
      remoteReadTarget("run_shell", { command: command + " --attempt 2" }),
    );
  });

  it.each([
    "gh run view 123 --json status,conclusion",
    "gh run watch 123",
    "gh run rerun 123 --failed",
    "gh api repos/o/r/actions/runs/123",
    "gh api --method DELETE repos/o/r/actions/runs/123/logs",
    "gh api -f key=value repos/o/r/actions/runs/123/logs",
    "npm test",
  ])("leaves status monitoring and mutations out: %s", (value) => {
    expect(remoteReadTarget("run_shell", { command: value })).toBeNull();
  });
});

describe("remote read loop recovery", () => {
  it("counts failures across transports despite wording, flags, planning and local reads", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 6; i++) {
      const web = i % 2 === 0;
      guard.record(
        web ? "web_fetch" : "run_shell",
        { error: `failed attempt ${i}` },
        web ? { url } : { command },
      );
      guard.record("todo_write", { success: true });
      guard.record("read_file", { content: `file ${i}` });
      if (i === 1) expect(guard.recoveryHint).toBeNull();
      if (i === 2) {
        expect(guard.recoveryHint).toContain("--log-failed");
        expect(guard.takeRecoveryTurn()).toEqual(["web_fetch"]);
        expect(guard.takeRecoveryTurn()).toEqual([]);
      }
    }
    expect(guard.stalled).toBe(true);
    expect(guard.recoveryHint).toContain("not complete");
  });

  it("recognizes unchanged short CI logs from stdout, regardless of timings", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 4; i++)
      guard.record(
        "run_shell",
        { stdout: "FAIL macOS path assertion", durationMs: i },
        { command },
      );
    expect(guard.takeRecoveryTurn()).toEqual(["run_shell"]);
    expect(guard.findingsHint).toContain("FAIL macOS path assertion");
    guard.record(
      "run_shell",
      { stdout: "FAIL another test: new information" },
      { command },
    );
    expect(guard.recoveryHint).toBeNull();
    expect(guard.stalled).toBe(false);
  });

  it("preserves successful evidence through later failures and compaction", () => {
    const guard = new RemoteReadLoopGuard();
    guard.record("web_fetch", { content: "FAIL original assertion" }, { url });
    for (let i = 0; i < 3; i++)
      guard.record("web_fetch", { error: "HTTP 403" }, { url });
    const evidence = guard.findingsHint;
    expect(evidence).toContain("untrusted source data");
    expect(evidence).toContain("101635686798");
    expect(evidence).toContain("FAIL original assertion");
    expect(evidence).toContain("HTTP 403");
    expect(guard.takeRecoveryTurn()).toEqual(["web_fetch"]);
    expect(guard.findingsHint).toBe(evidence);
  });

  it("requires recovery guidance before stopping a large parallel batch", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 8; i++)
      guard.record("web_fetch", { error: "timeout" }, { url });
    expect(guard.stalled).toBe(false);
    guard.takeRecoveryTurn();
    expect(guard.stalled).toBe(true);
  });

  it("resets after a real edit or recovered fetch, but not a denied/no-op edit", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 3; i++)
      guard.record("web_fetch", { error: "timeout" }, { url });
    for (const result of [
      { error: "denied" },
      { success: true, changed: false },
      { success: true, alreadyApplied: true },
    ]) {
      guard.record("edit_file", result);
      expect(guard.recoveryHint).toBeTruthy();
    }
    guard.record("edit_file", { success: true });
    expect(guard.recoveryHint).toBeNull();
    for (let i = 0; i < 3; i++)
      guard.record("web_fetch", { error: "timeout" }, { url });
    expect(guard.recoveryHint).toBeTruthy();
    guard.record("web_fetch", { content: "recovered" }, { url });
    expect(guard.recoveryHint).toBeNull();
  });

  it("does not stop fresh log sections, separate jobs or ordinary web polling", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 12; i++) {
      guard.record("web_fetch", { content: `log section ${i}` }, { url });
      guard.record(
        "web_fetch",
        { error: "not available" },
        { url: url.replace("101635686798", String(i)) },
      );
      guard.record(
        "web_fetch",
        { content: "unchanged status" },
        { url: "https://example.com/status" },
      );
      guard.record(
        "run_shell",
        { stdout: "in_progress" },
        { command: "gh run view 123 --json status" },
      );
    }
    expect(guard.recoveryHint).toBeNull();
    expect(guard.stalled).toBe(false);
  });

  it("allows switching to a different source after an exhausted target", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 6; i++)
      guard.record("web_fetch", { error: "timeout" }, { url });
    guard.takeRecoveryTurn();
    expect(guard.stalled).toBe(true);
    const another = url.replace("101635686798", "42");
    guard.record(
      "web_fetch",
      { content: "new job evidence" },
      { url: another },
    );
    expect(guard.stalled).toBe(false);
    expect(guard.recoveryHint).toBeNull();
    for (let i = 0; i < 6; i++)
      guard.record("web_fetch", { error: "timeout" }, { url: another });
    // Guidance previously offered for the old target does not count for this one.
    expect(guard.stalled).toBe(false);
    guard.takeRecoveryTurn();
    expect(guard.stalled).toBe(true);
  });

  it("bounds retained sources and never includes credential-bearing URLs", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 100; i++)
      guard.record(
        "web_fetch",
        { content: "x".repeat(10000) },
        { url: `https://name:secret@example.com/${i}?token=secret` },
      );
    expect(guard.targets.size).toBe(32);
    expect(guard.findingsHint.length).toBeLessThan(6000);
    expect(guard.findingsHint).not.toContain("secret");
    expect(new RemoteReadLoopGuard().findingsHint).toBeNull();
  });
});
