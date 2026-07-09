import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runBatchCommand } from "../../src/commands/batch.js";

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
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const io = () => ({
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    repoDir: dir,
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
});
