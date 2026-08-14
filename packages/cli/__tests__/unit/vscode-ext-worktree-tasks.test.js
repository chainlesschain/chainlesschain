import { describe, expect, it } from "vitest";

import {
  attachTaskGovernance,
  buildAheadArgs,
  buildBackgroundListArgs,
  buildBranchDeleteArgs,
  buildMergeReviewApplyArgs,
  buildMergeReviewPreviewArgs,
  buildMergeReviewRollbackArgs,
  buildMergeReviewShowArgs,
  buildNewTaskCommand,
  buildShortstatArgs,
  buildWorktreeListArgs,
  buildWorktreeRemoveArgs,
  isTaskBranch,
  parseBackgroundTaskGovernance,
  parseMergeReview,
  parseWorktreeList,
  selectMergeReviewActionArgs,
  summarizeShortstat,
  validateMergeReviewSelection,
} from "../../../vscode-extension/src/worktree-tasks.js";

const REVIEW_ID = `tmr_${"a".repeat(32)}`;
const FILE_ID = `tmrf_${"b".repeat(32)}`;
const OTHER_FILE_ID = `tmrf_${"c".repeat(32)}`;
const HUNK_ID = `tmrh_${"d".repeat(32)}`;
const OTHER_HUNK_ID = `tmrh_${"e".repeat(32)}`;
const PLAN_DIGEST = `sha256:${"1".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"2".repeat(64)}`;

function mergeReviewEnvelope({
  operation = "preview",
  commitOid = false,
} = {}) {
  const oidKey = commitOid ? "commitOid" : "oid";
  const conflicts = [
    {
      candidateKey: "candidate-1",
      path: "src/example.js",
      type: "content",
      explanation: "Both branches changed the same expression.",
      suggestion: "Review the selected hunk before publishing.",
      hunkIds: [HUNK_ID],
    },
  ];
  const review = {
    reviewId: REVIEW_ID,
    revision: 7,
    state: "planned",
    base: { branch: "main", [oidKey]: "1".repeat(40) },
    candidates: [
      {
        key: "candidate-1",
        branch: "team/example",
        [oidKey]: "2".repeat(40),
      },
    ],
    files: [
      {
        id: FILE_ID,
        candidateKey: "candidate-1",
        path: "src/example.js",
        status: "modified",
        binary: false,
        selected: false,
        hunks: [
          {
            id: HUNK_ID,
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            selected: false,
          },
        ],
      },
    ],
    selection: { fileIds: [], hunkIds: [] },
    conflicts,
    decision: null,
    planDigest: PLAN_DIGEST,
    evidenceDigest: EVIDENCE_DIGEST,
    createdAt: "2026-08-14T01:00:00.000Z",
    updatedAt: "2026-08-14T01:01:00.000Z",
    details: {},
  };
  return {
    schema: "chainlesschain.team-merge-review/v1",
    schemaVersion: 1,
    operation,
    review,
    actions: [
      {
        id: "apply",
        enabled: false,
        argv: ["team", "merge-review", "apply", REVIEW_ID],
        reason: "Select at least one reviewed file or hunk first.",
      },
      {
        id: "rollback",
        enabled: false,
        argv: ["team", "merge-review", "rollback", REVIEW_ID],
        reason: "Review has not been published.",
      },
    ],
  };
}

const PORCELAIN = [
  "worktree C:/repo",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree C:/repo/.cc-worktrees/cc-agent-20260710-ab12",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/cc-agent-20260710-ab12",
  "",
  "worktree C:/elsewhere/feature",
  "HEAD 3333333333333333333333333333333333333333",
  "branch refs/heads/feature/other",
  "",
  "worktree C:/repo/.cc-worktrees/detached",
  "HEAD 4444444444444444444444444444444444444444",
  "detached",
  "",
].join("\n");

