"use strict";

import { describe, it, expect } from "vitest";

const {
  extractAmounts,
  extractDates,
  extractAccountTails,
  extractOrderNumbers,
  extractTrackingNumbers,
  detectVerificationCodes,
  selectPrimaryAmount,
  dateToMs,
  normalizeCurrency,
} = require("../../lib/adapters/email-imap/templates/utils");

const { extractBill } = require("../../lib/adapters/email-imap/templates/bill");
const { extractOrder } = require("../../lib/adapters/email-imap/templates/order");
const { extractTravel } = require("../../lib/adapters/email-imap/templates/travel");
const { extractGovernment } = require("../../lib/adapters/email-imap/templates/government");
const { extractRegister } = require("../../lib/adapters/email-imap/templates/register");
const { extractOther } = require("../../lib/adapters/email-imap/templates/other");
const {
  extractFields,
  CATEGORY_TO_EXTRACTOR,
} = require("../../lib/adapters/email-imap/templates");

const { EmailAdapter } = require("../../lib/adapters/email-imap/email-adapter");

// Helper email factory
const emailOf = (overrides = {}) => ({
  from: [{ name: "Sender", address: "sender@example.com" }],
  subject: "",
  textBody: "",
  htmlBody: "",
  attachments: [],
  headers: {},
  ...overrides,
});

// ─── utils.js ───────────────────────────────────────────────────────────

describe("templates/utils — extractAmounts", () => {
  it("recognizes ¥1,234.50 form", () => {
    const out = extractAmounts("应还金额 ¥1,234.50 元");
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].value).toBe(1234.5);
    expect(out[0].currency).toBe("CNY");
  });

  it("recognizes 99.00 元 trailing form", () => {
    const out = extractAmounts("总价 99.00 元");
    expect(out[0].value).toBe(99);
    expect(out[0].currency).toBe("CNY");
  });

  it("recognizes USD $100", () => {
    const out = extractAmounts("Total: USD 100.00");
    expect(out[0].currency).toBe("USD");
    expect(out[0].value).toBe(100);
  });

  it("tags out direction near 应还 keyword", () => {
    const out = extractAmounts("本期应还 ¥500 元");
    expect(out[0].direction).toBe("out");
  });

  it("tags in direction near 退款 keyword", () => {
    const out = extractAmounts("退款 ¥50.00 已到账");
    expect(out[0].direction).toBe("in");
  });

  it("returns [] for empty input", () => {
    expect(extractAmounts("")).toEqual([]);
    expect(extractAmounts(null)).toEqual([]);
  });

  it("ignores zero / negative-looking matches", () => {
    expect(extractAmounts("¥0")).toEqual([]);
  });
});

describe("templates/utils — extractDates", () => {
  it("parses YYYY-MM-DD", () => {
    const out = extractDates("到期: 2026-12-25");
    expect(out).toHaveLength(1);
    expect(out[0].date.getFullYear()).toBe(2026);
    expect(out[0].date.getMonth()).toBe(11);
    expect(out[0].date.getDate()).toBe(25);
    expect(out[0].hasYear).toBe(true);
  });

  it("parses YYYY年M月D日 (first hit has full year)", () => {
    const out = extractDates("最后还款日 2026年11月5日");
    expect(out.length).toBeGreaterThanOrEqual(1);
    // The full-year match is always first (sorted by source index)
    expect(out[0].hasYear).toBe(true);
    expect(out[0].date.getFullYear()).toBe(2026);
    expect(out[0].date.getMonth()).toBe(10);
    expect(out[0].date.getDate()).toBe(5);
  });

  it("year-less M月D日 fills current year", () => {
    const ref = new Date(2026, 5, 1).getTime(); // June 1
    const out = extractDates("活动日期: 7月15日", ref);
    expect(out).toHaveLength(1);
    expect(out[0].date.getFullYear()).toBe(2026);
    expect(out[0].hasYear).toBe(false);
  });

  it("returns [] for empty / invalid input", () => {
    expect(extractDates("")).toEqual([]);
    expect(extractDates(null)).toEqual([]);
    expect(extractDates("no dates here")).toEqual([]);
  });
});

