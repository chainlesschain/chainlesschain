"use strict";

import { describe, it, expect } from "vitest";

const {
  AIChatHistoryAdapter,
  CookieAuthSession,
  NotImplementedYetError,
  assertVendorSpec,
  SUPPORTED_VENDORS,
  DEFAULT_VENDOR_SPECS,
  schemaMap,
} = require("../../lib/adapters/ai-chat-history");
const { assertAdapter } = require("../../lib/adapter-spec");
const {
  EVENT_SUBTYPES,
  PERSON_SUBTYPES,
  ITEM_SUBTYPES,
} = require("../../lib/constants");

// ─── vendor-spec assertion ──────────────────────────────────────────────

describe("assertVendorSpec — SUPPORTED_VENDORS", () => {
  it("8 vendors are declared", () => {
    expect(SUPPORTED_VENDORS).toEqual([
      "deepseek",
      "kimi",
      "tongyi",
      "zhipu",
      "hunyuan",
      "qianfan",
      "coze",
      "dreamina",
    ]);
  });

  it("DEFAULT_VENDOR_SPECS includes one entry per supported vendor", () => {
    for (const v of SUPPORTED_VENDORS) {
      expect(DEFAULT_VENDOR_SPECS[v]).toBeDefined();
      expect(DEFAULT_VENDOR_SPECS[v].name).toBe(v);
    }
  });

  it("each shipped vendor spec passes assertVendorSpec", () => {
    for (const v of SUPPORTED_VENDORS) {
      const check = assertVendorSpec(DEFAULT_VENDOR_SPECS[v]);
      if (!check.ok) {
        throw new Error(`vendor ${v} failed: ${check.errors.join("; ")}`);
      }
      expect(check.ok).toBe(true);
    }
  });

  it("rejects spec missing rateLimits.perMinute", () => {
    const bad = { ...DEFAULT_VENDOR_SPECS.deepseek, rateLimits: {} };
    const check = assertVendorSpec(bad);
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.includes("rateLimits"))).toBe(true);
  });

  it("rejects spec with non-https loginUrl", () => {
    const bad = { ...DEFAULT_VENDOR_SPECS.deepseek, loginUrl: "http://chat.deepseek.com/" };
    const check = assertVendorSpec(bad);
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.includes("loginUrl"))).toBe(true);
  });

  it("rejects unsupported vendor name", () => {
    const bad = { ...DEFAULT_VENDOR_SPECS.deepseek, name: "claude" };
    const check = assertVendorSpec(bad);
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.includes("name"))).toBe(true);
  });
});

// ─── PersonalDataAdapter contract ────────────────────────────────────────

describe("AIChatHistoryAdapter contract", () => {
  it("freshly constructed adapter passes assertAdapter", () => {
    const a = new AIChatHistoryAdapter();
    const r = assertAdapter(a);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.ok).toBe(true);
  });

  it("declares name + version + capabilities + extractMode", () => {
    const a = new AIChatHistoryAdapter();
    expect(a.name).toBe("ai-chat-history");
    expect(a.version).toMatch(/^0\.1\.\d+$/);
    expect(a.capabilities).toContain("sync:cookie-multi-vendor");
    expect(a.extractMode).toBe("web-api");
  });

  it("dataDisclosure is high-sensitivity without legalGate (cookies, not third-party content)", () => {
    const a = new AIChatHistoryAdapter();
    expect(a.dataDisclosure.sensitivity).toBe("high");
    expect(a.dataDisclosure.legalGate).toBe(false);
  });

  it("constructor rejects invalid vendor spec override", () => {
    expect(
      () =>
        new AIChatHistoryAdapter({
          vendorSpecs: { deepseek: { ...DEFAULT_VENDOR_SPECS.deepseek, rateLimits: {} } },
        }),
    ).toThrow(/rateLimits/);
  });
});

// ─── authenticate / healthCheck ──────────────────────────────────────────

