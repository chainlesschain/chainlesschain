"use strict";

import { describe, it, expect } from "vitest";

const {
  AlipayBillAdapter,
  mapAlipayTypeToSubtype,
  parseAlipayDateTime,
} = require("../../lib/adapters/alipay-bill/alipay-bill-adapter");
const {
  parseAlipayCsv,
  parseAlipayCsvBuffer,
  decodeBuffer,
  splitCsvLine,
  FIELD_ORDER,
} = require("../../lib/adapters/alipay-bill/csv-parser");
const {
  classifyCounterparty,
  counterpartyToPersonId,
  normalizeCounterpartyName,
  KNOWN_MERCHANTS,
} = require("../../lib/adapters/alipay-bill/counterparty");
const { assertAdapter } = require("../../lib/adapter-spec");

// ─── CSV parser ─────────────────────────────────────────────────────────

describe("csv-parser — splitCsvLine", () => {
  it("simple comma-separated line", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("Alipay row with empty fields", () => {
    expect(splitCsvLine("2024,,,d")).toEqual(["2024", "", "", "d"]);
  });

  it("quoted field with comma inside", () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
  });

  it("doubled-quote escape", () => {
    expect(splitCsvLine('a,"b""c",d')).toEqual(["a", 'b"c', "d"]);
  });
});

describe("csv-parser — decodeBuffer", () => {
  it("UTF-8 with BOM strips BOM and matches Alipay header", () => {
    const text = "支付宝交易记录明细查询\n交易号,商家订单号";
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf-8")]);
    const r = decodeBuffer(buf);
    expect(r.encoding).toBe("utf-8");
    expect(r.text).toContain("支付宝交易记录");
  });

  it("UTF-8 without BOM still detects Alipay magic header", () => {
    const buf = Buffer.from("交易号,商家订单号", "utf-8");
    const r = decodeBuffer(buf);
    expect(r.encoding).toBe("utf-8");
  });

  it("falls back to GBK when text is not valid UTF-8", () => {
    // Use injected iconv stub to avoid pulling the dep
    const fakeBuf = Buffer.from([0x80, 0x81, 0x82]); // not valid Alipay-ish UTF-8
    const r = decodeBuffer(fakeBuf, {
      iconvImpl: (buf, enc) => `<gbk-decoded ${enc} ${buf.length}b>`,
    });
    expect(r.encoding).toBe("gbk");
    expect(r.text).toContain("gbk-decoded");
  });

  it("throws on non-Buffer input", () => {
    expect(() => decodeBuffer("not-a-buffer")).toThrow(/Buffer/);
  });
});

const SAMPLE_CSV = [
  "支付宝交易记录明细查询",
  "账号:[user@example.com]",
  "起始日期:[2024-04-01 00:00:00]    终止日期:[2024-05-01 00:00:00]",
  "---------------------------------交易记录明细列表------------------------------",
  "交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态",
  "2024040122001112345678,T20240401XXXX,2024-04-01 09:23:11,2024-04-01 09:23:13,2024-04-01 09:23:13,支付宝网站,即时到账交易,美团,美团外卖订单,38.50,支出,交易成功,0.00,0.00,,已支出",
  "2024040522001112345679,,2024-04-05 14:00:00,2024-04-05 14:00:02,2024-04-05 14:00:02,客户端,转账,张三,生日礼物,500.00,支出,交易成功,0.00,0.00,生日快乐,已支出",
  "2024041022001112345680,REFUND123,2024-04-10 10:00:00,2024-04-10 10:00:05,2024-04-10 10:00:05,支付宝网站,退款,淘宝,运动鞋退款,299.00,收入,退款成功,0.00,299.00,,已收入",
  "---------------------------------交易记录明细列表结束------------------------------",
  "导出时间:[2024-05-02 09:00:00]    用户姓名:[张三]",
].join("\n");

