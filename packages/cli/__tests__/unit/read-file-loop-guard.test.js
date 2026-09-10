import { describe, it, expect } from "vitest";
import { ReadFileLoopGuard } from "../../src/lib/read-file-loop-guard.js";
import {
  buildReadFilePage,
  buildReadFileOutline,
} from "../../src/lib/read-file-page.js";

const document = Array.from(
  { length: 40 },
  (_, i) => `line ${i + 1}: ${"x".repeat(50)}`,
).join("\n");
function fixture() {
  const guard = new ReadFileLoopGuard();
  const read = (args = {}, content = document, version = "v1") => {
    const request = { path: "/work/report.md", ...args };
    const info = {
      filePath: request.path,
      fileVersion: version,
      maxChars: 2600,
    };
    const page = (options) => buildReadFilePage(content, options, info);
    return guard.read(request, info, page, (charOffset) => {
      const prefix = content.slice(0, charOffset);
      return page({
        ...request,
        offset: (prefix.match(/\n/g) || []).length + 1,
        column: charOffset - prefix.lastIndexOf("\n"),
        limit: 2000,
      });
    });
  };
  const batch = (args, content, version, discovery = false) => {
    guard.startBatch();
    const result = read(args, content, version);
    guard.record("read_file", result);
    if (discovery) guard.record("search_files", { matches: [] });
    guard.finishBatch();
    return result;
  };
  return { guard, read, batch };
}

