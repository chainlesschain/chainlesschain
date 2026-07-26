"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DouyinAdapter, VERSION } = require("../../lib/adapters/social-douyin");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/social-douyin/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

async function collect(iterable) {
  const raws = [];
  for await (const raw of iterable) raws.push(raw);
  return raws;
}

let tmpDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

function ensureTmpDir() {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-douyin-cursor-"));
  }
  return tmpDir;
}

function snapshotEvents() {
  return [
    {
      kind: "profile",
      id: "profile-1",
      capturedAt: 1_700_000_000_000,
      secUid: "sec-1",
      nickname: "reader",
    },
    {
      kind: "history",
      id: "history-1",
      capturedAt: 1_700_000_100_000,
      awemeId: "aweme-1",
      title: "history",
    },
    {
      kind: "favourite",
      id: "favourite-1",
      capturedAt: 1_700_000_200_000,
      awemeId: "aweme-2",
      title: "favourite",
    },
  ];
}

function writeSnapshot(events = snapshotEvents()) {
  const inputPath = path.join(ensureTmpDir(), "social-douyin.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_300_000,
      account: { uid: "account-1", secUid: "sec-1" },
      events,
    }),
    "utf8",
  );
  return inputPath;
}

function writeDb(fileName) {
  const dbPath = path.join(ensureTmpDir(), fileName);
  fs.writeFileSync(dbPath, Buffer.from("SQLite format 3\0fixture", "utf8"));
  return dbPath;
}

