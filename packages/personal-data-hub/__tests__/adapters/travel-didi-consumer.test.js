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
      { orderId: "O1", fromAddress: "家", toAddress: "公司", departTime: 1716383000, arriveTime: 1716385000, fare: 2350, productName: "快车" },
    ]);
    const p = writeTmp(SNAP);
    try {
      const a = new dc.DidiConsumerAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0].originalId).toBe("O1");
      const b = a.normalize(items[0]);
      expect(b.events.length).toBeGreaterThan(0);
      expect(b.source ? true : b.events[0].source.adapter).toBe("travel-didi-consumer");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: unverified + sign seam + paginate", async () => {
    let signed = 0;
    const a = new dc.DidiConsumerAdapter({
      account: { cookies: COOKIES, phone: "1" },
      ordersUrl: "https://captured.example/orders",
      signProvider: async () => { signed += 1; return "sig"; },
      fetchFn: async ({ query }) => (query.pageIndex > 1 ? { data: { list: [] } } : { data: { list: [{ orderId: "O9", fromAddress: "A", toAddress: "B", departTime: Date.now() }] } }),
    });
    expect(await a.authenticate()).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("O9");
    expect(signed).toBeGreaterThan(0);
  });

  it("medium sensitivity; default fetch throws", async () => {
    expect(new dc.DidiConsumerAdapter().dataDisclosure.sensitivity).toBe("medium");
    const unverified = new dc.DidiConsumerAdapter({ account: { cookies: COOKIES } });
    expect(await unverified.authenticate()).toMatchObject({ ok: false, reason: "EXPLICIT_ENDPOINT_REQUIRED" });
    await expect(collect(unverified.sync({}))).rejects.toThrow(/explicit ordersUrl/);
  });
});
