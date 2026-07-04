import { describe, it, expect } from "vitest";
import {
  getActionLabel,
  getActionColor,
  getResourceTypeLabel,
  getActivityDetails,
  formatRelativeTime,
  formatFullTime,
  getRoleLabel,
} from "@renderer/pages/organizationActivityLogPageUtils";

describe("organizationActivityLogPageUtils", () => {
  it("maps action label+color with fallback", () => {
    expect(getActionLabel("add_member")).toBe("添加成员");
    expect(getActionLabel("x")).toBe("x");
    expect(getActionColor("remove_member")).toBe("red");
    expect(getActionColor("x")).toBe("default");
  });

  it("maps resource type + role label", () => {
    expect(getResourceTypeLabel("knowledge")).toBe("知识库");
    expect(getResourceTypeLabel("x")).toBe("x");
    expect(getRoleLabel("owner")).toBe("所有者");
    expect(getRoleLabel("x")).toBe("x");
  });

  describe("getActivityDetails", () => {
    it("renders per-action detail from metadata", () => {
      expect(
        getActivityDetails({
          action: "add_member",
          metadata: JSON.stringify({ display_name: "Bob", role: "admin" }),
        }),
      ).toBe("添加了成员: Bob (admin)");
      expect(
        getActivityDetails({
          action: "update_organization",
          metadata: "{}",
        }),
      ).toBe("更新了组织信息");
    });
    it("falls back to raw metadata on parse failure", () => {
      expect(getActivityDetails({ action: "x", metadata: "not-json" })).toBe(
        "not-json",
      );
    });
    it("stringifies metadata for unknown actions", () => {
      expect(
        getActivityDetails({ action: "mystery", metadata: '{"a":1}' }),
      ).toBe('{"a":1}');
    });
  });

  describe("time formatters (dayjs relativeTime extended)", () => {
    it("formatRelativeTime renders zh-cn relative string", () => {
      const out = formatRelativeTime(Date.now() - 60_000);
      expect(typeof out).toBe("string");
      expect(out).toContain("前");
    });
    it("formatFullTime formats YYYY-MM-DD HH:mm:ss", () => {
      expect(formatFullTime(1700000000000)).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
    });
  });
});
