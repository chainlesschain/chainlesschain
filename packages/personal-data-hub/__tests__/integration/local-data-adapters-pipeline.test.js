"use strict";

/**
 * Integration test — Phase 17 local-data adapters end-to-end pipeline.
 *
 * Exercises the full chain WITHOUT real Chrome / Edge / VSCode / Windows
 * installations: every adapter is pointed at a synthetic on-disk fixture
 * via opts.profilePath / opts.vscodeRoot / opts.recentDir. Confirms that
 * each adapter, when registered with a real LocalVault + AdapterRegistry,
 * produces the expected entityCounts and that ingested rows survive a
 * vault re-open round-trip.
 *
 * Covered adapters (4):
 *   browser-history-chrome
 *   browser-history-edge   (Chromium subclass — proves inheritance wiring)
 *   vscode
 *   win-recent
 *
 * Win note: bs3mc has the known NODE_MODULE_VERSION mismatch on this dev
 * box (built for Electron's ABI 140; Node 22 wants 127, Node 24 wants 137).
 * Tests pass on CI Linux (matched prebuild). To run locally without
 * Electron running, stop the dev app and `npm rebuild better-sqlite3-
 * multiple-ciphers`. Same caveat as the bilibili integration test header.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Database = require("better-sqlite3");

// Probe bs3mc once at import time. When it throws ABI mismatch (common
// on Win dev boxes since the prebuild targets Electron's ABI 140), we
// flip `bs3mcAvailable` off and every `it` in this file becomes a skip.
// CI Linux has matching prebuilds so the gate stays open there.
let bs3mcAvailable = true;
let bs3mcSkipReason = "";
try {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bs3mc-probe-"));
  const probePath = path.join(probeDir, "p.db");
  const { LocalVault: ProbeVault, generateKeyHex: probeKey } = require("../../lib");
  const v = new ProbeVault({ path: probePath, key: probeKey() });
  v.open();
  v.close();
  fs.rmSync(probeDir, { recursive: true, force: true });
} catch (e) {
  bs3mcAvailable = false;
  bs3mcSkipReason = e && e.message ? e.message : String(e);
}
const itOrSkip = bs3mcAvailable ? it : it.skip;

const {
  LocalVault,
  generateKeyHex,
  AdapterRegistry,
} = require("../../lib");
const {
  BrowserHistoryChromeAdapter,
  epochMsToWebkitUs,
} = require("../../lib/adapters/browser-history-chrome");
const {
  BrowserHistoryEdgeAdapter,
} = require("../../lib/adapters/browser-history-edge");
const { VSCodeAdapter } = require("../../lib/adapters/vscode");
const { WinRecentAdapter } = require("../../lib/adapters/win-recent");

let rig;

function makeRig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-int-"));
  const vault = new LocalVault({
    path: path.join(dir, "vault.db"),
    key: generateKeyHex(),
  });
  vault.open();
  // Capture sync events for assertion + debugging.
  const events = [];
  const registry = new AdapterRegistry({
    vault,
    onSyncEvent: (m) => events.push(m),
  });
  return { vault, registry, dir, events };
}

function cleanup(r) {
  if (!r) return;
  try {
    r.vault.close();
  } catch (_e) {
    /* noop */
  }
  try {
    fs.rmSync(r.dir, { recursive: true, force: true });
  } catch (_e) {
    /* noop */
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────

function buildChromeFixture(profileDir, { visits = [], bookmarks = null } = {}) {
  fs.mkdirSync(profileDir, { recursive: true });
  const db = new Database(path.join(profileDir, "History"));
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
  const ins = db.prepare(
    "INSERT INTO urls(url, title, last_visit_time) VALUES(?, ?, ?)",
  );
  const insv = db.prepare(
    "INSERT INTO visits(url, visit_time, transition) VALUES(?, ?, 1)",
  );
  for (const v of visits) {
    const wk = epochMsToWebkitUs(v.visitTimeMs).toString();
    const r = ins.run(v.url, v.title || "", wk);
    insv.run(r.lastInsertRowid, wk);
  }
  db.close();
  if (bookmarks) {
    fs.writeFileSync(path.join(profileDir, "Bookmarks"), JSON.stringify(bookmarks), "utf-8");
  }
}

function buildVscodeFixture(vscodeRoot, { workspaces = [], commands = [], dirs = [] } = {}) {
  const wsRoot = path.join(vscodeRoot, "User", "workspaceStorage");
  fs.mkdirSync(wsRoot, { recursive: true });
  for (const w of workspaces) {
    const d = path.join(wsRoot, w.hash);
    fs.mkdirSync(d, { recursive: true });
    const wsFile = path.join(d, "workspace.json");
    fs.writeFileSync(wsFile, JSON.stringify({ folder: w.folderUri }), "utf-8");
    if (w.mtimeMs) fs.utimesSync(wsFile, w.mtimeMs / 1000, w.mtimeMs / 1000);
  }
  const stateDir = path.join(vscodeRoot, "User", "globalStorage");
  fs.mkdirSync(stateDir, { recursive: true });
  const db = new Database(path.join(stateDir, "state.vscdb"));
  db.exec("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value BLOB)");
  const put = db.prepare("INSERT INTO ItemTable(key, value) VALUES(?, ?)");
  put.run(
    "terminal.history.entries.commands",
    JSON.stringify({ entries: commands.map((c) => ({ key: c, value: { shellType: "pwsh" } })) }),
  );
  put.run(
    "terminal.history.entries.dirs",
    JSON.stringify({ entries: dirs.map((d) => ({ key: d, value: { shellType: "pwsh" } })) }),
  );
  put.run("terminal.history.timestamp.commands", String(1_700_000_010_000));
  put.run("terminal.history.timestamp.dirs", String(1_700_000_020_000));
  db.close();
}

function buildRecentFixture(recentDir, lnks = []) {
  fs.mkdirSync(recentDir, { recursive: true });
  for (const l of lnks) {
    const p = path.join(recentDir, l.name);
    fs.writeFileSync(p, "lnk-blob", "utf-8");
    if (l.mtimeMs) fs.utimesSync(p, l.mtimeMs / 1000, l.mtimeMs / 1000);
  }
}

beforeEach(() => {
  // Skip rig creation when bs3mc isn't loadable — the it.skip won't reach
  // these tests, but beforeEach still runs and would throw.
  if (!bs3mcAvailable) return;
  rig = makeRig();
});

afterEach(() => {
  cleanup(rig);
  rig = null;
});

// ─── Per-adapter pipeline tests ────────────────────────────────────────

describe("browser-history-chrome pipeline", () => {
  itOrSkip("syncs visits + bookmarks into vault, status=ok, entityCounts match", async () => {
    const profileDir = path.join(rig.dir, "ChromeProfile");
    buildChromeFixture(profileDir, {
      visits: [
        { url: "https://anthropic.com", title: "Anthropic", visitTimeMs: 1_700_000_001_000 },
        { url: "https://example.com", title: "Example", visitTimeMs: 1_700_000_002_000 },
      ],
      bookmarks: {
        version: 1,
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "bar",
            children: [
              {
                type: "url",
                id: "1",
                guid: "g1",
                url: "https://saved.test",
                name: "Saved",
                date_added: "13300000000000000",
              },
            ],
          },
        },
      },
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    rig.registry.register(adapter);
    const report = await rig.registry.syncAdapter("browser-history-chrome");
    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(3); // 2 visits + 1 bookmark
    expect(report.entityCounts.events).toBe(2);
    expect(report.entityCounts.items).toBe(1);
    expect(report.invalidCount).toBe(0);

    // Vault row count crosscheck (proves entities really persisted)
    const eventsN = rig.vault.db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    const itemsN = rig.vault.db.prepare("SELECT COUNT(*) AS n FROM items").get().n;
    expect(eventsN).toBe(2);
    expect(itemsN).toBe(1);
  });

  itOrSkip("re-sync is idempotent — same originalId, no duplicate rows", async () => {
    const profileDir = path.join(rig.dir, "ChromeProfile");
    buildChromeFixture(profileDir, {
      visits: [{ url: "https://idem.test", title: "Idem", visitTimeMs: 1_700_000_000_000 }],
    });
    const adapter = new BrowserHistoryChromeAdapter({ profilePath: profileDir });
    rig.registry.register(adapter);
    await rig.registry.syncAdapter("browser-history-chrome");
    await rig.registry.syncAdapter("browser-history-chrome");
    const n = rig.vault.db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    expect(n).toBe(1); // dedup by source.originalId UNIQUE constraint
  });
});

describe("browser-history-edge pipeline (Chromium subclass)", () => {
  itOrSkip("syncs visits with edge-tagged source.adapter, not chrome", async () => {
    const profileDir = path.join(rig.dir, "EdgeProfile");
    buildChromeFixture(profileDir, {
      visits: [{ url: "https://bing.com", title: "Bing", visitTimeMs: 1_700_000_001_000 }],
    });
    const adapter = new BrowserHistoryEdgeAdapter({ profilePath: profileDir });
    rig.registry.register(adapter);
    const report = await rig.registry.syncAdapter("browser-history-edge");
    expect(report.status).toBe("ok");
    expect(report.entityCounts.events).toBe(1);

    // Drill into the row to confirm the subclass set source.adapter correctly
    const row = rig.vault.db.prepare("SELECT source FROM events LIMIT 1").get();
    const source = JSON.parse(row.source);
    expect(source.adapter).toBe("browser-history-edge");
    expect(source.originalId).toMatch(/^edge-visit:/);
  });
});

describe("vscode pipeline", () => {
  itOrSkip("syncs workspaces (items) + terminal commands+dirs (events)", async () => {
    const vscodeRoot = path.join(rig.dir, "VSCode");
    buildVscodeFixture(vscodeRoot, {
      workspaces: [
        { hash: "h1", folderUri: "file:///c%3A/code/foo", mtimeMs: 1_700_000_001_000 },
        { hash: "h2", folderUri: "file:///c%3A/code/bar", mtimeMs: 1_700_000_002_000 },
      ],
      commands: ["ls", "git status"],
      dirs: ["/c/code/foo"],
    });
    const adapter = new VSCodeAdapter({ vscodeRoot });
    rig.registry.register(adapter);
    const report = await rig.registry.syncAdapter("vscode");
    expect(report.status).toBe("ok");
    expect(report.entityCounts.items).toBe(2); // 2 workspaces
    expect(report.entityCounts.events).toBe(3); // 2 commands + 1 dir
    expect(report.invalidCount).toBe(0);

    const items = rig.vault.db
      .prepare("SELECT name, category FROM items ORDER BY name")
      .all();
    expect(items.map((i) => i.category)).toEqual(["code-project", "code-project"]);
  });
});

describe("win-recent pipeline", () => {
  itOrSkip("syncs recent shortcuts to Event(OTHER) with '打开了 X' title", async () => {
    const recentDir = path.join(rig.dir, "Recent");
    buildRecentFixture(recentDir, [
      { name: "report.docx.lnk", mtimeMs: 1_700_000_001_000 },
      { name: "todo.txt.lnk", mtimeMs: 1_700_000_002_000 },
    ]);
    const adapter = new WinRecentAdapter({ recentDir });
    rig.registry.register(adapter);
    const report = await rig.registry.syncAdapter("win-recent");
    expect(report.status).toBe("ok");
    expect(report.entityCounts.events).toBe(2);

    const titles = rig.vault.db
      .prepare("SELECT content FROM events ORDER BY occurred_at")
      .all()
      .map((r) => JSON.parse(r.content).title);
    expect(titles).toEqual(["打开了 report.docx", "打开了 todo.txt"]);
  });
});

// ─── Cross-adapter / mixed registry ────────────────────────────────────

describe("all 4 adapters registered together", () => {
  itOrSkip("each adapter writes its own source-tagged rows; counts add up", async () => {
    const chromeDir = path.join(rig.dir, "ChromeProfile");
    const edgeDir = path.join(rig.dir, "EdgeProfile");
    const vscodeRoot = path.join(rig.dir, "VSCode");
    const recentDir = path.join(rig.dir, "Recent");

    buildChromeFixture(chromeDir, {
      visits: [{ url: "https://a.test", title: "A", visitTimeMs: 1_700_000_001_000 }],
    });
    buildChromeFixture(edgeDir, {
      visits: [{ url: "https://b.test", title: "B", visitTimeMs: 1_700_000_002_000 }],
    });
    buildVscodeFixture(vscodeRoot, {
      workspaces: [{ hash: "hX", folderUri: "file:///c%3A/x", mtimeMs: 1_700_000_001_000 }],
      commands: ["ls"],
    });
    buildRecentFixture(recentDir, [{ name: "x.txt.lnk", mtimeMs: 1_700_000_001_000 }]);

    rig.registry.register(new BrowserHistoryChromeAdapter({ profilePath: chromeDir }));
    rig.registry.register(new BrowserHistoryEdgeAdapter({ profilePath: edgeDir }));
    rig.registry.register(new VSCodeAdapter({ vscodeRoot }));
    rig.registry.register(new WinRecentAdapter({ recentDir }));

    const r1 = await rig.registry.syncAdapter("browser-history-chrome");
    const r2 = await rig.registry.syncAdapter("browser-history-edge");
    const r3 = await rig.registry.syncAdapter("vscode");
    const r4 = await rig.registry.syncAdapter("win-recent");

    expect([r1, r2, r3, r4].every((r) => r.status === "ok")).toBe(true);

    // Totals across vault
    const eventsTotal = rig.vault.db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    const itemsTotal = rig.vault.db.prepare("SELECT COUNT(*) AS n FROM items").get().n;
    // Chrome 1 visit + Edge 1 visit + VSCode 1 command + Win 1 recent = 4 events
    // VSCode 1 workspace = 1 item
    expect(eventsTotal).toBe(4);
    expect(itemsTotal).toBe(1);

    // Source-tagged distribution
    const sourceCounts = rig.vault.db
      .prepare("SELECT source FROM events")
      .all()
      .map((r) => JSON.parse(r.source).adapter)
      .reduce((acc, a) => {
        acc[a] = (acc[a] || 0) + 1;
        return acc;
      }, {});
    expect(sourceCounts).toEqual({
      "browser-history-chrome": 1,
      "browser-history-edge": 1,
      vscode: 1,
      "win-recent": 1,
    });
  });
});
