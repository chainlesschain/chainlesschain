import { describe, expect, it } from "vitest";

import {
  MAX_CANDIDATES,
  MAX_PATHS,
  WorkspaceMentionIndex,
  relativeToRoots,
} from "../../../vscode-extension/src/chat/workspace-mention-index.js";
import {
  QUERY_COUNT,
  THRESHOLDS,
  measureVsCodeIndex,
} from "../../scripts/ide-input-performance-profile.mjs";

describe("WorkspaceMentionIndex", () => {
  it("is incremental, revisioned, bounded, and rejects denied/outside paths", () => {
    const index = new WorkspaceMentionIndex({
      roots: ["C:\\work"],
      trusted: true,
    });
    expect(index.upsertPath("C:\\work\\src\\app.ts")).toBe(true);
    const revision = index.snapshot().workspaceRevision;
    expect(index.upsertPath("C:\\work\\src\\next.ts")).toBe(true);
    expect(index.snapshot().workspaceRevision).toBe(revision + 1);
    expect(index.upsertPath("C:\\other\\secret.txt")).toBe(false);
    expect(index.upsertPath("C:\\work\\.git\\config")).toBe(false);
    expect(relativeToRoots("C:\\worktree\\secret", ["C:\\work"])).toBeNull();
    expect(relativeToRoots("/workspace/src/app.ts", ["/"])).toBe(
      "workspace/src/app.ts",
    );
    const ticket = index.beginQuery();
    const result = index.query(ticket, "src");
    expect(index.commit(ticket, result)).toBe(true);
    expect(result.items.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(JSON.stringify(result.items)).not.toContain("secret");
  });

  it("cancels earlier generations and commits only the last query", () => {
    const index = new WorkspaceMentionIndex({
      roots: ["/workspace"],
      trusted: true,
    });
    index.replacePaths(["/workspace/src/a.ts", "/workspace/src/b.ts"]);
    const first = index.beginQuery();
    const second = index.beginQuery();
    expect(index.query(first, "a").cancelled).toBe(true);
    const result = index.query(second, "b");
    expect(index.commit(second, result)).toBe(true);
    expect(index.snapshot().staleCommitCount).toBe(0);
  });

  it("rejects a result when the workspace revision changes before commit", () => {
    const index = new WorkspaceMentionIndex({
      roots: ["/workspace"],
      trusted: true,
    });
    index.replacePaths(["/workspace/src/a.ts"]);
    const ticket = index.beginQuery();
    const result = index.query(ticket, "a");
    index.touchWorkspace();
    expect(index.commit(ticket, result)).toBe(false);
    expect(index.snapshot().staleCommitCount).toBe(0);
  });

  it("does not expose workspace paths when trust is denied", () => {
    const index = new WorkspaceMentionIndex({
      roots: ["/workspace"],
      trusted: false,
    });
    expect(index.replacePaths(["/workspace/src/private.ts"])).toBe(0);
    const ticket = index.beginQuery();
    expect(index.query(ticket, "private").items).toEqual([]);
    expect(index.snapshot().contentReadCount).toBe(0);
  });
});

describe("IDE-INPUT-PERF product profile", () => {
  it("measures 100k paths and 20 queries within the required contract", async () => {
    const measurement = await measureVsCodeIndex();
    expect(measurement.pathCount).toBe(MAX_PATHS);
    expect(measurement.consecutiveQueries).toBe(QUERY_COUNT);
    expect(measurement.rapidQueries).toBe(QUERY_COUNT);
    expect(measurement.samplesMs).toHaveLength(QUERY_COUNT);
    expect(measurement.p95Ms).toBeLessThanOrEqual(THRESHOLDS.p95Ms);
    expect(measurement.maxCandidates).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(measurement.staleCommitCount).toBe(0);
    expect(measurement.cancellationCount).toBeGreaterThanOrEqual(19);
    expect(measurement.discardedQueryCount).toBeGreaterThanOrEqual(19);
    expect(measurement.deniedPathCount).toBeGreaterThanOrEqual(2);
    expect(measurement.leakCount).toBe(0);
    expect(measurement.contentReadCount).toBe(0);
  }, 30_000);
});
