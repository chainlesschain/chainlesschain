import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatFullTime,
  formatSize,
} from "@renderer/pages/email/emailReaderUtils";

describe("emailReaderUtils", () => {
  describe("formatTime", () => {
    it("returns a relative time string (relativeTime plugin extended)", () => {
      const out = formatTime(Date.now() - 60_000);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      // zh-cn relativeTime renders "... 前" for past times
      expect(out).toContain("前");
    });
  });

  describe("formatFullTime", () => {
    it("formats as YYYY-MM-DD HH:mm:ss", () => {
      expect(formatFullTime(1700000000000)).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
    });
  });

  describe("formatSize", () => {
    it("scales B / KB / MB", () => {
      expect(formatSize(512)).toBe("512 B");
      expect(formatSize(2048)).toBe("2.00 KB");
      expect(formatSize(3 * 1024 * 1024)).toBe("3.00 MB");
    });
    it("uses B just under 1 KiB", () => {
      expect(formatSize(1023)).toBe("1023 B");
    });
  });
});
