"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  VSCodeAdapter,
  VSCODE_NAME,
  VSCODE_VERSION,
  decodeFileUri,
  readWorkspaces,
} = require("../../lib/adapters/vscode");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, ITEM_SUBTYPES } = require("../../lib/constants");
const { validateEvent, validateItem } = require("../../lib/schemas");

let tmpDir;
let vscodeRoot;
let wsRoot;
let stateDbPath;
let historyRoot;

function makeWorkspace(hash, folderUri, opts = {}) {
  const d = join(wsRoot, hash);
  mkdirSync(d, { recursive: true });
  const wsFile = join(d, "workspace.json");
  writeFileSync(wsFile, JSON.stringify({ folder: folderUri }), "utf-8");
  if (opts.mtimeMs) {
    const ms = opts.mtimeMs;
    utimesSync(wsFile, ms / 1000, ms / 1000);
  }
}

function makeTerminalHistoryDb({
  commands = [],
  dirs = [],
  cmdTs = null,
  dirTs = null,
}) {
  mkdirSync(join(vscodeRoot, "User", "globalStorage"), { recursive: true });
  const db = new Database(stateDbPath);
  db.exec("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value BLOB)");
  const put = db.prepare(
    "INSERT OR REPLACE INTO ItemTable(key, value) VALUES(?, ?)",
  );
  put.run(
    "terminal.history.entries.commands",
    JSON.stringify({
      entries: commands.map((c) => ({ key: c, value: { shellType: "pwsh" } })),
    }),
  );
  put.run(
    "terminal.history.entries.dirs",
    JSON.stringify({
      entries: dirs.map((d) => ({ key: d, value: { shellType: "pwsh" } })),
    }),
  );
  if (cmdTs != null)
    put.run("terminal.history.timestamp.commands", String(cmdTs));
  if (dirTs != null) put.run("terminal.history.timestamp.dirs", String(dirTs));
  db.close();
}

function makeLocalHistory(storageId, resource, entries) {
  const directory = join(historyRoot, storageId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "entries.json"),
    JSON.stringify({ version: 1, resource, entries }),
    "utf-8",
  );
  for (const entry of entries) {
    writeFileSync(
      join(directory, entry.id),
      `private source content for ${entry.id}`,
      "utf-8",
    );
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "vscode-adapter-test-"));
  vscodeRoot = join(tmpDir, "Code");
  wsRoot = join(vscodeRoot, "User", "workspaceStorage");
  stateDbPath = join(vscodeRoot, "User", "globalStorage", "state.vscdb");
  historyRoot = join(vscodeRoot, "User", "History");
  mkdirSync(wsRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("VSCodeAdapter — contract + identity", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    expect(assertAdapter(new VSCodeAdapter())).toEqual({ ok: true });
  });

  it("name/version/capabilities are stable", () => {
    const a = new VSCodeAdapter();
    expect(a.name).toBe(VSCODE_NAME);
    expect(a.name).toBe("vscode");
    expect(a.version).toBe(VSCODE_VERSION);
    expect(a.extractMode).toBe("file-import");
    expect(a.capabilities).toContain("sync:vscode-workspace-storage");
    expect(a.capabilities).toContain("sync:vscode-globalstorage-sqlite");
    expect(a.capabilities).toContain("sync:vscode-local-history-metadata");
    expect(a.version).toBe("0.2.0");
    expect(a.watermarkStrategy).toBe("max-captured-at");
    expect(a.watermarkRequiresCompleteScan).toBe(true);
    expect(a.watermarkLookbackMs).toBe(1000);
  });
});

describe("VS Code local readers", () => {
  it("expands workspace discovery with the scan limit instead of a fixed default", () => {
    const workspaceRoot = join(vscodeRoot, "User", "workspaceStorage");
    const workspaceCount = 100_001;
    const workspaceNames = Array.from(
      { length: workspaceCount },
      (_, index) => `workspace-${String(index).padStart(6, "0")}`,
    );
    const fsMod = {
      existsSync: (candidate) => candidate === workspaceRoot,
      readdirSync: (candidate) => {
        expect(candidate).toBe(workspaceRoot);
        return workspaceNames;
      },
    };

    const result = readWorkspaces(vscodeRoot, {
      fs: fsMod,
      limit: workspaceCount,
    });

    expect(result).toEqual({ workspaces: [], complete: true });
  });
});

