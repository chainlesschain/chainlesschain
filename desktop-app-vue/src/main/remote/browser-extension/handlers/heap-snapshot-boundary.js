export const DEFAULT_HEAP_SNAPSHOT_LIMITS = Object.freeze({
  maxActiveSnapshots: 2,
  maxRetainedSnapshots: 32,
  retentionMs: 5 * 60 * 1000,
});

export const HARD_HEAP_SNAPSHOT_LIMITS = Object.freeze({
  maxActiveSnapshots: 16,
  maxRetainedSnapshots: 256,
  retentionMs: 30 * 60 * 1000,
});

const RETRY_AFTER_MS = 1000;

function normalizeLimit(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

export function utf8ByteLength(value) {
  if (typeof value !== "string") {
    return 0;
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function createOverloadResult(scope, limits) {
  const sameTab = scope === "heap_snapshot_tab";
  return {
    accepted: false,
    error: sameTab
      ? "A heap snapshot is already running for this tab"
      : "Heap snapshot capacity exceeded",
    code: "OVERLOADED",
    scope,
    retryAfterMs: RETRY_AFTER_MS,
    limit: {
      maxActiveSnapshots: limits.maxActiveSnapshots,
      maxActiveSnapshotsPerTab: 1,
    },
  };
}

/**
 * Bounds heap-snapshot admission and metadata retention without retaining the
 * snapshot body. A lease is released only by the caller after the physical CDP
 * command settles.
 */
export class HeapSnapshotBoundary {
  constructor(options = {}) {
    this.limits = Object.freeze({
      maxActiveSnapshots: normalizeLimit(
        options.maxActiveSnapshots,
        DEFAULT_HEAP_SNAPSHOT_LIMITS.maxActiveSnapshots,
        HARD_HEAP_SNAPSHOT_LIMITS.maxActiveSnapshots,
      ),
      maxRetainedSnapshots: normalizeLimit(
        options.maxRetainedSnapshots,
        DEFAULT_HEAP_SNAPSHOT_LIMITS.maxRetainedSnapshots,
        HARD_HEAP_SNAPSHOT_LIMITS.maxRetainedSnapshots,
      ),
      retentionMs: normalizeLimit(
        options.retentionMs,
        DEFAULT_HEAP_SNAPSHOT_LIMITS.retentionMs,
        HARD_HEAP_SNAPSHOT_LIMITS.retentionMs,
      ),
    });
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.activeLeases = new Map();
    this.activeTabs = new Map();
    this.retainedSnapshots = new Map();
    this.snapshotSequence = 0;
  }

  admit(tabId) {
    this.pruneExpired();
    if (this.activeTabs.has(tabId)) {
      return createOverloadResult("heap_snapshot_tab", this.limits);
    }
    if (this.activeLeases.size >= this.limits.maxActiveSnapshots) {
      return createOverloadResult("heap_snapshots", this.limits);
    }

    const lease = Object.freeze({
      id: Symbol("heap-snapshot-lease"),
      tabId,
    });
    this.activeLeases.set(lease, tabId);
    this.activeTabs.set(tabId, lease);
    return { accepted: true, lease };
  }

  release(lease) {
    if (!this.activeLeases.has(lease)) {
      return false;
    }
    const tabId = this.activeLeases.get(lease);

    this.activeLeases.delete(lease);
    if (this.activeTabs.get(tabId) === lease) {
      this.activeTabs.delete(tabId);
    }
    return true;
  }

  remember(lease, { size, chunkCount }) {
    if (!this.activeLeases.has(lease)) {
      const error = new Error("Heap snapshot lease is no longer active");
      error.code = "STALE_HEAP_SNAPSHOT_LEASE";
      throw error;
    }
    const tabId = this.activeLeases.get(lease);

    const timestamp = this.now();
    this.pruneExpired(timestamp);
    while (this.retainedSnapshots.size >= this.limits.maxRetainedSnapshots) {
      const oldestId = this.retainedSnapshots.keys().next().value;
      this.retainedSnapshots.delete(oldestId);
    }

    this.snapshotSequence += 1;
    const snapshotId = `snapshot-${timestamp}-${this.snapshotSequence}`;
    const metadata = Object.freeze({
      snapshotId,
      tabId,
      size,
      chunkCount,
      timestamp,
    });
    this.retainedSnapshots.set(snapshotId, metadata);
    return metadata;
  }

  getSnapshot(snapshotId) {
    this.pruneExpired();
    return this.retainedSnapshots.get(snapshotId) || null;
  }

  getStats() {
    this.pruneExpired();
    return {
      activeSnapshots: this.activeLeases.size,
      retainedSnapshots: this.retainedSnapshots.size,
      limits: this.limits,
    };
  }

  pruneExpired(now = this.now()) {
    const expiresBefore = now - this.limits.retentionMs;
    for (const [snapshotId, snapshot] of this.retainedSnapshots) {
      if (snapshot.timestamp <= expiresBefore) {
        this.retainedSnapshots.delete(snapshotId);
      }
    }
  }
}
