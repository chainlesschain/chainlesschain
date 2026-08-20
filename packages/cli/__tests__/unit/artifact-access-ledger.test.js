import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  ARTIFACT_ACCESS_EVENT_SCHEMA,
  ARTIFACT_ACCESS_LEDGER_SCHEMA,
  authorizeArtifactContentAccess,
  readArtifactAccessLedger,
} from "../../src/lib/artifact-access-ledger.js";

describe("artifact content access ledger", () => {
  let root;
  let store;
  let entry;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-artifact-access-"));
    store = new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => Date.UTC(2026, 7, 18, 12, 0, 0),
    });
    entry = store.publishData({
      data: Buffer.from("private artifact bytes\n", "utf8"),
      fileName: "result.txt",
      title: "Result",
      kind: "report",
      mime: "text/plain",
      sessionId: "access-session",
      immutable: true,
      recordDigest: `sha256:${"1".repeat(64)}`,
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function authorize(overrides = {}) {
    return authorizeArtifactContentAccess(
      store,
      {
        artifactId: entry.id,
        accessId: "access-request-1",
        client: "cli",
        action: "open",
        ...overrides,
      },
      { now: () => Date.UTC(2026, 7, 18, 12, 30, 0) },
    );
  }

  it("records content-free current-byte authority before returning a path", () => {
    const result = authorize();

    expect(result).toMatchObject({
      recorded: true,
      storedPath: store.storedPath(entry),
      integrity: { ok: true, reason: "ok" },
      access: {
        schema: ARTIFACT_ACCESS_EVENT_SCHEMA,
        sequence: 1,
        previousEventDigest: null,
        accessId: "access-request-1",
        artifactId: entry.id,
        artifactSha256: `sha256:${entry.sha256}`,
        recordDigest: entry.recordDigest,
        artifactSessionId: "access-session",
        client: "cli",
        action: "open",
        authorizedAt: "2026-08-18T12:30:00.000Z",
        authorization: "current-artifact-index-and-byte-readback",
      },
    });
    expect(result.access.eventDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(result.access)).not.toContain(
      "private artifact bytes",
    );
    expect(JSON.stringify(result.access)).not.toContain(root);

    const ledger = readArtifactAccessLedger(store);
    expect(ledger).toMatchObject({
      schema: ARTIFACT_ACCESS_LEDGER_SCHEMA,
      eventCount: 1,
      headDigest: result.access.eventDigest,
    });
  });

  it("deduplicates response-loss retry and rejects access-id collision", () => {
    const first = authorize();
    const retry = authorize();

    expect(retry.recorded).toBe(false);
    expect(retry.access).toEqual(first.access);
    expect(readArtifactAccessLedger(store).eventCount).toBe(1);
    expect(() => authorize({ action: "download" })).toThrow(
      /already bound to other inputs/u,
    );
  });

  it("chains distinct client actions in strict sequence", () => {
    const first = authorize();
    const second = authorize({
      accessId: "access-request-2",
      client: "vscode",
      action: "preview",
    });
    const ledger = readArtifactAccessLedger(store);

    expect(second.access).toMatchObject({
      sequence: 2,
      previousEventDigest: first.access.eventDigest,
      client: "vscode",
      action: "preview",
    });
    expect(ledger.events).toHaveLength(2);
    expect(ledger.headDigest).toBe(second.access.eventDigest);
  });

  it("accepts the Desktop product surface as an audited client", () => {
    const result = authorize({
      accessId: "access-desktop-1",
      client: "desktop",
      action: "download",
    });

    expect(result.access).toMatchObject({
      client: "desktop",
      action: "download",
      artifactId: entry.id,
    });
  });

  it("holds the index generation lock while it verifies bytes and appends authority", () => {
    let generationLockDepth = 0;
    const lockedStore = new ArtifactStore({
      dir: path.join(root, "locked-artifacts"),
      now: () => Date.UTC(2026, 7, 18, 12, 0, 0),
      indexLock: (_target, callback, options) => {
        expect(generationLockDepth).toBe(0);
        expect(options).toMatchObject({ failIfUnavailable: true });
        generationLockDepth += 1;
        try {
          return callback({ locked: true });
        } finally {
          generationLockDepth -= 1;
        }
      },
    });
    const lockedEntry = lockedStore.publishData({
      data: "locked bytes",
      fileName: "locked.txt",
    });

    const result = authorizeArtifactContentAccess(
      lockedStore,
      {
        artifactId: lockedEntry.id,
        accessId: "locked-access",
        client: "cli",
        action: "open",
      },
      {
        withFileLock: (_target, callback, options) => {
          expect(generationLockDepth).toBe(1);
          expect(options).toMatchObject({ failIfUnavailable: true });
          return callback({ locked: true });
        },
      },
    );

    expect(result.recorded).toBe(true);
    expect(generationLockDepth).toBe(0);
  });

  it("fails closed on ledger tamper or a truncated tail", () => {
    authorize();
    const ledgerPath = path.join(store.dir, "content-access.jsonl");
    const original = fs.readFileSync(ledgerPath, "utf8");
    fs.writeFileSync(
      ledgerPath,
      original.replace('"action":"open"', '"action":"reveal"'),
    );
    expect(() => readArtifactAccessLedger(store)).toThrow(/digest is invalid/u);

    fs.writeFileSync(ledgerPath, original.slice(0, -1), "utf8");
    expect(() => readArtifactAccessLedger(store)).toThrow(/truncated tail/u);
  });

  it("does not append authority for changed, hardlinked, or ambiguous bytes", () => {
    const storedPath = store.storedPath(entry);
    fs.chmodSync(storedPath, 0o666);
    fs.writeFileSync(storedPath, "changed", "utf8");
    expect(() => authorize()).toThrow(/byte identity|byte readback/u);
    expect(readArtifactAccessLedger(store).eventCount).toBe(0);

    fs.writeFileSync(storedPath, "private artifact bytes\n", "utf8");
    fs.linkSync(storedPath, path.join(root, "hardlink.txt"));
    expect(() => authorize()).toThrow(/byte identity/u);
    expect(readArtifactAccessLedger(store).eventCount).toBe(0);

    fs.unlinkSync(path.join(root, "hardlink.txt"));
    fs.appendFileSync(
      path.join(store.dir, "index.jsonl"),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
    expect(() => authorize()).toThrow(/artifact id is ambiguous/u);
    expect(readArtifactAccessLedger(store).eventCount).toBe(0);
  });

  it("rejects malformed clients, actions, ids, and unsafe stored filenames", () => {
    expect(() => authorize({ client: "unknown" })).toThrow(
      /request is invalid/u,
    );
    expect(() => authorize({ action: "execute" })).toThrow(
      /request is invalid/u,
    );
    expect(() => authorize({ accessId: "bad id" })).toThrow(
      /request is invalid/u,
    );

    const indexPath = path.join(store.dir, "index.jsonl");
    const unsafe = { ...entry, file: "../outside.txt" };
    fs.writeFileSync(indexPath, `${JSON.stringify(unsafe)}\n`, "utf8");
    expect(() => authorize()).toThrow(/unsafe stored filename/u);
    expect(readArtifactAccessLedger(store).eventCount).toBe(0);
  });
});
