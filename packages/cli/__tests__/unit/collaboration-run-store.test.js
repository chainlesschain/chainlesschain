import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _deps,
  createCollaborationRun,
  createCollaborationSessionId,
  finalizeCollaborationRun,
  listCollaborationRuns,
  projectCollaborationTasks,
  readCollaborationRun,
  updateCollaborationUnit,
} from "../../src/lib/collaboration-run-store.js";

let tempDir;
let tick;

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
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("argv");

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
});
