import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  ARTIFACT_CLEANUP_EVENT_SCHEMA,
  ARTIFACT_CLEANUP_LEDGER_SCHEMA,
  ARTIFACT_CLEANUP_RECEIPT_SCHEMA,
  readArtifactCleanupLedger,
  settleArtifactCleanup,
} from "../../src/lib/artifact-cleanup-ledger.js";
import { readArtifactDeletionLedger } from "../../src/lib/artifact-deletion-ledger.js";

function overrideFs(overrides) {
  return new Proxy(fs, {
    get(target, property) {
      return Object.hasOwn(overrides, property)
        ? overrides[property]
        : target[property];
    },
  });
}

describe("artifact TTL cleanup settlement ledger", () => {
  let root;
  let now;
  let store;
  let expiredA;
  let expiredB;
  let live;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-artifact-cleanup-"));
    now = Date.UTC(2026, 7, 1, 0, 0, 0);
    store = new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    });
    expiredA = store.publishData({
      data: "expired-a-secret",
      fileName: "expired-a.txt",
      sessionId: "cleanup-session",
      ttlDays: 1,
      immutable: true,
      recordDigest: `sha256:${"a".repeat(64)}`,
    });
    expiredB = store.publishData({
      data: "expired-b-secret",
      fileName: "expired-b.txt",
      ttlDays: 1,
    });
    live = store.publishData({
      data: "live-secret",
      fileName: "live.txt",
      ttlDays: 30,
    });
    now = Date.UTC(2026, 7, 3, 0, 0, 0);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function settle(overrides = {}, options = {}) {
    return settleArtifactCleanup(
      store,
      {
        cleanupId: "cleanup-request-1",
        client: "cli",
        ...overrides,
      },
      { now: () => now, ...options },
    );
  }

  it("freezes and settles a content-free batch through per-item deletions", () => {
    const expiredPaths = [
      store.storedPath(expiredA),
      store.storedPath(expiredB),
    ];
    const result = settle();

    expect(result).toMatchObject({
      schema: ARTIFACT_CLEANUP_RECEIPT_SCHEMA,
      cleanupId: "cleanup-request-1",
      client: "cli",
      selected: 2,
      removed: 2,
      removedNow: 2,
      alreadyAbsent: 0,
      settled: true,
      preparedRecorded: true,
      recorded: true,
      cleanup: {
        schema: ARTIFACT_CLEANUP_EVENT_SCHEMA,
        phase: "terminal",
        itemCount: 2,
      },
    });
    expect(store.list().map((entry) => entry.id)).toEqual([live.id]);
    expect(expiredPaths.every((file) => !fs.existsSync(file))).toBe(true);

    const ledger = readArtifactCleanupLedger(store);
    expect(ledger).toMatchObject({
      schema: ARTIFACT_CLEANUP_LEDGER_SCHEMA,
      eventCount: 2,
      preparedCount: 1,
      terminalCount: 1,
      pendingCount: 0,
      headDigest: result.cleanup.eventDigest,
    });
    expect(ledger.events.map((event) => event.phase)).toEqual([
      "prepared",
      "terminal",
    ]);
    expect(readArtifactDeletionLedger(store)).toMatchObject({
      eventCount: 4,
      preparedCount: 2,
      terminalCount: 2,
    });
    const serialized = JSON.stringify({ result, ledger });
    expect(serialized).not.toContain("expired-a-secret");
    expect(serialized).not.toContain("expired-b-secret");
    expect(serialized).not.toContain(root);
  });

  it("returns the same terminal batch on retry and rejects id collision", () => {
    const first = settle();
    const retry = settle();

    expect(retry.recorded).toBe(false);
    expect(retry.preparedRecorded).toBe(false);
    expect(retry.cleanup).toEqual(first.cleanup);
    expect(retry.items).toEqual(first.items);
    expect(readArtifactCleanupLedger(store).eventCount).toBe(2);
    expect(() => settle({ client: "websocket" })).toThrow(
      /already bound to other inputs/u,
    );
  });

  it("settles an empty frozen scope instead of silently returning a count", () => {
    now = Date.UTC(2026, 7, 1, 0, 0, 1);
    const result = settle();

    expect(result).toMatchObject({
      selected: 0,
      removed: 0,
      settled: true,
      recorded: true,
      items: [],
    });
    expect(readArtifactCleanupLedger(store)).toMatchObject({
      eventCount: 2,
      pendingCount: 0,
    });
  });

  it("recovers a partial batch without re-deleting its settled first item", () => {
    let crashed = false;
    expect(() =>
      settle(
        {},
        {
          afterItem({ index }) {
            if (index === 0 && !crashed) {
              crashed = true;
              throw new Error("injected crash after first item");
            }
          },
        },
      ),
    ).toThrow(/injected crash after first item/u);

    expect(readArtifactCleanupLedger(store)).toMatchObject({
      eventCount: 1,
      pendingCount: 1,
    });
    expect(readArtifactDeletionLedger(store)).toMatchObject({
      eventCount: 2,
      terminalCount: 1,
    });

    const recovered = settle();
    expect(recovered).toMatchObject({
      selected: 2,
      removed: 2,
      settled: true,
      recorded: true,
    });
    expect(readArtifactDeletionLedger(store)).toMatchObject({
      eventCount: 4,
      terminalCount: 2,
    });
  });

  it("keeps the original scope frozen when a later artifact expires", () => {
    expect(() =>
      settle(
        {},
        {
          afterItem({ index }) {
            if (index === 0) throw new Error("stop after frozen selection");
          },
        },
      ),
    ).toThrow(/stop after frozen selection/u);

    const later = store.publishData({
      data: "later-expired",
      fileName: "later.txt",
      ttlDays: 1,
    });
    now = Date.UTC(2026, 7, 5, 0, 0, 0);

    const recovered = settle();
    expect(recovered.selected).toBe(2);
    expect(store.get(later.id)).not.toBeNull();
    expect(fs.existsSync(store.storedPath(later))).toBe(true);
  });

  it("recovers when the batch terminal append was lost after all deletions", () => {
    let writeCount = 0;
    const failingFs = overrideFs({
      writeFileSync(...args) {
        writeCount += 1;
        if (writeCount === 2) {
          throw new Error("injected cleanup terminal append loss");
        }
        return fs.writeFileSync(...args);
      },
    });

    let failure;
    try {
      settle({}, { fs: failingFs });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      cleanupId: "cleanup-request-1",
      cleanup: { selected: 2, settled: 2, pending: 0 },
    });
    expect(failure.message).toMatch(/injected cleanup terminal append loss/u);
    expect(store.list().map((entry) => entry.id)).toEqual([live.id]);
    expect(readArtifactCleanupLedger(store)).toMatchObject({
      eventCount: 1,
      pendingCount: 1,
    });

    const recovered = settle();
    expect(recovered.recorded).toBe(true);
    expect(recovered.items.every((item) => item.managedCopyDisposition)).toBe(
      true,
    );
    expect(readArtifactCleanupLedger(store).terminalCount).toBe(1);
  });

  it("blocks overlapping cleanup ids while the first frozen batch is pending", () => {
    expect(() =>
      settle(
        {},
        {
          settleArtifactDeletion() {
            throw new Error("injected pre-item crash");
          },
        },
      ),
    ).toThrow(/injected pre-item crash/u);

    expect(() => settle({ cleanupId: "cleanup-request-2" })).toThrow(
      /overlaps a pending batch/u,
    );
    expect(store.list()).toHaveLength(3);
  });

  it("fails closed on ledger tamper, truncation, and settled-path reappearance", () => {
    settle();
    const ledgerPath = path.join(store.dir, "cleanup-settlements.jsonl");
    const original = fs.readFileSync(ledgerPath, "utf8");
    fs.writeFileSync(
      ledgerPath,
      original.replace('"client":"cli"', '"client":"websocket"'),
      "utf8",
    );
    expect(() => readArtifactCleanupLedger(store)).toThrow(
      /digest is invalid/u,
    );

    fs.writeFileSync(ledgerPath, original.slice(0, -1), "utf8");
    expect(() => readArtifactCleanupLedger(store)).toThrow(/truncated tail/u);

    fs.writeFileSync(ledgerPath, original, "utf8");
    fs.writeFileSync(store.storedPath(expiredA), "reappeared", "utf8");
    expect(() => settle()).toThrow(/managed path reappeared/u);
    expect(fs.readFileSync(store.storedPath(expiredA), "utf8")).toBe(
      "reappeared",
    );
  });
});