describe("AIChatHistoryAdapter.authenticate", () => {
  it("returns vendorsReady=[] when no sessions configured", async () => {
    const a = new AIChatHistoryAdapter();
    const r = await a.authenticate();
    expect(r.ok).toBe(true);
    expect(r.vendorsReady).toEqual([]);
    expect(r.vendorsNeedingLogin.sort()).toEqual([...SUPPORTED_VENDORS].sort());
  });

  it("reflects configured sessions", async () => {
    const a = new AIChatHistoryAdapter();
    a.setSession("deepseek", new CookieAuthSession({ vendor: "deepseek", cookies: [{ name: "userToken", value: "x" }] }));
    a.setSession("kimi", new CookieAuthSession({ vendor: "kimi", cookies: [{ name: "sess", value: "y" }] }));
    const r = await a.authenticate();
    expect(r.vendorsReady.sort()).toEqual(["deepseek", "kimi"]);
    expect(r.vendorsNeedingLogin).not.toContain("deepseek");
    expect(r.vendorsNeedingLogin).not.toContain("kimi");
  });
});

describe("AIChatHistoryAdapter.healthCheck", () => {
  it("reports per-vendor no-session when fresh", async () => {
    const a = new AIChatHistoryAdapter();
    const h = await a.healthCheck();
    expect(h.ok).toBe(true);
    for (const v of SUPPORTED_VENDORS) {
      expect(h.perVendor[v]).toEqual({ ok: false, reason: "no-session" });
    }
  });

  it("calls vendor.validateCookie when session present", async () => {
    const a = new AIChatHistoryAdapter({
      vendorSpecs: {
        deepseek: {
          ...DEFAULT_VENDOR_SPECS.deepseek,
          validateCookie: async () => ({ ok: true, expiresAt: 999 }),
        },
      },
    });
    a.setSession("deepseek", new CookieAuthSession({ vendor: "deepseek", cookies: [{ name: "x", value: "1" }] }));
    const h = await a.healthCheck();
    expect(h.perVendor.deepseek).toEqual({ ok: true, expiresAt: 999 });
  });
});

// ─── sync — Phase 10.1 stub path ─────────────────────────────────────────

