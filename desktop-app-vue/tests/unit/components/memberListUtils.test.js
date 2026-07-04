import { describe, it, expect } from "vitest";
import {
  getOnlineStatus,
  getAvatarColor,
  getRoleColor,
  getRoleLabel,
  formatDID,
  formatDate,
  formatTime,
} from "@renderer/components/organization/memberListUtils";

describe("memberListUtils", () => {
  it("maps online status to badge status", () => {
    expect(getOnlineStatus(true)).toBe("success");
    expect(getOnlineStatus(false)).toBe("default");
  });

  describe("getAvatarColor", () => {
    it("returns a palette color, stable per first char", () => {
      const palette = ["#f56a00", "#7265e6", "#ffbf00", "#00a2ae", "#87d068"];
      expect(palette).toContain(getAvatarColor("Alice"));
      expect(getAvatarColor("Alice")).toBe(getAvatarColor("Andrew"));
    });
  });

  it("maps role color+label with fallback", () => {
    expect(getRoleColor("owner")).toBe("red");
    expect(getRoleColor("x")).toBe("default");
    expect(getRoleLabel("admin")).toBe("Admin");
    expect(getRoleLabel("x")).toBe("Member");
  });

  it("formats DID with truncation", () => {
    expect(formatDID("")).toBe("");
    expect(formatDID("did:key:short")).toBe("did:key:short");
    const d = "did:key:" + "z".repeat(30);
    expect(formatDID(d)).toBe(
      `${d.substring(0, 10)}...${d.substring(d.length - 10)}`,
    );
  });

  it("formats date + unknown fallback", () => {
    expect(formatDate(0)).toBe("Unknown");
    expect(typeof formatDate(1700000000000)).toBe("string");
  });

  describe("formatTime", () => {
    it("unknown for falsy, relative buckets", () => {
      expect(formatTime(0)).toBe("Unknown");
      expect(formatTime(Date.now())).toBe("just now");
      expect(formatTime(Date.now() - 5 * 60000)).toBe("5m ago");
      expect(formatTime(Date.now() - 3 * 3600000)).toBe("3h ago");
      expect(formatTime(Date.now() - 2 * 86400000)).toBe("2d ago");
    });
  });
});
