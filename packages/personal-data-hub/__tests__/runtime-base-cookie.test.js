"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CamScannerDocAdapter } = require("../lib/adapters/doc-camscanner");
const { IqiyiVideoAdapter } = require("../lib/adapters/video-iqiyi");
const { TencentVideoAdapter } = require("../lib/adapters/video-tencent");
const { XiguaVideoAdapter } = require("../lib/adapters/video-xigua");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

const CASES = [
  {
    name: "video-iqiyi",
    create: (fetchFn, account) => new IqiyiVideoAdapter({ fetchFn, account }),
    sourceRequestCount: 3,
    response: ({ url, query }, suffix) => ({
      data: {
        list:
          url.includes("myRC") && query.page === 1
            ? [
                {
                  tvId: `iqiyi-${suffix}`,
                  albumName: `iQiyi ${suffix}`,
                  addtime: Date.now() - 1_000,
                },
              ]
            : [],
      },
    }),
  },
  {
    name: "video-tencent",
    create: (fetchFn, account) =>
      new TencentVideoAdapter({
        fetchFn: fetchFn || (async () => ({ data: { list: [] } })),
        account,
        watchUrl: "https://video.example.test/GetHistory",
        favouriteUrl: "https://video.example.test/GetFavorite",
      }),
    sourceRequestCount: 3,
    response: ({ url, query }, suffix) => ({
      data: {
        list:
          url.includes("GetHistory") && query.page === 1
            ? [
                {
                  cid: `tencent-${suffix}`,
                  cTitle: `Tencent ${suffix}`,
                  viewTime: Date.now() - 1_000,
                },
              ]
            : [],
      },
    }),
  },
  {
    name: "video-xigua",
    create: (fetchFn, account) => new XiguaVideoAdapter({ fetchFn, account }),
    sourceRequestCount: 3,
    response: ({ url, query }, suffix) => ({
      data: {
        list:
          url.includes("/history/") && query.page === 1
            ? [
                {
                  group_id: `xigua-${suffix}`,
                  title: `Xigua ${suffix}`,
                  create_time: Date.now() - 1_000,
                },
              ]
            : [],
      },
    }),
  },
  {
    name: "doc-camscanner",
    rateLimits: { perMinute: 8, perDay: 200 },
    create: (fetchFn, account) =>
      new CamScannerDocAdapter({ fetchFn, account }),
    sourceRequestCount: 2,
    response: ({ query }, suffix) => ({
      docs:
        query.offset === 0
          ? [
              {
                sync_doc_id: `camscanner-${suffix}`,
                title: `CamScanner ${suffix}`,
                modify_time: Date.now() - 1_000,
              },
            ]
          : [],
    }),
  },
];

describe.each(CASES)(
  "$name transient base-adapter cookie collection",
  (testCase) => {
    it("declares conservative source-request quotas", () => {
      expect(testCase.create().rateLimits).toEqual(
        testCase.rateLimits || { perMinute: 30, perDay: 500 },
      );
    });

    it("hashes the constructor account into a stable default scope", async () => {
      const account = {
        userId: "configured-account",
        cookies: "sid=configured-secret",
      };
      const adapter = testCase.create(undefined, account);

      expect(adapter.defaultScope).toMatch(
        new RegExp(`^account:${testCase.name}:[a-f0-9]{32}$`, "u"),
      );
      expect(adapter.defaultScope).not.toContain(account.userId);
      await expect(adapter.authenticate()).resolves.toMatchObject({
        ok: true,
        account: account.userId,
        mode: "cookie",
      });
    });

    it("isolates runtime accounts without mutating or persisting credentials", async () => {
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
          return testCase.response(request, suffix);
        });
        const registry = new AdapterRegistry({
          vault,
          sleep: async () => {},
        });
        registry.register(adapter);
        const signal = new AbortController().signal;

        await expect(
          adapter.authenticate({ cookie: "sid=account-a-secret" }),
        ).resolves.toMatchObject({
          ok: false,
          reason: "NO_ACCOUNT_ID",
        });
        await expect(
          adapter.healthCheck({ cookie: "sid=account-a-secret" }),
        ).resolves.toMatchObject({
          ok: false,
          reason: "NO_ACCOUNT_ID",
        });
        await expect(
          adapter.authenticate({
            cookie: "sid=account-a-secret",
            accountId: "Runtime-Account-A",
          }),
        ).resolves.toEqual({
          ok: true,
          account: "Runtime-Account-A",
          mode: "cookie",
        });
        await expect(
          adapter.healthCheck({
            cookie: "sid=account-a-secret",
            accountId: "Runtime-Account-A",
          }),
        ).resolves.toMatchObject({ ok: true });

        const first = await registry.syncAdapter(testCase.name, {
          cookie: "sid=account-a-secret",
          accountId: "Runtime-Account-A",
          signal,
        });
        const second = await registry.syncAdapter(testCase.name, {
          cookie: "sid=account-b-secret",
          accountId: "Runtime-Account-B",
          signal,
        });

        for (const report of [first, second]) {
          expect(report.status).toBe("ok");
          expect(report.rawCount).toBe(1);
          expect(report.sourceRequestCount).toBe(testCase.sourceRequestCount);
          expect(report.checkpointCommitted).toBe(true);
          expect(report.scope).toMatch(
            new RegExp(`^account:${testCase.name}:[a-f0-9]{32}$`, "u"),
          );
          expect(
            vault.queryRawEvents({
              adapter: testCase.name,
              scope: report.scope,
            }),
          ).toHaveLength(1);
          expect(vault.getWatermark(testCase.name, report.scope)).toBeTruthy();
        }

        expect(first.scope).not.toBe(second.scope);
        expect(sourceRequests).toHaveLength(testCase.sourceRequestCount * 2);
        expect(
          sourceRequests.every((request) => request.signal === signal),
        ).toBe(true);
        expect(
          sourceRequests
            .slice(0, testCase.sourceRequestCount)
            .every((request) => request.cookies === "sid=account-a-secret"),
        ).toBe(true);
        expect(
          sourceRequests
            .slice(testCase.sourceRequestCount)
            .every((request) => request.cookies === "sid=account-b-secret"),
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
          "runtime-account-a",
          "runtime-account-b",
        ]) {
          expect(persisted).not.toContain(secret);
        }
      } finally {
        vault.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  },
);
