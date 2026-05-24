"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  BrowserHistoryChromeAdapter,
  BROWSER_HISTORY_CHROME_NAME,
  BROWSER_HISTORY_CHROME_VERSION,
} = require("../../lib/adapters/browser-history-chrome");
const { assertAdapter } = require("../../lib/adapter-spec");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
} = require("../../lib/constants");
const { validateEvent, validateItem } = require("../../lib/schemas");
const {
  epochMsToWebkitUs,
  webkitUsToEpochMs,
  decodeTransition,
} = require("../../lib/adapters/browser-history-chrome");

let tmpDir;
let profileDir;
let historyPath;
let bookmarksPath;

// Build a minimal Chrome-shaped History SQLite + Bookmarks JSON inside a
// throwaway profile dir.
function buildFixture({ visits = [], bookmarks = null } = {}) {
  mkdirSync(profileDir, { recursive: true });
  const db = new Database(historyPath);
  db.exec(`
    CREATE TABLE urls(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url LONGVARCHAR,
      title LONGVARCHAR,
      visit_count INTEGER DEFAULT 0 NOT NULL,
      typed_count INTEGER DEFAULT 0 NOT NULL,
      last_visit_time INTEGER NOT NULL,
      hidden INTEGER DEFAULT 0 NOT NULL
    );
    CREATE TABLE visits(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url INTEGER NOT NULL,
      visit_time INTEGER NOT NULL,
      from_visit INTEGER,
      transition INTEGER DEFAULT 0 NOT NULL,
      visit_duration INTEGER DEFAULT 0 NOT NULL
    );
  `);
  const urlsByUrl = new Map();
  const insertUrl = db.prepare(
    "INSERT INTO urls(url, title, visit_count, last_visit_time, hidden) VALUES(?, ?, ?, ?, ?)",
  );
  const insertVisit = db.prepare(
    "INSERT INTO visits(url, visit_time, transition, visit_duration) VALUES(?, ?, ?, ?)",
  );
  for (const v of visits) {
    let urlId = urlsByUrl.get(v.url);
    if (!urlId) {
      const r = insertUrl.run(
        v.url,
        v.title || "",
        v.visitCount || 1,
        epochMsToWebkitUs(v.visitTimeMs).toString(),
        v.hidden ? 1 : 0,
      );
      urlId = r.lastInsertRowid;
      urlsByUrl.set(v.url, urlId);
    }
    insertVisit.run(
      urlId,
      epochMsToWebkitUs(v.visitTimeMs).toString(),
      v.rawTransition != null ? v.rawTransition : 1,
      v.visitDurationMs != null ? v.visitDurationMs * 1000 : 0,
    );
  }
  db.close();

  if (bookmarks) {
    writeFileSync(bookmarksPath, JSON.stringify(bookmarks), "utf-8");
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "chrome-adapter-test-"));
  profileDir = join(tmpDir, "Default");
  historyPath = join(profileDir, "History");
  bookmarksPath = join(profileDir, "Bookmarks");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("BrowserHistoryChromeAdapter — contract", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    const adapter = new BrowserHistoryChromeAdapter();
    const r = assertAdapter(adapter);
    expect(r).toEqual({ ok: true });
  });

  it("exposes stable name/version/capabilities", () => {
    const adapter = new BrowserHistoryChromeAdapter();
    expect(adapter.name).toBe(BROWSER_HISTORY_CHROME_NAME);
    expect(adapter.version).toBe(BROWSER_HISTORY_CHROME_VERSION);
    expect(adapter.extractMode).toBe("file-import");
    expect(adapter.capabilities).toContain("sync:chrome-history-sqlite");
    expect(adapter.dataDisclosure.sensitivity).toBe("high");
    expect(adapter.dataDisclosure.legalGate).toBe(false);
  });
});

describe("BrowserHistoryChromeAdapter.authenticate", () => {
  it("returns PROFILE_NOT_FOUND when History missing", async () => {
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("PROFILE_NOT_FOUND");
  });

  it("succeeds when History present", async () => {
    buildFixture({ visits: [{ url: "https://a.test", title: "A", visitTimeMs: 1_700_000_000_000 }] });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.profileDir).toBe(profileDir);
  });

  it("ctx.profilePath overrides constructor opts", async () => {
    buildFixture({ visits: [{ url: "https://x.test", title: "X", visitTimeMs: 1_700_000_000_000 }] });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: "/nonexistent/dir" });
    const r = await adapter.authenticate({ profilePath: profileDir });
    expect(r.ok).toBe(true);
    expect(r.profileDir).toBe(profileDir);
  });
});

