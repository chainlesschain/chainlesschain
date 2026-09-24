import { describe, it, expect } from "vitest";
import { TaskProgressTracker } from "../../src/lib/task-progress-tracker.js";

const observe = (tracker, count) => {
  for (let i = 0; i < count; i++)
    tracker.record("read_file", {
      path: `new-file-${i}.js`,
      readProgress: { newContent: true },
    });
};

describe("long-running task progress", () => {
  it.each([
    "fetch github main",
    "branch -a",
    "branch --show-current",
    "branch --contains abc",
    "tag --sort=-creatordate",
    "status -sb",
    "show abc --stat",
  ])("does not count repository discovery as delivery: %s", (command) => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);
    expect(tracker.record("git", { exitCode: 0 }, { command })).toBe(false);
    expect(tracker.intervention.recovery).toBe(true);
  });

  it.each([
    'execSync("gh run view 36002210130 --json jobs");',
    'function gh(args) { return execSync("gh " + args); } console.log(gh("run view 36002210130 --log-failed"));',
    'subprocess.check_output("gh run list --limit 15", shell=True)',
    'const run = JSON.parse(fs.readFileSync("runlist.json", "utf8")); console.log(run);',
    'console.log(fs.readdirSync(".github/workflows"));',
    'execSync("gh workflow list --limit 50");',
  ])("keeps recovery active across changing script output: %s", (code) => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);
    for (let i = 0; i < 4; i++) {
      expect(
        tracker.record(
          "run_code",
          { success: true, output: `evidence ${i}` },
          { code },
        ),
      ).toBe(false);
    }
    expect(tracker.explorationCalls).toBe(28);
    expect(tracker.intervention.recovery).toBe(true);
    expect(tracker.checkpointFor()).toContain("evidence 3");
    expect(
      JSON.parse(tracker.checkpointFor().split("\n")[1]).recentToolOutcomes,
    ).toEqual([]);
  });

  it.each([
    'const data = fs.readFileSync("fix.js"); fs.writeFileSync("fix.js", transform(data));',
    'const data = JSON.parse(fs.readFileSync("actual.json")); assert.equal(data.ok, true);',
    'execSync("gh pr merge 123 --merge");',
    'execSync("npm test");',
    'execSync("gh run rerun 123 --failed");',
  ])("allows changes and verification to end recovery: %s", (code) => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);
    expect(
      tracker.record("run_code", { success: true, output: "done" }, { code }),
    ).toBe(true);
    expect(tracker.intervention).toBeNull();
  });

  it("keeps investigation recovery active across the issue-351 Git query sequence", () => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);
    for (const command of [
      "merge-base --is-ancestor 827c7e77 5142f674",
      'grep -n "Setup Python" 5142f674 -- .github/workflows',
      "remote -v",
      "git rev-list --count HEAD",
      "ls-files scripts",
      "ls-tree HEAD",
      "cat-file -p HEAD",
      "branch --list feature/*",
      "tag --list v-*",
    ]) {
      expect(
        tracker.record(
          "git",
          { readOnly: false, exitCode: 0, stdout: "" },
          { command },
        ),
      ).toBe(false);
      expect(tracker.intervention.recovery).toBe(true);
    }
    expect(tracker.explorationCalls).toBe(33);
    expect(
      tracker.record(
        "git",
        { exitCode: 0 },
        { command: "remote add upstream example" },
      ),
    ).toBe(true);
  });

  it("retains Git exit-code evidence and syntax corrections through compaction", () => {
    const tracker = new TaskProgressTracker();
    tracker.record(
      "git",
      { exitCode: 0, stdout: "", readOnly: false },
      {
        command: "merge-base --is-ancestor fix failed-head",
      },
      "parent",
    );
    tracker.record(
      "git",
      {
        error: "The git tool accepts Git arguments only",
        code: "CC_GIT_SHELL_SYNTAX",
        hint: "Submit one Git command without pipes or &&",
      },
      { command: "merge-base --is-ancestor fix failed-head; echo $?" },
      "parent",
    );
    const checkpoint = JSON.parse(
      tracker.checkpointFor("parent").split("\n")[1],
    );
    expect(checkpoint.recentDiagnostics[0]).toMatchObject({
      source: "git-inspection",
      exitCode: 0,
      invocation: "merge-base --is-ancestor fix failed-head",
    });
    expect(checkpoint.recentDiagnostics[1].output).toContain(
      "without pipes or &&",
    );
    expect(checkpoint.recentDiagnostics[1].code).toBe("CC_GIT_SHELL_SYNTAX");
    expect(checkpoint.recentToolOutcomes).toEqual([]);
    expect(tracker.checkpointFor("child")).toBeNull();
  });

  it("preserves the latest local source evidence when remote diagnostics fill the checkpoint", () => {
    const tracker = new TaskProgressTracker();
    tracker.record(
      "read_file",
      { content: "critical source implementation" },
      { path: "gate.js" },
    );
    for (let i = 0; i < 4; i++)
      tracker.record(
        "run_shell",
        { stdout: "log".repeat(1000), exitCode: 0 },
        {
          command: `gh run view ${i} --json jobs ` + " ".repeat(1000),
        },
      );
    expect(tracker.checkpointFor()).toContain("critical source implementation");
    expect(tracker.checkpointFor().length).toBeLessThan(6200);
  });

  it("marks truncated commands and lost output instead of implying a complete reproduction", () => {
    const tracker = new TaskProgressTracker({ now: () => 123 });
    tracker.record(
      "run_shell",
      { background: true, task_id: "bg_2" },
      { command: "test ".repeat(400) },
    );
    tracker.record(
      "check_shell",
      {
        task_id: "bg_2",
        status: "exited",
        exitCode: 0,
        stdout: "all passed",
        stdout_dropped_bytes: 128,
      },
      { task_id: "bg_2" },
    );
    tracker.record(
      "check_shell",
      {
        task_id: "bg_2",
        status: "exited",
        exitCode: 0,
        stdout: "",
        has_more_output: false,
      },
      { task_id: "bg_2" },
    );
    const evidence = JSON.parse(tracker.checkpointFor().split("\n")[1])
      .recentDiagnostics[0];
    expect(evidence).toMatchObject({
      observedAt: 123,
      invocationTruncated: true,
      outputLost: true,
      outputIncomplete: true,
      exitCode: 0,
    });
    expect(evidence.invocation.length).toBeLessThanOrEqual(1000);
  });
  it("keeps local reproduction failures distinct from remote evidence after compaction", () => {
    const tracker = new TaskProgressTracker();
    tracker.record(
      "run_shell",
      { stdout: "CI artifact: success=true; process exit=1", exitCode: 0 },
      {
        command:
          "gh run view 34976296391 --job 104404747888 --log-failed --repo owner/repo",
      },
    );
    tracker.record(
      "run_shell",
      { background: true, task_id: "bg_1", status: "running" },
      {
        command:
          "node scripts/run-vitest-with-worker-retry.mjs -- run subset.test.js",
      },
    );
    tracker.record(
      "check_shell",
      {
        task_id: "bg_1",
        status: "failed",
        exitCode: 1,
        stdout:
          "Error: Cannot find package '@chainlesschain/session-core'\n at local-test.js:7:1",
        has_more_output: true,
      },
      { task_id: "bg_1" },
    );
    tracker.record(
      "check_shell",
      {
        task_id: "bg_1",
        status: "failed",
        exitCode: 1,
        stdout: "",
        has_more_output: false,
      },
      { task_id: "bg_1" },
    );
    const checkpoint = JSON.parse(tracker.checkpointFor().split("\n")[1]);
    expect(checkpoint.recentDiagnostics).toHaveLength(2);
    expect(checkpoint.recentDiagnostics[0].source).toBe("remote-inspection");
    expect(checkpoint.recentDiagnostics[1]).toMatchObject({
      source: "local-execution",
      taskId: "bg_1",
      exitCode: 1,
      outputIncomplete: false,
    });
    expect(checkpoint.recentDiagnostics[1].output).toContain(
      "local-test.js:7:1",
    );
    expect(tracker.checkpointFor("another-agent")).toBeNull();
    expect(
      checkpoint.recentToolOutcomes.some(
        (entry) => entry.tool === "check_shell",
      ),
    ).toBe(false);
  });
  it("retains bounded local evidence across compaction without counting reads as actions", () => {
    const tracker = new TaskProgressTracker();
    for (let i = 0; i < 8; i++) {
      tracker.record(
        "search_files",
        { matches: [`test.js:${i}: ready timeout ${i}`] },
        { path: "test.js", pattern: "ready" },
        "parent",
      );
    }
    const checkpoint = tracker.checkpointFor("parent");
    expect(checkpoint).toContain("ready timeout 7");
    expect(checkpoint).not.toContain("ready timeout 0");
    expect(tracker.checkpointFor("child")).toBeNull();
    expect(tracker.explorationCalls).toBe(8);
    expect(JSON.parse(checkpoint.split("\n")[1]).recentToolOutcomes).toEqual(
      [],
    );
  });
  it.each([
    "gh run view 34431657410 --repo owner/repo 2>&1",
    "gh.exe run view --job 102728250679 -R owner/repo",
    "gh run view 123 --json status,conclusion",
    "gh run list --repo owner/repo",
    "gh run watch 123",
    "gh pr view 123 --json state,statusCheckRollup",
    "gh pr checks 123 --watch",
    "gh auth status",
    "gh api repos/owner/repo/actions/runs/123/jobs",
    "gh api -X GET repos/owner/repo/actions/jobs/456",
    "gh api repos/owner/repo/compare/main...feature",
    "gh api repos/owner/repo/releases/latest",
    "gh api repos/owner/repo/commits/abc/check-runs",
    "gh api --method=GET /repos/owner/repo/actions/runs/123",
  ])("does not clear recovery with changing remote status: %s", (command) => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);
    const key = tracker.intervention.key;
    for (let i = 0; i < 3; i++) {
      expect(
        tracker.record("run_shell", { stdout: `status ${i}` }, { command }),
      ).toBe(false);
      expect(tracker.intervention).toMatchObject({ key, recovery: true });
    }
    expect(tracker.explorationCalls).toBe(27);
    expect(tracker.checkpointFor()).toContain("status 2");
    expect(
      JSON.parse(tracker.checkpointFor().split("\n")[1]).recentToolOutcomes,
    ).toHaveLength(0);
    tracker.record("edit_file", { success: true, path: "workflow.yml" });
    expect(tracker.intervention).toBeNull();
  });

  it.each([
    "gh run rerun 123 --failed",
    "gh pr close 123",
    "gh api -X POST repos/owner/repo/actions/runs/123/rerun",
    "gh api -XPOST repos/owner/repo/actions/runs/123/rerun",
    "gh api --method=DELETE repos/owner/repo/actions/runs/123/logs",
    "gh api repos/owner/repo/pulls/123 -f state=closed",
    "gh api repos/owner/repo/pulls/123 --input body.json",
    "npm test",
  ])("still recognizes successful actions and validation: %s", (command) => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);
    expect(
      tracker.record("run_shell", { stdout: "success" }, { command }),
    ).toBe(true);
    expect(tracker.intervention).toBeNull();
  });

  it("counts PR discovery and read-only git without treating them as completed actions", () => {
    const tracker = new TaskProgressTracker();
    for (let i = 0; i < 12; i++) {
      expect(
        tracker.record(
          "run_shell",
          { stdout: `PR ${i}` },
          {
            command: `gh pr view ${i} --repo owner/repo --json title,body`,
          },
        ),
      ).toBe(false);
      expect(
        tracker.record("git", { readOnly: true, stdout: `diff ${i}` }),
      ).toBe(false);
    }
    expect(tracker.explorationCalls).toBe(24);
    expect(tracker.intervention.recovery).toBe(true);
    expect(
      tracker.record(
        "run_shell",
        { stdout: "test suite passed" },
        { command: "npm test" },
      ),
    ).toBe(true);
    expect(tracker.checkpointFor()).toContain("test suite passed");
  });

  it("uses actual shell stdout for duplicate detection and alternate exit codes for failures", () => {
    const tracker = new TaskProgressTracker();
    tracker.record("run_shell", { stdout: "first verification" });
    expect(tracker.record("run_shell", { stdout: "second verification" })).toBe(
      true,
    );
    observe(tracker, 12);
    expect(tracker.record("run_shell", { stdout: "second verification" })).toBe(
      false,
    );
    expect(
      tracker.record("run_shell", { stdout: "failed", exit_code: 1 }),
    ).toBe(false);
    expect(tracker.explorationCalls).toBe(14);
  });
  it("counts even changing short GitHub log excerpts as exploration", () => {
    const tracker = new TaskProgressTracker();
    for (let i = 0; i < 12; i++) {
      expect(
        tracker.record(
          "run_shell",
          { stdout: `FAIL test ${i}` },
          {
            command: "gh run view 123 --job 456 --log-failed --repo owner/repo",
          },
        ),
      ).toBe(false);
    }
    expect(tracker.explorationCalls).toBe(12);
    expect(tracker.intervention).toBeTruthy();
  });
  it("intervenes even when every read returns new content", () => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 11);
    expect(tracker.intervention).toBe(null);
    observe(tracker, 1);
    expect(tracker.intervention.recovery).toBe(false);
    observe(tracker, 12);
    expect(tracker.intervention.recovery).toBe(true);
    expect(tracker.intervention.guidance).toContain("do not write files");
    expect(tracker.intervention.guidance).toContain("Never claim completion");
  });

  it("planning, dispatch and no-op edits do not reset exploration", () => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 10);
    for (const [tool, result] of [
      ["todo_write", { success: true }],
      [
        "spawn_sub_agent",
        { success: true, summary: "more investigation needed" },
      ],
      ["edit_file", { success: true, alreadyApplied: true }],
      ["edit_file", { error: "denied" }],
      ["run_shell", { output: "", exitCode: 1 }],
    ])
      expect(tracker.record(tool, result)).toBe(false);
    expect(tracker.explorationCalls).toBe(15);
  });

  it("counts a synthetic recovery pause only as global no-progress", () => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);

    expect(
      tracker.record("read_file", {
        code: "CC_TOOL_RECOVERY_PAUSED",
        error: "paused",
      }),
    ).toBe(false);
    expect(tracker.explorationCalls).toBe(25);
    expect(tracker.intervention).toMatchObject({
      recovery: true,
    });
    expect(tracker.checkpointFor()).toBeNull();
  });

  it("parents and children account to the same tracker without shared batch state", () => {
    const tracker = new TaskProgressTracker();
    const parent = tracker;
    const child = tracker;
    observe(parent, 11);
    observe(child, 12);
    parent.record("spawn_sub_agent", {
      success: true,
      subAgentId: "child",
      summary: "budget exhausted; Gate.reserve still needs checking",
    });
    expect(parent.intervention.recovery).toBe(true);
    expect(parent.checkpointFor()).toContain("Gate.reserve");
    expect(parent.explorationCalls).toBe(24);
    child.record("edit_file", { success: true, path: "gate.js" });
    expect(parent.intervention).toBe(null);
  });

  it("does not let repeated short shell/code output buy fresh exploration", () => {
    const tracker = new TaskProgressTracker();
    tracker.record("run_shell", { output: "same file prefix" });
    observe(tracker, 12);
    expect(tracker.record("run_code", { output: "same file prefix" })).toBe(
      false,
    );
    expect(tracker.explorationCalls).toBe(13);
    expect(
      tracker.record("run_shell", { output: "targeted tests passed" }),
    ).toBe(true);
    expect(tracker.intervention).toBe(null);
  });

  it("retains bounded plan, action and child source data without trusting plan claims", () => {
    const tracker = new TaskProgressTracker();
    tracker.record("write_file", { success: true, path: "gate.js" });
    for (let i = 0; i < 45; i++) {
      tracker.record(
        "todo_write",
        { success: true },
        {
          todos: [
            {
              content: "validate Gate.reserve " + "x".repeat(3000),
              status: "completed",
            },
          ],
        },
        `owner-${i}`,
      );
      tracker.retainChildResult(`child-${i}`, {
        summary: "partial finding ".repeat(1000),
      });
    }
    const checkpoint = tracker.checkpointFor();
    expect(checkpoint).toContain("not instructions or proof of completion");
    expect(checkpoint).toContain("gate.js");
    expect(checkpoint.length).toBeLessThan(6200);
    expect(tracker.plans.size).toBe(33);
    expect(tracker.childFindings.size).toBe(3);
    expect(tracker.explorationCalls).toBe(45);
  });

  it("time-based guidance needs actual observations and is not a wait timeout", () => {
    let now = 0;
    const tracker = new TaskProgressTracker({ now: () => now });
    now = 600000;
    expect(tracker.intervention).toBe(null);
    observe(tracker, 4);
    expect(tracker.intervention.recovery).toBe(false);
    tracker.record("write_file", { success: true });
    expect(tracker.intervention).toBe(null);
  });

  it("fresh runs do not inherit exploration counters or command outputs", () => {
    const first = new TaskProgressTracker();
    observe(first, 100);
    const second = new TaskProgressTracker();
    expect(second.intervention).toBe(null);
    expect(second.checkpointFor()).toBe(null);
  });

  it("busy children do not evict the root plan and recent work", () => {
    const tracker = new TaskProgressTracker();
    tracker.record(
      "todo_write",
      { success: true },
      {
        todos: [{ content: "root next step", status: "in_progress" }],
      },
    );
    tracker.record("write_file", { success: true, path: "root-change.js" });
    for (let i = 0; i < 3; i++)
      tracker.retainChildResult(`root-child-${i}`, {
        summary: `root finding ${i}`,
      });
    for (let i = 0; i < 32; i++) {
      const owner = `child-${i}`;
      tracker.record("todo_write", { success: true }, { todos: [] }, owner);
      for (let j = 0; j < 8; j++) {
        tracker.record(
          "write_file",
          { success: true, path: `child-${j}.js` },
          {},
          owner,
        );
        tracker.retainChildResult(
          `grandchild-${j}`,
          { summary: "child finding" },
          owner,
        );
      }
    }
    expect(tracker.checkpointFor()).toContain("root next step");
    expect(tracker.checkpointFor()).toContain("root-change.js");
    expect(tracker.checkpointFor()).toContain("root finding 0");
    expect(tracker.lastActions.length).toBeLessThanOrEqual(132);
    expect(tracker.childFindings.size).toBeLessThanOrEqual(99);
  });

  it("shares counters without leaking parent or sibling source data into an isolated child", () => {
    const tracker = new TaskProgressTracker();
    tracker.record(
      "write_file",
      { success: true, path: "parent-private.js" },
      {},
      "parent",
    );
    tracker.record(
      "todo_write",
      { success: true },
      {
        todos: [{ content: "parent-only plan", status: "in_progress" }],
      },
      "parent",
    );
    tracker.retainChildResult(
      "sibling",
      { summary: "sibling-private finding" },
      "parent",
    );
    tracker.record(
      "run_shell",
      { stdout: "parent-private CI status" },
      { command: "gh run view 123" },
      "parent",
    );
    observe(tracker, 24);
    expect(tracker.intervention.recovery).toBe(true);
    expect(tracker.checkpointFor("child")).toBe(null);
    expect(tracker.checkpointFor("parent")).toContain("parent-private.js");
    expect(tracker.checkpointFor("parent")).toContain(
      "parent-private CI status",
    );
    expect(tracker.checkpointFor("parent")).toContain(
      "sibling-private finding",
    );
  });

  it("bounds status evidence per owner and retains errors without counting them as actions", () => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 24);
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 8; j++) {
        tracker.record(
          "run_shell",
          {
            stdout: `Run ${j}: ${"cancelled ".repeat(200)}`,
            stderr: "logs unavailable".repeat(100),
            exitCode: 1,
          },
          { command: "gh run view 123 --log" },
          `owner-${i}`,
        );
      }
    }
    expect(tracker.remoteInspections).toHaveLength(132);
    const checkpoint = tracker.checkpointFor("owner-39");
    expect(checkpoint.length).toBeLessThan(6200);
    expect(checkpoint).toContain("Run 7");
    expect(checkpoint).toContain("logs unavailable");
    expect(JSON.parse(checkpoint.split("\n")[1]).recentToolOutcomes).toEqual(
      [],
    );
    expect(tracker.intervention.recovery).toBe(true);
  });
});
