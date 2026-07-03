import { describe, it, expect } from "vitest";
import {
  roleColor,
  roleLabel,
  statusColor,
  statusLabel,
  channelTypeLabel,
  channelTypeColor,
  shortDid,
  formatTime,
} from "@renderer/shell/community/communityDetailsDrawerUtils";

describe("communityDetailsDrawerUtils", () => {
  describe("roleColor / roleLabel", () => {
    it("maps known roles", () => {
      expect(roleColor("owner")).toBe("gold");
      expect(roleColor("admin")).toBe("geekblue");
      expect(roleColor("moderator")).toBe("blue");
      expect(roleColor("member")).toBe("green");
      expect(roleLabel("owner")).toBe("所有者");
      expect(roleLabel("admin")).toBe("管理员");
      expect(roleLabel("moderator")).toBe("版主");
      expect(roleLabel("member")).toBe("成员");
    });
    it("falls back for unknown / empty", () => {
      expect(roleColor("guest")).toBe("default");
      expect(roleColor(undefined)).toBe("default");
      expect(roleColor("")).toBe("default");
      expect(roleLabel("guest")).toBe("guest");
      expect(roleLabel(undefined)).toBe("");
      expect(roleLabel("")).toBe("");
    });
  });

  describe("statusColor / statusLabel", () => {
    it("maps known statuses", () => {
      expect(statusColor("active")).toBe("green");
      expect(statusColor("archived")).toBe("orange");
      expect(statusColor("banned")).toBe("red");
      expect(statusLabel("active")).toBe("活跃");
      expect(statusLabel("archived")).toBe("已归档");
      expect(statusLabel("banned")).toBe("已封禁");
    });
    it("falls back for unknown / empty", () => {
      expect(statusColor("weird")).toBe("default");
      expect(statusColor(undefined)).toBe("default");
      expect(statusLabel("weird")).toBe("weird");
      expect(statusLabel(undefined)).toBe("—");
    });
  });

  describe("channelTypeLabel / channelTypeColor", () => {
    it("maps known channel types", () => {
      expect(channelTypeLabel("announcement")).toBe("公告");
      expect(channelTypeLabel("discussion")).toBe("讨论");
      expect(channelTypeLabel("readonly")).toBe("只读");
      expect(channelTypeLabel("subscription")).toBe("订阅");
      expect(channelTypeColor("announcement")).toBe("red");
      expect(channelTypeColor("discussion")).toBe("blue");
      expect(channelTypeColor("readonly")).toBe("default");
      expect(channelTypeColor("subscription")).toBe("purple");
    });
    it("falls back for unknown / empty", () => {
      expect(channelTypeLabel("x")).toBe("x");
      expect(channelTypeLabel(undefined)).toBe("—");
      expect(channelTypeColor("x")).toBe("default");
      expect(channelTypeColor(undefined)).toBe("default");
    });
  });

  describe("shortDid", () => {
    it("returns dash for empty", () => {
      expect(shortDid(undefined)).toBe("—");
      expect(shortDid("")).toBe("—");
    });
    it("returns short DIDs unchanged (<=24)", () => {
      expect(shortDid("did:key:abc")).toBe("did:key:abc");
      expect(shortDid("a".repeat(24))).toBe("a".repeat(24));
    });
    it("truncates long DIDs with ellipsis", () => {
      const did = "did:key:z6MkeVabcdefghijklmnopqrstuvwxyz123456";
      expect(shortDid(did)).toBe(`${did.slice(0, 16)}…${did.slice(-6)}`);
    });
  });

  describe("formatTime", () => {
    it("returns dash for null / undefined", () => {
      expect(formatTime(undefined)).toBe("—");
      expect(formatTime(null)).toBe("—");
    });
    it("returns raw string for unparseable values", () => {
      expect(formatTime("not-a-date")).toBe("not-a-date");
    });
    it("formats valid timestamps", () => {
      const out = formatTime(1700000000000);
      expect(typeof out).toBe("string");
      expect(out).not.toBe("—");
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
