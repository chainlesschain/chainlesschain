"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { TianyanchaAdapter } = require("../lib/adapters/biz-tianyancha");
const { BossZhipinAdapter } = require("../lib/adapters/recruit-boss");
const { DoubanAdapter } = require("../lib/adapters/social-douban");
const { CsdnAdapter } = require("../lib/adapters/social-csdn");
const { DongchediAdapter } = require("../lib/adapters/social-dongchedi");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

const RUNTIME_COOKIE = "runtime_session=secret-value";
const CONFIGURED_COOKIE = "configured_session=existing-value";
const RUNTIME_ACCOUNT_ID = "runtime-user";
const CONFIGURED_ACCOUNT_ID = "configured-user";

const CASES = [
  {
    name: "biz-tianyancha",
    Adapter: TianyanchaAdapter,
    identityKey: "userId",
    platformCookie: "TYCID=secret-value",
    include: { search: false },
    operation: "monitor",
    emptyResponse: { data: { list: [] } },
    registrySourceRequestCount: 2,
    registryResponse(request, suffix) {
      return {
        data: {
          list:
            request.query.pageNum === 1
              ? [
                  {
                    graphId: `company-${suffix}`,
                    companyName: `Company ${suffix}`,
                    createTime: Math.floor(Date.now() / 1_000),
                  },
                ]
              : [],
        },
      };
    },
  },
  {
    name: "recruit-boss",
    Adapter: BossZhipinAdapter,
    identityKey: "userId",
    platformCookie: "wt2=secret-value",
    include: { application: false },
    operation: "chat",
    emptyResponse: { zpData: { list: [] } },
    registrySourceRequestCount: 2,
    registryResponse(request, suffix) {
      return {
        zpData: {
          list:
            request.query.page === 1
              ? [
                  {
                    jobId: `job-${suffix}`,
                    jobName: `Job ${suffix}`,
                    brandName: `Company ${suffix}`,
                    lastChatTime: Math.floor(Date.now() / 1_000),
                  },
                ]
              : [],
        },
      };
    },
  },
  {
    name: "social-douban",
    Adapter: DoubanAdapter,
    identityKey: "userId",
    platformCookie: "bid=secret-value",
    include: { review: false, follow: false },
    operation: "interest",
    emptyResponse: { interests: [], total: 0 },
    registrySourceRequestCount: 1,
    registryResponse(_request, suffix) {
      return {
        interests: [
          {
            id: `interest-${suffix}`,
            status: "done",
            create_time: new Date().toISOString(),
            subject: {
              id: `subject-${suffix}`,
              type: "book",
              title: `Book ${suffix}`,
            },
          },
        ],
        total: 1,
      };
    },
    assertRequest(request) {
      expect(request.url).toContain(`/user/${RUNTIME_ACCOUNT_ID}/interests`);
    },
  },
  {
    name: "social-csdn",
    Adapter: CsdnAdapter,
    identityKey: "username",
    platformCookie: "UserToken=secret-value",
    include: { favourite: false, follow: false },
    operation: "article",
    emptyResponse: { list: [] },
    registrySourceRequestCount: 2,
    registryResponse(request, suffix) {
      return {
        list:
          request.query.page === 1
            ? [
                {
                  articleId: `article-${suffix}`,
                  title: `Article ${suffix}`,
                  createdTime: Math.floor(Date.now() / 1_000),
                },
              ]
            : [],
      };
    },
    assertRequest(request) {
      expect(request.query.username).toBe(RUNTIME_ACCOUNT_ID);
    },
  },
  {
    name: "social-dongchedi",
    Adapter: DongchediAdapter,
    identityKey: "userId",
    platformCookie: "sessionid=secret-value",
    include: { follow: false },
    operation: "favourite",
    emptyResponse: { data: { list: [], has_more: false } },
    registrySourceRequestCount: 1,
    registryResponse(_request, suffix) {
      return {
        data: {
          list: [
            {
              group_id: `item-${suffix}`,
              title: `Car ${suffix}`,
              create_time: Math.floor(Date.now() / 1_000),
            },
          ],
          has_more: false,
        },
      };
    },
  },
];

