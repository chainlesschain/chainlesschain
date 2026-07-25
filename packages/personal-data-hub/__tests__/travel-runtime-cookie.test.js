"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CtripAdapter } = require("../lib/adapters/travel-ctrip");
const { DidiAdapter } = require("../lib/adapters/travel-didi");
const { DidiConsumerAdapter } = require("../lib/adapters/travel-didi-consumer");
const { TongchengAdapter } = require("../lib/adapters/travel-tongcheng");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

const CASES = [
  {
    name: "travel-ctrip",
    create: (fetchFn) => new CtripAdapter({ fetchFn }),
    response: (suffix) => ({
      orderList: [
        {
          orderId: `ctrip-${suffix}`,
          type: "flight",
          orderDate: Date.now() - 1_000,
        },
      ],
      hasMore: false,
    }),
  },
  {
    name: "travel-tongcheng",
    create: (fetchFn) => new TongchengAdapter({ fetchFn }),
    response: (suffix) => ({
      orderList: [
        {
          orderId: `tongcheng-${suffix}`,
          projectType: "train",
          orderDate: Date.now() - 1_000,
        },
      ],
      hasMore: false,
    }),
  },
  {
    name: "travel-didi",
    create: (fetchFn) => new DidiAdapter({ fetchFn }),
    response: (suffix) => ({
      orders: [
        {
          orderId: `didi-${suffix}`,
          departTime: Date.now() - 1_000,
          fromAddress: "家",
          toAddress: "公司",
        },
      ],
      hasMore: false,
    }),
  },
  {
    name: "travel-didi-consumer",
    create: (fetchFn) => new DidiConsumerAdapter({ fetchFn }),
    options: (suffix) => ({
      cookie: `sid=account-${suffix}-secret`,
      accountId: `Travel-Account-${suffix.toUpperCase()}`,
      sourceUrl: `https://api.xiaojukeji.com/orders?session=runtime-url-${suffix}`,
    }),
    runtimeScopeIdentityKey: "phone",
    response: (suffix) => ({
      orders: [
        {
          orderId: `didi-consumer-${suffix}`,
          departTime: Date.now() - 1_000,
          fromAddress: "A",
          toAddress: "B",
        },
      ],
      hasMore: false,
    }),
  },
];

describe.each(CASES)("$name transient cookie collection", (testCase) => {
  it("declares conservative source-request quotas", () => {
    expect(testCase.create().rateLimits).toEqual({
      perMinute: 8,
      perDay: 200,
    });
  });

  it("collects through AdapterRegistry with isolated scopes and no credential persistence", async () => {
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
      const signal = new AbortController().signal;

      const firstOptions = testCase.options
        ? { ...testCase.options("a"), signal }
        : {
            cookie: "sid=account-a-secret",
            accountId: "Travel-Account-A",
            signal,
          };
      const secondOptions = testCase.options
        ? { ...testCase.options("b"), signal }
        : {
            cookie: "sid=account-b-secret",
            accountId: "Travel-Account-B",
            signal,
          };
      expect(
        await adapter.authenticate({
          ...firstOptions,
          accountId: undefined,
        }),
      ).toMatchObject({
        ok: false,
        reason: "NO_ACCOUNT_ID",
      });
      expect(await adapter.authenticate(firstOptions)).toMatchObject({
        ok: true,
        account: "Travel-Account-A",
        mode: "cookie",
      });

      const first = await registry.syncAdapter(testCase.name, firstOptions);
      const second = await registry.syncAdapter(testCase.name, secondOptions);

      for (const report of [first, second]) {
        expect(report.status).toBe("ok");
        expect(report.rawCount).toBe(1);
        expect(report.sourceRequestCount).toBe(1);
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
      expect(sourceRequests).toHaveLength(2);
      expect(sourceRequests.map((request) => request.cookies)).toEqual([
        "sid=account-a-secret",
        "sid=account-b-secret",
      ]);
      expect(sourceRequests.every((request) => request.signal === signal)).toBe(
        true,
      );
      expect(adapter.account).toBe(null);
      expect(adapter._cookieAuth).toBe(null);
      expect(adapter.runtimeScopeIdentityKey).toBe(
        testCase.runtimeScopeIdentityKey || "userId",
      );

      const persisted = JSON.stringify({
        first,
        second,
        raw: vault.queryRawEvents({ adapter: testCase.name }),
        audit: vault.queryAudit({ limit: 100 }),
      }).toLowerCase();
      for (const secret of [
        "account-a-secret",
        "account-b-secret",
        "travel-account-a",
        "travel-account-b",
        "runtime-url-a",
        "runtime-url-b",
      ]) {
        expect(persisted).not.toContain(secret);
      }
    } finally {
      vault.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
