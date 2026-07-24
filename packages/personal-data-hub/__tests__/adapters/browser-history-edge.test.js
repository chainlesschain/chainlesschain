"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  BrowserHistoryEdgeAdapter,
  BROWSER_HISTORY_EDGE_NAME,
  BROWSER_HISTORY_EDGE_VERSION,
} = require("../../lib/adapters/browser-history-edge");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, ITEM_SUBTYPES } = require("../../lib/constants");
const {
  defaultEdgeProfileDir,
  epochMsToWebkitUs,
} = require("../../lib/adapters/browser-history-chrome/chrome-db-reader");

const VISIT_MS = 1_700_000_001_000;

let tempDir;
let profileDir;
let historyPath;

function buildHistoryFixture() {
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
  const timestamp = epochMsToWebkitUs(VISIT_MS).toString();
  db.prepare("INSERT INTO urls(url,title,last_visit_time) VALUES(?,?,?)").run(
    "https://bing.com",
    "Bing",
    timestamp,
  );
  db.prepare("INSERT INTO visits(url,visit_time,transition) VALUES(1,?,1)").run(
    timestamp,
  );
  db.close();
}

async function collect(adapter, opts = {}) {
  const rows = [];
  for await (const row of adapter.sync(opts)) rows.push(row);
  return rows;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edge-adapter-test-"));
  profileDir = join(tempDir, "Default");
  historyPath = join(profileDir, "History");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("BrowserHistoryEdgeAdapter contract and defaults", () => {
  it("inherits the bounded Chromium collection contract", () => {
    const adapter = new BrowserHistoryEdgeAdapter({
      defaultProfileDir: () => null,
    });
    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(BROWSER_HISTORY_EDGE_NAME);
    expect(adapter.name).toBe("browser-history-edge");
    expect(adapter.version).toBe(BROWSER_HISTORY_EDGE_VERSION);
    expect(adapter.version).toBe("0.3.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:edge-history-sqlite",
        "sync:edge-downloads-sqlite",
        "sync:edge-bookmarks-json",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.watermarkStrategy).toBe("max-captured-at");
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
  });

  it("resolves the platform-correct default Edge profile", () => {
    const localAppData = join(tempDir, "LocalAppData");
    const profile = defaultEdgeProfileDir({
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
      homedir: tempDir,
      fs: require("node:fs"),
    });
    expect(profile).toBe(
      join(localAppData, "Microsoft", "Edge", "User Data", "Default"),
    );
  });
});

describe("BrowserHistoryEdgeAdapter collection and normalization", () => {
  it("collects Edge visits with a hashed profile identity", async () => {
    buildHistoryFixture();
    const adapter = new BrowserHistoryEdgeAdapter({
      profilePath: profileDir,
    });
    const rows = await collect(adapter);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "visit",
      capturedAt: VISIT_MS,
    });
    expect(rows[0].originalId).toMatch(/^edge-visit:[a-f0-9]{24}:1$/u);
    expect(rows[0].payload.profileId).toMatch(/^[a-f0-9]{24}$/u);
    expect(JSON.stringify(rows)).not.toContain(profileDir);
  });

  it("normalizes Edge visits without an absolute profile path", () => {
    const adapter = new BrowserHistoryEdgeAdapter({
      defaultProfileDir: () => null,
    });
    const { events } = adapter.normalize({
      kind: "visit",
      originalId: "edge-visit:profile:42",
      capturedAt: VISIT_MS,
      payload: {
        profileId: "profile",
        visitId: 42,
        url: "https://bing.com",
        title: "Bing",
        visitTimeMs: VISIT_MS,
        transition: "link",
        rawTransition: 0,
      },
    });
    expect(events[0].subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(events[0].id).toBe("event-edge-visit-profile-42");
    expect(events[0].source.originalId).toBe("edge-visit:profile:42");
    expect(events[0].source.adapter).toBe("browser-history-edge");
    expect(events[0].extra.browser).toBe("edge");
    expect(events[0].extra.profileId).toBe("profile");
    expect(events[0].extra).not.toHaveProperty("profileDir");
  });

  it("normalizes Edge bookmarks with the profile-scoped ID", () => {
    const adapter = new BrowserHistoryEdgeAdapter({
      defaultProfileDir: () => null,
    });
    const { items } = adapter.normalize({
      kind: "bookmark",
      originalId: "edge-bookmark:profile:g1",
      capturedAt: VISIT_MS,
      payload: {
        profileId: "profile",
        guid: "g1",
        name: "Bing",
        url: "https://bing.com",
        dateAddedMs: VISIT_MS,
        folderPath: "\u4e66\u7b7e\u680f",
      },
    });
    expect(items[0].subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(items[0].id).toBe("item-edge-bookmark-profile-g1");
    expect(items[0].source.originalId).toBe("edge-bookmark:profile:g1");
    expect(items[0].extra.browser).toBe("edge");
    expect(items[0].extra).not.toHaveProperty("profileDir");
  });

  it("reports a missing Edge profile without leaking its path", async () => {
    const adapter = new BrowserHistoryEdgeAdapter({
      profilePath: profileDir,
    });
    const result = await adapter.authenticate();
    expect(result).toMatchObject({
      ok: false,
      reason: "PROFILE_NOT_FOUND",
    });
    expect(result.message).toContain("edge");
    expect(result.message).not.toContain("chrome");
    expect(JSON.stringify(result)).not.toContain(profileDir);
  });
});
