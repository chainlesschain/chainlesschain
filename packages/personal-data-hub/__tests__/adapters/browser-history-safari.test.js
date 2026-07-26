"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const nodeFs = require("node:fs");
const {
  BrowserHistorySafariAdapter,
  BROWSER_HISTORY_SAFARI_NAME,
  BROWSER_HISTORY_SAFARI_VERSION,
  defaultSafariProfileDir,
  epochMsToSafariSeconds,
  findSafariDownloadsPath,
  findSafariProfiles,
  parseSafariBookmarksBuffer,
  readSafariBookmarksPage,
  readSafariDownloadsPage,
  safariSecondsToEpochMs,
} = require("../../lib/adapters/browser-history-safari");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, ITEM_SUBTYPES } = require("../../lib/constants");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");
const { generateKeyHex } = require("../../lib/key-providers");

const VISIT_MS = 1_700_000_001_000;
const DOWNLOAD_START_MS = 1_700_000_002_000;
const DOWNLOAD_END_MS = 1_700_000_003_000;
const NEW_VISIT_MS = 1_700_000_004_000;
const CANCELLED_DOWNLOAD_MS = 1_700_000_005_000;
const BOOKMARK_MS = 1_700_000_006_000;
const BINARY_BOOKMARK_PLIST =
  "YnBsaXN0MDDUAQIDBAUGBwhVVGl0bGVfEBZXZWJCb29rbWFya0ZpbGVWZXJzaW9uXxAPV2ViQm9va21hcmtUeXBlWENoaWxkcmVuUBABXxATV2ViQm9va21hcmtUeXBlTGlzdKEJ0wEDBAoHC1xCb29rbWFya3NCYXKhDNUDDQ4PEBESExQXXxAPV2ViQm9va21hcmtVVUlEWVVSTFN0cmluZ11VUklEaWN0aW9uYXJ5WURhdGVBZGRlZF8QE1dlYkJvb2ttYXJrVHlwZUxlYWZbYmluYXJ5LWd1aWRfEB5odHRwczovL2JpbmFyeS5zYWZhcmkuZXhhbXBsZS/RFRZVdGl0bGVdQmluYXJ5IFNhZmFyaTNBxYIUQAAAAAAIABEAFwAwAEIASwBMAE4AZABmAG0AegB8AIcAmQCjALEAuwDRAN0A/gEBAQcBFQAAAAAAAAIBAAAAAAAAABgAAAAAAAAAAAAAAAAAAAEe";

let tempDir;
let profileDir;

function buildHistoryFixture() {
  mkdirSync(profileDir, { recursive: true });
  const db = new Database(join(profileDir, "History.db"));
  db.exec(`
    CREATE TABLE history_items(
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      visit_count INTEGER DEFAULT 0
    );
    CREATE TABLE history_visits(
      id INTEGER PRIMARY KEY,
      history_item INTEGER NOT NULL,
      visit_time REAL NOT NULL,
      title TEXT,
      load_successful INTEGER,
      http_non_get INTEGER
    );
  `);
  const insertItem = db.prepare(
    "INSERT INTO history_items(id,url,visit_count) VALUES(?,?,?)",
  );
  const insertVisit = db.prepare(
    "INSERT INTO history_visits(id,history_item,visit_time,title,load_successful,http_non_get) VALUES(?,?,?,?,?,?)",
  );
  insertItem.run(1, "https://old.safari.example/", 1);
  insertVisit.run(10, 1, epochMsToSafariSeconds(VISIT_MS), "Old Safari", 1, 0);
  insertItem.run(2, "https://new.safari.example/", 1);
  insertVisit.run(
    11,
    2,
    epochMsToSafariSeconds(NEW_VISIT_MS),
    "New Safari",
    0,
    1,
  );
  db.close();
}

