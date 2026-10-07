import { describe, expect, it } from "vitest";
import {
  RemoteReadLoopGuard,
  remoteReadTarget,
} from "../../src/lib/remote-read-loop-guard.js";

describe("Git and GitHub evidence inspection recovery", () => {
  it("permits revalidation after an actionable outcome without forgetting observed facts", () => {
    const guard = new RemoteReadLoopGuard();
    const args = { command: "gh run view 123 --json jobs" };
    for (let i = 0; i < 4; i++)
      guard.record(
        "run_shell",
        { stdout: "completed checks", exitCode: 0 },
        args,
      );
    guard.takeRecoveryTurn();
    guard.record(
      "run_shell",
      { stdout: "Tests passed", exitCode: 0 },
      { command: "npm test" },
      true,
    );
    expect(guard.recoveryHint).toBeNull();
    expect(guard.findingsHint).toContain("completed checks");
    guard.takeRecoveryTurn();
    expect(guard.shouldPause("run_shell", args)).toBe(false);
    guard.record(
      "run_shell",
      { stdout: "completed checks", exitCode: 0 },
      args,
    );
    expect(guard.targets.get(guard.activeKey).repeats).toBe(0);
  });

  it.each([
    ["git", "merge-base --is-ancestor fix HEAD"],
    ["git", "show fix --stat"],
    ["git", "branch -r --contains fix"],
    ["run_shell", "gh run view 123 --repo o/r --json headSha,jobs"],
    ["run_shell", "gh run list --repo o/r --workflow ci.yml"],
    ["run_shell", "gh workflow list --repo o/r --json name,path,id"],
    ["run_shell", "gh release list --repo o/r"],
    ["run_shell", "gh api repos/o/r/actions/runs/123"],
  ])(
    "bounds repeated %s: %s and retains the actual observation",
    (tool, command) => {
      const guard = new RemoteReadLoopGuard();
      for (let i = 0; i < 4; i++)
        guard.record(
          tool,
          { stdout: "observed evidence", exitCode: 0 },
          { command },
        );
      expect(guard.recoveryHint).toContain("already-seen evidence");
      expect(guard.takeRecoveryTurn()).toEqual([]);
      expect(guard.shouldPause(tool, { command })).toBe(true);
      expect(guard.shouldPause("run_shell", { command: "npm test" })).toBe(
        false,
      );
      expect(
        guard.shouldPause("run_shell", {
          command: "gh issue close 409 --repo o/r",
        }),
      ).toBe(false);
      expect(guard.findingsHint).toContain(command);
      expect(guard.findingsHint).toContain("observed evidence");
      guard.record(
        tool,
        { code: "CC_TOOL_RECOVERY_PAUSED", error: "paused" },
        { command },
      );
      expect(guard.synthesisRequired).toBe(false);
      for (let i = 0; i < 3; i++)
        guard.record(
          tool,
          { stdout: "observed evidence", exitCode: 0 },
          { command },
        );
      expect(guard.synthesisRequired).toBe(true);
    },
  );

  it("detects rotation through several completed targets, without waiting for six repeats of one", () => {
    const guard = new RemoteReadLoopGuard();
    const commands = [
      "show fix --stat",
      "merge-base --is-ancestor fix HEAD",
      "remote -v",
      "log -3 --oneline",
    ];
    for (const command of commands)
      guard.record("git", { stdout: command, exitCode: 0 }, { command });
    for (let i = 0; i < 12; i++) {
      const command = commands[i % commands.length];
      guard.record("git", { stdout: command, exitCode: 0 }, { command });
      guard.takeRecoveryTurn();
    }
    expect(guard.synthesisRequired).toBe(true);
    expect(
      [...guard.targets.values()].every((entry) => entry.repeats < 6),
    ).toBe(true);
  });

  it("keeps true, false and fatal Git results distinct", () => {
    const guard = new RemoteReadLoopGuard();
    const args = { command: "merge-base --is-ancestor base HEAD" };
    for (const predicateResult of [true, false]) {
      guard.record(
        "git",
        {
          success: true,
          stdout: "",
          exitCode: predicateResult ? 0 : 1,
          predicateResult,
        },
        args,
      );
      expect(guard.targets.get(guard.activeKey)).toMatchObject({
        failed: false,
        repeats: 0,
        predicateResult,
      });
    }
    guard.record(
      "git",
      { error: "fatal: missing object", exitCode: 128 },
      args,
    );
    expect(guard.targets.get(guard.activeKey)).toMatchObject({ failed: true });
  });

  it("groups malformed Git syntax even when the commit changes", () => {
    const guard = new RemoteReadLoopGuard();
    for (let i = 0; i < 4; i++)
      guard.record(
        "git",
        {
          error: "shell operators are not executed",
          code: "CC_GIT_SHELL_SYNTAX",
        },
        { command: `merge-base --is-ancestor commit${i} HEAD; echo $?` },
      );
    expect(guard.recoveryHint).toBeTruthy();
    guard.takeRecoveryTurn();
    expect(
      guard.shouldPause("git", {
        command: "merge-base --is-ancestor another HEAD; echo $?",
      }),
    ).toBe(true);
    expect(
      guard.shouldPause("git", {
        command: "merge-base --is-ancestor another HEAD",
      }),
    ).toBe(false);
  });

  it("groups presentation changes but preserves repo, filter and attempt identity", () => {
    const command = "gh run view 123 --repo o/r --json headSha,jobs";
    const target = remoteReadTarget("run_shell", { command });
    expect(
      remoteReadTarget("run_shell", {
        command: "gh api repos/o/r/actions/runs/123",
      }),
    ).toEqual(target);
    expect(
      remoteReadTarget("run_shell", {
        command:
          'gh run view 123 -R o/r --json jobs,headSha --jq ".jobs[] | .name"',
      }),
    ).toEqual(target);
    for (const other of [
      command.replace("123", "124"),
      command.replace("o/r", "o/s"),
      command + " --attempt 2",
      command + " --job 456",
    ]) {
      expect(remoteReadTarget("run_shell", { command: other }).key).not.toBe(
        target.key,
      );
    }
    expect(
      remoteReadTarget("git", { cwd: "/one", command: "show HEAD" }).key,
    ).not.toBe(
      remoteReadTarget("git", { cwd: "/two", command: "show HEAD" }).key,
    );
  });

  it.each([
    ["run_shell", "gh run view 123 --json status,conclusion,headSha"],
    ["run_shell", "gh run watch 123"],
    ["run_shell", "gh api repos/o/r/actions/runs/123 --jq .status"],
    ["run_shell", "gh api -X POST repos/o/r/actions/runs/123"],
    ["run_shell", "gh api -XPOST repos/o/r/actions/runs/123"],
    ["run_shell", "gh api repos/o/r/actions/runs/123 -f key=value"],
    ["run_shell", "gh workflow run ci.yml"],
    ["run_shell", "gh run rerun 123"],
    ["run_shell", "gh release create v1"],
    ["run_shell", "gh run list; gh issue close 409"],
    ["git", "branch -r -d old"],
    ["git", "show HEAD --output patch.txt"],
    ["git", "commit -m fix"],
  ])("leaves monitoring and actions available: %s %s", (tool, command) => {
    expect(remoteReadTarget(tool, { command })).toBeNull();
  });

  it("does not treat changing evidence or another command's error as a repeated success", () => {
    const guard = new RemoteReadLoopGuard();
    const args = { command: "gh run view 123 --json jobs" };
    for (let i = 0; i < 20; i++)
      guard.record(
        "run_shell",
        { stdout: `job ${i} completed`, exitCode: 0 },
        args,
      );
    expect(guard.recoveryHint).toBeNull();
    for (let i = 0; i < 4; i++)
      guard.record("run_shell", { stdout: "final result", exitCode: 0 }, args);
    guard.record(
      "git",
      { error: "missing ref", exitCode: 128 },
      { command: "show missing" },
    );
    expect(guard.findingsHint).toContain("final result");
    expect(guard.findingsHint).toContain("missing ref");
  });
});
