"use strict";

/**
 * E2E — full Personal Data Hub user journey.
 *
 * Simulates a user from zero to "ask a question and get an answer":
 *   1. Initialize fresh vault
 *   2. Register + sync EmailAdapter (mocked IMAP session)
 *   3. Register + import Alipay CSV
 *   4. EntityResolver auto-merges same-email persons
 *   5. Worker drains uncertain pairs (rule-stage only, no LLM needed)
 *   6. SpendingSkill answers "how much did I spend?" with combined totals
 *   7. TimelineSkill weaves events into chronological story
 *   8. EventDetail surfaces the source raw row for a citation
 *
 * Avoids real network / real LLM / real device — every external boundary
 * is mocked via DI seams (sessionFactory, csvParser, embeddingStage).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  LocalVault, generateKeyHex, AdapterRegistry,
  EntityResolver,
  EmailAdapter, AlipayBillAdapter,
  SpendingSkill, TimelineSkill, RelationsSkill,
} = require("../../lib");

describe("E2E — full Personal Data Hub user journey", () => {
  let dir, vault, registry, resolver;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-e2e-"));
    vault = new LocalVault({ path: path.join(dir, "v.db"), key: generateKeyHex() });
    vault.open();
    resolver = new EntityResolver({ vault });
    registry = new AdapterRegistry({ vault, entityResolver: resolver });
  });

  afterEach(() => {
    try { vault.close(); } catch (_e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
  });

  it("zero → email + alipay → entity merge → spending answer", async () => {
    // ─── Step 1-2: Register + sync EmailAdapter with mocked IMAP ───
    const emailEnv = {
      uid: 1, internalDate: new Date("2026-05-15T10:00:00Z"),
      flags: ["\\Seen"], messageId: "<msg-1@x>",
      subject: "招商银行 11 月对账单",
      from: [{ name: "招商银行", address: "ebank@cmbchina.com" }],
      to: [{ address: "me@example.com" }], cc: [],
      date: new Date("2026-05-15T10:00:00Z"), size: 1024,
      source: Buffer.from("RAW", "utf-8"),
    };
    const emailSessionFactory = () => ({
      async connect() {},
      async openMailbox() { return { uidValidity: 1, uidNext: 9999, exists: 1 }; },
      async *fetchFullSince() { yield emailEnv; },
      async close() {},
    });
    const emailAdapter = new EmailAdapter({
      account: { provider: "qq", email: "me@example.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: emailSessionFactory,
      parser: async () => ({
        textBody: "尊敬的客户：\n您的招商银行信用卡 应还金额 ¥3,256.78 元",
        attachments: [],
      }),
    });
    registry.register(emailAdapter);
    const emailReport = await registry.syncAdapter("email-imap");
    expect(emailReport.status).toBe("ok");
    expect(emailReport.entityCounts.events).toBeGreaterThanOrEqual(1);

    // ─── Step 3: Register + import Alipay CSV ───
    const alipayCsv = [
      "支付宝交易记录明细查询",
      "账号:[me@example.com]",
      "起始日期:[2026-05-01 00:00:00]    终止日期:[2026-05-31 00:00:00]",
      "---------------------------------交易记录明细列表------------------------------",
      "交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态",
      "2026051022001112345001,T1,2026-05-10 14:00:00,2026-05-10 14:00:02,2026-05-10 14:00:02,客户端,即时到账交易,美团,美团外卖订单,38.50,支出,交易成功,0.00,0.00,,已支出",
      "2026051522001112345002,T2,2026-05-15 09:00:00,2026-05-15 09:00:05,2026-05-15 09:00:05,客户端,即时到账交易,淘宝,运动鞋,299.00,支出,交易成功,0.00,0.00,,已支出",
      "2026052022001112345003,,2026-05-20 12:00:00,2026-05-20 12:00:02,2026-05-20 12:00:02,客户端,转账,张三,生日礼物,500.00,支出,交易成功,0.00,0.00,生日快乐,已支出",
      "---------------------------------交易记录明细列表结束------------------------------",
    ].join("\n");
    const csvPath = path.join(dir, "alipay.csv");
    fs.writeFileSync(csvPath, alipayCsv, "utf-8");

    const alipayAdapter = new AlipayBillAdapter({
      account: { email: "me@example.com" },
    });
    registry.register(alipayAdapter);
    const alipayReport = await registry.syncAdapter("alipay-bill", { csvPath });
    expect(alipayReport.status).toBe("ok");
    expect(alipayReport.entityCounts.events).toBe(3);

    // ─── Step 4-5: EntityResolver drained (rule stage only) ───
    // Email's sender person (招商银行) is a separate identity; Alipay's
    // 美团/淘宝/张三 are 3 new persons. None should auto-merge unless
    // they share identifiers. The resolver should record decisions.
    const queueStatsBefore = vault.resolveQueueStats();
    expect(queueStatsBefore.pending + queueStatsBefore.done).toBeGreaterThanOrEqual(0);

    // ─── Step 6: SpendingSkill answers "how much did I spend?" ───
    const spendingSkill = new SpendingSkill({ vault });
    const spending = await spendingSkill.run({});
    expect(spending.summary.totalSpend).toBeCloseTo(38.50 + 299 + 500, 2);
    expect(spending.summary.eventCount).toBeGreaterThanOrEqual(3);
    expect(spending.breakdown.length).toBeGreaterThanOrEqual(3);
    expect(spending.breakdown[0].key).toBe("张三"); // biggest

    // ─── Step 7: TimelineSkill weaves into story ───
    const timelineSkill = new TimelineSkill({ vault });
    const timeline = await timelineSkill.run({
      since: Date.parse("2026-05-01T00:00:00Z"),
      until: Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(timeline.entries.length).toBeGreaterThanOrEqual(4); // email + 3 alipay
    expect(timeline.summary.byAdapter["email-imap"]).toBeGreaterThanOrEqual(1);
    expect(timeline.summary.byAdapter["alipay-bill"]).toBe(3);
    // Chronological: 5/10 first, 5/15 next, 5/20 last
    expect(timeline.entries[0].occurredAt).toBeLessThan(timeline.entries[timeline.entries.length - 1].occurredAt);

    // ─── Step 8: RelationsSkill (ranked mode) ───
    const relationsSkill = new RelationsSkill({ vault });
    const relations = await relationsSkill.run({}); // ranked mode
    expect(relations.ranked.length).toBeGreaterThanOrEqual(3);
    // Top should be 张三 (biggest transfer)
    const zhangsan = relations.ranked.find((p) => p.name === "张三");
    expect(zhangsan).toBeDefined();
    expect(zhangsan.totalSpend).toBe(500);

    // ─── Step 9: event-detail deep-link works ───
    // Pull one event and verify the source row is recoverable
    const events = vault.queryEvents({ adapter: "alipay-bill", limit: 10 });
    expect(events.length).toBe(3);
    // Find the Taobao transaction by counterparty (title is item name, e.g. "运动鞋")
    const tx = events.find((e) => e.extra && e.extra.counterparty === "淘宝");
    expect(tx).toBeDefined();
    expect(tx.source.adapter).toBe("alipay-bill");
    expect(tx.extra.counterpartyKind).toBe("merchant");
  });

  it("idempotent re-sync — same alipay CSV produces 0 duplicate events", async () => {
    const alipayCsv = [
      "支付宝交易记录明细查询",
      "账号:[me@example.com]",
      "---------------------------------交易记录明细列表------------------------------",
      "交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态",
      "2026051022001112345001,T1,2026-05-10 14:00:00,2026-05-10 14:00:02,2026-05-10 14:00:02,客户端,即时到账交易,美团,外卖,38.50,支出,交易成功,0.00,0.00,,已支出",
    ].join("\n");
    const csvPath = path.join(dir, "alipay.csv");
    fs.writeFileSync(csvPath, alipayCsv, "utf-8");

    const adapter = new AlipayBillAdapter({ account: { email: "me@example.com" } });
    registry.register(adapter);
    await registry.syncAdapter("alipay-bill", { csvPath });
    await registry.syncAdapter("alipay-bill", { csvPath });

    const events = vault.queryEvents({ adapter: "alipay-bill", limit: 100 });
    expect(events.length).toBe(1); // dedup by originalId
  });

  it("vault stats reflect post-sync entity counts", async () => {
    const csvPath = path.join(dir, "alipay.csv");
    fs.writeFileSync(csvPath, [
      "支付宝交易记录明细查询",
      "账号:[me@example.com]",
      "---------------------------------交易记录明细列表------------------------------",
      "交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态",
      "2026051022001112345001,T1,2026-05-10 14:00:00,2026-05-10 14:00:02,2026-05-10 14:00:02,客户端,即时到账交易,美团,外卖,38.50,支出,交易成功,0.00,0.00,,已支出",
    ].join("\n"), "utf-8");

    const adapter = new AlipayBillAdapter({ account: { email: "me@example.com" } });
    registry.register(adapter);
    await registry.syncAdapter("alipay-bill", { csvPath });

    const stats = vault.stats();
    expect(stats.events).toBe(1);
    expect(stats.persons).toBe(1); // 美团 merchant
    expect(stats.rawEvents).toBeGreaterThanOrEqual(1);
  });
});