describe("csv-parser — parseAlipayCsv", () => {
  it("parses header metadata + 3 rows from a valid CSV", () => {
    const r = parseAlipayCsv(SAMPLE_CSV);
    expect(r.header.account).toBe("user@example.com");
    expect(r.header.startDate).toBe("2024-04-01 00:00:00");
    expect(r.header.endDate).toBe("2024-05-01 00:00:00");
    expect(r.rows).toHaveLength(3);
  });

  it("first row has all 16 fields populated correctly", () => {
    const r = parseAlipayCsv(SAMPLE_CSV);
    const row = r.rows[0];
    expect(row.txId).toBe("2024040122001112345678");
    expect(row.merchantOrderNumber).toBe("T20240401XXXX");
    expect(row.counterparty).toBe("美团");
    expect(row.itemName).toBe("美团外卖订单");
    expect(row.amount).toBe("38.50");
    expect(row.direction).toBe("支出");
    expect(row.status).toBe("交易成功");
    expect(row.fundStatus).toBe("已支出");
  });

  it("transfer row preserves note", () => {
    const r = parseAlipayCsv(SAMPLE_CSV);
    expect(r.rows[1].counterparty).toBe("张三");
    expect(r.rows[1].note).toBe("生日快乐");
  });

  it("refund row direction = 收入", () => {
    const r = parseAlipayCsv(SAMPLE_CSV);
    expect(r.rows[2].direction).toBe("收入");
    expect(r.rows[2].refundedAmount).toBe("299.00");
  });

  it("returns empty rows with warning when header missing", () => {
    const r = parseAlipayCsv("no header here\njust some text");
    expect(r.rows).toEqual([]);
    expect(r.warning).toContain("header row");
  });

  it("stops at the terminator marker", () => {
    const r = parseAlipayCsv(SAMPLE_CSV);
    // The "导出时间:[...]" trailer line is OUTSIDE the data list — must not be a row
    for (const row of r.rows) {
      expect(row.txId.startsWith("2024")).toBe(true);
    }
  });

  it("skips rows with too few commas", () => {
    const csv = SAMPLE_CSV.replace(
      "2024040522001112345679,,2024-04-05 14:00:00,2024-04-05 14:00:02,2024-04-05 14:00:02,客户端,转账,张三,生日礼物,500.00,支出,交易成功,0.00,0.00,生日快乐,已支出",
      "garbage,line,with,few,commas",
    );
    const r = parseAlipayCsv(csv);
    expect(r.rows).toHaveLength(2); // the original 3 minus the broken one
  });

  it("returns empty rows for empty input", () => {
    expect(parseAlipayCsv("")).toEqual({ header: {}, rows: [] });
    expect(parseAlipayCsv(null)).toEqual({ header: {}, rows: [] });
  });
});

describe("csv-parser — parseAlipayCsvBuffer", () => {
  it("decodes UTF-8 + parses end-to-end", () => {
    const buf = Buffer.from(SAMPLE_CSV, "utf-8");
    const r = parseAlipayCsvBuffer(buf);
    expect(r.encoding).toBe("utf-8");
    expect(r.rows).toHaveLength(3);
  });
});

// ─── counterparty classifier ────────────────────────────────────────────

describe("counterparty — classifyCounterparty", () => {
  it("recognizes well-known merchants (substring)", () => {
    expect(classifyCounterparty("美团")).toBe("merchant");
    expect(classifyCounterparty("美团外卖")).toBe("merchant");
    expect(classifyCounterparty("淘宝")).toBe("merchant");
    expect(classifyCounterparty("天猫超市")).toBe("merchant");
    expect(classifyCounterparty("12306")).toBe("merchant");
    expect(classifyCounterparty("星巴克咖啡")).toBe("merchant");
  });

  it("recognizes merchant suffix heuristic", () => {
    expect(classifyCounterparty("北京三联书店")).toBe("merchant");
    expect(classifyCounterparty("XX 科技有限公司")).toBe("merchant");
    expect(classifyCounterparty("华润万家超市")).toBe("merchant");
    expect(classifyCounterparty("普仁医院")).toBe("merchant");
    expect(classifyCounterparty("中通快递")).toBe("merchant");
  });

  it("classifies 2-4 char Chinese names as contact", () => {
    expect(classifyCounterparty("张三")).toBe("contact");
    expect(classifyCounterparty("李小明")).toBe("contact");
    expect(classifyCounterparty("欧阳娜娜")).toBe("contact");
  });

  it("strips contact-info brackets before classifying", () => {
    expect(classifyCounterparty("张三(186****1234)")).toBe("contact");
    expect(classifyCounterparty("王五（北京）")).toBe("contact");
  });

  it("returns unknown for anything that doesn't fit", () => {
    expect(classifyCounterparty("ABC123")).toBe("unknown");
    expect(classifyCounterparty("")).toBe("unknown");
    expect(classifyCounterparty(null)).toBe("unknown");
  });

  it("KNOWN_MERCHANTS includes >= 80 entries (broad coverage)", () => {
    expect(KNOWN_MERCHANTS.size).toBeGreaterThanOrEqual(80);
  });
});

