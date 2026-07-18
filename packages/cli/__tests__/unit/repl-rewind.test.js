/** REPL /rewind + double-Esc — pure conversation-rewind helpers. */
import { describe, it, expect } from "vitest";
import {
  listUserTurns,
  rewindToTurn,
  renderTurnList,
  buildResumeRecap,
  pickCheckpointForTurn,
  pruneMarksAfter,
  snapshotClearedConversation,
  restoreClearedConversation,
  buildRewindPlan,
  renderRewindWarnings,
  buildBranchPlan,
  renderBranchPlan,
  parseRewindArg,
  pickPersistedTurn,
  RESTORE_SCOPE,
  PREVIEW_CHARS,
} from "../../src/lib/repl-rewind.js";
import { TurnBindingLog } from "../../src/lib/turn-binding.js";

function conv() {
  return [
    { role: "system", content: "SYS" },
    { role: "user", content: "first question" },
    { role: "assistant", content: "answer one" },
    {
      role: "user",
      content:
        "second question with quite a lot of extra words to overflow the preview cap maybe",
    },
    { role: "assistant", content: "answer two" },
    { role: "user", content: [{ type: "text", text: "multimodal" }] },
    { role: "assistant", content: "answer three" },
  ];
}

describe("listUserTurns", () => {
  it("lists user turns newest-first with 1-based picks", () => {
    const turns = listUserTurns(conv());
    expect(turns.map((t) => t.n)).toEqual([1, 2, 3]);
    expect(turns[0].index).toBe(5);
    expect(turns[2].preview).toBe("first question");
  });

  it("caps previews and respects the limit", () => {
    const turns = listUserTurns(conv(), { limit: 2 });
    expect(turns).toHaveLength(2);
    expect(turns[1].preview.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(turns[1].preview.endsWith("…")).toBe(true);
  });
});

describe("rewindToTurn", () => {
  it("drops the picked user turn and everything after it", () => {
    const messages = conv();
    const res = rewindToTurn(messages, 2); // "second question…"
    expect(res.removed).toBe(4);
    expect(messages).toHaveLength(3);
    expect(messages[messages.length - 1].content).toBe("answer one");
    expect(res.text).toContain("second question");
  });

  it("rewinding to the newest turn just drops it (edit-and-resend)", () => {
    const messages = conv();
    const res = rewindToTurn(messages, 1);
    expect(res.removed).toBe(2);
    expect(res.text).toBeNull(); // multimodal content → no prefill text
    expect(messages[messages.length - 1].content).toBe("answer two");
  });

  it("returns null on a bad pick and leaves messages intact", () => {
    const messages = conv();
    expect(rewindToTurn(messages, 99)).toBeNull();
    expect(rewindToTurn(messages, 0)).toBeNull();
    expect(rewindToTurn(messages, "x")).toBeNull();
    expect(messages).toHaveLength(7);
  });
});

describe("rewindToTurn → index", () => {
  it("returns the surviving message index for checkpoint matching", () => {
    const messages = conv();
    expect(rewindToTurn(messages, 2).index).toBe(3); // "second question" at idx 3
  });
});

describe("pickCheckpointForTurn", () => {
  // Marks as the REPL would record them: atMessageCount = messages.length at the
  // instant the snapshot was taken (just after the turn's user msg was appended).
  // conv() user turns sit at indices 1, 3, 5.
  const marks = [
    { atMessageCount: 2, id: "cp0001", tool: "write_file" }, // pre-edit of turn @1
    { atMessageCount: 4, id: "cp0002", tool: "edit_file" }, // pre-edit of turn @3
  ];

  it("matches a turn to the snapshot taken just before it mutated files", () => {
    // rewind to "second question" (index 3) → state before it = cp0002
    expect(pickCheckpointForTurn(marks, 3).id).toBe("cp0002");
    // rewind to "first question" (index 1) → earliest snapshot = cp0001
    expect(pickCheckpointForTurn(marks, 1).id).toBe("cp0001");
  });

  it("returns null when the rewound turn changed nothing (no later snapshot)", () => {
    expect(pickCheckpointForTurn(marks, 5)).toBeNull();
  });

  it("is null-safe for empty / bad input", () => {
    expect(pickCheckpointForTurn([], 1)).toBeNull();
    expect(pickCheckpointForTurn(null, 1)).toBeNull();
    expect(pickCheckpointForTurn(marks, "x")).toBeNull();
    expect(pickCheckpointForTurn([{ atMessageCount: 2 }], 1)).toBeNull(); // no id
  });
});

describe("pruneMarksAfter", () => {
  it("drops marks for rewound turns and mutates in place", () => {
    const marks = [
      { atMessageCount: 2, id: "cp0001" },
      { atMessageCount: 4, id: "cp0002" },
      { atMessageCount: 6, id: "cp0003" },
    ];
    const removed = pruneMarksAfter(marks, 3);
    expect(removed).toBe(2);
    expect(marks.map((m) => m.id)).toEqual(["cp0001"]);
  });

  it("is a no-op for bad input", () => {
    expect(pruneMarksAfter(null, 1)).toBe(0);
    expect(pruneMarksAfter([{ atMessageCount: 2, id: "a" }], "x")).toBe(0);
  });
});

describe("buildResumeRecap", () => {
  it("summarizes counts + last ask/reply", () => {
    const lines = buildResumeRecap(conv());
    expect(lines[0]).toBe("3 user / 3 assistant turns");
    expect(lines.find((l) => l.startsWith("last ask"))).toContain("multimodal");
    expect(lines.find((l) => l.startsWith("last reply"))).toContain(
      "answer three",
    );
  });

  it("caps previews and returns null for empty conversations", () => {
    const long = [{ role: "user", content: "y".repeat(500) }];
    const lines = buildResumeRecap(long, { previewChars: 50 });
    expect(lines.find((l) => l.startsWith("last ask")).endsWith("…")).toBe(
      true,
    );
    expect(buildResumeRecap([])).toBeNull();
    expect(buildResumeRecap([{ role: "system", content: "s" }])).toBeNull();
  });
});

describe("renderTurnList", () => {
  it("renders numbered lines and an empty placeholder", () => {
    const out = renderTurnList(listUserTurns(conv()));
    expect(out).toContain(" 1. ");
    expect(out.split("\n")).toHaveLength(3);
    expect(renderTurnList([])).toContain("no user turns");
  });
});

describe("snapshotClearedConversation (CC 2.1.191 — /rewind clear)", () => {
  it("captures the conversation minus the system prompt, plus marks", () => {
    const marks = [{ atMessageCount: 4, id: "cp1" }];
    const snap = snapshotClearedConversation(conv(), marks);
    expect(snap.messages).toHaveLength(6); // 7 - system prompt
    expect(snap.messages[0]).toMatchObject({ role: "user" });
    expect(snap.marks).toEqual(marks);
    // defensive copies — mutating the live arrays must not touch the snapshot
    marks.push({ atMessageCount: 9, id: "cp2" });
    expect(snap.marks).toHaveLength(1);
  });

  it("returns null for an empty conversation (no-op /clear keeps prior stash)", () => {
    expect(
      snapshotClearedConversation([{ role: "system", content: "S" }]),
    ).toBeNull();
    expect(snapshotClearedConversation([])).toBeNull();
  });
});

describe("restoreClearedConversation (CC 2.1.191 — /rewind clear)", () => {
  it("swaps the stash into the live conversation, keeping the system prompt", () => {
    const messages = [{ role: "system", content: "SYS" }]; // post-clear (empty)
    const marks = [];
    const cleared = {
      messages: [
        { role: "user", content: "before clear" },
        { role: "assistant", content: "prior reply" },
      ],
      marks: [{ atMessageCount: 2, id: "cpA" }],
    };
    const r = restoreClearedConversation(messages, marks, cleared);
    expect(r.restored).toBe(2);
    expect(r.stashed).toBe(0); // post-clear was empty
    expect(r.newCleared).toBeNull();
    expect(messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(marks).toEqual([{ atMessageCount: 2, id: "cpA" }]);
  });

  it("is undoable — a non-empty current is stashed for a swap-back", () => {
    const messages = [
      { role: "system", content: "SYS" },
      { role: "user", content: "new work" },
    ];
    const marks = [{ atMessageCount: 2, id: "cpNew" }];
    const cleared = {
      messages: [{ role: "user", content: "old" }],
      marks: [{ atMessageCount: 2, id: "cpOld" }],
    };
    const r = restoreClearedConversation(messages, marks, cleared);
    expect(r.restored).toBe(1);
    expect(r.stashed).toBe(1);
    expect(messages[1].content).toBe("old");
    // the swapped-out current is now the stash
    expect(r.newCleared.messages[0].content).toBe("new work");
    expect(r.newCleared.marks).toEqual([{ atMessageCount: 2, id: "cpNew" }]);
    // swapping back restores the original
    const r2 = restoreClearedConversation(messages, marks, r.newCleared);
    expect(messages[1].content).toBe("new work");
    expect(r2.newCleared.messages[0].content).toBe("old");
  });

  it("returns null when there is nothing to restore", () => {
    expect(
      restoreClearedConversation([{ role: "system" }], [], null),
    ).toBeNull();
    expect(
      restoreClearedConversation([{ role: "system" }], [], { messages: [] }),
    ).toBeNull();
  });
});

describe("buildRewindPlan (coverage-aware)", () => {
  // conv() user turns live at message indices 1, 3, 5.
  it("marks a pure-edit turn with a checkpoint as fully restorable", () => {
    const messages = conv();
    // A write checkpoint taken during turn@3 (atMessageCount 4 > 3, <= next 5).
    const marks = [{ atMessageCount: 4, id: "cp-edit", tool: "write_file" }];
    const plan = buildRewindPlan(messages, marks, 3);
    expect(plan.coverage).toBe("full");
    expect(plan.files).toEqual({ rewindTo: "cp-edit" });
    expect(renderRewindWarnings(plan)).toEqual([]);
  });

  it("warns that a shell turn's side-effects can't be fully undone", () => {
    const messages = conv();
    const marks = [{ atMessageCount: 4, id: "cp-sh", tool: "run_shell" }];
    const plan = buildRewindPlan(messages, marks, 3);
    expect(plan.coverage).toBe("partial");
    const lines = renderRewindWarnings(plan);
    expect(lines.some((l) => /coverage: partial/.test(l))).toBe(true);
    expect(lines.some((l) => /side-effects|best-effort/.test(l))).toBe(true);
  });

  it("warns when a turn has no checkpoint to restore files from", () => {
    const messages = conv();
    const plan = buildRewindPlan(messages, [], 3);
    expect(plan.files).toBeNull();
    expect(renderRewindWarnings(plan).join(" ")).toMatch(/no file checkpoint/);
  });

  it("renderRewindWarnings is empty for a null plan and full coverage", () => {
    expect(renderRewindWarnings(null)).toEqual([]);
    expect(renderRewindWarnings({ coverage: "full", warnings: [] })).toEqual(
      [],
    );
  });
});

// The exact data flow the /rewind handler uses: snapshot messages BEFORE
// rewindToTurn truncates them, then feed that snapshot + res.index into
// buildRewindPlan so the coverage warning binds the right (still-present) turn.
describe("buildRewindPlan integration with rewindToTurn (handler data flow)", () => {
  it("warns on a shell turn using the pre-rewind snapshot + res.index", () => {
    const messages = conv();
    const preRewind = messages.slice();
    const marks = [{ atMessageCount: 4, id: "cp-sh", tool: "run_shell" }];
    const res = rewindToTurn(messages, 2); // drops turn@3 onward; MUTATES messages
    expect(res.index).toBe(3);
    const plan = buildRewindPlan(preRewind, marks, res.index);
    expect(plan.coverage).toBe("partial");
    expect(
      renderRewindWarnings(plan).some((l) => /coverage: partial/.test(l)),
    ).toBe(true);
  });

  it("warns 'no file checkpoint' when the rewound turn had no snapshot", () => {
    const messages = conv();
    const preRewind = messages.slice();
    const res = rewindToTurn(messages, 2);
    const plan = buildRewindPlan(preRewind, [], res.index);
    expect(renderRewindWarnings(plan).join(" ")).toMatch(/no file checkpoint/);
  });

  it("binds nothing if built from the post-rewind (truncated) messages", () => {
    // Guards the snapshot requirement: after rewindToTurn truncates messages the
    // target turn is gone, so a plan built from `messages` reports coverage
    // "none" (unknown turn) — which is why the handler must use the snapshot.
    const messages = conv();
    const marks = [{ atMessageCount: 4, id: "cp-sh", tool: "run_shell" }];
    const res = rewindToTurn(messages, 2);
    const planFromTruncated = buildRewindPlan(messages, marks, res.index);
    expect(planFromTruncated.coverage).toBe("none");
  });
});

// P1 turn/checkpoint binding: /rewind prefers the PERSISTED explicit table
// (loadTurnBindingLog) over process-local marks — a --resume'd session's
// pre-resume turns have NO marks, but their headless run persisted checkpoint
// ids + coverage flags at conversationOffset = turnIndex + 1.
describe("pickPersistedTurn / buildRewindPlan with a persisted table", () => {
  // conv() user turns live at indices 1, 3, 5 → persisted offsets 2, 4, 6.
  function persistedLogWith(offset, { tool = "write_file", cp = null } = {}) {
    const log = new TurnBindingLog();
    log.startTurn("hl:t0", { conversationOffset: offset });
    log.recordToolCall("hl:t0", "hl:c0", { name: tool });
    if (cp) log.bindCheckpoint("hl:t0", cp);
    return log;
  }

  it("pickPersistedTurn matches on conversationOffset === turnIndex + 1", () => {
    const log = persistedLogWith(4, { cp: "cp-headless" });
    const turn = pickPersistedTurn(log, 3);
    expect(turn?.turnId).toBe("hl:t0");
    expect(turn?.fileCheckpointId).toBe("cp-headless");
    expect(pickPersistedTurn(log, 2)).toBeNull(); // offset 3 ≠ 4
    expect(pickPersistedTurn(null, 3)).toBeNull();
    expect(pickPersistedTurn(log, NaN)).toBeNull();
  });

  it("prefers the persisted record: cross-process checkpoint restores files where marks cannot", () => {
    const messages = conv();
    // No process-local marks (fresh --resume) BUT the headless run persisted a
    // checkpoint for turn@3 → the plan restores files instead of warning.
    const log = persistedLogWith(4, { cp: "cp-headless" });
    const plan = buildRewindPlan(messages, [], 3, RESTORE_SCOPE.BOTH, {
      persistedLog: log,
    });
    expect(plan.coverage).toBe("full");
    expect(plan.files).toEqual({ rewindTo: "cp-headless" });
    // control: without the persisted table the same call can't restore files
    const bare = buildRewindPlan(messages, [], 3);
    expect(bare.files).toBeNull();
  });

  it("keeps honest partial coverage from the persisted shell flag", () => {
    const messages = conv();
    const log = persistedLogWith(4, { tool: "run_shell", cp: "cp-sh" });
    const plan = buildRewindPlan(messages, [], 3, RESTORE_SCOPE.BOTH, {
      persistedLog: log,
    });
    expect(plan.coverage).toBe("partial");
    expect(
      renderRewindWarnings(plan).some((l) => /coverage: partial/.test(l)),
    ).toBe(true);
  });

  it("falls back to marks when no persisted offset matches", () => {
    const messages = conv();
    const marks = [{ atMessageCount: 4, id: "cp-marks", tool: "write_file" }];
    const log = persistedLogWith(99, { cp: "cp-elsewhere" });
    const plan = buildRewindPlan(messages, marks, 3, RESTORE_SCOPE.BOTH, {
      persistedLog: log,
    });
    expect(plan.files).toEqual({ rewindTo: "cp-marks" });
  });

  it("buildBranchPlan uses the persisted record too", () => {
    const messages = conv();
    const log = persistedLogWith(4, { tool: "run_shell", cp: "cp-sh" });
    const plan = buildBranchPlan(messages, [], 3, {
      parentSessionId: "sess-P",
      persistedLog: log,
    });
    expect(plan.coverage).toBe("partial");
    expect(plan.parentTurnId).toBe("hl:t0");
  });
});

describe("parseRewindArg (turn + restore scope)", () => {
  it("treats an empty / non-numeric arg as the list command", () => {
    expect(parseRewindArg("")).toEqual({
      command: "list",
      scope: RESTORE_SCOPE.BOTH,
    });
    expect(parseRewindArg("   ")).toEqual({
      command: "list",
      scope: RESTORE_SCOPE.BOTH,
    });
    // A flag with no turn number still lists (a typo can't silently rewind).
    expect(parseRewindArg("--files")).toEqual({
      command: "list",
      scope: RESTORE_SCOPE.FILES,
    });
  });

  it("recognises clear / undo-clear", () => {
    expect(parseRewindArg("clear").command).toBe("clear");
    expect(parseRewindArg("undo-clear").command).toBe("clear");
  });

  it("parses a bare turn number as scope=both", () => {
    expect(parseRewindArg("3")).toEqual({
      command: "turn",
      n: 3,
      scope: RESTORE_SCOPE.BOTH,
    });
  });

  it("parses the scope flag in either order", () => {
    expect(parseRewindArg("3 --conversation")).toEqual({
      command: "turn",
      n: 3,
      scope: RESTORE_SCOPE.CONVERSATION,
    });
    expect(parseRewindArg("--files 3")).toEqual({
      command: "turn",
      n: 3,
      scope: RESTORE_SCOPE.FILES,
    });
    expect(parseRewindArg("2 --both").scope).toBe(RESTORE_SCOPE.BOTH);
    // Aliases.
    expect(parseRewindArg("2 --conv").scope).toBe(RESTORE_SCOPE.CONVERSATION);
    expect(parseRewindArg("2 --files-only").scope).toBe(RESTORE_SCOPE.FILES);
  });

  it("ignores an unknown flag but keeps the turn number", () => {
    expect(parseRewindArg("5 --bogus")).toEqual({
      command: "turn",
      n: 5,
      scope: RESTORE_SCOPE.BOTH,
    });
  });

  it("takes the first numeric token as the turn number", () => {
    expect(parseRewindArg("7 9 --files").n).toBe(7);
  });
});

describe("buildRewindPlan honours the restore scope", () => {
  it("conversation-only over a file-mutating turn warns about the files it won't touch", () => {
    const messages = conv();
    // A checkpoint captured before turn 2 (index 3) → the turn mutated files.
    const marks = [{ atMessageCount: 4, id: "cp-a", tool: "edit_file" }];
    const plan = buildRewindPlan(
      messages,
      marks,
      3,
      RESTORE_SCOPE.CONVERSATION,
    );
    expect(plan.scope).toBe(RESTORE_SCOPE.CONVERSATION);
    // Rewinding the conversation but leaving files → the plan flags the drift.
    expect(plan.warnings.join(" ")).toMatch(/file/i);
  });

  it("files-only plan targets the files scope", () => {
    const messages = conv();
    const marks = [{ atMessageCount: 4, id: "cp-a", tool: "edit_file" }];
    const plan = buildRewindPlan(messages, marks, 3, RESTORE_SCOPE.FILES);
    expect(plan.scope).toBe(RESTORE_SCOPE.FILES);
  });
});

describe("parseRewindArg (branch — P0-3 从这里分支)", () => {
  it("parses --branch with a turn number into a branch command", () => {
    expect(parseRewindArg("3 --branch")).toEqual({
      command: "branch",
      n: 3,
      scope: RESTORE_SCOPE.BOTH,
      writeIntent: false,
    });
    // --fork is an accepted alias.
    expect(parseRewindArg("--fork 2").command).toBe("branch");
  });

  it("flags a write-intent branch (→ isolated worktree)", () => {
    expect(parseRewindArg("3 --branch --write")).toEqual({
      command: "branch",
      n: 3,
      scope: RESTORE_SCOPE.BOTH,
      writeIntent: true,
    });
    expect(parseRewindArg("--branch 4 --write-intent").writeIntent).toBe(true);
  });

  it("falls back to list when --branch has no turn number (can't branch off nothing)", () => {
    expect(parseRewindArg("--branch").command).toBe("list");
    expect(parseRewindArg("--branch --write").command).toBe("list");
  });
});

describe("buildBranchPlan / renderBranchPlan (P0-3)", () => {
  // conv() user turns live at message indices 1, 3, 5.
  it("plans a deterministic branch that preserves the parent and never inherits grants", () => {
    const messages = conv();
    const marks = [{ atMessageCount: 4, id: "cp-edit", tool: "write_file" }];
    const plan = buildBranchPlan(messages, marks, 3, {
      parentSessionId: "sess-A",
    });
    expect(plan.parentSessionId).toBe("sess-A");
    expect(plan.parentTurnId).toBe("turn-3");
    expect(plan.preservesParent).toBe(true);
    expect(plan.inheritSessionGrants).toBe(false);
    // A full-coverage (checkpointed write) branch point still requires a worktree
    // because the branch point already mutated files.
    expect(plan.requiresWorktree).toBe(true);
    expect(plan.branchSessionId).toMatch(/^sess-A-b-/);
    // Determinism: same inputs → same branch session id.
    const again = buildBranchPlan(messages, marks, 3, {
      parentSessionId: "sess-A",
    });
    expect(again.branchSessionId).toBe(plan.branchSessionId);
  });

  it("requires a worktree when the branch itself intends to write", () => {
    const messages = conv();
    const plan = buildBranchPlan(messages, [], 3, {
      parentSessionId: "sess-A",
      writeIntent: true,
    });
    expect(plan.requiresWorktree).toBe(true);
    expect(renderBranchPlan(plan).join(" ")).toMatch(/worktree/);
  });

  it("warns honestly when the branch point ran irreversible side-effects", () => {
    const messages = conv();
    const marks = [{ atMessageCount: 4, id: "cp-sh", tool: "run_shell" }];
    const plan = buildBranchPlan(messages, marks, 3, {
      parentSessionId: "sess-A",
    });
    expect(plan.coverage).toBe("partial");
    const lines = renderBranchPlan(plan);
    expect(lines.some((l) => /coverage: partial/.test(l))).toBe(true);
    expect(lines.some((l) => /irreversible|side-effect/.test(l))).toBe(true);
  });

  it("renderBranchPlan is empty for a clean full-coverage branch", () => {
    expect(renderBranchPlan({ coverage: "full", warnings: [] })).toEqual([]);
    expect(renderBranchPlan(null)).toEqual([]);
  });
});
