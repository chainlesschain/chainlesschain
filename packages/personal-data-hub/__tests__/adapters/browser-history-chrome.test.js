"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const nodeFs = require("node:fs");

const {
  BrowserHistoryChromeAdapter,
  BROWSER_HISTORY_CHROME_NAME,
  BROWSER_HISTORY_CHROME_VERSION,
  decodeDownloadDanger,
  decodeDownloadState,
  decodeTransition,
  epochMsToWebkitUs,
  findChromiumProfiles,
  sanitizeDownloadUrl,
  webkitUsToEpochMs,
} = require("../../lib/adapters/browser-history-chrome");
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
const DOWNLOAD_END_MS = 1_700_000_009_000;
const DOWNLOAD_ACCESS_MS = 1_700_000_010_000;

let tempDir;
let profileDir;
let historyPath;
let bookmarksPath;

function buildFixture({ visits = [], bookmarks = [], downloads = [] } = {}) {
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
    CREATE TABLE downloads(
      id INTEGER PRIMARY KEY,
      guid VARCHAR NOT NULL,
      current_path LONGVARCHAR NOT NULL,
      target_path LONGVARCHAR NOT NULL,
      start_time INTEGER NOT NULL,
      received_bytes INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      state INTEGER NOT NULL,
      danger_type INTEGER NOT NULL,
      interrupt_reason INTEGER NOT NULL,
      hash BLOB NOT NULL,
      end_time INTEGER NOT NULL,
      opened INTEGER NOT NULL,
      last_access_time INTEGER NOT NULL,
      transient INTEGER NOT NULL,
      referrer VARCHAR NOT NULL,
      site_url VARCHAR NOT NULL,
      tab_url VARCHAR NOT NULL,
      tab_referrer_url VARCHAR NOT NULL,
      http_method VARCHAR NOT NULL,
      by_ext_name VARCHAR NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      original_mime_type VARCHAR(255) NOT NULL
    );
    CREATE TABLE downloads_url_chains(
      id INTEGER NOT NULL,
      chain_index INTEGER NOT NULL,
      url LONGVARCHAR NOT NULL,
      PRIMARY KEY (id, chain_index)
    );
  `);
  const insertUrl = db.prepare(
    "INSERT INTO urls(url,title,visit_count,typed_count,last_visit_time,hidden) VALUES(?,?,?,?,?,?)",
  );
  const insertVisit = db.prepare(
    "INSERT INTO visits(url,visit_time,from_visit,transition,visit_duration) VALUES(?,?,?,?,?)",
  );
  for (const [index, visit] of visits.entries()) {
    const visitTime = epochMsToWebkitUs(visit.visitTimeMs).toString();
    const result = insertUrl.run(
      visit.url,
      visit.title || "",
      visit.visitCount || 1,
      visit.typedCount || 0,
      visitTime,
      visit.hidden ? 1 : 0,
    );
    insertVisit.run(
      result.lastInsertRowid,
      visitTime,
      index === 0 ? 0 : index,
      visit.rawTransition ?? 1,
      (visit.visitDurationMs || 0) * 1000,
    );
  }
  const insertDownload = db.prepare(
    `INSERT INTO downloads(
      id,guid,current_path,target_path,start_time,received_bytes,total_bytes,
      state,danger_type,interrupt_reason,hash,end_time,opened,last_access_time,
      transient,referrer,site_url,tab_url,tab_referrer_url,http_method,
      by_ext_name,mime_type,original_mime_type
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertDownloadUrl = db.prepare(
    "INSERT INTO downloads_url_chains(id,chain_index,url) VALUES(?,?,?)",
  );
  for (const [index, download] of downloads.entries()) {
    const id = index + 1;
    const targetPath =
      download.targetPath || `C:\\Private\\Downloads\\fixture-${id}.bin`;
    const startTimeMs = download.startTimeMs || DOWNLOAD_START_MS + index;
    const endTimeMs = download.endTimeMs || 0;
    const lastAccessTimeMs = download.lastAccessTimeMs || 0;
    insertDownload.run(
      id,
      download.guid || `download-guid-${id}`,
      targetPath,
      targetPath,
      epochMsToWebkitUs(startTimeMs).toString(),
      download.receivedBytes ?? 0,
      download.totalBytes ?? 0,
      download.state ?? 1,
      download.dangerType ?? 0,
      download.interruptReason ?? 0,
      download.contentHash
        ? Buffer.from(download.contentHash, "hex")
        : Buffer.alloc(0),
      endTimeMs ? epochMsToWebkitUs(endTimeMs).toString() : 0,
      download.opened ? 1 : 0,
      lastAccessTimeMs ? epochMsToWebkitUs(lastAccessTimeMs).toString() : 0,
      download.transient ? 1 : 0,
      download.referrer || "",
      download.siteUrl || "",
      download.tabUrl || "",
      download.tabReferrerUrl || "",
      download.httpMethod || "GET",
      download.extensionName || "",
      download.mimeType || "",
      download.originalMimeType || "",
    );
    const urlChain = download.urlChain || [];
    for (const [chainIndex, url] of urlChain.entries()) {
      insertDownloadUrl.run(id, chainIndex, url);
    }
  }
  db.close();

  if (bookmarks.length > 0) {
    writeFileSync(
      bookmarksPath,
      JSON.stringify({
        version: 1,
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "Bookmarks bar",
            children: bookmarks.map((bookmark, index) => ({
              type: "url",
              id: String(index + 1),
              guid: bookmark.guid || `bookmark-${index + 1}`,
              url: bookmark.url,
              name: bookmark.name,
              date_added: epochMsToWebkitUs(
                bookmark.dateAddedMs || BOOKMARK_MS,
              ).toString(),
              date_last_used: epochMsToWebkitUs(
                bookmark.dateLastUsedMs || bookmark.dateAddedMs || BOOKMARK_MS,
              ).toString(),
            })),
          },
          other: {
            type: "folder",
            name: "Other bookmarks",
            children: [],
          },
          synced: {
            type: "folder",
            name: "Mobile bookmarks",
            children: [],
          },
        },
      }),
      "utf8",
    );
  }
}

