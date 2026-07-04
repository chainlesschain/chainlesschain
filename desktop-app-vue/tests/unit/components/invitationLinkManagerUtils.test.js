import { describe, it, expect } from "vitest";
import {
  getRoleColor,
  getRoleLabel,
  getUsagePercent,
  getUsageStatus,
  getStatusBadge,
  formatDate,
  getTimeRemaining,
} from "@renderer/components/organization/invitationLinkManagerUtils";

describe("organization/invitationLinkManagerUtils", () => {
  describe("getRoleColor / getRoleLabel", () => {
    it("maps roles with fallback", () => {
      expect(getRoleColor("owner")).toBe("red");
      expect(getRoleColor("viewer")).toBe("green");
      expect(getRoleColor("x")).toBe("default");
      expect(getRoleLabel("admin")).toBe("管理员");
      expect(getRoleLabel("x")).toBe("x");
    });
  });

  describe("getUsagePercent", () => {
    it("returns 0 when max_uses is 0", () => {
      expect(getUsagePercent({ max_uses: 0, used_count: 5 })).toBe(0);
    });
    it("computes rounded percent", () => {
      expect(getUsagePercent({ max_uses: 10, used_count: 3 })).toBe(30);
      expect(getUsagePercent({ max_uses: 3, used_count: 1 })).toBe(33);
    });
  });

  describe("getUsageStatus", () => {
    it("buckets by percent", () => {
      expect(getUsageStatus({ max_uses: 10, used_count: 10 })).toBe(
        "exception",
      );
      expect(getUsageStatus({ max_uses: 10, used_count: 9 })).toBe("active");
      expect(getUsageStatus({ max_uses: 10, used_count: 1 })).toBe("normal");
    });
  });

  describe("getStatusBadge", () => {
    it("prioritizes expired, exhausted, revoked, active", () => {
      expect(getStatusBadge({ isExpired: true })).toEqual({
        status: "default",
        text: "已过期",
      });
      expect(getStatusBadge({ isExhausted: true })).toEqual({
        status: "default",
        text: "已用尽",
      });
      expect(getStatusBadge({ status: "revoked" })).toEqual({
        status: "error",
        text: "已撤销",
      });
      expect(getStatusBadge({ status: "active" })).toEqual({
        status: "success",
        text: "活跃",
      });
      expect(getStatusBadge({ status: "other" })).toEqual({
        status: "default",
        text: "other",
      });
    });
  });

  describe("formatDate", () => {
    it("formats a timestamp as YYYY-MM-DD HH:mm", () => {
      const out = formatDate(new Date(2026, 0, 2, 3, 4).getTime());
      expect(out).toBe("2026-01-02 03:04");
    });
  });

  describe("getTimeRemaining", () => {
    it("returns 已过期 for a past timestamp", () => {
      expect(getTimeRemaining(Date.now() - 60_000)).toBe("已过期");
    });
    it("returns a relative string for a future timestamp", () => {
      const out = getTimeRemaining(Date.now() + 60 * 60 * 1000);
      expect(typeof out).toBe("string");
      expect(out).not.toBe("已过期");
    });
  });
});
