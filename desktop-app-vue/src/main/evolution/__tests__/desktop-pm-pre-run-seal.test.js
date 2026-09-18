import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const {
  SEAL_SCHEMA,
  RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
  createDesktopPmPreRunSealValue,
  createDesktopPmPreRunSealCaptureFactory,
  createDesktopPmRecoverySnapshotCaptureFactory,
  verifyDesktopPmPreRunSealValue,
} = require("../desktop-pm-pre-run-seal");
const requireFromHere = createRequire(import.meta.url);

function sqliteFixture() {
  const BetterSqlite3 = requireFromHere("better-sqlite3");
  const directory = mkdtempSync(path.join(tmpdir(), "cc-pm-seal-test-"));
  const databasePath = path.join(directory, "isolated-clone.db");
  const database = new BetterSqlite3(databasePath);
  database.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT)");
  database
    .prepare("INSERT INTO projects VALUES (?, ?)")
    .run("project-one", "Before");
  const manager = {
    backup: (target) => database.backup(target),
    getCurrentDatabasePath: () => databasePath,
  };
  return {
    capture: createDesktopPmPreRunSealCaptureFactory(() => manager),
    captureRecoverySnapshot: createDesktopPmRecoverySnapshotCaptureFactory(
      () => manager,
    ),
    database,
    databasePath,
    directory,
    manager,
  };
}

describe("Desktop PM pre-run database seal", () => {
  it("seals a real SQLite backup and changes after committed data changes", async () => {
    const fixture = sqliteFixture();
    try {
      const first = await fixture.capture();
      const repeated = await fixture.capture();
      expect(first).toEqual(repeated);
      expect(first).toMatchObject({
        schema: SEAL_SCHEMA,
        databasePathDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        databaseSnapshotDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        databaseSnapshotBytes: expect.any(Number),
        snapshotMethod: "database-manager-backup",
        sealDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      });
      expect(Object.isFrozen(first)).toBe(true);
      expect(verifyDesktopPmPreRunSealValue(first, first.sealDigest)).toEqual(
        first,
      );

      fixture.database
        .prepare("UPDATE projects SET name = ? WHERE id = ?")
        .run("After", "project-one");
      const changed = await fixture.capture();
      expect(changed.databasePathDigest).toBe(first.databasePathDigest);
      expect(changed.databaseSnapshotDigest).not.toBe(
        first.databaseSnapshotDigest,
      );
      expect(changed.sealDigest).not.toBe(first.sealDigest);
    } finally {
      fixture.database.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the database path changes during backup", async () => {
    const fixture = sqliteFixture();
    let currentPath = fixture.databasePath;
    fixture.manager.getCurrentDatabasePath = () => currentPath;
    fixture.manager.backup = async (target) => {
      await fixture.database.backup(target);
      currentPath = path.join(fixture.directory, "substituted.db");
    };
    const capture = createDesktopPmPreRunSealCaptureFactory(
      () => fixture.manager,
    );
    try {
      await expect(capture()).rejects.toThrow("identity changed while sealing");
    } finally {
      fixture.database.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("returns the exact real SQLite backup bytes for recovery retention", async () => {
    const fixture = sqliteFixture();
    try {
      const captured = await fixture.captureRecoverySnapshot();
      expect(captured).toMatchObject({
        schema: RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
        seal: {
          schema: SEAL_SCHEMA,
          databaseSnapshotBytes: captured.bytes.byteLength,
        },
        bytes: expect.any(Buffer),
      });
      expect(Object.isFrozen(captured)).toBe(true);
      const restoredPath = path.join(fixture.directory, "restored.db");
      await writeFile(restoredPath, captured.bytes);
      const BetterSqlite3 = requireFromHere("better-sqlite3");
      const restored = new BetterSqlite3(restoredPath, { readonly: true });
      try {
        expect(
          restored
            .prepare("SELECT name FROM projects WHERE id = ?")
            .get("project-one"),
        ).toEqual({ name: "Before" });
      } finally {
        restored.close();
      }
    } finally {
      fixture.database.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("pins the same manager and path across lifecycle seals", async () => {
    const first = sqliteFixture();
    const second = sqliteFixture();
    let manager = first.manager;
    const capture = createDesktopPmPreRunSealCaptureFactory(() => manager);
    try {
      await expect(capture()).resolves.toMatchObject({ schema: SEAL_SCHEMA });
      manager = second.manager;
      await expect(capture()).rejects.toThrow("identity changed between seals");
    } finally {
      first.database.close();
      second.database.close();
      rmSync(first.directory, { recursive: true, force: true });
      rmSync(second.directory, { recursive: true, force: true });
    }
  });

  it("does not invoke an accessor masquerading as the backup method", async () => {
    const getBackup = vi.fn(() => vi.fn());
    const manager = {
      getCurrentDatabasePath: () => path.resolve("clone.db"),
    };
    Object.defineProperty(manager, "backup", {
      enumerable: true,
      get: getBackup,
    });
    const capture = createDesktopPmPreRunSealCaptureFactory(() => manager);

    await expect(capture()).rejects.toThrow("must be a direct function");
    expect(getBackup).not.toHaveBeenCalled();
  });

  it("rejects tampered or substituted seal evidence", () => {
    const seal = Object.freeze({
      schema: SEAL_SCHEMA,
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
      snapshotMethod: "database-manager-backup",
      sealDigest: `sha256:${"3".repeat(64)}`,
    });
    expect(() => verifyDesktopPmPreRunSealValue(seal)).toThrow(
      "digest mismatch",
    );

    const getSnapshotDigest = vi.fn(() => `sha256:${"2".repeat(64)}`);
    const accessorInput = {
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    };
    Object.defineProperty(accessorInput, "databaseSnapshotDigest", {
      enumerable: true,
      get: getSnapshotDigest,
    });
    expect(() => createDesktopPmPreRunSealValue(accessorInput)).toThrow(
      "accessor fields",
    );
    expect(getSnapshotDigest).not.toHaveBeenCalled();
  });
});
