"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const dc = require("../../lib/adapters/travel-didi-consumer");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-didic-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "didi_token=abc";

describe("travel-didi-consumer", () => {
  it("name distinct from enterprise", () => {
    expect(dc.NAME).toBe("travel-didi-consumer");
    expect(new dc.DidiConsumerAdapter().name).toBe("travel-didi-consumer");
  });

  it("snapshot ride → car travel event (via travel-base normalize)", async () => {
    const SNAP = JSON.stringify([
      {
        orderId: "O1",
        fromAddress: "家",
        toAddress: "公司",
        departTime: 1716383000,
        arriveTime: 1716385000,
        fare: 2350,
        productName: "快车",
      },
    ]);
    const p = writeTmp(SNAP);
    try {
      const a = new dc.DidiConsumerAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0].originalId).toBe("O1");
      const b = a.normalize(items[0]);
      expect(b.events.length).toBeGreaterThan(0);
      expect(b.source ? true : b.events[0].source.adapter).toBe(
        "travel-didi-consumer",
      );
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: unverified + sign seam + paginate", async () => {
    let signed = 0;
    const a = new dc.DidiConsumerAdapter({
      account: { cookies: COOKIES, phone: "1" },
      ordersUrl: "https://api.xiaojukeji.com/orders",
      signProvider: async () => {
        signed += 1;
        return "sig";
      },
      fetchFn: async ({ query }) =>
        query.pageIndex > 1
          ? { data: { list: [] } }
          : {
              data: {
                list: [
                  {
                    orderId: "O9",
                    fromAddress: "A",
                    toAddress: "B",
                    departTime: Date.now(),
                  },
                ],
              },
            },
    });
    expect(await a.authenticate()).toMatchObject({
      ok: true,
      mode: "cookie",
      unverified: true,
    });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("O9");
    expect(signed).toBe(2);
  });

  it("accepts one-shot runtime credentials without mutating the adapter", async () => {
    const requests = [];
    let sourceRequests = 0;
    const a = new dc.DidiConsumerAdapter({
      fetchFn: async (request) => {
        requests.push(request);
        return {
          orders: [
            {
              orderId: "runtime-order",
              departTime: Date.now(),
              fromAddress: "A",
              toAddress: "B",
            },
          ],
          hasMore: false,
        };
      },
    });
    const options = {
      cookie: "sid=runtime-secret",
      accountId: "phone-alias",
      sourceUrl: "https://api.xiaojukeji.com/orders?session=runtime-url-secret",
      beforeSourceRequest: async () => {
        sourceRequests += 1;
      },
    };

    expect(await a.authenticate(options)).toMatchObject({
      ok: true,
      account: "phone-alias",
      mode: "cookie",
      unverified: true,
    });
    const items = await collect(a.sync(options));
    expect(items.map((item) => item.originalId)).toEqual(["runtime-order"]);
    expect(sourceRequests).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://api.xiaojukeji.com/orders?session=runtime-url-secret",
      cookies: "sid=runtime-secret",
    });
    expect(a.account).toBe(null);
    expect(a._cookieAuth).toBe(null);
    expect(a._ordersUrl).toBe(null);
    expect(a.runtimeScopeIdentityKey).toBe("phone");
  });

  it("keeps an explicit snapshot ahead of runtime credentials and network", async () => {
    const p = writeTmp(
      JSON.stringify([
        {
          orderId: "snapshot-wins",
          fromAddress: "A",
          toAddress: "B",
          departTime: 1716383000,
        },
      ]),
    );
    let fetches = 0;
    const a = new dc.DidiConsumerAdapter({
      fetchFn: async () => {
        fetches += 1;
        throw new Error("network must not run");
      },
    });
    const options = {
      inputPath: p,
      cookie: COOKIES,
      accountId: "account-a",
      sourceUrl: "https://evil.example/orders",
    };
    try {
      expect(await a.authenticate(options)).toMatchObject({
        ok: true,
        mode: "snapshot-file",
      });
      expect(
        (await collect(a.sync(options))).map((item) => item.originalId),
      ).toEqual(["snapshot-wins"]);
      expect(fetches).toBe(0);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("rejects missing identity, missing endpoint, and unsafe source URLs", async () => {
    const a = new dc.DidiConsumerAdapter({ fetchFn: async () => ({}) });
    expect(
      await a.authenticate({
        cookie: COOKIES,
        sourceUrl: "https://api.xiaojukeji.com/orders",
      }),
    ).toMatchObject({ ok: false, reason: "NO_ACCOUNT_ID" });
    expect(
      await a.authenticate({ cookie: COOKIES, accountId: "account-a" }),
    ).toMatchObject({
      ok: false,
      reason: "EXPLICIT_ENDPOINT_REQUIRED",
    });

    const unsafeCases = [
      ["http://api.xiaojukeji.com/orders", "INVALID_SOURCE_URL"],
      ["https://user:pass@api.xiaojukeji.com/orders", "INVALID_SOURCE_URL"],
      [
        "https://api.xiaojukeji.com/orders#fragment",
        "SOURCE_URL_FRAGMENT_NOT_ALLOWED",
      ],
      ["https://api.xiaojukeji.com:8443/orders", "SOURCE_URL_PORT_NOT_ALLOWED"],
      [
        "https://xiaojukeji.com.evil.example/orders",
        "SOURCE_URL_HOST_NOT_ALLOWED",
      ],
      ["https://evilxiaojukeji.com/orders", "SOURCE_URL_HOST_NOT_ALLOWED"],
      ["https://127.0.0.1/orders", "SOURCE_URL_HOST_NOT_ALLOWED"],
    ];
    for (const [sourceUrl, reason] of unsafeCases) {
      expect(
        await a.authenticate({
          cookie: COOKIES,
          accountId: "account-a",
          sourceUrl,
        }),
        sourceUrl,
      ).toMatchObject({ ok: false, reason });
    }
  });

  it("rejects explicit source errors and unrecognized JSON pages", async () => {
    const options = {
      cookie: COOKIES,
      accountId: "account-a",
      sourceUrl: "https://api.xiaojukeji.com/orders",
    };
    await expect(
      collect(
        new dc.DidiConsumerAdapter({
          fetchFn: async () => ({ success: false, message: "expired" }),
        }).sync(options),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_PAGE_ERROR" });
    await expect(
      collect(
        new dc.DidiConsumerAdapter({
          fetchFn: async () => ({ data: { unexpected: [] } }),
        }).sync(options),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_PAGE_UNRECOGNIZED" });
  });

  it("medium sensitivity; default fetch throws", async () => {
    expect(new dc.DidiConsumerAdapter().dataDisclosure.sensitivity).toBe(
      "medium",
    );
    const unverified = new dc.DidiConsumerAdapter({
      account: { cookies: COOKIES },
    });
    expect(await unverified.authenticate()).toMatchObject({
      ok: false,
      reason: "EXPLICIT_ENDPOINT_REQUIRED",
    });
    await expect(collect(unverified.sync({}))).rejects.toThrow(
      /explicit opts\.sourceUrl or constructor ordersUrl/,
    );
  });
});
