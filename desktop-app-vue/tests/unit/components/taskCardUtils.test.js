import { describe, it, expect } from "vitest";
import {
  getPriorityLabel,
  getLabelColor,
  formatDueDate,
  getAvatarColor,
} from "@renderer/components/task/taskCardUtils";

describe("task/taskCardUtils", () => {
  describe("getPriorityLabel", () => {
    it("maps known priorities", () => {
      expect(getPriorityLabel("urgent")).toBe("紧急");
      expect(getPriorityLabel("high")).toBe("高");
      expect(getPriorityLabel("medium")).toBe("中");
      expect(getPriorityLabel("low")).toBe("低");
    });
    it("falls back to the raw value", () => {
      expect(getPriorityLabel("weird")).toBe("weird");
    });
  });

  describe("getLabelColor", () => {
    it("returns one of the palette colors", () => {
      const palette = ["blue", "green", "orange", "purple", "cyan", "magenta"];
      expect(palette).toContain(getLabelColor("frontend"));
    });
    it("is deterministic for the same label", () => {
      expect(getLabelColor("bug")).toBe(getLabelColor("bug"));
    });
  });

  describe("formatDueDate", () => {
    const day = 24 * 60 * 60 * 1000;
    it("labels today/tomorrow/yesterday", () => {
      expect(formatDueDate(Date.now() + 60 * 1000)).toBe("今天");
      expect(formatDueDate(Date.now() + day + 60 * 1000)).toBe("明天");
      expect(formatDueDate(Date.now() - day + 60 * 1000)).toBe("昨天");
    });
    it("labels within a week", () => {
      expect(formatDueDate(Date.now() + 3 * day + 60 * 1000)).toBe("3天后");
      expect(formatDueDate(Date.now() - 3 * day + 60 * 1000)).toBe("3天前");
    });
    it("falls back to a date string beyond a week", () => {
      const out = formatDueDate(Date.now() + 30 * day);
      expect(typeof out).toBe("string");
      expect(out).not.toMatch(/今天|明天|昨天|天后|天前/);
    });
  });

  describe("getAvatarColor", () => {
    it("returns one of the palette colors", () => {
      const palette = [
        "#1890ff",
        "#52c41a",
        "#faad14",
        "#f5222d",
        "#722ed1",
        "#13c2c2",
      ];
      expect(palette).toContain(getAvatarColor("did:example:abc"));
    });
    it("is deterministic for the same did", () => {
      expect(getAvatarColor("did:x")).toBe(getAvatarColor("did:x"));
    });
  });
});
