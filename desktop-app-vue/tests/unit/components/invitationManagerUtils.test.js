import { describe, it, expect } from "vitest";
import {
  isExpired,
  isInvitationActive,
  getStatusBadge,
  getUsagePercent,
  formatDID,
  formatDate,
  getRoleLabel,
  getRoleColor,
} from "@renderer/components/invitationManagerUtils";

const FUTURE = Date.now() + 3_600_000;
const PAST = Date.now() - 3_600_000;

describe("invitationManagerUtils", () => {
  describe("isExpired", () => {
    it("is false when no expire_at set", () => {
      expect(isExpired({})).toBe(false);
    });
    it("reflects past/future expiry", () => {
      expect(isExpired({ expire_at: PAST })).toBe(true);
      expect(isExpired({ expire_at: FUTURE })).toBe(false);
    });
  });

  describe("isInvitationActive", () => {
    it("requires active, uses remaining, and not expired", () => {
      expect(
        isInvitationActive({
          is_active: true,
          used_count: 1,
          max_uses: 5,
          expire_at: FUTURE,
        }),
      ).toBe(true);
    });
    it("is false when disabled / used up / expired", () => {
      expect(isInvitationActive({ is_active: false })).toBe(false);
      expect(
        isInvitationActive({ is_active: true, used_count: 5, max_uses: 5 }),
      ).toBe(false);
      expect(
        isInvitationActive({
          is_active: true,
          used_count: 0,
          max_uses: 5,
          expire_at: PAST,
        }),
      ).toBe(false);
    });
  });

  describe("getStatusBadge", () => {
    it("maps invitation state to badge", () => {
      expect(getStatusBadge({ is_active: false })).toEqual({
        status: "default",
        text: "已禁用",
      });
      expect(
        getStatusBadge({ is_active: true, used_count: 3, max_uses: 3 }),
      ).toEqual({ status: "error", text: "已用完" });
      expect(
        getStatusBadge({
          is_active: true,
          used_count: 0,
          max_uses: 5,
          expire_at: PAST,
        }),
      ).toEqual({ status: "error", text: "已过期" });
      expect(
        getStatusBadge({
          is_active: true,
          used_count: 0,
          max_uses: 5,
          expire_at: FUTURE,
        }),
      ).toEqual({ status: "success", text: "有效" });
    });
  });

  describe("getUsagePercent", () => {
    it("returns 0 for unlimited/zero max_uses (no divide-by-zero)", () => {
      expect(getUsagePercent({ max_uses: 0, used_count: 3 })).toBe(0);
      expect(getUsagePercent({ used_count: 3 })).toBe(0);
    });
    it("rounds usage ratio to percent", () => {
      expect(getUsagePercent({ max_uses: 4, used_count: 1 })).toBe(25);
      expect(getUsagePercent({ max_uses: 3, used_count: 1 })).toBe(33);
    });
  });

  describe("formatDID", () => {
    it("returns empty for falsy", () => {
      expect(formatDID("")).toBe("");
      expect(formatDID(undefined)).toBe("");
    });
    it("returns short DIDs unchanged", () => {
      expect(formatDID("did:key:short")).toBe("did:key:short");
    });
    it("truncates long DIDs", () => {
      const did = "did:key:z6Mk" + "x".repeat(40);
      expect(formatDID(did)).toBe(
        did.substring(0, 15) + "..." + did.substring(did.length - 10),
      );
    });
  });

  describe("formatDate", () => {
    it("returns empty for falsy", () => {
      expect(formatDate(0)).toBe("");
      expect(formatDate(null)).toBe("");
    });
    it("formats timestamps as YYYY-MM-DD HH:mm:ss", () => {
      expect(formatDate(1700000000000)).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
    });
  });

  describe("getRoleLabel / getRoleColor", () => {
    it("maps known roles", () => {
      expect(getRoleLabel("owner")).toBe("所有者");
      expect(getRoleLabel("viewer")).toBe("访客");
      expect(getRoleColor("owner")).toBe("red");
      expect(getRoleColor("member")).toBe("blue");
    });
    it("falls back for unknown", () => {
      expect(getRoleLabel("x")).toBe("x");
      expect(getRoleColor("x")).toBe("default");
    });
  });
});
