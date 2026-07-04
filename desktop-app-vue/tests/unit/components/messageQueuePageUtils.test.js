import { describe, it, expect } from "vitest";
import {
  getMessagePreview,
  getStatusColor,
  getStatusText,
  formatDateTime,
} from "@renderer/pages/p2p/messageQueuePageUtils";

describe("p2p/messageQueuePageUtils", () => {
  describe("getMessagePreview", () => {
    it("previews short text as-is", () => {
      expect(getMessagePreview({ messageType: "text", content: "hi" })).toBe(
        "hi",
      );
    });
    it("truncates long text at 50 chars", () => {
      const content = "a".repeat(60);
      const out = getMessagePreview({ messageType: "text", content });
      expect(out).toBe("a".repeat(50) + "...");
    });
    it("shows type tag for non-text", () => {
      expect(getMessagePreview({ messageType: "image" })).toBe("[image]");
    });
  });

  describe("getStatusColor / getStatusText", () => {
    it("maps statuses with fallback", () => {
      expect(getStatusColor("sending")).toBe("blue");
      expect(getStatusColor("completed")).toBe("success");
      expect(getStatusColor("x")).toBe("default");
      expect(getStatusText("pending")).toBe("等待中");
      expect(getStatusText("rejected")).toBe("已拒绝");
      expect(getStatusText("x")).toBe("x");
    });
  });

  describe("formatDateTime", () => {
    it("returns a locale string", () => {
      const out = formatDateTime(Date.now());
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
