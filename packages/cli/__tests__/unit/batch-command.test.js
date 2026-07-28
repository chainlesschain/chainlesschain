import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  _internal,
  _processDeps,
  runBatchCommand,
} from "../../src/commands/batch.js";

const originalSpawn = _processDeps.spawn;
const originalExecFileSync = _processDeps.execFileSync;

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new PassThrough();
  return child;
}

describe("cc batch command", () => {
  let dir;
  let logs;
  let errs;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-batch-"));
    logs = [];
    errs = [];
  });

  afterEach(() => {
    _processDeps.spawn = originalSpawn;
    _processDeps.execFileSync = originalExecFileSync;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const io = () => ({
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    repoDir: dir,
    collaborationStore: false,
  });

  function fakeBatchDeps() {
    return {
      createWorktree: (key, branch) => `/wt/${key}`,
      removeWorktree: () => {},
      runAgent: vi.fn(async () => ({ code: 0 })),
      runTest: vi.fn(async () => ({ code: 0 })),
      diffStat: () => ({ filesChanged: 1, insertions: 3, deletions: 0 }),
      commit: () => true,
      previewMerge: () => ({ success: true, conflicts: [] }),
      mergeBranch: () => ({ success: true }),
      branchFor: (key) => `batch/${key}`,
    };
  }

  it("errors when neither --units nor --decompose is given", async () => {
    const code = await runBatchCommand({}, io());
    expect(code).toBe(4);
    expect(errs.join("\n")).toMatch(/--units .* or --decompose/);
  });

  it("runs a units file end-to-end (JSON output)", async () => {
    const unitsFile = path.join(dir, "units.json");
    fs.writeFileSync(
      unitsFile,
      JSON.stringify({
        units: [
          { key: "a", prompt: "do a" },
          { key: "b", prompt: "do b" },
        ],
      }),
    );
    const code = await runBatchCommand(
      { units: unitsFile, json: true },
      { ...io(), batchDeps: fakeBatchDeps() },
    );
    expect(code).toBe(0);
    const out = JSON.parse(logs.join("\n"));
    expect(out.summary).toMatchObject({ total: 2, done: 2 });
  });

  it("returns exit 1 when a unit's test fails", async () => {
    const unitsFile = path.join(dir, "units.json");
    fs.writeFileSync(
      unitsFile,
      JSON.stringify({ units: [{ key: "a", prompt: "x", test: "fail" }] }),
    );
    const deps = fakeBatchDeps();
    deps.runTest = vi.fn(async () => {
      throw new Error("nope");
    });
    const code = await runBatchCommand(
      { units: unitsFile, json: true },
      { ...io(), batchDeps: deps },
    );
    expect(code).toBe(1);
  });

  it("persists and returns bounded per-unit governance", async () => {
    const unitsFile = path.join(dir, "units.json");
    fs.writeFileSync(
      unitsFile,
      JSON.stringify({ units: [{ key: "a", prompt: "private prompt" }] }),
    );
    const updates = [];
    const collaborationStore = {
      createRunId: () => "batch-1700000000000-a1b2c3",
      createSessionId: (runId, key) => `session-${runId}-${key}`,
      createRun: (input) => ({
        ...input,
        owner: `batch:${input.id}`,
        status: "running",
        units: input.units.map((unit) => ({
          ...unit,
          owner: `batch:${input.id}:${unit.key}`,
          status: "pending",
          sideEffects: {
            total: 0,
            unsettled: 0,
            unknown: 0,
            committed: 0,
            failed: 0,
          },
        })),
      }),
      updateUnit: (runId, key, patch) => {
        updates.push({ runId, key, patch });
      },
      loadSideEffects: () => ({
        ops: [{ state: "committed", meta: { secret: "not projected" } }],
      }),
      finalizeRun: (id, status) => ({
        id,
        owner: `batch:${id}`,
        status,
        permissionMode: "plan",
        resourceBudget: { maxTurns: 5, maxCostUsd: 1.5, maxTasks: 1 },
        units: [
          {
            key: "a",
            owner: `batch:${id}:a`,
            sessionId: `session-${id}-a`,
            status: "completed",
            sideEffects: {
              total: 1,
              unsettled: 0,
              unknown: 0,
              committed: 1,
              failed: 0,
            },
          },
        ],
      }),
    };

    const code = await runBatchCommand(
      {
        units: unitsFile,
        json: true,
        permissionMode: "plan",
        maxTurns: 5,
        maxBudgetUsd: 1.5,
      },
      {
        ...io(),
        collaborationStore,
        batchDeps: fakeBatchDeps(),
      },
    );

    expect(code).toBe(0);
    const output = JSON.parse(logs.join("\n"));
    expect(output.governance).toMatchObject({
      runId: "batch-1700000000000-a1b2c3",
      owner: "batch:batch-1700000000000-a1b2c3",
      permissionMode: "plan",
      units: [
        {
          key: "a",
          sessionId: "session-batch-1700000000000-a1b2c3-a",
          sideEffects: { total: 1, committed: 1 },
        },
      ],
    });
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "a",
          patch: expect.objectContaining({
            status: "running",
            worktreePath: "/wt/a",
          }),
        }),
        expect.objectContaining({
          key: "a",
          patch: expect.objectContaining({
            status: "completed",
            sideEffects: expect.objectContaining({
              ops: [expect.objectContaining({ state: "committed" })],
            }),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(output.governance)).not.toContain("private prompt");
    expect(JSON.stringify(output.governance)).not.toContain("secret");
  });

  it("--decompose --plan-only prints units without running", async () => {
    const decompose = vi.fn(async () => [
      { key: "u1", prompt: "part 1" },
      { key: "u2", prompt: "part 2" },
    ]);
    const code = await runBatchCommand(
      { decompose: "big goal", parts: "2", planOnly: true },
      { ...io(), decompose },
    );
    expect(code).toBe(0);
    expect(decompose).toHaveBeenCalledWith(
      "big goal",
      2,
      expect.objectContaining({ repoDir: dir }),
    );
    const out = JSON.parse(logs.join("\n"));
    expect(out.units).toHaveLength(2);
  });

  it("reports a malformed units file", async () => {
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{ not json");
    const code = await runBatchCommand({ units: bad }, io());
    expect(code).toBe(4);
    expect(errs.join("\n")).toMatch(/Failed to resolve units/);
  });

  it("brokers agent and shell test processes with explicit contracts", async () => {
    const agentChild = fakeChild();
    const testChild = fakeChild();
    _processDeps.spawn = vi
      .fn()
      .mockReturnValueOnce(agentChild)
      .mockReturnValueOnce(testChild);

    let stdin = "";
    agentChild.stdin.setEncoding("utf8");
    agentChild.stdin.on("data", (chunk) => (stdin += chunk));
    const agentRun = _internal.spawnAgent("implement it", dir, {
      permissionMode: "plan",
      sessionId: "session-batch-1",
      maxTurns: 5,
      maxBudgetUsd: 1.25,
    });
    agentChild.emit("close", 0);
    await expect(agentRun).resolves.toEqual({ code: 0 });

    const testRun = _internal.runTestCommand("npm test", dir);
    testChild.emit("close", 0);
    await expect(testRun).resolves.toEqual({ code: 0 });

    expect(_processDeps.spawn.mock.calls[0][2]).toMatchObject({
      cwd: dir,
      origin: "batch:agent-run",
      policy: "allow",
      scope: "batch",
      shell: false,
    });
    expect(_processDeps.spawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "plan",
        "--session",
        "session-batch-1",
        "--max-turns",
        "5",
        "--max-budget-usd",
        "1.25",
      ]),
    );
    expect(_processDeps.spawn.mock.calls[0][1]).not.toContain("implement it");
    expect(stdin).toBe("implement it");
    expect(_processDeps.spawn.mock.calls[1]).toEqual([
      "npm test",
      [],
      expect.objectContaining({
        cwd: dir,
        origin: "batch:test-command",
        policy: "allow",
        scope: "batch",
        shell: true,
      }),
    ]);
  });

  it("brokers decomposition with literal agent argv", async () => {
    const child = fakeChild();
    _processDeps.spawn = vi.fn(() => child);

    const pending = _internal.decomposeGoal("split this", 2, {
      repoDir: dir,
    });
    child.stdout.emit(
      "data",
      Buffer.from('{"units":[{"key":"a","prompt":"do a"}]}'),
    );
    child.emit("close", 0);

    await expect(pending).resolves.toEqual([{ key: "a", prompt: "do a" }]);
    expect(_processDeps.spawn.mock.calls[0][2]).toMatchObject({
      cwd: dir,
      origin: "batch:decompose",
      policy: "allow",
      scope: "batch",
      shell: false,
    });
  });

  it("brokers git diff and commit operations without a shell", () => {
    _processDeps.execFileSync = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("3\t1\ta.txt\n");

    expect(_internal.gitDiffStat(dir)).toEqual({
      filesChanged: 1,
      insertions: 3,
      deletions: 1,
    });
    for (const call of _processDeps.execFileSync.mock.calls) {
      expect(call[2]).toMatchObject({
        cwd: dir,
        origin: "batch:git-diff",
        policy: "allow",
        scope: "batch",
        shell: false,
      });
    }

    _processDeps.execFileSync.mockReset().mockReturnValue("");
    expect(_internal.gitCommitAll(dir, "batch: unit")).toBe(true);
    expect(_processDeps.execFileSync).toHaveBeenCalledTimes(2);
    for (const call of _processDeps.execFileSync.mock.calls) {
      expect(call[2]).toMatchObject({
        cwd: dir,
        origin: "batch:git-commit",
        policy: "allow",
        scope: "batch",
        shell: false,
      });
    }
  });
});
