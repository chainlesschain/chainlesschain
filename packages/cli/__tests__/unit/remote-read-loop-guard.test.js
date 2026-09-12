import { describe, it, expect } from "vitest";
import {
  RemoteReadLoopGuard,
  remoteReadTarget,
} from "../../src/lib/remote-read-loop-guard.js";
import { inspectEvolutionContentInjectionRisks } from "../../src/lib/evolution/evolution-evidence-projector.js";

const url =
  "https://github.com/chainlesschain/chainlesschain/actions/runs/34087984148/job/101635686798";
const command =
  "gh run view 34087984148 --job 101635686798 --log --repo chainlesschain/chainlesschain";

describe("remote read target classification", () => {
  it("groups PR pages, gh pr reads and read-only API requests by repository and PR", () => {
    const expected = remoteReadTarget("web_fetch", {
      url: "https://github.com/Owner/Repo/pull/340#discussion",
    });
    expect(expected).toMatchObject({ pullRequest: true });
    for (const command of [
      "gh pr view 340 --repo Owner/Repo --json number,title,state,mergedAt",
      'gh.exe pr view --repo="owner/repo" 340 --json=body,commits 2>&1',
      "gh pr diff 340 -R owner/repo",
      "gh pr view https://github.com/owner/repo/pull/340",
      "gh api --method GET repos/owner/repo/pulls/340",
      "gh api repos/owner/repo/pulls/340/files?per_page=100",
      "gh api /repos/owner/repo/pulls/340/reviews",
    ])
      expect(remoteReadTarget("run_shell", { command })).toEqual(expected);
    for (const url of [
      "https://github.com/owner/repo/pull/340/files",
      "https://github.com/owner/repo/pull/340/checks",
      "https://github.com/owner/repo/pull/340.diff",
      "https://api.github.com/repos/owner/repo/pulls/340/commits",
    ])
      expect(remoteReadTarget("web_fetch", { url })).toEqual(expected);
    const list = remoteReadTarget("web_fetch", {
      url: "https://github.com/owner/repo/pulls",
    });
    expect(
      remoteReadTarget("run_shell", {
        command:
          "gh pr list --repo owner/repo --state open --json number,title,merged 2>&1",
      }),
    ).toEqual(list);
    expect(
      remoteReadTarget("run_shell", {
        command: "gh api repos/owner/repo/pulls?state=open",
      }),
    ).toEqual(list);
    expect(
      remoteReadTarget("run_shell", {
        command: "gh pr view 339 --repo owner/repo",
      }),
    ).not.toEqual(expected);
    expect(
      remoteReadTarget("run_shell", {
        command: "gh pr view 340 --repo other/repo",
      }),
    ).not.toEqual(expected);
  });

  it.each([
    "gh pr checks 340 --repo owner/repo --watch",
    "gh pr view 340 --repo owner/repo --json state,statusCheckRollup",
    "gh pr view 340 --repo owner/repo --json=state,mergedAt",
    "gh pr close 340 --repo owner/repo",
    "gh pr merge 340 --repo owner/repo",
    "gh api -X PATCH repos/owner/repo/pulls/340",
    "gh api -XDELETE repos/owner/repo/pulls/340",
    "gh api repos/owner/repo/pulls/340 -f state=closed",
    "gh api repos/owner/repo/pulls/340 -fstate=closed",
    "gh api repos/owner/repo/pulls/340 --input body.json",
  ])("excludes PR monitoring and mutations: %s", (command) => {
    expect(remoteReadTarget("run_shell", { command })).toBeNull();
  });
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

  it("groups local CI-log searches by file instead of search wording", () => {
    const first = remoteReadTarget("run_shell", {
      command:
        'cd c:\\code\\chainlesschain && findstr /n "Failed Tests" "%TEMP%\\gh-run-log.txt"',
    });
    const second = remoteReadTarget("run_shell", {
      command:
        'findstr /n "FAIL\\|AssertionError\\|Error:" "%TEMP%\\gh-run-log.txt"',
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ github: true, localLog: true });
    expect(first.key).toMatch(/^local-ci-log:/u);
    expect(
      remoteReadTarget("run_shell", {
        command: 'findstr /n "version" README.txt',
      }),
    ).toBeNull();
  });
});

