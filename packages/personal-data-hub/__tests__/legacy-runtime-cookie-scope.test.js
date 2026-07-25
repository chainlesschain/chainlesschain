"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  HuaweiLearningAdapter,
} = require("../lib/adapters/edu-huawei-learning");
const { ZuoyebangAdapter } = require("../lib/adapters/edu-zuoyebang");
const { AlipayAdapter } = require("../lib/adapters/finance-alipay");
const { GenshinAdapter } = require("../lib/adapters/game-genshin");
const { NeteaseMusicAdapter } = require("../lib/adapters/netease-music");
const { WeReadAdapter } = require("../lib/adapters/weread");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

async function collect(iterable) {
  const records = [];
  for await (const record of iterable) records.push(record);
  return records;
}

async function request(options, operation) {
  return options.fetch(`https://collector.test/${operation}`, {
    headers: { Cookie: options.cookie },
  });
}

const CASES = [
  {
    name: "game-genshin",
    identityKey: "uid",
    cookie: (suffix) =>
      `account_id_v2=${suffix === "a" ? "10001" : "10002"}; token=genshin-secret-${suffix}`,
    requestCount: 2,
    create: (configuredCookie, configuredFetch) =>
      new GenshinAdapter({
        cookie: configuredCookie,
        fetch: configuredFetch,
        apiClientFactory: (options) => ({
          lastError: { code: 0, message: "" },
          async fetchProfiles() {
            await request(options, "roles");
            await request(options, "stats");
            return [
              {
                uid: "800000001",
                nickname: "旅行者",
                level: 60,
                region: "cn_gf01",
                activeDayNumber: 10,
              },
            ];
          },
        }),
      }),
  },
  {
    name: "edu-zuoyebang",
    identityKey: "uid",
    cookie: (suffix) => `ZYBUSS=zuoyebang-secret-${suffix}`,
    requestCount: 2,
    create: (configuredCookie, configuredFetch) =>
      new ZuoyebangAdapter({
        cookie: configuredCookie,
        fetch: configuredFetch,
        apiClientFactory: (options) => ({
          lastError: { code: 0, message: "" },
          async fetchSnapshot() {
            await request(options, "profile");
            await request(options, "study");
            return {
              account: { uid: "remote-student", displayName: "学生" },
              events: [
                {
                  kind: "profile",
                  id: "profile-remote-student",
                  uid: "remote-student",
                  nickname: "学生",
                },
              ],
            };
          },
        }),
      }),
  },
  {
    name: "finance-alipay",
    identityKey: "userId",
    cookie: (suffix) =>
      `ALIPAYJSESSIONID=alipay-secret-${suffix}; userId=20880001`,
    requestCount: 1,
    create: (configuredCookie, configuredFetch) =>
      new AlipayAdapter({
        cookie: configuredCookie,
        fetch: configuredFetch,
        apiClientFactory: (options) => ({
          lastError: { code: 0, message: "" },
          async fetchSnapshot() {
            await request(options, "bills");
            return {
              account: { uid: "20880001", displayName: "支付宝用户" },
              events: [
                {
                  kind: "profile",
                  id: "profile-20880001",
                  uid: "20880001",
                  nickname: "支付宝用户",
                },
              ],
            };
          },
        }),
      }),
  },
  {
    name: "edu-huawei-learning",
    identityKey: "uid",
    cookie: (suffix) => `CASTGC=huawei-secret-${suffix}`,
    requestCount: 2,
    create: (configuredCookie, configuredFetch) =>
      new HuaweiLearningAdapter({
        cookie: configuredCookie,
        fetch: configuredFetch,
        apiClientFactory: (options) => ({
          lastError: { code: 0, message: "" },
          async fetchSnapshot() {
            await request(options, "profile");
            await request(options, "study");
            return {
              account: { uid: "remote-learner", displayName: "学习者" },
              events: [
                {
                  kind: "profile",
                  id: "profile-remote-learner",
                  uid: "remote-learner",
                  nickname: "学习者",
                },
              ],
            };
          },
        }),
      }),
  },
  {
    name: "netease-music",
    identityKey: "userId",
    cookie: (suffix) => `MUSIC_U=netease-secret-${suffix}`,
    requestCount: 3,
    supportsConfiguredCookie: true,
    create: (configuredCookie, configuredFetch) =>
      new NeteaseMusicAdapter({
        cookie: configuredCookie,
        fetch: configuredFetch,
        apiClientFactory: (options) => ({
          lastError: { code: 0, message: "" },
          async fetchSnapshot() {
            await request(options, "account");
            await request(options, "plays");
            await request(options, "playlists");
            return {
              account: { uid: "remote-listener", nickname: "听众" },
              events: [
                {
                  kind: "playlist",
                  id: "playlist-shared",
                  playlistId: "shared",
                  name: "收藏",
                },
              ],
            };
          },
        }),
      }),
  },
  {
    name: "weread",
    identityKey: "vid",
    rateLimits: { perMinute: 30, perDay: 1200 },
    cookie: (suffix) => `wr_skey=weread-secret-${suffix}`,
    requestCount: 3,
    supportsConfiguredCookie: true,
    create: (configuredCookie, configuredFetch) =>
      new WeReadAdapter({
        cookie: configuredCookie,
        fetch: configuredFetch,
        apiClientFactory: (options) => ({
          async getNotebooks() {
            await request(options, "notebooks");
            return [{ bookId: "book-shared", title: "测试书", author: "作者" }];
          },
          async getBookmarks() {
            await request(options, "bookmarks");
            return [];
          },
          async getReviews() {
            await request(options, "reviews");
            return [];
          },
        }),
      }),
  },
];

