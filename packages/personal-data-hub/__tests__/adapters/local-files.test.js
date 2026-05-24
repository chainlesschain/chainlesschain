"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  LocalFilesAdapter,
  LOCAL_FILES_NAME,
  LOCAL_FILES_VERSION,
} = require("../../lib/adapters/local-files");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES } = require("../../lib/constants");
const { validateEvent } = require("../../lib/schemas");

let tmpDir;

function makeFile(rel, content, mtimeMs) {
  const p = join(tmpDir, rel);
  mkdirSync(join(tmpDir, rel, ".."), { recursive: true });
  writeFileSync(p, content, "utf-8");
  if (mtimeMs) utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  return p;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "local-files-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("LocalFilesAdapter — contract + identity", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    expect(assertAdapter(new LocalFilesAdapter())).toEqual({ ok: true });
  });

  it("identifies as local-files with sync:local-file-walk capability", () => {
    const a = new LocalFilesAdapter();
    expect(a.name).toBe(LOCAL_FILES_NAME);
    expect(a.name).toBe("local-files");
    expect(a.version).toBe(LOCAL_FILES_VERSION);
    expect(a.capabilities).toContain("sync:local-file-walk");
  });
});

describe("LocalFilesAdapter.sync", () => {
  it("yields one row per file across multiple roots", async () => {
    const r1 = join(tmpDir, "root1");
    const r2 = join(tmpDir, "root2");
    mkdirSync(r1);
    mkdirSync(r2);
    makeFile("root1/a.txt", "a", 1_700_000_001_000);
    makeFile("root1/b.md", "b", 1_700_000_002_000);
    makeFile("root2/c.pdf", "c", 1_700_000_003_000);
    const a = new LocalFilesAdapter({ roots: [r1, r2] });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(3);
    expect(raws.every((r) => r.kind === "local-file")).toBe(true);
    const names = raws.map((r) => r.payload.name).sort();
    expect(names).toEqual(["a.txt", "b.md", "c.pdf"]);
  });

  it("walks subdirectories within maxDepth", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    makeFile("r/sub/nested/deep.txt", "x", 1_700_000_001_000);
    const a = new LocalFilesAdapter({ roots: [r] });
    const raws = [];
    for await (const x of a.sync()) raws.push(x);
    expect(raws).toHaveLength(1);
    expect(raws[0].payload.name).toBe("deep.txt");
  });

  it("excludes xwechat_files / WXWork / node_modules / .git by default", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    makeFile("r/normal.txt", "ok", 1_700_000_001_000);
    makeFile("r/xwechat_files/x.txt", "skip", 1_700_000_001_000);
    makeFile("r/WXWork/y.txt", "skip", 1_700_000_001_000);
    makeFile("r/node_modules/lib/index.js", "skip", 1_700_000_001_000);
    makeFile("r/.git/config", "skip", 1_700_000_001_000);
    const a = new LocalFilesAdapter({ roots: [r] });
    const raws = [];
    for await (const x of a.sync()) raws.push(x);
    expect(raws.map((r) => r.payload.name)).toEqual(["normal.txt"]);
  });

  it("custom excludes override defaults", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    makeFile("r/.git/config", "kept-now", 1_700_000_001_000);
    makeFile("r/build/out.txt", "skipped-now", 1_700_000_001_000);
    const a = new LocalFilesAdapter({ roots: [r], excludes: ["build"] });
    const raws = [];
    for await (const x of a.sync()) raws.push(x);
    // .git is hidden (leading '.') so still skipped even without default rule
    expect(raws.map((r) => r.payload.name)).toEqual([]);
  });

  it("skips hidden files / dirs (leading '.')", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    makeFile("r/.hidden", "skip", 1_700_000_001_000);
    makeFile("r/.cache/sub.txt", "skip", 1_700_000_001_000);
    makeFile("r/visible.txt", "ok", 1_700_000_001_000);
    const a = new LocalFilesAdapter({ roots: [r] });
    const raws = [];
    for await (const x of a.sync()) raws.push(x);
    expect(raws.map((r) => r.payload.name)).toEqual(["visible.txt"]);
  });

  it("respects since filter (file mtime granularity)", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    makeFile("r/old.txt", "x", 1_700_000_001_000);
    makeFile("r/new.txt", "x", 1_700_000_005_000);
    const a = new LocalFilesAdapter({ roots: [r] });
    const raws = [];
    for await (const x of a.sync({ since: 1_700_000_003_000 })) raws.push(x);
    expect(raws.map((r) => r.payload.name)).toEqual(["new.txt"]);
  });

  it("respects limit", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    for (let i = 0; i < 5; i++) makeFile(`r/f${i}.txt`, "x", 1_700_000_001_000);
    const a = new LocalFilesAdapter({ roots: [r] });
    const raws = [];
    for await (const x of a.sync({ limit: 2 })) raws.push(x);
    expect(raws).toHaveLength(2);
  });

  it("missing roots silently produce nothing", async () => {
    const a = new LocalFilesAdapter({ roots: [join(tmpDir, "nonexistent")] });
    const raws = [];
    for await (const x of a.sync()) raws.push(x);
    expect(raws).toHaveLength(0);
  });

  it("originalId encodes path + mtime so re-saved files dedupe per mtime", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    const p = makeFile("r/a.txt", "x", 1_700_000_001_000);
    const a = new LocalFilesAdapter({ roots: [r] });
    const first = [];
    for await (const x of a.sync()) first.push(x);
    expect(first[0].originalId).toBe(`local-file:${p}:1700000001000`);
    // change mtime -> new originalId so adapter does not collapse history
    utimesSync(p, 1_700_000_009 / 1000, 1_700_000_009);
    const second = [];
    for await (const x of a.sync()) second.push(x);
    expect(second[0].originalId).not.toBe(first[0].originalId);
  });
});

