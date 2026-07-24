"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  BrowserHistoryBraveAdapter,
  BROWSER_HISTORY_BRAVE_NAME,
  BROWSER_HISTORY_BRAVE_VERSION,
} = require("../../lib/adapters/browser-history-brave");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, ITEM_SUBTYPES } = require("../../lib/constants");
const {
  epochMsToWebkitUs,
} = require("../../lib/adapters/browser-history-chrome");

const VISIT_MS = 1_700_000_001_000;
const BOOKMARK_MS = 1_700_000_002_000;

let tempDir;
let profileDir;

function buildFixture() {
  mkdirSync(profileDir, { recursive: true });
  const db = new Database(join(profileDir, "History"));
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
    "https://brave.com",
    "Brave",
    timestamp,
  );
  db.prepare("INSERT INTO visits(url,visit_time,transition) VALUES(1,?,1)").run(
    timestamp,
  );
  db.close();

  writeFileSync(
    join(profileDir, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          children: [
            {
              type: "url",
              id: "1",
              guid: "brave-bookmark",
              url: "https://search.brave.com",
              name: "Brave Search",
              date_added: epochMsToWebkitUs(BOOKMARK_MS).toString(),
              date_last_used: epochMsToWebkitUs(BOOKMARK_MS).toString(),
            },
          ],
        },
      },
    }),
    "utf8",
  );
}

async function collect(adapter, opts = {}) {
  const rows = [];
  for await (const row of adapter.sync(opts)) rows.push(row);
  return rows;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "brave-adapter-test-"));
  profileDir = join(tempDir, "Default");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("BrowserHistoryBraveAdapter", () => {
  it("inherits the safe Chromium profile contract", () => {
    const adapter = new BrowserHistoryBraveAdapter({
      defaultProfileDir: () => null,
    });
    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(BROWSER_HISTORY_BRAVE_NAME);
    expect(adapter.name).toBe("browser-history-brave");
    expect(adapter.version).toBe(BROWSER_HISTORY_BRAVE_VERSION);
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:brave-history-sqlite",
        "sync:brave-downloads-sqlite",
        "sync:brave-bookmarks-json",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
  });

  it("collects Brave history and bookmarks with path-free profile IDs", async () => {
    buildFixture();
    const adapter = new BrowserHistoryBraveAdapter({
      profilePath: profileDir,
    });
    let complete = false;
    const rows = await collect(adapter, {
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind)).toEqual(["visit", "bookmark"]);
    expect(rows[0].originalId).toMatch(/^brave-visit:[a-f0-9]{24}:1$/u);
    expect(rows[1].originalId).toMatch(
      /^brave-bookmark:[a-f0-9]{24}:brave-bookmark$/u,
    );
    expect(complete).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(profileDir);
  });

  it("normalizes Brave records with profile-scoped stable IDs", () => {
    const adapter = new BrowserHistoryBraveAdapter({
      defaultProfileDir: () => null,
    });
    const { events } = adapter.normalize({
      kind: "visit",
      originalId: "brave-visit:profile:1",
      capturedAt: VISIT_MS,
      payload: {
        profileId: "profile",
        visitId: 1,
        url: "https://brave.com",
        title: "Brave",
        visitTimeMs: VISIT_MS,
      },
    });
    expect(events[0].subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(events[0].id).toBe("event-brave-visit-profile-1");
    expect(events[0].extra.browser).toBe("brave");

    const { items } = adapter.normalize({
      kind: "bookmark",
      originalId: "brave-bookmark:profile:bookmark",
      capturedAt: BOOKMARK_MS,
      payload: {
        profileId: "profile",
        guid: "bookmark",
        url: "https://search.brave.com",
        name: "Brave Search",
        dateAddedMs: BOOKMARK_MS,
      },
    });
    expect(items[0].subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(items[0].id).toBe("item-brave-bookmark-profile-bookmark");
    expect(items[0].extra.browser).toBe("brave");
  });

  it("reports an absent profile without exposing the selected path", async () => {
    const adapter = new BrowserHistoryBraveAdapter({
      profilePath: profileDir,
    });
    const result = await adapter.authenticate();
    expect(result).toMatchObject({
      ok: false,
      reason: "PROFILE_NOT_FOUND",
    });
    expect(result.message).toContain("brave");
    expect(JSON.stringify(result)).not.toContain(profileDir);
  });
});
