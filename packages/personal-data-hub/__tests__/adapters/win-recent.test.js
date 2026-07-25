"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import fs from "node:fs";

const {
  WinRecentAdapter,
  WIN_RECENT_NAME,
  WIN_RECENT_VERSION,
} = require("../../lib/adapters/win-recent");
const {
  WIN_RECENT_RESET_CURSOR,
  parseWinRecentCursor,
} = require("../../lib/adapters/win-recent/adapter");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES } = require("../../lib/constants");
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

async function collectSync(adapter, opts = {}) {
  const raws = [];
  const updates = [];
  let completed = 0;
  for await (const raw of adapter.sync({
    ...opts,
    updateWatermark: (value) => updates.push(value),
    markWatermarkComplete: () => {
      completed += 1;
    },
  })) {
    raws.push(raw);
  }
  return { raws, updates, completed };
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
    expect(a.version).toBe("0.2.0");
    expect(a.extractMode).toBe("file-import");
    expect(a.watermarkStrategy).toBe("explicit");
    expect(a.watermarkRequiresCompleteScan).toBe(true);
    expect(a.initialPageBudget).toBe(1);
    expect(a.capabilities).toContain("sync:win-recent-shortcuts");
  });

  it("derives stable, isolated scopes from the canonical Recent directory", () => {
    const otherDir = join(tmpDir, "OtherRecent");
    mkdirSync(otherDir);
    const a = new WinRecentAdapter({ recentDir });

    expect(a.resolveDefaultScope()).toMatch(/^account:win-recent:/);
    expect(a.resolveDefaultScope({ recentDir: join(recentDir, ".") })).toBe(
      a.resolveDefaultScope(),
    );
    expect(a.resolveDefaultScope({ recentDir: otherDir })).not.toBe(
      a.resolveDefaultScope(),
    );
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

  it("health-checks a runtime directory when no platform default exists", async () => {
    const a = new WinRecentAdapter();
    a._deps.defaultDir = () => null;

    await expect(a.healthCheck({ recentDir })).resolves.toMatchObject({
      ok: true,
    });
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

  it("breaks equal-mtime ties by exact shortcut path", async () => {
    const mtimeMs = 1_700_000_001_000;
    makeLnk("zebra.lnk", mtimeMs);
    makeLnk("apple.lnk", mtimeMs);
    makeLnk("mango.lnk", mtimeMs);
    const { raws } = await collectSync(new WinRecentAdapter({ recentDir }));

    expect(raws.map((raw) => raw.payload.name)).toEqual([
      "apple",
      "mango",
      "zebra",
    ]);
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
    for (let i = 0; i < 10; i++)
      makeLnk(`f${i}.lnk`, 1_700_000_000_000 + i * 1000);
    const a = new WinRecentAdapter({ recentDir });
    const raws = [];
    for await (const r of a.sync({ limit: 4 })) raws.push(r);
    expect(raws).toHaveLength(4);
  });

  it("publishes the exact continuation before every yield and does not reset on return()", async () => {
    makeLnk("a.lnk", 1_700_000_001_000);
    makeLnk("b.lnk", 1_700_000_002_000);
    const updates = [];
    let completed = 0;
    const iter = new WinRecentAdapter({ recentDir }).sync({
      limit: 1,
      updateWatermark: (value) => updates.push(value),
      markWatermarkComplete: () => {
        completed += 1;
      },
    });

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value.payload.name).toBe("a");
    expect(updates).toHaveLength(1);
    expect(parseWinRecentCursor(updates[0])).toMatchObject({
      after: { mtimeMs: 1_700_000_001_000, path: "a.lnk" },
      upper: { mtimeMs: 1_700_000_002_000, path: "b.lnk" },
    });

    await iter.return();
    expect(updates).toHaveLength(1);
    expect(completed).toBe(0);
  });

  it("resumes a fixed upper bound, resets naturally, then starts a new cycle", async () => {
    for (let index = 1; index <= 5; index += 1) {
      makeLnk(
        `${String.fromCharCode(96 + index)}.lnk`,
        1_700_000_000_000 + index * 1000,
      );
    }
    const adapter = new WinRecentAdapter({ recentDir });

    const first = await collectSync(adapter, { limit: 2 });
    const cursor1 = first.updates.at(-1);
    expect(first.raws.map((raw) => raw.payload.name)).toEqual(["a", "b"]);
    expect(parseWinRecentCursor(cursor1)).toMatchObject({
      after: { path: "b.lnk" },
      upper: { path: "e.lnk" },
    });
    expect(first.completed).toBe(0);

    // Neither a backdated insertion nor a record beyond the fixed upper may
    // perturb the in-progress cycle.
    makeLnk("aa-backdated.lnk", 1_700_000_001_500);
    makeLnk("z-new.lnk", 1_700_000_010_000);

    const second = await collectSync(adapter, {
      limit: 2,
      sinceWatermark: cursor1,
    });
    const cursor2 = second.updates.at(-1);
    expect(second.raws.map((raw) => raw.payload.name)).toEqual(["c", "d"]);
    expect(parseWinRecentCursor(cursor2)).toMatchObject({
      after: { path: "d.lnk" },
      upper: { path: "e.lnk" },
    });
    expect(second.completed).toBe(0);

    const third = await collectSync(adapter, {
      limit: 2,
      sinceWatermark: cursor2,
    });
    expect(third.raws.map((raw) => raw.payload.name)).toEqual(["e"]);
    expect(third.updates.at(-1)).toBe(WIN_RECENT_RESET_CURSOR);
    expect(third.completed).toBe(1);

    const fourth = await collectSync(adapter);
    expect(fourth.raws.map((raw) => raw.payload.name)).toEqual([
      "a",
      "aa-backdated",
      "b",
      "c",
      "d",
      "e",
      "z-new",
    ]);
    expect(fourth.updates.at(-1)).toBe(WIN_RECENT_RESET_CURSOR);
    expect(fourth.completed).toBe(1);
  });

  it("migrates a legacy count by replaying from the start", async () => {
    makeLnk("a.lnk", 1_700_000_001_000);
    makeLnk("b.lnk", 1_700_000_002_000);

    const result = await collectSync(new WinRecentAdapter({ recentDir }), {
      limit: 1,
      sinceWatermark: "928",
    });

    expect(result.raws.map((raw) => raw.payload.name)).toEqual(["a"]);
    expect(parseWinRecentCursor(result.updates.at(-1))).toMatchObject({
      after: { path: "a.lnk" },
      upper: { path: "b.lnk" },
    });
  });

  it("rejects malformed or future cursors without yielding", async () => {
    makeLnk("a.lnk", 1_700_000_001_000);
    const adapter = new WinRecentAdapter({ recentDir });

    await expect(
      collectSync(adapter, { sinceWatermark: "{not-json" }),
    ).rejects.toMatchObject({ code: "WIN_RECENT_CURSOR_INVALID" });
    await expect(
      collectSync(adapter, {
        sinceWatermark: JSON.stringify({
          v: 2,
          after: null,
          upper: null,
        }),
      }),
    ).rejects.toMatchObject({ code: "WIN_RECENT_CURSOR_UNSUPPORTED" });
  });

  it("fails a strict metadata scan before publishing a cursor", async () => {
    makeLnk("a.lnk", 1_700_000_001_000);
    const adapter = new WinRecentAdapter({ recentDir });
    const updates = [];
    adapter._deps.fs = {
      existsSync: fs.existsSync,
      readdirSync: fs.readdirSync,
      statSync() {
        const error = new Error("access denied");
        error.code = "EACCES";
        throw error;
      },
    };

    const consume = async () => {
      for await (const raw of adapter.sync({
        updateWatermark: (value) => updates.push(value),
      })) {
        void raw;
        // No raw may escape an incomplete strict scan.
      }
    };
    await expect(consume()).rejects.toMatchObject({
      code: "WIN_RECENT_SCAN_INCOMPLETE",
    });
    expect(updates).toEqual([]);
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

  it("uses canonical directory identity for alias-stable, source-isolated IDs", async () => {
    const mtimeMs = 1_700_000_001_000;
    makeLnk("same.lnk", mtimeMs);
    const absoluteAdapter = new WinRecentAdapter({ recentDir });
    const aliasAdapter = new WinRecentAdapter({
      recentDir: relative(process.cwd(), recentDir),
    });
    const absolute = await collectSync(absoluteAdapter);
    const alias = await collectSync(aliasAdapter);

    expect(aliasAdapter.resolveDefaultScope()).toBe(
      absoluteAdapter.resolveDefaultScope(),
    );
    expect(alias.raws[0].originalId).toBe(absolute.raws[0].originalId);

    const otherDir = join(tmpDir, "OtherRecent");
    mkdirSync(otherDir);
    const otherPath = join(otherDir, "same.lnk");
    writeFileSync(otherPath, "lnk-blob", "utf8");
    utimesSync(otherPath, mtimeMs / 1000, mtimeMs / 1000);
    const other = await collectSync(
      new WinRecentAdapter({ recentDir: otherDir }),
    );
    expect(other.raws[0].originalId).not.toBe(absolute.raws[0].originalId);
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
    expect(() =>
      new WinRecentAdapter().normalize({ kind: "bogus", payload: {} }),
    ).toThrow(/unknown raw\.kind=bogus/);
  });
});