describe("AIChatHistoryAdapter.sync — skeleton path", () => {
  it("yields nothing when no sessions configured", async () => {
    const a = new AIChatHistoryAdapter();
    const out = [];
    for await (const ev of a.sync()) out.push(ev);
    expect(out).toEqual([]);
  });

  it("emits vendor-not-wired sentinel when stub vendor invoked", async () => {
    // tongyi/zhipu/hunyuan/qianfan/coze/dreamina remain skeleton in Phase 10.2.
    // deepseek + kimi are now wired with real h5 API — use a stub vendor here.
    const a = new AIChatHistoryAdapter();
    a.setSession(
      "tongyi",
      new CookieAuthSession({ vendor: "tongyi", cookies: [{ name: "sess", value: "x" }] }),
    );
    const out = [];
    for await (const ev of a.sync({ vendors: ["tongyi"] })) out.push(ev);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("vendor-not-wired");
    expect(out[0].vendor).toBe("tongyi");
    expect(out[0].error).toBe("VENDOR_NOT_WIRED");
  });

  it("can be driven end-to-end with a mock vendor spec", async () => {
    // Inject a faux vendor that yields one conversation + two messages.
    const FAKE_CONV = {
      vendor: "deepseek",
      originalId: "conv-1",
      title: "test title",
      modelName: "deepseek-r1",
      createdAt: Date.parse("2026-05-19T00:00:00Z"),
      updatedAt: Date.parse("2026-05-19T01:00:00Z"),
      messageCount: 2,
    };
    const FAKE_MSGS = [
      {
        vendor: "deepseek",
        originalId: "m1",
        conversationId: "conv-1",
        role: "user",
        content: { text: "hello" },
        createdAt: Date.parse("2026-05-19T00:00:00Z"),
      },
      {
        vendor: "deepseek",
        originalId: "m2",
        conversationId: "conv-1",
        role: "assistant",
        content: { text: "hi there" },
        createdAt: Date.parse("2026-05-19T00:00:05Z"),
        modelName: "deepseek-r1",
      },
    ];
    const a = new AIChatHistoryAdapter({
      vendorSpecs: {
        deepseek: {
          ...DEFAULT_VENDOR_SPECS.deepseek,
          async validateCookie() { return { ok: true }; },
          async *listConversations() { yield FAKE_CONV; },
          async *listMessages() { for (const m of FAKE_MSGS) yield m; },
        },
      },
    });
    a.setSession(
      "deepseek",
      new CookieAuthSession({ vendor: "deepseek", cookies: [{ name: "userToken", value: "x" }] }),
    );

    const out = [];
    for await (const ev of a.sync({ vendors: ["deepseek"] })) out.push(ev);
    expect(out.length).toBe(3); // 1 conv + 2 msgs
    expect(out[0].kind).toBe("conversation");
    expect(out[1].kind).toBe("message");
    expect(out[2].kind).toBe("message");

    // Drive normalize() over each
    const batches = out.map((r) => a.normalize(r));
    // First batch: conv → topic + vendor person
    expect(batches[0].topics.length).toBe(1);
    expect(batches[0].persons.length).toBe(1);
    expect(batches[0].persons[0].subtype).toBe(PERSON_SUBTYPES.AI_AGENT);
    expect(batches[0].events.length).toBe(0);
    // Message batches: 1 event each
    expect(batches[1].events.length).toBe(1);
    expect(batches[1].events[0].subtype).toBe(EVENT_SUBTYPES.AI_MESSAGE);
    expect(batches[1].events[0].actor).toBe("person-self");
    expect(batches[2].events[0].actor).toBe("person-ai-deepseek");
  });
});

// ─── schema-map — deterministic transforms ───────────────────────────────

describe("schema-map.conversationToBatch", () => {
  it("produces vendor Person + Topic + Event per message", () => {
    const conv = {
      vendor: "kimi",
      originalId: "abc",
      title: "research notes",
      createdAt: 1700000000000,
      updatedAt: 1700001000000,
    };
    const msgs = [
      { vendor: "kimi", originalId: "m1", conversationId: "abc", role: "user",
        content: { text: "summarize this paper" }, createdAt: 1700000000000 },
      { vendor: "kimi", originalId: "m2", conversationId: "abc", role: "assistant",
        content: { text: "ok here is the summary..." }, createdAt: 1700000010000 },
    ];
    const batch = schemaMap.conversationToBatch(conv, msgs, { displayName: "Kimi" });
    expect(batch.events.length).toBe(2);
    expect(batch.events[0].subtype).toBe(EVENT_SUBTYPES.AI_MESSAGE);
    expect(batch.events[0].topics).toEqual(["topic-aiconv-kimi-abc"]);
    expect(batch.events[1].actor).toBe("person-ai-kimi");
    expect(batch.persons.length).toBe(1);
    expect(batch.persons[0].id).toBe("person-ai-kimi");
    expect(batch.persons[0].names).toEqual(["Kimi"]);
    expect(batch.topics.length).toBe(1);
    expect(batch.topics[0].id).toBe("topic-aiconv-kimi-abc");
    expect(batch.topics[0].extra.modelName).toBeUndefined(); // not in this conv
  });

  it("upgrades to ai-image-generation subtype when generatedImages present", () => {
    const conv = { vendor: "dreamina", originalId: "img-1", createdAt: 1, updatedAt: 1 };
    const msgs = [
      {
        vendor: "dreamina",
        originalId: "m1",
        conversationId: "img-1",
        role: "assistant",
        content: {
          generatedImages: [{ url: "https://cdn/x.png", prompt: "a cat" }],
        },
        createdAt: 1700000000000,
      },
    ];
    const batch = schemaMap.conversationToBatch(conv, msgs, { displayName: "Dreamina" });
    expect(batch.events[0].subtype).toBe(EVENT_SUBTYPES.AI_IMAGE_GENERATION);
    expect(batch.items.length).toBe(1);
    expect(batch.items[0].subtype).toBe(ITEM_SUBTYPES.MEDIA);
    expect(batch.items[0].extra.prompt).toBe("a cat");
  });

  it("throws when message vendor mismatches conversation vendor", () => {
    const conv = { vendor: "kimi", originalId: "a", createdAt: 1, updatedAt: 1 };
    const msgs = [{ vendor: "deepseek", originalId: "m", conversationId: "a", role: "user", content: {}, createdAt: 1 }];
    expect(() => schemaMap.conversationToBatch(conv, msgs)).toThrow(/vendor/);
  });
});

