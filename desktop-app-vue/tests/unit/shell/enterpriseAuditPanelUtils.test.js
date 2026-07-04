import { describe, it, expect } from "vitest";
import {
  formatTime,
  truncateDid,
  formatDetails,
  getEventTypeColor,
  getEventTypeLabel,
  getRiskLevelColor,
  getRiskLevelLabel,
  getOutcomeColor,
  getOutcomeLabel,
} from "@renderer/shell/enterpriseAuditPanelUtils";

describe("enterpriseAuditPanelUtils", () => {
  it("formatTime formats via dayjs", () => {
    expect(formatTime(1700000000000)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("truncateDid dashes empty, truncates long", () => {
    expect(truncateDid("")).toBe("-");
    expect(truncateDid("did:key:short")).toBe("did:key:short");
    const d = "did:key:" + "z".repeat(30);
    expect(truncateDid(d)).toBe(
      d.substring(0, 10) + "..." + d.substring(d.length - 8),
    );
  });

  describe("formatDetails", () => {
    it("dashes falsy, pretty-prints objects + JSON strings", () => {
      expect(formatDetails(null)).toBe("-");
      expect(formatDetails({ a: 1 })).toBe('{\n  "a": 1\n}');
      expect(formatDetails('{"b":2}')).toBe('{\n  "b": 2\n}');
    });
    it("returns raw string on parse failure", () => {
      expect(formatDetails("not-json")).toBe("not-json");
    });
  });

  it("maps event type color+label", () => {
    expect(getEventTypeColor("data_delete")).toBe("red");
    expect(getEventTypeColor("x")).toBe("default");
    expect(getEventTypeLabel("login")).toBe("登录");
    expect(getEventTypeLabel("x")).toBe("x");
  });

  it("maps risk level color+label", () => {
    expect(getRiskLevelColor("critical")).toBe("#cf1322");
    expect(getRiskLevelColor("x")).toBe("default");
    expect(getRiskLevelLabel("high")).toBe("高");
    expect(getRiskLevelLabel("x")).toBe("x");
  });

  it("maps outcome color+label", () => {
    expect(getOutcomeColor("blocked")).toBe("volcano");
    expect(getOutcomeColor("x")).toBe("default");
    expect(getOutcomeLabel("success")).toBe("成功");
    expect(getOutcomeLabel("x")).toBe("x");
  });
});
