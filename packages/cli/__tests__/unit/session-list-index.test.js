import { afterEach, describe, expect, it } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  _sessionScaleFaultHooks,
  emptySessionMeta,
  listIndexedSessions,
  readLatestSessionActivity,
  readSessionMeta,
  recordSessionActivity,
  recordSessionDeleted,
  recordSessionEvent,
  replaceSessionMeta,
  sessionIndexPath,
  sessionMetaPath,
  sessionTombstoneMarkerPath,
} from "../../src/harness/session-list-index.js";

const roots = [];
const originalFaultInjection = process.env.CC_SESSION_SCALE_FAULT_INJECTION;

function temporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), "cc-session-list-index-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const name of Object.keys(_sessionScaleFaultHooks)) {
    _sessionScaleFaultHooks[name] = null;
  }
  if (originalFaultInjection === undefined) {
    delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
  } else {
    process.env.CC_SESSION_SCALE_FAULT_INJECTION = originalFaultInjection;
  }
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function enableFaultHooks() {
  process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
}

function temporarySnapshots(dir) {
  return readdirSync(dir).filter((entry) => entry.endsWith(".tmp"));
}

describe("rebuildable session listing index", () => {
  it("folds metadata and returns the newest unique snapshot", () => {
    const dir = temporaryDirectory();
    recordSessionEvent(
      dir,
      "s1",
      {
        type: "session_start",
        timestamp: 100,
        data: { title: "First", provider: "p", model: "m" },
      },
      "h1",
    );
    recordSessionEvent(
      dir,
      "s2",
      {
        type: "session_start",
        timestamp: 200,
        data: { title: "Second" },
      },
      "h2",
    );
    recordSessionEvent(
      dir,
      "s1",
      {
        type: "session_rename",
        timestamp: 300,
        data: { title: "Renamed" },
      },
      "h3",
    );

    const rows = listIndexedSessions(dir, { hasSession: () => true });
    expect(rows.map((row) => row.id)).toEqual(["s1", "s2"]);
    expect(rows[0]).toMatchObject({
      title: "Renamed",
      provider: "p",
      model: "m",
    });
    expect(readSessionMeta(dir, "s1")).toMatchObject({
      event_count: 2,
      last_hash: "h3",
    });
  });

  it("persists exact transcript identity while retaining legacy fields", () => {
    const dir = temporaryDirectory();
    recordSessionEvent(
      dir,
      "exact-identity",
      { type: "session_start", timestamp: 100, data: { title: "Exact" } },
      "h1",
      {
        transcriptState: {
          dev: "42",
          ino: "9007199254740992",
          size: 128,
          mtimeMs: 100.25,
          ctimeMs: 99.5,
          devExact: "42",
          inoExact: "9007199254740993",
          sizeExact: "128",
          mtimeNs: "100250000",
          ctimeNs: "99500000",
        },
      },
    );

    expect(readSessionMeta(dir, "exact-identity")?.transcript).toEqual({
      dev: "42",
      ino: "9007199254740992",
      size: 128,
      mtimeMs: 100.25,
      ctimeMs: 99.5,
      devExact: "42",
      inoExact: "9007199254740993",
      sizeExact: "128",
      mtimeNs: "100250000",
      ctimeNs: "99500000",
    });
  });

  it("publishes a meta snapshot through fsync and atomic rename before activity", () => {
    const dir = temporaryDirectory();
    const phases = [];
    let activityAtSnapshot = "unread";
    enableFaultHooks();
    _sessionScaleFaultHooks.afterMetaTempFsync = (payload) => {
      phases.push("temp-fsync");
      expect(payload).toMatchObject({
        kind: "meta",
        sessionId: "durable-meta",
        status: "live",
        targetPath: sessionMetaPath(dir, "durable-meta"),
      });
      expect(existsSync(payload.temporaryPath)).toBe(true);
    };
    _sessionScaleFaultHooks.afterMetaRename = (payload) => {
      phases.push("rename");
      expect(existsSync(payload.temporaryPath)).toBe(false);
      expect(readSessionMeta(dir, "durable-meta")?.last_hash).toBe("h1");
    };
    _sessionScaleFaultHooks.afterMetaDirectoryFsync = () => {
      phases.push("directory-fsync");
    };
    _sessionScaleFaultHooks.afterMetaSnapshot = () => {
      phases.push("snapshot-complete");
      activityAtSnapshot = readLatestSessionActivity(dir, "durable-meta");
    };

    recordSessionEvent(
      dir,
      "durable-meta",
      {
        type: "session_start",
        timestamp: 100,
        data: { title: "Durable" },
      },
      "h1",
    );

    expect(phases).toEqual(
      process.platform === "win32"
        ? ["temp-fsync", "rename", "snapshot-complete"]
        : ["temp-fsync", "rename", "directory-fsync", "snapshot-complete"],
    );
    expect(activityAtSnapshot).toBeNull();
    expect(readLatestSessionActivity(dir, "durable-meta")?.last_hash).toBe(
      "h1",
    );
    expect(temporarySnapshots(dir)).toEqual([]);
  });

  it("keeps the prior meta and downstream authority untouched before rename", () => {
    const dir = temporaryDirectory();
    recordSessionEvent(
      dir,
      "meta-before-rename",
      { type: "session_start", timestamp: 100, data: { title: "Before" } },
      "h1",
    );
    const metaBefore = readFileSync(
      sessionMetaPath(dir, "meta-before-rename"),
      "utf8",
    );
    const activityBefore = readLatestSessionActivity(dir, "meta-before-rename");
    let downstreamAuthorityAdvances = 0;
    let snapshotCompleted = 0;
    enableFaultHooks();
    _sessionScaleFaultHooks.afterMetaTempFsync = () => {
      const error = new Error("injected meta temp fsync boundary");
      error.code = "EIO";
      throw error;
    };
    _sessionScaleFaultHooks.afterMetaSnapshot = () => {
      snapshotCompleted += 1;
    };

    const persistThenAdvanceAuthority = () => {
      recordSessionEvent(
        dir,
        "meta-before-rename",
        { type: "session_rename", timestamp: 200, data: { title: "After" } },
        "h2",
      );
      downstreamAuthorityAdvances += 1;
    };
    expect(persistThenAdvanceAuthority).toThrow(
      expect.objectContaining({
        code: "EIO",
        commitState: "not-committed",
        persistenceTarget: sessionMetaPath(dir, "meta-before-rename"),
      }),
    );

    expect(
      readFileSync(sessionMetaPath(dir, "meta-before-rename"), "utf8"),
    ).toBe(metaBefore);
    expect(readLatestSessionActivity(dir, "meta-before-rename")).toEqual(
      activityBefore,
    );
    expect(snapshotCompleted).toBe(0);
    expect(downstreamAuthorityAdvances).toBe(0);
    expect(temporarySnapshots(dir)).toEqual([]);
  });

  it("exposes an atomically replaced meta but not activity after response loss", () => {
    const dir = temporaryDirectory();
    recordSessionEvent(
      dir,
      "meta-after-rename",
      { type: "session_start", timestamp: 100, data: { title: "Before" } },
      "h1",
    );
    const activityBefore = readLatestSessionActivity(dir, "meta-after-rename");
    let downstreamAuthorityAdvances = 0;
    enableFaultHooks();
    _sessionScaleFaultHooks.afterMetaRename = () => {
      throw Object.assign(new Error("injected post-rename response loss"), {
        code: "EIO",
      });
    };

    expect(() => {
      recordSessionEvent(
        dir,
        "meta-after-rename",
        { type: "session_rename", timestamp: 200, data: { title: "After" } },
        "h2",
      );
      downstreamAuthorityAdvances += 1;
    }).toThrow(
      expect.objectContaining({
        commitState: process.platform === "win32" ? "committed" : "unknown",
      }),
    );

    expect(readSessionMeta(dir, "meta-after-rename")).toMatchObject({
      title: "After",
      event_count: 2,
      last_hash: "h2",
    });
    expect(readLatestSessionActivity(dir, "meta-after-rename")).toEqual(
      activityBefore,
    );
    expect(downstreamAuthorityAdvances).toBe(0);
    expect(temporarySnapshots(dir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "classifies response loss after the meta directory barrier as committed",
    () => {
      const dir = temporaryDirectory();
      recordSessionEvent(
        dir,
        "meta-after-directory-fsync",
        { type: "session_start", timestamp: 100, data: { title: "Before" } },
        "h1",
      );
      const activityBefore = readLatestSessionActivity(
        dir,
        "meta-after-directory-fsync",
      );
      enableFaultHooks();
      _sessionScaleFaultHooks.afterMetaDirectoryFsync = () => {
        throw new Error("injected post-directory-fsync response loss");
      };

      expect(() =>
        recordSessionEvent(
          dir,
          "meta-after-directory-fsync",
          {
            type: "session_rename",
            timestamp: 200,
            data: { title: "After" },
          },
          "h2",
        ),
      ).toThrow(expect.objectContaining({ commitState: "committed" }));
      expect(readSessionMeta(dir, "meta-after-directory-fsync")).toMatchObject({
        last_hash: "h2",
        event_count: 2,
      });
      expect(
        readLatestSessionActivity(dir, "meta-after-directory-fsync"),
      ).toEqual(activityBefore);
    },
  );

  it("durably publishes tombstone then meta before derived activity", () => {
    const dir = temporaryDirectory();
    recordSessionEvent(
      dir,
      "durable-delete",
      { type: "session_start", timestamp: 100, data: { title: "Live" } },
      "h1",
    );
    const phases = [];
    enableFaultHooks();
    _sessionScaleFaultHooks.afterTombstoneTempFsync = () =>
      phases.push("tombstone-temp-fsync");
    _sessionScaleFaultHooks.afterTombstoneRename = () =>
      phases.push("tombstone-rename");
    _sessionScaleFaultHooks.afterTombstoneDirectoryFsync = () =>
      phases.push("tombstone-directory-fsync");
    _sessionScaleFaultHooks.afterMetaTempFsync = () =>
      phases.push("meta-temp-fsync");
    _sessionScaleFaultHooks.afterMetaRename = () => phases.push("meta-rename");
    _sessionScaleFaultHooks.afterMetaDirectoryFsync = () =>
      phases.push("meta-directory-fsync");

    recordSessionDeleted(dir, "durable-delete", 200);

    expect(phases).toEqual(
      process.platform === "win32"
        ? [
            "tombstone-temp-fsync",
            "tombstone-rename",
            "meta-temp-fsync",
            "meta-rename",
          ]
        : [
            "tombstone-temp-fsync",
            "tombstone-rename",
            "tombstone-directory-fsync",
            "meta-temp-fsync",
            "meta-rename",
            "meta-directory-fsync",
          ],
    );
    expect(
      JSON.parse(
        readFileSync(sessionTombstoneMarkerPath(dir, "durable-delete"), "utf8"),
      ),
    ).toMatchObject({ id: "durable-delete", event_count: 1 });
    expect(readSessionMeta(dir, "durable-delete")).toMatchObject({
      deleted: true,
      deleted_at_ms: 200,
    });
    expect(readLatestSessionActivity(dir, "durable-delete")).toMatchObject({
      deleted: true,
      deleted_at_ms: 200,
    });
    expect(temporarySnapshots(dir)).toEqual([]);
  });

  it("keeps a durable tombstone fence when deleted meta publication stops", () => {
    const dir = temporaryDirectory();
    recordSessionEvent(
      dir,
      "delete-partial",
      { type: "session_start", timestamp: 100, data: { title: "Live" } },
      "h1",
    );
    const metaBefore = readFileSync(
      sessionMetaPath(dir, "delete-partial"),
      "utf8",
    );
    const activityBefore = readLatestSessionActivity(dir, "delete-partial");
    let downstreamAuthorityAdvances = 0;
    enableFaultHooks();
    _sessionScaleFaultHooks.afterMetaTempFsync = ({ status }) => {
      if (status === "deleted") {
        throw new Error("injected deleted-meta publication failure");
      }
    };

    expect(() => {
      recordSessionDeleted(dir, "delete-partial", 200);
      downstreamAuthorityAdvances += 1;
    }).toThrow(expect.objectContaining({ commitState: "unknown" }));

    expect(existsSync(sessionTombstoneMarkerPath(dir, "delete-partial"))).toBe(
      true,
    );
    expect(readFileSync(sessionMetaPath(dir, "delete-partial"), "utf8")).toBe(
      metaBefore,
    );
    expect(readLatestSessionActivity(dir, "delete-partial")).toEqual(
      activityBefore,
    );
    expect(downstreamAuthorityAdvances).toBe(0);
    expect(temporarySnapshots(dir)).toEqual([]);
  });

  it("removes a tombstone only after live meta publication and orders activity last", () => {
    const dir = temporaryDirectory();
    replaceSessionMeta(dir, {
      ...emptySessionMeta("live-successor"),
      deleted: true,
      deleted_at_ms: 100,
      updated_at_ms: 100,
    });
    const phases = [];
    enableFaultHooks();
    _sessionScaleFaultHooks.afterMetaRename = () => phases.push("meta-rename");
    _sessionScaleFaultHooks.afterMetaDirectoryFsync = () =>
      phases.push("meta-directory-fsync");
    _sessionScaleFaultHooks.afterTombstoneRemoval = () =>
      phases.push("tombstone-removal");
    _sessionScaleFaultHooks.afterTombstoneRemovalDirectoryFsync = () =>
      phases.push("tombstone-removal-directory-fsync");

    replaceSessionMeta(dir, {
      ...emptySessionMeta("live-successor"),
      title: "Successor",
      event_count: 1,
      last_hash: "h2",
      updated_at_ms: 200,
    });

    expect(phases).toEqual(
      process.platform === "win32"
        ? ["meta-rename", "tombstone-removal"]
        : [
            "meta-rename",
            "meta-directory-fsync",
            "tombstone-removal",
            "tombstone-removal-directory-fsync",
          ],
    );
    expect(existsSync(sessionTombstoneMarkerPath(dir, "live-successor"))).toBe(
      false,
    );
    expect(readSessionMeta(dir, "live-successor")).toMatchObject({
      title: "Successor",
      deleted: false,
      last_hash: "h2",
    });
    expect(readLatestSessionActivity(dir, "live-successor")).toMatchObject({
      title: "Successor",
      deleted: false,
      last_hash: "h2",
    });
  });

  it("does not advance activity past a tombstone-removal response loss", () => {
    const dir = temporaryDirectory();
    replaceSessionMeta(dir, {
      ...emptySessionMeta("live-removal-loss"),
      deleted: true,
      deleted_at_ms: 100,
      updated_at_ms: 100,
    });
    const activityBefore = readLatestSessionActivity(dir, "live-removal-loss");
    enableFaultHooks();
    _sessionScaleFaultHooks.afterTombstoneRemoval = () => {
      throw new Error("injected tombstone-removal response loss");
    };

    expect(() =>
      replaceSessionMeta(dir, {
        ...emptySessionMeta("live-removal-loss"),
        event_count: 1,
        last_hash: "h2",
        updated_at_ms: 200,
      }),
    ).toThrow(
      expect.objectContaining({
        commitState: process.platform === "win32" ? "committed" : "unknown",
      }),
    );

    expect(
      existsSync(sessionTombstoneMarkerPath(dir, "live-removal-loss")),
    ).toBe(false);
    expect(readSessionMeta(dir, "live-removal-loss")).toMatchObject({
      deleted: false,
      last_hash: "h2",
    });
    expect(readLatestSessionActivity(dir, "live-removal-loss")).toEqual(
      activityBefore,
    );
  });

  it.skipIf(process.platform === "win32")(
    "classifies response loss after tombstone-removal directory fsync as committed",
    () => {
      const dir = temporaryDirectory();
      replaceSessionMeta(dir, {
        ...emptySessionMeta("live-removal-directory-loss"),
        deleted: true,
        deleted_at_ms: 100,
        updated_at_ms: 100,
      });
      const activityBefore = readLatestSessionActivity(
        dir,
        "live-removal-directory-loss",
      );
      enableFaultHooks();
      _sessionScaleFaultHooks.afterTombstoneRemovalDirectoryFsync = () => {
        throw new Error("injected post-removal-directory-fsync response loss");
      };

      expect(() =>
        replaceSessionMeta(dir, {
          ...emptySessionMeta("live-removal-directory-loss"),
          event_count: 1,
          last_hash: "h2",
          updated_at_ms: 200,
        }),
      ).toThrow(expect.objectContaining({ commitState: "committed" }));
      expect(
        existsSync(
          sessionTombstoneMarkerPath(dir, "live-removal-directory-loss"),
        ),
      ).toBe(false);
      expect(
        readLatestSessionActivity(dir, "live-removal-directory-loss"),
      ).toEqual(activityBefore);
    },
  );

  it("honors tombstones, live-file checks, limits, and malformed journal tails", () => {
    const dir = temporaryDirectory();
    for (let i = 1; i <= 3; i += 1) {
      replaceSessionMeta(dir, {
        ...emptySessionMeta(`s${i}`),
        updated_at_ms: i,
      });
    }
    recordSessionDeleted(dir, "s3", 10);
    appendFileSync(sessionIndexPath(dir), "{partial", "utf8");

    const rows = listIndexedSessions(dir, {
      limit: 1,
      hasSession: (id) => id !== "s2",
    });
    expect(rows.map((row) => row.id)).toEqual(["s1"]);
  });

  it("ignores a corrupt sidecar because the journal remains rebuildable", () => {
    const dir = temporaryDirectory();
    replaceSessionMeta(dir, {
      ...emptySessionMeta("s1"),
      title: "okay",
      updated_at_ms: 1,
    });
    writeFileSync(sessionMetaPath(dir, "s1"), "not json", "utf8");
    expect(readSessionMeta(dir, "s1")).toBeNull();
    expect(listIndexedSessions(dir, { hasSession: () => true })[0].title).toBe(
      "okay",
    );
  });

  it("isolates a crash-partial journal tail before the next activity record", () => {
    const dir = temporaryDirectory();
    replaceSessionMeta(dir, {
      ...emptySessionMeta("s1"),
      title: "before crash",
      event_count: 1,
      last_hash: "h1",
      updated_at_ms: 1,
    });
    appendFileSync(sessionIndexPath(dir), '{"schema":2,"id":"s1"', "utf8");
    recordSessionActivity(dir, {
      ...emptySessionMeta("s1"),
      title: "after crash",
      event_count: 2,
      last_hash: "h2",
      updated_at_ms: 2,
    });

    expect(readLatestSessionActivity(dir, "s1")).toMatchObject({
      title: "after crash",
      event_count: 2,
      last_hash: "h2",
    });
    expect(
      listIndexedSessions(dir, { hasSession: () => true })[0],
    ).toMatchObject({ title: "after crash" });
  });
});
