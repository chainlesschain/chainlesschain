"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  BrowserHistoryFirefoxAdapter,
  BROWSER_HISTORY_FIREFOX_NAME,
  BROWSER_HISTORY_FIREFOX_VERSION,
  findFirefoxProfiles,
  firefoxPrTimeUsToEpochMs,
  parseFirefoxProfilesIni,
} = require("../../lib/adapters/browser-history-firefox");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, ITEM_SUBTYPES } = require("../../lib/constants");
const { validateEvent, validateItem } = require("../../lib/schemas");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");
const { generateKeyHex } = require("../../lib/key-providers");

const OLD_MS = 1_700_000_000_000;
const NEW_MS = 1_700_000_005_000;
const BOOKMARK_MS = 1_700_000_006_000;
const DOWNLOAD_START_MS = 1_700_000_007_000;
const DOWNLOAD_END_MS = 1_700_000_008_000;

let tempDir;
let profileDir;

function prTime(ms) {
  return ms * 1000;
}

function buildPlacesFixture() {
  mkdirSync(profileDir, { recursive: true });
  const db = new Database(join(profileDir, "places.sqlite"));
  db.exec(`
    CREATE TABLE moz_places(
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      visit_count INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0,
      typed INTEGER DEFAULT 0,
      guid TEXT
    );
    CREATE TABLE moz_historyvisits(
      id INTEGER PRIMARY KEY,
      from_visit INTEGER DEFAULT 0,
      place_id INTEGER NOT NULL,
      visit_date INTEGER NOT NULL,
      visit_type INTEGER DEFAULT 1
    );
    CREATE TABLE moz_bookmarks(
      id INTEGER PRIMARY KEY,
      type INTEGER NOT NULL,
      fk INTEGER,
      parent INTEGER,
      position INTEGER DEFAULT 0,
      title TEXT,
      dateAdded INTEGER DEFAULT 0,
      lastModified INTEGER DEFAULT 0,
      guid TEXT
    );
    CREATE TABLE moz_anno_attributes(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE moz_annos(
      id INTEGER PRIMARY KEY,
      place_id INTEGER NOT NULL,
      anno_attribute_id INTEGER NOT NULL,
      content TEXT,
      dateAdded INTEGER DEFAULT 0,
      lastModified INTEGER DEFAULT 0
    );
  `);
  const insertPlace = db.prepare(
    "INSERT INTO moz_places(id,url,title,visit_count,hidden,typed,guid) VALUES(?,?,?,?,?,?,?)",
  );
  insertPlace.run(1, "https://old.example/", "Old", 1, 0, 0, "place-old");
  insertPlace.run(2, "https://new.example/", "New", 2, 0, 1, "place-new");
  insertPlace.run(
    3,
    "https://hidden.example/",
    "Hidden",
    1,
    1,
    0,
    "place-hidden",
  );
  insertPlace.run(
    4,
    "https://bookmark.example/",
    "Bookmark page",
    0,
    0,
    0,
    "place-bookmark",
  );
  insertPlace.run(
    5,
    "https://user:password@downloads.example/files/report.pdf?token=secret#private",
    "Quarterly Report.pdf",
    1,
    0,
    0,
    "place-download",
  );
  const insertVisit = db.prepare(
    "INSERT INTO moz_historyvisits(id,from_visit,place_id,visit_date,visit_type) VALUES(?,?,?,?,?)",
  );
  insertVisit.run(10, 0, 1, prTime(OLD_MS), 1);
  insertVisit.run(11, 10, 2, prTime(NEW_MS), 2);
  insertVisit.run(12, 0, 3, prTime(NEW_MS + 1000), 1);
  insertVisit.run(13, 0, 5, prTime(DOWNLOAD_START_MS), 7);

  const insertBookmark = db.prepare(
    "INSERT INTO moz_bookmarks(id,type,fk,parent,position,title,dateAdded,lastModified,guid) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  insertBookmark.run(1, 2, null, 0, 0, "", 0, 0, "root________");
  insertBookmark.run(
    2,
    2,
    null,
    1,
    0,
    "Bookmarks Toolbar",
    0,
    0,
    "toolbar_____",
  );
  insertBookmark.run(3, 2, null, 2, 0, "Work", 0, 0, "folder-work");
  insertBookmark.run(
    4,
    1,
    4,
    3,
    0,
    "Saved",
    prTime(BOOKMARK_MS - 1000),
    prTime(BOOKMARK_MS),
    "bookmark-guid",
  );
  db.prepare("INSERT INTO moz_anno_attributes(id,name) VALUES(?,?)").run(
    1,
    "downloads/metaData",
  );
  db.prepare("INSERT INTO moz_anno_attributes(id,name) VALUES(?,?)").run(
    2,
    "downloads/destinationFileURI",
  );
  db.prepare("INSERT INTO moz_anno_attributes(id,name) VALUES(?,?)").run(
    3,
    "downloads/destinationFileName",
  );
  const insertAnno = db.prepare(
    "INSERT INTO moz_annos(id,place_id,anno_attribute_id,content,dateAdded,lastModified) VALUES(?,?,?,?,?,?)",
  );
  insertAnno.run(
    1,
    5,
    1,
    JSON.stringify({
      state: 1,
      deleted: false,
      endTime: new Date(DOWNLOAD_END_MS).toISOString(),
      fileSize: 4096,
    }),
    prTime(DOWNLOAD_START_MS),
    prTime(DOWNLOAD_END_MS),
  );
  insertAnno.run(
    2,
    5,
    2,
    "file:///C:/Users/alice/Downloads/Quarterly%20Report.pdf",
    prTime(DOWNLOAD_START_MS),
    prTime(DOWNLOAD_END_MS),
  );
  insertAnno.run(
    3,
    5,
    3,
    "Quarterly Report.pdf",
    prTime(DOWNLOAD_START_MS),
    prTime(DOWNLOAD_END_MS),
  );
  db.close();
}

async function collect(adapter, opts = {}) {
  const rows = [];
  for await (const row of adapter.sync(opts)) rows.push(row);
  return rows;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "firefox-adapter-test-"));
  profileDir = join(tempDir, "Profiles", "abc.default-release");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Firefox profile discovery", () => {
  it("parses profiles.ini and prioritizes the install default", () => {
    buildPlacesFixture();
    writeFileSync(
      join(tempDir, "profiles.ini"),
      [
        "[Profile0]",
        "Name=default-release",
        "IsRelative=1",
        "Path=Profiles/abc.default-release",
        "Default=1",
        "",
        "[InstallAABBCC]",
        "Default=Profiles/abc.default-release",
        "Locked=1",
      ].join("\n"),
      "utf8",
    );

    expect(parseFirefoxProfilesIni("[Profile0]\nPath=Profiles/x")).toEqual([
      { name: "Profile0", values: { Path: "Profiles/x" } },
    ]);
    expect(findFirefoxProfiles({ roots: [tempDir] })).toEqual([profileDir]);
  });
});

