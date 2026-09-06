import { describe, it, expect } from "vitest";
import { ReadFileLoopGuard } from "../../src/lib/read-file-loop-guard.js";

const page = (overrides = {}) => ({
  path: "/work/report.md",
  fileVersion: "100:1:1",
  range: { startLine: 1, endLine: 10, totalLines: 100 },
  nextRead: { offset: 11 },
  content: "same page",
  ...overrides,
});
const batch = (guard, results) => {
  guard.startBatch(results.length);
  for (const result of results) guard.record("read_file", result);
  guard.finishBatch();
};

describe("ReadFileLoopGuard", () => {
  it("offers recovery before stopping repeated reads, independent of compacted history", () => {
    const guard = new ReadFileLoopGuard();
    batch(guard, [page()]);
    batch(guard, [page()]);
    expect(guard.recoveryHint).toBeNull();
    batch(guard, [page()]);
    expect(guard.recoveryHint).toContain("nextRead");
    expect(guard.stalled).toBe(false);
    batch(guard, [page()]);
    expect(guard.stalled).toBe(true);
    // A new run can intentionally revisit the same content.
    const resumed = new ReadFileLoopGuard();
    batch(resumed, [page()]);
    expect(resumed.repeatedBatches).toBe(0);
  });

  it("allows new pages, changed files and normal work to recover", () => {
    for (const progress of [
      page({ range: { startLine: 11, endLine: 20, totalLines: 100 } }),
      page({ fileVersion: "100:2:2" }),
      page({ content: "changed" }),
      page({ hashed: true }),
      page({ notebook: true }),
      page({ nextRead: { offset: 11, column: 200 } }),
    ]) {
      const guard = new ReadFileLoopGuard();
      batch(guard, [page()]);
      batch(guard, [page()]);
      batch(guard, [page()]);
      batch(guard, [progress]);
      expect(guard.repeatedBatches).toBe(0);
    }
    const guard = new ReadFileLoopGuard();
    batch(guard, [page()]);
    batch(guard, [page()]);
    guard.startBatch(2);
    guard.record("read_file", page());
    guard.record("search_files", { matches: [] });
    guard.finishBatch();
    expect(guard.repeatedBatches).toBe(0);
  });

  it("detects alternating pages and parallel duplicate batches", () => {
    const guard = new ReadFileLoopGuard();
    const other = page({ path: "/work/other.md" });
    batch(guard, [page(), other]);
    batch(guard, [other, page()]);
    batch(guard, [page(), other]);
    batch(guard, [other]);
    expect(guard.stalled).toBe(true);
  });

  it("recognizes full-file reads with equivalent explicit ranges", () => {
    const guard = new ReadFileLoopGuard();
    batch(guard, [page({ range: undefined, nextRead: undefined })]);
    batch(guard, [
      page({
        range: { startLine: 1, endLine: 1, totalLines: 1 },
        nextRead: undefined,
      }),
    ]);
    expect(guard.repeatedBatches).toBe(1);
  });

  it("does not classify failed or unversioned reads as unchanged pages", () => {
    const guard = new ReadFileLoopGuard();
    for (let i = 0; i < 8; i++) batch(guard, [page({ error: "denied" })]);
    for (let i = 0; i < 8; i++)
      batch(guard, [page({ fileVersion: undefined })]);
    expect(guard.stalled).toBe(false);
    expect(guard.seen.size).toBe(0);
  });
});
