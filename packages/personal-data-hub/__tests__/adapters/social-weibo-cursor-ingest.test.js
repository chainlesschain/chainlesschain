"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { VERSION, WeiboAdapter } = require("../../lib/adapters/social-weibo");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/social-weibo/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const SELF_UID = "2075014533";

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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-weibo-cursor-"));
  }
  return tmpDir;
}

function snapshotEvents() {
  return [
    {
      kind: "post",
      id: "post-1",
      capturedAt: 1_700_000_000_000,
      mid: "post-1",
      text: "post",
    },
    {
      kind: "favourite",
      id: "favourite-1",
      capturedAt: 1_700_000_100_000,
      mid: "favourite-1",
      text: "favourite",
    },
    {
      kind: "follow",
      id: "follow-1",
      capturedAt: 1_700_000_200_000,
      uid: "follow-1",
      screenName: "friend",
    },
  ];
}

function writeSnapshot(events = snapshotEvents()) {
  const inputPath = path.join(ensureTmpDir(), "social-weibo.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_300_000,
      account: { uid: SELF_UID, displayName: "reader" },
      events,
    }),
    "utf8",
  );
  return inputPath;
}

function writeDatabases() {
  const dbPath = path.join(ensureTmpDir(), "sina_weibo");
  const messageDbPath = path.join(ensureTmpDir(), `message_${SELF_UID}.db`);
  fs.writeFileSync(dbPath, "main-sqlite-fixture", "utf8");
  fs.writeFileSync(messageDbPath, "message-sqlite-fixture", "utf8");
  return { dbPath, messageDbPath };
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

function sqliteDriver({ tables = {}, queries = [] }) {
  return function dbDriverFactory() {
    return class FakeDb {
      prepare(sql) {
        queries.push(sql);
        return {
          all() {
            for (const [tableName, rows] of Object.entries(tables)) {
              if (new RegExp(`FROM ${tableName}\\b`, "u").test(sql)) {
                return rows;
              }
            }
            throw new Error("no such table");
          },
        };
      }

      close() {}
    };
  };
}

function createSqliteAdapter(dbPath, tables, queries = []) {
  return new WeiboAdapter({
    account: { uid: SELF_UID },
    dbPath,
    dbDriverFactory: sqliteDriver({ tables, queries }),
  });
}

describe("Weibo explicit collection cursor", () => {
  it("declares the resumable v0.9 contract", () => {
    const adapter = new WeiboAdapter();
    expect(VERSION).toBe("0.9.0");
    expect(adapter.version).toBe("0.9.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
  });

  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    const adapter = new WeiboAdapter();
    const registry = new AdapterRegistry({ vault: createVault() });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:social-weibo:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("resumes one combined main and private-message SQLite collection", async () => {
    const { dbPath } = writeDatabases();
    const adapter = createSqliteAdapter(dbPath, {
      home_table: [{ mblogid: "post-1", content: "post", time: 1_700_000_002 }],
      t_buddy: [{ uid: "buddy-1", nick: "friend" }],
      t_message: [
        {
          global_id: "message-1",
          time: 1_700_000_001,
          outgoing: 1,
          content_type: 1,
          content: "hello",
        },
      ],
    });
    const registry = new AdapterRegistry({ vault: createVault() });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, {
          dbPath,
          includeDm: true,
          limit: 1,
        }),
      );
    }

    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:social-weibo:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[0].watermark).cursor.mode).toBe("sqlite");
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("removes both main and private-message legacy row caps", async () => {
    const { dbPath } = writeDatabases();
    const queries = [];
    const posts = Array.from({ length: 5001 }, (_, index) => ({
      mblogid: `post-${index + 1}`,
      content: `post-${index + 1}`,
      time: 1_700_000_000 + index,
    }));
    const messages = Array.from({ length: 10001 }, (_, index) => ({
      global_id: `message-${index + 1}`,
      time: 1_700_000_000 + index,
      outgoing: 1,
      content_type: 1,
      content: `message-${index + 1}`,
    }));
    const adapter = createSqliteAdapter(
      dbPath,
      { home_table: posts, t_message: messages },
      queries,
    );

    const raws = await collect(adapter.sync({ includeDm: true }));

    expect(raws).toHaveLength(15002);
    expect(raws[0].originalId).toBe("post-post-5001");
    expect(queries.some((sql) => /LIMIT\s+(?:5000|10000)/iu.test(sql))).toBe(
      false,
    );
  });

  it("rejects snapshot changes while a frozen collection is active", async () => {
    const inputPath = writeSnapshot();
    const adapter = new WeiboAdapter();
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
      { ...snapshotEvents()[2], id: "follow-9", uid: "follow-9" },
    ]);
    await expect(
      collect(adapter.sync({ inputPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "WEIBO_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("rejects main SQLite row changes during an active scan", async () => {
    const { dbPath } = writeDatabases();
    const posts = [
      { mblogid: "post-1", content: "one", time: 2 },
      { mblogid: "post-2", content: "two", time: 1 },
    ];
    const adapter = createSqliteAdapter(dbPath, { home_table: posts });
    let watermark;
    await collect(
      adapter.sync({
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    posts[1].content = "changed while resuming";
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "WEIBO_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("freezes the private-message file identity", async () => {
    const { dbPath, messageDbPath } = writeDatabases();
    const messages = [
      { global_id: "message-1", time: 2, content_type: 1, content: "one" },
      { global_id: "message-2", time: 1, content_type: 1, content: "two" },
    ];
    const adapter = createSqliteAdapter(dbPath, { t_message: messages });
    let watermark;
    await collect(
      adapter.sync({
        includeDm: true,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    fs.appendFileSync(messageDbPath, "-changed", "utf8");
    await expect(
      collect(
        adapter.sync({
          includeDm: true,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "WEIBO_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("fails closed if includeDm changes during an active scan", async () => {
    const { dbPath } = writeDatabases();
    const adapter = createSqliteAdapter(dbPath, {
      home_table: [
        { mblogid: "post-1", content: "one", time: 2 },
        { mblogid: "post-2", content: "two", time: 1 },
      ],
      t_buddy: [{ uid: "buddy-1", nick: "friend" }],
    });
    let watermark;
    await collect(
      adapter.sync({
        includeDm: true,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    await expect(
      collect(
        adapter.sync({
          includeDm: false,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "WEIBO_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });
  });
});

describe("Weibo cursor validation", () => {
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
      ).toMatch(/^social-weibo:v1:/u);
    }
    expect(() => parseCursor("social-weibo:v2:{}")).toThrowError(
      expect.objectContaining({ code: "WEIBO_CURSOR_UNSUPPORTED" }),
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
    ).toThrowError(expect.objectContaining({ code: "WEIBO_CURSOR_INVALID" }));
  });
});