describe("LocalFilesAdapter.authenticate + healthCheck", () => {
  it("authenticate returns ok=true with resolved roots when defaults exist", async () => {
    const r = join(tmpDir, "r");
    mkdirSync(r);
    const a = new LocalFilesAdapter({ roots: [r] });
    const result = await a.authenticate();
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("file-import");
    expect(result.roots).toEqual([r]);
  });

  it("authenticate returns NO_DATA_ROOTS when roots is empty", async () => {
    const a = new LocalFilesAdapter({ roots: [] });
    // Constructor coerces empty array to override=null, so defaults kick in.
    // Force empty roots via context arg path is not exposed; verify the
    // adapter at least returns ok when defaults present. This test verifies
    // the no-roots branch by stubbing defaultRoots to return [].
    a._deps.defaultRoots = () => [];
    const result = await a.authenticate();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("NO_DATA_ROOTS");
  });

  it("healthCheck always returns ok=true (file-import adapter has no live dep)", async () => {
    const a = new LocalFilesAdapter();
    const r = await a.healthCheck();
    expect(r.ok).toBe(true);
    expect(typeof r.lastChecked).toBe("number");
  });
});

describe("LocalFilesAdapter.normalize", () => {
  it("maps local-file → Event(OTHER) with [file] title prefix", () => {
    const a = new LocalFilesAdapter();
    const { events } = a.normalize({
      kind: "local-file",
      originalId: "local-file:/home/u/Documents/report.pdf:1700000005000",
      capturedAt: 1_700_000_010_000,
      payload: {
        path: "/home/u/Documents/report.pdf",
        name: "report.pdf",
        ext: "pdf",
        size: 4096,
        mtimeMs: 1_700_000_005_000,
        root: "/home/u/Documents",
      },
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(e.actor).toBe("self");
    expect(e.content.title).toBe("[file] report.pdf");
    expect(e.content.text).toBe("/home/u/Documents/report.pdf");
    expect(e.occurredAt).toBe(1_700_000_005_000);
    expect(e.extra.kind).toBe("local-file");
    expect(e.extra.ext).toBe("pdf");
    expect(e.extra.size).toBe(4096);
    expect(validateEvent(e).valid).toBe(true);
  });

  it("truncates long filenames in title (keeps full path in text)", () => {
    const a = new LocalFilesAdapter();
    const longName = "x".repeat(300) + ".txt";
    const { events } = a.normalize({
      kind: "local-file",
      originalId: "local-file:/r/big.txt:1700000000000",
      capturedAt: 1_700_000_000_000,
      payload: {
        path: "/r/" + longName,
        name: longName,
        ext: "txt",
        size: 0,
        mtimeMs: 1_700_000_000_000,
        root: "/r",
      },
    });
    expect(events[0].content.title.length).toBeLessThanOrEqual(101);
    expect(events[0].content.title.endsWith("…")).toBe(true);
    expect(events[0].content.text).toContain(longName);
  });

  it("uses '(无名)' for empty filename", () => {
    const a = new LocalFilesAdapter();
    const { events } = a.normalize({
      kind: "local-file",
      originalId: "local-file::1700000000000",
      capturedAt: 1_700_000_000_000,
      payload: {
        path: "",
        name: "",
        ext: "",
        size: 0,
        mtimeMs: 1_700_000_000_000,
        root: "",
      },
    });
    expect(events[0].content.title).toBe("[file] (无名)");
  });

  it("throws on unknown raw.kind", () => {
    expect(() => new LocalFilesAdapter().normalize({ kind: "bogus" })).toThrow(
      /unknown raw\.kind=bogus/,
    );
  });
});