describe("schema-map.mergeBatches", () => {
  it("dedupes vendor Person by id", () => {
    const conv1 = { vendor: "kimi", originalId: "a", createdAt: 1, updatedAt: 1 };
    const conv2 = { vendor: "kimi", originalId: "b", createdAt: 1, updatedAt: 1 };
    const b1 = schemaMap.conversationToBatch(conv1, [], { displayName: "Kimi" });
    const b2 = schemaMap.conversationToBatch(conv2, [], { displayName: "Kimi" });
    const merged = schemaMap.mergeBatches([b1, b2]);
    expect(merged.persons.length).toBe(1);   // dedup
    expect(merged.topics.length).toBe(2);    // distinct conversations
  });
});

// ─── CookieAuthSession ───────────────────────────────────────────────────

describe("CookieAuthSession", () => {
  it("flattens cookies into a Cookie header", () => {
    const s = new CookieAuthSession({
      vendor: "deepseek",
      cookies: [
        { name: "userToken", value: "abc" },
        { name: "sessId", value: "xyz" },
      ],
    });
    expect(s.toHeaderValue()).toBe("userToken=abc; sessId=xyz");
  });

  it("filters by domain suffix when matchDomain provided", () => {
    const s = new CookieAuthSession({
      vendor: "coze",
      cookies: [
        { name: "wwwTok", value: "1", domain: "www.coze.cn" },
        { name: "cdnTok", value: "2", domain: ".sf-cdn.com" },
      ],
    });
    expect(s.toHeaderValue("www.coze.cn")).toBe("wwwTok=1");
  });

  it("get(name) returns the matching cookie value or undefined", () => {
    const s = new CookieAuthSession({
      vendor: "deepseek",
      cookies: [{ name: "userToken", value: "x" }],
    });
    expect(s.get("userToken")).toBe("x");
    expect(s.get("nope")).toBeUndefined();
  });

  it("serializes and round-trips via toJSON / fromJSON", () => {
    const s = new CookieAuthSession({
      vendor: "deepseek",
      cookies: [{ name: "userToken", value: "x" }],
      capturedAt: 12345,
    });
    const json = s.toJSON();
    const restored = CookieAuthSession.fromJSON(json);
    expect(restored.vendor).toBe("deepseek");
    expect(restored.capturedAt).toBe(12345);
    expect(restored.get("userToken")).toBe("x");
  });

  it("isExpired returns true when explicit expirationDate has passed", () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const s = new CookieAuthSession({
      vendor: "deepseek",
      cookies: [{ name: "x", value: "y", expirationDate: past }],
    });
    expect(s.isExpired()).toBe(true);
  });
});

// ─── NotImplementedYetError ──────────────────────────────────────────────

describe("NotImplementedYetError", () => {
  it("is throwable with code VENDOR_NOT_WIRED", () => {
    const err = new NotImplementedYetError("deepseek", "listConversations");
    expect(err.code).toBe("VENDOR_NOT_WIRED");
    expect(err.vendor).toBe("deepseek");
    expect(err.capability).toBe("listConversations");
  });
});
