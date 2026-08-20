import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  ARTIFACT_DELETION_EVENT_SCHEMA,
  ARTIFACT_DELETION_LEDGER_SCHEMA,
  ARTIFACT_DELETION_RECEIPT_SCHEMA,
  readArtifactDeletionLedger,
  settleArtifactDeletion,
} from "../../src/lib/artifact-deletion-ledger.js";

function overrideFs(overrides) {
  return new Proxy(fs, {
    get(target, property) {
      return Object.hasOwn(overrides, property)
        ? overrides[property]
        : target[property];
    },
  });
}

describe("artifact deletion settlement ledger", () => {
  let root;
  let store;
  let entry;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-artifact-delete-"));
    store = new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => Date.UTC(2026, 7, 19, 0, 0, 0),
    });
    entry = store.publishData({
      data: "managed deletion bytes",
      fileName: "result.txt",
      sessionId: "delete-session",
      immutable: true,
      recordDigest: `sha256:${"2".repeat(64)}`,
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function settle(overrides = {}, options = {}) {
    return settleArtifactDeletion(
      store,
      {
        deletionId: "delete-request-1",
        artifactId: entry.id,
        reason: "explicit",
        client: "cli",
        ...overrides,
      },
      { now: () => Date.UTC(2026, 7, 19, 0, 30, 0), ...options },
    );
  }

  it("prepares and settles a content-free managed-copy removal", () => {
    const storedPath = store.storedPath(entry);
    const result = settle();

    expect(result).toMatchObject({
      schema: ARTIFACT_DELETION_RECEIPT_SCHEMA,
      deletionId: "delete-request-1",
      artifactId: entry.id,
      found: true,
      settled: true,
      recorded: true,
      deletion: {
        schema: ARTIFACT_DELETION_EVENT_SCHEMA,
        phase: "terminal",
        artifactId: entry.id,
        artifactSha256: `sha256:${entry.sha256}`,
        recordDigest: entry.recordDigest,
        artifactSessionId: "delete-session",
        client: "cli",
        reason: "explicit",
        managedCopyDisposition: "removed",
      },
    });
    expect(store.list()).toEqual([]);
    expect(fs.existsSync(storedPath)).toBe(false);

    const ledger = readArtifactDeletionLedger(store);
    expect(ledger).toMatchObject({
      schema: ARTIFACT_DELETION_LEDGER_SCHEMA,
      eventCount: 2,
      preparedCount: 1,
      terminalCount: 1,
      headDigest: result.deletion.eventDigest,
    });
    expect(ledger.events.map((event) => event.phase)).toEqual([
      "prepared",
      "terminal",
    ]);
    expect(JSON.stringify(ledger)).not.toContain("managed deletion bytes");
    expect(JSON.stringify(ledger)).not.toContain(root);
  });

  it("returns the same terminal receipt on retry and rejects id collision", () => {
    const first = settle();
    const retry = settle();

    expect(retry.recorded).toBe(false);
    expect(retry.deletion).toEqual(first.deletion);
    expect(readArtifactDeletionLedger(store).eventCount).toBe(2);
    expect(() => settle({ client: "vscode" })).toThrow(
      /already bound to other inputs/u,
    );
  });

  it("settles Desktop product deletion with the same durable protocol", () => {
    const result = settle({
      deletionId: "delete-desktop-1",
      client: "desktop",
    });

    expect(result).toMatchObject({
      deletionId: "delete-desktop-1",
      settled: true,
      deletion: { client: "desktop", artifactId: entry.id },
    });
  });

  it("recovers a prepared deletion after managed-copy removal failed", () => {
    const storedPath = store.storedPath(entry);
    const failingFs = overrideFs({
      rmSync() {
        throw new Error("injected managed-copy removal failure");
      },
    });

    expect(() => settle({}, { fs: failingFs })).toThrow(
      /injected managed-copy removal failure/u,
    );
    expect(store.list()).toEqual([]);
    expect(fs.existsSync(storedPath)).toBe(true);
    expect(readArtifactDeletionLedger(store)).toMatchObject({
      eventCount: 1,
      preparedCount: 1,
      terminalCount: 0,
    });

    const recovered = settle();
    expect(recovered.deletion.managedCopyDisposition).toBe("removed");
    expect(fs.existsSync(storedPath)).toBe(false);
    expect(readArtifactDeletionLedger(store).terminalCount).toBe(1);
  });

  it("recovers when terminal append was lost after index and copy removal", () => {
    const storedPath = store.storedPath(entry);
    let writeCount = 0;
    const failingFs = overrideFs({
      writeFileSync(...args) {
        writeCount += 1;
        if (writeCount === 2) {
          throw new Error("injected terminal append loss");
        }
        return fs.writeFileSync(...args);
      },
    });

    expect(() => settle({}, { fs: failingFs })).toThrow(
      /injected terminal append loss/u,
    );
    expect(store.list()).toEqual([]);
    expect(fs.existsSync(storedPath)).toBe(false);
    expect(readArtifactDeletionLedger(store).eventCount).toBe(1);

    const recovered = settle();
    expect(recovered.deletion.managedCopyDisposition).toBe("already-absent");
    expect(readArtifactDeletionLedger(store).terminalCount).toBe(1);
  });

  it("fails closed on ledger tamper and a truncated tail", () => {
    settle();
    const ledgerPath = path.join(store.dir, "deletion-settlements.jsonl");
    const original = fs.readFileSync(ledgerPath, "utf8");
    fs.writeFileSync(
      ledgerPath,
      original.replace('"client":"cli"', '"client":"vscode"'),
      "utf8",
    );
    expect(() => readArtifactDeletionLedger(store)).toThrow(
      /digest is invalid/u,
    );

    fs.writeFileSync(ledgerPath, original.slice(0, -1), "utf8");
    expect(() => readArtifactDeletionLedger(store)).toThrow(/truncated tail/u);
  });

  it("refuses ambiguous rows before preparation without deleting a copy", () => {
    const storedPath = store.storedPath(entry);
    fs.appendFileSync(
      path.join(store.dir, "index.jsonl"),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );

    expect(() => settle()).toThrow(/ambiguous for deletion/u);
    expect(fs.existsSync(storedPath)).toBe(true);
    expect(readArtifactDeletionLedger(store).eventCount).toBe(0);
  });

  it("audits only managed-link removal when another hardlink retains bytes", () => {
    const storedPath = store.storedPath(entry);
    const externalLink = path.join(root, "external-link.txt");
    fs.chmodSync(storedPath, 0o600);
    fs.linkSync(storedPath, externalLink);

    const result = settle();
    expect(result.deletion.managedCopyDisposition).toBe("removed");
    expect(fs.existsSync(storedPath)).toBe(false);
    expect(fs.readFileSync(externalLink, "utf8")).toBe(
      "managed deletion bytes",
    );
  });

  it("fails a settled retry if the managed path reappears without deleting it", () => {
    const storedPath = store.storedPath(entry);
    settle();
    fs.writeFileSync(storedPath, "reappeared", "utf8");

    expect(() => settle()).toThrow(/reappeared after settlement/u);
    expect(fs.readFileSync(storedPath, "utf8")).toBe("reappeared");
  });

  it("holds the index lock while it appends preparation and terminal events", () => {
    let indexLockDepth = 0;
    const lockedStore = new ArtifactStore({
      dir: path.join(root, "locked-artifacts"),
      indexLock: (_target, callback, options) => {
        expect(indexLockDepth).toBe(0);
        expect(options).toMatchObject({ failIfUnavailable: true });
        indexLockDepth += 1;
        try {
          return callback({ locked: true });
        } finally {
          indexLockDepth -= 1;
        }
      },
    });
    const lockedEntry = lockedStore.publishData({
      data: "locked deletion",
      fileName: "locked.txt",
    });

    const result = settleArtifactDeletion(
      lockedStore,
      {
        deletionId: "locked-deletion",
        artifactId: lockedEntry.id,
        client: "cli",
        reason: "explicit",
      },
      {
        withFileLock: (_target, callback, options) => {
          expect(indexLockDepth).toBe(1);
          expect(options).toMatchObject({ failIfUnavailable: true });
          return callback({ locked: true });
        },
      },
    );

    expect(result.settled).toBe(true);
    expect(indexLockDepth).toBe(0);
  });
});
