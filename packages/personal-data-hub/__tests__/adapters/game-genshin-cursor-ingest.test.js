"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { GenshinAdapter } = require("../../lib");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/game-genshin/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const COOKIE = "account_id_v2=809199; cookie_token_v2=abc";
const ACCOUNT_ID = "809199";

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

function snapshotEvents() {
  return [
    {
      kind: "profile",
      id: "profile-1",
      uid: "800000001",
      nickname: "first",
      level: 10,
    },
    {
      kind: "play",
      id: "play-1",
      durationMs: 60_000,
      startAt: 1_700_000_000_000,
    },
    {
      kind: "profile",
      id: "profile-2",
      uid: "800000002",
      nickname: "second",
      level: 20,
    },
  ];
}

function writeSnapshot(events = snapshotEvents()) {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-genshin-cursor-"));
  }
  const inputPath = path.join(tmpDir, "genshin.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_000_000,
      account: { uid: ACCOUNT_ID, displayName: "traveler" },
      events,
    }),
    "utf8",
  );
  return inputPath;
}

function liveProfile(uid) {
  return {
    uid,
    nickname: `traveler-${uid}`,
    level: 50,
    region: "cn_gf01",
    regionName: "server",
    activeDayNumber: 100,
  };
}

describe("Genshin explicit cursor", () => {
  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new GenshinAdapter();
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
    expect(reports[0].scope).toMatch(/^account:game-genshin:[0-9a-f]{32}$/u);
    expect(reports[0].scope).not.toContain(ACCOUNT_ID);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor).toEqual({
      v: 1,
      mode: null,
      source: null,
      filter: null,
      after: null,
      upper: null,
    });
  });

  it("publishes the exact next snapshot event before each bounded yield", async () => {
    const inputPath = writeSnapshot();
    const adapter = new GenshinAdapter();
    let watermark;

    const first = await collect(
      adapter.sync({
        inputPath,
        limit: 2,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(first.map((raw) => raw.originalId)).toEqual([
      "genshin:profile:profile-1",
      "genshin:play:play-1",
    ]);
    expect(parseCursor(watermark).cursor).toMatchObject({
      mode: "snapshot",
      filter: "profile+play",
      after: 2,
      upper: 3,
    });

    const second = await collect(
      adapter.sync({
        inputPath,
        limit: 2,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(second.map((raw) => raw.originalId)).toEqual([
      "genshin:profile:profile-2",
    ]);
    expect(parseCursor(watermark).cursor.upper).toBeNull();
  });

  it("fails closed if the snapshot bytes or active include filter changes", async () => {
    const inputPath = writeSnapshot();
    const adapter = new GenshinAdapter();
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

    await expect(
      collect(
        adapter.sync({
          inputPath,
          include: { play: false },
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "GAME_GENSHIN_CURSOR_FILTER_CHANGED",
      retryable: false,
    });

    writeSnapshot([...snapshotEvents(), { kind: "play", id: "play-2" }]);
    await expect(
      collect(adapter.sync({ inputPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "GAME_GENSHIN_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("freezes the complete live role set and resumes without API truncation", async () => {
    const calls = [];
    const profiles = [
      liveProfile("800000001"),
      liveProfile("800000002"),
      liveProfile("800000003"),
    ];
    const adapter = new GenshinAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchProfiles(cookie, options) {
          calls.push({ cookie, options });
          return profiles;
        },
      }),
    });
    adapter.rateLimits = {};
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-genshin-live-"));
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

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.cookie).toBe(COOKIE);
      expect(call.options).toEqual({ fetchStats: true });
      expect(call.options).not.toHaveProperty("limit");
    }
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("fails closed if the live role set or fetch configuration changes", async () => {
    let profiles = [liveProfile("800000001"), liveProfile("800000002")];
    const adapter = new GenshinAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchProfiles() {
          return profiles;
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
          fetchStats: false,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "GAME_GENSHIN_CURSOR_FILTER_CHANGED",
      retryable: false,
    });

    profiles = [liveProfile("800000001"), liveProfile("800000003")];
    await expect(
      collect(
        adapter.sync({
          cookie: COOKIE,
          accountId: ACCOUNT_ID,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "GAME_GENSHIN_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Genshin cursor validation", () => {
  it("migrates legacy counts and rejects unsupported or completed cursors", () => {
    expect(parseCursor("3")).toMatchObject({
      kind: "legacy-reset",
      cursor: {
        v: 1,
        mode: null,
        source: null,
        filter: null,
        after: null,
        upper: null,
      },
    });
    expect(() => parseCursor("game-genshin:v2:{}")).toThrowError(
      expect.objectContaining({ code: "GAME_GENSHIN_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        mode: "snapshot",
        source: "a".repeat(64),
        filter: "profile+play",
        after: 3,
        upper: 3,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "GAME_GENSHIN_CURSOR_INVALID" }),
    );
  });
});