describe("remote read loop recovery", () => {
  it.each(["pull-request", "shell-policy"])(
    "keeps %s recovery guidance safe for the real projection without weakening authorization",
    (kind) => {
      const guard = new RemoteReadLoopGuard();
      for (let index = 0; index < 4; index++) {
        if (kind === "pull-request") {
          guard.record(
            "run_shell",
            { stdout: "unchanged PR details" },
            {
              command:
                "gh pr view 340 --repo fixture/repo --json number,title,state",
            },
          );
        } else {
          guard.record(
            "run_shell",
            {
              error: "Use the dedicated git tool",
              shellCommandPolicy: {
                decision: "reroute",
                ruleId: "git-tool-reroute",
              },
            },
            { command: `git branch -r --contains commit-${index} 2>&1` },
          );
        }
      }
      expect(guard.recoveryHint).toContain("Respect the execution policy");
      expect(guard.recoveryHint).toContain(
        "stop and report the blocked action",
      );
      expect(guard.recoveryHint).toContain(
        kind === "pull-request"
          ? "only already-authorized PR actions"
          : "Keep execution permissions unchanged",
      );
      expect(inspectEvolutionContentInjectionRisks(guard.recoveryHint)).toEqual(
        [],
      );
    },
  );

  it("guides CI investigation from the first result without promoting log text to instructions", () => {
    const guard = new RemoteReadLoopGuard();
    guard.record("web_fetch", { content: "UNTRUSTED_LOG_TEXT" }, { url });
    expect(guard.workflowHint).toContain("incomplete-matrix gate");
    expect(guard.workflowHint).toContain("cancelled or logs are unavailable");
    expect(guard.workflowHint).toContain("authorized fix with validation");
    expect(guard.workflowHint).not.toContain("UNTRUSTED_LOG_TEXT");
    expect(guard.findingsHint).toContain("UNTRUSTED_LOG_TEXT");
    expect(guard.recoveryHint).toBeNull();
  });

  it("groups repeated git policy reroutes across changing commits and recovers on the dedicated tool", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 6; i++) {
      guard.record(
        "run_shell",
        {
          error: "Use the dedicated git tool",
          shellCommandPolicy: {
            decision: "reroute",
            ruleId: "git-tool-reroute",
          },
        },
        { command: `git branch -r --contains commit-${i} 2>&1` },
      );
      if (i === 2) expect(guard.takeRecoveryTurn()).toEqual(["run_shell"]);
    }
    expect(guard.stalled).toBe(true);
    expect(guard.recoveryHint).toContain("Tool-policy loop recovery");
    expect(guard.findingsHint).toContain("shell policy rejection");
    guard.record("git", { error: "not a git repository" });
    expect(guard.stalled).toBe(false);
    expect(guard.findingsHint).toContain("not a git repository");
    guard.record("git", { stdout: "origin/main", readOnly: true });
    expect(guard.stalled).toBe(false);
    expect(guard.recoveryHint).toBeNull();
  });
  it("bounds alternating PR web/CLI/API responses and errors without losing all four candidates", () => {
    const guard = new RemoteReadLoopGuard();
    const numbers = [340, 339, 332, 331];
    for (let round = 0; round < 9; round++) {
      for (const number of numbers) {
        const shell = round % 3 !== 0;
        guard.record(
          shell ? "run_shell" : "web_fetch",
          shell
            ? round % 3 === 1
              ? { stdout: `PR ${number} metadata` }
              : { error: "Unknown JSON field: merged" }
            : { content: `PR ${number} webpage` },
          shell
            ? {
                command: `gh pr view ${number} --repo owner/repo --json title,merged`,
              }
            : { url: `https://github.com/owner/repo/pull/${number}` },
        );
        guard.takeRecoveryTurn();
      }
    }
    expect(guard.stalled).toBe(true);
    expect(guard.recoveryHint).toContain("state and mergedAt");
    expect(guard.recoveryHint).toContain("not complete");
    for (const number of numbers)
      expect(guard.findingsHint).toContain(`PR ${number}`);
    expect(guard.findingsHint).toContain("Unknown JSON field");
    expect(guard.workflowHint).toContain("origin");
    expect(guard.workflowHint).toContain("already authorized");
  });

  it("accepts new PR facts and forward pages, even after a recovery turn", () => {
    const guard = new RemoteReadLoopGuard();
    const args = { url: "https://github.com/owner/repo/pull/340" };
    for (let i = 0; i < 4; i++)
      guard.record("web_fetch", { content: "PR title" }, args);
    expect(guard.takeRecoveryTurn()).toEqual(["web_fetch"]);
    guard.record("web_fetch", { content: "PR diff" }, args);
    expect(guard.recoveryHint).toBeNull();
    for (let i = 0; i < 10; i++) {
      guard.record(
        "web_fetch",
        { content: "same line\n", snapshotId: "pr", offset: i * 10 },
        args,
      );
      expect(guard.stalled).toBe(false);
      expect(guard.recoveryHint).toBeNull();
    }
  });

  it("counts overlapping windows across PR details, files and checks as repeats", () => {
    const guard = new RemoteReadLoopGuard();
    const pages = ["", "/files", "/checks"];
    const record = (page, offset, length) =>
      guard.record(
        "web_fetch",
        {
          content: page.padEnd(100, "x").slice(offset, offset + length),
          snapshotId: `snapshot-${page}`,
          offset,
        },
        { url: `https://github.com/owner/repo/pull/340${page}` },
      );
    for (const page of pages) record(page, 0, 100);
    for (let i = 0; i < 6; i++) {
      record(pages[i % 3], i + 1, 20 + i);
      guard.takeRecoveryTurn();
    }
    expect(guard.targets.size).toBe(1);
    expect(guard.stalled).toBe(true);
    record("/files", 100, 10);
    expect(guard.stalled).toBe(true);
    // An empty tail is not new evidence; a genuinely unread gap is.
    const gap = new RemoteReadLoopGuard();
    for (const offset of [20, 0, 10]) {
      gap.record(
        "web_fetch",
        { content: "same text!", snapshotId: "gap", offset },
        { url: "https://github.com/owner/repo/pull/340/files" },
      );
      expect(gap.targets.values().next().value.repeats).toBe(0);
    }
  });

  it("preserves the real error when a paused tool is requested again", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 3; i++)
      guard.record(
        "web_fetch",
        { error: "HTTP 403: missing repository access" },
        { url },
      );
    guard.takeRecoveryTurn();
    for (let i = 0; i < 3; i++)
      guard.record(
        "web_fetch",
        { code: "CC_TOOL_RECOVERY_PAUSED", error: "paused" },
        { url },
      );
    expect(guard.stalled).toBe(true);
    expect(guard.findingsHint).toContain("missing repository access");
  });

  it("retains bounded PR evidence as source data rather than system guidance", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 100; i++)
      guard.record(
        "web_fetch",
        { content: "UNTRUSTED".repeat(2000) },
        { url: `https://github.com/owner/repo/pull/${i}` },
      );
    expect(guard.targets.size).toBe(32);
    expect(JSON.parse(guard.findingsHint.split("\n")[1])).toHaveLength(8);
    expect(guard.findingsHint.length).toBeLessThan(12000);
    expect(guard.workflowHint).not.toContain("UNTRUSTED");
    expect(guard.recoveryHint).toBeNull();
  });
  it("stops changing findstr patterns from looping on one saved CI log", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 6; i++) {
      guard.record(
        "run_shell",
        { exitCode: 1, error: `Command failed (exit 1), pattern ${i}` },
        {
          command: `findstr /n "missing-${i}" "%TEMP%\\gh-run-log.txt"`,
        },
      );
      if (i === 2) {
        expect(guard.recoveryHint).toContain("exit code 1 means no match");
        expect(guard.takeRecoveryTurn()).toEqual([]);
      }
    }
    expect(guard.findingsHint).toContain("saved GitHub Actions log");
    expect(guard.stalled).toBe(true);
  });

  it("retains the saved cursor and accepts forward pages with identical text", () => {
    const guard = new RemoteReadLoopGuard();
    for (let offset = 0; offset < 100; offset += 10) {
      guard.record(
        "web_fetch",
        {
          content: "same line\n",
          snapshotId: "saved-job",
          offset,
          nextOffset: offset + 10,
          hasMore: true,
          totalChars: 1000,
        },
        { url },
      );
      expect(guard.recoveryHint).toBeNull();
    }
    expect(guard.findingsHint).toContain('"nextOffset":100');
    expect(guard.findingsHint).toContain('"snapshotId":"saved-job"');
  });

  it("still detects repeated saved pages and fresh downloads of identical text", () => {
    for (const freshSnapshot of [false, true]) {
      const guard = new RemoteReadLoopGuard();
      for (let i = 0; i < 7; i++) {
        guard.record(
          "web_fetch",
          {
            content: "same line\n",
            snapshotId: freshSnapshot ? `download-${i}` : "saved-job",
            offset: 0,
            nextOffset: 10,
          },
          { url },
        );
        if (i === 3) expect(guard.takeRecoveryTurn()).toEqual(["web_fetch"]);
      }
      expect(guard.stalled).toBe(true);
    }
  });

  it("does not count bouncing between previously read pages as forward progress", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 8; i++) {
      guard.record(
        "web_fetch",
        {
          content: "same line\n",
          snapshotId: "saved-job",
          offset: i % 2 === 0 ? 20 : 0,
          nextOffset: i % 2 === 0 ? 30 : 10,
        },
        { url },
      );
    }
    expect(guard.recoveryHint).not.toBeNull();
  });

  it("retains size recovery guidance and clears failures after a corrected fetch", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 3; i++) {
      guard.record(
        "web_fetch",
        {
          error: "response exceeds maxBytes (20000)",
          code: "ERR_RESPONSE_TOO_LARGE",
          hint: "Use maxChars and omit maxBytes for the default 10 MB download budget.",
        },
        { url },
      );
    }
    expect(guard.takeRecoveryTurn()).toEqual(["web_fetch"]);
    expect(guard.findingsHint).toContain("ERR_RESPONSE_TOO_LARGE");
    expect(guard.findingsHint).toContain("Use maxChars");
    guard.record(
      "web_fetch",
      { content: "Page contents", truncated: true },
      { url },
    );
    expect(guard.stalled).toBe(false);
    expect(guard.recoveryHint).toBeNull();
  });

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
    expect(guard.takeRecoveryTurn()).toEqual([]);
    expect(guard.shouldPause("run_shell", { command })).toBe(true);
    expect(guard.shouldPause("run_shell", { command: "npm test" })).toBe(false);
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
