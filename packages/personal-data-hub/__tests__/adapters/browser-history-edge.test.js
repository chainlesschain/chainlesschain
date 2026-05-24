"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  BrowserHistoryEdgeAdapter,
  BROWSER_HISTORY_EDGE_NAME,
  BROWSER_HISTORY_EDGE_VERSION,
} = require("../../lib/adapters/browser-history-edge");
const { assertAdapter } = require("../../lib/adapter-spec");
const {
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
} = require("../../lib/constants");
const {
  epochMsToWebkitUs,
  defaultEdgeProfileDir,
} = require("../../lib/adapters/browser-history-chrome/chrome-db-reader");

let tmpDir;
let profileDir;
let historyPath;

function buildHistoryFixture() {
  mkdirSync(profileDir, { recursive: true });
  const db = new Database(historyPath);
  db.exec(`
    CREATE TABLE urls(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url LONGVARCHAR, title LONGVARCHAR,
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
  const t = epochMsToWebkitUs(1_700_000_001_000).toString();
  db.prepare(
    "INSERT INTO urls(url, title, last_visit_time) VALUES('https://bing.com', 'Bing', ?)",
  ).run(t);
  db.prepare(
    "INSERT INTO visits(url, visit_time, transition) VALUES(1, ?, 1)",
  ).run(t);
  db.close();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "edge-adapter-test-"));
  profileDir = join(tmpDir, "Default");
  historyPath = join(profileDir, "History");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("BrowserHistoryEdgeAdapter — contract + defaults", () => {
  it("conforms to PersonalDataAdapter contract", () => {
    const adapter = new BrowserHistoryEdgeAdapter();
    expect(assertAdapter(adapter)).toEqual({ ok: true });
  });

  it("identifies as browser-history-edge with edge-prefixed capabilities", () => {
    const adapter = new BrowserHistoryEdgeAdapter();
    expect(adapter.name).toBe(BROWSER_HISTORY_EDGE_NAME);
    expect(adapter.name).toBe("browser-history-edge");
    expect(adapter.version).toBe(BROWSER_HISTORY_EDGE_VERSION);
    expect(adapter.capabilities).toContain("sync:edge-history-sqlite");
    expect(adapter.capabilities).toContain("sync:edge-bookmarks-json");
  });

  it("defaultEdgeProfileDir resolves to platform-correct Edge path", () => {
    const dir = defaultEdgeProfileDir();
    expect(typeof dir === "string" || dir === null).toBe(true);
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
      expect(dir).toBe(
        join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "User Data", "Default"),
      );
    }
  });
});

describe("BrowserHistoryEdgeAdapter — sync + normalize use edge prefix", () => {
  it("yields visits with edge-visit: originalId prefix", async () => {
    buildHistoryFixture();
    const adapter = new BrowserHistoryEdgeAdapter({ profilePath: profileDir });
    const raws = [];
    for await (const r of adapter.sync()) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].kind).toBe("visit");
    expect(raws[0].originalId).toMatch(/^edge-visit:/);
  });

  it("normalize emits browser='edge' in extra + event id prefixed edge", () => {
    const adapter = new BrowserHistoryEdgeAdapter();
    const { events } = adapter.normalize({
      kind: "visit",
      capturedAt: 1_700_000_000_000,
      payload: {
        visitId: 42,
        url: "https://bing.com",
        title: "Bing",
        visitTimeMs: 1_700_000_000_000,
        visitDurationMs: 0,
        transition: "link",
        rawTransition: 0,
        profileDir: "/p/Default",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].extra.browser).toBe("edge");
    expect(events[0].id).toBe("event-edge-visit-42");
    expect(events[0].subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(events[0].source.originalId).toBe("edge-visit:/p/Default:42");
    expect(events[0].source.adapter).toBe("browser-history-edge");
  });

  it("normalize bookmark emits browser='edge'", () => {
    const adapter = new BrowserHistoryEdgeAdapter();
    const { items } = adapter.normalize({
      kind: "bookmark",
      capturedAt: 1_700_000_000_000,
      payload: {
        guid: "g1",
        name: "Bing",
        url: "https://bing.com",
        dateAddedMs: 1_600_000_000_000,
        folderPath: "书签栏",
        profileDir: "/p/Default",
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].extra.browser).toBe("edge");
    expect(items[0].id).toBe("item-edge-bookmark-g1");
    expect(items[0].subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(items[0].source.originalId).toBe("edge-bookmark:/p/Default:g1");
  });

  it("PROFILE_NOT_FOUND error message mentions edge, not chrome", async () => {
    const adapter = new BrowserHistoryEdgeAdapter({ profilePath: profileDir });
    const r = await adapter.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("PROFILE_NOT_FOUND");
    expect(r.message).toContain("edge");
    expect(r.message).not.toContain("Chrome");
  });
});
