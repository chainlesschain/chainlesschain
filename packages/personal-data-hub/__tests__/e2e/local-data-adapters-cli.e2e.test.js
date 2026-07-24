"use strict";

/**
 * E2E — spawn the cc CLI and exercise the real `hub list-adapters` +
 * `hub sync-adapter` commands against a sandboxed APPDATA dir. Validates
 * the entire path PDH wiring → registry → CLI gateway → JSON stdout for
 * the Phase 17 local collection adapters.
 *
 * Same bs3mc-on-Win caveat as the integration test: skip when LocalVault
 * cannot open. CI Linux runs the real chain.
 *
 * Strategy: redirect APPDATA / XDG_CONFIG_HOME / HOME to a tmpdir so the
 * CLI's getElectronUserDataDir() resolves to that tmpdir and we don't
 * touch the user's real chainlesschain-desktop-vue/.chainlesschain dir.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

// Probe bs3mc once — same gate as the integration test.
let bs3mcAvailable = true;
try {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bs3mc-e2e-probe-"));
  const { LocalVault: PV, generateKeyHex: PK } = require("../../lib");
  const v = new PV({ path: path.join(probeDir, "p.db"), key: PK() });
  v.open();
  v.close();
  fs.rmSync(probeDir, { recursive: true, force: true });
} catch {
  bs3mcAvailable = false;
}
// Resolve the CLI entry — we run it through node directly (avoids cc
// PATH lookup hassles + the workspace symlink resolves to current source).
// In the FTS5 sandbox runner (lib/ + __tests__/ copied to $TMPDIR) the
// relative ../../../cli path resolves outside the repo and is missing;
// gate the tests so they skip cleanly when the CLI binary is absent.
const CLI_BIN = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "cli",
  "bin",
  "chainlesschain.js",
);
const cliBinAvailable = fs.existsSync(CLI_BIN);

const itOrSkip = bs3mcAvailable && cliBinAvailable ? it : it.skip;

let sandboxAppData;

function runCli(args, { timeoutMs = 60_000 } = {}) {
  const env = {
    ...process.env,
    // Override the platform user-data dir lookup so initHub() builds its
    // vault inside our sandbox instead of the real user profile.
    APPDATA: sandboxAppData,
    LOCALAPPDATA: sandboxAppData,
    XDG_CONFIG_HOME: sandboxAppData,
    HOME: sandboxAppData,
    USERPROFILE: sandboxAppData,
    // Prevent CC from launching the auto-update probe / telemetry pings
    // mid-test (those can hang the spawn).
    CC_DISABLE_TELEMETRY: "1",
    CC_DISABLE_AUTOUPDATE: "1",
    NO_COLOR: "1",
  };
  const res = spawnSync(process.execPath, [CLI_BIN, ...args], {
    env,
    encoding: "utf-8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    code: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    signal: res.signal,
    error: res.error,
  };
}

function buildChromiumCliFixture(profileDir, browser) {
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
      url INTEGER NOT NULL, visit_time INTEGER NOT NULL,
      from_visit INTEGER, transition INTEGER DEFAULT 0 NOT NULL,
      visit_duration INTEGER DEFAULT 0 NOT NULL
    );
    CREATE TABLE downloads(
      id INTEGER PRIMARY KEY,
      guid TEXT NOT NULL,
      current_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
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
      mime_type TEXT NOT NULL,
      original_mime_type TEXT NOT NULL
    );
    CREATE TABLE downloads_url_chains(
      id INTEGER NOT NULL,
      chain_index INTEGER NOT NULL,
      url TEXT NOT NULL,
      PRIMARY KEY(id, chain_index)
    );
    INSERT INTO urls(url,title,last_visit_time)
      VALUES('https://${browser}.example/', '${browser} fixture', 13344473602000000);
    INSERT INTO visits(url,visit_time,transition)
      VALUES(1, 13344473602000000, 1);
  `);
  const downloadPath = path.join(
    profileDir,
    "private-downloads",
    `${browser}-fixture.pdf`,
  );
  db.prepare(
    `INSERT INTO downloads(
      id,guid,current_path,target_path,start_time,received_bytes,total_bytes,
      state,danger_type,interrupt_reason,hash,end_time,opened,last_access_time,
      transient,mime_type,original_mime_type
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    1,
    `${browser}-download`,
    downloadPath,
    downloadPath,
    "13344473604000000",
    2048,
    2048,
    1,
    0,
    0,
    Buffer.alloc(0),
    "13344473605000000",
    1,
    "13344473605000000",
    0,
    "application/pdf",
    "application/pdf",
  );
  db.prepare(
    "INSERT INTO downloads_url_chains(id,chain_index,url) VALUES(?,?,?)",
  ).run(1, 0, `https://${browser}.example/files/fixture.pdf?token=private`);
  db.close();
  fs.writeFileSync(
    path.join(profileDir, "Bookmarks"),
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
              name: `${browser} saved`,
              date_added: "13344473603000000",
              date_last_used: "13344473603000000",
            },
          ],
        },
      },
    }),
    "utf8",
  );
}

function buildSafariCliFixture(profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const db = new Database(path.join(profileDir, "History.db"));
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
    INSERT INTO history_items
      VALUES(1, 'https://safari.example/', 1);
    INSERT INTO history_visits
      VALUES(10, 1, 721692800, 'Safari fixture', 1, 0);
  `);
  db.close();
  fs.writeFileSync(
    path.join(profileDir, "Bookmarks.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
  <key>Children</key><array><dict>
    <key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
    <key>WebBookmarkUUID</key><string>safari-cli-bookmark</string>
    <key>URLString</key><string>https://safari.example/saved</string>
    <key>URIDictionary</key><dict><key>title</key><string>Safari saved</string></dict>
    <key>DateAdded</key><date>2023-11-14T22:13:21Z</date>
  </dict></array>
</dict></plist>`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(profileDir, "Downloads.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>DownloadHistory</key><array><dict>
    <key>DownloadEntryIdentifier</key><string>safari-cli-download</string>
    <key>DownloadEntryURL</key><string>https://user:password@downloads.safari.example/report.pdf?token=private#fragment</string>
    <key>DownloadEntryPath</key><string>/Users/private/Downloads/report.pdf</string>
    <key>DownloadEntryDateAddedKey</key><date>2023-11-14T22:13:22Z</date>
    <key>DownloadEntryDateFinishedKey</key><date>2023-11-14T22:13:23Z</date>
    <key>DownloadEntryProgressBytesSoFar</key><integer>2048</integer>
    <key>DownloadEntryProgressTotalToLoad</key><integer>2048</integer>
  </dict></array>
</dict></plist>`,
    "utf8",
  );
}

function buildTencentMeetingCliFixture(rootDir) {
  const databaseDir = path.join(rootDir, "Global", "Database");
  fs.mkdirSync(databaseDir, { recursive: true });
  const db = new Database(path.join(databaseDir, "history-fixture.db"));
  db.exec(`
    CREATE TABLE historical_meetings_cloud_cache(
      id INTEGER PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      period_id TEXT,
      meeting_subject TEXT,
      meeting_begin_time INTEGER NOT NULL,
      meeting_end_time INTEGER,
      creator_nickname TEXT,
      creator_app_uid TEXT,
      participants_json TEXT,
      participants_count INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO historical_meetings_cloud_cache(
       id, meeting_id, period_id, meeting_subject, meeting_begin_time,
       meeting_end_time, creator_nickname, creator_app_uid,
       participants_json, participants_count
     ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    1,
    "private-cli-meeting-id",
    "period-1",
    "CLI fixture meeting",
    1_700_000_000,
    1_700_003_600,
    "Fixture participant",
    "private-cli-participant-id",
    JSON.stringify([
      {
        app_id: "1400187600",
        app_uid: "private-cli-participant-id",
        nick_name: "Fixture participant",
      },
    ]),
    1,
  );
  db.close();
}

function buildVscodeCliFixture(rootDir) {
  const workspaceDir = path.join(
    rootDir,
    "User",
    "workspaceStorage",
    "workspace-fixture",
  );
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.json"),
    JSON.stringify({ folder: "file:///c%3A/private/project" }),
    "utf8",
  );

  const globalStorageDir = path.join(rootDir, "User", "globalStorage");
  fs.mkdirSync(globalStorageDir, { recursive: true });
  const db = new Database(path.join(globalStorageDir, "state.vscdb"));
  db.exec("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value BLOB)");
  const insert = db.prepare("INSERT INTO ItemTable(key, value) VALUES(?, ?)");
  insert.run(
    "terminal.history.entries.commands",
    JSON.stringify({
      entries: [{ key: "git status", value: { shellType: "pwsh" } }],
    }),
  );
  insert.run(
    "terminal.history.entries.dirs",
    JSON.stringify({
      entries: [{ key: "C:\\private\\project", value: { shellType: "pwsh" } }],
    }),
  );
  insert.run("terminal.history.timestamp.commands", "1700000010000");
  insert.run("terminal.history.timestamp.dirs", "1700000020000");
  db.close();

  const historyDir = path.join(rootDir, "User", "History", "history-fixture");
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(
    path.join(historyDir, "entries.json"),
    JSON.stringify({
      version: 1,
      resource: "file:///c%3A/private/project/index.js",
      entries: [{ id: "a1.js", timestamp: 1_700_000_030_000 }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(historyDir, "a1.js"),
    "private source content that must not be imported",
    "utf8",
  );
}

function buildCursorCliFixture(rootDir, cursorHome) {
  buildVscodeCliFixture(rootDir);

  const transcriptDir = path.join(
    cursorHome,
    "projects",
    "private-project-key",
    "agent-transcripts",
    "private-agent-id",
  );
  fs.mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = path.join(
    transcriptDir,
    "private-conversation-id.jsonl",
  );
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        role: "user",
        message: {
          content: [{ type: "text", text: "Fixture Cursor prompt" }],
        },
      }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "text", text: "Fixture Cursor response" }],
        },
      }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
      "",
    ].join("\n"),
    "utf8",
  );
  fs.utimesSync(transcriptPath, 1_700_000_040, 1_700_000_040);

  const trackingDir = path.join(cursorHome, "ai-tracking");
  fs.mkdirSync(trackingDir, { recursive: true });
  const tracking = new Database(path.join(trackingDir, "ai-code-tracking.db"));
  tracking.exec(`
    CREATE TABLE conversation_summaries (
      conversationId TEXT,
      title TEXT,
      tldr TEXT,
      overview TEXT,
      summaryBullets TEXT,
      model TEXT,
      mode TEXT,
      updatedAt INTEGER
    );
    CREATE TABLE ai_code_hashes (
      hash TEXT,
      source TEXT,
      fileExtension TEXT,
      fileName TEXT,
      requestId TEXT,
      conversationId TEXT,
      timestamp INTEGER,
      model TEXT,
      createdAt INTEGER
    );
    CREATE TABLE tracked_file_content (
      gitPath TEXT,
      content TEXT,
      conversationId TEXT,
      model TEXT,
      fileExtension TEXT,
      createdAt INTEGER
    );
  `);
  tracking
    .prepare(
      `INSERT INTO conversation_summaries
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      "private-conversation-id",
      "Fixture Cursor conversation",
      "Fixture summary",
      "Fixture overview",
      JSON.stringify(["fixture point"]),
      "fixture-model",
      "agent",
      1_700_000_050_000,
    );
  tracking
    .prepare(`INSERT INTO ai_code_hashes VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(
      "private-code-hash",
      "composer",
      ".ts",
      "private-file.ts",
      "private-request-id",
      "private-conversation-id",
      1_700_000_060,
      "fixture-model",
      null,
    );
  tracking
    .prepare(`INSERT INTO tracked_file_content VALUES (?,?,?,?,?,?)`)
    .run(
      "private/git/path.ts",
      "private tracked source content",
      "private-conversation-id",
      "fixture-model",
      ".ts",
      1_700_000_070_000,
    );
  tracking.close();
}

function buildClaudeCodeCliFixture(claudeHome) {
  const projectDir = path.join(
    claudeHome,
    "projects",
    "C--Users--private-user--secret-project",
  );
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "private-session-id.jsonl"),
    [
      JSON.stringify({
        type: "ai-title",
        aiTitle: "Fixture Claude Code session",
        sessionId: "private-session-id",
      }),
      JSON.stringify({
        type: "user",
        uuid: "private-user-message-id",
        cwd: "C:\\private\\secret-project",
        timestamp: "2023-11-14T22:13:20.000Z",
        message: {
          role: "user",
          content: "Explain this fixture.",
        },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "private-assistant-message-id",
        requestId: "private-request-id",
        timestamp: "2023-11-14T22:13:30.000Z",
        message: {
          role: "assistant",
          model: "claude-fixture-model",
          usage: { input_tokens: 10, output_tokens: 20 },
          content: [
            { type: "thinking", thinking: "private chain of thought" },
            { type: "text", text: "Fixture collection is safe." },
            {
              type: "tool_use",
              id: "private-tool-id",
              name: "Bash",
              input: { command: "private command" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "private-tool-result-id",
        timestamp: "2023-11-14T22:13:40.000Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "private-tool-id",
              content: "private command output",
            },
          ],
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const subagentDir = path.join(projectDir, "private-session-id", "subagents");
  fs.mkdirSync(subagentDir, { recursive: true });
  fs.writeFileSync(
    path.join(subagentDir, "agent-private-agent-id.jsonl"),
    [
      JSON.stringify({
        type: "user",
        uuid: "private-subagent-user-id",
        timestamp: "2023-11-14T22:14:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Inspect the fixture." }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "private-subagent-assistant-id",
        timestamp: "2023-11-14T22:14:10.000Z",
        message: {
          role: "assistant",
          model: "claude-fixture-model",
          content: [{ type: "text", text: "Inspection completed safely." }],
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(claudeHome, "stats-cache.json"),
    JSON.stringify({
      dailyActivity: [
        {
          date: "2023-11-14",
          messageCount: 4,
          sessionCount: 2,
          toolCallCount: 1,
        },
      ],
      dailyModelTokens: [
        {
          date: "2023-11-14",
          tokensByModel: {
            "claude-fixture-model": 30,
            "claude-secondary-model": 5,
          },
        },
      ],
      longestSession: { sessionId: "private-longest-session-id" },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(claudeHome, ".credentials.json"),
    JSON.stringify({ oauthToken: "private-oauth-token" }),
    "utf8",
  );
}

function buildJetBrainsCliFixture(rootDir) {
  const optionsDirectory = path.join(rootDir, "IntelliJIdea2025.3", "options");
  fs.mkdirSync(optionsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(optionsDirectory, "recentProjects.xml"),
    `<application><component name="RecentProjectsManager">
      <option name="additionalInfo"><map>
        <entry key="C:\\private\\jetbrains-project"><value>
          <RecentProjectMetaInfo opened="true" frameTitle="private title" projectWorkspaceId="private-workspace-id">
            <option name="productionCode" value="IU" />
            <option name="projectOpenTimestamp" value="1700000010000" />
            <option name="activationTimestamp" value="1700000020000" />
            <option name="currentBranch" value="private-feature" />
          </RecentProjectMetaInfo>
        </value></entry>
      </map></option>
    </component></application>`,
    "utf8",
  );
}

function buildHBuilderXCliFixture(rootDir) {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "file-activity.ini"),
    `[recent-1]
filepath=C:\\private\\hbuilderx-project\\secret.vue
datetime=2026-07-24 12:34:5678
encoding=@ByteArray(UTF-8)
`,
    "utf8",
  );
}

beforeAll(() => {
  if (!bs3mcAvailable) return;
  sandboxAppData = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-e2e-appdata-"));
});

afterAll(() => {
  if (sandboxAppData) {
    try {
      fs.rmSync(sandboxAppData, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

describe("cc hub list-adapters — desktop local adapters registered", () => {
  itOrSkip(
    "lists all desktop browsers plus VS Code / Windows Recent",
    () => {
      const r = runCli(["hub", "list-adapters", "--json"]);
      // Stderr may carry deprecation noise; we only assert on the JSON stdout.
      expect(r.code).toBe(0);
      let parsed;
      try {
        parsed = JSON.parse(r.stdout);
      } catch {
        throw new Error(
          `list-adapters did not emit JSON (code=${r.code}, signal=${r.signal})\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
        );
      }
      const names = parsed.map((a) => a.name);
      for (const expected of [
        "browser-history-chrome",
        "browser-history-edge",
        "browser-history-brave",
        "browser-history-opera",
        "browser-history-vivaldi",
        "browser-history-safari",
        "browser-history-firefox",
        "meeting-tencent",
        "vscode",
        "vscodium",
        "cursor",
        "claude-code",
        "jetbrains-ide",
        "hbuilderx",
        "win-recent",
      ]) {
        expect(names).toContain(expected);
      }
      // Per-test timeout must EXCEED runCli's 60s spawn budget (trap #31:
      // per-test/child timeout inversion). The default 10s vitest timeout
      // reaps the cold CLI subprocess spawn under full-suite/parallel load
      // before it can finish — even though the spawn itself is given 60s.
    },
    65_000,
  );
});

describe("cc hub sync-adapter — drives one adapter end-to-end", () => {
  itOrSkip(
    "collects a Firefox Places fixture through CLI wiring and encrypted vault",
    () => {
      const profileDir = path.join(
        sandboxAppData,
        "firefox-fixture",
        "profile.default-release",
      );
      fs.mkdirSync(profileDir, { recursive: true });
      const db = new Database(path.join(profileDir, "places.sqlite"));
      db.exec(`
        CREATE TABLE moz_places(
          id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT,
          visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0,
          typed INTEGER DEFAULT 0, guid TEXT
        );
        CREATE TABLE moz_historyvisits(
          id INTEGER PRIMARY KEY, from_visit INTEGER DEFAULT 0,
          place_id INTEGER NOT NULL, visit_date INTEGER NOT NULL,
          visit_type INTEGER DEFAULT 1
        );
        CREATE TABLE moz_bookmarks(
          id INTEGER PRIMARY KEY, type INTEGER NOT NULL, fk INTEGER,
          parent INTEGER, title TEXT, dateAdded INTEGER DEFAULT 0,
          lastModified INTEGER DEFAULT 0, guid TEXT
        );
        CREATE TABLE moz_anno_attributes(
          id INTEGER PRIMARY KEY, name TEXT NOT NULL
        );
        CREATE TABLE moz_annos(
          id INTEGER PRIMARY KEY, place_id INTEGER NOT NULL,
          anno_attribute_id INTEGER NOT NULL, content TEXT,
          dateAdded INTEGER DEFAULT 0, lastModified INTEGER DEFAULT 0
        );
        INSERT INTO moz_places
          VALUES(1, 'https://firefox.example/', 'Firefox fixture', 1, 0, 1, 'place-guid');
        INSERT INTO moz_places
          VALUES(2, 'https://user:password@downloads.example/report.pdf?token=secret#fragment', 'report.pdf', 1, 0, 0, 'download-guid');
        INSERT INTO moz_historyvisits
          VALUES(10, 0, 1, 1700000000000000, 2);
        INSERT INTO moz_historyvisits
          VALUES(11, 0, 2, 1700000002000000, 7);
        INSERT INTO moz_bookmarks
          VALUES(1, 2, NULL, 0, '', 0, 0, 'root________');
        INSERT INTO moz_bookmarks
          VALUES(2, 2, NULL, 1, 'Toolbar', 0, 0, 'toolbar_____');
        INSERT INTO moz_bookmarks
          VALUES(3, 1, 1, 2, 'Saved fixture', 1700000000000000, 1700000001000000, 'bookmark-guid');
        INSERT INTO moz_anno_attributes
          VALUES(1, 'downloads/metaData');
        INSERT INTO moz_anno_attributes
          VALUES(2, 'downloads/destinationFileURI');
        INSERT INTO moz_annos
          VALUES(1, 2, 1, '{"state":1,"endTime":"2023-11-14T22:13:23.000Z","fileSize":2048}', 1700000002000000, 1700000003000000);
        INSERT INTO moz_annos
          VALUES(2, 2, 2, 'file:///C:/Users/private/Downloads/report.pdf', 1700000002000000, 1700000003000000);
      `);
      db.close();

      const result = runCli([
        "hub",
        "sync-adapter",
        "browser-history-firefox",
        "--profile-path",
        profileDir,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `Firefox sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "browser-history-firefox",
        status: "ok",
        rawCount: 3,
        entityCounts: {
          events: 2,
          items: 1,
        },
      });
      expect(JSON.stringify(report)).not.toContain(profileDir);
    },
    65_000,
  );

  itOrSkip(
    "collects a Brave Chromium fixture through CLI wiring and encrypted vault",
    () => {
      const profileDir = path.join(sandboxAppData, "brave-fixture", "Default");
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
          url INTEGER NOT NULL, visit_time INTEGER NOT NULL,
          from_visit INTEGER, transition INTEGER DEFAULT 0 NOT NULL,
          visit_duration INTEGER DEFAULT 0 NOT NULL
        );
        INSERT INTO urls(url,title,last_visit_time)
          VALUES('https://brave.example/', 'Brave fixture', 13344473600000000);
        INSERT INTO visits(url,visit_time,transition)
          VALUES(1, 13344473600000000, 1);
      `);
      db.close();
      fs.writeFileSync(
        path.join(profileDir, "Bookmarks"),
        JSON.stringify({
          roots: {
            bookmark_bar: {
              type: "folder",
              children: [
                {
                  type: "url",
                  id: "1",
                  guid: "brave-bookmark",
                  url: "https://search.brave.com/",
                  name: "Brave Search",
                  date_added: "13344473601000000",
                  date_last_used: "13344473601000000",
                },
              ],
            },
          },
        }),
        "utf8",
      );

      const result = runCli([
        "hub",
        "sync-adapter",
        "browser-history-brave",
        "--profile-path",
        profileDir,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `Brave sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "browser-history-brave",
        status: "ok",
        rawCount: 2,
        entityCounts: {
          events: 1,
          items: 1,
        },
      });
      expect(JSON.stringify(report)).not.toContain(profileDir);
      expect(JSON.stringify(report)).not.toContain("token=private");
    },
    65_000,
  );

  itOrSkip(
    "collects Opera and Vivaldi fixtures through CLI wiring and encrypted vault",
    () => {
      for (const adapterName of [
        "browser-history-opera",
        "browser-history-vivaldi",
      ]) {
        const browser = adapterName.replace("browser-history-", "");
        const profileDir = path.join(
          sandboxAppData,
          `${browser}-fixture`,
          browser === "opera" ? "Opera Stable" : "Default",
        );
        buildChromiumCliFixture(profileDir, browser);

        const result = runCli([
          "hub",
          "sync-adapter",
          adapterName,
          "--profile-path",
          profileDir,
          "--json",
        ]);
        let report;
        try {
          report = JSON.parse(result.stdout);
        } catch {
          throw new Error(
            `${browser} sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
          );
        }
        expect(
          result.code,
          JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
        ).toBe(0);
        expect(report).toMatchObject({
          adapter: adapterName,
          status: "ok",
          rawCount: 3,
          entityCounts: {
            events: 2,
            items: 1,
          },
        });
        expect(JSON.stringify(report)).not.toContain(profileDir);
        expect(JSON.stringify(report)).not.toContain("token=private");
      }
    },
    130_000,
  );

  itOrSkip(
    "collects a Safari fixture through CLI wiring and encrypted vault",
    () => {
      const profileDir = path.join(sandboxAppData, "safari-fixture", "Safari");
      buildSafariCliFixture(profileDir);

      const result = runCli([
        "hub",
        "sync-adapter",
        "browser-history-safari",
        "--profile-path",
        profileDir,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `Safari sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "browser-history-safari",
        status: "ok",
        rawCount: 3,
        entityCounts: {
          events: 2,
          items: 1,
        },
      });
      expect(JSON.stringify(report)).not.toContain(profileDir);
      expect(JSON.stringify(report)).not.toContain("token=private");
    },
    65_000,
  );

  itOrSkip(
    "collects a Tencent Meeting fixture through CLI wiring and encrypted vault",
    () => {
      const rootDir = path.join(
        sandboxAppData,
        "tencent-meeting-fixture",
        "WeMeet",
      );
      buildTencentMeetingCliFixture(rootDir);

      const result = runCli([
        "hub",
        "sync-adapter",
        "meeting-tencent",
        "--profile-path",
        rootDir,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `Tencent Meeting sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "meeting-tencent",
        status: "ok",
        rawCount: 1,
        entityCounts: {
          events: 1,
          persons: 1,
        },
      });
      expect(JSON.stringify(report)).not.toContain(rootDir);
      expect(JSON.stringify(report)).not.toContain(
        "private-cli-participant-id",
      );
    },
    65_000,
  );

  itOrSkip(
    "collects VS Code save metadata and honors --no-local-history",
    () => {
      const rootDir = path.join(sandboxAppData, "vscode-fixture", "Code");
      buildVscodeCliFixture(rootDir);

      const collected = runCli([
        "hub",
        "sync-adapter",
        "vscode",
        "--profile-path",
        rootDir,
        "--json",
      ]);
      let collectedReport;
      try {
        collectedReport = JSON.parse(collected.stdout);
      } catch {
        throw new Error(
          `VS Code sync did not emit JSON (code=${collected.code})\nstdout: ${collected.stdout.slice(0, 400)}\nstderr: ${collected.stderr.slice(0, 400)}`,
        );
      }
      expect(
        collected.code,
        JSON.stringify({
          report: collectedReport,
          stderr: collected.stderr.slice(0, 1000),
        }),
      ).toBe(0);
      expect(collectedReport).toMatchObject({
        adapter: "vscode",
        status: "ok",
        rawCount: 4,
        entityCounts: {
          events: 3,
          items: 1,
        },
      });
      expect(JSON.stringify(collectedReport)).not.toContain(rootDir);

      const excludedRoot = path.join(
        sandboxAppData,
        "vscode-no-history-fixture",
        "Code",
      );
      buildVscodeCliFixture(excludedRoot);
      const excluded = runCli([
        "hub",
        "sync-adapter",
        "vscode",
        "--profile-path",
        excludedRoot,
        "--no-local-history",
        "--json",
      ]);
      const excludedReport = JSON.parse(excluded.stdout);
      expect(excluded.code).toBe(0);
      expect(excludedReport).toMatchObject({
        adapter: "vscode",
        status: "ok",
        rawCount: 3,
        entityCounts: {
          events: 2,
          items: 1,
        },
      });
    },
    130_000,
  );

  itOrSkip(
    "collects VSCodium activity through the shared local editor pipeline",
    () => {
      const rootDir = path.join(sandboxAppData, "vscodium-fixture", "VSCodium");
      buildVscodeCliFixture(rootDir);

      const result = runCli([
        "hub",
        "sync-adapter",
        "vscodium",
        "--profile-path",
        rootDir,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `VSCodium sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "vscodium",
        status: "ok",
        rawCount: 4,
        entityCounts: {
          events: 3,
          items: 1,
        },
      });
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(rootDir);
      expect(serialized).not.toContain("C:\\private");
      expect(serialized).not.toContain("private source content");
    },
    65_000,
  );

  itOrSkip(
    "collects Cursor editor and Agent data without exposing local identifiers",
    () => {
      const rootDir = path.join(sandboxAppData, "cursor-fixture", "Cursor");
      const cursorHome = path.join(sandboxAppData, "cursor-fixture", ".cursor");
      buildCursorCliFixture(rootDir, cursorHome);

      const result = runCli([
        "hub",
        "sync-adapter",
        "cursor",
        "--profile-path",
        rootDir,
        "--cursor-home",
        cursorHome,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `Cursor sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "cursor",
        status: "ok",
        rawCount: 8,
        entityCounts: {
          events: 7,
          items: 1,
          persons: 4,
          topics: 3,
        },
      });
      const serialized = JSON.stringify(report);
      for (const forbidden of [
        rootDir,
        cursorHome,
        "private-agent-id",
        "private-conversation-id",
        "private-request-id",
        "private tracked source content",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    },
    65_000,
  );

  itOrSkip(
    "collects Claude Code conversations and aggregates without exposing local identifiers",
    () => {
      const claudeHome = path.join(
        sandboxAppData,
        "claude-code-fixture",
        ".claude",
      );
      fs.mkdirSync(claudeHome, { recursive: true });
      buildClaudeCodeCliFixture(claudeHome);

      const result = runCli([
        "hub",
        "sync-adapter",
        "claude-code",
        "--claude-home",
        claudeHome,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `Claude Code sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "claude-code",
        status: "ok",
        rawCount: 7,
        entityCounts: {
          events: 7,
          persons: 7,
          topics: 4,
        },
      });
      const serialized = JSON.stringify(report);
      for (const forbidden of [
        claudeHome,
        "private-session-id",
        "private-agent-id",
        "private-request-id",
        "private command",
        "private command output",
        "private chain of thought",
        "private-oauth-token",
        "private-longest-session-id",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    },
    65_000,
  );

  itOrSkip(
    "collects a JetBrains recent-project fixture without exposing paths",
    () => {
      const rootDir = path.join(
        sandboxAppData,
        "jetbrains-fixture",
        "JetBrains",
      );
      buildJetBrainsCliFixture(rootDir);
      const result = runCli([
        "hub",
        "sync-adapter",
        "jetbrains-ide",
        "--profile-path",
        rootDir,
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `JetBrains sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "jetbrains-ide",
        status: "ok",
        rawCount: 1,
        entityCounts: {
          events: 1,
          items: 1,
        },
      });
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(rootDir);
      expect(serialized).not.toContain("private-feature");
      expect(serialized).not.toContain("private-workspace-id");
    },
    65_000,
  );

  itOrSkip(
    "collects HBuilderX INI activity without exposing local paths",
    () => {
      const rootDir = path.join(
        sandboxAppData,
        "hbuilderx-fixture",
        "HBuilder X",
      );
      buildHBuilderXCliFixture(rootDir);
      const result = runCli([
        "hub",
        "sync-adapter",
        "hbuilderx",
        "--hbuilderx-home",
        rootDir,
        "--source-timezone",
        "+08:00",
        "--json",
      ]);
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `HBuilderX sync did not emit JSON (code=${result.code})\nstdout: ${result.stdout.slice(0, 400)}\nstderr: ${result.stderr.slice(0, 400)}`,
        );
      }
      expect(
        result.code,
        JSON.stringify({ report, stderr: result.stderr.slice(0, 1000) }),
      ).toBe(0);
      expect(report).toMatchObject({
        adapter: "hbuilderx",
        status: "ok",
        rawCount: 1,
        entityCounts: {
          events: 1,
        },
      });
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(rootDir);
      expect(serialized).not.toContain("hbuilderx-project");
      expect(serialized).not.toContain("secret.vue");
    },
    65_000,
  );

  itOrSkip(
    "win-recent sync against an empty Recent dir returns ok with 0 events",
    () => {
      // win-recent will fall through authenticate() PLATFORM_UNSUPPORTED on
      // Linux CI. To make this assertion stable across both Win and Linux
      // CI runners, we touch a sandbox Recent dir and point the adapter at
      // it via env var — but the adapter doesn't read env, only opts. So
      // this test simply validates the CLI gateway can invoke and surface
      // either an "ok empty" report (Win) or an "unhealthy" report (Linux
      // where the default dir doesn't exist). Both prove the gateway works.
      const r = runCli(["hub", "sync-adapter", "win-recent", "--json"]);
      // The CLI exits 0 for both ok and adapter-reported-error reports; it
      // exits non-zero only for hard exceptions. We accept either.
      let parsed;
      try {
        parsed = JSON.parse(r.stdout);
      } catch {
        throw new Error(
          `sync-adapter did not emit JSON (code=${r.code})\nstdout: ${r.stdout.slice(0, 400)}\nstderr: ${r.stderr.slice(0, 400)}`,
        );
      }
      expect(parsed).toBeDefined();
      // status is one of: ok / auth_expired / unhealthy / error
      expect(["ok", "auth_expired", "unhealthy", "error"]).toContain(
        parsed.status,
      );
      expect(typeof parsed.rawCount).toBe("number");
      expect(parsed.entityCounts).toBeDefined();
      // Per-test timeout > runCli's 60s spawn budget (trap #31) — see the
      // list-adapters test above for the rationale.
    },
    65_000,
  );
});
