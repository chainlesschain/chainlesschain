import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_PERSISTENCE_ERROR_CODES,
  PLAN_SESSION_EVENT_SCHEMA,
  PLAN_SESSION_EVENT_VERSION,
  PLAN_SESSION_LEGACY_SNAPSHOT_VERSION,
  PLAN_SESSION_SNAPSHOT_SCHEMA,
  PLAN_SESSION_SNAPSHOT_VERSION,
  PlanModeManager,
  PlanState,
  PlanStatus,
  planSnapshotPath,
} from "../../src/lib/plan-mode.js";

describe("PlanModeManager — durable session snapshots", () => {
  let tempRoot;
  let stateDir;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plan-state-"));
    stateDir = path.join(tempRoot, "plans");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("keeps unnamed and explicit memoryOnly managers compatible and off disk", () => {
    const unnamed = new PlanModeManager({ stateDir });
    expect(unnamed.enterPlanMode({ title: "memory" }).plan).toBeDefined();
    expect(unnamed.addPlanItem({ title: "step" }).item).toBeDefined();

    const namedMemory = new PlanModeManager({
      sessionId: "memory-session",
      memoryOnly: true,
      stateDir,
    });
    namedMemory.enterPlanMode({ title: "also memory" });

    expect(unnamed.memoryOnly).toBe(true);
    expect(namedMemory.memoryOnly).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(false);
  });

  it("round-trips execution, settlement, dependencies, ownership and evidence", () => {
    const sessionId = "restart-roundtrip";
    const options = { sessionId, stateDir };
    const first = new PlanModeManager(options);
    const sessionEvents = [];
    first.on("session-event", (event) => sessionEvents.push(event));
    first.enterPlanMode({ title: "Durable plan", goal: "survive restart" });
    const prepare = first.addPlanItem({
      id: "prepare",
      title: "Prepare",
      tool: "write_file",
      owner: "agent-a",
      approval: { requestedBy: "operator" },
      checkpoint: { checkpointId: "cp-before" },
      evidenceLineage: [{ type: "request", digest: "sha256:aaa" }],
    }).item;
    first.addPlanItem({
      id: "verify",
      title: "Verify",
      tool: "edit_file",
      dependencies: [prepare.id],
      owner: "agent-b",
      evidenceLineage: [],
    }).item;
    first.approvePlan({ permissionMode: "acceptEdits" });
    first.startPlanItemForTool("write_file", {
      toolUseId: "tool-1",
      turn: 4,
    });
    first.settlePlanItem(prepare.id, {
      success: true,
      result: { written: true },
      checkpoint: { checkpointId: "cp-after", revision: 9 },
      evidenceLineage: [
        { type: "request", digest: "sha256:aaa" },
        { type: "tool-result", digest: "sha256:bbb" },
      ],
    });
    first.startPlanItemForTool("edit_file", {
      toolUseId: "tool-2",
      turn: 5,
    });

    const filePath = planSnapshotPath(sessionId, { stateDir });
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk).toMatchObject({
      schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
      version: PLAN_SESSION_SNAPSHOT_VERSION,
      sessionId,
      revision: first.revision,
      event: {
        schema: PLAN_SESSION_EVENT_SCHEMA,
        version: PLAN_SESSION_EVENT_VERSION,
        revision: first.revision,
        previousRevision: first.revision - 1,
        type: "plan-item-executing",
      },
    });
    expect(sessionEvents.at(-1)).toMatchObject({
      schema: PLAN_SESSION_EVENT_SCHEMA,
      version: PLAN_SESSION_EVENT_VERSION,
      revision: first.revision,
      type: "plan-item-executing",
    });

    const restored = new PlanModeManager(options);
    const restoredPrepare = restored.currentPlan.getItem("prepare");
    const restoredVerify = restored.currentPlan.getItem("verify");
    expect(restored.revision).toBe(first.revision);
    expect(restored.state).toBe(PlanState.EXECUTING);
    expect(restoredPrepare).toMatchObject({
      status: PlanStatus.COMPLETED,
      owner: "agent-a",
      result: { written: true },
      checkpoint: { checkpointId: "cp-after", revision: 9 },
      approval: {
        requestedBy: "operator",
        decision: "approved",
        permissionMode: "acceptEdits",
      },
      evidenceLineage: [
        { type: "request", digest: "sha256:aaa" },
        { type: "tool-result", digest: "sha256:bbb" },
      ],
    });
    expect(restoredVerify).toMatchObject({
      status: PlanStatus.EXECUTING,
      owner: "agent-b",
      dependencies: ["prepare"],
      toolUseId: "tool-2",
      turn: 5,
    });
    expect(restored.getExecutionLock()).toEqual(first.getExecutionLock());
  });

  it("rejects a stale writer with revision CAS and restores its memory state", () => {
    const options = { sessionId: "cas-session", stateDir };
    const writerA = new PlanModeManager(options);
    const writerB = new PlanModeManager(options);

    expect(writerA.enterPlanMode({ title: "winner" }).revision).toBe(1);
    const conflict = writerB.enterPlanMode({ title: "stale" });

    expect(conflict).toMatchObject({
      code: PLAN_PERSISTENCE_ERROR_CODES.REVISION_CONFLICT,
      expectedRevision: 0,
      actualRevision: 1,
    });
    expect(writerB.revision).toBe(0);
    expect(writerB.state).toBe(PlanState.INACTIVE);
    expect(writerB.currentPlan).toBeNull();
    expect(new PlanModeManager(options).currentPlan.title).toBe("winner");
  });

  it("migrates a legacy draft without inventing execution authority", () => {
    const sessionId = "legacy-draft";
    const filePath = planSnapshotPath(sessionId, { stateDir });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
        version: PLAN_SESSION_LEGACY_SNAPSHOT_VERSION,
        sessionId,
        revision: 4,
        updatedAt: 1_700_000_000_000,
        state: {
          state: PlanState.ANALYZING,
          currentPlan: {
            id: "legacy-plan",
            title: "Legacy draft",
            description: "",
            goal: "migrate safely",
            items: [
              {
                id: "legacy-item",
                order: 0,
                title: "Inspect",
                description: "",
                tool: "read_file",
                params: {},
                dependencies: [],
                estimatedImpact: "low",
                status: PlanStatus.PENDING,
                result: null,
                error: null,
                turn: null,
                toolUseId: null,
                startedAt: null,
                completedAt: null,
              },
            ],
            status: PlanState.ANALYZING,
            version: 1,
            revisionOf: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          history: [],
          blockedToolLog: [],
        },
      }),
      "utf8",
    );

    const restored = new PlanModeManager({ sessionId, stateDir });
    expect(restored).toMatchObject({
      revision: 4,
      state: PlanState.ANALYZING,
      executionLock: null,
      lastEvent: { type: "legacy-snapshot-migrated", revision: 4 },
    });
    expect(restored.currentPlan.getItem("legacy-item")).toMatchObject({
      owner: null,
      checkpoint: null,
      approval: null,
      evidenceLineage: [],
    });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8")).version).toBe(
      PLAN_SESSION_LEGACY_SNAPSHOT_VERSION,
    );

    expect(restored.addPlanItem({ title: "Continue" }).revision).toBe(5);
    const migrated = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(migrated).toMatchObject({
      version: PLAN_SESSION_SNAPSHOT_VERSION,
      revision: 5,
      event: { type: "plan-item-added", previousRevision: 4 },
      state: { executionLock: null },
    });
  });

  it.each([PlanState.APPROVED, PlanState.EXECUTING])(
    "rejects legacy %s state because the old schema has no executionLock",
    (legacyState) => {
      const sessionId = `legacy-${legacyState}`;
      const filePath = planSnapshotPath(sessionId, { stateDir });
      fs.mkdirSync(stateDir, { recursive: true });
      const bytes = JSON.stringify({
        schema: PLAN_SESSION_SNAPSHOT_SCHEMA,
        version: PLAN_SESSION_LEGACY_SNAPSHOT_VERSION,
        sessionId,
        revision: 2,
        updatedAt: 1_700_000_000_000,
        state: {
          state: legacyState,
          currentPlan: {
            id: "legacy-authority-plan",
            title: "Unsafe legacy authority",
            description: "",
            goal: "must refuse",
            items: [],
            status: legacyState,
            version: 1,
            revisionOf: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          history: [],
          blockedToolLog: [],
        },
      });
      fs.writeFileSync(filePath, bytes, "utf8");

      expect(() => new PlanModeManager({ sessionId, stateDir })).toThrowError(
        expect.objectContaining({ code: PLAN_PERSISTENCE_ERROR_CODES.CORRUPT }),
      );
      expect(fs.readFileSync(filePath, "utf8")).toBe(bytes);
    },
  );

  it("surfaces a corrupt canonical snapshot without overwriting its bytes", () => {
    const sessionId = "corrupt-session";
    const filePath = planSnapshotPath(sessionId, { stateDir });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(filePath, '{"schema":', "utf8");
    const corruptBytes = fs.readFileSync(filePath);

    let error;
    try {
      new PlanModeManager({ sessionId, stateDir });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: PLAN_PERSISTENCE_ERROR_CODES.CORRUPT,
      recoveryStrategy: "quarantine-corrupt",
    });
    expect(fs.readFileSync(filePath)).toEqual(corruptBytes);
  });

  it("makes an orphaned half-write visible and blocks restart", () => {
    const sessionId = "half-write-session";
    const options = { sessionId, stateDir };
    new PlanModeManager(options).enterPlanMode({ title: "committed" });
    const filePath = planSnapshotPath(sessionId, { stateDir });
    const canonicalBytes = fs.readFileSync(filePath);
    const orphanPath = path.join(
      stateDir,
      `.${path.basename(filePath)}.999.crash.tmp`,
    );
    fs.writeFileSync(orphanPath, '{"partial":', "utf8");

    let error;
    try {
      new PlanModeManager(options);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: PLAN_PERSISTENCE_ERROR_CODES.RECOVERY_REQUIRED,
      recoveryStrategy: "discard-temporary",
    });
    expect(error.temporaryPaths).toContain(orphanPath);
    expect(fs.readFileSync(filePath)).toEqual(canonicalBytes);
    expect(fs.existsSync(orphanPath)).toBe(true);
  });

  it("keeps disk and memory at the prior revision when atomic rename fails", () => {
    const sessionId = "atomic-failure-session";
    const options = { sessionId, stateDir };
    const initial = new PlanModeManager(options);
    initial.enterPlanMode({ title: "safe plan" });
    const filePath = planSnapshotPath(sessionId, { stateDir });
    const committedBytes = fs.readFileSync(filePath);
    const revision = initial.revision;

    const failing = new PlanModeManager({
      ...options,
      persistenceOptions: {
        platform: "win32",
        beforeRename: () => {
          throw new Error("injected Windows rename failure");
        },
      },
    });
    const result = failing.markPlanReady();

    expect(result).toMatchObject({
      code: PLAN_PERSISTENCE_ERROR_CODES.WRITE_FAILED,
    });
    expect(failing.revision).toBe(revision);
    expect(failing.state).toBe(PlanState.ANALYZING);
    expect(failing.currentPlan.status).toBe(PlanState.ANALYZING);
    expect(fs.readFileSync(filePath)).toEqual(committedBytes);
    expect(
      fs.readdirSync(stateDir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rolls executePlan memory back to its last durable state on final write failure", async () => {
    let renameAttempt = 0;
    const options = {
      sessionId: "execute-atomic-failure",
      stateDir,
      persistenceOptions: {
        platform: "win32",
        beforeRename: () => {
          renameAttempt += 1;
          if (renameAttempt === 5) {
            throw new Error("injected final execution rename failure");
          }
        },
      },
    };
    const manager = new PlanModeManager(options);
    manager.enterPlanMode({ title: "execute atomically" });
    manager.addPlanItem({ id: "run", title: "Run", tool: "run_shell" });
    manager.approvePlan();

    const result = await manager.executePlan(async () => ({ ok: true }));
    expect(result).toMatchObject({
      code: PLAN_PERSISTENCE_ERROR_CODES.WRITE_FAILED,
    });
    expect(manager).toMatchObject({
      revision: 4,
      state: PlanState.EXECUTING,
    });
    expect(manager.currentPlan.getItem("run")).toMatchObject({
      status: PlanStatus.APPROVED,
      result: null,
    });

    const restored = new PlanModeManager({
      sessionId: options.sessionId,
      stateDir,
    });
    expect(restored.revision).toBe(manager.revision);
    expect(restored.state).toBe(manager.state);
    expect(restored.currentPlan.getItem("run").status).toBe(
      PlanStatus.APPROVED,
    );
  });

  it("fsyncs each temp file before Windows create and replacement renames", () => {
    const fsyncSync = vi.fn((descriptor) => fs.fsyncSync(descriptor));
    const renameSync = vi.fn((from, to) => fs.renameSync(from, to));
    const runtimeFs = { ...fs, fsyncSync, renameSync };
    const manager = new PlanModeManager({
      sessionId: "windows-atomic-session",
      stateDir,
      persistenceOptions: { fs: runtimeFs, platform: "win32" },
    });

    expect(manager.enterPlanMode({ title: "atomic" }).revision).toBe(1);
    expect(manager.addPlanItem({ title: "replacement" }).revision).toBe(2);
    const snapshotPath = planSnapshotPath("windows-atomic-session", {
      stateDir,
    });
    const commitRenameIndexes = renameSync.mock.calls
      .map((args, index) => (args[1] === snapshotPath ? index : -1))
      .filter((index) => index >= 0);
    expect(fsyncSync).toHaveBeenCalledTimes(2);
    expect(commitRenameIndexes).toHaveLength(2);
    for (let index = 0; index < commitRenameIndexes.length; index++) {
      expect(fsyncSync.mock.invocationCallOrder[index]).toBeLessThan(
        renameSync.mock.invocationCallOrder[commitRenameIndexes[index]],
      );
    }
  });

  it.each([
    ["missing lock", (snapshot) => (snapshot.state.executionLock = null)],
    [
      "unknown lock field",
      (snapshot) => (snapshot.state.executionLock.unreviewed = true),
    ],
    [
      "widened tools",
      (snapshot) => snapshot.state.executionLock.allowedTools.push("run_shell"),
    ],
  ])("conservatively rejects an approved snapshot with %s", (_name, mutate) => {
    const sessionId = `lock-${_name.replaceAll(" ", "-")}`;
    const options = { sessionId, stateDir };
    const manager = new PlanModeManager(options);
    manager.enterPlanMode({ title: "locked" });
    manager.addPlanItem({ id: "write", title: "Write", tool: "write_file" });
    manager.approvePlan({ permissionMode: "acceptEdits" });
    const filePath = planSnapshotPath(sessionId, { stateDir });
    const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
    mutate(snapshot);
    fs.writeFileSync(filePath, JSON.stringify(snapshot), "utf8");

    expect(() => new PlanModeManager(options)).toThrowError(
      expect.objectContaining({ code: PLAN_PERSISTENCE_ERROR_CODES.CORRUPT }),
    );
  });

  it("restores the execution lock as a deeply frozen authority envelope", () => {
    const options = { sessionId: "frozen-lock", stateDir };
    const first = new PlanModeManager(options);
    first.enterPlanMode({ title: "locked" });
    first.addPlanItem({ id: "write", title: "Write", tool: "write_file" });
    first.approvePlan({ permissionMode: "acceptEdits" });

    const restored = new PlanModeManager(options);
    expect(Object.isFrozen(restored.executionLock)).toBe(true);
    expect(Object.isFrozen(restored.executionLock.allowedTools)).toBe(true);
    expect(Object.isFrozen(restored.executionLock.approvedItemIds)).toBe(true);
    expect(() =>
      restored.executionLock.allowedTools.push("run_shell"),
    ).toThrow();
    expect(restored.isToolAllowed("write_file")).toBe(true);
    expect(restored.isToolAllowed("run_shell")).toBe(false);
  });
});