describe("VSCodeAdapter.authenticate", () => {
  it("VSCODE_NOT_FOUND when neither workspaceStorage nor state.vscdb exist", async () => {
    rmSync(wsRoot, { recursive: true, force: true });
    const a = new VSCodeAdapter({ vscodeRoot });
    const r = await a.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("VSCODE_NOT_FOUND");
  });

  it("succeeds when only workspaceStorage exists", async () => {
    const a = new VSCodeAdapter({ vscodeRoot });
    const r = await a.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.hasWorkspaces).toBe(true);
    expect(r.hasTerminalHistory).toBe(false);
    expect(r.hasLocalHistory).toBe(false);
    expect(JSON.stringify(r)).not.toContain(vscodeRoot);
  });

  it("succeeds when only state.vscdb exists", async () => {
    rmSync(wsRoot, { recursive: true, force: true });
    makeTerminalHistoryDb({ commands: ["ls"], cmdTs: 1_700_000_000_000 });
    const a = new VSCodeAdapter({ vscodeRoot });
    const r = await a.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.hasWorkspaces).toBe(false);
    expect(r.hasTerminalHistory).toBe(true);
  });

  it("succeeds when only Local History exists without returning its path", async () => {
    rmSync(wsRoot, { recursive: true, force: true });
    makeLocalHistory("abc", "file:///c%3A/code/private.ts", [
      { id: "a1.ts", timestamp: 1_700_000_030_000 },
    ]);
    const a = new VSCodeAdapter({ vscodeRoot });
    const r = await a.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.hasWorkspaces).toBe(false);
    expect(r.hasTerminalHistory).toBe(false);
    expect(r.hasLocalHistory).toBe(true);
    expect(JSON.stringify(r)).not.toContain(vscodeRoot);
  });
});

describe("VSCodeAdapter.sync — workspaces", () => {
  it("yields path-minimized workspace metadata at the actual open time", async () => {
    makeWorkspace("hash-a", "file:///c%3A/code/foo", {
      mtimeMs: 1_700_000_001_000,
    });
    makeWorkspace("hash-b", "file:///c%3A/code/bar", {
      mtimeMs: 1_700_000_002_000,
    });
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const wss = raws.filter((r) => r.kind === "workspace");
    expect(wss).toHaveLength(2);
    const byName = Object.fromEntries(wss.map((r) => [r.payload.name, r]));
    expect(byName.foo.payload.lastOpenedMs).toBe(1_700_000_001_000);
    expect(byName.foo.capturedAt).toBe(1_700_000_001_000);
    expect(byName.foo.payload.resourceScheme).toBe("file");
    expect(byName.foo.payload.resourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(byName.foo.payload).not.toHaveProperty("folderUri");
    expect(byName.foo.payload).not.toHaveProperty("folderPath");
    expect(JSON.stringify(wss)).not.toContain("c%3A/code");
  });

  it("filters workspaces by since (uses workspace.json mtime)", async () => {
    makeWorkspace("old", "file:///c%3A/old", { mtimeMs: 1_700_000_000_000 });
    makeWorkspace("new", "file:///c%3A/new", { mtimeMs: 1_700_000_005_000 });
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const r of a.sync({ since: 1_700_000_003_000 })) raws.push(r);
    const names = raws
      .filter((r) => r.kind === "workspace")
      .map((r) => r.payload.name);
    expect(names).toEqual(["new"]);
  });

  it("skips workspaces with no folder/workspace key", async () => {
    const d = join(wsRoot, "empty");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "workspace.json"), JSON.stringify({}), "utf-8");
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws.filter((r) => r.kind === "workspace")).toHaveLength(0);
  });
});