describe("templates/utils — extractAccountTails", () => {
  it("recognizes 尾号 1234", () => {
    const out = extractAccountTails("信用卡 尾号 1234 本期账单");
    expect(out).toHaveLength(1);
    expect(out[0].last4).toBe("1234");
  });

  it("recognizes **** 5678", () => {
    const out = extractAccountTails("Card **** 5678");
    expect(out[0].last4).toBe("5678");
  });

  it("recognizes ending in 9999", () => {
    const out = extractAccountTails("Card ending in 9999 charged");
    expect(out[0].last4).toBe("9999");
  });

  it("returns [] for empty input", () => {
    expect(extractAccountTails("")).toEqual([]);
  });
});

describe("templates/utils — extractOrderNumbers", () => {
  it("recognizes 订单号: 12345678", () => {
    const out = extractOrderNumbers("订单号: 12345678 已发货");
    expect(out[0].orderNumber).toBe("12345678");
  });

  it("recognizes Order # ABC-1234", () => {
    const out = extractOrderNumbers("Order # ABC-1234 confirmed");
    expect(out[0].orderNumber).toBe("ABC-1234");
  });
});

describe("templates/utils — extractTrackingNumbers", () => {
  it("recognizes 快递单号: SF1234567", () => {
    const out = extractTrackingNumbers("快递单号: SF1234567 已揽收");
    expect(out[0].trackingNumber).toBe("SF1234567");
  });

  it("recognizes tracking number: YT9876543", () => {
    const out = extractTrackingNumbers("Tracking number: YT9876543");
    expect(out[0].trackingNumber).toBe("YT9876543");
  });
});

describe("templates/utils — detectVerificationCodes (REDACTED)", () => {
  it("counts occurrences without returning the code", () => {
    const r = detectVerificationCodes("您的验证码为 123456，5分钟内有效");
    expect(r.count).toBe(1);
    // CRITICAL — the code itself must NEVER be in the returned hit.
    expect(r.hits[0].raw).not.toMatch(/123456/);
    expect(r.hits[0].raw).toMatch(/\*+/);
  });

  it("recognizes OTP / 动态密码 / 安全码 too", () => {
    expect(detectVerificationCodes("OTP is 8888").count).toBe(1);
    expect(detectVerificationCodes("动态密码 9999").count).toBe(1);
  });

  it("returns 0 for non-verification text", () => {
    expect(detectVerificationCodes("纯营销邮件").count).toBe(0);
  });
});

describe("templates/utils — selectPrimaryAmount + dateToMs + normalizeCurrency", () => {
  it("selectPrimaryAmount picks directed over directionless", () => {
    const amounts = [
      { value: 100, currency: "CNY", raw: "100", index: 0 },
      { value: 50, currency: "CNY", raw: "50", direction: "out", index: 5 },
    ];
    const p = selectPrimaryAmount(amounts);
    expect(p.value).toBe(50);
    expect(p.direction).toBe("out");
  });

  it("dateToMs returns null for non-Date", () => {
    expect(dateToMs(null)).toBeNull();
    expect(dateToMs("2026-01-01")).toBeNull();
    expect(dateToMs(new Date(2026, 0, 1))).toBeGreaterThan(0);
  });

  it("normalizeCurrency maps Chinese markers", () => {
    expect(normalizeCurrency("¥")).toBe("CNY");
    expect(normalizeCurrency("元")).toBe("CNY");
    expect(normalizeCurrency("美元")).toBe("USD");
    expect(normalizeCurrency("$")).toBe("USD");
  });
});

// ─── bill.js ────────────────────────────────────────────────────────────