function createVault() {
  vault = new LocalVault({
    path: path.join(ensureTmpDir(), "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
  return vault;
}

function contentDriver({
  histories = [],
  favourites = [],
  searches = [],
  queries = [],
}) {
  return () =>
    class FakeDb {
      prepare(sql) {
        queries.push(sql);
        return {
          all() {
            if (sql.includes("FROM sqlite_master")) {
              return [
                { name: "video_history" },
                { name: "user_favorite" },
                { name: "search_history" },
              ];
            }
            if (sql.includes("FROM video_history")) return histories;
            if (sql.includes("FROM user_favorite")) return favourites;
            if (sql.includes("FROM search_history")) return searches;
            throw new Error("no such table");
          },
        };
      }

      close() {}
    };
}

function imDriver({
  messages = [],
  contacts = [],
  conversations = [],
  queries = [],
}) {
  return () =>
    class FakeDb {
      prepare(sql) {
        queries.push(sql);
        return {
          all() {
            if (sql.includes("FROM sqlite_master")) {
              return [
                { name: "msg" },
                { name: "SIMPLE_USER" },
                { name: "conversation_list" },
              ];
            }
            if (sql === "PRAGMA table_info(msg)") {
              return [
                { name: "sender" },
                { name: "created_time" },
                { name: "content" },
                { name: "conversation_id" },
                { name: "read_status" },
              ];
            }
            if (sql.includes(" FROM msg ")) return messages;
            if (sql === "PRAGMA table_info(SIMPLE_USER)") {
              return [{ name: "UID" }, { name: "name" }];
            }
            if (sql.includes(" FROM SIMPLE_USER")) return contacts;
            if (sql === "PRAGMA table_info(participant)") return [];
            if (sql === "PRAGMA table_info(conversation_list)") {
              return [
                { name: "conversation_id" },
                { name: "last_msg_create_time" },
              ];
            }
            if (sql.includes(" FROM conversation_list")) {
              return conversations;
            }
            throw new Error(`unexpected SQL: ${sql}`);
          },
        };
      }

      close() {}
    };
}

function createContentAdapter(dbPath, collections = {}) {
  return new DouyinAdapter({
    account: { uid: "account-1" },
    dbPath,
    dbDriverFactory: contentDriver(collections),
  });
}

function createImAdapter(collections = {}) {
  return new DouyinAdapter({
    dbDriverFactory: imDriver(collections),
  });
}

describe("Douyin explicit collection cursor", () => {
  it("declares the resumable v0.7 contract and recognizes IM input", async () => {
    const imDbPath = writeDb("account_im.db");
    const adapter = createImAdapter();
    expect(VERSION).toBe("0.7.0");
    expect(adapter.version).toBe("0.7.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
    expect(await adapter.authenticate({ inputPath: imDbPath })).toEqual({
      ok: true,
      mode: "im-sqlite-file",
    });
  });

  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    const adapter = new DouyinAdapter();
    const registry = new AdapterRegistry({ vault: createVault() });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:social-douyin:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("resumes one legacy content SQLite collection", async () => {
    const dbPath = writeDb("content.db");
    const adapter = createContentAdapter(dbPath, {
      histories: [{ id: 1, aweme_id: "a1", title: "one", view_time: 3 }],
      favourites: [{ id: 2, aweme_id: "a2", title: "two", create_time: 2 }],
      searches: [{ id: 3, keyword: "three", time: 1 }],
    });
    const registry = new AdapterRegistry({ vault: createVault() });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { dbPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[0].watermark).cursor.mode).toBe("sqlite");
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("resumes one direct IM SQLite collection", async () => {
    const imDbPath = writeDb("account_im.db");
    const adapter = createImAdapter({
      messages: [
        {
          sender: "1",
          createdTime: 3,
          content: '{"text":"hello"}',
          conversationId: "conversation-1",
          readStatus: 1,
        },
      ],
      contacts: [{ uid: "2", name: "friend" }],
      conversations: [{ convId: "conversation-1", lastMsgTime: 2 }],
    });
    const registry = new AdapterRegistry({ vault: createVault() });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, {
          imDbPath,
          limit: 1,
        }),
      );
    }

    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:social-douyin:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("removes the legacy content SQLite 5000-row truncation", async () => {
    const dbPath = writeDb("content.db");
    const queries = [];
    const histories = Array.from({ length: 5001 }, (_, index) => ({
      id: index + 1,
      aweme_id: `aweme-${index + 1}`,
      title: `history-${index + 1}`,
      view_time: 1_700_000_000 + index,
    }));
    const adapter = createContentAdapter(dbPath, { histories, queries });

    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5001);
    expect(raws[0].originalId).toBe("history-5001");
    expect(queries.some((sql) => /LIMIT\s+5000/iu.test(sql))).toBe(false);
  });

  it("removes all default IM parser caps", async () => {
    const imDbPath = writeDb("account_im.db");
    const queries = [];
    const messages = Array.from({ length: 10001 }, (_, index) => ({
      sender: String(index + 1),
      createdTime: 1_700_000_000_000 + index,
      content: `{"text":"message-${index + 1}"}`,
      conversationId: `conversation-${index + 1}`,
      readStatus: 1,
    }));
    const contacts = Array.from({ length: 5001 }, (_, index) => ({
      uid: String(index + 1),
      name: `contact-${index + 1}`,
    }));
    const conversations = Array.from({ length: 5001 }, (_, index) => ({
      convId: `conversation-${index + 1}`,
      lastMsgTime: 1_700_000_000_000 + index,
    }));
    const adapter = createImAdapter({
      contacts,
      conversations,
      messages,
      queries,
    });

    const raws = await collect(adapter.sync({ imDbPath }));

    expect(raws).toHaveLength(20003);
    expect(queries.some((sql) => /LIMIT\s+(?:5000|10000)/iu.test(sql))).toBe(
      false,
    );
  });

  it("rejects snapshot changes while a frozen collection is active", async () => {
    const inputPath = writeSnapshot();
    const adapter = new DouyinAdapter();
    let watermark;
    await collect(
      adapter.sync({
        inputPath,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    writeSnapshot([
      snapshotEvents()[0],
      snapshotEvents()[1],
      { ...snapshotEvents()[2], id: "favourite-9", awemeId: "aweme-9" },
    ]);
    await expect(
      collect(adapter.sync({ inputPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "DOUYIN_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("rejects legacy content row changes during an active scan", async () => {
    const dbPath = writeDb("content.db");
    const histories = [
      { id: 1, aweme_id: "a1", title: "one", view_time: 2 },
      { id: 2, aweme_id: "a2", title: "two", view_time: 1 },
    ];
    const adapter = createContentAdapter(dbPath, { histories });
    let watermark;
    await collect(
      adapter.sync({
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    histories[1].title = "changed while resuming";
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "DOUYIN_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("rejects parsed IM changes during an active scan", async () => {
    const imDbPath = writeDb("account_im.db");
    const messages = [
      {
        sender: "1",
        createdTime: 2,
        content: '{"text":"one"}',
        conversationId: "conversation-1",
      },
      {
        sender: "2",
        createdTime: 1,
        content: '{"text":"two"}',
        conversationId: "conversation-2",
      },
    ];
    const adapter = createImAdapter({ messages });
    let watermark;
    await collect(
      adapter.sync({
        imDbPath,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    messages[1].content = '{"text":"changed while resuming"}';
    await expect(
      collect(adapter.sync({ imDbPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "DOUYIN_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("freezes explicit IM parser limits in the cursor", async () => {
    const imDbPath = writeDb("account_im.db");
    const messages = [
      {
        sender: "1",
        createdTime: 2,
        content: '{"text":"one"}',
        conversationId: "conversation-1",
      },
      {
        sender: "2",
        createdTime: 1,
        content: '{"text":"two"}',
        conversationId: "conversation-2",
      },
    ];
    const adapter = createImAdapter({ messages });
    let watermark;
    await collect(
      adapter.sync({
        imDbPath,
        limit: 1,
        limitMessages: 2,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    await expect(
      collect(
        adapter.sync({
          imDbPath,
          limitMessages: 1,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "DOUYIN_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });
  });
});

describe("Douyin cursor validation", () => {
  it("migrates legacy counts and accepts both local modes", () => {
    expect(parseCursor("3")).toMatchObject({
      kind: "legacy-reset",
      cursor: {
        v: 1,
        mode: null,
        source: null,
        config: null,
        after: null,
        upper: null,
      },
    });
    for (const mode of ["snapshot", "sqlite"]) {
      expect(
        serializeCursor({
          v: 1,
          mode,
          source: "a".repeat(64),
          config: "b".repeat(64),
          after: 1,
          upper: 2,
        }),
      ).toMatch(/^social-douyin:v1:/u);
    }
    expect(() => parseCursor("social-douyin:v2:{}")).toThrowError(
      expect.objectContaining({ code: "DOUYIN_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        mode: "sqlite",
        source: "a".repeat(64),
        config: "b".repeat(64),
        after: 2,
        upper: 2,
      }),
    ).toThrowError(expect.objectContaining({ code: "DOUYIN_CURSOR_INVALID" }));
  });
});
