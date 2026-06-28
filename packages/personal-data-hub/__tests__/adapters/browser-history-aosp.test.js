"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  BrowserHistoryAospAdapter,
  BROWSER_HISTORY_AOSP_NAME,
  BROWSER_HISTORY_AOSP_VERSION,
  normalizeEpochMs,
} = require("../../lib/adapters/browser-history-aosp");
const { assertAdapter } = require("../../lib/adapter-spec");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
} = require("../../lib/constants");
const { validateEvent, validateItem } = require("../../lib/schemas");

let tmpDir;
let dbPath;

// Build a minimal MIUI/AOSP-shaped browser2.db (device-verified schema:
// `history(_id,title,url,date(ms),visits)` + `bookmarks(title,url,folder,deleted)`).
function buildFixture({ history = [], bookmarks = [] } = {}) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE history(
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      url TEXT,
      date INTEGER,
      visits INTEGER DEFAULT 0
    );
    CREATE TABLE bookmarks(
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      url TEXT,
      folder INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      created INTEGER
    );
  `);
  const insH = db.prepare(
    "INSERT INTO history(title, url, date, visits) VALUES(?, ?, ?, ?)",
  );
  for (const h of history) {
    insH.run(h.title ?? null, h.url, h.date, h.visits ?? 0);
  }
  const insB = db.prepare(
    "INSERT INTO bookmarks(title, url, folder, deleted, created) VALUES(?, ?, ?, ?, ?)",
  );
  for (const b of bookmarks) {
    insB.run(b.title ?? null, b.url, b.folder ?? 0, b.deleted ?? 0, b.created ?? null);
  }
  db.close();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aosp-adapter-test-"));
  dbPath = join(tmpDir, "browser2.db");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("BrowserHistoryAospAdapter — contract", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    const adapter = new BrowserHistoryAospAdapter();
    expect(assertAdapter(adapter)).toEqual({ ok: true });
  });

  it("exposes stable name/version/capabilities", () => {
    const adapter = new BrowserHistoryAospAdapter();
    expect(adapter.name).toBe(BROWSER_HISTORY_AOSP_NAME);
    expect(adapter.name).toBe("browser-history-aosp");
    expect(adapter.version).toBe(BROWSER_HISTORY_AOSP_VERSION);
    expect(adapter.extractMode).toBe("file-import");
    expect(adapter.capabilities).toContain("sync:aosp-browser-history-sqlite");
    expect(adapter.capabilities).toContain("sync:aosp-browser-bookmarks-sqlite");
    expect(adapter.dataDisclosure.sensitivity).toBe("high");
  });
});

describe("BrowserHistoryAospAdapter.authenticate", () => {
  it("returns DB_PATH_UNRESOLVED when no path given", async () => {
    const adapter = new BrowserHistoryAospAdapter();
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_PATH_UNRESOLVED");
  });

  it("returns DB_NOT_FOUND when file missing", async () => {
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_NOT_FOUND");
  });

  it("succeeds when browser2.db present (file path)", async () => {
    buildFixture({ history: [{ url: "https://a.test", title: "A", date: 1_700_000_000_000 }] });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.dbPath).toBe(dbPath);
  });

  it("accepts a directory containing browser2.db", async () => {
    buildFixture({ history: [{ url: "https://a.test", title: "A", date: 1_700_000_000_000 }] });
    const adapter = new BrowserHistoryAospAdapter({ dbPath: tmpDir });
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(true);
    expect(r.dbPath).toBe(dbPath);
  });

  it("ctx.dbPath overrides constructor opts", async () => {
    buildFixture({ history: [{ url: "https://x.test", title: "X", date: 1_700_000_000_000 }] });
    const adapter = new BrowserHistoryAospAdapter({ dbPath: "/nonexistent/browser2.db" });
    const r = await adapter.authenticate({ dbPath });
    expect(r.ok).toBe(true);
  });
});

describe("BrowserHistoryAospAdapter.sync", () => {
  it("yields history visits ascending by date with ms timestamps", async () => {
    buildFixture({
      history: [
        { url: "https://b.test", title: "B", date: 1_700_000_002_000, visits: 2 },
        { url: "https://a.test", title: "A", date: 1_700_000_001_000, visits: 5 },
      ],
    });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const visits = [];
    for await (const r of adapter.sync()) if (r.kind === "visit") visits.push(r);
    expect(visits).toHaveLength(2);
    expect(visits[0].payload.url).toBe("https://a.test");
    expect(visits[1].payload.url).toBe("https://b.test");
    expect(visits[0].payload.visitTimeMs).toBe(1_700_000_001_000);
    expect(visits[0].payload.visitCount).toBe(5);
  });

  it("filters by since (epoch ms)", async () => {
    buildFixture({
      history: [
        { url: "https://old.test", title: "Old", date: 1_700_000_000_000 },
        { url: "https://new.test", title: "New", date: 1_700_000_005_000 },
      ],
    });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const urls = [];
    for await (const r of adapter.sync({ since: 1_700_000_003_000 })) {
      if (r.kind === "visit") urls.push(r.payload.url);
    }
    expect(urls).toEqual(["https://new.test"]);
  });

  it("normalizes second-granularity dates to ms", async () => {
    buildFixture({ history: [{ url: "https://s.test", title: "S", date: 1_700_000_000 }] });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const visits = [];
    for await (const r of adapter.sync()) if (r.kind === "visit") visits.push(r);
    expect(visits[0].payload.visitTimeMs).toBe(1_700_000_000_000);
  });

  it("yields only folder=0 / non-deleted bookmark leaves", async () => {
    buildFixture({
      history: [{ url: "https://h.test", title: "H", date: 1_700_000_000_000 }],
      bookmarks: [
        { url: "https://keep.test", title: "Keep", folder: 0, deleted: 0 },
        { url: "https://afolder.test", title: "AFolder", folder: 1, deleted: 0 },
        { url: "https://gone.test", title: "Gone", folder: 0, deleted: 1 },
      ],
    });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const bms = [];
    for await (const r of adapter.sync()) if (r.kind === "bookmark") bms.push(r);
    expect(bms.map((b) => b.payload.url)).toEqual(["https://keep.test"]);
  });

  it("respects per-kind include gates", async () => {
    buildFixture({
      history: [{ url: "https://h.test", title: "H", date: 1_700_000_000_000 }],
      bookmarks: [{ url: "https://b.test", title: "B", folder: 0, deleted: 0 }],
    });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const noHist = [];
    for await (const r of adapter.sync({ include: { history: false } })) noHist.push(r);
    expect(noHist.every((r) => r.kind === "bookmark")).toBe(true);
    expect(noHist.length).toBeGreaterThan(0);
    const noBm = [];
    for await (const r of adapter.sync({ include: { bookmarks: false } })) noBm.push(r);
    expect(noBm.every((r) => r.kind === "visit")).toBe(true);
    expect(noBm.length).toBeGreaterThan(0);
  });

  it("throws when browser2.db is absent", async () => {
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    await expect(async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.sync()) { /* consume */ }
    }).rejects.toThrow(/no browser2\.db/);
  });
});

describe("BrowserHistoryAospAdapter.normalize (inherited Chrome shape)", () => {
  it("maps a visit to a schema-valid Event(BROWSE) tagged browser=aosp", async () => {
    buildFixture({
      history: [{ url: "https://a.test/x?y=1", title: "Hello", date: 1_700_000_000_500, visits: 3 }],
    });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const out = [];
    for await (const raw of adapter.sync({ include: { bookmarks: false } })) {
      out.push(adapter.normalize(raw));
    }
    const events = out.flatMap((b) => b.events);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.type).toBe(ENTITY_TYPES.EVENT);
    expect(e.subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(e.actor).toBe("self");
    expect(e.content.title).toBe("Hello");
    expect(e.content.text).toBe("https://a.test/x?y=1");
    expect(e.occurredAt).toBe(1_700_000_000_500);
    expect(e.extra.url).toBe("https://a.test/x?y=1");
    expect(e.extra.browser).toBe("aosp");
    expect(e.extra.visitCount).toBe(3);
    expect(validateEvent(e).valid).toBe(true);
  });

  it("maps a bookmark to a schema-valid Item(LINK) tagged browser=aosp", async () => {
    buildFixture({
      history: [],
      bookmarks: [{ url: "https://anthropic.com", title: "Anthropic", folder: 0, deleted: 0 }],
    });
    const adapter = new BrowserHistoryAospAdapter({ dbPath });
    const out = [];
    for await (const raw of adapter.sync({ include: { history: false } })) {
      out.push(adapter.normalize(raw));
    }
    const items = out.flatMap((b) => b.items);
    expect(items).toHaveLength(1);
    const it = items[0];
    expect(it.subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(it.name).toBe("Anthropic");
    expect(it.extra.url).toBe("https://anthropic.com");
    expect(it.extra.browser).toBe("aosp");
    expect(validateItem(it).valid).toBe(true);
  });
});

describe("normalizeEpochMs", () => {
  it("scales seconds/ms/µs to ms; rejects junk", () => {
    expect(normalizeEpochMs(1_700_000_000)).toBe(1_700_000_000_000); // s
    expect(normalizeEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000); // ms
    expect(normalizeEpochMs(1_700_000_000_000_000)).toBe(1_700_000_000_000); // µs
    expect(normalizeEpochMs(0)).toBe(null);
    expect(normalizeEpochMs(null)).toBe(null);
    expect(normalizeEpochMs("nan")).toBe(null);
  });
});