describe("BrowserHistoryFirefoxAdapter contract and collection", () => {
  it("publishes a local profile-directory contract", () => {
    const adapter = new BrowserHistoryFirefoxAdapter({
      defaultProfileDir: () => null,
    });
    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(BROWSER_HISTORY_FIREFOX_NAME);
    expect(adapter.name).toBe("browser-history-firefox");
    expect(adapter.version).toBe(BROWSER_HISTORY_FIREFOX_VERSION);
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:firefox-places-sqlite",
        "sync:firefox-downloads-sqlite",
        "sync:profile-directory",
        "sync:file-import",
        "parse:firefox-downloads",
      ]),
    );
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(adapter.initialPageBudget).toBe(20);
    expect(adapter.runtimeCredentialOption).toBe("profilePath");
    expect(adapter.runtimeScopeIdentityKey).toBe("profilePath");
  });

  it("defers default profile discovery until scope resolution", () => {
    let discoveryCalls = 0;
    const adapter = new BrowserHistoryFirefoxAdapter({
      defaultProfileDir: () => {
        discoveryCalls += 1;
        return profileDir;
      },
    });

    expect(discoveryCalls).toBe(0);
    expect(adapter.defaultScope).toBeUndefined();
    expect(adapter.resolveDefaultScope()).toMatch(
      /^account:browser-history-firefox:[a-f0-9]{32}$/u,
    );
    expect(discoveryCalls).toBe(1);
  });

  it("reports a missing profile without exposing an absolute path", async () => {
    const adapter = new BrowserHistoryFirefoxAdapter({
      profilePath: join(tempDir, "missing-profile"),
    });
    const auth = await adapter.authenticate();
    expect(auth).toMatchObject({
      ok: false,
      reason: "PROFILE_NOT_FOUND",
    });
    expect(JSON.stringify(auth)).not.toContain(tempDir);
  });

  it("rejects an uninitialized Places shell during readiness", async () => {
    mkdirSync(profileDir, { recursive: true });
    new Database(join(profileDir, "places.sqlite")).close();
    const adapter = new BrowserHistoryFirefoxAdapter({
      profilePath: profileDir,
    });

    const auth = await adapter.authenticate();
    expect(auth).toMatchObject({
      ok: false,
      reason: "PROFILE_NOT_INITIALIZED",
    });
    expect(JSON.stringify(auth)).not.toContain(profileDir);
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: false });
  });

  it("passes a runtime-selected profile through the registry health gate", async () => {
    buildPlacesFixture();
    const adapter = new BrowserHistoryFirefoxAdapter({
      defaultProfileDir: () => null,
    });
    await expect(
      adapter.healthCheck({ profilePath: profileDir }),
    ).resolves.toMatchObject({
      ok: true,
    });
  });

  it("collects visible visits and nested bookmarks from a copied snapshot", async () => {
    buildPlacesFixture();
    const adapter = new BrowserHistoryFirefoxAdapter({
      profilePath: profileDir,
    });
    const auth = await adapter.authenticate();
    expect(auth).toMatchObject({ ok: true, mode: "file-import" });
    expect(auth.profileId).toMatch(/^[a-f0-9]{24}$/u);

    let watermarkComplete = false;
    const rows = await collect(adapter, {
      markWatermarkComplete: () => {
        watermarkComplete = true;
      },
    });

    expect(rows.filter((row) => row.kind === "visit")).toHaveLength(2);
    expect(rows.filter((row) => row.kind === "bookmark")).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "download")).toHaveLength(1);
    expect(rows.map((row) => row.payload.url)).not.toContain(
      "https://hidden.example/",
    );
    expect(rows.find((row) => row.kind === "bookmark").payload.folderPath).toBe(
      "Firefox / 书签工具栏 / Work",
    );
    expect(watermarkComplete).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(profileDir);
    expect(JSON.stringify(rows)).not.toContain("places.sqlite");
  });

  it("collects downloads without retaining target paths or URL secrets", async () => {
    buildPlacesFixture();
    const adapter = new BrowserHistoryFirefoxAdapter({
      profilePath: profileDir,
    });
    const rows = await collect(adapter, {
      include: { history: false, bookmarks: false },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "download",
      capturedAt: DOWNLOAD_END_MS,
      payload: {
        fileName: "Quarterly Report.pdf",
        fileExtension: "pdf",
        sourceUrl: "https://downloads.example/files/report.pdf",
        startTimeMs: DOWNLOAD_START_MS,
        endTimeMs: DOWNLOAD_END_MS,
        fileSize: 4096,
        state: "complete",
        rawState: 1,
        deleted: false,
      },
    });
    expect(rows[0].payload.targetPathHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(rows)).not.toContain("alice");
    expect(JSON.stringify(rows)).not.toContain("password");
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(JSON.stringify(rows)).not.toContain("token=");
    expect(
      await collect(adapter, {
        sinceWatermark: String(DOWNLOAD_END_MS),
        include: { history: false, bookmarks: false },
      }),
    ).toHaveLength(1);
    expect(
      await collect(adapter, {
        include: { history: false, bookmarks: false, downloads: false },
      }),
    ).toEqual([]);
  });

  it("falls back to download visits when optional annotation tables are absent", async () => {
    buildPlacesFixture();
    const db = new Database(join(profileDir, "places.sqlite"));
    db.exec("DROP TABLE moz_annos; DROP TABLE moz_anno_attributes;");
    db.close();
    const adapter = new BrowserHistoryFirefoxAdapter({
      profilePath: profileDir,
    });

    const rows = await collect(adapter, {
      include: { history: false, bookmarks: false },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      fileName: "report.pdf",
      fileExtension: "pdf",
      sourceUrl: "https://downloads.example/files/report.pdf",
      startTimeMs: DOWNLOAD_START_MS,
      capturedAtMs: DOWNLOAD_START_MS,
      targetPathHash: null,
      state: null,
    });
  });

  it("replays an equal timestamp and preserves the watermark on a limited scan", async () => {
    buildPlacesFixture();
    const adapter = new BrowserHistoryFirefoxAdapter({
      profilePath: profileDir,
    });
    let complete = false;
    const equalRows = await collect(adapter, {
      sinceWatermark: String(NEW_MS),
      include: { bookmarks: false, downloads: false },
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(equalRows.map((row) => row.payload.url)).toEqual([
      "https://new.example/",
    ]);
    expect(complete).toBe(true);

    complete = false;
    const limited = await collect(adapter, {
      limit: 1,
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(limited).toHaveLength(1);
    expect(complete).toBe(false);
    const pageLimited = await collect(adapter, {
      maxPages: 1,
      pageSize: 1,
    });
    expect(pageLimited).toHaveLength(1);
    await expect(collect(adapter, { limit: 0 })).rejects.toThrow(
      /positive integer/u,
    );
    await expect(collect(adapter, { maxPages: 0 })).rejects.toThrow(
      /maxPages must be a positive integer/u,
    );
    await expect(collect(adapter, { pageSize: 50_001 })).rejects.toThrow(
      /pageSize must not exceed 50000/u,
    );
  });

  it("imports an explicitly selected places.sqlite without inheriting another profile watermark", async () => {
    buildPlacesFixture();
    const adapter = new BrowserHistoryFirefoxAdapter({
      defaultProfileDir: () => null,
    });
    const rows = await collect(adapter, {
      inputPath: join(profileDir, "places.sqlite"),
      sinceWatermark: String(BOOKMARK_MS + 10_000),
      include: { bookmarks: false },
    });
    expect(rows.filter((row) => row.kind === "visit")).toHaveLength(2);

    await expect(
      collect(adapter, {
        inputPath: join(profileDir, "places.sqlite"),
        maxPages: 1,
        pageSize: 1,
      }),
    ).rejects.toMatchObject({
      code: "FIREFOX_SCAN_BUDGET_EXCEEDED",
    });
  });
});

describe("BrowserHistoryFirefoxAdapter normalization and registry safety", () => {
  it("normalizes Firefox history and bookmarks to valid unified entities", () => {
    const adapter = new BrowserHistoryFirefoxAdapter({
      defaultProfileDir: () => null,
    });
    const { events } = adapter.normalize({
      kind: "visit",
      originalId: "firefox-visit:profile:10",
      capturedAt: OLD_MS,
      payload: {
        profileId: "profile",
        visitId: 10,
        url: "https://example.test/",
        title: "Example",
        visitTimeMs: OLD_MS,
        visitType: "typed",
        rawVisitType: 2,
      },
    });
    expect(events[0].subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(events[0].extra.browser).toBe("firefox");
    expect(validateEvent(events[0]).valid).toBe(true);

    const { items } = adapter.normalize({
      kind: "bookmark",
      originalId: "firefox-bookmark:profile:bookmark",
      capturedAt: BOOKMARK_MS,
      payload: {
        profileId: "profile",
        bookmarkId: 4,
        guid: "bookmark",
        url: "https://bookmark.test/",
        name: "Bookmark",
        folderPath: "Firefox / 书签工具栏",
        dateAddedMs: BOOKMARK_MS,
      },
    });
    expect(items[0].subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(items[0].extra.browser).toBe("firefox");
    expect(validateItem(items[0]).valid).toBe(true);

    const normalizedDownload = adapter.normalize({
      kind: "download",
      originalId: "firefox-download:profile:place-download",
      capturedAt: DOWNLOAD_END_MS,
      payload: {
        profileId: "profile",
        placeGuid: "place-download",
        fileName: "Quarterly Report.pdf",
        fileExtension: "pdf",
        sourceUrl: "https://downloads.example/files/report.pdf",
        startTimeMs: DOWNLOAD_START_MS,
        endTimeMs: DOWNLOAD_END_MS,
        fileSize: 4096,
        state: "complete",
        rawState: 1,
        targetPathHash: "a".repeat(64),
      },
    });
    expect(normalizedDownload.events[0].subtype).toBe(EVENT_SUBTYPES.DOWNLOAD);
    expect(normalizedDownload.events[0].durationMs).toBe(1000);
    expect(validateEvent(normalizedDownload.events[0]).valid).toBe(true);
  });

  it("isolates encrypted-vault watermarks by hashed profile and defers partial scans", async () => {
    buildPlacesFixture();
    const adapter = new BrowserHistoryFirefoxAdapter({
      profilePath: profileDir,
    });
    expect(adapter.defaultScope).toMatch(
      /^account:browser-history-firefox:[a-f0-9]{32}$/u,
    );
    expect(adapter.defaultScope).not.toContain(profileDir);

    const vault = new LocalVault({
      path: join(tempDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    try {
      vault.setWatermark(adapter.name, adapter.defaultScope, {
        watermark: String(OLD_MS - 1000),
        lastSyncedAt: OLD_MS,
        lastStatus: "ok",
        lastError: null,
      });
      const registry = new AdapterRegistry({ vault });
      registry.register(adapter);

      const partial = await registry.syncAdapter(adapter.name, { limit: 1 });
      expect(partial.status).toBe("ok");
      expect(partial.watermarkDeferred).toBe(true);
      expect(partial.watermark).toBe(String(OLD_MS - 1000));
      expect(
        vault.getWatermark(adapter.name, adapter.defaultScope).watermark,
      ).toBe(String(OLD_MS - 1000));

      const complete = await registry.syncAdapter(adapter.name);
      expect(complete.status).toBe("ok");
      expect(complete.watermarkDeferred).toBe(false);
      expect(Number(complete.watermark)).toBeGreaterThanOrEqual(BOOKMARK_MS);
      expect(vault.stats().events).toBe(3);
      expect(vault.stats().items).toBe(1);
    } finally {
      vault.close();
    }
  });

  it("converts Firefox PRTime microseconds to Unix milliseconds", () => {
    expect(firefoxPrTimeUsToEpochMs(prTime(NEW_MS))).toBe(NEW_MS);
    expect(firefoxPrTimeUsToEpochMs(0)).toBe(null);
  });
});
