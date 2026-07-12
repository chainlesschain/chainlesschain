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
  PREVIEW_CHARS,
} from "../../src/lib/repl-rewind.js";

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
