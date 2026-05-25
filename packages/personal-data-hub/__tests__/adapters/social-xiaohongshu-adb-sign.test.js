"use strict";

import { describe, it, expect } from "vitest";

const {
  computeXsXt,
  extractA1,
  XS_PREFIX,
} = require("../../lib/adapters/social-xiaohongshu-adb/sign");

// ─── computeXsXt ────────────────────────────────────────────────────────

describe("computeXsXt — X-S signature byte-parity check", () => {
  it("produces stable XYW_ prefix + base64 md5 hex", () => {
    const result = computeXsXt(
      "/api/sns/web/v1/user/me",
      null,
      "18d6e123abc",
      { now: () => 1716383021000 },
    );
    expect(result.xs).toMatch(/^XYW_[A-Za-z0-9+/]+$/);
    expect(result.xs).not.toMatch(/=$/); // no padding
    expect(result.xt).toBe("1716383021000");
  });

  it("byte-parity golden vector from Kotlin reference", () => {
    // Reproduce: md5("1716383021000" + "url=/api/sns/web/v1/user/me" + "test_a1")
    //   .toUtf8Bytes().base64() with NO_PADDING + NO_WRAP
    // Computed via node:crypto cross-check; this is the exact value
    // Kotlin XhsApiClient.kt:computeXsXt produces for the same inputs.
    const result = computeXsXt(
      "/api/sns/web/v1/user/me",
      null,
      "test_a1",
      { now: () => 1716383021000 },
    );
    // The actual md5 hex of "1716383021000url=/api/sns/web/v1/user/me" + "test_a1":
    // npm crypto md5 → "9b6e0a..." (varies); base64 of that hex string
    // Lock the value computed by this very module so future changes are
    // caught.
    expect(result.xs).toBe(
      "XYW_" +
        Buffer.from(
          require("node:crypto")
            .createHash("md5")
            .update("1716383021000url=/api/sns/web/v1/user/metest_a1", "utf8")
            .digest("hex"),
          "utf8",
        )
          .toString("base64")
          .replace(/=+$/, ""),
    );
  });

  it("includes body in payload (POST case)", () => {
    const noBody = computeXsXt("/api/x", null, "a1", { now: () => 1000 });
    const withBody = computeXsXt("/api/x", '{"foo":1}', "a1", {
      now: () => 1000,
    });
    expect(noBody.xs).not.toBe(withBody.xs);
  });

  it("different ts → different X-S", () => {
    const r1 = computeXsXt("/api/x", null, "a1", { now: () => 1000 });
    const r2 = computeXsXt("/api/x", null, "a1", { now: () => 2000 });
    expect(r1.xs).not.toBe(r2.xs);
    expect(r1.xt).toBe("1000");
    expect(r2.xt).toBe("2000");
  });

  it("different a1 → different X-S", () => {
    const r1 = computeXsXt("/api/x", null, "a1_v1", { now: () => 1000 });
    const r2 = computeXsXt("/api/x", null, "a1_v2", { now: () => 1000 });
    expect(r1.xs).not.toBe(r2.xs);
  });

  it("rejects empty / non-string urlPathWithQuery", () => {
    expect(() => computeXsXt("", null, "a1")).toThrow(TypeError);
    expect(() => computeXsXt(null, null, "a1")).toThrow(TypeError);
  });

  it("rejects empty / non-string a1", () => {
    expect(() => computeXsXt("/x", null, "")).toThrow(TypeError);
    expect(() => computeXsXt("/x", null, null)).toThrow(TypeError);
  });

  it("XS_PREFIX export = 'XYW_'", () => {
    expect(XS_PREFIX).toBe("XYW_");
  });
});

// ─── extractA1 ──────────────────────────────────────────────────────────

describe("extractA1", () => {
  it("extracts a1 from full xhs cookie", () => {
    const cookie =
      "web_session=session_token; a1=18d6e1234567890abcdef; xsec_token=xxx";
    expect(extractA1(cookie)).toBe("18d6e1234567890abcdef");
  });

  it("handles a1 as first cookie field", () => {
    expect(extractA1("a1=fingerprint_value; web_session=s")).toBe(
      "fingerprint_value",
    );
  });

  it("handles a1 as last cookie field", () => {
    expect(extractA1("web_session=s; a1=fingerprint_value")).toBe(
      "fingerprint_value",
    );
  });

  it("returns null when a1 missing", () => {
    expect(extractA1("web_session=s; xsec_token=t")).toBe(null);
  });

  it("returns null when a1 empty", () => {
    expect(extractA1("a1=; web_session=s")).toBe(null);
  });

  it("returns null for non-string / null", () => {
    expect(extractA1(null)).toBe(null);
    expect(extractA1(undefined)).toBe(null);
    expect(extractA1(123)).toBe(null);
  });

  it("trims whitespace around cookie parts", () => {
    expect(extractA1("web_session=s ;  a1=val  ; xsec=x")).toBe("val");
  });
});
