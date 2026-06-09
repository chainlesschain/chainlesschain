import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAssessPrompt,
  parseAssessment,
  applyAssessment,
  assessGoalProgress,
} from "../../src/lib/goal-assess.js";
import { createGoal, addKeyResult, getGoal } from "../../src/lib/goal-store.js";

describe("goal-assess — prompt", () => {
  it("includes objective, key results, and transcript", () => {
    const goal = {
      objective: "Ship the thing",
      progress: 30,
      keyResults: [{ id: "kr-1", text: "write tests", target: 5, current: 2 }],
    };
    const p = buildAssessPrompt(goal, {
      prompt: "do the work",
      finalText: "I wrote 3 tests",
      toolCalls: [{ tool: "write_file" }, { tool: "run_shell" }],
    });
    expect(p).toContain("Ship the thing");
    expect(p).toContain("id=kr-1");
    expect(p).toContain("write_file, run_shell");
    expect(p).toContain("I wrote 3 tests");
    expect(p).toContain('"advanced"');
  });
});

describe("goal-assess — parse (tolerant)", () => {
  it("parses a clean JSON object", () => {
    const a = parseAssessment(
      '{"advanced":true,"progress":55,"keyResults":[{"id":"kr-1","current":3,"done":false}],"note":"did stuff","concerns":["x"]}',
    );
    expect(a.advanced).toBe(true);
    expect(a.progress).toBe(55);
    expect(a.keyResults).toEqual([{ id: "kr-1", current: 3, done: false }]);
    expect(a.note).toBe("did stuff");
    expect(a.concerns).toEqual(["x"]);
  });

  it("extracts JSON from prose + code fences", () => {
    const a = parseAssessment(
      'Sure!\n```json\n{"advanced": false, "note": "blocked"}\n```\nHope that helps.',
    );
    expect(a.advanced).toBe(false);
    expect(a.note).toBe("blocked");
    expect(a.progress).toBeNull();
    expect(a.keyResults).toEqual([]);
  });

  it("clamps progress and coerces types", () => {
    const a = parseAssessment('{"advanced":1,"progress":"150"}');
    expect(a.advanced).toBe(false); // only strict true counts as advanced
    expect(a.progress).toBe(100); // clamped
  });

  it("returns null on non-JSON / malformed", () => {
    expect(parseAssessment("no json here")).toBeNull();
    expect(parseAssessment("{not valid")).toBeNull();
    expect(parseAssessment("")).toBeNull();
    expect(parseAssessment(null)).toBeNull();
  });
});

describe("goal-assess — apply (persists)", () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "goal-assess-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const o = () => ({ root });

  it("applies progress, KR update, note, and drift", () => {
    let g = createGoal({ objective: "X" }, o());
    g = addKeyResult(g.id, "first", { target: 4 }, o());
    const krId = g.keyResults[0].id;

    applyAssessment(
      g.id,
      {
        advanced: true,
        progress: 60,
        keyResults: [{ id: krId, current: 4, done: false }],
        note: "made progress",
        concerns: ["risk A"],
      },
      o(),
    );

    const after = getGoal(g.id, o());
    // KR current=target → auto-done; explicit progress 60 then overrides
    expect(after.keyResults[0].current).toBe(4);
    expect(after.progress).toBe(60);
    expect(after.notes.at(-1)).toMatchObject({
      by: "agent",
      text: "made progress",
    });
    // advanced:true → no "no-progress" flag, but concern recorded
    expect(after.drift.flags.some((f) => f.detail === "risk A")).toBe(true);
    expect(after.drift.flags.some((f) => f.kind === "no-progress")).toBe(false);
  });

  it("flags drift when the run did not advance", () => {
    const g = createGoal({ objective: "X" }, o());
    applyAssessment(
      g.id,
      { advanced: false, note: "stuck", keyResults: [] },
      o(),
    );
    const after = getGoal(g.id, o());
    expect(after.drift.flags.some((f) => f.kind === "no-progress")).toBe(true);
  });

  it("ignores unknown key-result ids without voiding the note", () => {
    const g = createGoal({ objective: "X" }, o());
    applyAssessment(
      g.id,
      {
        advanced: true,
        note: "kept",
        keyResults: [{ id: "kr-bogus", done: true }],
      },
      o(),
    );
    const after = getGoal(g.id, o());
    expect(after.notes.at(-1).text).toBe("kept");
  });
});

describe("goal-assess — orchestration", () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "goal-assess-orch-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("prompt → chat → parse → apply end to end", async () => {
    const goal = createGoal({ objective: "Ship it" }, { root });
    let sawPrompt = null;
    const chat = async (prompt) => {
      sawPrompt = prompt;
      return '{"advanced":true,"progress":80,"note":"shipped"}';
    };
    const { assessment, goal: updated } = await assessGoalProgress({
      goal,
      transcript: { prompt: "go", finalText: "done", toolCalls: [] },
      chat,
      opts: { root },
    });
    expect(sawPrompt).toContain("Ship it");
    expect(assessment.advanced).toBe(true);
    expect(updated.progress).toBe(80);
  });

  it("returns null assessment when the judge gives no usable JSON", async () => {
    const goal = createGoal({ objective: "X" }, { root });
    const { assessment } = await assessGoalProgress({
      goal,
      transcript: {},
      chat: async () => "I cannot help with that.",
      opts: { root },
    });
    expect(assessment).toBeNull();
  });

  it("survives a chat that throws", async () => {
    const goal = createGoal({ objective: "X" }, { root });
    const { assessment } = await assessGoalProgress({
      goal,
      transcript: {},
      chat: async () => {
        throw new Error("network");
      },
      opts: { root },
    });
    expect(assessment).toBeNull();
  });
});
