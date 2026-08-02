import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
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
} from "../../src/harness/session-list-index.js";

const roots = [];

function temporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), "cc-session-list-index-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

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
