import { describe, it, expect } from "vitest";
import {
  getUserName,
  shortenHash,
  shortenCID,
  getContentPreview,
  formatDate,
} from "@renderer/components/knowledgeVersionHistoryUtils";

describe("knowledgeVersionHistoryUtils", () => {
  describe("getUserName", () => {
    it("returns 未知 for empty", () => {
      expect(getUserName("")).toBe("未知");
      expect(getUserName(null)).toBe("未知");
    });
    it("keeps short dids, shortens long", () => {
      expect(getUserName("did:short")).toBe("did:short");
      expect(getUserName("did:example:0123456789abcdef")).toBe(
        "did:exampl...abcdef",
      );
    });
  });

  describe("shortenHash", () => {
    it("empties falsy, keeps short, truncates long", () => {
      expect(shortenHash("")).toBe("");
      expect(shortenHash("abc")).toBe("abc");
      expect(shortenHash("0123456789abcdef")).toBe("0123456789ab...");
    });
  });

  describe("shortenCID", () => {
    it("empties falsy, keeps short, truncates long", () => {
      expect(shortenCID("")).toBe("");
      expect(shortenCID("Qmshort")).toBe("Qmshort");
      expect(shortenCID("Qm0123456789abcdefghijklmnop")).toBe(
        "Qm01234567...ghijklmnop",
      );
    });
  });

  describe("getContentPreview", () => {
    it("returns placeholder for empty", () => {
      expect(getContentPreview("")).toBe("暂无内容");
    });
    it("strips html tags", () => {
      expect(getContentPreview("<b>hello</b> world")).toBe("hello world");
    });
    it("truncates beyond 200 chars", () => {
      const long = "a".repeat(250);
      const out = getContentPreview(long);
      expect(out.endsWith("...")).toBe(true);
      expect(out.length).toBe(203);
    });
  });

  describe("formatDate", () => {
    it("returns dash for empty, string otherwise", () => {
      expect(formatDate(null)).toBe("-");
      const out = formatDate(Date.now());
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