async function collect(adapter, opts = {}) {
  const rows = [];
  for await (const row of adapter.sync(opts)) rows.push(row);
  return rows;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "chrome-adapter-test-"));
  profileDir = join(tempDir, "Default");
  historyPath = join(profileDir, "History");
  bookmarksPath = join(profileDir, "Bookmarks");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("BrowserHistoryChromeAdapter contract and readiness", () => {
  it("publishes a bounded local profile-directory contract", () => {
    const adapter = new BrowserHistoryChromeAdapter({
      defaultProfileDir: () => null,
    });
    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(BROWSER_HISTORY_CHROME_NAME);
    expect(adapter.name).toBe("browser-history-chrome");
    expect(adapter.version).toBe(BROWSER_HISTORY_CHROME_VERSION);
    expect(adapter.version).toBe("0.3.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:chrome-history-sqlite",
        "sync:chrome-downloads-sqlite",
        "sync:chrome-bookmarks-json",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.extractMode).toBe("file-import");
    expect(adapter.watermarkStrategy).toBe("max-captured-at");
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(adapter.initialPageBudget).toBe(20);
    expect(adapter.runtimeCredentialOption).toBe("profilePath");
  });

  it("defers default profile discovery until scope resolution", () => {
    let discoveryCalls = 0;
    const adapter = new BrowserHistoryChromeAdapter({
      defaultProfileDir: () => {
        discoveryCalls += 1;
        return profileDir;
      },
    });

    expect(discoveryCalls).toBe(0);
    expect(adapter.defaultScope).toBeUndefined();
    expect(adapter.resolveDefaultScope()).toMatch(
      /^account:browser-history-chrome:[a-f0-9]{32}$/u,
    );
    expect(discoveryCalls).toBe(1);
  });

  it("reports a missing profile without exposing its absolute path", async () => {
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    const result = await adapter.authenticate();
    expect(result).toMatchObject({
      ok: false,
      reason: "PROFILE_NOT_FOUND",
    });
    expect(JSON.stringify(result)).not.toContain(profileDir);
  });

  it("accepts a runtime profile and returns only its stable hash", async () => {
    buildFixture({
      visits: [{ url: "https://runtime.test", visitTimeMs: OLD_MS }],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: join(tempDir, "missing"),
    });
    const result = await adapter.authenticate({ profilePath: historyPath });
    expect(result).toMatchObject({ ok: true, mode: "file-import" });
    expect(result.profileId).toMatch(/^[a-f0-9]{24}$/u);
    expect(JSON.stringify(result)).not.toContain(profileDir);
    await expect(
      adapter.healthCheck({ profilePath: profileDir }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("prioritizes the Local State last-used profile", () => {
    const userDataDir = join(tempDir, "User Data");
    const firstProfile = join(userDataDir, "Profile 1");
    const lastUsedProfile = join(userDataDir, "Profile 2");
    mkdirSync(firstProfile, { recursive: true });
    mkdirSync(lastUsedProfile, { recursive: true });
    writeFileSync(join(firstProfile, "History"), "");
    writeFileSync(join(lastUsedProfile, "History"), "");
    writeFileSync(
      join(userDataDir, "Local State"),
      JSON.stringify({
        profile: {
          last_used: "Profile 2",
          info_cache: {
            "Profile 1": {},
            "Profile 2": {},
          },
        },
      }),
      "utf8",
    );
    expect(findChromiumProfiles([userDataDir])).toEqual([
      lastUsedProfile,
      firstProfile,
    ]);
  });
});

describe("BrowserHistoryChromeAdapter collection", () => {
  it("collects ordered visible visits and bookmarks without leaking paths", async () => {
    buildFixture({
      visits: [
        {
          url: "https://new.test",
          title: "New",
          visitTimeMs: NEW_MS,
          typedCount: 1,
        },
        {
          url: "https://old.test",
          title: "Old",
          visitTimeMs: OLD_MS,
          visitDurationMs: 2000,
        },
        {
          url: "https://hidden.test",
          title: "Hidden",
          visitTimeMs: NEW_MS + 1000,
          hidden: true,
        },
      ],
      bookmarks: [
        {
          guid: "bookmark-guid",
          url: "https://bookmark.test",
          name: "Bookmark",
          dateAddedMs: BOOKMARK_MS,
        },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    let complete = false;
    const rows = await collect(adapter, {
      markWatermarkComplete: () => {
        complete = true;
      },
    });

    expect(rows.map((row) => row.payload.url)).toEqual([
      "https://old.test",
      "https://new.test",
      "https://bookmark.test",
    ]);
    expect(rows[0].capturedAt).toBe(OLD_MS);
    expect(rows.at(-1).capturedAt).toBe(BOOKMARK_MS);
    expect(rows.at(-1).payload.folderPath).toBe("\u4e66\u7b7e\u680f");
    expect(complete).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(profileDir);
    expect(JSON.stringify(rows)).not.toContain("History");
  });

  it("includes hidden visits only when requested", async () => {
    buildFixture({
      visits: [
        { url: "https://visible.test", visitTimeMs: OLD_MS },
        {
          url: "https://hidden.test",
          visitTimeMs: NEW_MS,
          hidden: true,
        },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    expect(await collect(adapter)).toHaveLength(1);
    expect(await collect(adapter, { includeHidden: true })).toHaveLength(2);
  });

  it("collects download history while stripping paths and URL credentials", async () => {
    buildFixture({
      downloads: [
        {
          targetPath:
            "C:\\Users\\private-profile\\Downloads\\Quarterly Report.pdf",
          startTimeMs: DOWNLOAD_START_MS,
          endTimeMs: DOWNLOAD_END_MS,
          lastAccessTimeMs: DOWNLOAD_ACCESS_MS,
          receivedBytes: 4096,
          totalBytes: 4096,
          state: 1,
          dangerType: 4,
          opened: true,
          mimeType: "application/pdf",
          contentHash: "ab".repeat(32),
          urlChain: [
            "https://alice:secret@download.test/start?token=credential#private",
            "https://cdn.test/files/Quarterly%20Report.pdf?signature=secret",
          ],
          referrer: "https://portal.test/account?session=secret",
          tabUrl: "https://portal.test/downloads?auth=secret",
        },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    let complete = false;
    const rows = await collect(adapter, {
      include: { history: false, bookmarks: false },
      markWatermarkComplete: () => {
        complete = true;
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "download",
      capturedAt: DOWNLOAD_ACCESS_MS,
      payload: {
        fileName: "Quarterly Report.pdf",
        fileExtension: "pdf",
        sourceUrl: "https://cdn.test/files/Quarterly%20Report.pdf",
        startTimeMs: DOWNLOAD_START_MS,
        endTimeMs: DOWNLOAD_END_MS,
        lastAccessTimeMs: DOWNLOAD_ACCESS_MS,
        state: "complete",
        danger: "maybe-dangerous-content",
        receivedBytes: 4096,
        totalBytes: 4096,
        opened: true,
        contentHashSha256: "ab".repeat(32),
      },
    });
    expect(rows[0].payload.targetPathHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(rows)).not.toMatch(
      /private-profile|C:\\|credential|signature=|session=|auth=|alice|secret/u,
    );
    expect(complete).toBe(true);
  });

  it("replays a download when its completion or access timestamp equals the watermark", async () => {
    buildFixture({
      downloads: [
        {
          startTimeMs: DOWNLOAD_START_MS,
          endTimeMs: DOWNLOAD_END_MS,
          lastAccessTimeMs: DOWNLOAD_ACCESS_MS,
          urlChain: ["https://download.test/file.zip"],
        },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    const rows = await collect(adapter, {
      sinceWatermark: String(DOWNLOAD_ACCESS_MS),
      include: { history: false, bookmarks: false },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].capturedAt).toBe(DOWNLOAD_ACCESS_MS);
  });

  it("honors include gates for history and bookmarks", async () => {
    buildFixture({
      visits: [{ url: "https://visit.test", visitTimeMs: OLD_MS }],
      bookmarks: [
        {
          url: "https://bookmark.test",
          name: "Bookmark",
          dateAddedMs: BOOKMARK_MS,
        },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    const bookmarks = await collect(adapter, {
      include: { history: false },
    });
    expect(bookmarks.every((row) => row.kind === "bookmark")).toBe(true);
    const visits = await collect(adapter, {
      include: { bookmarks: false },
    });
    expect(visits.every((row) => row.kind === "visit")).toBe(true);
  });

  it("uses sinceWatermark with equality replay", async () => {
    buildFixture({
      visits: [
        { url: "https://old.test", visitTimeMs: OLD_MS },
        { url: "https://equal.test", visitTimeMs: NEW_MS },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    const rows = await collect(adapter, {
      sinceWatermark: String(NEW_MS),
      include: { bookmarks: false },
    });
    expect(rows.map((row) => row.payload.url)).toEqual(["https://equal.test"]);
  });

  it("does not complete a scan truncated by limit or maxPages", async () => {
    buildFixture({
      visits: [
        { url: "https://one.test", visitTimeMs: OLD_MS },
        { url: "https://two.test", visitTimeMs: NEW_MS },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    let complete = false;
    const rows = await collect(adapter, {
      maxPages: 1,
      pageSize: 1,
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(rows).toHaveLength(1);
    expect(complete).toBe(false);
    await expect(collect(adapter, { limit: 0 })).rejects.toThrow(
      /positive integer/u,
    );
    await expect(collect(adapter, { pageSize: 50_001 })).rejects.toThrow(
      /must not exceed 50000/u,
    );
  });

  it("redacts the profile path from low-level filesystem failures", async () => {
    buildFixture({
      visits: [{ url: "https://failure.test", visitTimeMs: OLD_MS }],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
      fs: {
        ...nodeFs,
        copyFileSync() {
          const error = new Error(`EACCES: ${profileDir}`);
          error.code = "EACCES";
          throw error;
        },
      },
    });
    let failure;
    try {
      await collect(adapter);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "CHROMIUM_PROFILE_READ_FAILED",
      sourceCode: "EACCES",
    });
    expect(failure.message).not.toContain(profileDir);
  });
});

describe("BrowserHistoryChromeAdapter normalization", () => {
  it("normalizes a visit to a path-free schema-valid browse event", () => {
    const adapter = new BrowserHistoryChromeAdapter({
      defaultProfileDir: () => null,
    });
    const { events } = adapter.normalize({
      kind: "visit",
      originalId: "chrome-visit:profile:42",
      capturedAt: OLD_MS,
      payload: {
        profileId: "profile",
        visitId: 42,
        url: "https://example.test",
        title: "Example",
        visitTimeMs: OLD_MS,
        visitDurationMs: 2000,
        transition: "typed",
        rawTransition: 1,
      },
    });
    expect(events[0].subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(events[0].id).toBe("event-chrome-visit-profile-42");
    expect(events[0].extra.browser).toBe("chrome");
    expect(events[0].extra.profileId).toBe("profile");
    expect(events[0].extra).not.toHaveProperty("profileDir");
    expect(events[0].durationMs).toBe(2000);
    expect(validateEvent(events[0]).valid).toBe(true);
  });

  it("normalizes a bookmark to a path-free schema-valid link item", () => {
    const adapter = new BrowserHistoryChromeAdapter({
      defaultProfileDir: () => null,
    });
    const { items } = adapter.normalize({
      kind: "bookmark",
      originalId: "chrome-bookmark:profile:bookmark",
      capturedAt: BOOKMARK_MS,
      payload: {
        profileId: "profile",
        guid: "bookmark",
        url: "https://bookmark.test",
        name: "Bookmark",
        dateAddedMs: BOOKMARK_MS,
        folderPath: "\u4e66\u7b7e\u680f / Work",
      },
    });
    expect(items[0].subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(items[0].id).toBe("item-chrome-bookmark-profile-bookmark");
    expect(items[0].extra.profileId).toBe("profile");
    expect(items[0].extra).not.toHaveProperty("profileDir");
    expect(validateItem(items[0]).valid).toBe(true);
  });

  it("normalizes a download to a path-free schema-valid download event", () => {
    const adapter = new BrowserHistoryChromeAdapter({
      defaultProfileDir: () => null,
    });
    const { events } = adapter.normalize({
      kind: "download",
      originalId: "chrome-download:profile:download-guid",
      capturedAt: DOWNLOAD_ACCESS_MS,
      payload: {
        profileId: "profile",
        downloadId: 7,
        guid: "download-guid",
        fileName: "Report.pdf",
        fileExtension: "pdf",
        sourceUrl: "https://download.test/Report.pdf",
        initialUrl: "https://download.test/redirect",
        finalUrl: "https://download.test/Report.pdf",
        startTimeMs: DOWNLOAD_START_MS,
        endTimeMs: DOWNLOAD_END_MS,
        lastAccessTimeMs: DOWNLOAD_ACCESS_MS,
        receivedBytes: 4096,
        totalBytes: 4096,
        state: "complete",
        rawState: 1,
        danger: "not-dangerous",
        rawDanger: 0,
        opened: true,
        mimeType: "application/pdf",
        targetPathHash: "cd".repeat(32),
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].subtype).toBe(EVENT_SUBTYPES.DOWNLOAD);
    expect(events[0].id).toBe("event-chrome-download-profile-download-guid");
    expect(events[0].occurredAt).toBe(DOWNLOAD_START_MS);
    expect(events[0].durationMs).toBe(DOWNLOAD_END_MS - DOWNLOAD_START_MS);
    expect(events[0].source.capturedAt).toBe(DOWNLOAD_ACCESS_MS);
    expect(events[0].extra.targetPathHash).toBe("cd".repeat(32));
    expect(JSON.stringify(events[0])).not.toContain("C:\\");
    expect(validateEvent(events[0]).valid).toBe(true);
  });

  it("bounds long titles and rejects unknown raw kinds", () => {
    const adapter = new BrowserHistoryChromeAdapter({
      defaultProfileDir: () => null,
    });
    const { events } = adapter.normalize({
      kind: "visit",
      originalId: "chrome-visit:profile:1",
      capturedAt: OLD_MS,
      payload: {
        profileId: "profile",
        visitId: 1,
        url: "https://title.test",
        title: "A".repeat(500),
        visitTimeMs: OLD_MS,
      },
    });
    expect(events[0].content.title).toHaveLength(201);
    expect(events[0].content.title.endsWith("\u2026")).toBe(true);
    expect(() => adapter.normalize({ kind: "unknown", payload: {} })).toThrow(
      /unknown raw\.kind/u,
    );
  });
});

describe("BrowserHistoryChromeAdapter registry safety", () => {
  it("isolates the encrypted-vault watermark and defers truncated scans", async () => {
    buildFixture({
      visits: [
        { url: "https://one.test", visitTimeMs: OLD_MS },
        { url: "https://two.test", visitTimeMs: NEW_MS },
      ],
    });
    const adapter = new BrowserHistoryChromeAdapter({
      profilePath: profileDir,
    });
    expect(adapter.defaultScope).toMatch(
      /^account:browser-history-chrome:[a-f0-9]{32}$/u,
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

      const complete = await registry.syncAdapter(adapter.name);
      expect(complete.status).toBe("ok");
      expect(complete.watermarkDeferred).toBe(false);
      expect(Number(complete.watermark)).toBeGreaterThanOrEqual(NEW_MS);
      expect(vault.stats().events).toBe(2);
    } finally {
      vault.close();
    }
  });
});

describe("Chromium timestamp and transition helpers", () => {
  it("round-trips WebKit microseconds and decodes transition flags", () => {
    expect(webkitUsToEpochMs(epochMsToWebkitUs(NEW_MS))).toBe(NEW_MS);
    expect(decodeTransition(805306369)).toBe("typed");
    expect(decodeTransition(268435464)).toBe("reload");
    expect(decodeTransition(null)).toBe(null);
  });

  it("decodes persisted download enums and strips sensitive URL components", () => {
    expect(decodeDownloadState(1)).toBe("complete");
    expect(decodeDownloadState(4)).toBe("interrupted");
    expect(decodeDownloadDanger(4)).toBe("maybe-dangerous-content");
    expect(decodeDownloadDanger(25)).toBe("forced-save-to-onedrive");
    expect(
      sanitizeDownloadUrl(
        "https://alice:secret@example.test/file.zip?token=secret#fragment",
      ),
    ).toBe("https://example.test/file.zip");
    expect(sanitizeDownloadUrl("file:///C:/Private/file.zip")).toBe(null);
  });
});