describe("VSCodeAdapter.sync — terminal history", () => {
  it("yields one raw per command + per dir, anchored to snapshot ts", async () => {
    makeTerminalHistoryDb({
      commands: ["ls", "git status", "npm test"],
      dirs: ["/c/code/foo", "/c/code/bar"],
      cmdTs: 1_700_000_010_000,
      dirTs: 1_700_000_020_000,
    });
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const cmds = raws.filter((r) => r.kind === "terminal-command");
    const dirs = raws.filter((r) => r.kind === "terminal-dir");
    expect(cmds).toHaveLength(3);
    expect(dirs).toHaveLength(2);
    expect(cmds[0].payload.value).toBe("ls");
    expect(cmds[0].payload.snapshotTs).toBe(1_700_000_010_000);
    expect(cmds[0].capturedAt).toBe(1_700_000_010_000);
    expect(dirs[0].payload.snapshotTs).toBe(1_700_000_020_000);
    expect(dirs[0].capturedAt).toBe(1_700_000_020_000);
    expect(dirs[0].payload.name).toBe("foo");
    expect(dirs[0].payload.pathHash).toMatch(/^[0-9a-f]{64}$/);
    expect(dirs[0].payload).not.toHaveProperty("value");
    expect(JSON.stringify(dirs)).not.toContain("/c/code/foo");
  });

  it("originalId disambiguates duplicate commands by occurrence", async () => {
    makeTerminalHistoryDb({
      commands: ["ls", "ls"], // duplicate value
      cmdTs: 1_700_000_010_000,
    });
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const ids = raws
      .filter((r) => r.kind === "terminal-command")
      .map((r) => r.originalId);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps command identities stable when a new history entry changes sourceIndex", async () => {
    makeTerminalHistoryDb({
      commands: ["ls", "git status"],
      cmdTs: 1_700_000_010_000,
    });
    const a = new VSCodeAdapter({ vscodeRoot });
    const first = [];
    for await (const raw of a.sync()) first.push(raw);
    const firstIds = new Map(
      first
        .filter((raw) => raw.kind === "terminal-command")
        .map((raw) => [raw.payload.value, raw.originalId]),
    );

    rmSync(stateDbPath, { force: true });
    makeTerminalHistoryDb({
      commands: ["pwd", "ls", "git status"],
      cmdTs: 1_700_000_020_000,
    });
    const second = [];
    for await (const raw of a.sync()) second.push(raw);
    const secondIds = new Map(
      second
        .filter((raw) => raw.kind === "terminal-command")
        .map((raw) => [raw.payload.value, raw.originalId]),
    );

    expect(secondIds.get("ls")).toBe(firstIds.get("ls"));
    expect(secondIds.get("git status")).toBe(firstIds.get("git status"));
  });

  it("respects include.terminal=false", async () => {
    makeWorkspace("h", "file:///c%3A/p", { mtimeMs: 1_700_000_001_000 });
    makeTerminalHistoryDb({ commands: ["ls"], cmdTs: 1_700_000_010_000 });
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const r of a.sync({ include: { terminal: false } }))
      raws.push(r);
    expect(raws.every((r) => r.kind === "workspace")).toBe(true);
    expect(raws.length).toBe(1);
  });

  it("respects include.workspaces=false", async () => {
    makeWorkspace("h", "file:///c%3A/p", { mtimeMs: 1_700_000_001_000 });
    makeTerminalHistoryDb({ commands: ["ls"], cmdTs: 1_700_000_010_000 });
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const r of a.sync({ include: { workspaces: false } }))
      raws.push(r);
    expect(raws.every((r) => r.kind !== "workspace")).toBe(true);
  });
});