function buildXmlBookmarksFixture() {
  writeFileSync(
    join(profileDir, "Bookmarks.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Title</key><string></string>
  <key>WebBookmarkFileVersion</key><integer>1</integer>
  <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
  <key>Children</key>
  <array>
    <dict>
      <key>Title</key><string>BookmarksBar</string>
      <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
      <key>Children</key>
      <array>
        <dict>
          <key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
          <key>WebBookmarkUUID</key><string>safari-bookmark</string>
          <key>URLString</key><string>https://bookmark.safari.example/?a=1&amp;b=2</string>
          <key>URIDictionary</key><dict><key>title</key><string>Safari &amp; Saved</string></dict>
          <key>DateAdded</key><date>2023-11-14T22:13:26Z</date>
          <key>ReadingList</key>
          <dict><key>DateLastViewed</key><date>2023-11-14T22:13:26Z</date></dict>
        </dict>
      </array>
    </dict>
  </array>
</dict>
</plist>`,
    "utf8",
  );
  utimesSync(
    join(profileDir, "Bookmarks.plist"),
    BOOKMARK_MS / 1000,
    BOOKMARK_MS / 1000,
  );
}

function buildDownloadsFixture() {
  const plistPath = join(profileDir, "Downloads.plist");
  writeFileSync(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>DownloadHistory</key><array>
    <dict>
      <key>DownloadEntryIdentifier</key><string>safari-download-complete</string>
      <key>DownloadEntryURL</key><string>https://user:password@downloads.safari.example/files/report.pdf?token=secret#private</string>
      <key>DownloadEntryPath</key><string>/Users/alice/Downloads/Quarterly Report.pdf</string>
      <key>DownloadEntryDateAddedKey</key><date>2023-11-14T22:13:22Z</date>
      <key>DownloadEntryDateFinishedKey</key><date>2023-11-14T22:13:23Z</date>
      <key>DownloadEntryProgressBytesSoFar</key><integer>4096</integer>
      <key>DownloadEntryProgressTotalToLoad</key><integer>4096</integer>
      <key>DownloadEntryRemoveWhenDoneKey</key><false/>
      <key>DownloadEntryBookmarkBlob</key><data>cHJpdmF0ZS1ibG9i</data>
    </dict>
    <dict>
      <key>DownloadEntryIdentifier</key><string>/Users/alice/private-id</string>
      <key>DownloadEntryURL</key><string>https://downloads.safari.example/files/partial.zip?signature=private</string>
      <key>DownloadEntryPath</key><string>/Users/alice/Downloads/partial.zip</string>
      <key>DownloadEntryDateAddedKey</key><date>2023-11-14T22:13:25Z</date>
      <key>DownloadEntryProgressBytesSoFar</key><integer>10</integer>
      <key>DownloadEntryProgressTotalToLoad</key><integer>100</integer>
      <key>DownloadEntryErrorCodeDictionaryKey</key><integer>-999</integer>
      <key>DownloadEntryRemoveWhenDoneKey</key><true/>
    </dict>
  </array>
</dict></plist>`,
    "utf8",
  );
  utimesSync(
    plistPath,
    (BOOKMARK_MS + 10_000) / 1000,
    (BOOKMARK_MS + 10_000) / 1000,
  );
}

async function collect(adapter, opts = {}) {
  const rows = [];
  for await (const row of adapter.sync(opts)) rows.push(row);
  return rows;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "safari-adapter-test-"));
  profileDir = join(tempDir, "Safari");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Safari reader helpers and discovery", () => {
  it("round-trips Apple's 2001 reference timestamp", () => {
    expect(safariSecondsToEpochMs(epochMsToSafariSeconds(VISIT_MS))).toBe(
      VISIT_MS,
    );
  });

  it("discovers the classic profile and Safari 17 container profiles", () => {
    const classic = join(tempDir, "Library", "Safari");
    const containerRoot = join(
      tempDir,
      "Library",
      "Containers",
      "com.apple.Safari",
      "Data",
      "Library",
      "Safari",
    );
    const workProfile = join(containerRoot, "Profiles", "work-uuid");
    mkdirSync(classic, { recursive: true });
    mkdirSync(workProfile, { recursive: true });
    writeFileSync(join(classic, "History.db"), "");
    writeFileSync(join(workProfile, "History.db"), "");
    writeFileSync(join(containerRoot, "Downloads.plist"), "");

    expect(
      findSafariProfiles({
        platform: "darwin",
        homedir: tempDir,
        fs: nodeFs,
      }),
    ).toEqual([classic, workProfile]);
    expect(
      defaultSafariProfileDir({
        platform: "darwin",
        homedir: tempDir,
        fs: nodeFs,
      }),
    ).toBe(classic);
    expect(findSafariDownloadsPath(workProfile)).toBe(
      join(containerRoot, "Downloads.plist"),
    );
  });

  it("discovers Safari profiles beyond the former 256-profile limit", () => {
    const root = join(tempDir, "Safari");
    const profilesRoot = join(root, "Profiles");
    const profileCount = 257;
    const entries = Array.from({ length: profileCount }, (_, index) => ({
      name: `profile-${String(index).padStart(3, "0")}`,
      isDirectory: () => true,
    }));
    const fsMod = {
      readdirSync: (candidate) => {
        if (candidate === profilesRoot) return entries;
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      },
      statSync: (candidate) => {
        if (
          candidate.endsWith("History.db") &&
          candidate.startsWith(`${profilesRoot}${sep}`)
        ) {
          return { isFile: () => true };
        }
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      },
    };

    const profiles = findSafariProfiles({
      platform: "darwin",
      roots: [root],
      fs: fsMod,
    });

    expect(profiles).toHaveLength(profileCount);
  });

  it("parses binary Safari bookmark plists without an external dependency", () => {
    const buffer = Buffer.from(BINARY_BOOKMARK_PLIST, "base64");
    const parsed = parseSafariBookmarksBuffer(buffer);
    expect(parsed.Children[0].Children[0]).toMatchObject({
      WebBookmarkUUID: "binary-guid",
      URLString: "https://binary.safari.example/",
      URIDictionary: { title: "Binary Safari" },
    });
    expect(parsed.Children[0].Children[0].DateAdded).toBeInstanceOf(Date);

    mkdirSync(profileDir, { recursive: true });
    const plistPath = join(profileDir, "Bookmarks.plist");
    writeFileSync(plistPath, buffer);
    utimesSync(plistPath, BOOKMARK_MS / 1000, BOOKMARK_MS / 1000);
    const result = readSafariBookmarksPage(plistPath, {
      since: 0,
      limit: 10,
    });
    expect(result.complete).toBe(true);
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0]).toMatchObject({
      guid: "binary-guid",
      folderPath: "BookmarksBar",
      name: "Binary Safari",
    });
  });

  it("accepts empty self-closing values in XML plists", () => {
    const parsed = parseSafariBookmarksBuffer(
      Buffer.from(
        '<?xml version="1.0"?><plist version="1.0"><dict><key>empty</key><string/><key>children</key><array/><key>metadata</key><dict/><key>data</key><data/></dict></plist>',
        "utf8",
      ),
    );
    expect(parsed).toEqual({
      empty: "",
      children: [],
      metadata: {},
      data: Buffer.alloc(0),
    });
  });
});

