import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _deps,
  COLLABORATION_JOURNAL_VERSION,
  collaborationRunJournalPath,
  collaborationRunPath,
  createCollaborationRun,
  createCollaborationSessionId,
  finalizeCollaborationRun,
  listCollaborationRuns,
  projectCollaborationTasks,
  readCollaborationRun,
  readCollaborationRunCursor,
  readCollaborationRunRecovery,
  updateCollaborationRun,
  updateCollaborationUnit,
} from "../../src/lib/collaboration-run-store.js";

let tempDir;
let tick;
const defaultRandomHex = _deps.randomHex;
const defaultWithFileLock = _deps.withFileLock;
const defaultMaxJournalEvents = _deps.maxJournalEvents;
const defaultMaxJournalBytes = _deps.maxJournalBytes;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-collab-runs-"));
  process.env.CC_COLLABORATION_RUNS_DIR = tempDir;
  tick = 1700000000000;
  _deps.now = () => tick++;
  _deps.randomHex = () => "a1b2c3";
});

afterEach(() => {
  delete process.env.CC_COLLABORATION_RUNS_DIR;
  _deps.now = () => Date.now();
  _deps.randomHex = defaultRandomHex;
  _deps.withFileLock = defaultWithFileLock;
  _deps.maxJournalEvents = defaultMaxJournalEvents;
  _deps.maxJournalBytes = defaultMaxJournalBytes;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("collaboration run store", () => {
  it("persists only bounded governance and projects task rows", () => {
    const run = createCollaborationRun({
      kind: "team",
      repoRoot: "C:\\repo",
      permissionMode: "auto",
      resourceBudget: {
        maxTurns: 7,
        maxCostUsd: 2.5,
        maxTasks: 4,
      },
      units: [
        {
          key: "review",
          sessionId: "session-1",
          branch: "team/review",
          worktreePath: "C:\\repo\\.cc-worktrees\\review",
          prompt: "must not persist",
          argv: ["agent", "-p", "secret"],
        },
      ],
      prompt: "top-level secret",
    });

    updateCollaborationUnit(run.id, "review", {
      status: "completed",
      startedAt: tick++,
      endedAt: tick++,
      sideEffects: {
        ops: [
          { state: "committed", meta: { token: "secret" } },
          { state: "unknown", meta: { prompt: "secret" } },
        ],
      },
    });
    finalizeCollaborationRun(run.id);

    const stored = readCollaborationRun(run.id);
    expect(stored).toMatchObject({
      kind: "team",
      owner: `team:${run.id}`,
      status: "completed",
      permissionMode: "auto",
      resourceBudget: {
        maxTurns: 7,
        maxCostUsd: 2.5,
        maxTasks: 4,
      },
    });
    expect(stored.units[0]).toMatchObject({
      owner: `team:${run.id}:review`,
      sessionId: "session-1",
      status: "completed",
      sideEffects: {
        total: 2,
        unsettled: 0,
        unknown: 1,
        committed: 1,
      },
    });
    const serialized = fs.readFileSync(
      path.join(tempDir, `${run.id}.json`),
      "utf8",
    );
    const journal = fs.readFileSync(
      collaborationRunJournalPath(run.id),
      "utf8",
    );
    for (const persisted of [serialized, journal]) {
      expect(persisted).not.toContain("secret");
      expect(persisted).not.toContain("prompt");
      expect(persisted).not.toContain("argv");
    }

    expect(projectCollaborationTasks([stored])).toEqual([
      expect.objectContaining({
        managedTaskId: `${run.id}:review`,
        runId: run.id,
        runKind: "team",
        branch: "team/review",
        status: "completed",
        governance: expect.objectContaining({
          owner: `team:${run.id}:review`,
          sessionId: "session-1",
          permissionMode: "auto",
        }),
        sideEffects: expect.objectContaining({ total: 2, unknown: 1 }),
      }),
    ]);
    expect(listCollaborationRuns()).toHaveLength(1);
  });

  it("derives stable, non-prompt session ids and rejects unsafe ids", () => {
    const run = createCollaborationRun({
      kind: "batch",
      units: [{ key: "unit one" }],
    });
    const first = createCollaborationSessionId(run.id, "private prompt");
    const second = createCollaborationSessionId(run.id, "private prompt");
    expect(first).toBe(second);
    expect(first).not.toContain("private prompt");
    expect(() => readCollaborationRun("../escape")).toThrow(
      /Invalid collaboration run id/,
    );
  });

  it("never rewrites the base manifest and replays unit/finalize journal events", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [
        { key: "a", branch: "team/a" },
        { key: "b", branch: "team/b" },
      ],
    });
    const basePath = collaborationRunPath(run.id);
    expect(readCollaborationRunCursor(run.id)).toMatchObject({
      runId: run.id,
      lastSeq: 1,
      eventCount: 1,
      journalDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const genesisDigest = readCollaborationRunCursor(run.id).journalDigest;
    const baseBefore = fs.readFileSync(basePath);
    const sentinel = new Date("2001-02-03T04:05:06.000Z");
    fs.utimesSync(basePath, sentinel, sentinel);
    const baseMtimeBefore = fs.statSync(basePath).mtimeMs;

    updateCollaborationUnit(run.id, "b", {
      status: "running",
      startedAt: tick++,
    });
    updateCollaborationUnit(run.id, "b", {
      status: "completed",
      endedAt: tick++,
      sideEffects: { total: 1, committed: 1 },
    });
    updateCollaborationUnit(run.id, "a", {
      status: "completed",
      endedAt: tick++,
    });
    finalizeCollaborationRun(run.id, "completed");
    expect(readCollaborationRunCursor(run.id)).toMatchObject({
      lastSeq: 5,
      eventCount: 5,
      journalDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(readCollaborationRunCursor(run.id).journalDigest).not.toBe(
      genesisDigest,
    );

    expect(fs.readFileSync(basePath).equals(baseBefore)).toBe(true);
    expect(fs.statSync(basePath).mtimeMs).toBe(baseMtimeBefore);
    const events = fs
      .readFileSync(collaborationRunJournalPath(run.id), "utf8")
      .trim()
      .split("\n")
      .map((entry) => JSON.parse(entry));
    expect(events.map((event) => event.type)).toEqual([
      "run.snapshot",
      "unit.update",
      "unit.update",
      "unit.update",
      "run.finalize",
    ]);

    // Invalidate the same-process cache without changing manifest contents, so
    // this read must reconstruct state from base + journal.
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(basePath, future, future);
    const replayed = readCollaborationRun(run.id);
    expect(replayed.status).toBe("completed");
    expect(replayed.units[1]).toMatchObject({
      key: "b",
      status: "completed",
      sideEffects: { total: 1, committed: 1 },
    });
  });

  it("offers a lightweight per-unit return without exposing cached state", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }, { key: "b", scopePaths: ["src/b.js"] }],
    });

    const legacy = updateCollaborationUnit(run.id, "a", {
      status: "running",
    });
    expect(legacy.units).toHaveLength(2);

    const stringify = vi.spyOn(JSON, "stringify");
    let updatedUnit;
    try {
      updatedUnit = updateCollaborationUnit(
        run.id,
        "b",
        { status: "completed", endedAt: tick++ },
        { returnUnit: true },
      );
      expect(
        stringify.mock.calls.some(([value]) => Array.isArray(value?.units)),
      ).toBe(false);
    } finally {
      stringify.mockRestore();
    }
    expect(updatedUnit).toMatchObject({
      key: "b",
      status: "completed",
      scopePaths: ["src/b.js"],
    });
    expect(updatedUnit).not.toHaveProperty("units");

    // The lightweight clone is not a reference into the cached run.
    updatedUnit.status = "failed";
    expect(readCollaborationRun(run.id).units[1].status).toBe("completed");
  });

  it("fails closed when the mandatory read/append lock is unavailable", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "locked" }],
    });
    let attempts = 0;
    _deps.withFileLock = (_target, _fn, options) => {
      attempts += 1;
      expect(options).toMatchObject({ failIfUnavailable: true });
      const error = new Error("lock unavailable");
      error.code = "STATE_LOCK_UNAVAILABLE";
      throw error;
    };

    expect(() => readCollaborationRun(run.id)).toThrowError(
      expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }),
    );
    expect(() =>
      updateCollaborationUnit(run.id, "locked", { status: "running" }),
    ).toThrowError(expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }));
    expect(() => finalizeCollaborationRun(run.id)).toThrowError(
      expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }),
    );
    expect(attempts).toBe(3);
  });

  it("invalidates cached state when another process appends a journal event", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    updateCollaborationUnit(run.id, "a", { status: "running" });
    expect(readCollaborationRun(run.id).units[0].status).toBe("running");

    const externalAt = tick++;
    fs.appendFileSync(
      collaborationRunJournalPath(run.id),
      `${JSON.stringify({
        version: COLLABORATION_JOURNAL_VERSION,
        runId: run.id,
        seq: 3,
        type: "unit.update",
        at: externalAt,
        key: "a",
        patch: { status: "completed" },
      })}\n`,
      "utf8",
    );

    const refreshed = readCollaborationRun(run.id);
    expect(refreshed.units[0].status).toBe("completed");
    expect(refreshed.updatedAt).toBe(externalAt);
  });

  it("rejects forged journal events that violate governance invariants", () => {
    const appendEvent = (run, event) => {
      fs.appendFileSync(
        collaborationRunJournalPath(run.id),
        `${JSON.stringify({
          version: COLLABORATION_JOURNAL_VERSION,
          runId: run.id,
          at: tick++,
          ...event,
        })}\n`,
        "utf8",
      );
      expect(() => readCollaborationRun(run.id)).toThrowError(
        expect.objectContaining({ code: "COLLABORATION_JOURNAL_CORRUPT" }),
      );
    };

    const terminalUnit = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    updateCollaborationUnit(terminalUnit.id, "a", { status: "completed" });
    appendEvent(terminalUnit, {
      seq: 3,
      type: "unit.update",
      key: "a",
      patch: { status: "running" },
    });

    const incompleteRun = createCollaborationRun({
      kind: "team",
      units: [{ key: "pending" }],
    });
    appendEvent(incompleteRun, {
      seq: 2,
      type: "run.finalize",
      status: "completed",
    });

    const genericSnapshot = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    appendEvent(genericSnapshot, {
      seq: 2,
      type: "run.snapshot",
      run: genericSnapshot,
    });
  });

  it("rejects a truncated or malformed journal instead of returning stale cache", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    updateCollaborationUnit(run.id, "a", { status: "running" });
    const secret = "journal-secret-must-not-leak";
    fs.appendFileSync(
      collaborationRunJournalPath(run.id),
      `{"type":"unit.update","payload":"${secret}"`,
      "utf8",
    );

    for (const action of [
      () => readCollaborationRun(run.id),
      () => updateCollaborationUnit(run.id, "a", { status: "completed" }),
    ]) {
      let error;
      try {
        action();
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "COLLABORATION_JOURNAL_CORRUPT" });
      expect(error.message).not.toContain(secret);
    }

    const empty = createCollaborationRun({
      kind: "batch",
      units: [{ key: "empty" }],
    });
    fs.writeFileSync(collaborationRunJournalPath(empty.id), "", "utf8");
    expect(() => readCollaborationRun(empty.id)).toThrowError(
      expect.objectContaining({ code: "COLLABORATION_JOURNAL_CORRUPT" }),
    );
  });

  it("fails closed when a required journal is deleted", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    updateCollaborationUnit(run.id, "a", { status: "completed" });
    fs.rmSync(collaborationRunJournalPath(run.id));

    expect(() => readCollaborationRun(run.id)).toThrowError(
      expect.objectContaining({
        code: "COLLABORATION_JOURNAL_MISSING",
        runId: run.id,
      }),
    );
  });

  it("fails closed at the event cap without rewriting journal history", () => {
    _deps.maxJournalEvents = 2;
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    updateCollaborationUnit(run.id, "a", { status: "running" });
    expect(() =>
      updateCollaborationUnit(run.id, "a", { status: "failed" }),
    ).toThrowError(
      expect.objectContaining({
        code: "COLLABORATION_JOURNAL_EVENT_LIMIT",
        limit: 2,
        actual: 3,
      }),
    );

    const journalPath = collaborationRunJournalPath(run.id);
    const events = fs
      .readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .map((entry) => JSON.parse(entry));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("run.snapshot");
    expect(events[1].type).toBe("unit.update");
    const basePath = collaborationRunPath(run.id);
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(basePath, future, future);
    expect(readCollaborationRun(run.id).units[0].status).toBe("running");
  });

  it("raises an explicit event-limit error when no append fits", () => {
    _deps.maxJournalEvents = 1;
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    expect(() =>
      updateCollaborationUnit(run.id, "a", { status: "running" }),
    ).toThrowError(
      expect.objectContaining({
        code: "COLLABORATION_JOURNAL_EVENT_LIMIT",
        limit: 1,
      }),
    );
  });

  it("does not publish a manifest when the genesis journal cannot fit", () => {
    _deps.maxJournalBytes = 1;
    expect(() =>
      createCollaborationRun({
        kind: "team",
        units: [{ key: "a" }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "COLLABORATION_JOURNAL_BYTE_LIMIT",
      }),
    );

    expect(
      fs
        .readdirSync(tempDir)
        .filter(
          (name) => name.endsWith(".json") || name.endsWith(".journal.jsonl"),
        ),
    ).toEqual([]);
  });

  it("atomically validates an older recovery anchor as a journal prefix", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    const anchor = readCollaborationRunCursor(run.id);
    updateCollaborationUnit(run.id, "a", { status: "running" });

    expect(readCollaborationRunRecovery(run.id, { anchor })).toMatchObject({
      run: {
        id: run.id,
        units: [{ key: "a", status: "running" }],
      },
      cursor: {
        runId: run.id,
        lastSeq: 2,
      },
    });

    const journalPath = collaborationRunJournalPath(run.id);
    const events = fs
      .readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    events[0].at += 1;
    fs.writeFileSync(
      journalPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    expect(() => readCollaborationRunRecovery(run.id, { anchor })).toThrowError(
      expect.objectContaining({
        code: "COLLABORATION_JOURNAL_DIVERGED",
      }),
    );
  });

  it("makes terminal governance immutable and idempotent", () => {
    const run = createCollaborationRun({
      kind: "team",
      units: [{ key: "a" }],
    });
    updateCollaborationUnit(run.id, "a", { status: "completed" });
    finalizeCollaborationRun(run.id, "completed");
    const cursor = readCollaborationRunCursor(run.id);

    expect(() =>
      updateCollaborationUnit(run.id, "a", { status: "failed" }),
    ).toThrowError(
      expect.objectContaining({ code: "COLLABORATION_RUN_TERMINAL" }),
    );
    expect(finalizeCollaborationRun(run.id, "completed").status).toBe(
      "completed",
    );
    expect(readCollaborationRunCursor(run.id)).toEqual(cursor);
    expect(() => finalizeCollaborationRun(run.id, "failed")).toThrowError(
      expect.objectContaining({ code: "COLLABORATION_RUN_TERMINAL" }),
    );
  });

  it("keeps the generic updater as an exact no-op compatibility path", () => {
    const run = createCollaborationRun({
      kind: "team",
      repoRoot: "C:\\repo",
      permissionMode: "auto",
      resourceBudget: { maxTurns: 7, maxCostUsd: 2.5 },
      checkpointRequired: true,
      worktreeRequired: true,
      units: [
        {
          key: "a",
          sessionId: "session-a",
          permissionMode: "manual",
          resourceBudget: { maxTurns: 3 },
          scopePaths: ["src/a.js"],
        },
      ],
    });
    const cursor = readCollaborationRunCursor(run.id);

    expect(updateCollaborationRun(run.id, () => undefined)).toEqual(run);
    expect(updateCollaborationRun(run.id, {})).toEqual(run);
    expect(readCollaborationRunCursor(run.id)).toEqual(cursor);

    const mutations = [
      (draft) => {
        draft.permissionMode = "bypassPermissions";
      },
      (draft) => {
        draft.resourceBudget.maxTurns = 999;
      },
      (draft) => {
        draft.repoRoot = "D:\\other";
      },
      (draft) => {
        draft.units[0].sessionId = "session-attacker";
      },
      (draft) => {
        draft.units[0].owner = "team:attacker:a";
      },
      (draft) => {
        draft.units.push({ key: "injected" });
      },
      (draft) => {
        draft.units[0].branch = "team/reassigned";
      },
    ];
    for (const mutate of mutations) {
      expect(() => updateCollaborationRun(run.id, mutate)).toThrowError(
        expect.objectContaining({
          code: "COLLABORATION_RUN_UPDATE_FORBIDDEN",
        }),
      );
    }
    expect(readCollaborationRun(run.id)).toEqual(run);
    expect(readCollaborationRunCursor(run.id)).toEqual(cursor);
  });

  it("prevents terminal unit statuses from regressing or changing", () => {
    const cases = [
      ["completed", "failed"],
      ["failed", "completed"],
      ["test-failed", "running"],
      ["no-changes", "pending"],
      ["cancelled", "completed"],
    ];
    const run = createCollaborationRun({
      kind: "team",
      units: cases.map(([status], index) => ({
        key: `unit-${index}`,
        status,
      })),
    });
    const cursor = readCollaborationRunCursor(run.id);

    for (const [status, nextStatus] of cases) {
      const index = cases.findIndex(([candidate]) => candidate === status);
      expect(() =>
        updateCollaborationUnit(run.id, `unit-${index}`, {
          status: nextStatus,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "COLLABORATION_UNIT_TERMINAL",
          status,
        }),
      );
    }
    expect(readCollaborationRunCursor(run.id)).toEqual(cursor);

    expect(() =>
      updateCollaborationUnit(run.id, "unit-0", {
        status: "completed",
        sideEffects: { total: 1, committed: 1 },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "COLLABORATION_UNIT_TERMINAL" }),
    );
    expect(
      updateCollaborationUnit(
        run.id,
        "unit-0",
        { status: "completed" },
        { returnUnit: true },
      ),
    ).toMatchObject({ status: "completed" });
    expect(readCollaborationRunCursor(run.id)).toEqual(cursor);
  });

  it("only completes runs whose units are all completed", () => {
    for (const status of ["failed", "cancelled"]) {
      const run = createCollaborationRun({
        kind: "team",
        units: [{ key: "done", status: "completed" }, { key: "pending" }],
      });
      const cursor = readCollaborationRunCursor(run.id);

      expect(() => finalizeCollaborationRun(run.id, "completed")).toThrowError(
        expect.objectContaining({ code: "COLLABORATION_RUN_INCOMPLETE" }),
      );
      expect(readCollaborationRunCursor(run.id)).toEqual(cursor);
      expect(readCollaborationRun(run.id).status).toBe("running");

      expect(finalizeCollaborationRun(run.id, status).status).toBe(status);
    }
  });
});
