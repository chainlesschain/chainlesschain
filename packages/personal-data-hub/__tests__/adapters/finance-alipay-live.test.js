/**
 * FAMILY-23 v0.2 — finance-alipay LIVE mobilegw fetcher tests.
 * cookie (支付宝会话) → mgw.htm bill-list → snapshot-shaped events + adapter
 * live sync + signProvider seam + amount/direction derivation + error mapping.
 * All network via injected fetch. Endpoint shapes are best-effort (see
 * api-client header) — these tests pin the REQUEST CONSTRUCTION + PARSING
 * contract, not the live server, which can't be verified here.
 */
"use strict";

import { describe, it, expect } from "vitest";

const { AlipayAdapter } = require("../../lib");
const {
  AlipayApiClient,
  parseAmountYuan,
  deriveDirection,
} = require("../../lib/adapters/finance-alipay/api-client");
const { validateBatch } = require("../../lib/batch");

const COOKIE = "ALIPAYJSESSIONID=sess-abc; userId=2088123";
const COOKIE_TOKEN_ONLY = "ALIPAYJSESSIONID=sess-abc";

function makeFetch(routes, calls) {
  return async (url, init) => {
    calls.push({
      url,
      body: (init && init.body) || null,
      headers: (init && init.headers) || {},
    });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return { ok: false, status: 404, text: async () => "not mapped" };
    return {
      ok: route.status ? route.status >= 200 && route.status < 300 : true,
      status: route.status || 200,
      text: async () =>
        typeof route.body === "string" ? route.body : JSON.stringify(route.body),
    };
  };
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("alipay amount/direction derivation", () => {
  it("parseAmountYuan handles number / signed string / currency noise", () => {
    expect(parseAmountYuan(12.5)).toEqual({ amountFen: 1250, sign: 1 });
    expect(parseAmountYuan("-25.00")).toEqual({ amountFen: 2500, sign: -1 });
    expect(parseAmountYuan("+3.50")).toEqual({ amountFen: 350, sign: 1 });
    expect(parseAmountYuan("¥ 1,200.00")).toEqual({ amountFen: 120000, sign: 1 });
    expect(parseAmountYuan("abc")).toBeNull();
    expect(parseAmountYuan(null)).toBeNull();
  });

  it("deriveDirection: explicit field wins, then amount sign, default out", () => {
    expect(deriveDirection("收入", -1)).toBe("in");
    expect(deriveDirection("支出", 1)).toBe("out");
    expect(deriveDirection("INCOME", 0)).toBe("in");
    expect(deriveDirection(null, 1)).toBe("in");
    expect(deriveDirection(null, -1)).toBe("out");
    expect(deriveDirection(null, 0)).toBe("out");
  });
});

describe("AlipayApiClient session probe", () => {
  it("hasSession accepts session token or numeric uid; rejects neither", () => {
    const c = new AlipayApiClient();
    expect(c.hasSession(COOKIE_TOKEN_ONLY)).toBe(true);
    expect(c.hasSession("userId=2088123")).toBe(true);
    expect(c.hasSession("foo=bar")).toBe(false);
    expect(c.lastError.code).toBe(-7);
  });
});

describe("AlipayApiClient.fetchSnapshot — live (mocked fetch)", () => {
  it("POSTs form-encoded operationType+requestData with cookie; parses bills", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "/mgw.htm",
          body: {
            resultStatus: 1000,
            result: {
              success: true,
              billList: [
                { billId: "b1", displayName: "便利店", amount: "-12.50", gmtCreate: 1700000000 },
                { tradeNo: "b2", merchantName: "红包", amount: "+5.00", inOut: "收入", createTime: "1700003600" },
              ],
            },
          },
        },
      ],
      calls,
    );
    const client = new AlipayApiClient({ fetch });
    const result = await client.fetchSnapshot(COOKIE);
    // profile derived from cookie scrape (no extra op)
    expect(result.account).toEqual({ uid: "2088123", displayName: null });
    const profile = result.events.find((e) => e.kind === "profile");
    expect(profile).toMatchObject({ uid: "2088123" });
    const orders = result.events.filter((e) => e.kind === "order");
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({
      id: "order-b1",
      merchant: "便利店",
      amountFen: 1250,
      direction: "out",
      startAt: 1700000000000,
    });
    expect(orders[1]).toMatchObject({
      id: "order-b2",
      merchant: "红包",
      amountFen: 500,
      direction: "in",
      startAt: 1700003600000,
    });
    const call = calls[0];
    expect(call.headers.Cookie).toBe(COOKIE);
    expect(call.headers["Content-Type"]).toContain("application/x-www-form-urlencoded");
    expect(call.body).toContain("operationType=alipay.mobile.bill.list");
    expect(call.body).toContain("requestData=");
  });

  it("parses result-as-JSON-string envelope (mgw double-encoding)", async () => {
    const fetch = makeFetch(
      [
        {
          match: "/mgw.htm",
          body: {
            resultStatus: 1000,
            result: JSON.stringify({ success: true, list: [{ id: "s1", title: "公交", amount: "-2.00", tradeTime: 1700000000 }] }),
          },
        },
      ],
      [],
    );
    const client = new AlipayApiClient({ fetch });
    const result = await client.fetchSnapshot(COOKIE_TOKEN_ONLY);
    // token-only cookie → no profile event, account null, orders still flow
    expect(result.account).toBeNull();
    expect(result.events.every((e) => e.kind === "order")).toBe(true);
    expect(result.events[0]).toMatchObject({ merchant: "公交", amountFen: 200, direction: "out" });
  });

  it("signProvider headers are merged into the request", async () => {
    const calls = [];
    const fetch = makeFetch(
      [{ match: "/mgw.htm", body: { resultStatus: 1000, result: { success: true, billList: [] } } }],
      calls,
    );
    const signProvider = {
      buildHeaders: async ({ operationType }) => ({ "X-Sign": `sig-of-${operationType}` }),
    };
    const client = new AlipayApiClient({ fetch, signProvider });
    await client.fetchSnapshot(COOKIE);
    expect(calls[0].headers["X-Sign"]).toBe("sig-of-alipay.mobile.bill.list");
  });

  it("maps mgw gateway error (resultStatus != 1000) to null + lastError", async () => {
    const fetch = makeFetch(
      [{ match: "/mgw.htm", body: { resultStatus: 2000, memo: "登录超时" } }],
      [],
    );
    const client = new AlipayApiClient({ fetch });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(2000);
    expect(client.lastError.message).toContain("登录超时");
  });

  it("maps business failure (success:false) to null + lastError -6", async () => {
    const fetch = makeFetch(
      [{ match: "/mgw.htm", body: { resultStatus: 1000, result: { success: false, resultMessage: "无权限" } } }],
      [],
    );
    const client = new AlipayApiClient({ fetch });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(-6);
    expect(client.lastError.message).toContain("无权限");
  });

  it("no session cookie → null + lastError -7 (no network)", async () => {
    const calls = [];
    const client = new AlipayApiClient({ fetch: makeFetch([], calls) });
    expect(await client.fetchSnapshot("foo=bar")).toBeNull();
    expect(client.lastError.code).toBe(-7);
    expect(calls).toHaveLength(0);
  });

  it("sign failure → null + lastError -5 (no network)", async () => {
    const calls = [];
    const client = new AlipayApiClient({
      fetch: makeFetch([], calls),
      signProvider: { buildHeaders: () => { throw new Error("key missing"); } },
    });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(-5);
    expect(calls).toHaveLength(0);
  });
});