describe("extractBill — bank statement", () => {
  it("招行月结: pulls amount + dueDate + accountIdentifier + institution", async () => {
    const r = await extractBill(emailOf({
      from: [{ address: "ebank@cmbchina.com" }],
      subject: "招商银行信用卡 11 月对账单",
      textBody: "尊敬的客户：\n您的招商银行信用卡 尾号 1234 本期应还金额 ¥3,256.78 元，最后还款日 2026-12-05。",
    }));
    expect(r.template).toBe("bill");
    expect(r.fields.amount.value).toBe(3256.78);
    expect(r.fields.amount.currency).toBe("CNY");
    expect(r.fields.accountIdentifier).toBe("**** 1234");
    expect(r.fields.institution).toBe("招商银行");
    expect(r.fields.dueDate).toBeGreaterThan(0);
  });

  it("dueAmount extraction via 应还金额 keyword window", async () => {
    const r = await extractBill(emailOf({
      from: [{ address: "card@cmbchina.com" }],
      subject: "信用卡账单",
      textBody: "本期账单金额 ¥5,000，应还金额 ¥3,000。",
    }));
    expect(r.fields.dueAmount).toBeDefined();
    expect(r.fields.dueAmount.value).toBe(3000);
  });

  it("billingMonth heuristic from subject when no dates parsed", async () => {
    const r = await extractBill(emailOf({
      from: [{ address: "ebank@ccb.com.cn" }],
      subject: "建设银行 8 月对账单",
      textBody: "",
    }));
    expect(r.fields.billingMonth).toMatch(/-08$/);
  });

  it("graceful fallback: no amount → empty fields + warning", async () => {
    const r = await extractBill(emailOf({
      from: [{ address: "ebank@somebank.com" }],
      subject: "通知",
      textBody: "提醒：账单已生成，请登录查看。",
    }));
    expect(r.fields.amount).toBeUndefined();
    expect(r.warnings).toContain("no monetary amount detected");
  });

  it("returns confidence in [0,1]", async () => {
    const r = await extractBill(emailOf({
      from: [{ address: "x@icbc.com.cn" }],
      subject: "工商银行 12 月对账单",
      textBody: "应还金额 ¥800 元 尾号 5555 最后还款日 2026-12-25",
    }));
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

// ─── order.js ───────────────────────────────────────────────────────────

describe("extractOrder — e-commerce", () => {
  it("淘宝订单: extracts orderNumber + totalAmount + merchantPlatform", async () => {
    const r = await extractOrder(emailOf({
      from: [{ address: "notify@taobao.com" }],
      subject: "您的订单已发货",
      textBody: "订单号: 1234567890，共3件商品，总价 ¥299.00 元。已发货。",
    }));
    expect(r.template).toBe("order");
    expect(r.fields.orderNumber).toBe("1234567890");
    expect(r.fields.totalAmount.value).toBe(299);
    expect(r.fields.merchantPlatform).toBe("淘宝");
    expect(r.fields.itemCount).toBe(3);
    expect(r.fields.orderStatus).toBe("shipped");
  });

  it("京东订单: status=delivered when 签收 in body", async () => {
    const r = await extractOrder(emailOf({
      from: [{ address: "notice@jd.com" }],
      subject: "包裹已签收",
      textBody: "您的订单 JD-998877 已签收。快递单号: YT123456789",
    }));
    expect(r.fields.merchantPlatform).toBe("京东");
    expect(r.fields.orderStatus).toBe("delivered");
    expect(r.fields.trackingNumber).toBe("YT123456789");
  });

  it("recipient extraction from 收件人 keyword", async () => {
    const r = await extractOrder(emailOf({
      from: [{ address: "service@pinduoduo.com" }],
      subject: "订单",
      textBody: "订单号: PDD-1111\n收件人: 张三",
    }));
    expect(r.fields.recipient).toBe("张三");
  });

  it("graceful fallback: no orderNumber → warning", async () => {
    const r = await extractOrder(emailOf({
      from: [{ address: "x@taobao.com" }],
      subject: "营销邮件",
      textBody: "看看这些好物",
    }));
    expect(r.fields.orderNumber).toBeUndefined();
    expect(r.warnings).toContain("orderNumber not detected");
  });
});

// ─── travel.js ──────────────────────────────────────────────────────────

describe("extractTravel — flight / hotel / train", () => {
  it("flight: vehicleType=flight + carrier mapped from ctrip.com", async () => {
    const r = await extractTravel(emailOf({
      from: [{ address: "ticket@ctrip.com" }],
      subject: "您的航班预订确认",
      textBody: "航班号 CA1234，从 北京 → 上海，起飞时间 2026-06-15。",
    }));
    expect(r.template).toBe("travel");
    expect(r.fields.vehicleType).toBe("flight");
    expect(r.fields.carrier).toBe("携程");
    expect(r.fields.from).toBeDefined();
    expect(r.fields.to).toBeDefined();
  });

  it("train: 12306 carrier mapping + 高铁 vehicle keyword", async () => {
    const r = await extractTravel(emailOf({
      from: [{ address: "noreply@12306.cn" }],
      subject: "您的高铁车票",
      textBody: "车次 G123，北京 → 上海，发车时间 2026-07-01。",
    }));
    expect(r.fields.vehicleType).toBe("train");
    expect(r.fields.carrier).toBe("12306");
  });

  it("hotel: vehicleType=hotel + traveler detected", async () => {
    const r = await extractTravel(emailOf({
      from: [{ address: "reservations@hotel.example" }],
      subject: "酒店预订确认",
      textBody: "酒店入住 2026-05-20，退房 2026-05-22。入住人: 王五",
    }));
    expect(r.fields.vehicleType).toBe("hotel");
    expect(r.fields.traveler).toBe("王五");
  });
});

// ─── government.js ─────────────────────────────────────────────────────

describe("extractGovernment", () => {
  it("tax_declaration recognized", async () => {
    const r = await extractGovernment(emailOf({
      from: [{ name: "国家税务总局", address: "tax@tax.gov.cn" }],
      subject: "个税申报确认",
      textBody: "您的个税申报已完成。属期 2026-04。申报编号: T2026040000001",
    }));
    expect(r.template).toBe("government");
    expect(r.fields.documentType).toBe("tax_declaration");
    expect(r.fields.period).toBe("2026-04");
    expect(r.fields.agencyName).toBe("国家税务总局");
    expect(r.fields.referenceNumber).toBeDefined();
  });

  it("social_security recognized", async () => {
    const r = await extractGovernment(emailOf({
      from: [{ address: "noreply@sb.gov.cn" }],
      subject: "社保缴费提醒",
      textBody: "您的社保医疗保险已缴纳 ¥1,250.00",
    }));
    expect(r.fields.documentType).toBe("social_security");
    expect(r.fields.amount).toBeDefined();
  });

  it("documentType=other when no keyword matches + warning", async () => {
    const r = await extractGovernment(emailOf({
      from: [{ address: "x@somewhere.gov.cn" }],
      subject: "general notification",
      textBody: "no keywords here",
    }));
    expect(r.fields.documentType).toBe("other");
    expect(r.warnings).toContain("documentType could not be narrowed");
  });
});

// ─── register.js ────────────────────────────────────────────────────────

describe("extractRegister — verification code REDACTION", () => {
  it("2fa_code email: verificationCodePresent=true, code NEVER in fields", async () => {
    const r = await extractRegister(emailOf({
      from: [{ name: "GitHub", address: "noreply@github.com" }],
      subject: "Your verification code",
      textBody: "您的验证码为 654321，5分钟内有效。",
    }));
    expect(r.template).toBe("register");
    expect(r.fields.actionType).toBe("2fa_code");
    expect(r.fields.verificationCodePresent).toBe(true);
    // The literal code must NEVER appear in the returned fields.
    const serialized = JSON.stringify(r.fields);
    expect(serialized).not.toMatch(/654321/);
    expect(r.fields.serviceName).toBe("GitHub");
  });

  it("password_reset action recognized", async () => {
    const r = await extractRegister(emailOf({
      from: [{ name: "Apple ID", address: "noreply@apple.com" }],
      subject: "Reset your password",
      textBody: "Someone requested a password reset for your account.",
    }));
    expect(r.fields.actionType).toBe("password_reset");
  });

  it("register action recognized", async () => {
    const r = await extractRegister(emailOf({
      from: [{ name: "Service", address: "x@service.example" }],
      subject: "Welcome to Service",
      textBody: "Your account has been created. Welcome to Service!",
    }));
    expect(r.fields.actionType).toBe("register");
  });

  it("login_alert action", async () => {
    const r = await extractRegister(emailOf({
      from: [{ address: "alerts@bank.example" }],
      subject: "New sign-in alert",
      textBody: "新设备登录 from Beijing",
    }));
    expect(r.fields.actionType).toBe("login_alert");
  });

  it("no verification code → verificationCodePresent=false", async () => {
    const r = await extractRegister(emailOf({
      from: [{ address: "x@example.com" }],
      subject: "Welcome",
      textBody: "Welcome to our service.",
    }));
    expect(r.fields.verificationCodePresent).toBe(false);
  });
});

// ─── other.js ──────────────────────────────────────────────────────────

describe("extractOther — fallback", () => {
  it("no-LLM fallback: produces summary from first sentence", async () => {
    const r = await extractOther(emailOf({
      from: [{ name: "Newsletter", address: "news@example.com" }],
      subject: "Weekly update",
      textBody: "This week we are excited to announce a new feature. There's more!",
    }));
    expect(r.template).toBe("other");
    expect(r.fields.summary).toBeDefined();
    expect(r.fields.summary).toContain("This week");
  });

  it("with LLM: parses JSON {summary, topics}", async () => {
    const llm = {
      chat: async () => ({ text: '{"summary":"AI news roundup","topics":["ai","news"]}' }),
    };
    const r = await extractOther(emailOf({
      textBody: "Some long body content",
    }), { llm });
    expect(r.fields.summary).toBe("AI news roundup");
    expect(r.fields.topics).toEqual(["ai", "news"]);
  });

  it("LLM throws → falls back to deterministic summary + warning", async () => {
    const llm = { chat: async () => { throw new Error("LLM down"); } };
    const r = await extractOther(emailOf({
      textBody: "Plain body text.",
    }), { llm });
    expect(r.fields.summary).toBe("Plain body text");
    expect(r.warnings.some((w) => w.includes("LLM"))).toBe(true);
  });

  it("empty body → confidence 0 + no summary", async () => {
    const r = await extractOther(emailOf({ textBody: "" }));
    expect(r.fields.summary).toBeUndefined();
    expect(r.confidence).toBe(0);
  });
});

// ─── dispatcher (templates/index.js) ───────────────────────────────────

describe("extractFields dispatcher", () => {
  it("routes bill_bank → extractBill", async () => {
    const r = await extractFields(
      emailOf({ from: [{ address: "x@cmbchina.com" }], textBody: "应还 ¥100 元" }),
      { category: "bill_bank" },
    );
    expect(r.template).toBe("bill");
  });

  it("routes order → extractOrder", async () => {
    const r = await extractFields(
      emailOf({ from: [{ address: "x@taobao.com" }], textBody: "订单号: ABC123" }),
      { category: "order" },
    );
    expect(r.template).toBe("order");
  });

  it("routes travel → extractTravel", async () => {
    const r = await extractFields(
      emailOf({ from: [{ address: "x@ctrip.com" }], textBody: "航班 CA123" }),
      { category: "travel" },
    );
    expect(r.template).toBe("travel");
  });

  it("routes government → extractGovernment", async () => {
    const r = await extractFields(
      emailOf({ textBody: "完税证明" }),
      { category: "government" },
    );
    expect(r.template).toBe("government");
  });

  it("routes register → extractRegister", async () => {
    const r = await extractFields(
      emailOf({ textBody: "验证码 9999" }),
      { category: "register" },
    );
    expect(r.template).toBe("register");
  });

  it("routes notify + other + unknown → extractOther", async () => {
    expect((await extractFields(emailOf({ textBody: "X" }), { category: "notify" })).template).toBe("other");
    expect((await extractFields(emailOf({ textBody: "X" }), { category: "other" })).template).toBe("other");
    expect((await extractFields(emailOf({ textBody: "X" }), { category: "unknown" })).template).toBe("other");
    expect((await extractFields(emailOf({ textBody: "X" }), null)).template).toBe("other");
  });

  it("CATEGORY_TO_EXTRACTOR is frozen + covers 8 categories", () => {
    expect(Object.isFrozen(CATEGORY_TO_EXTRACTOR)).toBe(true);
    const keys = Object.keys(CATEGORY_TO_EXTRACTOR);
    expect(keys).toContain("bill_bank");
    expect(keys).toContain("bill_credit");
    expect(keys).toContain("order");
    expect(keys).toContain("travel");
    expect(keys).toContain("government");
    expect(keys).toContain("register");
    expect(keys).toContain("notify");
    expect(keys).toContain("other");
  });

  it("extractor throwing degrades gracefully", async () => {
    // Synthesize by passing a malformed email that crashes most code paths
    const r = await extractFields(null, { category: "bill_bank" });
    expect(r.template).toBe("other");
    expect(r.fields).toEqual({});
    expect(r.warnings[0]).toContain("email missing");
  });
});

// ─── EmailAdapter integration (Phase 5.4) ───────────────────────────────

function makeSession(envelopes) {
  return (_opts) => {
    let openMb = null;
    return {
      async connect() {},
      async openMailbox(name) {
        openMb = name;
        return { uidValidity: 1, uidNext: 9999, exists: envelopes.length };
      },
      async *fetchFullSince(sinceUid = 0) {
        for (const env of envelopes) {
          if (env.uid > sinceUid) yield { ...env, source: env.source || Buffer.alloc(0) };
        }
      },
      async close() {},
    };
  };
}

describe("EmailAdapter — Phase 5.4 extraction integration", () => {
  const env1 = (overrides) => ({
    uid: 1,
    internalDate: new Date("2026-05-01T10:00:00Z"),
    flags: ["\\Seen"],
    messageId: "<m1@x>",
    subject: "招商银行 11 月对账单",
    from: [{ name: "招商银行", address: "ebank@cmbchina.com" }],
    to: [{ address: "me@example.com" }],
    cc: [],
    date: new Date("2026-05-01T10:00:00Z"),
    size: 2048,
    source: Buffer.from("RAW", "utf8"),
    ...overrides,
  });

  it("capabilities advertise extract:6-templates", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeSession([]),
    });
    expect(a.capabilities).toContain("extract:6-templates");
  });

  it("sync attaches extraction.fields to payload for bill emails", async () => {
    const factory = makeSession([env1()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({
        textBody: "尾号 1234 应还金额 ¥3,000 元 最后还款日 2026-12-05",
        attachments: [],
      }),
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].payload.extraction).toBeDefined();
    expect(raws[0].payload.extraction.template).toBe("bill");
    expect(raws[0].payload.extraction.fields.amount.value).toBe(3000);
    expect(raws[0].payload.extraction.fields.accountIdentifier).toBe("**** 1234");
  });

  it("normalize copies extraction.fields into Event.extra.fields", async () => {
    const factory = makeSession([env1()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({ textBody: "应还 ¥500 元 尾号 9999", attachments: [] }),
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(batch.events).toHaveLength(1);
    const ev = batch.events[0];
    expect(ev.extra.fields).toBeDefined();
    expect(ev.extra.fields.amount.value).toBe(500);
    expect(ev.extra.extractionTemplate).toBe("bill");
    expect(ev.extra.extractionConfidence).toBeGreaterThan(0);
  });

  it("verification-code email REDACTS event.content.text", async () => {
    const verifEnv = env1({
      uid: 2,
      messageId: "<m2@x>",
      subject: "Your verification code",
      from: [{ name: "GitHub", address: "noreply@github.com" }],
    });
    const factory = makeSession([verifEnv]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({
        textBody: "您的验证码为 998877，5分钟内有效。",
        attachments: [],
      }),
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws[0].payload.extraction.template).toBe("register");
    expect(raws[0].payload.extraction.fields.verificationCodePresent).toBe(true);
    const batch = a.normalize(raws[0]);
    expect(batch.events[0].content.text).toBe("(redacted: verification code email)");
    // The literal code must NEVER survive into the normalized event.
    expect(JSON.stringify(batch.events[0])).not.toMatch(/998877/);
  });

  it("disableExtraction skips extractor entirely", async () => {
    const factory = makeSession([env1()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({ textBody: "应还 ¥500 元", attachments: [] }),
      disableExtraction: true,
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws[0].payload.extraction).toBeUndefined();
  });

  it("extractor throwing → degrades to template:other (sync still emits)", async () => {
    const factory = makeSession([env1()]);
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({ textBody: "X", attachments: [] }),
      extractor: async () => { throw new Error("boom"); },
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].payload.extraction.template).toBe("other");
    expect(raws[0].payload.extraction.confidence).toBe(0);
    expect(raws[0].payload.extraction.warnings[0]).toContain("boom");
  });

  it("version reflects 0.6.0 (Phase 5.7)", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeSession([]),
    });
    expect(a.version).toBe("0.7.0");
  });
});