describe("VSCodeAdapter.sync - Local History metadata", () => {
  it("collects save metadata without reading paths, source labels, or file contents", async () => {
    makeLocalHistory("abc123", "file:///c%3A/private/project/secret.ts", [
      {
        id: "a1.ts",
        timestamp: 1_700_000_030_000,
        source: "user-controlled source label",
      },
      { id: "b2.ts", timestamp: 1_700_000_040_000 },
    ]);
    const a = new VSCodeAdapter({ vscodeRoot });
    const raws = [];
    for await (const raw of a.sync({
      include: { workspaces: false, terminal: false },
    })) {
      raws.push(raw);
    }

    expect(raws).toHaveLength(2);
    expect(raws.every((raw) => raw.kind === "local-history-save")).toBe(true);
    expect(raws.map((raw) => raw.capturedAt)).toEqual([
      1_700_000_030_000, 1_700_000_040_000,
    ]);
    expect(raws[0].payload.fileName).toBe("secret.ts");
    expect(raws[0].payload.fileExtension).toBe(".ts");
    expect(raws[0].payload.resourceScheme).toBe("file");
    expect(raws[0].payload.hasSaveSource).toBe(true);
    expect(raws[0].payload.resourceHash).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(raws);
    expect(serialized).not.toContain("c%3A/private/project");
    expect(serialized).not.toContain("user-controlled source label");
    expect(serialized).not.toContain("private source content");
  });

  it("supports since and include.localHistory=false", async () => {
    makeLocalHistory("abc123", "file:///c%3A/code/file.js", [
      { id: "a1.js", timestamp: 1_700_000_030_000 },
      { id: "b2.js", timestamp: 1_700_000_040_000 },
    ]);
    const a = new VSCodeAdapter({ vscodeRoot });
    const incremental = [];
    for await (const raw of a.sync({
      since: 1_700_000_035_000,
      include: { workspaces: false, terminal: false },
    })) {
      incremental.push(raw);
    }
    expect(incremental).toHaveLength(1);
    expect(incremental[0].capturedAt).toBe(1_700_000_040_000);

    const excluded = [];
    for await (const raw of a.sync({
      include: { workspaces: false, terminal: false, localHistory: false },
    })) {
      excluded.push(raw);
    }
    expect(excluded).toHaveLength(0);
  });

  it("only advances the watermark after a complete scan", async () => {
    makeLocalHistory("abc123", "file:///c%3A/code/file.js", [
      { id: "a1.js", timestamp: 1_700_000_030_000 },
      { id: "b2.js", timestamp: 1_700_000_040_000 },
    ]);
    const a = new VSCodeAdapter({ vscodeRoot });
    let completed = false;
    const limited = [];
    for await (const raw of a.sync({
      limit: 1,
      include: { workspaces: false, terminal: false },
      markWatermarkComplete: () => {
        completed = true;
      },
    })) {
      limited.push(raw);
    }
    expect(limited).toHaveLength(1);
    expect(completed).toBe(false);

    for await (const raw of a.sync({
      include: { workspaces: false, terminal: false },
      markWatermarkComplete: () => {
        completed = true;
      },
    })) {
      expect(raw.kind).toBe("local-history-save");
    }
    expect(completed).toBe(true);
  });
});