const CONFIGURED_SCOPE_CASES = [
  {
    name: "game-genshin",
    identity: "genshin-constructor-account",
    create: (identity) =>
      new GenshinAdapter({
        cookie: "account_id_v2=10001; token=configured",
        account: { uid: identity },
      }),
  },
  {
    name: "edu-zuoyebang",
    identity: "zuoyebang-constructor-account",
    create: (identity) =>
      new ZuoyebangAdapter({
        cookie: "ZYBUSS=configured",
        account: { uid: identity },
      }),
  },
  {
    name: "finance-alipay",
    identity: "alipay-constructor-account",
    create: (identity) =>
      new AlipayAdapter({
        cookie: "ALIPAYJSESSIONID=configured",
        account: { userId: identity },
      }),
  },
  {
    name: "edu-huawei-learning",
    identity: "huawei-constructor-account",
    create: (identity) =>
      new HuaweiLearningAdapter({
        cookie: "CASTGC=configured",
        account: { uid: identity },
      }),
  },
  {
    name: "netease-music",
    identity: "netease-constructor-account",
    create: (identity) =>
      new NeteaseMusicAdapter({
        cookie: "MUSIC_U=configured",
        userId: identity,
      }),
  },
  {
    name: "weread",
    identity: "weread-constructor-account",
    create: (identity) =>
      new WeReadAdapter({
        cookie: "wr_skey=configured",
        vid: identity,
      }),
  },
];

describe.each(CONFIGURED_SCOPE_CASES)(
  "$name configured account scope",
  (testCase) => {
    it("hashes an optional constructor identity without exposing it", () => {
      const adapter = testCase.create(testCase.identity);

      expect(adapter.defaultScope).toMatch(
        new RegExp(`^account:${testCase.name}:[a-f0-9]{32}$`, "u"),
      );
      expect(adapter.defaultScope).not.toContain(testCase.identity);
    });
  },
);