describe("BrowserHistoryChromeAdapter.sync", () => {
  it("yields visits in occurredAt-ascending order", async () => {
    buildFixture({
      visits: [
        { url: "https://b.test", title: "B", visitTimeMs: 1_700_000_002_000 },
        { url: "https://a.test", title: "A", visitTimeMs: 1_700_000_001_000 },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const raws = [];
    for await (const r of adapter.sync()) raws.push(r);
    const visits = raws.filter((r) => r.kind === "visit");
    expect(visits).toHaveLength(2);
    expect(visits[0].payload.url).toBe("https://a.test");
    expect(visits[1].payload.url).toBe("https://b.test");
    expect(visits[0].payload.visitTimeMs).toBe(1_700_000_001_000);
  });

  it("filters by since (epoch ms → WebKit microseconds)", async () => {
    buildFixture({
      visits: [
        { url: "https://old.test", title: "Old", visitTimeMs: 1_700_000_000_000 },
        { url: "https://new.test", title: "New", visitTimeMs: 1_700_000_005_000 },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const raws = [];
    for await (const r of adapter.sync({ since: 1_700_000_003_000 })) raws.push(r);
    const urls = raws.filter((r) => r.kind === "visit").map((r) => r.payload.url);
    expect(urls).toEqual(["https://new.test"]);
  });

  it("skips hidden urls by default", async () => {
    buildFixture({
      visits: [
        { url: "https://shown.test", title: "S", visitTimeMs: 1_700_000_001_000, hidden: false },
        { url: "https://hidden.test", title: "H", visitTimeMs: 1_700_000_002_000, hidden: true },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const raws = [];
    for await (const r of adapter.sync()) raws.push(r);
    const urls = raws.filter((r) => r.kind === "visit").map((r) => r.payload.url);
    expect(urls).toEqual(["https://shown.test"]);
  });

  it("includes hidden urls when opts.includeHidden=true", async () => {
    buildFixture({
      visits: [
        { url: "https://shown.test", title: "S", visitTimeMs: 1_700_000_001_000, hidden: false },
        { url: "https://hidden.test", title: "H", visitTimeMs: 1_700_000_002_000, hidden: true },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const raws = [];
    for await (const r of adapter.sync({ includeHidden: true })) raws.push(r);
    expect(raws.filter((r) => r.kind === "visit")).toHaveLength(2);
  });

  it("yields bookmarks from all three root folders with folder path", async () => {
    buildFixture({
      visits: [{ url: "https://x.test", title: "X", visitTimeMs: 1_700_000_000_000 }],
      bookmarks: {
        version: 1,
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "书签栏",
            children: [
              { type: "url", id: "1", guid: "g1", url: "https://b1.test", name: "B1", date_added: "13300000000000000" },
            ],
          },
          other: {
            type: "folder",
            name: "other",
            children: [
              {
                type: "folder",
                name: "Tech",
                children: [
                  { type: "url", id: "2", guid: "g2", url: "https://t1.test", name: "T1", date_added: "13300000000000000" },
                ],
              },
            ],
          },
          synced: { type: "folder", name: "synced", children: [] },
        },
      },
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const bms = [];
    for await (const r of adapter.sync()) if (r.kind === "bookmark") bms.push(r);
    expect(bms).toHaveLength(2);
    const byGuid = Object.fromEntries(bms.map((r) => [r.payload.guid, r.payload]));
    expect(byGuid.g1.folderPath).toBe("书签栏");
    expect(byGuid.g2.folderPath).toMatch(/其他书签 \/ Tech/);
    expect(typeof byGuid.g1.dateAddedMs).toBe("number");
  });

  it("respects per-kind include gates", async () => {
    buildFixture({
      visits: [{ url: "https://x.test", title: "X", visitTimeMs: 1_700_000_000_000 }],
      bookmarks: {
        version: 1,
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "bar",
            children: [
              { type: "url", id: "1", guid: "g1", url: "https://b1.test", name: "B1", date_added: "13300000000000000" },
            ],
          },
        },
      },
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    const raws1 = [];
    for await (const r of adapter.sync({ include: { history: false } })) raws1.push(r);
    expect(raws1.every((r) => r.kind === "bookmark")).toBe(true);
    expect(raws1.length).toBeGreaterThan(0);
    const raws2 = [];
    for await (const r of adapter.sync({ include: { bookmarks: false } })) raws2.push(r);
    expect(raws2.every((r) => r.kind === "visit")).toBe(true);
    expect(raws2.length).toBeGreaterThan(0);
  });
});

describe("BrowserHistoryChromeAdapter.normalize", () => {
  it("maps a visit to a schema-valid Event(BROWSE)", () => {
    const adapter = new BrowserHistoryChromeAdapter();
    const raw = {
      kind: "visit",
      originalId: "chrome-visit:/p/Default:42",
      capturedAt: 1_700_000_000_000,
      payload: {
        visitId: 42,
        url: "https://a.test/x?y=1",
        title: "Hello",
        visitTimeMs: 1_700_000_000_500,
        visitDurationMs: 2000,
        transition: "link",
        rawTransition: 805306369,
        visitCount: 3,
        typedCount: 0,
        hidden: false,
        fromVisit: 0,
        profileDir: "/p/Default",
      },
    };
    const { events, items } = adapter.normalize(raw);
    expect(items).toEqual([]);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.type).toBe(ENTITY_TYPES.EVENT);
    expect(e.subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(e.actor).toBe("self");
    expect(e.content.title).toBe("Hello");
    expect(e.content.text).toBe("https://a.test/x?y=1");
    expect(e.durationMs).toBe(2000);
    expect(e.extra.url).toBe("https://a.test/x?y=1");
    expect(e.extra.transition).toBe("link");
    expect(e.extra.browser).toBe("chrome");
    expect(validateEvent(e).valid).toBe(true);
  });

  it("maps a bookmark to a schema-valid Item(LINK)", () => {
    const adapter = new BrowserHistoryChromeAdapter();
    const raw = {
      kind: "bookmark",
      originalId: "chrome-bookmark:/p/Default:guid-1",
      capturedAt: 1_700_000_000_000,
      payload: {
        id: "1",
        guid: "guid-1",
        name: "Anthropic",
        url: "https://anthropic.com",
        dateAddedMs: 1_600_000_000_000,
        folderPath: "书签栏 / AI",
        profileDir: "/p/Default",
      },
    };
    const { events, items } = adapter.normalize(raw);
    expect(events).toEqual([]);
    expect(items).toHaveLength(1);
    const it = items[0];
    expect(it.subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(it.name).toBe("Anthropic");
    expect(it.extra.url).toBe("https://anthropic.com");
    expect(it.extra.folderPath).toBe("书签栏 / AI");
    expect(it.extra.browser).toBe("chrome");
    expect(validateItem(it).valid).toBe(true);
  });

  it("truncates very long titles to 200 chars", () => {
    const adapter = new BrowserHistoryChromeAdapter();
    const raw = {
      kind: "visit",
      capturedAt: 1_700_000_000_000,
      payload: {
        visitId: 1,
        url: "https://x.test",
        title: "A".repeat(500),
        visitTimeMs: 1_700_000_000_000,
        visitDurationMs: 0,
        transition: "link",
        rawTransition: 0,
        profileDir: "/p",
      },
    };
    const { events } = adapter.normalize(raw);
    expect(events[0].content.title.length).toBeLessThanOrEqual(201); // 200 + "…"
    expect(events[0].content.title.endsWith("…")).toBe(true);
  });

  it("throws on unknown raw.kind", () => {
    const adapter = new BrowserHistoryChromeAdapter();
    expect(() => adapter.normalize({ kind: "bogus", payload: {} })).toThrow(/unknown raw\.kind=bogus/);
  });
});

describe("WebKit timestamp helpers", () => {
  it("round-trips epoch ms ↔ WebKit microseconds", () => {
    const ms = 1_700_000_000_000;
    const wk = epochMsToWebkitUs(ms);
    expect(webkitUsToEpochMs(wk)).toBe(ms);
  });

  it("decodes transition lower 8 bits", () => {
    expect(decodeTransition(805306369)).toBe("typed"); // 0x30000001 → core=1
    expect(decodeTransition(268435464)).toBe("reload"); // 0x10000008 → core=8
    expect(decodeTransition(0)).toBe("link");
    expect(decodeTransition(null)).toBe(null);
  });
});
