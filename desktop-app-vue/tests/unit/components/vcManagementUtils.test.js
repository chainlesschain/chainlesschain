import { describe, it, expect } from "vitest";
import {
  getTypeName,
  getStatusLabel,
  getStatusColor,
  shortenDID,
  formatDate,
  formatJSON,
} from "@renderer/components/vcManagementUtils";

describe("vcManagementUtils", () => {
  it("getTypeName maps credential types, echoes unknown", () => {
    expect(getTypeName("SkillCertificate")).toBe("技能证书");
    expect(getTypeName("TrustEndorsement")).toBe("信任背书");
    expect(getTypeName("Custom")).toBe("Custom");
  });

  it("getStatusLabel / getStatusColor map credential status", () => {
    expect(getStatusLabel("active")).toBe("有效");
    expect(getStatusLabel("revoked")).toBe("已撤销");
    expect(getStatusColor("active")).toBe("success");
    expect(getStatusColor("revoked")).toBe("error");
    expect(getStatusColor("weird")).toBe("default");
  });

  describe("shortenDID", () => {
    it("returns '' for falsy", () => {
      expect(shortenDID(null)).toBe("");
      expect(shortenDID("")).toBe("");
    });
    it("shortens a 3-part did keeping method + head/tail", () => {
      expect(shortenDID("did:key:abcdefghijklmnop")).toBe(
        "did:key:abcdefgh...klmnop",
      );
    });
    it("returns non-standard dids unchanged", () => {
      expect(shortenDID("not-a-did")).toBe("not-a-did");
    });
  });

  it("formatDate returns '未知' for falsy, else a localized string", () => {
    expect(formatDate(null)).toBe("未知");
    expect(typeof formatDate(Date.UTC(2026, 0, 2))).toBe("string");
    expect(formatDate(Date.UTC(2026, 0, 2))).not.toBe("未知");
  });

  describe("formatJSON", () => {
    it("pretty-prints valid JSON with 2-space indent", () => {
      expect(formatJSON('{"a":1}')).toBe('{\n  "a": 1\n}');
    });
    it("returns the original string on parse failure", () => {
      expect(formatJSON("not json")).toBe("not json");
    });
  });
});