describe.each(CASES)("$name transient cookie scope", (testCase) => {
  it("declares persistent request quotas", () => {
    expect(testCase.create().rateLimits).toEqual(
      testCase.rateLimits || { perMinute: 8, perDay: 200 },
    );
  });

  it("requires an account id in authenticate, healthCheck, and sync", async () => {
    const adapter = testCase.create();
    const options = {
      cookie: testCase.cookie("a"),
      fetch: async () => ({}),
    };

    await expect(adapter.authenticate(options)).resolves.toMatchObject({
      ok: false,
      reason: "NO_ACCOUNT_ID",
    });
    await expect(adapter.healthCheck(options)).resolves.toMatchObject({
      ok: false,
      reason: "NO_ACCOUNT_ID",
    });
    await expect(collect(adapter.sync(options))).rejects.toThrow(
      /opts\.accountId required/u,
    );
  });

  it("keeps the constructor transport authoritative during runtime-cookie sync", async () => {
    let configuredFetchCalls = 0;
    let runtimeFetchCalls = 0;
    const adapter = testCase.create(undefined, async () => {
      configuredFetchCalls += 1;
      return {};
    });

    const records = await collect(
      adapter.sync({
        cookie: testCase.cookie("a"),
        accountId: `Runtime-${testCase.name}-a`,
        fetch: async () => {
          runtimeFetchCalls += 1;
          throw new Error(
            "runtime fetch must not replace configured transport",
          );
        },
      }),
    );

    expect(records).toHaveLength(1);
    expect(configuredFetchCalls).toBe(testCase.requestCount);
    expect(runtimeFetchCalls).toBe(0);
  });

  it("uses hashed per-account scopes, audits every fetch, and keeps runtime secrets ephemeral", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `pdh-${testCase.name}-legacy-cookie-`),
    );
    const vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    try {
      const fetchCalls = [];
      const signal = new AbortController().signal;
      const fetch = async (url, init = {}) => {
        fetchCalls.push({
          url,
          cookie: init.headers && init.headers.Cookie,
          signal: init.signal,
        });
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => "{}",
        };
      };
      const adapter = testCase.create(undefined, fetch);
      const registry = new AdapterRegistry({
        vault,
        sleep: async () => {},
      });
      registry.register(adapter);

      const reports = [];
      for (const suffix of ["a", "b"]) {
        reports.push(
          await registry.syncAdapter(testCase.name, {
            cookie: testCase.cookie(suffix),
            accountId: `Runtime-${testCase.name}-${suffix}`,
            fetch,
            signal,
          }),
        );
      }

      for (const report of reports) {
        expect(report.status).toBe("ok");
        expect(report.rawCount).toBe(1);
        expect(report.sourceRequestCount).toBe(testCase.requestCount);
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

      expect(reports[0].scope).not.toBe(reports[1].scope);
      expect(fetchCalls).toHaveLength(testCase.requestCount * 2);
      expect(fetchCalls.every((call) => call.signal === signal)).toBe(true);
      expect(adapter.runtimeScopeIdentityKey).toBe(testCase.identityKey);

      const persisted = JSON.stringify({
        reports,
        raw: vault.queryRawEvents({ adapter: testCase.name }),
        audit: vault.queryAudit({ limit: 100 }),
        adapter,
      }).toLowerCase();
      for (const secret of [
        testCase.cookie("a").toLowerCase(),
        testCase.cookie("b").toLowerCase(),
        `runtime-${testCase.name}-a`,
        `runtime-${testCase.name}-b`,
      ]) {
        expect(persisted).not.toContain(secret);
      }
    } finally {
      vault.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe.each(CASES.filter((testCase) => testCase.supportsConfiguredCookie))(
  "$name configured cookie compatibility",
  (testCase) => {
    it("does not require a runtime account id for a constructor cookie", async () => {
      const cookie = testCase.cookie("configured");
      const adapter = testCase.create(cookie);
      const fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "{}",
      });

      await expect(adapter.authenticate()).resolves.toMatchObject({
        ok: true,
        mode: "cookie",
      });
      await expect(collect(adapter.sync({ fetch }))).resolves.toHaveLength(1);
    });
  },
);