describe("counterparty — counterpartyToPersonId", () => {
  it("returns same id for same name (idempotent)", () => {
    const a = counterpartyToPersonId("美团");
    const b = counterpartyToPersonId("美团");
    expect(a).toBe(b);
    expect(a.startsWith("person-alipay-")).toBe(true);
  });

  it("different names → different ids", () => {
    expect(counterpartyToPersonId("淘宝")).not.toBe(counterpartyToPersonId("京东"));
  });

  it("strips parens before slugifying", () => {
    const a = counterpartyToPersonId("张三(186****1234)");
    const b = counterpartyToPersonId("张三");
    expect(a).toBe(b);
  });
});

describe("normalizeCounterpartyName", () => {
  it("strips parens / asterisks", () => {
    expect(normalizeCounterpartyName("张三(186****1234)")).toBe("张三");
    expect(normalizeCounterpartyName("公司***北京")).toBe("公司北京");
  });
});

// ─── subtype mapping ───────────────────────────────────────────────────

describe("mapAlipayTypeToSubtype", () => {
  it("transfer / refund / investment keywords", () => {
    expect(mapAlipayTypeToSubtype("转账给好友", "支出")).toBe("transfer");
    expect(mapAlipayTypeToSubtype("退款", "收入")).toBe("refund");
    expect(mapAlipayTypeToSubtype("余额宝转入", "支出")).toBe("investment");
    expect(mapAlipayTypeToSubtype("理财申购", "支出")).toBe("investment");
    expect(mapAlipayTypeToSubtype("红包", "支出")).toBe("redenvelope");
    expect(mapAlipayTypeToSubtype("缴费", "支出")).toBe("utility");
    expect(mapAlipayTypeToSubtype("交易关闭", "支出")).toBe("cancelled");
  });

  it("default by direction", () => {
    expect(mapAlipayTypeToSubtype("即时到账交易", "支出")).toBe("payment");
    expect(mapAlipayTypeToSubtype("收款", "收入")).toBe("income");
  });
});

// ─── parseAlipayDateTime ────────────────────────────────────────────────

describe("parseAlipayDateTime", () => {
  it("parses 'YYYY-MM-DD HH:MM:SS' to ms epoch", () => {
    const ms = parseAlipayDateTime("2024-04-01 09:23:13");
    const d = new Date(ms);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(3); // April
    expect(d.getDate()).toBe(1);
  });

  it("returns null on bad input", () => {
    expect(parseAlipayDateTime("")).toBeNull();
    expect(parseAlipayDateTime(null)).toBeNull();
    expect(parseAlipayDateTime("garbage")).toBeNull();
  });
});

// ─── AlipayBillAdapter — contract + sync + normalize ───────────────────

describe("AlipayBillAdapter contract", () => {
  const a = new AlipayBillAdapter({
    account: { email: "u@example.com" },
  });

  it("conforms to PersonalDataAdapter spec", () => {
    const r = assertAdapter(a);
    expect(r.ok).toBe(true);
    if (!r.ok) console.log(r.errors);
  });

  it("name + version + capabilities + sensitivity", () => {
    expect(a.name).toBe("alipay-bill");
    expect(a.version).toBe("0.2.0");
    expect(a.extractMode).toBe("file-import");
    expect(a.capabilities).toContain("sync:file-import");
    expect(a.capabilities).toContain("import:csv-zip");
    expect(a.dataDisclosure.sensitivity).toBe("high");
  });

  it("readiness requires a user-selected export", async () => {
    const r = await a.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_INPUT");
  });

  it("healthCheck returns ok:true", async () => {
    const r = await a.healthCheck();
    expect(r.ok).toBe(true);
  });

  it("rejects missing account", () => {
    expect(() => new AlipayBillAdapter()).toThrow();
    expect(() => new AlipayBillAdapter({})).toThrow(/account/);
    expect(() => new AlipayBillAdapter({ account: {} })).toThrow(/email/);
  });
});