describe("AlipayAdapter — cookie (live) sync mode", () => {
  it("authenticate accepts session cookie; rejects sessionless", async () => {
    const a = new AlipayAdapter();
    expect((await a.authenticate({ cookie: COOKIE })).mode).toBe("cookie");
    const bad = await a.authenticate({ cookie: "foo=bar" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("INVALID_COOKIE");
  });

  it("version/capabilities reflect v0.2 live mode", () => {
    const a = new AlipayAdapter();
    expect(a.version).toBe("0.2.0");
    expect(a.capabilities).toContain("sync:cookie");
  });

  it("sync via cookie yields profile+order raws → valid normalized batch", async () => {
    const fetch = makeFetch(
      [
        {
          match: "/mgw.htm",
          body: {
            resultStatus: 1000,
            result: { success: true, billList: [{ billId: "b1", displayName: "便利店", amount: "-12.50", gmtCreate: 1700000000 }] },
          },
        },
      ],
      [],
    );
    const a = new AlipayAdapter();
    const raws = await collect(a.sync({ cookie: COOKIE, fetch }));
    expect(raws.map((r) => r.kind).sort()).toEqual(["order", "profile"]);
    const profileRaw = raws.find((r) => r.kind === "profile");
    expect(profileRaw.originalId).toBe("alipay:profile:profile-2088123");

    for (const raw of raws) {
      expect(validateBatch(a.normalize(raw)).valid).toBe(true);
    }
    const profileBatch = a.normalize(profileRaw);
    expect(profileBatch.persons[0].identifiers["alipay-uid"]).toEqual(["2088123"]);
    const orderBatch = a.normalize(raws.find((r) => r.kind === "order"));
    expect(orderBatch.events[0].subtype).toBe("payment");
    expect(orderBatch.events[0].extra.amountFen).toBe(1250);
    expect(orderBatch.events[0].extra.direction).toBe("out");
  });

  it("sync via cookie throws (mapped lastError) on gateway error", async () => {
    const fetch = makeFetch(
      [{ match: "/mgw.htm", body: { resultStatus: 2000, memo: "登录超时" } }],
      [],
    );
    const a = new AlipayAdapter();
    await expect(collect(a.sync({ cookie: COOKIE, fetch }))).rejects.toThrow(/登录超时|code 2000/);
  });
});
