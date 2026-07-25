"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { NeteaseMusicAdapter } = require("../../lib/adapters/netease-music");
const {
  NeteaseMusicApiClient,
} = require("../../lib/adapters/netease-music/api-client");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/netease-music/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const COOKIE = "MUSIC_U=abcdef0123456789";
const ACCOUNT_ID = "42";

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

function events() {
  return [
    {
      kind: "play",
      id: "play-1",
      songId: "1",
      song: "one",
      artist: "artist",
      playCount: 3,
    },
    {
      kind: "favorite",
      id: "favorite-2",
      songId: "2",
      song: "two",
      artist: "artist",
    },
    {
      kind: "playlist",
      id: "playlist-3",
      playlistId: "3",
      name: "three",
      trackCount: 4,
    },
  ];
}

function writeSnapshot(sourceEvents = events()) {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-netease-cursor-"));
  }
  const inputPath = path.join(tmpDir, "netease.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_000_000,
      account: { uid: ACCOUNT_ID, nickname: "listener" },
      events: sourceEvents,
    }),
    "utf8",
  );
  return inputPath;
}

function liveEvents() {
  return [
    {
      kind: "play",
      id: "play-1",
      songId: "1",
      song: "one",
      artist: "artist",
      playCount: 3,
    },
    {
      kind: "play",
      id: "play-2",
      songId: "2",
      song: "two",
      artist: "artist",
      playCount: 2,
    },
    {
      kind: "playlist",
      id: "playlist-3",
      playlistId: "3",
      name: "three",
      trackCount: 4,
    },
  ];
}

describe("NetEase Music explicit cursor", () => {
  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new NeteaseMusicAdapter();
    adapter.rateLimits = {};
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:netease-music:[0-9a-f]{32}$/u);
    expect(reports[0].scope).not.toContain(`:${ACCOUNT_ID}`);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor).toEqual({
      v: 1,
      mode: null,
      source: null,
      config: null,
      after: null,
      upper: null,
    });
  });

  it("paginates every playlist beyond the former default 100-item cap", async () => {
    let playlistPage = 0;
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      let body;
      if (url.includes("account/get")) {
        body = { code: 200, profile: { userId: 42, nickname: "listener" } };
      } else if (url.includes("user/playlist")) {
        playlistPage += 1;
        body =
          playlistPage === 1
            ? {
                code: 200,
                more: true,
                playlist: Array.from({ length: 100 }, (_, index) => ({
                  id: index + 1,
                  name: `list-${index + 1}`,
                })),
              }
            : {
                code: 200,
                more: false,
                playlist: [{ id: 101, name: "list-101" }],
              };
      } else {
        body = { code: 404, message: "unexpected endpoint" };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      };
    };
    const client = new NeteaseMusicApiClient({
      fetch,
      secKey: "0123456789abcdef",
    });

    const result = await client.fetchSnapshot(COOKIE, {
      include: { play: false },
    });

    expect(result.events).toHaveLength(101);
    expect(result.events.at(-1).playlistId).toBe("101");
    expect(calls.filter((url) => url.includes("user/playlist"))).toHaveLength(
      2,
    );
  });

  it("freezes the complete live collection and resumes without truncation", async () => {
    const calls = [];
    const resultEvents = liveEvents();
    const adapter = new NeteaseMusicAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchSnapshot(cookie, options) {
          calls.push({ cookie, options });
          return {
            account: { uid: ACCOUNT_ID, nickname: "listener" },
            events: resultEvents,
          };
        },
      }),
    });
    adapter.rateLimits = {};
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-netease-live-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, {
          cookie: COOKIE,
          accountId: ACCOUNT_ID,
          limit: 1,
        }),
      );
    }

    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.cookie).toBe(COOKIE);
      expect(call.options).not.toHaveProperty("limit");
    }
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("fails closed if the live collection or fetch configuration changes", async () => {
    let resultEvents = liveEvents();
    const adapter = new NeteaseMusicAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchSnapshot() {
          return {
            account: { uid: ACCOUNT_ID, nickname: "listener" },
            events: resultEvents,
          };
        },
      }),
    });
    let watermark;
    await collect(
      adapter.sync({
        cookie: COOKIE,
        accountId: ACCOUNT_ID,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    await expect(
      collect(
        adapter.sync({
          cookie: COOKIE,
          accountId: ACCOUNT_ID,
          recordType: 0,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "NETEASE_MUSIC_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });

    resultEvents = [
      liveEvents()[0],
      { ...liveEvents()[1], id: "play-9", songId: "9" },
      liveEvents()[2],
    ];
    await expect(
      collect(
        adapter.sync({
          cookie: COOKIE,
          accountId: ACCOUNT_ID,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "NETEASE_MUSIC_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("NetEase Music cursor validation", () => {
  it("migrates legacy counts and rejects unsupported or completed cursors", () => {
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
    expect(() => parseCursor("netease-music:v2:{}")).toThrowError(
      expect.objectContaining({ code: "NETEASE_MUSIC_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        mode: "snapshot",
        source: "a".repeat(64),
        config: "b".repeat(64),
        after: 3,
        upper: 3,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "NETEASE_MUSIC_CURSOR_INVALID" }),
    );
  });
});
