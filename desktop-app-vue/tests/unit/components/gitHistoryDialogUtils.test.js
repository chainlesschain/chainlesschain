import { describe, it, expect } from "vitest";
import {
  getCommitColor,
  getFileStatusColor,
  formatSha,
  formatRelativeTime,
  formatFullDate,
} from "@renderer/components/projects/gitHistoryDialogUtils";

describe("gitHistoryDialogUtils", () => {
  describe("getCommitColor", () => {
    it("prioritizes head, then merge, else green", () => {
      expect(getCommitColor({ isHead: true })).toBe("blue");
      expect(getCommitColor({ isMerge: true })).toBe("purple");
      expect(getCommitColor({})).toBe("green");
    });
  });

  it("maps file status color with fallback", () => {
    expect(getFileStatusColor("added")).toBe("green");
    expect(getFileStatusColor("deleted")).toBe("red");
    expect(getFileStatusColor("renamed")).toBe("default");
  });

  it("shortens SHA to 7 chars", () => {
    expect(formatSha("")).toBe("");
    expect(formatSha(undefined)).toBe("");
    expect(formatSha("abcdef1234567890")).toBe("abcdef1");
  });

  describe("formatRelativeTime / formatFullDate", () => {
    it("format numeric (seconds) + string timestamps", () => {
      // numeric timestamps are treated as unix seconds (× 1000)
      const rel = formatRelativeTime(Math.floor(Date.now() / 1000) - 3600);
      expect(typeof rel).toBe("string");
      expect(rel).not.toBe("未知时间");
      expect(formatFullDate(1700000000)).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
    });
    it("returns fallback on invalid input", () => {
      expect(formatRelativeTime("not-a-date")).toBe("未知时间");
      expect(formatFullDate("not-a-date")).toBe("未知时间");
    });
  });
});
