"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { XimalayaAdapter } = require("../lib/adapters/audio-ximalaya");
const { KugouMusicAdapter } = require("../lib/adapters/music-kugou");
const { QQMusicAdapter } = require("../lib/adapters/music-qq");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

const CASES = [
  {
    name: "audio-ximalaya",
    create: (fetchFn) => new XimalayaAdapter({ fetchFn }),
    include: { favorite: false, subscribe: false },
    response: (suffix) => ({
      list: [
        {
          trackId: `ximalaya-${suffix}`,
          title: `episode-${suffix}`,
          startedAt: Date.now() - 1_000,
        },
      ],
    }),
  },
  {
    name: "music-kugou",
    create: (fetchFn) => new KugouMusicAdapter({ fetchFn }),
    include: { favorite: false, playlist: false },
    response: (suffix) => ({
      list: [
        {
          hash: `kugou-${suffix}`,
          songname: `song-${suffix}`,
          addtime: Math.floor(Date.now() / 1_000) - 1,
        },
      ],
    }),
  },
  {
    name: "music-qq",
    create: (fetchFn) => new QQMusicAdapter({ fetchFn }),
    include: { favorite: false, playlist: false },
    response: (suffix) => ({
      list: [
        {
          songmid: `qqmusic-${suffix}`,
          songname: `song-${suffix}`,
          time: Math.floor(Date.now() / 1_000) - 1,
        },
      ],
    }),
  },
];

async function collect(gen) {
  const out = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe.each(CASES)("$name transient cookie collection", (testCase) => {
  it("declares conservative source-request quotas", () => {
    expect(testCase.create().rateLimits).toEqual({
      perMinute: 30,
      perDay: 500,
    });
  });

  it("isolates registry scopes and never persists runtime credentials", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `pdh-${testCase.name}-runtime-`),
    );
    const vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    try {
      const sourceRequests = [];
      const adapter = testCase.create(async (request) => {
        sourceRequests.push(request);
        const suffix = request.cookies.includes("account-a") ? "a" : "b";
        return testCase.response(suffix);
      });
      const registry = new AdapterRegistry({
        vault,
        sleep: async () => {},
      });
      registry.register(adapter);

      expect(
        await adapter.authenticate({ cookie: "sid=account-a-secret" }),
      ).toMatchObject({
        ok: false,
        reason: "NO_ACCOUNT_ID",
      });
      expect(
        await adapter.healthCheck({ cookie: "sid=account-a-secret" }),
      ).toMatchObject({
        ok: false,
        reason: "NO_ACCOUNT_ID",
      });
      expect(
        await adapter.authenticate({
          cookie: "sid=account-a-secret",
          accountId: "Media-Account-A",
        }),
      ).toEqual({
        ok: true,
        account: "Media-Account-A",
        mode: "cookie",
      });
      expect(
        await adapter.healthCheck({
          cookie: "sid=account-a-secret",
          accountId: "Media-Account-A",
        }),
      ).toMatchObject({ ok: true });
      await expect(
        collect(
          adapter.sync({
            cookie: "sid=account-a-secret",
            include: testCase.include,
            maxPages: 1,
          }),
        ),
      ).rejects.toThrow(/accountId required/);

      const controller = new AbortController();
      const first = await registry.syncAdapter(testCase.name, {
        cookie: "sid=account-a-secret",
        accountId: "Media-Account-A",
        include: testCase.include,
        maxPages: 1,
        signal: controller.signal,
      });
      const second = await registry.syncAdapter(testCase.name, {
        cookie: "sid=account-b-secret",
        accountId: "Media-Account-B",
        include: testCase.include,
        maxPages: 1,
        signal: controller.signal,
      });

      for (const report of [first, second]) {
        expect(report.status).toBe("ok");
        expect(report.rawCount).toBe(1);
        expect(report.sourceRequestCount).toBe(1);
        expect(report.scope).toMatch(
          new RegExp(`^account:${testCase.name}:[a-f0-9]{32}$`, "u"),
        );
        expect(
          vault.queryRawEvents({
            adapter: testCase.name,
            scope: report.scope,
          }),
        ).toHaveLength(1);
      }

      expect(first.scope).not.toBe(second.scope);
      expect(sourceRequests).toHaveLength(2);
      expect(sourceRequests.map((request) => request.cookies)).toEqual([
        "sid=account-a-secret",
        "sid=account-b-secret",
      ]);
      expect(
        sourceRequests.every((request) => request.signal === controller.signal),
      ).toBe(true);
      expect(adapter.account).toBe(null);
      expect(adapter._cookieAuth).toBe(null);
      expect(adapter.runtimeScopeIdentityKey).toBe("userId");

      const persisted = JSON.stringify({
        first,
        second,
        raw: vault.queryRawEvents({ adapter: testCase.name }),
        audit: vault.queryAudit({ limit: 100 }),
      }).toLowerCase();
      for (const secret of [
        "account-a-secret",
        "account-b-secret",
        "media-account-a",
        "media-account-b",
      ]) {
        expect(persisted).not.toContain(secret);
      }
    } finally {
      vault.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
