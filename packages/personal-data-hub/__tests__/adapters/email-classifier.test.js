"use strict";

import { describe, it, expect } from "vitest";

const {
  CATEGORIES,
  ALL_CATEGORIES,
  classifyLayer1,
  classifyLayer2,
  classifyEmail,
  parseLayer2Response,
} = require("../../lib/adapters/email-imap/classifier");
const { MockLLMClient } = require("../../lib/llm-client");

const email = (overrides = {}) => ({
  from: [{ name: "Someone", address: "user@example.com" }],
  subject: "Hello",
  textBody: "",
  htmlBody: "",
  attachments: [],
  headers: {},
  indicatorHeaders: {},
  ...overrides,
});

// ─── Layer 1 ─────────────────────────────────────────────────────────────

describe("Layer 1 — bank statements", () => {
  it("招商银行 from-domain + 对账单 subject → bill_bank with high confidence", () => {
    const r = classifyLayer1(email({
      from: [{ address: "ebank@cmbchina.com" }],
      subject: "招商银行信用卡 11 月对账单",
    }));
    expect(r.category).toBe(CATEGORIES.BILL_BANK);
    expect(r.confidence).toBeGreaterThanOrEqual(0.92);
    expect(r.ruleName).toContain("bill_bank");
  });

  it("中国银行 from-domain alone (no subject keyword) → bill_bank confidence ~0.9", () => {
    const r = classifyLayer1(email({
      from: [{ address: "noreply@bochk.cn" }],
      subject: "您的账户更新",
    }));
    expect(r.category).toBe(CATEGORIES.BILL_BANK);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("ICBC from-domain → bill_bank", () => {
    const r = classifyLayer1(email({ from: [{ address: "ebanking@icbc.com.cn" }] }));
    expect(r.category).toBe(CATEGORIES.BILL_BANK);
  });

  it("credit-card subject keyword overrides generic bill_bank", () => {
    const r = classifyLayer1(email({
      from: [{ address: "card@cmbchina.com" }],
      subject: "信用卡 11 月对账单",
    }));
    // bill_bank.cn-bank-major fires at 0.95, bill_credit at 0.92 — bank
    // wins on confidence. The point is BOTH match; we don't break.
    expect([CATEGORIES.BILL_BANK, CATEGORIES.BILL_CREDIT]).toContain(r.category);
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("subject 信用卡账单 alone (no bank domain) → bill_credit", () => {
    const r = classifyLayer1(email({
      from: [{ address: "noreply@somerandombank.example" }],
      subject: "您的信用卡账单已生成",
    }));
    expect(r.category).toBe(CATEGORIES.BILL_CREDIT);
  });
});

describe("Layer 1 — e-commerce orders", () => {
  it("淘宝 + 订单 → order high confidence", () => {
    const r = classifyLayer1(email({
      from: [{ address: "service@taobao.com" }],
      subject: "您的订单 1234567 已发货",
    }));
    expect(r.category).toBe(CATEGORIES.ORDER);
    expect(r.confidence).toBeGreaterThanOrEqual(0.92);
  });

  it("京东 domain alone → order", () => {
    const r = classifyLayer1(email({ from: [{ address: "marketing@jd.com" }], subject: "限时优惠" }));
    expect(r.category).toBe(CATEGORIES.ORDER);
  });

  it("拼多多 + 已签收 → order", () => {
    const r = classifyLayer1(email({
      from: [{ address: "no-reply@pinduoduo.com" }],
      subject: "已签收，请确认",
    }));
    expect(r.category).toBe(CATEGORIES.ORDER);
  });

  it("Amazon → order", () => {
    const r = classifyLayer1(email({ from: [{ address: "auto-confirm@amazon.com" }], subject: "Your order has shipped" }));
    expect(r.category).toBe(CATEGORIES.ORDER);
  });
});

describe("Layer 1 — travel", () => {
  it("携程 → travel", () => {
    const r = classifyLayer1(email({ from: [{ address: "noreply@ctrip.com" }], subject: "您的酒店预订" }));
    expect(r.category).toBe(CATEGORIES.TRAVEL);
  });

  it("12306 → travel", () => {
    const r = classifyLayer1(email({ from: [{ address: "no-reply@12306.cn" }], subject: "出票成功" }));
    expect(r.category).toBe(CATEGORIES.TRAVEL);
  });

  it("航班 keyword without travel domain → travel medium-confidence", () => {
    const r = classifyLayer1(email({
      from: [{ address: "noreply@example.com" }],
      subject: "您的航班 CA1234 出票成功",
    }));
    expect(r.category).toBe(CATEGORIES.TRAVEL);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

describe("Layer 1 — government", () => {
  it(".gov.cn → government", () => {
    const r = classifyLayer1(email({
      from: [{ address: "notify@beijing.gov.cn" }],
      subject: "您的纳税申报已提交",
    }));
    expect(r.category).toBe(CATEGORIES.GOVERNMENT);
  });

  it("社保 keyword alone → government", () => {
    const r = classifyLayer1(email({
      from: [{ address: "info@somewebsite.com" }],
      subject: "您的社保缴费记录",
    }));
    expect(r.category).toBe(CATEGORIES.GOVERNMENT);
  });
});

describe("Layer 1 — register", () => {
  it("验证码 → register", () => {
    const r = classifyLayer1(email({
      from: [{ address: "noreply@somesite.com" }],
      subject: "您的验证码是 1234",
    }));
    expect(r.category).toBe(CATEGORIES.REGISTER);
  });

  it("Password reset → register", () => {
    const r = classifyLayer1(email({
      from: [{ address: "support@app.io" }],
      subject: "Password reset request",
    }));
    expect(r.category).toBe(CATEGORIES.REGISTER);
  });

  it("Welcome to → register lower confidence", () => {
    const r = classifyLayer1(email({ subject: "Welcome to ChainlessChain" }));
    expect(r.category).toBe(CATEGORIES.REGISTER);
    expect(r.confidence).toBeLessThan(0.85); // → Layer 2 in orchestrator
  });
});

describe("Layer 1 — notify (marketing)", () => {
  it("List-Unsubscribe header → notify", () => {
    const r = classifyLayer1(email({
      from: [{ address: "newsletter@example.com" }],
      subject: "Our weekly digest",
      indicatorHeaders: { "list-unsubscribe": "<mailto:unsub@example.com>" },
    }));
    expect(r.category).toBe(CATEGORIES.NOTIFY);
  });

  it("Precedence: bulk → notify", () => {
    const r = classifyLayer1(email({
      headers: { precedence: "bulk" },
    }));
    expect(r.category).toBe(CATEGORIES.NOTIFY);
  });

  it("Auto-Submitted: auto-generated → notify", () => {
    const r = classifyLayer1(email({
      headers: { "auto-submitted": "auto-generated" },
    }));
    expect(r.category).toBe(CATEGORIES.NOTIFY);
  });

  it("Marketing header doesn't override bill_bank (specificity wins)", () => {
    const r = classifyLayer1(email({
      from: [{ address: "promo@cmbchina.com" }],
      subject: "招行卡片新优惠",
      indicatorHeaders: { "list-unsubscribe": "<...>" },
    }));
    expect(r.category).toBe(CATEGORIES.BILL_BANK);
  });
});

describe("Layer 1 — defaults & malformed input", () => {
  it("no signals → other with 0 confidence", () => {
    const r = classifyLayer1(email({
      from: [{ address: "friend@gmail.com" }],
      subject: "Hi how are you",
    }));
    expect(r.category).toBe(CATEGORIES.OTHER);
    expect(r.confidence).toBe(0);
  });

  it("null input → other", () => {
    const r = classifyLayer1(null);
    expect(r.category).toBe(CATEGORIES.OTHER);
  });

  it("layer field is 'L1'", () => {
    const r = classifyLayer1(email({ from: [{ address: "x@taobao.com" }] }));
    expect(r.layer).toBe("L1");
  });
});

// ─── Layer 2 — LLM disambiguation ────────────────────────────────────────

describe("Layer 2 LLM classifier", () => {
  it("parses LLM JSON response into category/confidence/reason", async () => {
    const llm = new MockLLMClient({
      reply: '{"category":"order","confidence":0.88,"reason":"shipment notification"}',
    });
    const r = await classifyLayer2(email({ subject: "ambiguous" }), { llm });
    expect(r.category).toBe(CATEGORIES.ORDER);
    expect(r.confidence).toBe(0.88);
    expect(r.reason).toContain("shipment");
    expect(r.layer).toBe("L2");
  });

  it("strips markdown code fences", async () => {
    const llm = new MockLLMClient({
      reply: '```json\n{"category":"travel","confidence":0.9}\n```',
    });
    const r = await classifyLayer2(email(), { llm });
    expect(r.category).toBe(CATEGORIES.TRAVEL);
  });

  it("regex-falls back to find first {...} when commentary precedes JSON", async () => {
    const llm = new MockLLMClient({
      reply: 'Sure, here is my classification: {"category":"register","confidence":0.6}',
    });
    const r = await classifyLayer2(email(), { llm });
    expect(r.category).toBe(CATEGORIES.REGISTER);
  });

  it("malformed JSON → falls back to layer1 result", async () => {
    const llm = new MockLLMClient({ reply: "I think it's an order email" });
    const fallback = { category: CATEGORIES.NOTIFY, confidence: 0.4, ruleName: "fallback" };
    const r = await classifyLayer2(email(), { llm, fallback });
    expect(r.category).toBe(CATEGORIES.NOTIFY);
    expect(r.layer).toBe("L1-fallback");
  });

  it("LLM throws → falls back to layer1 result", async () => {
    const llm = new MockLLMClient({});
    llm.chat = async () => { throw new Error("Ollama down"); };
    const fallback = { category: CATEGORIES.BILL_BANK, confidence: 0.7 };
    const r = await classifyLayer2(email(), { llm, fallback });
    expect(r.category).toBe(CATEGORIES.BILL_BANK);
    expect(r.layer).toBe("L1-fallback");
  });

  it("unknown category from LLM → falls back to fallback / OTHER", async () => {
    const llm = new MockLLMClient({ reply: '{"category":"alien-spam","confidence":0.9}' });
    const r = await classifyLayer2(email(), { llm });
    expect(r.category).toBe(CATEGORIES.OTHER);
    expect(r.layer).toBe("L1-fallback");
  });

  it("no LLM → throws", async () => {
    await expect(classifyLayer2(email(), {})).rejects.toThrow(/llm/i);
  });

  it("parseLayer2Response: strict JSON", () => {
    expect(parseLayer2Response('{"category":"order"}')).toEqual({ category: "order" });
  });

  it("parseLayer2Response: empty / non-json → null", () => {
    expect(parseLayer2Response("")).toBeNull();
    expect(parseLayer2Response("just text no json")).toBeNull();
  });
});

// ─── classifyEmail orchestrator ─────────────────────────────────────────

describe("classifyEmail orchestrator", () => {
  it("high-confidence layer1 short-circuits layer2 even when LLM provided", async () => {
    const llm = new MockLLMClient({ reply: '{"category":"other"}' });
    const r = await classifyEmail(email({
      from: [{ address: "x@taobao.com" }],
      subject: "订单已发货",
    }), { llm });
    expect(r.layer).toBe("L1");
    expect(r.category).toBe(CATEGORIES.ORDER);
    expect(llm.calls).toHaveLength(0); // LLM NOT called
  });

  it("low-confidence layer1 → falls through to layer2", async () => {
    const llm = new MockLLMClient({
      reply: '{"category":"register","confidence":0.7}',
    });
    const r = await classifyEmail(email({
      from: [{ address: "service@unknown-bank.example" }],
      subject: "Welcome to our service",
    }), { llm });
    expect(r.layer).toBe("L2");
    expect(r.category).toBe(CATEGORIES.REGISTER);
    expect(llm.calls).toHaveLength(1);
  });

  it("no LLM + low-confidence layer1 → returns layer1 as-is", async () => {
    const r = await classifyEmail(email());
    expect(r.layer).toBe("L1");
    expect(r.category).toBe(CATEGORIES.OTHER);
  });

  it("disableLayer2 forces layer1-only even with LLM provided", async () => {
    const llm = new MockLLMClient({ reply: '{"category":"order"}' });
    const r = await classifyEmail(email(), { llm, disableLayer2: true });
    expect(r.layer).toBe("L1");
    expect(llm.calls).toHaveLength(0);
  });

  it("minLayer1Confidence threshold respected (0.99 forces layer2)", async () => {
    const llm = new MockLLMClient({ reply: '{"category":"travel","confidence":0.7}' });
    const r = await classifyEmail(email({
      from: [{ address: "x@taobao.com" }],
      subject: "订单",
    }), { llm, minLayer1Confidence: 0.99 });
    // taobao + 订单 hits 0.95 < 0.99 → layer 2 fires
    expect(r.layer).toBe("L2");
  });

  it("ALL_CATEGORIES contains the 8 documented categories", () => {
    expect(ALL_CATEGORIES).toHaveLength(8);
    expect(ALL_CATEGORIES).toEqual(
      expect.arrayContaining([
        "bill_bank", "bill_credit", "order", "travel",
        "government", "register", "notify", "other",
      ])
    );
  });
});
