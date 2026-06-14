"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const dc = require("../../lib/adapters/finance-dcep");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-dcep-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "DCEP_SSO=abc";

describe("finance-dcep", () => {
  it("name/version + mappers", () => {
    expect(dc.NAME).toBe("finance-dcep");
    expect(dc.normDirection({ direction: "收款" })).toBe("receive");
    expect(dc.normDirection({ amount: -5 })).toBe("pay");
    const t = dc.mapTx({ txId: "X1", time: 1716383000, amount: -12.5, merchant: "便利店", subWallet: "中行子钱包" });
    expect(t).toMatchObject({ txId: "X1", direction: "pay", counterparty: "便利店", walletType: "中行子钱包" });
    expect(t.amount).toBe(12.5);
    expect(dc.mapTx({ amount: 1 })).toBe(null);
  });

  it("snapshot → PAYMENT event; cookie-api unverified + sign", async () => {
    const SNAP = JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1716383000000,
      account: { userId: "u1" },
      events: [{ kind: "transaction", id: "tx-X1", txId: "X1", time: 1716383000, amount: 12.5, direction: "pay", counterparty: "便利店" }],
    });
    const p = writeTmp(SNAP);
    try {
      const a = new dc.DcepAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      const b = a.normalize(items[0]);
      expect(b.events[0].subtype).toBe("payment");
      expect(b.events[0].content.title).toContain("付款");
      expect(b.events[0].extra.amount).toBe(12.5);
      expect(items[0].originalId).toBe("dcep:transaction:X1");
    } finally {
      fs.unlinkSync(p);
    }

    let signed = 0;
    const a = new dc.DcepAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      signProvider: async () => { signed += 1; return "sig"; },
      fetchFn: async ({ query }) => (query.page > 1 ? { list: [] } : { list: [{ txId: "X9", time: 1716383000, amount: 9.9, direction: "receive" }] }),
    });
    expect(await a.authenticate()).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("dcep:transaction:X9");
    expect(signed).toBeGreaterThan(0);
  });

  it("high sensitivity + legalGate; default fetch / no input throw", async () => {
    expect(new dc.DcepAdapter().dataDisclosure.sensitivity).toBe("high");
    expect(new dc.DcepAdapter().dataDisclosure.legalGate).toBe(true);
    await expect(collect(new dc.DcepAdapter({ account: { cookies: COOKIES } }).sync({}))).rejects.toThrow(/no fetchFn/);
    await expect(collect(new dc.DcepAdapter().sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