describe("AlipayBillAdapter.sync", () => {
  it("returns 0 events when no zipPath/csvPath given (idle)", async () => {
    const a = new AlipayBillAdapter({ account: { email: "u@example.com" } });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  it("yields one raw per row through the generic inputPath alias", async () => {
    // Write a temp CSV file
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tmp = path.join(os.tmpdir(), `alipay-test-${Date.now()}.csv`);
    fs.writeFileSync(tmp, SAMPLE_CSV, "utf-8");

    const events = [];
    const a = new AlipayBillAdapter({
      account: { email: "u@example.com" },
      // Use real parser; CSV is a valid Alipay export shape
    });
    const raws = [];
    expect((await a.authenticate({ inputPath: tmp })).ok).toBe(true);
    expect((await a.healthCheck({ inputPath: tmp })).ok).toBe(true);
    for await (const r of a.sync({
      inputPath: tmp,
      onProgress: (e) => events.push(e.phase),
    })) raws.push(r);

    expect(raws).toHaveLength(3);
    expect(raws[0].adapter).toBe("alipay-bill");
    expect(raws[0].originalId).toBe("2024040122001112345678");
    expect(events).toContain("opening");
    expect(events).toContain("parsing");
    expect(events).toContain("parsed");
    expect(events).toContain("done");
    expect(events.filter((p) => p === "row")).toHaveLength(3);

    fs.unlinkSync(tmp);
  });

  it("uses injected zipExtractor when zipPath provided", async () => {
    const events = [];
    const a = new AlipayBillAdapter({
      account: { email: "u@example.com" },
      zipPassword: "OPENME-mock",
      zipExtractor: async (zipPath, opts) => {
        events.push({ kind: "zip", zipPath, password: opts.password });
        return { buffer: Buffer.from(SAMPLE_CSV, "utf-8"), filename: "test.csv" };
      },
    });
    const raws = [];
    for await (const r of a.sync({ zipPath: "/fake/path.zip" })) raws.push(r);
    expect(raws).toHaveLength(3);
    expect(events[0].password).toBe("OPENME-mock");
  });
});

describe("AlipayBillAdapter.normalize", () => {
  const a = new AlipayBillAdapter({ account: { email: "u@example.com" } });

  it("payment event has correct subtype + amount.direction=out", () => {
    const raw = {
      adapter: "alipay-bill",
      originalId: "TX1",
      capturedAt: Date.now(),
      payload: {
        row: {
          txId: "TX1",
          merchantOrderNumber: "MO1",
          createdAt: "2024-04-01 10:00:00",
          paidAt: "2024-04-01 10:00:02",
          lastModifiedAt: "2024-04-01 10:00:02",
          sourceChannel: "支付宝网站",
          alipayType: "即时到账交易",
          counterparty: "美团",
          itemName: "美团外卖订单",
          amount: "38.50",
          direction: "支出",
          status: "交易成功",
          serviceFee: "0.00",
          refundedAmount: "0.00",
          note: "",
          fundStatus: "已支出",
        },
        accountEmail: "u@example.com",
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events).toHaveLength(1);
    const ev = batch.events[0];
    expect(ev.subtype).toBe("payment");
    expect(ev.content.amount.value).toBe(38.5);
    expect(ev.content.amount.direction).toBe("out");
    expect(ev.actor).toBe("person-self");
    expect(ev.source.adapter).toBe("alipay-bill");
    expect(ev.source.originalId).toBe("TX1");
    expect(ev.extra.merchantOrderNumber).toBe("MO1");
    expect(ev.extra.alipayType).toBe("即时到账交易");
    expect(ev.extra.counterpartyKind).toBe("merchant");
  });

  it("transfer creates contact person", () => {
    const raw = {
      adapter: "alipay-bill",
      originalId: "TX2",
      capturedAt: Date.now(),
      payload: {
        row: {
          txId: "TX2",
          merchantOrderNumber: "",
          createdAt: "2024-04-05 14:00:00",
          paidAt: "2024-04-05 14:00:02",
          lastModifiedAt: "2024-04-05 14:00:02",
          sourceChannel: "客户端",
          alipayType: "转账",
          counterparty: "张三",
          itemName: "生日礼物",
          amount: "500.00",
          direction: "支出",
          status: "交易成功",
          serviceFee: "0.00",
          refundedAmount: "0.00",
          note: "生日快乐",
          fundStatus: "已支出",
        },
        accountEmail: "u@example.com",
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].subtype).toBe("transfer");
    expect(batch.events[0].content.text).toBe("生日快乐");
    expect(batch.persons).toHaveLength(1);
    expect(batch.persons[0].subtype).toBe("contact");
    expect(batch.persons[0].names).toContain("张三");
  });

  it("refund flips direction to in", () => {
    const raw = {
      adapter: "alipay-bill",
      originalId: "TX3",
      capturedAt: Date.now(),
      payload: {
        row: {
          txId: "TX3", merchantOrderNumber: "REFUND123",
          createdAt: "2024-04-10 10:00:00", paidAt: "2024-04-10 10:00:05",
          lastModifiedAt: "2024-04-10 10:00:05",
          sourceChannel: "支付宝网站", alipayType: "退款",
          counterparty: "淘宝", itemName: "运动鞋退款", amount: "299.00",
          direction: "收入", status: "退款成功",
          serviceFee: "0.00", refundedAmount: "299.00",
          note: "", fundStatus: "已收入",
        },
        accountEmail: "u@example.com",
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].subtype).toBe("refund");
    expect(batch.events[0].content.amount.direction).toBe("in");
    expect(batch.events[0].extra.refundedAmount).toBe(299);
  });

  it("cancelled transactions get subtype=cancelled", () => {
    const raw = {
      adapter: "alipay-bill", originalId: "TX4",
      capturedAt: Date.now(),
      payload: {
        row: {
          txId: "TX4", merchantOrderNumber: "",
          createdAt: "2024-04-15 12:00:00", paidAt: "2024-04-15 12:00:00",
          lastModifiedAt: "2024-04-15 12:00:00",
          sourceChannel: "支付宝网站", alipayType: "即时到账交易",
          counterparty: "测试商家", itemName: "test", amount: "100.00",
          direction: "支出", status: "交易关闭",
          serviceFee: "0.00", refundedAmount: "0.00",
          note: "", fundStatus: "冻结",
        },
        accountEmail: "u@example.com",
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].subtype).toBe("cancelled");
  });

  it("unknown counterparty stamps needsResolve=true", () => {
    const raw = {
      adapter: "alipay-bill", originalId: "TX5",
      capturedAt: Date.now(),
      payload: {
        row: {
          txId: "TX5", merchantOrderNumber: "",
          createdAt: "2024-04-20 09:00:00", paidAt: "2024-04-20 09:00:00",
          lastModifiedAt: "2024-04-20 09:00:00",
          sourceChannel: "支付宝网站", alipayType: "即时到账交易",
          counterparty: "ABC123XYZ", itemName: "unclassifiable", amount: "10.00",
          direction: "支出", status: "交易成功",
          serviceFee: "0.00", refundedAmount: "0.00",
          note: "", fundStatus: "已支出",
        },
        accountEmail: "u@example.com",
      },
    };
    const batch = a.normalize(raw);
    expect(batch.events[0].extra.counterpartyKind).toBe("unknown");
    expect(batch.events[0].extra.needsResolve).toBe(true);
    expect(batch.persons[0].extra.needsResolve).toBe(true);
  });

  it("creates an Item when itemName is distinct from alipayType", () => {
    const raw = {
      adapter: "alipay-bill", originalId: "TX6",
      capturedAt: Date.now(),
      payload: {
        row: {
          txId: "TX6", merchantOrderNumber: "MO6",
          createdAt: "2024-04-25 09:00:00", paidAt: "2024-04-25 09:00:00",
          lastModifiedAt: "2024-04-25 09:00:00",
          sourceChannel: "支付宝网站", alipayType: "即时到账交易",
          counterparty: "京东", itemName: "iPhone 17 Pro 256GB", amount: "9999.00",
          direction: "支出", status: "交易成功",
          serviceFee: "0.00", refundedAmount: "0.00",
          note: "", fundStatus: "已支出",
        },
        accountEmail: "u@example.com",
      },
    };
    const batch = a.normalize(raw);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].name).toBe("iPhone 17 Pro 256GB");
    expect(batch.items[0].price.value).toBe(9999);
  });

  it("rejects missing raw.payload", () => {
    expect(() => a.normalize(null)).toThrow();
    expect(() => a.normalize({})).toThrow();
    expect(() => a.normalize({ payload: {} })).toThrow(/row/);
  });
});
