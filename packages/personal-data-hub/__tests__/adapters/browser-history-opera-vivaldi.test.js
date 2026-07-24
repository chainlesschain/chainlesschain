"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const nodeFs = require("node:fs");
const {
  BrowserHistoryOperaAdapter,
  BROWSER_HISTORY_OPERA_NAME,
  BROWSER_HISTORY_OPERA_VERSION,
} = require("../../lib/adapters/browser-history-opera");
const {
  BrowserHistoryVivaldiAdapter,
  BROWSER_HISTORY_VIVALDI_NAME,
  BROWSER_HISTORY_VIVALDI_VERSION,
} = require("../../lib/adapters/browser-history-vivaldi");
const {
  defaultOperaProfileDir,
  defaultVivaldiProfileDir,
  epochMsToWebkitUs,
} = require("../../lib/adapters/browser-history-chrome");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, ITEM_SUBTYPES } = require("../../lib/constants");

const VISIT_MS = 1_700_000_011_000;
const BOOKMARK_MS = 1_700_000_012_000;

let tempDir;

function buildFixture(profileDir, browser) {
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
    `https://${browser}.example/`,
    `${browser} fixture`,
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
              guid: `${browser}-bookmark`,
              url: `https://${browser}.example/saved`,
              name: `${browser} bookmark`,
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
  tempDir = mkdtempSync(join(tmpdir(), "chromium-variants-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe.each([
  {
    browser: "opera",
    Adapter: BrowserHistoryOperaAdapter,
    name: BROWSER_HISTORY_OPERA_NAME,
    version: BROWSER_HISTORY_OPERA_VERSION,
  },
  {
    browser: "vivaldi",
    Adapter: BrowserHistoryVivaldiAdapter,
    name: BROWSER_HISTORY_VIVALDI_NAME,
    version: BROWSER_HISTORY_VIVALDI_VERSION,
  },
])("BrowserHistory $browser adapter", ({ browser, Adapter, name, version }) => {
  it("inherits the bounded, path-private Chromium contract", () => {
    let discoveryCalls = 0;
    const adapter = new Adapter({
      defaultProfileDir: () => {
        discoveryCalls += 1;
        return null;
      },
    });

    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(name);
    expect(adapter.version).toBe(version);
    expect(adapter.version).toBe("0.2.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        `sync:${browser}-history-sqlite`,
        `sync:${browser}-downloads-sqlite`,
        `sync:${browser}-bookmarks-json`,
        "sync:profile-directory",
      ]),
    );
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(discoveryCalls).toBe(0);
  });

  it("collects and normalizes history plus bookmarks without leaking paths", async () => {
    const profileDir = join(tempDir, browser, "Default");
    buildFixture(profileDir, browser);
    const adapter = new Adapter({ profilePath: profileDir });
    let complete = false;
    const rows = await collect(adapter, {
      markWatermarkComplete: () => {
        complete = true;
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind)).toEqual(["visit", "bookmark"]);
    expect(rows[0].originalId).toMatch(
      new RegExp(`^${browser}-visit:[a-f0-9]{24}:1$`, "u"),
    );
    expect(rows[1].originalId).toMatch(
      new RegExp(`^${browser}-bookmark:[a-f0-9]{24}:${browser}-bookmark$`, "u"),
    );
    expect(complete).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(profileDir);

    const visit = adapter.normalize(rows[0]).events[0];
    const bookmark = adapter.normalize(rows[1]).items[0];
    expect(visit.subtype).toBe(EVENT_SUBTYPES.BROWSE);
    expect(bookmark.subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(visit.extra.browser).toBe(browser);
    expect(bookmark.extra.browser).toBe(browser);
    expect(JSON.stringify({ visit, bookmark })).not.toContain(profileDir);
  });

  it("redacts an absent selected profile from readiness errors", async () => {
    const profileDir = join(tempDir, browser, "missing");
    const adapter = new Adapter({ profilePath: profileDir });
    const result = await adapter.authenticate();

    expect(result).toMatchObject({
      ok: false,
      reason: "PROFILE_NOT_FOUND",
    });
    expect(result.message).toContain(browser);
    expect(JSON.stringify(result)).not.toContain(profileDir);
  });

  it("attributes option validation errors to the concrete adapter", async () => {
    const profileDir = join(tempDir, browser, "Default");
    buildFixture(profileDir, browser);
    const adapter = new Adapter({ profilePath: profileDir });

    await expect(collect(adapter, { limit: 0 })).rejects.toThrow(
      `${name}.sync: limit must be a positive integer`,
    );
  });
});

describe("Opera and Vivaldi default profile discovery", () => {
  it("supports Opera's direct product profile roots and Opera GX fallback", () => {
    const appData = join(tempDir, "AppData", "Roaming");
    const gxProfile = join(appData, "Opera Software", "Opera GX Stable");
    mkdirSync(gxProfile, { recursive: true });
    writeFileSync(join(gxProfile, "History"), "");

    expect(
      defaultOperaProfileDir({
        platform: "win32",
        env: { APPDATA: appData },
        homedir: tempDir,
        fs: nodeFs,
      }),
    ).toBe(gxProfile);
  });

  it("prioritizes Vivaldi's last-used profile from Local State", () => {
    const userData = join(tempDir, "Vivaldi", "User Data");
    const defaultProfile = join(userData, "Default");
    const lastUsedProfile = join(userData, "Profile 2");
    mkdirSync(defaultProfile, { recursive: true });
    mkdirSync(lastUsedProfile, { recursive: true });
    writeFileSync(join(defaultProfile, "History"), "");
    writeFileSync(join(lastUsedProfile, "History"), "");
    writeFileSync(
      join(userData, "Local State"),
      JSON.stringify({
        profile: {
          last_used: "Profile 2",
          info_cache: { Default: {}, "Profile 2": {} },
        },
      }),
      "utf8",
    );

    expect(
      defaultVivaldiProfileDir({
        platform: "win32",
        env: { LOCALAPPDATA: tempDir },
        homedir: tempDir,
        fs: nodeFs,
      }),
    ).toBe(lastUsedProfile);
  });
});