describe("VSCodeAdapter.normalize", () => {
  it("maps a workspace to Item(LINK) with code-project category", () => {
    const a = new VSCodeAdapter();
    const { items } = a.normalize({
      kind: "workspace",
      capturedAt: 1_700_000_000_000,
      payload: {
        workspaceId: "a".repeat(64),
        name: "chainlesschain",
        resourceScheme: "file",
        resourceHash: "b".repeat(64),
        lastOpenedMs: 1_700_000_001_000,
      },
      originalId: "vscode-workspace:root:workspace",
    });
    expect(items).toHaveLength(1);
    expect(items[0].subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(items[0].category).toBe("code-project");
    expect(items[0].name).toBe("chainlesschain");
    expect(items[0].extra.editor).toBe("vscode");
    expect(items[0].extra.resourceScheme).toBe("file");
    expect(items[0].extra.resourceHash).toBe("b".repeat(64));
    expect(items[0].extra).not.toHaveProperty("folderUri");
    expect(validateItem(items[0]).valid).toBe(true);
  });

  it("maps terminal-command to Event(OTHER) with cmd in content", () => {
    const a = new VSCodeAdapter();
    const { events } = a.normalize({
      kind: "terminal-command",
      capturedAt: 1_700_000_000_000,
      originalId: "vscode-terminal-cmd:0:abc",
      payload: {
        value: "git status",
        shellType: "pwsh",
        sourceIndex: 0,
        snapshotTs: 1_700_000_010_000,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(events[0].content.title).toBe("git status");
    expect(events[0].content.text).toBe("git status");
    expect(events[0].extra.kind).toBe("terminal-command");
    expect(events[0].extra.shellType).toBe("pwsh");
    expect(events[0].occurredAt).toBe(1_700_000_010_000);
    expect(validateEvent(events[0]).valid).toBe(true);
  });

  it("maps terminal-dir to Event(OTHER) with only its basename and path hash", () => {
    const a = new VSCodeAdapter();
    const { events } = a.normalize({
      kind: "terminal-dir",
      capturedAt: 1_700_000_000_000,
      originalId: "vscode-terminal-dir:0:xyz",
      payload: {
        name: "foo",
        pathHash: "c".repeat(64),
        sourceIndex: 0,
        snapshotTs: 1_700_000_020_000,
      },
    });
    expect(events[0].content.title).toBe("cd foo");
    expect(events[0].content.text).toBe("foo");
    expect(events[0].extra.pathHash).toBe("c".repeat(64));
    expect(events[0].extra.kind).toBe("terminal-dir");
    expect(validateEvent(events[0]).valid).toBe(true);
  });

  it("maps Local History metadata to a save Event", () => {
    const a = new VSCodeAdapter();
    const { events } = a.normalize({
      kind: "local-history-save",
      capturedAt: 1_700_000_030_000,
      originalId: "vscode-local-history:root:entry",
      payload: {
        fileName: "adapter.js",
        fileExtension: ".js",
        resourceScheme: "file",
        resourceHash: "d".repeat(64),
        savedAtMs: 1_700_000_030_000,
        hasSaveSource: true,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].content.title).toBe("Saved adapter.js");
    expect(events[0].occurredAt).toBe(1_700_000_030_000);
    expect(events[0].extra.kind).toBe("local-history-save");
    expect(events[0].extra.fileExtension).toBe(".js");
    expect(validateEvent(events[0]).valid).toBe(true);
  });

  it("truncates >80 char command titles to ellipsis", () => {
    const a = new VSCodeAdapter();
    const longCmd = "echo " + "a".repeat(200);
    const { events } = a.normalize({
      kind: "terminal-command",
      capturedAt: 1_700_000_000_000,
      originalId: "vscode-terminal-cmd:0:long",
      payload: {
        value: longCmd,
        sourceIndex: 0,
        snapshotTs: 1_700_000_010_000,
      },
    });
    expect(events[0].content.title.length).toBeLessThanOrEqual(81);
    expect(events[0].content.title.endsWith("…")).toBe(true);
    expect(events[0].content.text).toBe(longCmd);
  });

  it("throws on unknown raw.kind", () => {
    expect(() =>
      new VSCodeAdapter().normalize({ kind: "bogus", payload: {} }),
    ).toThrow(/unknown raw\.kind=bogus/);
  });
});

describe("decodeFileUri helper", () => {
  it("decodes Windows file URI to backslash path", () => {
    if (process.platform !== "win32") return;
    expect(decodeFileUri("file:///c%3A/code/foo")).toBe("c:\\code\\foo");
  });

  it("returns null for non-file:// schemes", () => {
    expect(decodeFileUri("vscode-remote://ssh-remote+host/foo")).toBe(null);
    expect(decodeFileUri(null)).toBe(null);
    expect(decodeFileUri(undefined)).toBe(null);
  });

  it("falls back to the raw slice on a malformed percent-sequence (no throw)", () => {
    // A corrupt file:// URI must not throw URIError.
    expect(() => decodeFileUri("file:///c%/oops")).not.toThrow();
    expect(typeof decodeFileUri("file:///c%/oops")).toBe("string");
  });
});
