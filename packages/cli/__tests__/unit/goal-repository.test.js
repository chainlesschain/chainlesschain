import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GoalRepository } from "@chainlesschain/session-core/goal-repository";
import {
  createGoalFileAdapter,
  createGoal,
  getGoal,
  recordProgress,
  setStatus,
  deleteGoal,
} from "../../src/lib/goal-store.js";

describe("same-file goal repository and legacy CLI compatibility", () => {
  let root, adapter, repo;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-goal-repository-"));
    adapter = createGoalFileAdapter({ root });
    repo = new GoalRepository({ adapter });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it("shares one authority file with cc goal and rejects stale writes", () => {
    const legacyApi = createGoal({ objective: "Follow delivery" }, { root });
    expect(repo.get(legacyApi.id)).toEqual(legacyApi);
    const paused = repo.revise({
      id: legacyApi.id,
      expectedRevision: 1,
      patch: { status: "paused" },
    });
    expect(getGoal(paused.id, { root })).toEqual(paused);
    expect(paused.controlGeneration).toBe(1);
    expect(() =>
      recordProgress(paused.id, { pct: 50 }, { root, expectedRevision: 1 }),
    ).toThrow("GOAL_REVISION_CONFLICT");
    expect(() =>
      repo.revise({
        id: paused.id,
        expectedRevision: 1,
        patch: { status: "active" },
      }),
    ).toThrow("GOAL_REVISION_CONFLICT");
    const progress = recordProgress(
      paused.id,
      { pct: 80, note: "model assessment", by: "agent" },
      { root },
    );
    expect(progress.revision).toBe(3);
    expect(progress.status).toBe("paused");
    expect(progress.completion).toBeNull();
    expect(progress.controlGeneration).toBe(1);
  });
  it("keeps legacy bytes unchanged on read and persists migration only with a write", () => {
    const raw = JSON.stringify({
      id: "old-goal",
      objective: "Ship",
      title: "Ship",
      status: "active",
      progress: 25,
      keyResults: [],
      linkedSessions: ["session-1"],
      notes: [],
      drift: { lastProgressAt: null, flags: [] },
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });
    const file = join(root, "old-goal.json");
    writeFileSync(file, raw);
    expect(repo.get("old-goal")).toMatchObject({
      revision: 1,
      ownerRef: null,
      projectRef: null,
      triggerRefs: [],
    });
    expect(readFileSync(file, "utf8")).toBe(raw);
    expect(getGoal("old-goal", { root }).schemaVersion).toBeUndefined();
    const next = repo.revise({
      id: "old-goal",
      expectedRevision: 1,
      patch: { status: "paused" },
    });
    expect(next.linkedSessions).toEqual(["session-1"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(next);
  });
  it("preserves legacy explicit done as a declaration, without verified evidence", () => {
    const original = createGoal({ objective: "Manual goal" }, { root });
    const done = setStatus(original.id, "done", { root });
    expect(repo.get(original.id)).toMatchObject({
      status: "done",
      revision: 2,
      progress: 100,
      completion: null,
    });
    expect(done.controlGeneration).toBe(1);
  });
  it("fails closed on corruption and unknown schema, preserving the source bytes", () => {
    const current = repo.create({ objective: "Inspect" });
    const file = join(root, `${current.id}.json`);
    const corrupted = JSON.stringify({ ...current, schemaVersion: 99 });
    writeFileSync(file, corrupted);
    expect(() =>
      repo.revise({
        id: current.id,
        expectedRevision: 1,
        patch: { status: "paused" },
      }),
    ).toThrow("GOAL_UNSUPPORTED_SCHEMA");
    expect(readFileSync(file, "utf8")).toBe(corrupted);
    writeFileSync(file, "{");
    expect(() => repo.get(current.id)).toThrow("GOAL_RECORD_CORRUPT");
  });
  it("rolls back failed transforms and refuses another store's copied goal", () => {
    const current = repo.create({ objective: "Inspect" });
    expect(() =>
      adapter.compareAndSwap(current.id, 1, () => {
        throw new Error("interrupted");
      }),
    ).toThrow("interrupted");
    expect(repo.get(current.id)).toEqual(current);
    const file = join(root, `${current.id}.json`);
    writeFileSync(
      file,
      JSON.stringify({ ...current, storeId: "another-store" }),
    );
    expect(() => repo.get(current.id)).toThrow("GOAL_STORE_MISMATCH");
  });
  it("rejects filesystem-special goal IDs before creating or acquiring a lock", () => {
    for (const id of ["a:b", "goal name", "../other", "a\\b"]) {
      expect(() => repo.create({ id, objective: "Inspect" })).toThrow();
      expect(() => adapter.compareAndSwap(id, 1, () => {})).toThrow(
        "GOAL_INVALID_ID",
      );
    }
  });
  it("reopens verified standalone goals through legacy controls and clears active verification", () => {
    const verifiedRepo = new GoalRepository({
      adapter,
      verifyCompletion: () => ({
        met: true,
        verifierRef: "trusted-host",
        criteriaIds: ["review"],
        evidenceRefs: [{ kind: "manual-confirmation", id: "approval-one" }],
      }),
    });
    const original = verifiedRepo.create({
      objective: "Review evidence",
      acceptanceCriteria: [
        { id: "review", kind: "manual", description: "Review" },
      ],
    });
    const done = verifiedRepo.complete({
      id: original.id,
      expectedRevision: 1,
    });
    expect(() =>
      recordProgress(done.id, { note: "Change completed goal" }, { root }),
    ).toThrow("GOAL_TERMINAL_REVISION_DENIED");
    expect(repo.get(done.id)).toEqual(done);
    const reopened = setStatus(done.id, "active", { root });
    expect(reopened).toMatchObject({
      revision: 3,
      controlGeneration: 1,
      status: "active",
      completion: null,
    });
    expect(
      recordProgress(done.id, { note: "New review" }, { root }).revision,
    ).toBe(4);
  });
  it("compares a supplied delete revision inside the same file lock", () => {
    const original = createGoal(
      { objective: "Keep current version" },
      { root },
    );
    const current = setStatus(original.id, "paused", { root });
    expect(() =>
      deleteGoal(original.id, { root, expectedRevision: 1 }),
    ).toThrow("GOAL_REVISION_CONFLICT");
    expect(getGoal(original.id, { root })).toEqual(current);
    expect(deleteGoal(original.id, { root, expectedRevision: 2 })).toBe(true);
  });
  it("keeps legacy controls available when bounded migration cannot retain the full history", () => {
    const notes = Array.from({ length: 201 }, (_, index) => ({
      at: "2026-10-06T00:00:00.000Z",
      text: `note-${index}`,
      by: "user",
    }));
    const legacy = {
      id: "large-history",
      objective: "Keep history",
      title: "Keep history",
      status: "active",
      progress: 0,
      keyResults: [],
      linkedSessions: [],
      notes,
      drift: { lastProgressAt: null, flags: [] },
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    writeFileSync(join(root, "large-history.json"), JSON.stringify(legacy));
    const paused = setStatus(legacy.id, "paused", { root });
    expect(paused).toMatchObject({
      status: "paused",
      revision: 2,
      controlGeneration: 1,
    });
    expect(paused.notes).toEqual(notes);
    expect(paused.schemaVersion).toBeUndefined();
    expect(() =>
      recordProgress(legacy.id, { pct: 50 }, { root, expectedRevision: 1 }),
    ).toThrow("GOAL_REVISION_CONFLICT");
    const next = recordProgress(
      legacy.id,
      { note: "Keep using original adapter" },
      { root },
    );
    expect(next.notes).toHaveLength(202);
    expect(next.notes.slice(0, 201)).toEqual(notes);
    expect(getGoal(legacy.id, { root }).notes).toHaveLength(202);
  });
});
