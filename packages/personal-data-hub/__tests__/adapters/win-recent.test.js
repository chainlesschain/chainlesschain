"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  WinRecentAdapter,
  WIN_RECENT_NAME,
  WIN_RECENT_VERSION,
} = require("../../lib/adapters/win-recent");
const { assertAdapter } = require("../../lib/adapter-spec");
const {
  EVENT_SUBTYPES,
} = require("../../lib/constants");
const { validateEvent } = require("../../lib/schemas");

let tmpDir;
let recentDir;

function makeLnk(name, mtimeMs, body = "lnk-blob") {
  const p = join(recentDir, name);
  writeFileSync(p, body, "utf-8");
  if (mtimeMs != null) {
    utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "win-recent-test-"));
  recentDir = join(tmpDir, "Recent");
  mkdirSync(recentDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("WinRecentAdapter — contract + identity", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    expect(assertAdapter(new WinRecentAdapter())).toEqual({ ok: true });
  });

  it("name + version + capabilities stable", () => {
    const a = new WinRecentAdapter();
    expect(a.name).toBe(WIN_RECENT_NAME);
    expect(a.name).toBe("win-recent");
    expect(a.version).toBe(WIN_RECENT_VERSION);
    expect(a.extractMode).toBe("file-import");
    expect(a.capabilities).toContain("sync:win-recent-shortcuts");
  });
});

describe("WinRecentAdapter.authenticate", () => {
  it("PLATFORM_UNSUPPORTED when no recentDir resolved (override null)", async () => {
    const a = new WinRecentAdapter();
    a._deps.defaultDir = () => null;
    const r = await a.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("PLATFORM_UNSUPPORTED");
  });

  it("RECENT_DIR_NOT_FOUND when dir doesn't exist", async () => {
    const a = new WinRecentAdapter({ recentDir: join(tmpDir, "bogus") });
    const r = await a.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("RECENT_DIR_NOT_FOUND");
  });

  it("succeeds when dir exists", async () => {
    const a = new WinRecentAdapter({ recentDir });
    const r = await a.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.recentDir).toBe(recentDir);
  });
});

describe("WinRecentAdapter.sync", () => {
  it("yields one raw per .lnk, sorted mtime ascending", async () => {
    makeLnk("zebra.lnk", 1_700_000_003_000);
    makeLnk("apple.lnk", 1_700_000_001_000);
    makeLnk("mango.lnk", 1_700_000_002_000);
    const a = new WinRecentAdapter({ recentDir });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(3);
    expect(raws[0].payload.name).toBe("apple");
    expect(raws[1].payload.name).toBe("mango");
    expect(raws[2].payload.name).toBe("zebra");
    expect(raws[0].payload.mtimeMs).toBe(1_700_000_001_000);
  });

  it("skips non-.lnk files and AutomaticDestinations / CustomDestinations subdirs", async () => {
    makeLnk("a.lnk", 1_700_000_001_000);
    makeLnk("readme.txt", 1_700_000_002_000); // non-.lnk
    mkdirSync(join(recentDir, "AutomaticDestinations"), { recursive: true });
    writeFileSync(
      join(recentDir, "AutomaticDestinations", "deep.lnk"),
      "should-not-be-found",
    );
    mkdirSync(join(recentDir, "CustomDestinations"), { recursive: true });
    const a = new WinRecentAdapter({ recentDir });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].payload.name).toBe("a");
  });

  it("respects since filter (epoch ms)", async () => {
    makeLnk("old.lnk", 1_700_000_001_000);
    makeLnk("new.lnk", 1_700_000_005_000);
    const a = new WinRecentAdapter({ recentDir });
    const raws = [];
    for await (const r of a.sync({ since: 1_700_000_003_000 })) raws.push(r);
    expect(raws.map((r) => r.payload.name)).toEqual(["new"]);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 10; i++) makeLnk(`f${i}.lnk`, 1_700_000_000_000 + i * 1000);
    const a = new WinRecentAdapter({ recentDir });
    const raws = [];
    for await (const r of a.sync({ limit: 4 })) raws.push(r);
    expect(raws).toHaveLength(4);
  });

  it("originalId folds in mtime so same file at new mtime gets a new event", async () => {
    makeLnk("foo.lnk", 1_700_000_001_000);
    const a = new WinRecentAdapter({ recentDir });
    const raws1 = [];
    for await (const r of a.sync()) raws1.push(r);
    const id1 = raws1[0].originalId;
    // Re-touch with a newer mtime
    makeLnk("foo.lnk", 1_700_000_009_000);
    const raws2 = [];
    for await (const r of a.sync()) raws2.push(r);
    const id2 = raws2[0].originalId;
    expect(id1).not.toBe(id2);
    expect(id2).toContain("1700000009000");
  });
});

describe("WinRecentAdapter.normalize", () => {
  it("maps recent-file to Event(OTHER) with '打开了 X' title", () => {
    const a = new WinRecentAdapter();
    const { events } = a.normalize({
      kind: "recent-file",
      originalId: "win-recent:C:\\Users\\u\\Recent\\foo.lnk:1700000001000",
      capturedAt: 1_700_000_005_000,
      payload: {
        name: "foo",
        mtimeMs: 1_700_000_001_000,
        size: 1024,
        lnkPath: "C:\\Users\\u\\Recent\\foo.lnk",
      },
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(e.content.title).toBe("打开了 foo");
    expect(e.content.text).toBe("foo");
    expect(e.actor).toBe("self");
    expect(e.occurredAt).toBe(1_700_000_001_000);
    expect(e.extra.kind).toBe("recent-file");
    expect(e.extra.targetName).toBe("foo");
    expect(e.extra.source).toBe("win-recent");
    expect(validateEvent(e).valid).toBe(true);
  });

  it("truncates long target names in title", () => {
    const a = new WinRecentAdapter();
    const longName = "x".repeat(120);
    const { events } = a.normalize({
      kind: "recent-file",
      originalId: "win-recent:long",
      capturedAt: 1_700_000_000_000,
      payload: {
        name: longName,
        mtimeMs: 1_700_000_000_000,
      },
    });
    // Title is "打开了 " (4 chars) + name; name truncated to 70 + "…"
    expect(events[0].content.title.endsWith("…")).toBe(true);
    expect(events[0].content.text).toBe(longName); // full name preserved in text
  });

  it("throws on unknown raw.kind", () => {
    expect(() => new WinRecentAdapter().normalize({ kind: "bogus", payload: {} })).toThrow(
      /unknown raw\.kind=bogus/,
    );
  });
});
