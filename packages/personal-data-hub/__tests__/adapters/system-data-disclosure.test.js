"use strict";

import { describe, it, expect } from "vitest";

const {
  SystemDataAdapter,
  SOURCE_DESCRIPTORS,
  SOURCE_KEYS,
  sanitizeInclude,
  resolveRetentionMs,
  checkDisclosureCoverage,
  buildDisclosurePayload,
} = require("../../lib/adapters/system-data");

class StubSupervisor {
  invoke() { return Promise.resolve({}); }
}

// ---------------------------------------------------------------------------

describe("SOURCE_DESCRIPTORS", () => {
  it("declares all four sources with required metadata", () => {
    expect(SOURCE_KEYS).toEqual(["contacts", "calllog", "sms", "wifi"]);
    for (const key of SOURCE_KEYS) {
      const d = SOURCE_DESCRIPTORS[key];
      expect(d.label).toBeTruthy();
      expect(Array.isArray(d.fields)).toBe(true);
      expect(d.fields.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(d.sensitivity);
      expect(typeof d.defaultEnabled).toBe("boolean");
    }
  });

  it("SMS is the only opt-out source", () => {
    const optOut = SOURCE_KEYS.filter((k) => !SOURCE_DESCRIPTORS[k].defaultEnabled);
    expect(optOut).toEqual(["sms"]);
  });

  it("SMS carries a third-party-content warning", () => {
    expect(SOURCE_DESCRIPTORS.sms.warning).toMatch(/他人/);
  });

  it("WiFi excludes password from collected fields", () => {
    expect(SOURCE_DESCRIPTORS.wifi.excludedFields).toContain("password");
    expect(SOURCE_DESCRIPTORS.wifi.fields).not.toContain("password");
  });
});

// ---------------------------------------------------------------------------

describe("sanitizeInclude", () => {
  it("returns descriptor defaults when input is empty", () => {
    expect(sanitizeInclude({})).toEqual({
      contacts: true, calllog: true, sms: false, wifi: true,
    });
  });

  it("returns descriptor defaults when input is null", () => {
    expect(sanitizeInclude(null)).toEqual({
      contacts: true, calllog: true, sms: false, wifi: true,
    });
  });

  it("coerces truthy non-boolean values to true", () => {
    const out = sanitizeInclude({ sms: 1, contacts: "yes", wifi: 0 });
    expect(out.sms).toBe(true);
    expect(out.contacts).toBe(true);
    expect(out.wifi).toBe(false);
  });

  it("drops unknown keys silently", () => {
    const out = sanitizeInclude({ contacts: true, MALICIOUS_KEY: true });
    expect(out).not.toHaveProperty("MALICIOUS_KEY");
    expect(Object.keys(out).sort()).toEqual(["calllog", "contacts", "sms", "wifi"]);
  });

  it("missing keys fall back to source defaults — sms stays false", () => {
    const out = sanitizeInclude({ contacts: true });
    expect(out.sms).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("resolveRetentionMs", () => {
  it("returns null when policy is missing", () => {
    expect(resolveRetentionMs(null)).toBeNull();
    expect(resolveRetentionMs({})).toBeNull();
  });

  it("returns null when retentionDays is not positive", () => {
    expect(resolveRetentionMs({ retentionDays: 0 })).toBeNull();
    expect(resolveRetentionMs({ retentionDays: -10 })).toBeNull();
    expect(resolveRetentionMs({ retentionDays: "abc" })).toBeNull();
  });

  it("converts days to milliseconds", () => {
    expect(resolveRetentionMs({ retentionDays: 1 })).toBe(24 * 60 * 60 * 1000);
    expect(resolveRetentionMs({ retentionDays: 30 })).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------

describe("checkDisclosureCoverage", () => {
  it("ok when adapter declares every descriptor field", () => {
    const adapter = new SystemDataAdapter({ supervisor: new StubSupervisor() });
    const result = checkDisclosureCoverage(adapter.dataDisclosure.fields);
    if (!result.ok) {
      console.error("missing fields:", result.missing);
    }
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("flags missing source", () => {
    const result = checkDisclosureCoverage(["contacts:name", "calllog:number", "wifi:ssid"]);
    // Missing sms entirely + missing fields under contacts/calllog/wifi
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.startsWith("sms:"))).toBe(true);
  });

  it("flags missing per-source fields", () => {
    const result = checkDisclosureCoverage([
      "contacts:name", // missing phone/email/...
      "calllog:number,duration,timestamp,type,name",
      "sms:address,body,timestamp,type,threadId,isRead",
      "wifi:ssid,securityType,hidden",
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("contacts:phone");
  });
});

// ---------------------------------------------------------------------------

describe("buildDisclosurePayload", () => {
  it("returns a payload that the UI can render directly", () => {
    const payload = buildDisclosurePayload();
    expect(payload.adapter).toBe("system-data");
    expect(payload.sensitivity).toBe("high");
    expect(payload.legalGate).toBe(true);
    expect(payload.sources).toHaveLength(4);
    expect(payload.sources.map((s) => s.key)).toEqual(["contacts", "calllog", "sms", "wifi"]);
    expect(payload.legalDeclaration).toMatch(/合法使用者/);
    expect(payload.legalDeclaration).toMatch(/不向任何第三方分发/);
  });

  it("notice mentions the no-upload promise", () => {
    const payload = buildDisclosurePayload();
    expect(payload.notice).toMatch(/不向任何服务器上传/);
  });
});
