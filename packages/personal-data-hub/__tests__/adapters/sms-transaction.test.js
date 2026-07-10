"use strict";

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseTransactionSms,
} = require("../../lib/adapters/system-data-android/sms-transaction");

describe("parseTransactionSms — outbound (spending)", () => {
  it("extracts a debit-card 消费 amount + out direction + payment subtype", () => {
    const r = parseTransactionSms(
      "【工商银行】您尾号1234的储蓄卡3月5日消费人民币328.84元，余额1000.00元。",
    );
    expect(r).toEqual({
      amountYuan: 328.84,
      currency: "CNY",
      direction: "out",
      subtype: "payment",
      balanceYuan: 1000.0,
    });
  });

  it("reads 扣款 with a ￥ prefix marker", () => {
    const r = parseTransactionSms(
      "您好，您的账户已扣款￥59.90，用于自动续费。",
    );
    expect(r.amountYuan).toBe(59.9);
    expect(r.direction).toBe("out");
    expect(r.subtype).toBe("payment");
  });

  it("parses thousands-separated amounts", () => {
    const r = parseTransactionSms("信用卡消费12,345.67元，请及时还款。");
    expect(r.amountYuan).toBe(12345.67);
    expect(r.direction).toBe("out");
  });

  it("classifies 还款 as a payment", () => {
    const r = parseTransactionSms("您的信用卡还款2000元已成功。");
    expect(r.direction).toBe("out");
    expect(r.subtype).toBe("payment");
  });
});

describe("parseTransactionSms — inbound (income)", () => {
  it("extracts a 到账 amount + in direction + income subtype", () => {
    const r = parseTransactionSms(
      "【建设银行】您的账户于今日入账收入工资5,000.00元。",
    );
    expect(r.amountYuan).toBe(5000.0);
    expect(r.direction).toBe("in");
    expect(r.subtype).toBe("income");
  });

  it("classifies 退款 as refund with in direction", () => {
    const r = parseTransactionSms("您在某商城的订单已退款人民币￥88.00元。");
    expect(r.direction).toBe("in");
    expect(r.subtype).toBe("refund");
  });

  it("classifies 转入 as transfer", () => {
    const r = parseTransactionSms("您尾号5678账户转入100.00元，来自张三。");
    expect(r.direction).toBe("in");
    expect(r.subtype).toBe("transfer");
  });
});

describe("parseTransactionSms — rejects non-transactions (no false positives)", () => {
  it("returns null for a verification code SMS even with 元", () => {
    expect(
      parseTransactionSms("您的验证码是123456，充值100元有效，请勿泄露。"),
    ).toBeNull();
  });

  it("returns null for marketing '满X减' offers", () => {
    expect(
      parseTransactionSms("双十一大促！消费满199元减50元，优惠券速抢！"),
    ).toBeNull();
  });

  it("returns null for plain chat with a number", () => {
    expect(parseTransactionSms("晚上一起吃饭吗，大概8点")).toBeNull();
  });

  it("returns null when a transaction verb is present but no currency-anchored amount", () => {
    expect(parseTransactionSms("您的消费已受理，详情请查询账单。")).toBeNull();
  });

  it("returns null for a bare number without a currency anchor", () => {
    expect(parseTransactionSms("您已消费 500，感谢惠顾")).toBeNull();
  });

  it("returns null for empty / non-string input", () => {
    expect(parseTransactionSms("")).toBeNull();
    expect(parseTransactionSms(null)).toBeNull();
    expect(parseTransactionSms(undefined)).toBeNull();
  });
});

describe("parseTransactionSms — amount selection", () => {
  it("picks the transaction amount, not the trailing balance", () => {
    const r = parseTransactionSms("消费200.00元，账户余额8888.88元。");
    expect(r.amountYuan).toBe(200.0);
    expect(r.balanceYuan).toBe(8888.88);
  });

  it("defaults currency to CNY and switches to USD on 美元", () => {
    expect(parseTransactionSms("消费100元").currency).toBe("CNY");
    expect(parseTransactionSms("消费100美元").currency).toBe("USD");
  });

  it("resolves direction by nearest verb when both classes appear", () => {
    // 消费 sits next to the amount; 到账 is a distant unrelated clause.
    const r = parseTransactionSms("您消费320.00元。本月工资到账提醒请留意。");
    expect(r.direction).toBe("out");
  });
});
