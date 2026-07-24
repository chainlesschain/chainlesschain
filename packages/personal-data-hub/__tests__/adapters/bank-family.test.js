"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const base = require("../../lib/adapters/_bank-base");
const cmbc = require("../../lib/adapters/bank-cmbc");
const boc = require("../../lib/adapters/bank-boc");
const bankcomm = require("../../lib/adapters/bank-bankcomm");
const icbc = require("../../lib/adapters/bank-icbc");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-bank-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
const COOKIES = "MBANK_SSO=abc; sid=xyz";

describe("_bank-base helpers", () => {
  it("normDirection: keyword + amount-sign fallback", () => {
    expect(base.normDirection({ direction: "收入" })).toBe("credit");
    expect(base.normDirection({ flag: "支出" })).toBe("debit");
    expect(base.normDirection({ amount: -50 })).toBe("debit");
    expect(base.normDirection({ amount: 50 })).toBe("credit");
  });
  it("mapTransaction / mapCard aliases; no id → null", () => {
    const tx = base.mapTransaction({
      serialNo: "T1",
      tranTime: 1716383000,
      tranAmount: "-1,234.56",
      oppName: "星巴克",
      abstract: "消费",
      bal: 9999,
    });
    expect(tx).toMatchObject({
      txId: "T1",
      direction: "debit",
      counterparty: "星巴克",
      summary: "消费",
    });
    expect(tx.amount).toBeCloseTo(1234.56, 2);
    expect(tx.balance).toBe(9999);
    expect(base.mapTransaction({ amount: 1 })).toBe(null);
    const card = base.mapCard({
      billId: "B1",
      billMonth: "2025-03",
      statementAmount: 3210,
      minPayment: 321,
      status: "已出账",
    });
    expect(card).toMatchObject({
      billId: "B1",
      billMonth: "2025-03",
      statementAmount: 3210,
      status: "已出账",
    });
    expect(base.mapCard({ status: "x" })).toBe(null);
  });
  it("billMonthToMs", () => {
    expect(base.billMonthToMs("2025-03")).toBe(
      Date.parse("2025-03-01T00:00:00Z"),
    );
  });
});

describe("bank wrappers identity", () => {
  it("each wrapper has its own name + adapter class", () => {
    expect(cmbc.NAME).toBe("bank-cmbc");
    expect(boc.NAME).toBe("bank-boc");
    expect(bankcomm.NAME).toBe("bank-bankcomm");
    expect(icbc.NAME).toBe("bank-icbc");
    expect(new cmbc.CmbcBankAdapter().name).toBe("bank-cmbc");
    expect(new boc.BocBankAdapter().name).toBe("bank-boc");
    expect(new bankcomm.BankcommBankAdapter().name).toBe("bank-bankcomm");
    expect(new icbc.IcbcBankAdapter().name).toBe("bank-icbc");
    for (const adapter of [
      new cmbc.CmbcBankAdapter(),
      new boc.BocBankAdapter(),
      new bankcomm.BankcommBankAdapter(),
      new icbc.IcbcBankAdapter(),
    ]) {
      expect(adapter.watermarkStrategy).toBe("max-captured-at");
      expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    }
  });
  it("all gated high sensitivity + legalGate", () => {
    for (const A of [
      new cmbc.CmbcBankAdapter(),
      new boc.BocBankAdapter(),
      new bankcomm.BankcommBankAdapter(),
      new icbc.IcbcBankAdapter(),
    ]) {
      expect(A.dataDisclosure.sensitivity).toBe("high");
      expect(A.dataDisclosure.legalGate).toBe(true);
    }
  });
});

describe("CmbcBankAdapter (via _bank-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      {
        kind: "transaction",
        id: "tx-T1",
        txId: "T1",
        time: 1716383000,
        amount: -88.5,
        direction: "支出",
        counterparty: "全家",
        summary: "消费",
        balance: 1200,
      },
      {
        kind: "card",
        id: "card-C1",
        billId: "C1",
        billMonth: "2025-03",
        statementAmount: 3210,
        minPayment: 321,
        status: "已出账",
      },
    ],
  });

  it("transaction → PAYMENT event; card → OTHER event", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new cmbc.CmbcBankAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(2);
      const tx = a.normalize(items[0]);
      expect(tx.events[0].subtype).toBe("payment");
      expect(tx.events[0].content.title).toContain("支出");
      expect(tx.events[0].extra.amount).toBe(88.5);
      expect(tx.events[0].extra.direction).toBe("debit");
      expect(items[0].originalId).toBe("cmbc:transaction:T1");
      const card = a.normalize(items[1]);
      expect(card.events[0].subtype).toBe("other");
      expect(card.events[0].extra.billMonth).toBe("2025-03");
      expect(items[1].originalId).toBe("cmbc:card:C1");
      expect(items[1].capturedAt).toBe(Date.parse("2025-03-01T00:00:00Z"));
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: best-effort fetch + unverified + sign seam", async () => {
    let signed = 0;
    let watermarkComplete = false;
    const a = new cmbc.CmbcBankAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      transactionUrl: "https://captured.example/transactions",
      cardUrl: "https://captured.example/cards",
      signProvider: async () => {
        signed += 1;
        return "sig";
      },
      fetchFn: async ({ url, query }) => {
        if (query.page > 1) return { list: [] };
        if (url.includes("transactions"))
          return {
            list: [
              {
                txId: "T9",
                time: 1716383000,
                amount: 500,
                direction: "收入",
                summary: "工资",
              },
            ],
          };
        return {
          list: [{ billId: "C9", billMonth: "2025-02", statementAmount: 1000 }],
        };
      },
    });
    expect(await a.authenticate()).toMatchObject({
      ok: true,
      mode: "cookie",
      unverified: true,
    });
    const items = await collect(
      a.sync({
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.originalId).sort()).toEqual([
      "cmbc:card:C9",
      "cmbc:transaction:T9",
    ]);
    expect(signed).toBeGreaterThan(0);
    expect(watermarkComplete).toBe(true);
  });

  it("cookie-api: stops at the prior timestamp and defers a capped full page", async () => {
    let watermarkComplete = false;
    const older = new cmbc.CmbcBankAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      transactionUrl: "https://captured.example/transactions",
      cardUrl: "https://captured.example/cards",
      fetchFn: async () => ({
        list: [
          {
            txId: "OLD",
            time: 1716383000,
            amount: -1,
            direction: "debit",
          },
        ],
      }),
    });
    expect(
      await collect(
        older.sync({
          sinceWatermark: 1716383000001,
          include: { card: false },
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).toEqual([]);
    expect(watermarkComplete).toBe(true);

    watermarkComplete = false;
    const fullPage = new cmbc.CmbcBankAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      transactionUrl: "https://captured.example/transactions",
      cardUrl: "https://captured.example/cards",
      fetchFn: async () => ({
        list: Array.from({ length: 30 }, (_, index) => ({
          txId: `NEW-${index}`,
          time: 1716384000 + index,
          amount: -1,
          direction: "debit",
        })),
      }),
    });
    expect(
      await collect(
        fullPage.sync({
          maxPages: 1,
          include: { card: false },
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).toHaveLength(30);
    expect(watermarkComplete).toBe(false);
  });

  it("unverified live endpoints are rejected; no input throws", async () => {
    const a = new cmbc.CmbcBankAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toMatchObject({
      ok: false,
      reason: "EXPLICIT_ENDPOINT_REQUIRED",
    });
    await expect(collect(a.sync({}))).rejects.toThrow(
      /explicit transactionUrl/,
    );
    const b = new cmbc.CmbcBankAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