describe("BrowserHistorySafariAdapter collection and privacy", () => {
  it("publishes a bounded local profile contract without eager discovery", () => {
    let discoveryCalls = 0;
    const adapter = new BrowserHistorySafariAdapter({
      defaultProfileDir: () => {
        discoveryCalls += 1;
        return null;
      },
    });

    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(BROWSER_HISTORY_SAFARI_NAME);
    expect(adapter.name).toBe("browser-history-safari");
    expect(adapter.version).toBe(BROWSER_HISTORY_SAFARI_VERSION);
    expect(adapter.version).toBe("0.2.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:safari-history-sqlite",
        "sync:safari-bookmarks-plist",
        "sync:safari-downloads-plist",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(discoveryCalls).toBe(0);
  });

  it("collects and normalizes history plus XML bookmarks without paths", async () => {
    buildHistoryFixture();
    buildXmlBookmarksFixture();
    buildDownloadsFixture();
    const adapter = new BrowserHistorySafariAdapter({
      profilePath: join(profileDir, "History.db"),
    });
    let complete = false;
    const rows = await collect(adapter, {
      markWatermarkComplete: () => {
        complete = true;
      },
    });

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.kind)).toEqual([
      "visit",
      "download",
      "visit",
      "download",
      "bookmark",
    ]);
    expect(rows[0]).toMatchObject({
      kind: "visit",
      capturedAt: VISIT_MS,
      payload: {
        url: "https://old.safari.example/",
        loadSuccessful: true,
        httpNonGet: false,
      },
    });
    expect(rows[2].payload).toMatchObject({
      loadSuccessful: false,
      httpNonGet: true,
    });
    expect(rows[4]).toMatchObject({
      kind: "bookmark",
      payload: {
        guid: "safari-bookmark",
        name: "Safari & Saved",
        url: "https://bookmark.safari.example/?a=1&b=2",
        folderPath: "BookmarksBar",
        readingList: true,
      },
    });
    expect(rows[0].originalId).toMatch(/^safari-visit:[a-f0-9]{24}:10$/u);
    expect(rows[4].originalId).toMatch(
      /^safari-bookmark:[a-f0-9]{24}:safari-bookmark$/u,
    );
    expect(complete).toBe(true);
    expect(adapter.defaultScope).toMatch(
      /^account:browser-history-safari:[a-f0-9]{32}$/u,
    );
    expect(JSON.stringify(rows)).not.toContain(profileDir);
    expect(adapter.defaultScope).not.toContain(profileDir);

    const event = adapter.normalize(rows[2]).events[0];
    const item = adapter.normalize(rows[4]).items[0];
    expect(event.subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(event.extra).toMatchObject({
      browser: "safari",
      loadSuccessful: false,
      httpNonGet: true,
    });
    expect(item.subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(item.extra).toMatchObject({
      browser: "safari",
      readingList: true,
    });
    expect(JSON.stringify({ event, item })).not.toContain(profileDir);
  });

  it("collects Safari downloads with path and URL privacy enforced", async () => {
    buildHistoryFixture();
    buildDownloadsFixture();
    const adapter = new BrowserHistorySafariAdapter({
      profilePath: profileDir,
    });

    const rows = await collect(adapter, {
      include: { history: false, bookmarks: false },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "download",
      capturedAt: DOWNLOAD_END_MS,
      payload: {
        downloadId: "safari-download-complete",
        fileName: "Quarterly Report.pdf",
        fileExtension: "pdf",
        sourceUrl: "https://downloads.safari.example/files/report.pdf",
        startTimeMs: DOWNLOAD_START_MS,
        endTimeMs: DOWNLOAD_END_MS,
        receivedBytes: 4096,
        totalBytes: 4096,
        state: "complete",
        rawErrorCode: null,
        removeWhenDone: false,
      },
    });
    expect(rows[0].payload.targetPathHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(rows[1]).toMatchObject({
      capturedAt: CANCELLED_DOWNLOAD_MS,
      payload: {
        state: "cancelled",
        rawErrorCode: -999,
        removeWhenDone: true,
      },
    });
    expect(JSON.stringify(rows)).not.toContain("alice");
    expect(JSON.stringify(rows)).not.toContain("password");
    expect(JSON.stringify(rows)).not.toContain("token=");
    expect(JSON.stringify(rows)).not.toContain("signature=");
    expect(JSON.stringify(rows)).not.toContain("private-blob");

    const normalized = adapter.normalize(rows[0]).events[0];
    expect(normalized.subtype).toBe(EVENT_SUBTYPES.DOWNLOAD);
    expect(normalized.durationMs).toBe(1000);
    expect(normalized.extra).toMatchObject({
      browser: "safari",
      state: "complete",
      rawErrorCode: null,
      removeWhenDone: false,
    });

    expect(
      await collect(adapter, {
        sinceWatermark: String(DOWNLOAD_END_MS),
        include: { history: false, bookmarks: false },
      }),
    ).toHaveLength(2);
    expect(
      await collect(adapter, {
        include: { history: false, bookmarks: false, downloads: false },
      }),
    ).toEqual([]);

    const direct = readSafariDownloadsPage(
      join(profileDir, "Downloads.plist"),
      { since: DOWNLOAD_END_MS, limit: 1 },
    );
    expect(direct.downloads).toHaveLength(1);
    expect(direct.complete).toBe(false);
  });

  it("replays an equal watermark and defers completion when limited", async () => {
    buildHistoryFixture();
    const adapter = new BrowserHistorySafariAdapter({
      profilePath: profileDir,
    });
    let complete = false;
    const replay = await collect(adapter, {
      sinceWatermark: String(VISIT_MS),
      includeBookmarks: false,
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(replay.map((row) => row.payload.visitId)).toEqual([10, 11]);
    expect(complete).toBe(true);

    complete = false;
    const limited = await collect(adapter, {
      limit: 1,
      includeBookmarks: false,
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(limited).toHaveLength(1);
    expect(complete).toBe(false);
  });

  it("returns a path-free Full Disk Access readiness error", async () => {
    const deniedFs = {
      ...nodeFs,
      statSync() {
        const error = new Error(`denied: ${profileDir}`);
        error.code = "EACCES";
        throw error;
      },
    };
    const adapter = new BrowserHistorySafariAdapter({
      profilePath: profileDir,
      fs: deniedFs,
    });
    const result = await adapter.authenticate();
    expect(result).toMatchObject({
      ok: false,
      reason: "SAFARI_PERMISSION_DENIED",
    });
    expect(result.message).toContain("Full Disk Access");
    expect(JSON.stringify(result)).not.toContain(profileDir);
  });

  it("maps a snapshot copy denial to the same path-free permission code", async () => {
    buildHistoryFixture();
    const deniedFs = {
      ...nodeFs,
      copyFileSync() {
        const error = new Error(`denied: ${profileDir}`);
        error.code = "EACCES";
        throw error;
      },
    };
    const adapter = new BrowserHistorySafariAdapter({
      profilePath: profileDir,
      fs: deniedFs,
    });
    let caught;
    try {
      await collect(adapter);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "SAFARI_PERMISSION_DENIED" });
    expect(String(caught?.message)).not.toContain(profileDir);
  });

  it("sanitizes schema failures and keeps the encrypted-vault watermark", async () => {
    mkdirSync(profileDir, { recursive: true });
    const malformed = new Database(join(profileDir, "History.db"));
    malformed.exec("CREATE TABLE unrelated(id INTEGER PRIMARY KEY)");
    malformed.close();
    const adapter = new BrowserHistorySafariAdapter({
      profilePath: profileDir,
    });
    await expect(collect(adapter)).rejects.toMatchObject({
      code: "SAFARI_SCHEMA_MISMATCH",
    });
    await expect(collect(adapter)).rejects.not.toThrow(profileDir);

    rmSync(join(profileDir, "History.db"), { force: true });
    buildHistoryFixture();
    const vault = new LocalVault({
      path: join(tempDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    try {
      vault.setWatermark(adapter.name, adapter.defaultScope, {
        watermark: String(VISIT_MS - 1000),
        lastSyncedAt: VISIT_MS,
        lastStatus: "ok",
        lastError: null,
      });
      const registry = new AdapterRegistry({ vault });
      registry.register(adapter);
      const partial = await registry.syncAdapter(adapter.name, {
        limit: 1,
        includeBookmarks: false,
      });
      expect(partial.status).toBe("ok");
      expect(partial.watermarkDeferred).toBe(true);
      expect(partial.watermark).toBe(String(VISIT_MS - 1000));
    } finally {
      vault.close();
    }
  });
});
