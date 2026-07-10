import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  mergeRecords,
  parseIndex,
  readIdeSessionIndex,
  removeIdeSessionRecord,
  renameIdeSessionRecord,
  upsertIdeSessionRecord,
} from "../../../vscode-extension/src/chat/ide-session-index.js";
import {
  buildDeleteArgs,
  deleteCliSession,
  mergeSessionItems,
  listSessions,
} from "../../../vscode-extension/src/chat/session-list.js";

describe("VS Code shared IDE session index", () => {
  it("normalizes, upserts, and keeps the newest metadata", () => {
    const now = new Date("2026-07-10T00:00:00.000Z");
    const records = mergeRecords(
      [
        {
          id: "s1",
          title: "old",
          ide: "jetbrains",
          status: "stopped",
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      ],
      {
        id: "s1",
        title: "new",
        ide: "vscode",
        status: "waiting approval",
        workspaceFolders: ["/repo"],
      },
      { now },
    );
    expect(records).toEqual([
      expect.objectContaining({
        id: "s1",
        title: "new",
        ide: "vscode",
        status: "waiting_approval",
        workspace: "/repo",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      }),
    ]);
  });

  it("writes the shared index as metadata only", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-ide-index-"));
    try {
      const file = join(dir, "session-index.json");
      upsertIdeSessionRecord(
        {
          id: "panel-1",
          title: "Fix tests",
          ide: "vscode",
          status: "completed",
          workspace: "C:/repo",
        },
        { file, now: new Date("2026-07-10T00:00:00.000Z") },
      );
      expect(readIdeSessionIndex({ file })[0]).toMatchObject({
        id: "panel-1",
        title: "Fix tests",
        status: "completed",
      });
      expect(readFileSync(file, "utf8")).not.toContain("messages");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renames indexed sessions and overlays CLI-only sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-ide-index-"));
    try {
      const file = join(dir, "session-index.json");
      upsertIdeSessionRecord(
        {
          id: "s1",
          title: "old",
          ide: "vscode",
          status: "running",
          mode: "acceptEdits",
        },
        { file },
      );
      renameIdeSessionRecord("s1", "renamed", { file });
      const rows = readIdeSessionIndex({ file });
      // Rename keeps the record's other metadata intact.
      expect(rows.find((r) => r.id === "s1")).toMatchObject({
        title: "renamed",
        ide: "vscode",
        status: "running",
        mode: "acceptEdits",
      });
      // CLI-only session (never indexed): rename creates a title overlay.
      renameIdeSessionRecord("cli-only", "titled from IDE", { file });
      expect(
        readIdeSessionIndex({ file }).find((r) => r.id === "cli-only"),
      ).toMatchObject({ title: "titled from IDE" });
      // Blank titles are rejected, not written.
      expect(renameIdeSessionRecord("s1", "   ", { file })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes sessions from the index and reports misses", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-ide-index-"));
    try {
      const file = join(dir, "session-index.json");
      upsertIdeSessionRecord({ id: "s1" }, { file });
      upsertIdeSessionRecord({ id: "s2" }, { file });
      expect(removeIdeSessionRecord("s1", { file })).toBe(true);
      expect(readIdeSessionIndex({ file }).map((r) => r.id)).toEqual(["s2"]);
      expect(removeIdeSessionRecord("s1", { file })).toBe(false);
      expect(removeIdeSessionRecord("missing", { file })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses corrupt or legacy array payloads tolerantly", () => {
    expect(parseIndex("not json")).toEqual([]);
    expect(
      parseIndex(JSON.stringify([{ id: "s2", ide: "jetbrains" }])),
    ).toEqual([expect.objectContaining({ id: "s2", ide: "jetbrains" })]);
  });
});

describe("session picker merge", () => {
  it("merges CLI sessions with IDE-indexed sessions by id", () => {
    expect(
      mergeSessionItems(
        [{ id: "s1", title: "CLI", updatedAt: "2026-07-09", store: "agent" }],
        [
          {
            id: "s1",
            title: "IDE",
            updatedAt: "2026-07-10",
            store: "ide:vscode",
          },
          {
            id: "s2",
            title: "Other IDE",
            updatedAt: "2026-07-08",
            store: "ide:jetbrains",
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        id: "s1",
        title: "IDE",
        store: "agent+ide:vscode",
      }),
      expect.objectContaining({ id: "s2", store: "ide:jetbrains" }),
    ]);
  });

  it("deletes CLI sessions with --force (no interactive confirm)", async () => {
    expect(buildDeleteArgs("s1")).toEqual([
      "session",
      "delete",
      "s1",
      "--force",
    ]);
    let seen;
    const ok = await deleteCliSession({
      id: "s1",
      deps: {
        execFile: (cmd, args, opts, cb) => {
          seen = args;
          cb(null, "");
        },
      },
    });
    expect(ok).toBe(true);
    expect(seen).toEqual(["session", "delete", "s1", "--force"]);
    const missing = await deleteCliSession({
      id: "nope",
      deps: { execFile: (cmd, args, opts, cb) => cb(new Error("not found")) },
    });
    expect(missing).toBe(false);
    expect(await deleteCliSession({ id: "" })).toBe(false);
  });

  it("optionally includes the shared IDE index in listSessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-ide-index-"));
    try {
      const file = join(dir, "session-index.json");
      upsertIdeSessionRecord({ id: "ide-1", ide: "jetbrains" }, { file });
      const items = await listSessions({
        includeIdeIndex: true,
        indexFile: file,
        deps: {
          execFile: (cmd, args, opts, cb) =>
            cb(null, JSON.stringify([{ id: "cli-1", _store: "jsonl" }])),
        },
      });
      expect(items.map((s) => s.id)).toEqual(
        expect.arrayContaining(["cli-1", "ide-1"]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