describe.each(CASES)("$name transient cookie collection", (testCase) => {
  it("uses one-shot credentials through auth, health, pacing, and transport", async () => {
    const requests = [];
    const sourceRequests = [];
    let watermarkComplete = false;
    const signal = new AbortController().signal;
    const adapter = new testCase.Adapter({
      fetchFn: async (request) => {
        requests.push(request);
        return testCase.emptyResponse;
      },
    });
    const options = {
      cookie: testCase.platformCookie,
      accountId: RUNTIME_ACCOUNT_ID,
      include: testCase.include,
      signal,
      beforeSourceRequest: async (request) => {
        sourceRequests.push(request);
      },
      markWatermarkComplete: () => {
        watermarkComplete = true;
      },
    };

    expect(adapter.runtimeScopeIdentityKey).toBe(testCase.identityKey);
    await expect(adapter.authenticate(options)).resolves.toMatchObject({
      ok: true,
      account: RUNTIME_ACCOUNT_ID,
      mode: "cookie",
    });
    await expect(adapter.healthCheck(options)).resolves.toMatchObject({
      ok: true,
    });
    await expect(collect(adapter.sync(options))).resolves.toEqual([]);

    expect(sourceRequests).toHaveLength(1);
    expect(sourceRequests[0]).toMatchObject({
      operation: testCase.operation,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      cookies: testCase.platformCookie,
      signal,
    });
    expect(watermarkComplete).toBe(true);
    if (testCase.assertRequest) testCase.assertRequest(requests[0]);

    expect(adapter.account).toBe(null);
    expect(adapter._cookieAuth).toBe(null);
    expect(JSON.stringify(adapter)).not.toContain(testCase.platformCookie);
  });

  it("rejects an unscoped runtime override without breaking configured accounts", async () => {
    const account = {
      [testCase.identityKey]: CONFIGURED_ACCOUNT_ID,
      cookies: CONFIGURED_COOKIE,
    };
    const adapter = new testCase.Adapter({
      account,
      fetchFn: async () => testCase.emptyResponse,
    });

    await expect(
      adapter.authenticate({ cookie: RUNTIME_COOKIE }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      adapter.healthCheck({ cookie: RUNTIME_COOKIE }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      collect(adapter.sync({ cookie: RUNTIME_COOKIE })),
    ).rejects.toThrow(/opts\.accountId required/u);

    await expect(adapter.authenticate()).resolves.toMatchObject({
      ok: true,
      account: CONFIGURED_ACCOUNT_ID,
      mode: "cookie",
    });
    expect(adapter.account).toBe(account);
    expect(adapter._cookieAuth.toHeader()).toBe(CONFIGURED_COOKIE);
    expect(adapter.defaultScope).toMatch(/^account:/u);
    expect(adapter.defaultScope).not.toContain(CONFIGURED_ACCOUNT_ID);
  });

  it("isolates registry checkpoints and never persists runtime secrets", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `pdh-${testCase.name}-runtime-`),
    );
    const vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    try {
      const requests = [];
      const adapter = new testCase.Adapter({
        fetchFn: async (request) => {
          requests.push(request);
          const suffix = request.cookies.includes("account-a") ? "a" : "b";
          return testCase.registryResponse(request, suffix);
        },
      });
      const registry = new AdapterRegistry({
        vault,
        sleep: async () => {},
      });
      registry.register(adapter);

      const first = await registry.syncAdapter(testCase.name, {
        cookie: "sid=account-a-secret",
        accountId: "Runtime-Account-A",
        include: testCase.include,
      });
      const second = await registry.syncAdapter(testCase.name, {
        cookie: "sid=account-b-secret",
        accountId: "Runtime-Account-B",
        include: testCase.include,
      });

      for (const report of [first, second]) {
        expect(report).toMatchObject({
          status: "ok",
          rawCount: 1,
          sourceRequestCount: testCase.registrySourceRequestCount,
          checkpointCommitted: true,
        });
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
      expect(requests).toHaveLength(testCase.registrySourceRequestCount * 2);
      expect(adapter.account).toBe(null);
      expect(adapter._cookieAuth).toBe(null);

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
});