describe("worktree list parsing", () => {
  it("marks the main checkout and agent task branches", () => {
    const rows = parseWorktreeList(PORCELAIN);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      branch: "main",
      main: true,
      isTask: false,
    });
    expect(rows[1]).toMatchObject({
      branch: "cc-agent-20260710-ab12",
      main: false,
      isTask: true,
    });
    // A human feature branch is NOT an agent task.
    expect(rows[2]).toMatchObject({ branch: "feature/other", isTask: false });
    // Detached worktrees carry no branch and never count as tasks.
    expect(rows[3]).toMatchObject({ branch: "", isTask: false });
    expect(parseWorktreeList("")).toEqual([]);
  });

  it("recognizes all four task-branch prefixes", () => {
    expect(isTaskBranch("cc-agent-x")).toBe(true);
    expect(isTaskBranch("batch/unit-1")).toBe(true);
    expect(isTaskBranch("agent/task-9")).toBe(true);
    expect(isTaskBranch("team/release-reviewer")).toBe(true);
    expect(isTaskBranch("main")).toBe(false);
    expect(isTaskBranch("")).toBe(false);
  });
});

describe("CLI-authoritative merge review", () => {
  it("builds exact preview/show/apply/rollback argv", () => {
    expect(
      buildMergeReviewPreviewArgs({
        branches: ["team/a", "batch/b"],
        base: "main",
        stateDir: "C:/state",
        actor: "vscode",
        reason: "review",
      }),
    ).toEqual([
      "team",
      "merge-review",
      "preview",
      "--branch",
      "team/a",
      "--branch",
      "batch/b",
      "--base",
      "main",
      "--state-dir",
      "C:/state",
      "--actor",
      "vscode",
      "--reason",
      "review",
      "--json",
    ]);
    expect(
      buildMergeReviewShowArgs(REVIEW_ID, { stateDir: "C:/state" }),
    ).toEqual([
      "team",
      "merge-review",
      "show",
      REVIEW_ID,
      "--state-dir",
      "C:/state",
      "--json",
    ]);
    expect(
      buildMergeReviewApplyArgs({
        reviewId: REVIEW_ID,
        revision: 7,
        planDigest: PLAN_DIGEST,
        fileIds: [FILE_ID],
        hunkIds: [HUNK_ID],
        actor: "vscode",
        reason: "approved",
      }),
    ).toEqual([
      "team",
      "merge-review",
      "apply",
      REVIEW_ID,
      "--revision",
      "7",
      "--plan-digest",
      PLAN_DIGEST,
      "--file-id",
      FILE_ID,
      "--hunk-id",
      HUNK_ID,
      "--actor",
      "vscode",
      "--reason",
      "approved",
      "--json",
    ]);
    expect(
      buildMergeReviewRollbackArgs({
        reviewId: REVIEW_ID,
        revision: 7,
        evidenceDigest: EVIDENCE_DIGEST,
      }),
    ).toEqual([
      "team",
      "merge-review",
      "rollback",
      REVIEW_ID,
      "--revision",
      "7",
      "--evidence-digest",
      EVIDENCE_DIGEST,
      "--confirm",
      REVIEW_ID,
      "--json",
    ]);
    expect(() =>
      buildMergeReviewApplyArgs({
        reviewId: REVIEW_ID,
        revision: 7,
        planDigest: PLAN_DIGEST,
        fileIds: Array.from(
          { length: 101 },
          (_, index) => `tmrf_${index.toString(16).padStart(32, "0")}`,
        ),
      }),
    ).toThrow(/at most 100 selected IDs/);
  });

  it("strictly projects v1 evidence and normalizes compatible commitOid", () => {
    const parsed = parseMergeReview(
      JSON.stringify(mergeReviewEnvelope({ commitOid: true })),
      { expectedOperation: "preview" },
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.review).toMatchObject({
      reviewId: REVIEW_ID,
      revision: 7,
      base: { branch: "main", oid: "1".repeat(40) },
      planDigest: PLAN_DIGEST,
      evidenceDigest: EVIDENCE_DIGEST,
    });
    expect(parsed.review.candidates[0].oid).toBe("2".repeat(40));
    expect(parsed.review.conflicts[0]).toMatchObject({
      explanation: "Both branches changed the same expression.",
      hunkIds: [HUNK_ID],
    });
    expect(JSON.stringify(parsed)).not.toContain("commitOid");
  });

  it("fails closed on unknown schema, fields, states, IDs, pins, and argv", () => {
    const mutations = [
      (value) => {
        value.schema = "chainlesschain.team-merge-review/v2";
      },
      (value) => {
        value.schemaVersion = 2;
      },
      (value) => {
        value.operation = "execute";
      },
      (value) => {
        value.unknown = true;
      },
      (value) => {
        value.review.state = "approved";
      },
      (value) => {
        value.review.reviewId = `tmr_${"a".repeat(31)}`;
      },
      (value) => {
        value.review.revision = 0;
      },
      (value) => {
        value.review.planDigest = "1".repeat(64);
      },
      (value) => {
        value.review.updatedAt = "1";
      },
      (value) => {
        value.review.base.commitOid = value.review.base.oid;
      },
      (value) => {
        value.review.details.unexpected = true;
      },
      (value) => {
        value.review.files.push(structuredClone(value.review.files[0]));
      },
      (value) => {
        value.review.selection.hunkIds = [OTHER_HUNK_ID];
      },
      (value) => {
        value.review.files[0].selected = true;
      },
      (value) => {
        value.actions[0].argv = ["git", "merge", "team/example"];
      },
      (value) => {
        value.actions[0].argv[3] = `tmr_${"f".repeat(32)}`;
      },
      (value) => {
        delete value.actions[0].reason;
      },
      (value) => {
        value.conflicts = value.review.conflicts;
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(mergeReviewEnvelope());
      mutate(value);
      expect(parseMergeReview(value, { expectedOperation: "preview" }).ok).toBe(
        false,
      );
    }
    expect(parseMergeReview("not json").ok).toBe(false);
    expect(
      parseMergeReview(mergeReviewEnvelope(), { expectedOperation: "show" }).ok,
    ).toBe(false);
    expect(
      parseMergeReview(
        {
          schema: "chainlesschain.team-merge-review/v1",
          schemaVersion: 1,
          operation: "preview",
          error: {
            code: "TEAM_MERGE_REVIEW_FAILED",
            message: "candidate changed",
          },
        },
        { expectedOperation: "preview" },
      ),
    ).toEqual({
      ok: false,
      error: "TEAM_MERGE_REVIEW_FAILED: candidate changed",
    });
  });

  it("accepts only stable IDs from the exact review selection", () => {
    const parsed = parseMergeReview(mergeReviewEnvelope(), {
      expectedOperation: "preview",
    });
    expect(validateMergeReviewSelection(parsed.review, [FILE_ID], [])).toEqual({
      ok: true,
      fileIds: [FILE_ID],
      hunkIds: [],
    });
    expect(validateMergeReviewSelection(parsed.review, [], [HUNK_ID])).toEqual({
      ok: true,
      fileIds: [],
      hunkIds: [HUNK_ID],
    });
    expect(
      validateMergeReviewSelection(parsed.review, [OTHER_FILE_ID], []).ok,
    ).toBe(false);
    expect(
      validateMergeReviewSelection(parsed.review, [], [OTHER_HUNK_ID]).ok,
    ).toBe(false);
    expect(
      validateMergeReviewSelection(parsed.review, [FILE_ID], [HUNK_ID]).ok,
    ).toBe(false);
    expect(
      validateMergeReviewSelection(parsed.review, [FILE_ID, FILE_ID], []).ok,
    ).toBe(false);
  });

  it("uses CLI-issued argv only when it exactly equals the locally pinned action", () => {
    const expected = buildMergeReviewApplyArgs({
      reviewId: REVIEW_ID,
      revision: 7,
      planDigest: PLAN_DIGEST,
      hunkIds: [HUNK_ID],
      actor: "vscode",
      reason: "approved",
    });
    const envelope = mergeReviewEnvelope();
    envelope.review.files[0].hunks[0].selected = true;
    envelope.review.selection.hunkIds = [HUNK_ID];
    envelope.review.decision = {
      actor: "vscode",
      reason: "approved",
      host: "test-host",
      decidedAt: "2026-08-14T01:00:30.000Z",
    };
    envelope.actions[0] = {
      id: "apply",
      enabled: true,
      argv: expected,
      reason: null,
    };
    const parsed = parseMergeReview(envelope, {
      expectedOperation: "preview",
    });
    expect(selectMergeReviewActionArgs(parsed, "apply", expected)).toEqual(
      expected,
    );
    expect(
      selectMergeReviewActionArgs(parsed, "apply", [
        ...expected,
        "--actor",
        "x",
      ]),
    ).toBeNull();
    expect(
      selectMergeReviewActionArgs(
        parsed,
        "rollback",
        buildMergeReviewRollbackArgs({
          reviewId: REVIEW_ID,
          revision: 7,
          evidenceDigest: EVIDENCE_DIGEST,
        }),
      ),
    ).toBeNull();
  });
});

describe("shortstat + argv + new-task command", () => {
  it("summarizes shortstat compactly", () => {
    expect(
      summarizeShortstat(" 3 files changed, 40 insertions(+), 2 deletions(-)"),
    ).toBe("+40 −2 (3 files)");
    expect(summarizeShortstat(" 1 file changed, 5 insertions(+)")).toBe(
      "+5 −0 (1 file)",
    );
    expect(summarizeShortstat("")).toBe("no diff");
  });

  it("builds the git argv", () => {
    expect(buildWorktreeListArgs()).toEqual([
      "worktree",
      "list",
      "--porcelain",
    ]);
    expect(buildBackgroundListArgs()).toEqual(["daemon", "view", "--json"]);
    expect(buildAheadArgs("abc", "b1")).toEqual([
      "rev-list",
      "--count",
      "abc..b1",
    ]);
    expect(buildShortstatArgs("abc", "b1")).toEqual([
      "diff",
      "--shortstat",
      "abc...b1",
    ]);
    expect(buildWorktreeRemoveArgs("/wt")).toEqual([
      "worktree",
      "remove",
      "--force",
      "/wt",
    ]);
    expect(buildBranchDeleteArgs("b1")).toEqual(["branch", "-D", "b1"]);
  });

  it("builds a shell-safe new-task command", () => {
    expect(buildNewTaskCommand("fix the tests", { windows: true })).toBe(
      'cc agent --bg --worktree -p "fix the tests"',
    );
    expect(
      buildNewTaskCommand("fix the tests", { command: "clc", windows: false }),
    ).toBe("clc agent --bg --worktree -p 'fix the tests'");
    // Quotes/backticks in the task are stripped, not escaped.
    expect(buildNewTaskCommand('say "hi" `now`', { windows: true })).toBe(
      'cc agent --bg --worktree -p "say  hi   now"',
    );
  });
});

describe("background task governance", () => {
  const DAEMON = JSON.stringify({
    sessions: [
      {
        id: "bg-1700000000000-a1b2c3",
        sessionId: "session-fallback",
        branch: "cc-agent-20260710-ab12",
        worktreePath: "C:\\repo\\.cc-worktrees\\cc-agent-20260710-ab12",
        status: "running",
        lifecycleState: "waiting_for_approval",
        governance: {
          owner: "background:bg-1700000000000-a1b2c3",
          sessionId: "session-1",
          permissionMode: "auto",
          resourceBudget: { maxTurns: 7, maxCostUsd: 2.5 },
        },
        sideEffects: {
          total: 4,
          committed: 2,
          unsettled: 1,
          unknown: 1,
          metadata: { secret: "must not cross the parser boundary" },
        },
        argv: ["agent", "-p", "secret prompt"],
        transport: { token: "secret" },
      },
    ],
  });

  it("projects only bounded governance and joins by branch", () => {
    const rows = parseBackgroundTaskGovernance(DAEMON);
    expect(rows).toEqual([
      {
        backgroundId: "bg-1700000000000-a1b2c3",
        branch: "cc-agent-20260710-ab12",
        worktreePath: "C:\\repo\\.cc-worktrees\\cc-agent-20260710-ab12",
        owner: "background:bg-1700000000000-a1b2c3",
        sessionId: "session-1",
        backgroundStatus: "waiting_for_approval",
        permissionMode: "auto",
        resourceBudget: { maxTurns: 7, maxCostUsd: 2.5 },
        sideEffects: { total: 4, unsettled: 1, unknown: 1 },
      },
    ]);
    const [task] = attachTaskGovernance(
      [{ branch: "cc-agent-20260710-ab12", path: "C:/wrong" }],
      DAEMON,
    );
    expect(task).toMatchObject({
      backgroundId: "bg-1700000000000-a1b2c3",
      permissionMode: "auto",
      backgroundStatus: "waiting_for_approval",
    });
    expect(JSON.stringify(task)).not.toContain("secret");
  });

  it("falls back to normalized Windows paths and fails closed on bad JSON", () => {
    const [task] = attachTaskGovernance(
      [
        {
          branch: "legacy/task",
          path: "c:/repo/.cc-worktrees/cc-agent-20260710-ab12/",
        },
      ],
      DAEMON,
    );
    expect(task.backgroundId).toBe("bg-1700000000000-a1b2c3");
    expect(parseBackgroundTaskGovernance("not json")).toEqual([]);
    expect(attachTaskGovernance([{ branch: "main" }], "{}")).toEqual([
      { branch: "main" },
    ]);
  });

  it("projects read-only team/batch managed tasks without background control ids", () => {
    const payload = JSON.stringify({
      sessions: [],
      managedTasks: [
        {
          managedTaskId: "team-1700000000000-a1b2c3:review",
          runId: "team-1700000000000-a1b2c3",
          runKind: "team",
          branch: "team/review",
          worktreePath: "/repo/.cc-worktrees/team-review",
          status: "running",
          governance: {
            owner: "team:team-1700000000000-a1b2c3:review",
            sessionId: "session-team-review",
            permissionMode: "acceptEdits",
            resourceBudget: {
              maxTurns: 8,
              maxCostUsd: 3,
              maxTasks: 4,
              maxTokens: 20000,
              maxWallMs: 60000,
            },
          },
          sideEffects: {
            total: 3,
            unsettled: 1,
            unknown: 0,
            metadata: { secret: "must not cross" },
          },
          prompt: "secret prompt",
        },
      ],
    });

    const rows = parseBackgroundTaskGovernance(payload);
    expect(rows).toEqual([
      {
        managedTaskId: "team-1700000000000-a1b2c3:review",
        runId: "team-1700000000000-a1b2c3",
        runKind: "team",
        branch: "team/review",
        worktreePath: "/repo/.cc-worktrees/team-review",
        owner: "team:team-1700000000000-a1b2c3:review",
        sessionId: "session-team-review",
        managementStatus: "running",
        permissionMode: "acceptEdits",
        resourceBudget: {
          maxTurns: 8,
          maxCostUsd: 3,
          maxTasks: 4,
          maxTokens: 20000,
          maxWallMs: 60000,
        },
        sideEffects: { total: 3, unsettled: 1, unknown: 0 },
      },
    ]);
    expect(rows[0].backgroundId).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("secret");

    const [attached] = attachTaskGovernance(
      [{ branch: "team/review", path: "/wrong" }],
      payload,
    );
    expect(attached).toMatchObject({
      managedTaskId: "team-1700000000000-a1b2c3:review",
      managementStatus: "running",
    });
  });
});
