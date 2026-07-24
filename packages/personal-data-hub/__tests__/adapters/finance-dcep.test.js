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
    const t = dc.mapTx({
      txId: "X1",
      time: 1716383000,
      amount: -12.5,
      merchant: "便利店",
      subWallet: "中行子钱包",
    });
    expect(t).toMatchObject({
      txId: "X1",
      direction: "pay",
      counterparty: "便利店",
      walletType: "中行子钱包",
    });
    expect(t.amount).toBe(12.5);
    expect(dc.mapTx({ amount: 1 })).toBe(null);
  });

  it("snapshot → PAYMENT event; cookie-api unverified + sign", async () => {
    const SNAP = JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1716383000000,
      account: { userId: "u1" },
      events: [
        {
          kind: "transaction",
          id: "tx-X1",
          txId: "X1",
          time: 1716383000,
          amount: 12.5,
          direction: "pay",
          counterparty: "便利店",
        },
      ],
    });
    const p = writeTmp(SNAP);
    try {
      const a = new dc.DcepAdapter();
      await expect(a.authenticate({ inputPath: p })).resolves.toMatchObject({
        ok: true,
        mode: "snapshot-file",
      });
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
      listUrl: "https://captured.example/transactions",
      signProvider: async () => {
        signed += 1;
        return "sig";
      },
      fetchFn: async ({ query }) =>
        query.page > 1
          ? { list: [] }
          : {
              list: [
                {
                  txId: "X9",
                  time: 1716383000,
                  amount: 9.9,
                  direction: "receive",
                },
              ],
            },
    });
    expect(await a.authenticate()).toMatchObject({
      ok: true,
      mode: "cookie",
      unverified: true,
    });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("dcep:transaction:X9");
    expect(items[0].watermarkAt).toBe(1_716_383_000_000);
    expect(signed).toBeGreaterThan(0);
  });

  it.each([
    [
      "wrong schema",
      { schemaVersion: 2, events: [] },
      "SNAPSHOT_SCHEMA_MISMATCH",
    ],
    [
      "non-array events",
      { schemaVersion: 1, events: {} },
      "SNAPSHOT_SHAPE_INVALID",
    ],
    [
      "an unknown event kind",
      { schemaVersion: 1, events: [{ kind: "unknown" }] },
      "SNAPSHOT_SHAPE_INVALID",
    ],
    [
      "a non-object event",
      { schemaVersion: 1, events: [null] },
      "SNAPSHOT_SHAPE_INVALID",
    ],
  ])(
    "rejects a snapshot with %s during authentication and sync",
    async (_label, snapshot, expectedCode) => {
      const file = writeTmp(JSON.stringify(snapshot));
      const adapter = new dc.DcepAdapter();
      try {
        await expect(
          adapter.authenticate({ inputPath: file }),
        ).resolves.toMatchObject({
          ok: false,
          reason: expectedCode,
        });
        await expect(
          collect(adapter.sync({ inputPath: file })),
        ).rejects.toMatchObject({
          code: expectedCode,
        });
      } finally {
        fs.unlinkSync(file);
      }
    },
  );

  it("enforces maxSnapshotBytes during authentication and sync", async () => {
    const file = writeTmp(
      JSON.stringify({
        schemaVersion: 1,
        events: [],
        padding: "x".repeat(128),
      }),
    );
    const adapter = new dc.DcepAdapter();
    try {
      await expect(
        adapter.authenticate({
          inputPath: file,
          maxSnapshotBytes: 32,
        }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "SNAPSHOT_TOO_LARGE",
      });
      await expect(
        collect(
          adapter.sync({
            inputPath: file,
            maxSnapshotBytes: 32,
          }),
        ),
      ).rejects.toMatchObject({
        code: "SNAPSHOT_TOO_LARGE",
      });
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("fails closed when a snapshot transaction has no stable source id", async () => {
    const file = writeTmp(
      JSON.stringify({
        schemaVersion: 1,
        events: [{ kind: "transaction", amount: 1 }],
      }),
    );
    try {
      await expect(
        collect(new dc.DcepAdapter().sync({ inputPath: file })),
      ).rejects.toThrow(/requires a stable id/u);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it.each([
    [
      "explicit 401",
      { code: 401, message: "expired session" },
      "SOURCE_PAGE_ERROR",
    ],
    ["unknown response shape", { unexpected: [] }, "SOURCE_PAGE_UNRECOGNIZED"],
  ])(
    "does not complete the watermark after an %s page",
    async (_label, response, expectedCode) => {
      let completions = 0;
      let requests = 0;
      const adapter = new dc.DcepAdapter({
        account: { cookies: COOKIES, userId: "u1" },
        listUrl: "https://captured.example/transactions",
        fetchFn: async () => {
          requests += 1;
          if (requests > 1) return response;
          return {
            list: Array.from({ length: 30 }, (_, index) => ({
              txId: `PAGE-1-${index}`,
              time: 1_716_383_100 + index,
              amount: index + 1,
            })),
          };
        },
      });

      await expect(
        collect(
          adapter.sync({
            markWatermarkComplete: () => {
              completions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(requests).toBe(2);
      expect(completions).toBe(0);
    },
  );

  it("keeps scanning a page after an old row and emits a later new row", async () => {
    let completions = 0;
    const adapter = new dc.DcepAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      listUrl: "https://captured.example/transactions",
      fetchFn: async ({ query }) =>
        query.page > 1
          ? { list: [] }
          : {
              list: [
                {
                  txId: "OLD",
                  time: 1_716_382_999,
                  amount: -1,
                },
                {
                  txId: "NEW",
                  time: 1_716_383_001,
                  amount: 2,
                },
              ],
            },
    });

    const items = await collect(
      adapter.sync({
        sinceWatermark: 1_716_383_000_000,
        markWatermarkComplete: () => {
          completions += 1;
        },
      }),
    );

    expect(items.map((item) => item.originalId)).toEqual([
      "dcep:transaction:NEW",
    ]);
    expect(completions).toBe(1);
  });

  it("does not treat a non-empty short page as the source boundary", async () => {
    let completions = 0;
    const adapter = new dc.DcepAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      listUrl: "https://captured.example/transactions",
      fetchFn: async () => ({
        list: [{ txId: "SHORT", time: 1_716_383_001, amount: 2 }],
      }),
    });

    await expect(
      collect(
        adapter.sync({
          maxPages: 1,
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      ),
    ).resolves.toHaveLength(1);
    expect(completions).toBe(0);
  });

  it("high sensitivity + legalGate; default fetch / no input throw", async () => {
    expect(new dc.DcepAdapter().dataDisclosure.sensitivity).toBe("high");
    expect(new dc.DcepAdapter().dataDisclosure.legalGate).toBe(true);
    const unverified = new dc.DcepAdapter({ account: { cookies: COOKIES } });
    expect(await unverified.authenticate()).toMatchObject({
      ok: false,
      reason: "EXPLICIT_ENDPOINT_REQUIRED",
    });
    await expect(collect(unverified.sync({}))).rejects.toThrow(
      /explicit listUrl/,
    );
    await expect(collect(new dc.DcepAdapter().sync({}))).rejects.toThrow(
      /needs opts.inputPath/,
    );
  });
});
