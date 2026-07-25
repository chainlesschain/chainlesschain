"use strict";

import { describe, expect, it } from "vitest";

const {
  canonicalQqGroupOriginalId,
  canonicalQqNtOriginalId,
  canonicalQqPersonOriginalId,
  createQqAccountScope,
  createQqPathScope,
  exactDecimalIdentifier,
} = require("../lib/qq-source-identity");

describe("QQ canonical source identity", () => {
  it("keeps exact decimal identifiers without Number precision loss", () => {
    expect(exactDecimalIdentifier("9007199254740993123")).toBe(
      "9007199254740993123",
    );
    expect(exactDecimalIdentifier(42n)).toBe("42");
    expect(exactDecimalIdentifier(42)).toBe("42");
  });

  it("rejects synthetic, signed, fractional, and unsafe numeric IDs", () => {
    expect(exactDecimalIdentifier("m1")).toBeNull();
    expect(exactDecimalIdentifier("-1")).toBeNull();
    expect(exactDecimalIdentifier(1.5)).toBeNull();
    expect(exactDecimalIdentifier(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  it("derives the QQ NT table only from a supported name or group flag", () => {
    expect(
      canonicalQqNtOriginalId({
        messageId: "9007199254740993123",
        tableName: "group_msg_table",
      }),
    ).toBe("group_msg_table:9007199254740993123");
    expect(
      canonicalQqNtOriginalId({
        msgId: "9007199254740993123",
        isGroup: false,
      }),
    ).toBe("c2c_msg_table:9007199254740993123");
    expect(
      canonicalQqNtOriginalId({
        messageId: null,
        msgId: "9007199254740993123",
        isGroup: false,
      }),
    ).toBeNull();
    expect(
      canonicalQqNtOriginalId({
        msgId: "m1",
        isGroup: false,
      }),
    ).toBeNull();
  });

  it("aligns verified contact and group UINs with QQ PC entities", () => {
    expect(canonicalQqPersonOriginalId("10001")).toBe("person-qq-10001");
    expect(canonicalQqGroupOriginalId("20002")).toBe("group-qq-20002");
    expect(canonicalQqPersonOriginalId("unknown")).toBeNull();
    expect(canonicalQqGroupOriginalId("group-1")).toBeNull();
  });

  it("creates privacy-preserving account and path fallback scopes", () => {
    const accountScope = createQqAccountScope("10001");
    const pathScope = createQqPathScope("C:\\QQ\\nt_msg.db");
    expect(accountScope).toMatch(/^account:qq:[0-9a-f]{32}$/u);
    expect(pathScope).toMatch(/^account:qq-pc-profile:[0-9a-f]{32}$/u);
    expect(accountScope).not.toContain("10001");
    expect(pathScope).not.toContain("nt_msg");
    expect(createQqAccountScope("u_not-a-uin")).toBeNull();
    expect(createQqPathScope("")).toBeNull();
  });
});
