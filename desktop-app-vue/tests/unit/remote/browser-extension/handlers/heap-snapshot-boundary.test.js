import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEAP_SNAPSHOT_LIMITS,
  HARD_HEAP_SNAPSHOT_LIMITS,
  HeapSnapshotBoundary,
  utf8ByteLength,
} from "../../../../../src/main/remote/browser-extension/handlers/heap-snapshot-boundary.js";

function rememberSnapshot(boundary, tabId, size = 1) {
  const admission = boundary.admit(tabId);
  expect(admission.accepted).toBe(true);
  const snapshot = boundary.remember(admission.lease, {
    size,
    chunkCount: 1,
  });
  expect(boundary.release(admission.lease)).toBe(true);
  return snapshot;
}

describe("HeapSnapshotBoundary", () => {
  it("uses finite defaults and clamps caller configuration to hard limits", () => {
    expect(new HeapSnapshotBoundary().getStats().limits).toEqual(
      DEFAULT_HEAP_SNAPSHOT_LIMITS,
    );

    const boundary = new HeapSnapshotBoundary({
      maxActiveSnapshots: Number.MAX_SAFE_INTEGER,
      maxRetainedSnapshots: Number.MAX_SAFE_INTEGER,
      retentionMs: Number.MAX_SAFE_INTEGER,
    });
    expect(boundary.getStats().limits).toEqual(HARD_HEAP_SNAPSHOT_LIMITS);

    const invalid = new HeapSnapshotBoundary({
      maxActiveSnapshots: Symbol("invalid"),
      maxRetainedSnapshots: 0,
      retentionMs: Number.NaN,
    });
    expect(invalid.getStats().limits).toEqual(DEFAULT_HEAP_SNAPSHOT_LIMITS);
  });

  it("counts UTF-8 bytes without allocating a retained encoded body", () => {
    expect(utf8ByteLength("ascii")).toBe(5);
    expect(utf8ByteLength("测试")).toBe(6);
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("\ud800")).toBe(3);
    expect(utf8ByteLength(null)).toBe(0);
  });

  it("holds global and per-tab admission until the physical lease is released", () => {
    const boundary = new HeapSnapshotBoundary({ maxActiveSnapshots: 1 });
    const first = boundary.admit(7);
    expect(first.accepted).toBe(true);

    expect(boundary.admit(7)).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "heap_snapshot_tab",
      retryAfterMs: 1000,
    });
    expect(boundary.admit(8)).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "heap_snapshots",
      retryAfterMs: 1000,
    });

    expect(boundary.release(first.lease)).toBe(true);
    expect(boundary.release(first.lease)).toBe(false);
    const replacement = boundary.admit(8);
    expect(replacement.accepted).toBe(true);
    expect(boundary.release(replacement.lease)).toBe(true);
  });

  it("rejects a stale lease instead of recording phantom success metadata", () => {
    const boundary = new HeapSnapshotBoundary();
    const admission = boundary.admit(undefined);
    expect(admission.accepted).toBe(true);
    expect(boundary.release(admission.lease)).toBe(true);

    let staleError;
    try {
      boundary.remember(admission.lease, { size: 10, chunkCount: 1 });
    } catch (error) {
      staleError = error;
    }
    expect(staleError).toMatchObject({
      code: "STALE_HEAP_SNAPSHOT_LEASE",
    });
    expect(boundary.getStats().retainedSnapshots).toBe(0);
  });

  it("evicts oldest metadata by count and prunes it after retention", () => {
    let now = 100;
    const boundary = new HeapSnapshotBoundary({
      maxRetainedSnapshots: 2,
      retentionMs: 10,
      now: () => now,
    });

    const first = rememberSnapshot(boundary, 1);
    now = 105;
    const second = rememberSnapshot(boundary, 2);
    now = 106;
    const third = rememberSnapshot(boundary, 3);

    expect(boundary.getSnapshot(first.snapshotId)).toBeNull();
    expect(boundary.getSnapshot(second.snapshotId)).toMatchObject({ tabId: 2 });
    expect(boundary.getSnapshot(third.snapshotId)).toMatchObject({ tabId: 3 });
    expect(boundary.getStats().retainedSnapshots).toBe(2);

    now = 117;
    expect(boundary.getStats().retainedSnapshots).toBe(0);
  });
});