describe("ReadFileLoopGuard recovery", () => {
  it("admits a small missing detail during task recovery but bounds the allowance", () => {
    const { guard, batch } = fixture();
    const content = "one\ntwo\nthree\nfour";
    batch({}, content);
    const file = "/work/report.md";
    expect(guard.hasRecoveryReads).toBe(true);
    expect(guard.canContinue(file, { offset: 1, limit: 2 })).toBe(true);
    expect(guard.canContinue(file, {})).toBe(false);
    expect(guard.canContinue(file, { offset: 1, limit: 200 })).toBe(false);
    for (let limit = 1; limit <= 3; limit++)
      batch({ offset: 1, limit }, content);
    expect(guard.canContinue(file, { offset: 2, limit: 1 })).toBe(false);
  });
  it("varying a covered range does not reset duplicate recovery", () => {
    const { guard, batch } = fixture();
    const content = "one\ntwo\nthree\nfour\nfive";
    batch({}, content);
    for (let limit = 1; limit <= 4; limit++)
      batch({ offset: 1, limit }, content);
    expect(guard.repeatedBatches).toBe(4);
    expect(guard.takeRecoveryTurn()).toBe(true);
  });
  it.each(["todo_write", "spawn_sub_agent", "notify", "tool_search"])(
    "%s cannot erase repeated reads or reopen targeted reread allowances",
    (tool) => {
      const { guard, batch } = fixture();
      batch({}, "small");
      for (let i = 0; i < 6; i++) {
        batch({}, "small");
        guard.startBatch();
        guard.record(tool, { success: true });
        guard.finishBatch();
      }
      expect(guard.repeatedBatches).toBe(6);
      expect(guard.stalled).toBe(true);
    },
  );

  it("failed and already-applied edits do not clear a read loop", () => {
    const { guard, batch } = fixture();
    batch({}, "small");
    batch({}, "small");
    for (const result of [
      { success: false },
      { success: true, alreadyApplied: true },
      { success: true, changed: false },
    ]) {
      guard.startBatch();
      guard.record("edit_file", result);
      guard.finishBatch();
      expect(guard.repeatedBatches).toBe(1);
    }
  });

  it("detects repeated large dumps across code/shell and timing changes", () => {
    const guard = new ReadFileLoopGuard();
    const output = "same document\n".repeat(1000);
    const batch = (tool, result) => {
      guard.startBatch();
      guard.record(tool, result);
      guard.finishBatch();
    };
    batch("run_code", { output });
    for (let i = 0; i < 6; i++) {
      batch(i % 2 ? "run_shell" : "run_code", { output, duration: `${i}ms` });
      batch("search_files", { matches: [] });
    }
    expect(guard.stalled).toBe(true);
    expect(guard.recoveryHint).toMatch(/filter\/count/i);
    expect(guard.takeRecoveryTurn()).toBe(true);
    batch("run_code", { output: output + "new section" });
    expect(guard.stalled).toBe(false);
    batch("write_file", { success: true });
    batch("run_code", { output });
    expect(guard.repeatedBatches).toBe(0);
    expect(guard.largeOutputs.size).toBe(1);
  });

  it("does not penalize small computed summaries or distinct large pages", () => {
    const guard = new ReadFileLoopGuard();
    for (let i = 0; i < 70; i++) {
      guard.startBatch();
      guard.record("run_code", { output: `page ${i}: ${"x".repeat(9000)}` });
      guard.finishBatch();
    }
    expect(guard.largeOutputs.size).toBe(64);
    for (let i = 0; i < 8; i++) {
      guard.startBatch();
      guard.record("run_code", { output: "6 remaining" });
      guard.finishBatch();
    }
    expect(guard.stalled).toBe(false);
  });

  it("automatically reaches EOF for identical broad requests without repeated content", () => {
    const { guard, batch } = fixture();
    let end = 0;
    let pages = 0;
    while (end < document.length) {
      const result = batch({});
      expect(result.readSpan.start).toBe(end);
      expect(result.readSpan.end).toBeGreaterThan(end);
      end = result.readSpan.end;
      expect(++pages).toBeLessThan(15);
    }
    const eof = batch({});
    expect(eof).toMatchObject({
      alreadyRead: true,
      reachedEnd: true,
      readRecovery: { action: "use-findings" },
    });
    expect(eof.content).toBeUndefined();
    expect(guard.stalled).toBe(false);
  });

  it("allows distinct targeted reviews but recovers repeated bounded reads", () => {
    const { batch } = fixture();
    const first = batch({ offset: 1, limit: 5 });
    expect(batch({ offset: 1, limit: 5 }).content).toBe(first.content);
    // A different already-covered window may be needed for an edit.
    batch({ offset: 2, limit: 2 });
    expect(batch({ offset: 3, limit: 1 }).readRecovery.action).toBe(
      "targeted-review",
    );
    const resumed = batch({ offset: 2, limit: 2 });
    expect(resumed.readRecovery.action).toBe("continued");
    expect(resumed.readSpan.start).toBe(first.readSpan.end);
  });

  it("does not mistake tail coverage for a full read and fills the missing prefix", () => {
    const { guard, batch } = fixture();
    batch({ offset: 40, limit: 1 });
    expect(guard.progressHint).toContain('"reachedEnd":false');
    const prefix = batch({});
    expect(prefix.readSpan.start).toBe(0);
    expect(guard.progressHint).toContain('"reachedEnd":false');
    const next = batch({});
    expect(next.readSpan.start).toBe(prefix.readSpan.end);
  });

  it("keeps notebook/raw and hashed renderings independent and resets after edits", () => {
    const { batch } = fixture();
    const first = batch({});
    expect(batch({ raw: true }).readSpan.start).toBe(0);
    expect(batch({ hashed: true }).readSpan.start).toBe(0);
    const edited = batch({}, "changed\n" + document, "v2");
    expect(edited.readSpan.start).toBe(0);
    expect(edited.content).toContain("changed");
    expect(edited.readProgress.newContent).toBe(true);
    expect(first.fileVersion).not.toBe(edited.fileVersion);
  });

  it("keeps long-line column progress and Unicode intact", () => {
    const { batch } = fixture();
    const content = "汉😀字".repeat(1000);
    let restored = "";
    while (restored.length < content.length) {
      const page = batch({}, content);
      expect(page.readSpan.start).toBe(restored.length);
      restored += page.content;
    }
    expect(restored).toBe(content);
    expect(batch({}, content).reachedEnd).toBe(true);
  });

  it("discovery cannot clear stalled reading; successful work can", () => {
    const { guard, batch } = fixture();
    batch({}, "small");
    batch({}, "small", "v1", true);
    guard.startBatch();
    guard.record("search_files", { matches: [] });
    guard.finishBatch();
    expect(guard.repeatedBatches).toBe(1);
    for (let i = 0; i < 5; i++) batch({}, "small", "v1", true);
    expect(guard.stalled).toBe(true);
    guard.startBatch();
    guard.record("write_file", { success: true });
    guard.record("read_file", { readProgress: { newContent: false } });
    guard.finishBatch();
    expect(guard.stalled).toBe(false);
  });

  it("bounds navigation excerpts and samples markers from the file tail", () => {
    const content = Array.from(
      { length: 300 },
      (_, i) => `# Heading ${i}\n- [ ] TODO ${i}: ${"detail ".repeat(60)}`,
    ).join("\n");
    const outline = buildReadFileOutline(content);
    expect(JSON.stringify(outline).length).toBeLessThanOrEqual(6000);
    expect(outline.totalMarkers).toBe(300);
    expect(outline.markers.at(-1).text).toContain("TODO 299");
    const page = buildReadFilePage(
      content,
      { path: "notes.md" },
      { filePath: "/notes.md", fileVersion: "v1", maxChars: 50000, outline },
    );
    expect(JSON.stringify(page).length).toBeLessThan(50000);
  });
});
