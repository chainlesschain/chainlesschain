import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PLUGIN_TRANSACTION_JOURNAL_FILENAME,
  PLUGIN_TRANSACTION_JOURNAL_SCHEMA,
  PLUGIN_TRANSACTION_LOCK_DIRNAME,
  PLUGIN_TRANSACTION_OWNER_FILENAME,
  _deps,
  acquirePluginTransactionLock,
  assertPluginTransactionLock,
  claimPluginTransactionRecovery,
  inspectPluginTransactionLock,
  releasePluginTransactionLock,
  updatePluginTransactionJournal,
} from "../../src/lib/plugin-runtime/transaction-journal.js";

let root;
let nameDir;
let savedIsProcessAlive;

function acquire(operation = "install") {
  return acquirePluginTransactionLock({
    name: "durable-plugin",
    scope: "project",
    nameDir,
    operation,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-journal-"));
  nameDir = path.join(root, ".chainlesschain", "plugins", "durable-plugin");
  savedIsProcessAlive = _deps.isProcessAlive;
});

afterEach(() => {
  _deps.isProcessAlive = savedIsProcessAlive;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("plugin lifecycle transaction journal", () => {
  it("publishes one exclusive owner and a digest-chained durable journal", () => {
    const lock = acquire();
    expect(lock.journal).toMatchObject({
      schemaVersion: PLUGIN_TRANSACTION_JOURNAL_SCHEMA,
      revision: 0,
      previousJournalDigest: null,
      phase: "acquired",
    });
    expect(() => acquire()).toThrow(/already owned/u);

    const initialDigest = lock.journal.journalDigest;
    const updated = updatePluginTransactionJournal(lock, {
      phase: "candidate-active",
      transaction: { version: "2.0.0", pointerGeneration: "g1" },
    });
    expect(updated).toMatchObject({
      revision: 1,
      previousJournalDigest: lock.journal.previousJournalDigest,
      phase: "candidate-active",
      transaction: { version: "2.0.0", pointerGeneration: "g1" },
    });
    expect(updated.previousJournalDigest).toBe(initialDigest);
    expect(updated.journalDigest).toMatch(/^[a-f0-9]{64}$/u);

    const inspected = inspectPluginTransactionLock({
      name: "durable-plugin",
      scope: "project",
      nameDir,
    });
    expect(inspected.journal).toEqual(updated);
    expect(assertPluginTransactionLock(lock)).toBe(lock);
    expect(releasePluginTransactionLock(lock)).toEqual({ released: true });
    expect(
      fs.existsSync(path.join(nameDir, PLUGIN_TRANSACTION_LOCK_DIRNAME)),
    ).toBe(false);
  });

  it("rejects a stale journal writer after another owner view advances CAS", () => {
    const lock = acquire();
    const secondView = inspectPluginTransactionLock({
      name: "durable-plugin",
      scope: "project",
      nameDir,
    });
    updatePluginTransactionJournal(lock, { phase: "prepared" });

    expect(() =>
      updatePluginTransactionJournal(secondView, { phase: "candidate-active" }),
    ).toThrow(/journal changed/u);
    releasePluginTransactionLock(lock);
  });

  it("fails closed when the journal digest is tampered", () => {
    const lock = acquire();
    const journalPath = path.join(
      nameDir,
      PLUGIN_TRANSACTION_LOCK_DIRNAME,
      PLUGIN_TRANSACTION_JOURNAL_FILENAME,
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.phase = "finalized";
    fs.writeFileSync(journalPath, JSON.stringify(journal), "utf8");

    expect(() => assertPluginTransactionLock(lock)).not.toThrow();
    expect(() =>
      updatePluginTransactionJournal(lock, { phase: "prepared" }),
    ).toThrow(/journal authority or digest is invalid/u);
  });

  it("rejects hard-linked authority metadata", () => {
    acquire();
    const ownerPath = path.join(
      nameDir,
      PLUGIN_TRANSACTION_LOCK_DIRNAME,
      PLUGIN_TRANSACTION_OWNER_FILENAME,
    );
    fs.linkSync(ownerPath, path.join(root, "owner-hardlink.json"));

    expect(() =>
      inspectPluginTransactionLock({
        name: "durable-plugin",
        scope: "project",
        nameDir,
      }),
    ).toThrow(/owner metadata is unavailable or corrupt/u);
  });

  it("requires a dead or explicitly forced owner before recovery", () => {
    const lock = acquire();
    _deps.isProcessAlive = () => true;
    expect(() =>
      claimPluginTransactionRecovery({
        name: "durable-plugin",
        scope: "project",
        nameDir,
      }),
    ).toThrow(/still live/u);

    _deps.isProcessAlive = () => false;
    const recovery = claimPluginTransactionRecovery({
      name: "durable-plugin",
      scope: "project",
      nameDir,
    });
    expect(recovery.recoveryClaim).toMatchObject({
      observedOwnerToken: lock.owner.token,
      observedJournalDigest: lock.journal.journalDigest,
    });
    expect(() =>
      updatePluginTransactionJournal(lock, { phase: "owner-resumed" }),
    ).toThrow(/recovery has fenced the original owner/u);
    updatePluginTransactionJournal(recovery, { phase: "rolled-back" });
    expect(releasePluginTransactionLock(recovery)).toEqual({ released: true });
  });

  it("reclaims only an exact dead recovery claim and fences the old writer", () => {
    acquire();
    _deps.isProcessAlive = () => false;
    const first = claimPluginTransactionRecovery({
      name: "durable-plugin",
      scope: "project",
      nameDir,
    });
    const second = claimPluginTransactionRecovery({
      name: "durable-plugin",
      scope: "project",
      nameDir,
    });

    expect(() =>
      updatePluginTransactionJournal(first, { phase: "stale-recovery" }),
    ).toThrow(/recovery claim changed/u);
    updatePluginTransactionJournal(second, { phase: "rolled-back" });
    expect(releasePluginTransactionLock(second)).toEqual({ released: true });
  });
});
